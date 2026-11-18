import { z } from 'zod';


const messageSchema = z.object({
  body: z.object({
    text: z.string().trim().optional(),
    imageUrl: z.array(z.string()).optional(),
     storyUrl: z.string().optional(),
    eventId: z.string().optional(),
    audioUrl: z.string().optional(),
    sharedPostId: z.string().optional(),
    receiverId: z.string({ error: "receiverId is required" }),
    
  })
  .superRefine((data, ctx) => {
    if (
      !data.text?.trim() &&
      (!data.imageUrl || data.imageUrl.length === 0) &&
      !data.audioUrl?.trim() &&
      !data.sharedPostId?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Either text, imageUrl, audioUrl or sharedPostId is required",
        path: ["text"],
      });
    }
  })
  .strict()
});


const messageUpdateSchema = z.object({
  body: z.object({
    text: z.string().min(1, 'Text is required').optional(),
  }),
});

const MessageValidationSchema = {
  messageSchema,
  messageUpdateSchema
};

export default MessageValidationSchema;