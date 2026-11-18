import { Schema, model, Model, Types } from "mongoose";
import { SocialFeedReportModel, TSocialFeedReport } from "./socialfeedreport.interface";


const TSocialFeedReportSchema = new Schema<TSocialFeedReport>(
  {
    userId: {
      type:  Schema.Types.ObjectId,
      ref: "users", 
      required: true,
      index:true
    },
    event_postId: {
      type:  Schema.Types.ObjectId,
      ref: "eventposts", 
      required: true,
      index:true
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    details: {
      type: String,
      required: false,
      trim: true,
    },
    // Review state set by admins in the dashboard
    status: {
      type: String,
      enum: ["under_review", "resolved", "dismissed"],
      default: "under_review",
      index: true,
    },
    adminNote: { type: String, trim: true, maxlength: 500 },
    reviewedAt: { type: Date },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "users" },
    isDelete: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true, 
  }
);


// middlewere
TSocialFeedReportSchema.pre('find', function (next) {
  this.find({ isDelete: { $ne: true } });
  next();
});

TSocialFeedReportSchema.pre('aggregate', function (next) {
  this.pipeline().unshift({ $match: { isDelete: { $ne: true } } });
  next();
});

TSocialFeedReportSchema.pre('findOne', function (next) {
  this.findOne({ isDelete: { $ne: true } });
  next();
});




TSocialFeedReportSchema.statics.isSocialFeedReportCustomId = async function (
  id: string
) {
  const report = await this.findById(id);
  return report;
};

const socialfeedreports = model<TSocialFeedReport, SocialFeedReportModel>(
  "socialfeedreports",
  TSocialFeedReportSchema
);

export default socialfeedreports;
