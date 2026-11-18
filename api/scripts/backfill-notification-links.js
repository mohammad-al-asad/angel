/**
 * Backfills deep-link fields (type, eventpostId, commentId, eventId) on notifications
 * created before notifications carried them, so old notifications become clickable.
 *
 *   node scripts/backfill-notification-links.js            # dry run (no writes)
 *   node scripts/backfill-notification-links.js --apply    # write changes
 *
 * Every document that will be modified is first saved to backups/ so the change can be reverted.
 * Safe to re-run: only notifications without a `type` are touched.
 *
 * Matching for old "Comment on Your Event Post" notifications: the comment and its notification
 * were created in the same request, so we take the commenter's (senderId) comment created just
 * before the notification, preferring one on a post owned by the notified user. If no comment is
 * found but groupId points at an event post (old clients sent the post id there), we link the post.
 */
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const MATCH_WINDOW_BEFORE_MS = 15_000; // comment saved up to 15s before its notification
const MATCH_WINDOW_AFTER_MS = 2_000;

const COMMENT_TITLE = 'Comment on Your Event Post';
const INVITE_PATTERN = / invited you to join group /;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await mongoose.connect(process.env.DATABASE_URL);
  const db = mongoose.connection.db;
  const notifications = db.collection('notifications');
  const comments = db.collection('commanteventposts');
  const posts = db.collection('eventposts');

  const pending = await notifications.find({ type: { $exists: false } }).sort({ createdAt: 1 }).toArray();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${pending.length} notifications without a type`);

  const postCache = new Map();
  const getPost = async (id) => {
    if (!id) return null;
    const key = id.toString();
    if (!postCache.has(key)) postCache.set(key, await posts.findOne({ _id: id }, { projection: { userId: 1, eventId: 1 } }));
    return postCache.get(key);
  };

  const usedComments = new Set();
  const updates = [];
  const stats = { comment_exact: 0, comment_post_only: 0, comment_unmatched: 0, group_invitation: 0, general: 0 };
  const unmatched = [];

  for (const n of pending) {
    let set;

    if (n.title === COMMENT_TITLE) {
      set = { type: 'event_post_comment' };
      let match = null;

      if (n.senderId && n.createdAt) {
        const created = new Date(n.createdAt).getTime();
        const candidates = await comments
          .find({
            userId: n.senderId,
            createdAt: { $gte: new Date(created - MATCH_WINDOW_BEFORE_MS), $lte: new Date(created + MATCH_WINDOW_AFTER_MS) },
          })
          .toArray();

        const scored = [];
        for (const c of candidates) {
          if (usedComments.has(c._id.toString())) continue;
          const post = await getPost(c.eventpostId);
          const ownerMatches = post && n.userId && post.userId?.toString() === n.userId.toString();
          const groupMatches = n.groupId && c.eventpostId?.toString() === n.groupId.toString();
          scored.push({ c, post, rank: (ownerMatches ? 0 : 2) + (groupMatches ? 0 : 1), dt: Math.abs(created - new Date(c.createdAt).getTime()) });
        }
        scored.sort((a, b) => a.rank - b.rank || a.dt - b.dt);
        // require the post owner to be the notified user, otherwise it's not the right comment
        if (scored.length && scored[0].rank < 2) match = scored[0];
      }

      if (match) {
        usedComments.add(match.c._id.toString());
        Object.assign(set, { eventpostId: match.c.eventpostId, commentId: match.c._id });
        if (match.post?.eventId) set.eventId = match.post.eventId;
        stats.comment_exact++;
      } else {
        const post = await getPost(n.groupId);
        if (post) {
          set.eventpostId = post._id;
          if (post.eventId) set.eventId = post.eventId;
          stats.comment_post_only++;
        } else {
          stats.comment_unmatched++;
          unmatched.push(n._id.toString());
        }
      }
    } else if (INVITE_PATTERN.test(n.title || '') && n.groupId) {
      set = { type: 'group_invitation' };
      stats.group_invitation++;
    } else {
      set = { type: 'general' };
      stats.general++;
    }

    updates.push({ doc: n, set });
  }

  console.log('Summary:', stats);
  if (unmatched.length) console.log('Comment notifications with no post found (type set, no link):', unmatched);
  for (const u of updates.slice(0, 5)) console.log('  e.g.', u.doc._id.toString(), '->', JSON.stringify(u.set));

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write these changes.');
    return;
  }
  if (!updates.length) return;

  const backupDir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `notifications-before-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(updates.map((u) => u.doc), null, 2));
  console.log(`Backed up ${updates.length} documents to ${path.relative(process.cwd(), backupFile)}`);

  const result = await notifications.bulkWrite(
    updates.map(({ doc, set }) => ({
      updateOne: { filter: { _id: doc._id, type: { $exists: false } }, update: { $set: set } },
    })),
    { ordered: false },
  );
  console.log(`Updated ${result.modifiedCount} notifications.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
