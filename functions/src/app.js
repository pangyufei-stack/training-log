'use strict';
const crypto = require('node:crypto');
const express = require('express');
const store = require('./store');
const { requireAuth, requireOwner, getTrainerKey, rotateTrainerKey, newKey } = require('./auth');
const { runSync, getStatuses, NAMES } = require('./sync');
const { TZ, today, addDays, isIsoDate } = require('./dates');
const garmin = require('./sources/garmin');
const withings = require('./sources/withings');

const app = express();
app.disable('x-powered-by');
// On Cloud Functions the body is already parsed; these only do work in local preview.
app.use(express.json({ limit: '1mb' }));
app.use(express.raw({ type: 'image/*', limit: '10mb' }));
app.use((req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

const api = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (message) => new HttpError(400, message);

function publicUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `https://${host}`;
}

// ---------- Withings sign-in return trip (no key in the request; checked by one-time state) ----------
api.get('/withings/callback', wrap(async (req, res) => {
  const { code, state } = req.query;
  const saved = await store.get('private', 'oauthState');
  await store.del('private', 'oauthState');
  const fresh = saved && Date.now() - saved.createdAt < 10 * 60 * 1000;
  if (!code || !state || !fresh || saved.state !== state) return res.redirect('/?withings=failed');
  try {
    const auth = await withings.exchangeCode(String(code), `${publicUrl(req)}/api/withings/callback`);
    await store.set('private', 'connections', { withings: { ...auth, status: 'pending', message: '' } });
    res.redirect('/?withings=connected');
  } catch (e) {
    console.error('withings callback failed:', e.message);
    res.redirect('/?withings=failed');
  }
}));

api.use(requireAuth);

// ---------- Reading ----------
api.get('/me', wrap(async (req, res) => {
  const state = (await store.get('private', 'state')) || {};
  const out = {
    role: req.role,
    displayName: process.env.DISPLAY_NAME || 'Training log',
    timezone: TZ,
    today: today(),
    lastSyncAt: state.lastSyncAt || null,
  };
  if (req.role === 'owner') {
    out.connections = await getStatuses();
    out.trainerKey = await getTrainerKey();
  }
  res.json(out);
}));

const publicPhoto = ({ path, ...p }) => p;

api.get('/data', wrap(async (req, res) => {
  const to = isIsoDate(req.query.to) ? req.query.to : today();
  let from = isIsoDate(req.query.from) ? req.query.from : addDays(to, -29);
  if (from > to) throw bad('The start date is after the end date.');
  if (from < addDays(to, -730)) from = addDays(to, -730);
  const [days, activities, photos] = await Promise.all([
    store.list('days', from, to),
    store.list('activities', from, to),
    store.list('photos'), // photos are few; the page shows them all regardless of the chart range
  ]);
  res.json({ from, to, days, activities, photos: photos.map(publicPhoto) });
}));

// ---------- Photos (owner and trainer) ----------
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const KINDS = ['progress', 'meal'];
const POSES = ['front', 'side', 'back'];

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

function photoTags(input, { partial = false } = {}) {
  const out = {};
  if (input.date !== undefined || !partial) {
    if (!isIsoDate(input.date)) throw bad('Pick a date for the photo.');
    if (input.date > addDays(today(), 1)) throw bad('The photo date is in the future.');
    out.date = input.date;
  }
  if (input.kind !== undefined || !partial) {
    if (!KINDS.includes(input.kind)) throw bad('Choose whether this is a progress photo or a meal photo.');
    out.kind = input.kind;
  }
  if (input.pose !== undefined) out.pose = POSES.includes(input.pose) ? input.pose : null;
  if (input.note !== undefined) out.note = String(input.note || '').trim().slice(0, 500);
  return out;
}

api.post('/photos', wrap(async (req, res) => {
  const buf = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || buf.length === 0) throw bad('No photo was received.');
  if (buf.length > 9 * 1024 * 1024) throw new HttpError(413, 'That photo is too large (limit 9 MB).');
  const contentType = sniffImage(buf);
  if (!contentType) throw bad('Only JPEG, PNG or WebP photos can be uploaded.');

  const tags = photoTags(req.query);
  if (tags.kind !== 'progress') tags.pose = null;
  const id = crypto.randomUUID();
  const path = `photos/${id}.${IMAGE_TYPES[contentType]}`;
  await store.saveFile(path, buf, contentType);
  const photo = { ...tags, pose: tags.pose ?? null, note: tags.note || '', path, contentType, size: buf.length, uploadedBy: req.role, createdAt: Date.now() };
  await store.set('photos', id, photo, { merge: false });
  res.status(201).json(publicPhoto({ id, ...photo }));
}));

async function editablePhoto(req) {
  const photo = await store.get('photos', req.params.id);
  if (!photo) throw new HttpError(404, 'That photo no longer exists.');
  if (req.role !== 'owner' && photo.uploadedBy !== req.role) {
    throw new HttpError(403, 'You can only change photos you uploaded.');
  }
  return photo;
}

api.patch('/photos/:id', wrap(async (req, res) => {
  const photo = await editablePhoto(req);
  const tags = photoTags(req.body || {}, { partial: true });
  if ((tags.kind || photo.kind) !== 'progress') tags.pose = null;
  await store.set('photos', req.params.id, tags);
  res.json(publicPhoto({ id: req.params.id, ...photo, ...tags }));
}));

api.delete('/photos/:id', wrap(async (req, res) => {
  const photo = await editablePhoto(req);
  await store.deleteFile(photo.path);
  await store.del('photos', req.params.id);
  res.json({ ok: true });
}));

api.get('/photos/:id/file', wrap(async (req, res) => {
  const photo = await store.get('photos', req.params.id);
  const file = photo && (await store.readFile(photo.path));
  if (!file) throw new HttpError(404, 'Photo not found.');
  res.set({
    'Content-Type': file.contentType || photo.contentType,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': 'inline',
  });
  file.stream.on('error', (e) => res.destroy(e)).pipe(res);
}));

// ---------- Owner only ----------
api.use(requireOwner);

api.post('/sync', wrap(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.body?.days) || 4));
  res.json({ ...(await runSync({ days })), connections: await getStatuses() });
}));

api.put('/days/:date/macros', wrap(async (req, res) => {
  const { date } = req.params;
  if (!isIsoDate(date)) throw bad('Bad date.');
  const macros = { source: 'manual' };
  for (const k of ['kcal', 'protein', 'carbs', 'fat']) {
    const v = Number(req.body?.[k]);
    if (!Number.isFinite(v) || v < 0 || v > 20000) throw bad('Enter calories, protein, carbs and fat as numbers.');
    macros[k] = Math.round(v * 10) / 10;
  }
  await store.set('days', date, { date, macros: store.DELETE });
  await store.set('days', date, { date, macros, updatedAt: Date.now() });
  res.json({ date, macros });
}));

api.delete('/days/:date/macros', wrap(async (req, res) => {
  if (!isIsoDate(req.params.date)) throw bad('Bad date.');
  await store.set('days', req.params.date, { date: req.params.date, macros: store.DELETE });
  res.json({ ok: true });
}));

api.post('/trainer-link/rotate', wrap(async (req, res) => {
  res.json({ trainerKey: await rotateTrainerKey() });
}));

async function connectAndTest(name, fields) {
  await store.set('private', 'connections', { [name]: store.DELETE });
  await store.set('private', 'connections', { [name]: { ...fields, status: 'pending', message: '' } });
  const result = await runSync({ days: 14, only: [name] });
  return { result: result.sources[name], connections: await getStatuses() };
}

api.post('/connections/garmin', wrap(async (req, res) => {
  const { email, password, tokens } = req.body || {};
  let saved;
  if (tokens) {
    let parsed = tokens;
    if (typeof tokens === 'string') {
      try { parsed = JSON.parse(tokens); } catch { throw bad('That is not the text printed by scripts/garmin-login.js.'); }
    }
    if (!garmin.validTokens(parsed)) throw bad('Those Garmin tokens are incomplete.');
    saved = { oauth1: parsed.oauth1, oauth2: parsed.oauth2 };
  } else {
    if (!email || !password) throw bad('Enter your Garmin email and password.');
    try {
      saved = await garmin.login(String(email), String(password));
    } catch (e) {
      throw new HttpError(e.needsLogin ? 401 : 502, e.message);
    }
  }
  res.json(await connectAndTest('garmin', { tokens: saved }));
}));

api.post('/connections/withings/start', wrap(async (req, res) => {
  const state = newKey();
  await store.set('private', 'oauthState', { state, createdAt: Date.now() }, { merge: false });
  res.json({ url: withings.authorizeUrl(`${publicUrl(req)}/api/withings/callback`, state) });
}));

api.post('/connections/mfp', wrap(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const cookie = String(req.body?.cookie || '').trim();
  if (!username && !cookie) throw bad('Enter your MyFitnessPal username, or paste a session cookie.');
  if (username && !/^[\w.\-]{1,60}$/.test(username)) throw bad('That does not look like a MyFitnessPal username.');
  if (cookie.length > 8000) throw bad('That cookie is too long.');
  res.json(await connectAndTest('mfp', { username, cookie }));
}));

api.delete('/connections/:name', wrap(async (req, res) => {
  if (!NAMES.includes(req.params.name)) throw new HttpError(404, 'Unknown connection.');
  await store.set('private', 'connections', { [req.params.name]: store.DELETE });
  res.json({ connections: await getStatuses() });
}));

app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message });
});

module.exports = app;
