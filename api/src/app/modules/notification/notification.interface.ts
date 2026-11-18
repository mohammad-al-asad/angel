import { Model, Types } from 'mongoose';
import { TNotificationType } from './notification.constant';

export interface TNotification {
  userId?: Types.ObjectId;
  driverId?: Types.ObjectId;
  requestId?:Types.ObjectId;
  title: String;
  content: String;
  icon?: String;
  status: 'unread' | 'read';
  route?: String;
  priority: 'low' | 'medium' | 'high';
       senderId: Types.ObjectId;
     groupId?: Types.ObjectId;
  type?: TNotificationType;
  eventpostId?: Types.ObjectId;
  commentId?: Types.ObjectId;
  replyId?: Types.ObjectId;
  eventId?: Types.ObjectId;
  isDelete: Boolean
};


export interface TPushNotification {
  title:String;
  isNotification?: Boolean;


}

export interface NotificationResponse {
  status: boolean;
  message: string;
}

export interface NotificationModel extends Model<TNotification> {
  // eslint-disable-next-line no-unused-vars
  isNotification(id: string): Promise<TNotification>;
}



