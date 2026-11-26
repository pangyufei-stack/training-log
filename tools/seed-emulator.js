#!/usr/bin/env node
'use strict';
/**
 * Fills the local Firestore emulator with sample data for previewing the page.
 *   firebase emulators:start --project demo-training-log
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/seed-emulator.js
 * Owner view: http://localhost:5000/#k=dev-owner-key-0000000000000000000000
 */
process.env.FIREBASE_PROJECT_ID = 'demo-training-log';
if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('Set FIRESTORE_EMULATOR_HOST; this must never run against the real project.'); process.exit(1); }
const path = require('node:path');
const zlib = require('node:zlib');
const store = require(path.join(__dirname, '..', 'sync', 'src', 'store'));
const { today, addDays } = require(path.join(__dirname, '..', 'sync', 'src', 'dates'));

function png(top, bottom, w, hgt) {
  const raw = Buffer.alloc((w * 3 + 1) * hgt);
  for (let y = 0; y < hgt; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(top[c] + (bottom[c] - top[c]) * (y / (hgt - 1)));
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body)); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(hgt, 4); ihdr[8] = 8; ihdr[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

(async () => {
  let r = 42;
  const rand = () => ((r = (r * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const end = today();
  await store.set('config', 'keys', { ownerKey: 'dev-owner-key-0000000000000000000000', trainerKey: 'dev-trainer-key-00000000000000000000' }, { merge: false });
  await store.set('meta', 'public', { displayName: 'Sample training log', timezone: 'Asia/Singapore', githubRepo: 'example/training-log', lastSyncAt: Date.now() - 40 * 60000 });
  const kinds = [['Strength', 'strength_training'], ['Easy run', 'running'], ['Intervals', 'running'], ['Bike', 'cycling']];
  const days = [], acts = [];
  for (let i = 89; i >= 0; i--) {
    const date = addDays(end, -i);
    const day = { date, steps: Math.round(6500 + rand() * 7000), stepGoal: 10000 };
    if (rand() > 0.12) { day.weightKg = Math.round((84.5 - (89 - i) * 0.035 + (rand() - 0.5) * 0.9) * 10) / 10; day.fatPct = Math.round((21 - (89 - i) * 0.02) * 10) / 10; }
    if (rand() > 0.08) { const deepS = Math.round(3600 + rand() * 3000), remS = Math.round(4000 + rand() * 3000), lightS = Math.round(11000 + rand() * 5000); day.sleep = { durationS: deepS + remS + lightS, deepS, remS, lightS, awakeS: 1500, score: Math.round(65 + rand() * 30) }; }
    if (rand() > 0.1 && i > 0) { const protein = Math.round(140 + rand() * 50), carbs = Math.round(170 + rand() * 110), fat = Math.round(55 + rand() * 35); day.macros = { kcal: protein * 4 + carbs * 4 + fat * 9, protein, carbs, fat, source: 'mfp' }; }
    days.push([date, day]);
    if (rand() > 0.55) { const [name, type] = kinds[Math.floor(rand() * kinds.length)]; const durationS = Math.round(1800 + rand() * 3000); acts.push([`garmin-${1000 + i}`, { date, startLocal: `${date} 07:10:00`, name, type, durationS, distanceM: type === 'strength_training' ? null : Math.round(durationS * 2.8), kcal: Math.round(durationS / 7), avgHr: Math.round(120 + rand() * 35), source: 'garmin' }]); }
  }
  await store.setMany('days', days);
  await store.setMany('activities', acts);
  const photo = async (id, date, kind, pose, uploadedBy, colours) => {
    await store.set('photoFiles', id, { data: png(...colours, 600, 800) });
    await store.set('photos', id, { date, kind, pose, note: '', thumb: png(...colours, 120, 160), uploadedBy, createdAt: new Date() });
  };
  await photo('s1', addDays(end, -84), 'progress', 'front', 'owner', [[70, 80, 110], [30, 34, 48]]);
  await photo('s3', addDays(end, -28), 'progress', 'front', 'trainer', [[60, 105, 110], [26, 44, 48]]);
  await photo('s4', addDays(end, -1), 'progress', 'front', 'owner', [[60, 110, 90], [26, 48, 38]]);
  await photo('s5', addDays(end, -1), 'meal', null, 'owner', [[150, 110, 60], [60, 44, 26]]);
  const now = Date.now();
  await store.set('private', 'status', {
    garmin: { connected: true, status: 'ok', message: '', lastSyncAt: now, lastOkAt: now },
    withings: { connected: true, status: 'ok', message: '', lastSyncAt: now, lastOkAt: now },
    mfp: { connected: false, status: 'not_connected', message: '' },
  });
  await store.set('private', 'connections', { garmin: { tokens: { oauth1: { oauth_token: 'secret-token', oauth_token_secret: 's' }, oauth2: { access_token: 'secret' } } } });
  console.log('Seeded. Owner: #k=dev-owner-key-0000000000000000000000  Trainer: #k=dev-trainer-key-00000000000000000000');
  process.exit(0);
})();
