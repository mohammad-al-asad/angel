/**
 * Copies existing blocks (followups.isBlock = true) into the `userblocks` collection.
 *
 *   node scripts/migrate-blocks-to-userblocks.js           # dry run
 *   node scripts/migrate-blocks-to-userblocks.js --apply   # write
 *
 * Safe to re-run (upserts on blockerId + blockedId). Does not modify followups.
 */
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  await mongoose.connect(process.env.DATABASE_URL);
  const db = mongoose.connection.db;

  const legacy = await db
    .collection('followups')
    .find({ isBlock: true, isDelete: { $ne: true } })
    .project({ userId: 1, followupId: 1 })
    .toArray();

  const pairs = legacy
    .filter((f) => f.userId && f.followupId && String(f.userId) !== String(f.followupId))
    .map((f) => ({ blockerId: f.userId, blockedId: f.followupId }));

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${pairs.length} legacy blocks found`);
  pairs.forEach((p) => console.log(`  ${p.blockerId} blocked ${p.blockedId}`));

  if (!APPLY || !pairs.length) {
    if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
    return;
  }

  const blocks = db.collection('userblocks');
  await blocks.createIndex({ blockerId: 1, blockedId: 1 }, { unique: true });
  const now = new Date();
  const result = await blocks.bulkWrite(
    pairs.map((p) => ({
      updateOne: {
        filter: p,
        update: { $setOnInsert: { ...p, createdAt: now, updatedAt: now } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
  console.log(`Inserted ${result.upsertedCount}, already present ${pairs.length - result.upsertedCount}.`);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
