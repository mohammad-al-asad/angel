import { model, Schema, Types } from "mongoose";

// One document per block: `blockerId` has blocked `blockedId`.
// Stored separately from follow records so a block survives unfollow/refollow and
// does not require the users to follow each other.
export interface TUserBlock {
  blockerId: Types.ObjectId;
  blockedId: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const UserBlockSchema = new Schema<TUserBlock>(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: "users", required: true, index: true },
    blockedId: { type: Schema.Types.ObjectId, ref: "users", required: true, index: true },
  },
  { timestamps: true, versionKey: false }
);

UserBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

const userblocks = model<TUserBlock>("userblocks", UserBlockSchema);

export default userblocks;
