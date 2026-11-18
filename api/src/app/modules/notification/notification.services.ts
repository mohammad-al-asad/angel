
import { USER_ACCESSIBILITY } from "../user/user.constant";
import users from "../user/user.model";
import status from "http-status";
import firebaseAdmin from "../../config/firebase";
import AppError from "../../errors/AppError";
import notifications, { pushnotifications } from "./notification.model";
import QueryBuilder from "../../builder/QueryBuilder";
import { Types } from "mongoose";
import { TNotification } from "./notification.interface";
import { NotificationStatus } from "../followup/followup.constant";

// Fields sent in the FCM `data` payload so the app can open the right screen on tap.
const DEEP_LINK_FIELDS = [
  "type",
  "eventpostId",
  "commentId",
  "replyId",
  "eventId",
  "groupId",
  "senderId",
] as const;

// FCM `data` values must all be strings; drop empty values.
const toFcmData = (data: Record<string, unknown> = {}) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => [k, String(v)])
  ) as Record<string, string>;

const sendPushNotification = async (
  userId: string,
  data: {
    title: string;
    content: string;
    time?: Date;
    // extra deep-link data (type, eventpostId, commentId, notificationId, ...)
    data?: Record<string, unknown>;
  }
) => {
  try {
    const user = await users.findOne(
      {
        _id: userId,
        isVerify: true,
        isDelete: false,
        status: USER_ACCESSIBILITY.isProgress,
      },
      { fcm: 1 }
    );

    if (!user || !user.fcm) {
      throw new AppError(status.NOT_EXTENDED, "No FCM token found for user");
    }

    const timestamp = (data.time ?? new Date()).toISOString();

    const message = {
      notification: {
        title: data.title,
        body: data.content,
      },
      data: {
        ...toFcmData(data.data),
        userId: userId.toString(),
        timestamp,
      },
      token: user.fcm,
    };
   

    const response = await firebaseAdmin.messaging().send(message);
    console.log("✅ FCM Send Success:", response);
    return response;
  } catch (error: any) {
    console.error("🔥 FCM Error:", error);
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      "issues by the firebase notification section",
      error
    );
  }
};

/**
 * Save an in-app notification and send the matching push notification.
 * The push is best-effort: a missing FCM token or Firebase error is logged and
 * never breaks the action that triggered the notification.
 */
const createAndSendNotification = async (
  payload: Partial<TNotification> & { userId: Types.ObjectId | string; title: string; content: string },
) => {
  if (payload.senderId && payload.senderId.toString() === payload.userId.toString()) {
    return null; // don't notify users about their own actions
  }

  const saved = await notifications.create(payload);

  try {
    await sendPushNotification(payload.userId.toString(), {
      title: payload.title,
      content: payload.content,
      data: {
        notificationId: saved._id,
        ...Object.fromEntries(DEEP_LINK_FIELDS.map((k) => [k, (saved as any)[k]])),
      },
    });
  } catch (error: any) {
    console.error(`Push notification failed for ${payload.userId}:`, error?.message || error);
  }

  return saved;
};

const specificUserNotificationListIntoDb = async (
  userId: string,
  query: Record<string, unknown>,
) => {
  try {
    const allNotificationQuery = new QueryBuilder(
      notifications
        .find({ userId }).populate([
          {
            path: "senderId",
            select: "photo name ",
          },
          
        ])
        .select('title content status createdAt groupId type eventpostId commentId replyId eventId'),

      query,
    )
      .filter()
      .sort()
      .paginate()
      .fields();

    const driverNotification = await allNotificationQuery.modelQuery;
    const meta = await allNotificationQuery.countTotal();

    return { meta, driverNotification };
  } catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      'speciifc driver notification  server unavailable issues',
      error,
    );
  }
};

const findByUserNotificationIntoDb=async(userId:string)=>{

    try{

      return await users.findById(userId).select("pushNotification " );

    }
    catch (error: any) {
    throw new AppError(
      status.SERVICE_UNAVAILABLE,
      'speciifc driver notification  server unavailable issues',
      error,
    );
  }
}

const changeNotificationStatusIntoDb = async (
  userId: string,
  notificationId: string
) => {

  const user = await users.findOne(
    { _id: userId, "pushNotification._id": notificationId },
    { "pushNotification.$": 1 }
  ) as any;

  if (!user) {
    throw new Error("Notification not found");
  }

  const current = user.pushNotification[0].isNotification;

  const result = await users.findOneAndUpdate(
    {
      _id: userId,
      "pushNotification._id": notificationId,
    },
    {
      $set: {
        "pushNotification.$.isNotification": !current,   
      }
    },
    { new: true }
  );

  if (!result) {
    throw new AppError(status.NOT_EXTENDED,'issue updating notification');
  }

  return {
    status: true,
    message: "Successfully changed status"
  };
};
















// Mark one of the user's notifications as read (e.g. when it is tapped)
const markNotificationAsReadIntoDb = async (userId: string, notificationId: string) => {
  const result = await notifications.findOneAndUpdate(
    { _id: notificationId, userId, isDelete: { $ne: true } },
    { $set: { status: NotificationStatus.read } },
    { new: true },
  ).select('title content status createdAt groupId type eventpostId commentId replyId eventId');

  if (!result) {
    throw new AppError(status.NOT_FOUND, 'Notification not found');
  }
  return result;
};

const markAllNotificationsAsReadIntoDb = async (userId: string) => {
  const result = await notifications.updateMany(
    { userId, status: NotificationStatus.unread, isDelete: { $ne: true } },
    { $set: { status: NotificationStatus.read } },
  );
  return { status: true, updated: result.modifiedCount };
};

const NotificationServices = {
  sendPushNotification,
  createAndSendNotification,
  specificUserNotificationListIntoDb,
  findByUserNotificationIntoDb,
  changeNotificationStatusIntoDb,
  markNotificationAsReadIntoDb,
  markAllNotificationsAsReadIntoDb,
};

export default NotificationServices;
