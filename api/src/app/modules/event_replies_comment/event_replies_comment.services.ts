import status from "http-status";
import { getBlockRelationIds } from "../followup/block.helpers";
import AppError from "../../errors/AppError";
import { TReply } from "./event_replies_comment.interface";
import { commanteventposts } from "../react_event_post/react_event_post.model";
import replyeventposts from "./event_replies_comment.model";
import QueryBuilder from "../../builder/QueryBuilder";
import { Types } from "mongoose";
import eventposts from "../event_post/event_post.model";
import NotificationServices from "../notification/notification.services";
import { NotificationType } from "../notification/notification.constant";



const recordedEventRepliesCommentIntoDb=async(userId:string, payload:Partial<TReply>)=>{

       try{
        const parentComment=await commanteventposts.findOne({ _id:payload.commentEventPostId}).select("userId eventpostId").lean();
        if(!parentComment){
            throw new AppError(status.NOT_EXTENDED, 'comment ways this post not exist')
        };


        const   eventReplierBuilder= new replyeventposts({userId, ...payload});


        const result=await eventReplierBuilder.save();
        if(!result){
            throw new AppError(status.NOT_ACCEPTABLE, 'issues by the  reply event post');
        }

        // Notify the comment author (best-effort, never fails the reply)
        try {
          const post = await eventposts.findById(parentComment.eventpostId).select("eventId").lean();
          await NotificationServices.createAndSendNotification({
            userId: parentComment.userId,
            title: "Reply to Your Comment",
            content: "Someone replied to your comment.",
            type: NotificationType.comment_reply,
            eventpostId: parentComment.eventpostId,
            commentId: parentComment._id,
            replyId: result._id,
            eventId: post?.eventId,
            senderId: new Types.ObjectId(userId),
            priority: "medium",
          });
        } catch (notifyError: any) {
          console.error("Failed to create reply notification:", notifyError?.message || notifyError);
        }


        return {
           status:true ,
           message:"successfully recorded",
           data: { replyId: result._id }
        }

       }
       catch (error: any) {
           throw new AppError(
             status.SERVICE_UNAVAILABLE,
             "Server unavailable recorded Event Replies CommentIntoDb",
             ""
           );
         }
};


const findBySpecificEventCommentFilteringIntoDb = async (
  eventpostId: string,
  query: Record<string, unknown>,
  viewerId?: string
) => {
  try {
    const baseQuery = commanteventposts
      .find({ eventpostId, isDelete: false, userId: { $nin: viewerId ? await getBlockRelationIds(viewerId) : [] } }).populate({
            path: "userId",
            select: "name photo",
          })
      .select("-createdAt -updatedAt -isDelete")
      .lean();

    const commentQuery = new QueryBuilder(baseQuery, query)
      .search([])
      .filter()
      .sort()
      .paginate()
      .fields();

    const [all_comment_post, meta] = await Promise.all([
      commentQuery.modelQuery,
      commentQuery.countTotal(),
    ]);

    return { meta, all_comment_post };
  } catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Error while listing event comments",
      ""
    );
  }
};


const findBySpecificCommentReplyFilteringIntoDb=async(commentEventPostId:string, query: Record<string, unknown>, viewerId?: string )=>{

   try{

     const baseQuery = replyeventposts
      .find({ commentEventPostId, isDelete: false, userId: { $nin: viewerId ? await getBlockRelationIds(viewerId) : [] } }).populate([
            {
            path: "userId",
            select: "name photo",
          }
        
      ])
      .select("-createdAt -updatedAt -isDelete")
      .lean();

    const commentQuery = new QueryBuilder(baseQuery, query)
      .search([])
      .filter()
      .sort()
      .paginate()
      .fields();

    const [reply, meta] = await Promise.all([
      commentQuery.modelQuery,
      commentQuery.countTotal(),
    ]);
     return { meta, reply };

   }
   catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Error find By Specific Comment Reply Filtering IntoDb",
      ""
    );
  }

};




const deleteReplyIntoDb=async(id:string, userId:string)=>{

     try{

         const isExistReply=await replyeventposts.exists({_id:id, userId, isDelete:false}).lean();
         if(!isExistReply){
            throw new AppError(status.NOT_FOUND, 'not founded ')
         };
         const result=await replyeventposts.deleteOne({_id:id, userId, isDelete:false});
         if(!result){
            throw new AppError(status.NOT_EXTENDED, 'some issues by the reply delete section ','')
         };
         return {
            status:true,
            message:"successfully delete"
         }

     }
        catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "Error delete Reply IntoDb",
      ""
    );
  }
}





const eventRepliesCommentServices={
     recordedEventRepliesCommentIntoDb,
    findBySpecificEventCommentFilteringIntoDb,
    findBySpecificCommentReplyFilteringIntoDb,
     deleteReplyIntoDb
};

export default eventRepliesCommentServices;