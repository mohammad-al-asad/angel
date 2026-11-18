import status from "http-status";
import AppError from "../../errors/AppError";
import socialfeedreports from "./socialfeedreport.model";
import eventposts from "../event_post/event_post.model";
import { TSocialFeedReport } from "./socialfeedreport.interface";
import QueryBuilder from "../../builder/QueryBuilder";
import { Types } from "mongoose";
import NotificationServices from "../notification/notification.services";
import { NotificationType } from "../notification/notification.constant";


const recordedSocialFeedReportIntoDb=async(userId:string, payload:TSocialFeedReport)=>{

      try{
        
        const isExistEventPost=await eventposts.exists({_id:payload.event_postId}).lean();
        if(!isExistEventPost){
            throw new AppError(status.NOT_FOUND,'not founded event post data')
        }
          const reportBuilder= new  socialfeedreports({ ...payload, userId});
          const  result=await reportBuilder.save();
          if(!result){
            throw new AppError(status.NOT_EXTENDED, 'issues by the social feed report6 recording section','')
          };
          return {
            status:true ,
            message:"successfully recorded"
          };

      }
      catch(error:any){
        if (error instanceof AppError) throw error;
        throw new AppError(status.SERVICE_UNAVAILABLE, 'ISSUES BY THE recorded Social FeedReport IntoDb')
      }
};


const findByAllSocialFeedReportIntoDb = async (query: Record<string, unknown>) => {
  try {
    const baseQuery = socialfeedreports
      .find({})
      .populate([
        {
          path: "userId",
          select: "name photo email phoneNumber",
        },
        {
          path: "event_postId",
          select: "userId", 
          populate: {
            path: "userId",
            select: "name photo email phoneNumber", 
          },
        },
      ]);

    const messagerQuery = new QueryBuilder(baseQuery, query)
      .search(["userId.name", "event_postId.userId.name reason"]) 
      .filter()
      .sort()
      .paginate()
      .fields();

    const allmessage = await messagerQuery.modelQuery;
    const meta = await messagerQuery.countTotal();

    return { meta, allmessage };
  } catch (error: any) {
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      "Error finding social feed reports",
      error,
    );
  }
};

const deleteSocialFeedReportIntoDb=async(id:string)=>{

       try{


        const isExist=await socialfeedreports.exists({_id:id}).lean();
        if(!isExist){
            throw new AppError(status.NOT_FOUND, 'not founded');
        };

         const result=await socialfeedreports.findByIdAndDelete(id);
         if(!result){
            throw new AppError(status.NOT_EXTENDED,'not extended social deed report section');
         };
         return {
            status:true ,
            message:"successfully delete"
         }

       }
       catch (error: any) {
    throw new AppError(
      status.INTERNAL_SERVER_ERROR,
      "Error delete Social Feed Report IntoDb",
      error,
    );
  }
}


// Admin reviews a report: update its status and tell the reporter
const updateSocialFeedReportStatusIntoDb = async (
  id: string,
  adminId: string,
  payload: { status: "under_review" | "resolved" | "dismissed"; adminNote?: string }
) => {
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError(status.BAD_REQUEST, "Invalid report id", "");
  }
  const existing: any = await socialfeedreports.findOne({ _id: id }).lean();
  if (!existing) {
    throw new AppError(status.NOT_FOUND, "Report not found", "");
  }

  const reviewed = payload.status !== "under_review";
  const update: Record<string, unknown> = {
    status: payload.status,
    reviewedAt: reviewed ? new Date() : null,
    reviewedBy: reviewed ? adminId : null,
  };
  if (payload.adminNote !== undefined) update.adminNote = payload.adminNote;

  const result = await socialfeedreports.findByIdAndUpdate(id, { $set: update }, { new: true });

  // Tell the reporter when the outcome changes to resolved / dismissed
  if (reviewed && (existing.status || "under_review") !== payload.status) {
    const outcome =
      payload.status === "resolved"
        ? "We reviewed your report and took action. Thank you for helping keep Thrillio safe."
        : "We reviewed your report and found it does not break our community guidelines.";
    try {
      await NotificationServices.createAndSendNotification({
        userId: new Types.ObjectId(String(existing.userId)),
        title: payload.status === "resolved" ? "Report resolved" : "Report reviewed",
        content: payload.adminNote ? `${outcome} Note: ${payload.adminNote}` : outcome,
        type: NotificationType.report_update,
        eventpostId: existing.event_postId,
      });
    } catch (notifyError: any) {
      console.error("Report status notification failed:", notifyError?.message || notifyError);
    }
  }

  return result;
};

// App: the reports the current user filed, newest first
const findMySocialFeedReportsIntoDb = async (userId: string, query: Record<string, unknown>) => {
  const reportQuery = new QueryBuilder(
    socialfeedreports
      .find({ userId })
      .select("event_postId reason details status adminNote reviewedAt createdAt")
      .populate({
        path: "event_postId",
        select: "caption content userId",
        populate: { path: "userId", select: "name photo" },
      }),
    query
  )
    .filter()
    .sort()
    .paginate()
    .fields();

  const reports = await reportQuery.modelQuery;
  const meta = await reportQuery.countTotal();
  return { meta, reports };
};

const socialFeedReportServices={
     recordedSocialFeedReportIntoDb,
     findByAllSocialFeedReportIntoDb,
     deleteSocialFeedReportIntoDb,
     updateSocialFeedReportStatusIntoDb,
     findMySocialFeedReportsIntoDb
};

export default socialFeedReportServices