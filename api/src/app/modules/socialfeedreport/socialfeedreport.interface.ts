import { Model, Types } from "mongoose";



export interface TSocialFeedReport {
    userId:Types.ObjectId;
    event_postId:Types.ObjectId;
    reason:string;
    details:string;
    status?: "under_review" | "resolved" | "dismissed";
    adminNote?: string;
    reviewedAt?: Date;
    reviewedBy?: Types.ObjectId;
    isDelete:boolean;
};

export interface SocialFeedReportModel extends Model<TSocialFeedReport> {
  isSocialFeedReportCustomId(id: string): Promise<TSocialFeedReport>;
};



