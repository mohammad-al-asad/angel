
import mongoose from "mongoose";
import status from "http-status";
import AppError from "../../errors/AppError";
import { TFollowup } from "./followup.interface";
import eventposts from "../event_post/event_post.model";
import followups from "./followup.model";
import QueryBuilder from "../../builder/QueryBuilder";
import users from "../user/user.model";
import NotificationServices from "../notification/notification.services";
import notifications from "../notification/notification.model";
import { NotificationType } from "../notification/notification.constant";

import conversations from "../conversation/conversation.model";
import { CHAT_TYPE } from "../conversation/conversation.constant";
import userblocks from "./user_block.model";
import { assertNotBlocked, getBlockRelationIds, getBlockStatus } from "./block.helpers";



const recordedFollowUpIntoDb = async (
  payload: Partial<TFollowup>,
  userId: string
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    // can't follow or unfollow someone you blocked / who blocked you
    await assertNotBlocked(userId, String(payload.followupId));

    const existingFollowup = await followups
      .findOne({
        userId,
        followupId:payload.followupId,
        isDelete: false,
      })
      .session(session);

    let message = "";
    let statusResult = true;

    if (existingFollowup) {
      await followups.deleteOne({ _id: existingFollowup._id }).session(session);
      

      message = "Successfully unfollowed";
      statusResult = false;
    } else {
      // FOLLOW
      await followups.create(
        [
          {
            ...payload,
            userId,
            isFollowUp: true,
          },
        ],
        { session }
      );

      message = "Successfully followed";
    }

    await session.commitTransaction();

    return { status: statusResult, message };
  } catch (error: any) {
    await session.abortTransaction();
    if (error instanceof AppError) throw error;
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      error?.message || "Failed to record follow-up"
    );
  } finally {
    session.endSession();
  }
};


const findByEventSocialFeedFolloweWiseFilteringIntoDb = async (
  query: Record<string, unknown>,
  userId: string
) => {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  const name = query?.name?.toString().trim();

  const currentUserObjectId = new mongoose.Types.ObjectId(userId);

  // ✅ Get followed user IDs (ObjectId[] from .distinct())
  // users hidden by blocks (either direction): never shown in the feed
  const hiddenUserIds = await getBlockRelationIds(userId);
  const hiddenSet = new Set(hiddenUserIds.map(String));

  const followedUsers: mongoose.Types.ObjectId[] = (
    await followups
      .find({ userId, isDelete: false, isFollowUp: true })
      .distinct("followupId")
  ).filter((id: mongoose.Types.ObjectId) => !hiddenSet.has(String(id)));

  const makePostPipeline = (matchStage: Record<string, any>, feedType: string) => [
    { $match: matchStage },

    // ---------- USER INFO ----------
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [
          ...(name
            ? [
                {
                  $match: {
                    name: { $regex: new RegExp("^" + name, "i") },
                  },
                },
              ]
            : []),
          { $project: { _id: 1, name: 1, photo: 1, subname: 1 } },
        ],
      },
    },
    { $unwind: { path: "$user", preserveNullAndEmptyArrays: false } },

    // ---------- TAG PEOPLE ----------
    {
      $lookup: {
        from: "users",
        localField: "tag_people",
        foreignField: "_id",
        as: "tag_people",
        pipeline: [{ $project: { _id: 1, name: 1 } }],
      },
    },

    // ---------- REACTION INFO ----------
    {
      $lookup: {
        from: "reacteventposts",
        let: {
          postId: "$_id",
          currentUserId: currentUserObjectId,
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$eventpostId", "$$postId"] },
                  { $eq: ["$userId", "$$currentUserId"] },
                  { $eq: ["$isDelete", false] },
                ],
              },
            },
          },
        ],
        as: "reactInfo",
      },
    },

    // ---------- FOLLOW STATUS ----------
    {
      $lookup: {
        from: "followups",
        let: {
          currentUserId: currentUserObjectId,
          postUserId: "$userId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$currentUserId"] },
                  { $eq: ["$followupId", "$$postUserId"] },
                  { $eq: ["$isFollowUp", true] },
                  { $eq: ["$isDelete", false] },
                ],
              },
            },
          },
        ],
        as: "followInfo",
      },
    },

    // ---------- COMPUTED FIELDS ----------
    {
      $addFields: {
        isReact: {
          $cond: [
            { $gt: [{ $size: "$reactInfo" }, 0] },
            { $arrayElemAt: ["$reactInfo.isReact", 0] },
            false,
          ],
        },
        isFollowUp: { $gt: [{ $size: "$followInfo" }, 0] },
        feedType: { $literal: feedType },
      },
    },

    { $project: { reactInfo: 0, followInfo: 0 } },
  ];

  // ---------- MAIN PIPELINE ----------
  // Partition logic (mutually exclusive by construction, no dedup needed):
  //
  // followedPosts = posts by (followedUsers ∪ self)
  // randomPosts   = posts by everyone else (NOT followed, NOT self)
  //
  // "self" is included in followedPosts so the viewer sees their own
  // posts in their feed, same as Facebook/Instagram. If you don't want
  // that, remove `currentUserObjectId` from the $in array below and add
  // it back to randomPosts' $nin array (see commented alternative).
  const pipeline = [
    {
      $facet: {
        followedPosts: makePostPipeline(
          {
            isDelete: false,
            eventId: { $exists: false },
            userId: { $in: [...followedUsers, currentUserObjectId] },
          },
          "followed"
        ),

        randomPosts: makePostPipeline(
          {
            isDelete: false,
            eventId: { $exists: false },
            userId: { $nin: [...followedUsers, currentUserObjectId, ...hiddenUserIds] },
          },
          "suggested"
        ),
      },
    },

    { $project: { allPosts: { $concatArrays: ["$followedPosts", "$randomPosts"] } } },
    { $unwind: "$allPosts" },
    { $replaceRoot: { newRoot: "$allPosts" } },
    { $sort: { createdAt: -1 } },
    { $skip: (page - 1) * limit },
    { $limit: limit },
  ];

  const result = await eventposts.aggregate(pipeline as any);

  // ---------- TOTAL COUNT ----------
  // Matches the full universe covered by followedPosts + randomPosts above
  // (i.e. every non-deleted, non-event post — everyone, including self).
  const total = await eventposts.countDocuments({
    isDelete: false,
    eventId: { $exists: false },
    userId: { $nin: hiddenUserIds },
  });

  return {
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
    data: result,
  };
};

const findByEventSocialFeedByIdIntoDb = async (postId: string, userId: string) => {
   if (mongoose.Types.ObjectId.isValid(postId)) {
     const post = await eventposts.findById(postId).select("userId").lean();
     if (post?.userId) await assertNotBlocked(userId, String(post.userId));
   }
   try{

     const result = await eventposts.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(postId),
        isDelete: false,
        eventId: { $exists: false },
      },
    },

    // User Info
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
              photo: 1,
              subname: 1,
            },
          },
        ],
      },
    },
    {
      $unwind: {
        path: "$user",
        preserveNullAndEmptyArrays: false,
      },
    },

    // Tagged People
    {
      $lookup: {
        from: "users",
        localField: "tag_people",
        foreignField: "_id",
        as: "tag_people",
        pipeline: [
          {
            $project: {
              _id: 1,
              name: 1,
            },
          },
        ],
      },
    },
    
    // Reaction Info
    {
      $lookup: {
        from: "reacteventposts",
        let: { postId: "$_id", currentUserId: new mongoose.Types.ObjectId(userId) },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$eventpostId", "$$postId"] },
                  { $eq: ["$userId", "$$currentUserId"] },
                  { $eq: ["$isDelete", false] },
                ],
              },
            },
          },
          { $project: { isReact: 1 } },
        ],
        as: "reactInfo",
      },
    },

    // Follow Info
    {
      $lookup: {
        from: "followups",
        let: {
          currentUserId: new mongoose.Types.ObjectId(userId),
          postUserId: "$userId",
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ["$userId", "$$currentUserId"] },
                  { $eq: ["$followupId", "$$postUserId"] },
                  { $eq: ["$isFollowUp", true] },
                  { $eq: ["$isDelete", false] },
                ],
              },
            },
          },
        ],
        as: "followInfo",
      },
    },

    // Computed Fields
    {
      $addFields: {
        isReact: {
          $cond: [
            { $gt: [{ $size: "$reactInfo" }, 0] },
            { $arrayElemAt: ["$reactInfo.isReact", 0] },
            false,
          ],
        },
        isFollowUp: { $gt: [{ $size: "$followInfo" }, 0] },
      },
    },
    
    // Cleanup internal fields
    {
      $project: {
        reactInfo: 0,
        followInfo: 0
      }
    }
  ]);

  return result.length ? result[0] : null;

   }
   catch(error){
     throw new AppError(status.SERVICE_UNAVAILABLE,'')
   }
};






 //   const followedUsers = await followups
//     .find({ userId, isDelete: false, isFollowUp: true })
//     .distinct("userId");

const  findMyFollowedListIntoDb=async(userId:string, query: Record<string, unknown>)=>{


     try{
      const hiddenUserIds = await getBlockRelationIds(userId);
      const baseQuery = followups
      .find({ userId, followupId: { $nin: hiddenUserIds } }).populate([
        {
          path: "followupId",
          select: "name  photo",
        },
      ])
     
      .select("-isDelete  -updatedAt -eventpostId -eventId -followupId -followupId").lean()
    ;

    const allFollowupListQuery = new QueryBuilder(baseQuery, query)
      .search(["userId.name"])
      .filter()
      .sort()
      .paginate()
      .fields();

    const all_my_followupList = await allFollowupListQuery.modelQuery;
    const meta = await allFollowupListQuery.countTotal();

  

    return { meta,all_my_followupList };
     }
     catch(error:any){
        throw new AppError(status.SERVICE_UNAVAILABLE,'issues by the  findMyFollowedListIntoDb server unavaliable')
     }


};

const myFollowingAndFollowerListIntoDb = async (
  userId: string,
  receiverId: string
) => {
  try {
    if (
      !mongoose.Types.ObjectId.isValid(receiverId) ||
      !mongoose.Types.ObjectId.isValid(userId)
    ) {
      throw new AppError(status.BAD_REQUEST, "Invalid user or receiver ID");
    }

    // Someone who blocked you: profile not available.
    // Someone you blocked: still visible to you (so you can unblock), flagged with isBlock.
    const blockStatus = await getBlockStatus(userId, receiverId);
    if (blockStatus.hasBlockedMe) {
      throw new AppError(status.FORBIDDEN, "User not available");
    }

    // ⚡ Fetch all essential info in parallel
    const [followingCount, followerCount, totalPosts, userInfo, followRecord, conversation] =
      await Promise.all([
        followups.countDocuments({ userId: receiverId, isDelete: false, isFollowUp: true }),
        followups.countDocuments({ followupId: receiverId, isDelete: false, isFollowUp: true }),
        eventposts.countDocuments({ userId: receiverId, isDelete: false }),
        users.findById(receiverId).select("name photo subname").lean(),
        followups.findOne({ userId, followupId: receiverId, isDelete: false }).select("isFollowUp isBlock").lean(),
        conversations.findOne({
          participants: {
            $all: [
              new mongoose.Types.ObjectId(receiverId),
              new mongoose.Types.ObjectId(userId),
            ],
          },
          $expr: { $eq: [{ $size: "$participants" }, 2] },
          chat: CHAT_TYPE.singlechat,
        }).select("_id").lean(),
      ]);

    // 🧠 Validate user existence
    if (!userInfo) {
      throw new AppError(status.NOT_FOUND, "User not found");
    }

    const isFollowups = !!followRecord?.isFollowUp;
    const isBlock = blockStatus.isBlockedByMe;

    // ✅ Final structured response
    return {
      user: userInfo,
      conversationId: isBlock ? null : conversation?._id || null,
      isFollowups,
      isBlock,
      isBlockedByMe: blockStatus.isBlockedByMe,
      stats: {
        following: followingCount,
        followers: followerCount,
        totalPosts,
      },
    };
  } catch (error: any) {
    console.error("❌ myFollowingAndFollowerListIntoDb Error:", error);
    if (error instanceof AppError) throw error;
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Server unavailable while fetching user stats",
      error.message
    );
  }
};

const getUserFollowersListIntoDb = async (
  targetUserId: string,
  currentUserId: string,
  query: Record<string, unknown>
) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new AppError(status.BAD_REQUEST, "Invalid user ID");
    }

    // can't browse the lists of someone you blocked / who blocked you
    await assertNotBlocked(currentUserId, targetUserId);
    const hiddenUserIds = await getBlockRelationIds(currentUserId);

    const baseQuery = followups
      .find({
        followupId: targetUserId,
        userId: { $nin: hiddenUserIds },
        isFollowUp: true,
        isDelete: false,
      })
      .populate([
        {
          path: "userId",
          select: "name photo subname role",
        },
      ])
      .select("-isDelete -updatedAt -eventpostId -eventId")
      .lean();

    const followerQuery = new QueryBuilder(baseQuery, query)
      .search(["userId.name"])
      .filter()
      .sort()
      .paginate();

    const followerList: any[] = await followerQuery.modelQuery;
    const meta = await followerQuery.countTotal();

    // Check which followers the current user is following
    const followerUserIds = followerList
      .map((item) => item.userId?._id)
      .filter(Boolean);

    const currentUserFollowing = await followups
      .find({
        userId: currentUserId,
        followupId: { $in: followerUserIds },
        isFollowUp: true,
        isDelete: false,
      })
      .distinct("followupId");

    const followingSet = new Set(
      currentUserFollowing.map((id) => id.toString())
    );

    const data = followerList.map((item) => ({
      ...item,
      isFollowedByMe: item.userId?._id
        ? followingSet.has(item.userId._id.toString())
        : false,
    }));

    return { meta, data };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      error?.message || "Failed to fetch user followers list"
    );
  }
};

const getUserFollowingListIntoDb = async (
  targetUserId: string,
  currentUserId: string,
  query: Record<string, unknown>
) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new AppError(status.BAD_REQUEST, "Invalid user ID");
    }

    await assertNotBlocked(currentUserId, targetUserId);
    const hiddenUserIds = await getBlockRelationIds(currentUserId);

    const baseQuery = followups
      .find({
        userId: targetUserId,
        followupId: { $nin: hiddenUserIds },
        isFollowUp: true,
        isDelete: false,
      })
      .populate([
        {
          path: "followupId",
          select: "name photo subname role",
        },
      ])
      .select("-isDelete -updatedAt -eventpostId -eventId")
      .lean();

    const followingQuery = new QueryBuilder(baseQuery, query)
      .search(["followupId.name"])
      .filter()
      .sort()
      .paginate();

    const followingList: any[] = await followingQuery.modelQuery;
    const meta = await followingQuery.countTotal();

    // Check which of these users the current viewer is following
    const followingUserIds = followingList
      .map((item) => item.followupId?._id)
      .filter(Boolean);

    const currentUserFollowing = await followups
      .find({
        userId: currentUserId,
        followupId: { $in: followingUserIds },
        isFollowUp: true,
        isDelete: false,
      })
      .distinct("followupId");

    const followingSet = new Set(
      currentUserFollowing.map((id) => id.toString())
    );

    const data = followingList.map((item) => ({
      ...item,
      isFollowedByMe: item.followupId?._id
        ? followingSet.has(item.followupId._id.toString())
        : false,
    }));

    return { meta, data };
  } catch (error: any) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      error?.message || "Failed to fetch user following list"
    );
  }
};




interface InvitationNotification {
  title: string;
  content: string;
  invitasationList: string[];
  route?: string;
  senderId?: string;
  groupId?: string;

}

const sendInvitasationNotificationIntoDb = async (
  senderUserId: string,
  invitationData: InvitationNotification
) => {
  try {
    const {
      title,
      content,
      invitasationList,
      route,
      senderId,
      groupId,
    } = invitationData;

    for (const userId of invitasationList) {
      // Check user & FCM token
      const user = await users.findById(userId).select("fcm");

      if (!user) {
        console.log(`User not found: ${userId}`);
        continue;
      }

      if (!user.fcm) {
        console.log(`No FCM token found for user: ${userId}`);
        continue;
      }

      // Notification payload
      const notificationPayload: any = {
        userId,
        title,
        content,
        route,
        senderId,
        type: groupId ? NotificationType.group_invitation : NotificationType.general,
      };

      // groupId is optional
      if (groupId) {
        notificationPayload.groupId = groupId;
      }

      // Save notification
      const savedNotification = await notifications.create(
        notificationPayload
      );

      if (!savedNotification) {
        console.log(`Failed to save notification for ${userId}`);
        continue;
      }

      // Send push notification
      try {
        await NotificationServices.sendPushNotification(userId.toString(), {
          title,
          content,
          data: {
            notificationId: savedNotification._id,
            type: notificationPayload.type,
            groupId,
            senderId,
          },
        });

        console.log(`✅ Notification sent to ${userId}`);
      } catch (pushError) {
        console.error(
          `❌ Failed to send push notification to ${userId}`,
          pushError
        );
      }
    }

    return {
      success: true,
      message: "Invitation notifications sent successfully.",
    };
  } catch (error: any) {
    console.error("Error sending invitation notifications:", error);

    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Server unavailable: sendInvitationNotificationIntoDb"
    );
  }
};



const findMyFollowingListIntoDb=async(userId:string, query: Record<string, unknown>)=>{


     try{
      const hiddenUserIds = await getBlockRelationIds(userId);
      const baseQuery = followups
      .find({followupId:userId, userId: { $nin: hiddenUserIds }}).populate([
        {
          path: "userId",
          select: "name  photo",
        },
      ])
     
      .select("-isDelete  -updatedAt -eventpostId -eventId -followupId -followupId").lean()
    ;

    const allFollowupListQuery = new QueryBuilder(baseQuery, query)
      .search(["userId.name"])
      .filter()
      .sort()
      .paginate()
      .fields();

    const all_my_followupList = await allFollowupListQuery.modelQuery;
    const meta = await allFollowupListQuery.countTotal();

  

    return { meta,all_my_followupList };
     }
     catch(error:any){
        throw new AppError(status.SERVICE_UNAVAILABLE,'issues by the   findMyFollowingListIntoDb server unavaliable')
     }


};

// delete my follower list 



const deleteFollowerListIntoDb=async(id:string)=>{

    try{
    

       const isExistFollowup=await followups.exists({_id:id});
       if(!isExistFollowup){
          throw new AppError(status.NOT_FOUND,'not founded this id','')
       }

       const result=await followups.findByIdAndDelete(id);
       if(!result){
        throw new AppError(status.NOT_EXTENDED,'issues by the delete follower section')
       };
       return {
         status:true , 
         message:"successfully delete"
       }

    }
     catch(error:any){
        throw new AppError(status.SERVICE_UNAVAILABLE,'issues by the    delete Follower List IntoDb server unavaliable')
     }
}




// Block / unblock (toggle). Works whether or not the users follow each other.
const isBlockFollowerAndFollowingIntoDb = async (
  userId: string,
  blockedUserId: string
) => {
  if (!mongoose.Types.ObjectId.isValid(blockedUserId)) {
    throw new AppError(status.BAD_REQUEST, "Invalid blockedUserId");
  }
  if (String(userId) === String(blockedUserId)) {
    throw new AppError(status.BAD_REQUEST, "You cannot block yourself");
  }
  const target = await users.exists({ _id: blockedUserId });
  if (!target) {
    throw new AppError(status.NOT_FOUND, "User not found");
  }

  const filter = {
    blockerId: new mongoose.Types.ObjectId(userId),
    blockedId: new mongoose.Types.ObjectId(blockedUserId),
  };
  const removed = await userblocks.findOneAndDelete(filter);
  const isBlock = !removed;
  if (isBlock) {
    await userblocks.updateOne(filter, { $setOnInsert: filter }, { upsert: true });
  }

  // keep the legacy flag on my follow record in sync for older app builds
  await followups.updateOne(
    { userId, followupId: blockedUserId },
    { $set: { isBlock } }
  );

  return {
    status: true,
    message: isBlock ? "Successfully blocked user" : "Successfully unblocked user",
    data: {
      userId,
      blockedUserId,
      isBlock,
    },
  };
};


// Users I have blocked (shape kept: { _id, followupId: { name, photo, email }, createdAt })
const getBlockedUsersIntoDb = async (userId: string) => {
  const blocks = await userblocks
    .find({ blockerId: new mongoose.Types.ObjectId(userId) })
    .sort({ createdAt: -1 })
    .populate("blockedId", "name photo email")
    .lean();

  const blockedUsers = blocks
    .filter((b: any) => b.blockedId)
    .map((b: any) => ({ _id: b._id, followupId: b.blockedId, createdAt: b.createdAt }));

  return {
    status: true,
    message: "Blocked users fetched successfully",
    data: blockedUsers,
  };
};


// Block status between the current user and ?userId=<other user>
const findBySpecificFollowingUserIntoDb = async (currentUserId: string, otherUserId?: string) => {
  if (!otherUserId || !mongoose.Types.ObjectId.isValid(otherUserId)) {
    throw new AppError(status.BAD_REQUEST, "Pass the other user's id as ?userId=");
  }
  const { isBlockedByMe, hasBlockedMe } = await getBlockStatus(currentUserId, otherUserId);
  return {
    isBlock: isBlockedByMe || hasBlockedMe,
    isBlockedByMe,
    hasBlockedMe,
  };
};





const FollowUpServices = {
  recordedFollowUpIntoDb,
  findByEventSocialFeedFolloweWiseFilteringIntoDb,
  findMyFollowedListIntoDb,
  myFollowingAndFollowerListIntoDb,
  sendInvitasationNotificationIntoDb,
  findMyFollowingListIntoDb,
  deleteFollowerListIntoDb,
  isBlockFollowerAndFollowingIntoDb,
  findBySpecificFollowingUserIntoDb,
  getBlockedUsersIntoDb,
  findByEventSocialFeedByIdIntoDb,
  getUserFollowersListIntoDb,
  getUserFollowingListIntoDb,
};

export default FollowUpServices;
