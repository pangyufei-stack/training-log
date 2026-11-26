'use strict';
/**
 * Garmin Connect: steps and workouts.
 *
 * Garmin has no official API for individuals, so this uses the unofficial
 * `garmin-connect` library, which signs in the same way the Garmin phone app does.
 * We keep only the resulting tokens, never the password.
 * Limits: accounts with two-step verification are not supported by the library,
 * and Garmin sometimes refuses sign-ins that come from cloud servers. In both
 * cases the login can be done once on a home computer with scripts/garmin-login.js.
 */
const { GarminConnect } = require('garmin-connect');
const { NeedsLogin } = require('../errors');
const { addDays } = require('../dates');

const API = 'https://connectapi.garmin.com';

function isAuthError(e) {
  const status = e?.response?.status;
  return status === 401 || status === 403 || /\(401\)|oauth|unauthor|login failed|token/i.test(String(e?.message || ''));
}

function validTokens(t) {
  return Boolean(t?.oauth1?.oauth_token && t?.oauth1?.oauth_token_secret && t?.oauth2?.access_token);
}

/** Sign in with email + password and return tokens to store. */
async function login(email, password) {
  const gc = new GarminConnect({ username: email, password });
  try {
    await gc.login();
  } catch (e) {
    throw new NeedsLogin(
      'Garmin refused the sign-in. Check the email and password. If they are right, Garmin is ' +
        'probably blocking sign-ins from cloud servers or your account uses two-step verification: ' +
        'run scripts/garmin-login.js on your own computer and paste the result here instead. (' +
        String(e.message || e).slice(0, 160) + ')'
    );
  }
  return gc.exportToken();
}

function clientFrom(tokens) {
  if (!validTokens(tokens)) throw new NeedsLogin('Garmin is not signed in.');
  const gc = new GarminConnect({ username: 'token', password: 'token' });
  gc.loadToken(tokens.oauth1, tokens.oauth2);
  return gc;
}

async function fetchSteps(gc, from, to) {
  const days = {};
  // The endpoint accepts at most 28 days per request.
  for (let start = from; start <= to; start = addDays(start, 28)) {
    const end = addDays(start, 27) < to ? addDays(start, 27) : to;
    const rows = await gc.get(`${API}/usersummary-service/stats/steps/daily/${start}/${end}`);
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.calendarDate || r.totalSteps == null) continue;
      days[r.calendarDate] = {
        steps: r.totalSteps,
        stepGoal: r.stepGoal ?? null,
        distanceM: r.totalDistance ?? null,
      };
    }
  }
  return days;
}

async function fetchActivities(gc, from, to) {
  const out = [];
  for (let start = 0; start < 1000; start += 100) {
    const rows = await gc.get(`${API}/activitylist-service/activities/search/activities`, {
      params: { start, limit: 100, startDate: from, endDate: to },
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const a of rows) {
      const date = String(a.startTimeLocal || '').slice(0, 10);
      if (!date || date < from || date > to) continue;
      out.push({
        id: `garmin-${a.activityId}`,
        date,
        startLocal: a.startTimeLocal,
        name: a.activityName || 'Workout',
        type: a.activityType?.typeKey || 'other',
        durationS: Math.round(a.duration || 0),
        distanceM: a.distance ? Math.round(a.distance) : null,
        kcal: a.calories ? Math.round(a.calories) : null,
        avgHr: a.averageHR ? Math.round(a.averageHR) : null,
        maxHr: a.maxHR ? Math.round(a.maxHR) : null,
        source: 'garmin',
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

async function sync(conn, from, to) {
  const gc = clientFrom(conn.tokens);
  try {
    const days = await fetchSteps(gc, from, to);
    const activities = await fetchActivities(gc, from, to);
    // The library refreshes the short-lived token itself; keep whatever it ended up with.
    return { days, activities, auth: { tokens: gc.exportToken() } };
  } catch (e) {
    if (isAuthError(e)) throw new NeedsLogin('Garmin signed us out. Sign in to Garmin again.');
    throw e;
  }
}

module.exports = { login, sync, validTokens };
