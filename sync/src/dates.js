'use strict';

const TZ = process.env.APP_TIMEZONE || 'UTC';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD for an instant, in the app's timezone. */
function dateInTz(d = new Date(), tz = TZ) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function today() {
  return dateInTz(new Date());
}

function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function isIsoDate(s) {
  return typeof s === 'string' && ISO.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** Every date from `from` to `to`, inclusive. */
function range(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Unix seconds for local midnight-ish bounds; padded a day each side so timezone offsets never clip. */
function unixBounds(from, to) {
  return {
    start: Math.floor(Date.parse(addDays(from, -1) + 'T00:00:00Z') / 1000),
    end: Math.floor(Date.parse(addDays(to, 2) + 'T00:00:00Z') / 1000),
  };
}

module.exports = { TZ, dateInTz, today, addDays, isIsoDate, range, unixBounds };
