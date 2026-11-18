/**
 * Demo data so a user has Ticket History and Event History to look at.
 *
 *   node scripts/seed-demo-history.js            # dry run (prints what would be created)
 *   node scripts/seed-demo-history.js --apply    # create
 *   node scripts/seed-demo-history.js --remove   # delete everything this script created
 *
 * Options: --user=<userId> (default khan saheb)  --host=<hostUserId> (default Durjoy Bannik)
 *
 * Every document gets `demoSeed: "<tag>"` so --remove only deletes demo data.
 * Each event is created the way the app does it: event + chat room + join group,
 * then the user is joined, and paid events get a paid payment (ticket).
 */
require('dotenv').config({ path: require('path').join(process.cwd(), '.env') });
require('node:dns').setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('mongoose');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const APPLY = process.argv.includes('--apply');
const REMOVE = process.argv.includes('--remove');
const USER_ID = arg('user', '6af043632c950c948c97d572'); // khan saheb
const HOST_ID = arg('host', '6af039992c950c948c97d206'); // Durjoy Bannik (host)
const TAG = `demo-history-${USER_ID}`;

const PHOTOS = [
  'https://res.cloudinary.com/dhxyjdrvr/image/upload/v1788171733/angel_app/2e33cd90-06c3-47c2-bfc7-a644ae9523f0_j7akpu.jpg',
  'https://res.cloudinary.com/dhxyjdrvr/image/upload/v1788179821/angel_app/498e3fbc-ef83-4b75-b49a-6d2dce6d86cb_k7sn8v.jpg',
  'https://res.cloudinary.com/dhxyjdrvr/image/upload/v1788320956/angel_app/a00b1607-24fb-4b42-a362-a5fbfbd29595_b8k42u.jpg',
  'https://res.cloudinary.com/dhxyjdrvr/image/upload/v1788325285/angel_app/5da1d46c-13b9-4a26-9984-b49fb470e3d3_yog32c.jpg',
  'https://res.cloudinary.com/dhxyjdrvr/image/upload/v1788327578/angel_app/ef7ffe19-dcac-43ec-8fcf-4c9a54d17f55_lgd95d.jpg',
];

// start (UTC ISO), duration in hours, price per ticket (0 = free), tickets bought, purchase date
const DEMO_EVENTS = [
  { title: 'Dhaka Jazz Night', category: 'Concerts', feature: 'Indoor', start: '2026-10-18T13:00:00.000Z', hours: 4, price: 25, tickets: 2, boughtAt: '2026-10-10T09:30:00.000Z', lat: '23.7937', lon: '90.4066', description: 'An evening of live jazz with local bands under the stars.' },
  { title: 'Rooftop Food Fest', category: 'Foot Festivals', feature: 'Pet Friendly', start: '2026-11-05T10:00:00.000Z', hours: 8, price: 15, tickets: 1, boughtAt: '2026-11-01T14:15:00.000Z', lat: '23.7808', lon: '90.4152', description: 'Street food stalls, desserts and music on a Gulshan rooftop.' },
  { title: 'Startup Mixer Dhaka', category: 'Neighborhood Events', feature: 'Wheelchair Accessible', start: '2026-10-27T11:00:00.000Z', hours: 3, price: 0, tickets: 0, boughtAt: '2026-10-20T08:00:00.000Z', lat: '23.7509', lon: '90.3934', description: 'Meet founders, designers and developers over coffee.' },
  { title: 'Sunset Boat Party', category: 'Parties', feature: 'Outdoor', start: '2026-12-06T11:30:00.000Z', hours: 5, price: 40, tickets: 2, boughtAt: '2026-11-09T16:45:00.000Z', lat: '23.7104', lon: '90.4074', description: 'Cruise the Buriganga at sunset with DJs and dinner.' },
  { title: 'Winter Music Carnival', category: 'Concerts', feature: 'Outdoor', start: '2026-12-20T12:00:00.000Z', hours: 6, price: 30, tickets: 3, boughtAt: '2026-11-10T10:20:00.000Z', lat: '23.8103', lon: '90.4125', description: 'Three stages, food trucks and a winter light show.' },
];

(async () => {
  await mongoose.connect(process.env.DATABASE_URL);
  const db = mongoose.connection.db;
  const { ObjectId } = mongoose.Types;
  const col = (n) => db.collection(n);

  if (REMOVE) {
    const groups = await col('joingroups').find({ demoSeed: TAG }).project({ _id: 1 }).toArray();
    const result = {};
    result.joinusers = (await col('joinusers').deleteMany({ $or: [{ demoSeed: TAG }, { eventGroupId: { $in: groups.map((g) => g._id) } }] })).deletedCount;
    for (const c of ['paymentgateways', 'joingroups', 'chatrooms', 'events']) {
      result[c] = (await col(c).deleteMany({ demoSeed: TAG })).deletedCount;
    }
    console.log('Removed demo data:', result);
    return;
  }

  const [user, host] = await Promise.all([
    col('users').findOne({ _id: new ObjectId(USER_ID) }, { projection: { name: 1, email: 1 } }),
    col('users').findOne({ _id: new ObjectId(HOST_ID) }, { projection: { name: 1, role: 1 } }),
  ]);
  if (!user) throw new Error(`User ${USER_ID} not found`);
  if (!host) throw new Error(`Host ${HOST_ID} not found`);

  const existing = await col('events').countDocuments({ demoSeed: TAG });
  if (existing) {
    console.log(`Demo data already exists for ${user.name} (${existing} events). Run with --remove first to recreate.`);
    return;
  }

  const now = new Date();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: demo history for ${user.name}, events hosted by ${host.name}`);

  for (const [i, d] of DEMO_EVENTS.entries()) {
    const start = new Date(d.start);
    const end = new Date(start.getTime() + d.hours * 3600e3);
    const paid = d.price > 0;
    const state = end < now ? 'ended' : 'upcoming';
    console.log(`  ${d.title.padEnd(22)} ${paid ? `$${d.price} x${d.tickets} = $${d.price * d.tickets}` : 'free'.padEnd(14)}  ${state}  ${start.toISOString().slice(0, 10)}`);
    if (!APPLY) continue;

    const eventId = new ObjectId();
    const chatRoomId = new ObjectId();
    const groupId = new ObjectId();
    const created = new Date(new Date(d.boughtAt).getTime() - 7 * 86400e3);
    const photo = PHOTOS[i % PHOTOS.length];
    const base = { demoSeed: TAG, isDelete: false, createdAt: created, updatedAt: created, __v: 0 };

    await col('events').insertOne({
      _id: eventId, hostId: host._id, event_title: d.title, description: d.description, photo,
      date: d.start.slice(0, 10), starting_time: start.toISOString(), ending_time: end.toISOString(),
      venue_facilities: [{ type: 'washroom', available: true, description: '' }],
      event_category: d.category, event_features: d.feature,
      audience_settings: {
        age: '18+', max_capacity: 200, visibility: 'Public',
        social_media: { content: true, gallery: true, sharing: true, streaming: false },
        notification: { livechat: true, push_notifications: true, event_countdown: true },
        ticket_point_value: paid ? 20 : 0, ticket_price: paid ? 'paid' : 'free',
        ...(paid ? { price: d.price } : {}),
        event_location: { lat: d.lat, lon: d.lon },
      },
      emailList: [], ...base,
    });
    await col('chatrooms').insertOne({ _id: chatRoomId, eventId, hostId: host._id, chatRoomName: d.title, totalMember: 1, photo, ...base });
    await col('joingroups').insertOne({ _id: groupId, eventId, hostId: host._id, groupName: d.title, totalMember: 1, chatRoomId, photo, ...base });

    const joinedAt = new Date(d.boughtAt);
    await col('joinusers').insertOne({ eventGroupId: groupId, userId: user._id, isJoin: true, demoSeed: TAG, isDelete: false, createdAt: joinedAt, updatedAt: joinedAt, __v: 0 });

    if (paid) {
      await col('paymentgateways').insertOne({
        userId: user._id, eventId, subscriptionId: eventId,
        sessionId: `demo_seed_${eventId}`, currency: 'usd', paymentmethod: 'card',
        price: d.price * d.tickets, ticketCount: d.tickets, description: 'ticket payment (demo)',
        payment_status: 'paid', payable_name: user.name, payable_email: user.email, country: 'BD',
        payment_intent: `demo_pi_${eventId}`, demoSeed: TAG, isDelete: false,
        createdAt: joinedAt, updatedAt: joinedAt, __v: 0,
      });
    }
  }

  if (!APPLY) console.log('Dry run only. Re-run with --apply to create.');
  else console.log(`Done. Remove later with: node scripts/seed-demo-history.js --remove --user=${USER_ID}`);
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
