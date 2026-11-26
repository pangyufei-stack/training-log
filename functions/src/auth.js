'use strict';
/**
 * Access is by secret link only.
 *  - Owner key: the OWNER_KEY secret, set once at deploy time. Full control.
 *  - Trainer key: generated here, stored in Firestore, replaceable by the owner.
 *    Can read everything and upload / edit photos.
 */
const crypto = require('node:crypto');
const store = require('./store');

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function newKey() {
  return crypto.randomBytes(24).toString('base64url');
}

async function getTrainerKey() {
  const cfg = (await store.get('private', 'config')) || {};
  if (cfg.trainerKey) return cfg.trainerKey;
  const trainerKey = newKey();
  await store.set('private', 'config', { trainerKey });
  return trainerKey;
}

async function rotateTrainerKey() {
  const trainerKey = newKey();
  await store.set('private', 'config', { trainerKey });
  return trainerKey;
}

function presentedKey(req) {
  const h = req.get('authorization') || '';
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim();
  return typeof req.query.k === 'string' ? req.query.k : '';
}

async function roleFor(key) {
  if (!key) return null;
  if (safeEqual(key, process.env.OWNER_KEY || '')) return 'owner';
  if (safeEqual(key, await getTrainerKey())) return 'trainer';
  return null;
}

function requireAuth(req, res, next) {
  roleFor(presentedKey(req))
    .then((role) => {
      if (!role) return res.status(401).json({ error: 'This link is not valid any more. Ask for a new one.' });
      req.role = role;
      next();
    })
    .catch(next);
}

function requireOwner(req, res, next) {
  if (req.role !== 'owner') return res.status(403).json({ error: 'Only the owner can do this.' });
  next();
}

module.exports = { requireAuth, requireOwner, getTrainerKey, rotateTrainerKey, newKey };
