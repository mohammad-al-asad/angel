import { Types } from "mongoose";
import status from "http-status";
import AppError from "../../errors/AppError";
import userblocks from "./user_block.model";

const toObjectId = (id: string | Types.ObjectId) => new Types.ObjectId(String(id));

/** Users hidden from `userId`: everyone they blocked plus everyone who blocked them. */
export const getBlockRelationIds = async (userId: string | Types.ObjectId): Promise<Types.ObjectId[]> => {
  const me = toObjectId(userId);
  const rows = await userblocks
    .find({ $or: [{ blockerId: me }, { blockedId: me }] })
    .select("blockerId blockedId")
    .lean();

  const ids = new Map<string, Types.ObjectId>();
  for (const row of rows) {
    const other = String(row.blockerId) === String(me) ? row.blockedId : row.blockerId;
    ids.set(String(other), other as Types.ObjectId);
  }
  return [...ids.values()];
};

/** Block state between the viewer and another user, in both directions. */
export const getBlockStatus = async (viewerId: string, otherUserId: string) => {
  const [blockedByMe, blockedMe] = await Promise.all([
    userblocks.exists({ blockerId: toObjectId(viewerId), blockedId: toObjectId(otherUserId) }),
    userblocks.exists({ blockerId: toObjectId(otherUserId), blockedId: toObjectId(viewerId) }),
  ]);
  return { isBlockedByMe: !!blockedByMe, hasBlockedMe: !!blockedMe };
};

/** Throws 403 when either user has blocked the other. */
export const assertNotBlocked = async (viewerId: string, otherUserId: string) => {
  if (String(viewerId) === String(otherUserId)) return;
  const { isBlockedByMe, hasBlockedMe } = await getBlockStatus(viewerId, otherUserId);
  if (isBlockedByMe || hasBlockedMe) {
    throw new AppError(status.FORBIDDEN, "User not available");
  }
};
