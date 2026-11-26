'use strict';
/**
 * Withings: weight, body fat and sleep, through the official Withings API (OAuth 2).
 * Needs a free developer app from https://developer.withings.com; its client id and
 * secret are stored as the WITHINGS_CLIENT_ID / WITHINGS_CLIENT_SECRET secrets.
 */
const { NeedsLogin } = require('../errors');
const { dateInTz, unixBounds } = require('../dates');

const AUTHORIZE = 'https://account.withings.com/oauth2_user/authorize2';
const API = 'https://wbsapi.withings.net';
const SCOPE = 'user.metrics,user.activity';

function creds() {
  const id = process.env.WITHINGS_CLIENT_ID;
  const secret = process.env.WITHINGS_CLIENT_SECRET;
  if (!id || !secret || id === 'unset' || secret === 'unset') {
    throw new Error('Withings is not set up yet: the WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET secrets are missing.');
  }
  return { id, secret };
}

function authorizeUrl(redirectUri, state) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: creds().id,
    scope: SCOPE,
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE}?${q}`;
}

async function call(path, params, accessToken) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`Withings answered HTTP ${res.status}`);
  const json = await res.json();
  // Withings reports errors in the body. 401 and the 1xx range mean the login is no longer valid.
  if (json.status !== 0) {
    const msg = `Withings error ${json.status}${json.error ? `: ${json.error}` : ''}`;
    if (json.status === 401 || (json.status >= 100 && json.status < 200)) throw new NeedsLogin(msg);
    throw new Error(msg);
  }
  return json.body;
}

function tokenFields(body) {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + (Number(body.expires_in) || 10800) * 1000,
    userId: String(body.userid ?? ''),
  };
}

async function exchangeCode(code, redirectUri) {
  const { id, secret } = creds();
  const body = await call('/v2/oauth2', {
    action: 'requesttoken',
    grant_type: 'authorization_code',
    client_id: id,
    client_secret: secret,
    code,
    redirect_uri: redirectUri,
  });
  return tokenFields(body);
}

async function freshAuth(conn) {
  if (!conn.refreshToken) throw new NeedsLogin('Withings is not connected.');
  if (conn.accessToken && conn.expiresAt && conn.expiresAt - Date.now() > 5 * 60 * 1000) return null;
  const { id, secret } = creds();
  // Each refresh returns a new refresh token that replaces the old one.
  const body = await call('/v2/oauth2', {
    action: 'requesttoken',
    grant_type: 'refresh_token',
    client_id: id,
    client_secret: secret,
    refresh_token: conn.refreshToken,
  });
  return tokenFields(body);
}

function parseWeights(body) {
  const tz = body.timezone || undefined;
  const firstOfDay = {};
  for (const g of body.measuregrps || []) {
    const date = dateInTz(new Date(g.date * 1000), tz);
    const entry = (firstOfDay[date] ||= { at: Infinity });
    // Use the first weigh-in of each day so days are comparable.
    if (g.date > entry.at) continue;
    const values = {};
    for (const m of g.measures || []) {
      const real = m.value * 10 ** m.unit;
      if (m.type === 1) values.weightKg = Math.round(real * 100) / 100;
      if (m.type === 6) values.fatPct = Math.round(real * 10) / 10;
    }
    if (values.weightKg == null) continue;
    Object.assign(entry, values, { at: g.date });
  }
  const days = {};
  for (const [date, e] of Object.entries(firstOfDay)) {
    if (e.weightKg == null) continue;
    days[date] = { weightKg: e.weightKg, ...(e.fatPct != null ? { fatPct: e.fatPct } : {}) };
  }
  return days;
}

function parseSleep(body) {
  const days = {};
  for (const s of body.series || []) {
    const d = s.data || {};
    const stages = (d.deepsleepduration || 0) + (d.lightsleepduration || 0) + (d.remsleepduration || 0);
    const durationS = d.total_sleep_time || stages || Math.max(0, (s.enddate || 0) - (s.startdate || 0) - (d.wakeupduration || 0));
    if (!s.date || !durationS) continue;
    // A day can hold a nap as well as the night; keep the longest.
    if (days[s.date] && days[s.date].sleep.durationS >= durationS) continue;
    days[s.date] = {
      sleep: {
        durationS,
        deepS: d.deepsleepduration ?? null,
        lightS: d.lightsleepduration ?? null,
        remS: d.remsleepduration ?? null,
        awakeS: d.wakeupduration ?? null,
        score: d.sleep_score ?? null,
        start: s.startdate ?? null,
        end: s.enddate ?? null,
      },
    };
  }
  return days;
}

async function sync(conn, from, to) {
  const auth = await freshAuth(conn);
  const token = auth ? auth.accessToken : conn.accessToken;
  const { start, end } = unixBounds(from, to);

  const weightBody = await call('/measure', { action: 'getmeas', meastypes: '1,6', category: '1', startdate: start, enddate: end }, token);
  const sleepBody = await call(
    '/v2/sleep',
    {
      action: 'getsummary',
      startdateymd: from,
      enddateymd: to,
      data_fields: 'total_sleep_time,deepsleepduration,lightsleepduration,remsleepduration,wakeupduration,sleep_score',
    },
    token
  );

  const days = {};
  for (const part of [parseWeights(weightBody), parseSleep(sleepBody)]) {
    for (const [date, v] of Object.entries(part)) {
      if (date < from || date > to) continue;
      days[date] = { ...(days[date] || {}), ...v };
    }
  }
  return { days, activities: [], auth: auth || undefined };
}

module.exports = { authorizeUrl, exchangeCode, sync, parseWeights, parseSleep };
