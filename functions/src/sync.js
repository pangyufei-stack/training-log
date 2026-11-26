'use strict';
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

/** What the browser is allowed to know about a connection: never tokens or cookies. */
function publicStatus(name, c) {
  const connected = isConnected(name, c);
  return {
    connected,
    status: connected ? c.status || 'pending' : 'not_connected',
    message: (connected && c.message) || '',
    lastSyncAt: c?.lastSyncAt || null,
    lastOkAt: c?.lastOkAt || null,
    ...(name === 'mfp' && connected ? { username: c.username || '', hasCookie: Boolean(c.cookie) } : {}),
  };
}

async function getStatuses() {
  const conn = (await store.get('private', 'connections')) || {};
  return Object.fromEntries(NAMES.map((n) => [n, publicStatus(n, conn[n])]));
}

/**
 * Pull the last `days` days from every connected source and merge them into the
 * per-day records. One source failing never stops the others.
 */
async function runSync({ days = 4, only = NAMES } = {}) {
  const to = today();
  const from = addDays(to, -(Math.max(1, days) - 1));
  const conn = (await store.get('private', 'connections')) || {};
  const existing = Object.fromEntries((await store.list('days', from, to)).map((d) => [d.date, d]));
  const now = Date.now();
  const summary = {};

  for (const name of NAMES.filter((n) => only.includes(n))) {
    const c = conn[name];
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

      await store.set('private', 'connections', {
        [name]: { ...(result.auth || {}), status: 'ok', message: '', lastSyncAt: now, lastOkAt: now },
      });
      summary[name] = { status: 'ok', days: dayWrites.length, activities: (result.activities || []).length };
    } catch (e) {
      const status = e.needsLogin ? 'needs_login' : 'error';
      const message = String(e.message || e).slice(0, 400);
      console.error(`sync ${name} failed (${status}):`, message);
      await store.set('private', 'connections', { [name]: { status, message, lastSyncAt: now } });
      summary[name] = { status, message };
    }
  }

  await store.set('private', 'state', { lastSyncAt: now });
  return { from, to, sources: summary };
}

module.exports = { runSync, getStatuses, NAMES };
