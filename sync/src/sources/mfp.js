'use strict';
/**
 * MyFitnessPal: daily calories and macros.
 *
 * MyFitnessPal has no public API. This reads the same "printable diary" page the
 * website offers under Reports, one request for the whole date range. It works when
 * either (a) the diary is set to Public in MyFitnessPal's Diary Settings, or (b) the
 * owner has pasted their logged-in session cookie on the Settings page.
 * Because it reads a web page, it stops working whenever MyFitnessPal changes that
 * page or blocks the request; the dashboard then asks the owner to sign in again,
 * and macros can always be typed in by hand.
 */
const cheerio = require('cheerio');
const { NeedsLogin } = require('../errors');

const BASE = 'https://www.myfitnesspal.com';
const SESSION_COOKIE = '__Secure-next-auth.session-token';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const COLUMNS = [
  [/^calories/, 'kcal'],
  [/^carb/, 'carbs'],
  [/^fat/, 'fat'],
  [/^protein/, 'protein'],
  [/^fib/, 'fiber'],
  [/^sugar/, 'sugar'],
  [/^sodium/, 'sodiumMg'],
];

/** Accepts either the bare session token or a whole pasted Cookie header. */
function cookieHeader(raw) {
  const v = String(raw || '').trim().replace(/^cookie:\s*/i, '');
  if (!v) return '';
  return v.includes('=') ? v : `${SESSION_COOKIE}=${v}`;
}

function num(text) {
  const n = parseFloat(String(text).replace(/,/g, '').replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isoFromHeading(text) {
  const t = Date.parse(`${String(text).trim()} UTC`);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Printable diary HTML -> { 'YYYY-MM-DD': { kcal, protein, carbs, fat, ... } } */
function parsePrintableDiary(html) {
  const $ = cheerio.load(html);
  const days = {};
  $('table#food, table.table0').each((_, table) => {
    const $t = $(table);
    if ($t.attr('id') && $t.attr('id') !== 'food') return; // skip the exercise table
    const date = isoFromHeading($t.prevAll('h2').first().text());
    if (!date) return;
    const headers = $t.find('thead tr').first().children().map((__, c) => $(c).text().trim().toLowerCase()).get();
    const totals = $t.find('tfoot tr').first().children().map((__, c) => $(c).text().trim()).get();
    if (!headers.length || totals.length !== headers.length) return;
    const macros = {};
    headers.forEach((h, i) => {
      const col = COLUMNS.find(([re]) => re.test(h));
      const v = num(totals[i]);
      if (col && v != null) macros[col[1]] = v;
    });
    if (macros.kcal == null || macros.kcal === 0) return; // nothing logged that day
    days[date] = macros;
  });
  return days;
}

function looksLikeLoginWall(html) {
  return /account\/login|log in to|sign in to|diary is private|password protected/i.test(html) && !/id="food"/.test(html);
}

async function sync(conn, from, to) {
  const cookie = cookieHeader(conn.cookie);
  if (!conn.username && !cookie) throw new NeedsLogin('MyFitnessPal is not connected.');

  const user = conn.username ? `/${encodeURIComponent(conn.username)}` : '';
  const url = `${BASE}/reports/printable_diary${user}?from=${from}&to=${to}`;
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { 'user-agent': UA, accept: 'text/html', ...(cookie ? { cookie } : {}) },
  });

  const loginHelp = cookie
    ? 'MyFitnessPal signed us out. Log in to myfitnesspal.com in your browser and paste a fresh session cookie.'
    : 'MyFitnessPal would not show the diary. Set your diary to Public, or paste your session cookie.';

  if (res.status >= 300 && res.status < 400) throw new NeedsLogin(loginHelp);
  if (res.status === 401 || res.status === 403) {
    throw new NeedsLogin(`${loginHelp} (MyFitnessPal answered ${res.status}; it may also be blocking automated requests.)`);
  }
  if (!res.ok) throw new Error(`MyFitnessPal answered HTTP ${res.status}`);

  const html = await res.text();
  const parsed = parsePrintableDiary(html);
  if (Object.keys(parsed).length === 0) {
    if (looksLikeLoginWall(html)) throw new NeedsLogin(loginHelp);
    if (!/id="food"/.test(html) && !/printable/i.test(html)) {
      throw new Error('MyFitnessPal returned a page this app does not recognise. Its layout may have changed.');
    }
  }

  const days = {};
  for (const [date, m] of Object.entries(parsed)) {
    if (date < from || date > to) continue;
    days[date] = { macros: { ...m, source: 'mfp' } };
  }
  return { days, activities: [] };
}

module.exports = { sync, parsePrintableDiary, cookieHeader };
