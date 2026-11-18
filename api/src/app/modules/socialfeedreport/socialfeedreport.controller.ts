import { RequestHandler } from "express";
import catchAsync from "../../utils/asyncCatch";
import socialFeedReportServices from "./socialfeedreport.services";
import sendResponse from "../../utils/sendResponse";
import status from "http-status";



const  recordedSocialFeedReport:RequestHandler=catchAsync(async(req , res)=>{

       const result=await socialFeedReportServices.recordedSocialFeedReportIntoDb(req.user.id, req.body);
        sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Successfully Recorded ",
    data: result,
  });
});


const findByAllSocialFeedReport:RequestHandler=catchAsync(async(req , res)=>{

       const result=await socialFeedReportServices.findByAllSocialFeedReportIntoDb(req.query);
       sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Successfully  Find By All Report ",
    data: result,
  });
});


const  deleteSocialFeedReport:RequestHandler=catchAsync(async(req , res)=>{


    const result=await socialFeedReportServices.deleteSocialFeedReportIntoDb(req.params.id);
           sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Successfully  Delete ",
    data: result,
  });

      
});





const updateSocialFeedReportStatus:RequestHandler=catchAsync(async(req , res)=>{
  const result=await socialFeedReportServices.updateSocialFeedReportStatusIntoDb(req.params.id as string, req.user.id, req.body);
  sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Report status updated",
    data: result,
  });
});

const findMySocialFeedReports:RequestHandler=catchAsync(async(req , res)=>{
  const result=await socialFeedReportServices.findMySocialFeedReportsIntoDb(req.user.id, req.query);
  sendResponse(res, {
    success: true,
    statusCode: status.OK,
    message: "Successfully found my reports",
    data: result,
  });
});

const socialFeedReportController={
  recordedSocialFeedReport  ,
  findByAllSocialFeedReport,
  deleteSocialFeedReport,
  updateSocialFeedReportStatus,
  findMySocialFeedReports
};

export default socialFeedReportController;