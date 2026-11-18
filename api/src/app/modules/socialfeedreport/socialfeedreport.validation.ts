import { z } from "zod";


 const createSocialFeedReportZodSchema = z.object({
  body: z.object({
    event_postId: z.string({ error: "event_postId is required" }),
    reason: z
      .string({ error: "reason is required" })
      .min(3, "reason must be at least 3 characters long"),
    details: z.string().optional(),
  }),
});

 const updateSocialFeedReportZodSchema = z.object({
  body: z.object({
    reason: z.string().optional(),
    details: z.string().optional(),
    isDelete: z.boolean().optional(),
  }),
});


const updateSocialFeedReportStatusZodSchema = z.object({
  body: z.object({
    status: z.enum(["under_review", "resolved", "dismissed"], {
      error: "Status must be under_review, resolved or dismissed",
    }),
    adminNote: z.string().trim().max(500, "Note can be at most 500 characters").optional(),
  }),
});

const socialFeedReportValidation={
    createSocialFeedReportZodSchema,
    updateSocialFeedReportZodSchema,
    updateSocialFeedReportStatusZodSchema
};

export default socialFeedReportValidation;
