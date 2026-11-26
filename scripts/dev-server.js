#!/usr/bin/env node
'use strict';
/**
 * Local preview with made-up data. Nothing is read from or written to Firebase,
 * and no real Garmin / Withings / MyFitnessPal account is contacted successfully.
 *
 *   cd functions && npm install && cd ..
 *   node scripts/dev-server.js
 *
 * Owner view:   http://localhost:5174/#k=dev-owner
 * Trainer view: the link shown under Settings in the owner view
 */
process.env.MEMORY_STORE = '1';
process.env.OWNER_KEY = process.env.OWNER_KEY || 'dev-owner';
process.env.DISPLAY_NAME = process.env.DISPLAY_NAME || 'Sample training log';
process.env.PUBLIC_URL = process.env.PUBLIC_URL || 'http://localhost:5174';

const path = require('node:path');
const zlib = require('node:zlib');
const fn = (p) => path.join(__dirname, '..', 'functions', p);
const express = require(fn('node_modules/express'));
const store = require(fn('src/store'));
const { today, addDays } = require(fn('src/dates'));
const app = require(fn('src/app'));

/** A plain two-tone PNG so the photo grid has something to show. */
function samplePng(top, bottom, w = 300, h = 400) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[row + 1 + x * 3 + c] = Math.round(top[c] + (bottom[c] - top[c]) * t);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function seed() {
  let r = 42;
  const rand = () => ((r = (r * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const end = today();
  const kinds = [['Strength', 'strength_training'], ['Easy run', 'running'], ['Intervals', 'running'], ['Bike', 'cycling']];
  for (let i = 89; i >= 0; i--) {
    const date = addDays(end, -i);
    const day = { date, steps: Math.round(6500 + rand() * 7000), stepGoal: 10000, distanceM: 6000 };
    if (rand() > 0.12) { day.weightKg = Math.round((84.5 - (89 - i) * 0.035 + (rand() - 0.5) * 0.9) * 10) / 10; day.fatPct = Math.round((21 - (89 - i) * 0.02 + rand() * 0.4) * 10) / 10; }
    if (rand() > 0.08) {
      const deepS = Math.round(3600 + rand() * 3000), remS = Math.round(4000 + rand() * 3000), lightS = Math.round(11000 + rand() * 5000);
      day.sleep = { durationS: deepS + remS + lightS, deepS, remS, lightS, awakeS: 1500, score: Math.round(65 + rand() * 30) };
    }
    if (rand() > 0.1 && i > 0) {
      const protein = Math.round(140 + rand() * 50), carbs = Math.round(170 + rand() * 110), fat = Math.round(55 + rand() * 35);
      day.macros = { kcal: protein * 4 + carbs * 4 + fat * 9, protein, carbs, fat, source: 'mfp' };
    }
    await store.set('days', date, day);
    if (rand() > 0.55) {
      const [name, type] = kinds[Math.floor(rand() * kinds.length)];
      const durationS = Math.round(1800 + rand() * 3000);
      await store.set('activities', `garmin-${1000 + i}`, { date, startLocal: `${date} 07:10:00`, name, type, durationS, distanceM: type === 'strength_training' ? null : Math.round(durationS * 2.8), kcal: Math.round(durationS / 7), avgHr: Math.round(120 + rand() * 35), maxHr: 172, source: 'garmin' });
    }
  }
  const photo = async (id, date, kind, pose, uploadedBy, colours, note = '') => {
    const p = `photos/${id}.png`;
    await store.saveFile(p, samplePng(...colours), 'image/png');
    await store.set('photos', id, { date, kind, pose, note, path: p, contentType: 'image/png', size: 1, uploadedBy, createdAt: Date.now() });
  };
  await photo('s1', addDays(end, -84), 'progress', 'front', 'owner', [[70, 80, 110], [30, 34, 48]]);
  await photo('s2', addDays(end, -84), 'progress', 'side', 'owner', [[80, 70, 110], [34, 30, 48]]);
  await photo('s3', addDays(end, -28), 'progress', 'front', 'trainer', [[60, 105, 110], [26, 44, 48]], 'Taken after the session');
  await photo('s4', addDays(end, -1), 'progress', 'front', 'owner', [[60, 110, 90], [26, 48, 38]]);
  await photo('s5', addDays(end, -1), 'meal', null, 'owner', [[150, 110, 60], [60, 44, 26]], 'Chicken, rice, greens');
  await photo('s6', end, 'meal', null, 'owner', [[150, 90, 70], [60, 36, 28]]);
  const now = Date.now();
  await store.set('private', 'state', { lastSyncAt: now - 40 * 60000 });
  await store.set('private', 'connections', {
    garmin: { tokens: { oauth1: { oauth_token: 'x', oauth_token_secret: 'x' }, oauth2: { access_token: 'x' } }, status: 'ok', lastSyncAt: now, lastOkAt: now },
    withings: { refreshToken: 'x', accessToken: 'x', expiresAt: now + 3600e3, status: 'ok', lastSyncAt: now, lastOkAt: now },
    mfp: { username: 'sample', cookie: '', status: 'needs_login', message: 'MyFitnessPal would not show the diary. Set your diary to Public, or paste your session cookie.', lastSyncAt: now, lastOkAt: now - 3 * 864e5 },
  });
}

const server = express();
server.use(app);
server.use(express.static(path.join(__dirname, '..', 'public')));
const port = Number(process.env.PORT) || 5174;
seed().then(() => server.listen(port, () => console.log(`Preview with sample data: http://localhost:${port}/#k=${process.env.OWNER_KEY}`)));
