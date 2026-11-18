import mongoose, { Types } from "mongoose";
import status from "http-status";
import AppError from "../../errors/AppError";
import eventposts from "../event_post/event_post.model";
import { shareeventcomments } from "../react_event_post/react_event_post.model";
import { getBlockRelationIds } from "../followup/block.helpers";

/**
 * Posts shared inside chat messages.
 *
 * A message stores only `sharedPostId`. Whenever messages are returned (REST or socket),
 * `attachSharedPosts` adds a ready-to-render `sharedPost` preview, so the app shows the
 * post card directly instead of a link. The preview is built per viewer: a post that was
 * deleted, or whose author is blocked by/blocks the viewer, comes back as
 * `{ _id, isAvailable: false }`.
 */

export type SharedPostPreview =
  | {
      _id: Types.ObjectId;
      isAvailable: true;
      caption: string;
      content: string; // media url (image / video)
      eventId: Types.ObjectId | null;
      react: number;
      comment: number;
      share: number;
      createdAt: Date;
      author: { _id: Types.ObjectId; name: string; photo?: string } | null;
    }
  | { _id: Types.ObjectId; isAvailable: false };

/** Validate a post before it is shared in a message. Throws 400/404/403. */
export const assertPostShareable = async (senderId: string, sharedPostId: string) => {
  if (!mongoose.Types.ObjectId.isValid(sharedPostId)) {
    throw new AppError(status.BAD_REQUEST, "Invalid sharedPostId");
  }
  const post = await eventposts
    .findOne({ _id: sharedPostId, isDelete: { $ne: true } })
    .select("userId")
    .lean();
  if (!post) {
    throw new AppError(status.NOT_FOUND, "Post not found");
  }
  const hidden = new Set((await getBlockRelationIds(senderId)).map(String));
  if (post.userId && hidden.has(String(post.userId))) {
    throw new AppError(status.FORBIDDEN, "This post can't be shared");
  }
  return post;
};

/** Count a chat share like the existing share button does. Best-effort. */
export const recordPostShare = async (userId: string, sharedPostId: string) => {
  try {
    await Promise.all([
      shareeventcomments.create({
        eventpostId: new Types.ObjectId(sharedPostId),
        userId: new Types.ObjectId(userId),
        share: 1,
        isDelete: false,
      }),
      eventposts.updateOne({ _id: sharedPostId }, { $inc: { share: 1 } }),
    ]);
  } catch (error: any) {
    console.error("Failed to record post share:", error?.message || error);
  }
};

/**
 * Return plain message objects with `sharedPost` added for messages that have `sharedPostId`.
 * Works with mongoose documents or lean objects; messages without a shared post are unchanged.
 */
export const attachSharedPosts = async <T>(viewerId: string | undefined, msgs: T[]): Promise<any[]> => {
  const plain = (msgs || []).map((m: any) => (m && typeof m.toObject === "function" ? m.toObject() : m));

  const ids = [
    ...new Set(
      plain
        .map((m: any) => m?.sharedPostId)
        .filter((id: any) => id && mongoose.Types.ObjectId.isValid(String(id)))
        .map(String)
    ),
  ];
  if (!ids.length) return plain;

  const [posts, hiddenIds] = await Promise.all([
    eventposts
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) }, isDelete: { $ne: true } })
      .select("userId caption content eventId react comment share createdAt")
      .populate({ path: "userId", select: "name photo" })
      .lean(),
    viewerId ? getBlockRelationIds(viewerId) : Promise.resolve([] as Types.ObjectId[]),
  ]);

  const hidden = new Set(hiddenIds.map(String));
  const byId = new Map<string, SharedPostPreview>();
  for (const p of posts as any[]) {
    const author = p.userId && typeof p.userId === "object" ? p.userId : null;
    if (author && hidden.has(String(author._id))) continue; // blocked -> unavailable
    byId.set(String(p._id), {
      _id: p._id,
      isAvailable: true,
      caption: p.caption || "",
      content: p.content || "",
      eventId: p.eventId || null,
      react: p.react || 0,
      comment: p.comment || 0,
      share: p.share || 0,
      createdAt: p.createdAt,
      author: author ? { _id: author._id, name: author.name, photo: author.photo } : null,
    });
  }

  return plain.map((m: any) => {
    if (!m?.sharedPostId) return m;
    const key = String(m.sharedPostId);
    return {
      ...m,
      sharedPost: byId.get(key) || { _id: m.sharedPostId, isAvailable: false },
    };
  });
};

/** Single-message convenience wrapper. */
export const attachSharedPost = async (viewerId: string | undefined, msg: any) => {
  if (!msg) return msg;
  const [withPost] = await attachSharedPosts(viewerId, [msg]);
  return withPost;
};
