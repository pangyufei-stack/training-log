'use strict';
// Checks the parsers against sample responses written from the documented formats.
// The MyFitnessPal sample is a reconstruction of its printable-diary page, not a
// capture from the live site, so a pass here does not prove the live scan works.
process.env.MEMORY_STORE = '1';
const test = require('node:test');
const assert = require('node:assert');
const { parsePrintableDiary, cookieHeader } = require('../src/sources/mfp');
const { parseWeights, parseSleep } = require('../src/sources/withings');

test('MyFitnessPal printable diary: totals per day, columns by name', () => {
  const html = `<html><body>
    <h2 class="main-title-2" id="date">November 24, 2026</h2>
    <table class="table0" id="food"><thead><tr><td class="first">Foods</td><td>Calories</td><td>Carbs</td><td>Fat</td><td>Protein</td><td>Sodium</td><td>Sugar</td></tr></thead>
      <tbody><tr><td class="first">Oats</td><td>300</td><td>50g</td><td>6g</td><td>10g</td><td>5mg</td><td>1g</td></tr></tbody>
      <tfoot><tr><td class="first">TOTAL:</td><td>2,150</td><td>230g</td><td>70g</td><td>160g</td><td>2,300mg</td><td>45g</td></tr></tfoot></table>
    <table class="table0" id="excercise"><thead><tr><td>Exercises</td><td>Calories</td></tr></thead><tfoot><tr><td>TOTAL:</td><td>400</td></tr></tfoot></table>
    <h2 class="main-title-2" id="date">November 25, 2026</h2>
    <table class="table0" id="food"><thead><tr><td class="first">Foods</td><td>Calories</td><td>Protein</td><td>Fat</td><td>Carbs</td></tr></thead>
      <tfoot><tr><td class="first">TOTAL:</td><td>1,980</td><td>150g</td><td>60g</td><td>210g</td></tr></tfoot></table>
  </body></html>`;
  assert.deepStrictEqual(parsePrintableDiary(html), {
    '2026-11-24': { kcal: 2150, carbs: 230, fat: 70, protein: 160, sodiumMg: 2300, sugar: 45 },
    '2026-11-25': { kcal: 1980, protein: 150, fat: 60, carbs: 210 },
  });
  assert.deepStrictEqual(parsePrintableDiary('<html><body>Please log in</body></html>'), {});
});

test('MyFitnessPal cookie: bare token or whole header', () => {
  assert.strictEqual(cookieHeader('abc123'), '__Secure-next-auth.session-token=abc123');
  assert.strictEqual(cookieHeader('Cookie: a=1; b=2'), 'a=1; b=2');
  assert.strictEqual(cookieHeader(''), '');
});

test('Withings weights: scaled values, first weigh-in of the day wins', () => {
  const at = (iso) => Date.parse(iso) / 1000;
  const days = parseWeights({ timezone: 'Europe/London', measuregrps: [
    { date: at('2026-11-25T07:00:00Z'), measures: [{ type: 1, value: 83250, unit: -3 }, { type: 6, value: 2015, unit: -2 }] },
    { date: at('2026-11-25T19:00:00Z'), measures: [{ type: 1, value: 84100, unit: -3 }] },
    { date: at('2026-11-26T07:05:00Z'), measures: [{ type: 1, value: 831, unit: -1 }] },
  ] });
  assert.deepStrictEqual(days, { '2026-11-25': { weightKg: 83.25, fatPct: 20.2 }, '2026-11-26': { weightKg: 83.1 } });
});

test('Withings sleep: longest sleep of the day, stages kept', () => {
  const days = parseSleep({ series: [
    { date: '2026-11-25', startdate: 1, enddate: 2, data: { total_sleep_time: 1800, deepsleepduration: 0, lightsleepduration: 1800, remsleepduration: 0 } },
    { date: '2026-11-25', startdate: 3, enddate: 4, data: { total_sleep_time: 27000, deepsleepduration: 6000, lightsleepduration: 15000, remsleepduration: 6000, wakeupduration: 900, sleep_score: 82 } },
  ] });
  assert.strictEqual(days['2026-11-25'].sleep.durationS, 27000);
  assert.strictEqual(days['2026-11-25'].sleep.deepS, 6000);
  assert.strictEqual(days['2026-11-25'].sleep.score, 82);
});
