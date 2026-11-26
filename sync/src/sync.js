'use strict';
/**
 * Pulls recent days from every connected source into Firestore.
 *
 * Firestore layout used here (see firestore.rules for who can read what):
 *   private/connections  tokens per source. Never readable from the browser.
 *   private/garminLogin  email + password the owner typed in. Used once, then deleted.
 *   private/withingsApp  the owner's Withings developer app id + secret.
 *   private/status       per-source status shown on the owner's Settings tab.
 *   meta/public          last sync time, display name, timezone (owner + trainer).
 *   days/{YYYY-MM-DD}    one merged record per day.
 *   activities/{id}      one record per workout.
 */
const store = require('./store');
const { today, addDays } = require('./dates');

const SOURCES = {
  garmin: require('./sources/garmin'),
  withings: require('./sources/withings'),
  mfp: require('./sources/mfp'),
};
const NAMES = Object.keys(SOURCES);

function isConnected(name, c) {
  if (!c) return false;
  if (name === 'garmin') return SOURCES.garmin.validTokens(c.tokens);
  if (name === 'withings') return Boolean(c.refreshToken);
  if (name === 'mfp') return Boolean(c.username || c.cookie);
  return false;
}

const setStatus = (name, fields) => store.set('private', 'status', { [name]: fields });

const isRateLimit = (e) => /\(429\)|too many requests|rate.?limit/i.test(String(e?.message || e));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A password typed into Settings is used to sign in once, then deleted. Exception: if Garmin
 * only says "too many requests" (it limits sign-ins from data-centre computers like GitHub's),
 * the saved sign-in is kept and tried again on the next run, because the password itself was fine.
 * Returns false when Garmin should be skipped this run.
 */
async function consumeGarminLogin(conn, now) {
  const login = await store.get('private', 'garminLogin');
  if (!login) return true;
  if (!login.email || !login.password) {
    await store.del('private', 'garminLogin');
    return true;
  }
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const tokens = await SOURCES.garmin.login(login.email, login.password);
      conn.garmin = { tokens };
      await store.set('private', 'connections', { garmin: { tokens } });
      await store.del('private', 'garminLogin');
      console.log('garmin: signed in');
      return true;
    } catch (e) {
      if (isRateLimit(e) && attempt === 1) {
        console.log('garmin: rate limited, retrying in 60 seconds');
        await pause(60000);
        continue;
      }
      if (isRateLimit(e)) {
        console.error('garmin: still rate limited; keeping the saved sign-in for the next run');
        await setStatus('garmin', {
          connected: true, status: 'pending', lastSyncAt: now,
          message: 'Garmin accepted the password but is limiting sign-ins from GitHub right now. It will try again at the next sync; nothing to do.',
        });
        return false;
      }
      console.error('garmin sign-in failed:', e.message);
      await store.del('private', 'garminLogin');
      await setStatus('garmin', { connected: false, status: 'needs_login', message: String(e.message).slice(0, 400), lastSyncAt: now });
      return false;
    }
  }
  return false;
}

async function runSync({ days = 4, only = NAMES } = {}) {
  const to = today();
  const from = addDays(to, -(Math.max(1, days) - 1));
  const now = Date.now();
  const conn = (await store.get('private', 'connections')) || {};
  // A failed new sign-in should stay visible, so skip Garmin for this run rather than retry old tokens.
  const garminOk = await consumeGarminLogin(conn, now);
  if (conn.withings) conn.withings.app = (await store.get('private', 'withingsApp')) || {};

  const existing = Object.fromEntries((await store.list('days', from, to)).map((d) => [d.date, d]));
  const summary = {};

  for (const name of NAMES.filter((n) => only.includes(n))) {
    const c = conn[name];
    if (name === 'garmin' && !garminOk) {
      summary[name] = { status: 'skipped', message: 'see Garmin status in Settings' };
      continue;
    }
    if (!isConnected(name, c)) {
      summary[name] = { status: 'not_connected' };
      continue;
    }
    try {
      const result = await SOURCES[name].sync(c, from, to);

      const dayWrites = [];
      for (const [date, fields] of Object.entries(result.days || {})) {
        const write = { ...fields, date, updatedAt: now };
        // Macros typed in by hand win over the scan until the owner clears them.
        if (write.macros && existing[date]?.macros?.source === 'manual') delete write.macros;
        dayWrites.push([date, write]);
      }
      await store.setMany('days', dayWrites);
      await store.setMany('activities', (result.activities || []).map((a) => [a.id, { ...a, updatedAt: now }]));
      if (result.auth) await store.set('private', 'connections', { [name]: result.auth });

      await setStatus(name, { connected: true, status: 'ok', message: '', lastSyncAt: now, lastOkAt: now });
      summary[name] = { status: 'ok', days: dayWrites.length, activities: (result.activities || []).length };
    } catch (e) {
      const status = e.needsLogin ? 'needs_login' : 'error';
      const message = String(e.message || e).slice(0, 400);
      console.error(`${name} failed (${status}):`, message);
      await setStatus(name, { connected: true, status, message, lastSyncAt: now });
      summary[name] = { status, message };
    }
  }

  await store.set('meta', 'public', { lastSyncAt: now });
  return { from, to, sources: summary };
}

module.exports = { runSync, NAMES };
