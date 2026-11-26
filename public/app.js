// Training log dashboard. Plain ES modules, no build step. Visual rules: /DESIGN.md.

// ---------- tiny DOM helpers ----------
const $app = document.getElementById('app');
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list' && k !== 'type') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid);
  return el;
}
const ICONS = {
  logo: 'M4 12h3l2-6 4 12 2-6h5',
  overview: 'M3 3v18h18M7 15l4-5 3 3 5-7',
  log: 'M3 5h18M3 12h18M3 19h18M9 5v14',
  workouts: 'M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11',
  photos: 'M4 5h16v14H4zM4 15l4.5-4.5 4 4 2.5-2.5L20 17M9 9.5a1 1 0 1 0 0-.01',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4',
  sync: 'M20 11a8 8 0 0 0-14.6-4M4 4v4h4M4 13a8 8 0 0 0 14.6 4M20 20v-4h-4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  dot: 'M12 12v.01',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  compare: 'M4 5h7v14H4zM13 5h7v14h-7z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  weight: 'M5 7h14l-1.5 13h-11zM9 7a3 3 0 0 1 6 0M12 12l2-2',
  steps: 'M4 17l4-9 4 6 3-4 5 7',
  sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  food: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-3 5-3 8h3zM17 11v10',
};
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name]);
  svg.append(p);
  return svg;
}
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- formatting ----------
const asDate = (iso) => new Date(iso + 'T00:00:00Z');
const fmtDay = (iso, opts = { day: 'numeric', month: 'short' }) => asDate(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts });
const fmtLong = (iso) => fmtDay(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const num = (v, digits = 0) => (v == null ? '–' : Number(v).toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const fmtDur = (s) => (s == null ? '–' : `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`);
const fmtAgo = (ms) => {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 36) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
};
const addDays = (iso, n) => { const d = asDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const title = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// ---------- state + API ----------
const state = { key: '', me: null, data: null, tab: 'overview', range: 30, photoFilter: 'all' };
const charts = [];

function readKey() {
  const fromHash = new URLSearchParams(location.hash.slice(1)).get('k');
  try {
    if (fromHash) localStorage.setItem('tl.key', fromHash);
    return fromHash || localStorage.getItem('tl.key') || '';
  } catch { return fromHash || ''; }
}
async function api(path, { method = 'GET', body, raw, type } = {}) {
  const res = await fetch('/api' + path, {
    method,
    headers: { authorization: `Bearer ${state.key}`, ...(raw ? { 'content-type': type } : body ? { 'content-type': 'application/json' } : {}) },
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/connections')) { gate(json.error); throw new Error(json.error || 'Not allowed'); }
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}
const photoUrl = (p) => `/api/photos/${p.id}/file?k=${encodeURIComponent(state.key)}`;
const isOwner = () => state.me?.role === 'owner';
const canEdit = (p) => isOwner() || p.uploadedBy === state.me?.role;

function toast(text) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}
function gate(message) {
  $app.replaceChildren(h('div', { class: 'gate' },
    h('h1', null, 'Private training log'),
    h('p', null, message || 'Open this page with the private link you were sent.')));
}
async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message); } finally { btn.disabled = false; }
}

async function loadData() {
  const to = state.me.today;
  state.data = await api(`/data?from=${addDays(to, -(state.range - 1))}&to=${to}`);
}
async function refresh() {
  state.me = await api('/me');
  await loadData();
  render();
}

// ---------- shell ----------
const TABS = [
  ['overview', 'Overview'], ['log', 'Daily log'], ['workouts', 'Workouts'], ['photos', 'Photos'], ['settings', 'Settings', true],
];
function render() {
  while (charts.length) charts.pop().destroy();
  document.title = state.me.displayName;
  const synced = () => h('span', { class: 'synced' }, icon('sync'), `Synced ${fmtAgo(state.me.lastSyncAt)}`);
  const view = { overview: viewOverview, log: viewLog, workouts: viewWorkouts, photos: viewPhotos, settings: viewSettings }[state.tab]();
  [...view.children].forEach((c, i) => c.style.setProperty('--i', i));
  $app.replaceChildren(h('div', { class: 'shell' },
    h('header', { class: 'side' },
      h('div', { class: 'brand' }, h('span', { class: 'mark' }, icon('logo')), h('h1', null, state.me.displayName), synced()),
      h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' },
        TABS.filter(([, , ownerOnly]) => !ownerOnly || isOwner()).map(([id, label]) =>
          h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { state.tab = id; render(); scrollTo(0, 0); } }, icon(id), label))),
      synced()),
    h('main', null, view)));
  drawCharts();
}
function rangeControl() {
  return h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' }, [7, 30, 90].map((d) =>
    h('button', { 'aria-pressed': String(state.range === d), onclick: async () => { state.range = d; await loadData(); render(); } }, `${d} days`)));
}
const pageHead = (text, sub, ...actions) => h('div', { class: 'page-head' }, h('h2', null, text), actions, sub && h('p', { class: 'sub' }, sub));
const rangeText = () => `${fmtDay(state.data.from)} to ${fmtDay(state.data.to, { day: 'numeric', month: 'short', year: 'numeric' })}`;

/** One row per calendar day in the range, oldest first, even when nothing was recorded. */
function dayRows() {
  const byDate = Object.fromEntries(state.data.days.map((d) => [d.date, d]));
  const out = [];
  for (let d = state.data.from; d <= state.data.to; d = addDays(d, 1)) out.push(byDate[d] || { date: d });
  return out;
}

// ---------- overview ----------
function tile(iconName, label, value, unit, sub, digits = 0) {
  const valueEl = h('span', null, value == null ? '–' : num(value, digits));
  if (value != null && !reducedMotion) {
    const t0 = performance.now();
    const step = (t) => {
      const p = Math.min(1, (t - t0) / 600);
      valueEl.textContent = num(value * (1 - (1 - p) ** 3), digits);
      if (p < 1) requestAnimationFrame(step);
    };
    valueEl.textContent = num(0, digits);
    requestAnimationFrame(step);
  }
  return h('div', { class: 'card tile' },
    h('div', { class: 'label' }, icon(iconName), label),
    h('div', { class: 'value' }, valueEl, value != null && unit ? h('small', null, unit) : null),
    h('div', { class: 'sub' }, sub));
}
function viewOverview() {
  const rows = dayRows();
  const weights = rows.filter((d) => d.weightKg != null);
  const steps = rows.filter((d) => d.steps != null);
  const sleeps = rows.filter((d) => d.sleep?.durationS);
  const foods = rows.filter((d) => d.macros?.kcal);
  const latestW = weights.at(-1);
  const delta = weights.length > 1 ? latestW.weightKg - weights[0].weightKg : null;
  const goalHits = steps.filter((d) => d.stepGoal && d.steps >= d.stepGoal).length;
  const avgSleep = avg(sleeps.map((d) => d.sleep.durationS));

  const problems = isOwner() ? Object.entries(state.me.connections).filter(([, c]) => c.status === 'needs_login' || c.status === 'error') : [];
  const chartCard = (id, name, hint, has) => h('div', { class: 'card chart' }, h('h3', null, name), h('p', { class: 'hint' }, hint),
    has ? h('div', { class: 'plot' }, h('canvas', { id, role: 'img', 'aria-label': `${name} chart. The same numbers are in the Daily log tab.` }))
        : h('p', { class: 'empty' }, 'Nothing recorded in this period.'));

  return h('div', { class: 'view' },
    pageHead('Overview', rangeText(), rangeControl()),
    problems.length ? h('div', { class: 'card banner' }, icon('alert'),
      h('p', null, h('b', null, problems.map(([n]) => SOURCE_NAMES[n]).join(' and ')), problems.length > 1 ? ' need attention, so their numbers are not updating.' : ' needs attention, so its numbers are not updating.'),
      h('button', { class: 'btn', onclick: () => { state.tab = 'settings'; render(); } }, 'Fix in Settings')) : null,
    h('div', { class: 'tiles' },
      tile('weight', 'Weight', latestW?.weightKg, 'kg', latestW ? (delta == null ? `on ${fmtDay(latestW.date)}` : `${delta > 0 ? '+' : ''}${num(delta, 1)} kg since ${fmtDay(weights[0].date)}`) : 'No weigh-ins yet', 1),
      tile('steps', 'Steps per day', avg(steps.map((d) => d.steps)), '', steps.length ? `Goal met on ${goalHits} of ${steps.length} days` : 'No step data yet'),
      tile('sleep', 'Sleep per night', avgSleep == null ? null : avgSleep / 3600, 'h', sleeps.length ? `${fmtDur(avgSleep)} average over ${sleeps.length} nights` : 'No sleep data yet', 1),
      tile('food', 'Calories per day', avg(foods.map((d) => d.macros.kcal)), 'kcal', foods.length ? `${num(avg(foods.map((d) => d.macros.protein || 0)))} g protein average, ${foods.length} days logged` : 'No food logged yet')),
    h('div', { class: 'charts' },
      chartCard('c-weight', 'Weight', 'Kilograms. Morning weigh-in and its 7-day average.', weights.length),
      chartCard('c-steps', 'Steps', 'Steps per day against the watch goal.', steps.length),
      chartCard('c-sleep', 'Sleep', 'Hours asleep per night, by stage.', sleeps.length),
      chartCard('c-macros', 'Calories by macro', 'Calories per day from protein, carbs and fat.', foods.length)));
}

function chartBase(legend) {
  const t3 = cssVar('--text-tertiary');
  return {
    responsive: true, maintainAspectRatio: false, animation: reducedMotion ? false : { duration: 300 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: legend, position: 'bottom', align: 'start', labels: { color: cssVar('--text-secondary'), usePointStyle: true, boxWidth: 10, boxHeight: 10, padding: 14, font: { size: 12 } } },
      tooltip: { backgroundColor: cssVar('--surface-hover'), borderColor: cssVar('--border-hover'), borderWidth: 1, titleColor: cssVar('--text'), bodyColor: cssVar('--text-secondary'), footerColor: cssVar('--text'), padding: 10, boxPadding: 4, cornerRadius: 8 },
    },
    scales: {
      x: { stacked: true, grid: { display: false }, border: { color: cssVar('--border') }, ticks: { color: t3, maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } } },
      y: { stacked: true, grid: { color: cssVar('--grid') }, border: { display: false }, ticks: { color: t3, maxTicksLimit: 5, font: { size: 11 } } },
    },
  };
}
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const a = chart.tooltip?.getActiveElements?.()[0];
    if (!a) return;
    const { ctx, chartArea } = chart;
    ctx.save(); ctx.strokeStyle = cssVar('--border-hover'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.element.x, chartArea.top); ctx.lineTo(a.element.x, chartArea.bottom); ctx.stroke(); ctx.restore();
  },
};
function drawCharts() {
  if (state.tab !== 'overview' || !window.Chart) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const rows = dayRows();
  const labels = rows.map((d) => fmtDay(d.date));
  const s = [1, 2, 3, 4].map((i) => cssVar(`--series-${i}`));
  const surface = cssVar('--surface');
  const muted = cssVar('--mark-muted');
  const make = (id, config) => { const el = document.getElementById(id); if (el) charts.push(new Chart(el, config)); };
  const bar = (label, data, color) => ({ label, data, pointStyle: 'rectRounded', backgroundColor: color, borderColor: surface, borderWidth: { top: 2, right: 0, bottom: 0, left: 0 }, borderRadius: 3, maxBarThickness: 22 });

  // Weight: raw weigh-ins as quiet dots, the 7-day average as the line to read.
  const w = rows.map((d) => d.weightKg ?? null);
  const rolling = rows.map((_, i) => { const win = w.slice(Math.max(0, i - 6), i + 1).filter((x) => x != null); return win.length && w.slice(0, i + 1).some((x) => x != null) ? Math.round(avg(win) * 100) / 100 : null; });
  const wOpts = chartBase(true);
  wOpts.scales.x.stacked = wOpts.scales.y.stacked = false;
  wOpts.scales.y.grace = '10%';
  wOpts.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y, 1)} kg` };
  make('c-weight', { type: 'line', plugins: [crosshair], options: wOpts, data: { labels, datasets: [
    { label: '7-day average', data: rolling, borderColor: s[0], backgroundColor: s[0], borderWidth: 2, pointStyle: 'line', pointRadius: 0, pointHoverRadius: 5, pointHoverBorderColor: surface, pointHoverBorderWidth: 2, tension: 0.25, spanGaps: true },
    { label: 'Weigh-in', data: w, showLine: false, borderColor: muted, backgroundColor: muted, pointRadius: 3, pointHoverRadius: 5 },
  ] } });

  const goals = rows.map((d) => d.stepGoal ?? null);
  const stOpts = chartBase(goals.some((g) => g != null));
  stOpts.scales.x.stacked = stOpts.scales.y.stacked = false;
  stOpts.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${num(c.parsed.y)}` };
  make('c-steps', { type: 'bar', options: stOpts, data: { labels, datasets: [
    bar('Steps', rows.map((d) => d.steps ?? null), s[0]),
    ...(goals.some((g) => g != null) ? [{ type: 'line', label: 'Goal', data: goals, borderColor: muted, backgroundColor: muted, borderWidth: 1.5, borderDash: [4, 4], pointStyle: 'line', pointRadius: 0, pointHoverRadius: 0, stepped: 'middle', spanGaps: true }] : []),
  ] } });

  const hrs = (x) => (x == null ? null : Math.round((x / 3600) * 100) / 100);
  const staged = rows.some((d) => d.sleep?.deepS != null);
  const slOpts = chartBase(staged);
  slOpts.scales.y.ticks.callback = (v) => `${v}h`;
  slOpts.plugins.tooltip.callbacks = {
    label: (c) => ` ${c.dataset.label}: ${fmtDur(c.parsed.y * 3600)}`,
    footer: (items) => (staged ? `Asleep ${fmtDur(rows[items[0].dataIndex].sleep?.durationS)}` : ''),
  };
  make('c-sleep', { type: 'bar', options: slOpts, data: { labels, datasets: staged ? [
    bar('Deep', rows.map((d) => hrs(d.sleep?.deepS)), s[0]),
    bar('Light', rows.map((d) => hrs(d.sleep?.lightS)), s[1]),
    bar('REM', rows.map((d) => hrs(d.sleep?.remS)), s[2]),
  ] : [bar('Asleep', rows.map((d) => hrs(d.sleep?.durationS)), s[0])] } });

  const mOpts = chartBase(true);
  const grams = (key, i) => rows[i].macros?.[key];
  mOpts.plugins.tooltip.callbacks = {
    label: (c) => ` ${c.dataset.label}: ${num(grams(c.dataset.key, c.dataIndex))} g (${num(c.parsed.y)} kcal)`,
    footer: (items) => `Logged ${num(rows[items[0].dataIndex].macros?.kcal)} kcal`,
  };
  const macro = (label, key, perGram, color) => ({ ...bar(label, rows.map((d) => (d.macros?.[key] != null ? Math.round(d.macros[key] * perGram) : null)), color), key });
  make('c-macros', { type: 'bar', options: mOpts, data: { labels, datasets: [macro('Protein', 'protein', 4, s[0]), macro('Carbs', 'carbs', 4, s[1]), macro('Fat', 'fat', 9, s[2])] } });
}

// ---------- daily log ----------
function viewLog() {
  const rows = dayRows().reverse();
  const acts = Object.groupBy ? Object.groupBy(state.data.activities, (a) => a.date) : {};
  const cell = (v, text) => h('td', { class: v == null ? 'none' : null }, v == null ? '–' : text);
  return h('div', { class: 'view' },
    pageHead('Daily log', `${rangeText()}. Select a day for its workouts and photos.`, rangeControl()),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['Date', 'Weight kg', 'Steps', 'Sleep', 'kcal', 'Protein g', 'Carbs g', 'Fat g', 'Workouts', 'Photos'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', null, rows.map((d) => {
        const m = d.macros || {};
        const nPhotos = state.data.photos.filter((p) => p.date === d.date).length;
        const open = () => openDay(d.date);
        return h('tr', { tabindex: 0, onclick: open, onkeydown: (e) => { if (e.key === 'Enter') open(); } },
          h('td', null, fmtDay(d.date, { weekday: 'short', day: 'numeric', month: 'short' })),
          cell(d.weightKg, num(d.weightKg, 1)), cell(d.steps, num(d.steps)), cell(d.sleep?.durationS, fmtDur(d.sleep?.durationS)),
          cell(m.kcal, num(m.kcal)), cell(m.protein, num(m.protein)), cell(m.carbs, num(m.carbs)), cell(m.fat, num(m.fat)),
          cell((acts[d.date] || []).length || null, (acts[d.date] || []).map((a) => a.name).join(', ').slice(0, 40)),
          cell(nPhotos || null, String(nPhotos)));
      })))));
}

function workoutCard(a, withDate = true) {
  return h('div', { class: 'card workout' },
    h('span', { class: 'name' }, a.name),
    h('span', { class: 'meta' }, [withDate && fmtDay(a.date, { weekday: 'short', day: 'numeric', month: 'short' }), title(a.type)].filter(Boolean).join(' · ')),
    h('span', { class: 'stats' },
      h('span', null, h('b', null, fmtDur(a.durationS))),
      a.distanceM ? h('span', null, h('b', null, num(a.distanceM / 1000, 2)), ' km') : null,
      a.kcal ? h('span', null, h('b', null, num(a.kcal)), ' kcal') : null,
      a.avgHr ? h('span', null, h('b', null, num(a.avgHr)), ' bpm avg') : null));
}
function viewWorkouts() {
  const list = [...state.data.activities].sort((a, b) => (a.startLocal < b.startLocal ? 1 : -1));
  const total = list.reduce((s, a) => s + (a.durationS || 0), 0);
  return h('div', { class: 'view' },
    pageHead('Workouts', `${list.length} sessions, ${fmtDur(total)} in total. ${rangeText()}.`, rangeControl()),
    list.length ? h('div', { class: 'list' }, list.map((a) => workoutCard(a))) : h('p', { class: 'card empty' }, 'No workouts recorded in this period.'));
}

// ---------- dialogs ----------
function dialog(titleText, body) {
  const dlg = h('dialog', null,
    h('div', { class: 'dlg-head' }, h('h2', null, titleText), h('button', { class: 'btn ghost', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    h('div', { class: 'dlg-body' }, body));
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}
const kindTag = (p) => [h('span', { class: 'tag' }, p.kind === 'meal' ? 'Meal' : 'Progress'), p.pose ? h('span', { class: 'tag' }, title(p.pose)) : null];
function thumb(p) {
  return h('button', { class: 'thumb', onclick: () => openPhoto(p), 'aria-label': `${p.kind} photo from ${fmtLong(p.date)}` },
    h('img', { src: photoUrl(p), loading: 'lazy', alt: '' }), h('span', { class: 'cap' }, kindTag(p)));
}

function openDay(date) {
  const d = state.data.days.find((x) => x.date === date) || { date };
  const m = d.macros;
  const acts = state.data.activities.filter((a) => a.date === date);
  const photos = state.data.photos.filter((p) => p.date === date);
  const stat = (label, value) => h('span', null, `${label} `, h('b', null, value));
  let dlg;
  const macroForm = () => {
    const f = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      await busy(f.querySelector('button'), async () => { await api(`/days/${date}/macros`, { method: 'PUT', body: v }); dlg.close(); await refresh(); toast('Saved'); });
    } },
      h('div', { class: 'row' }, [['kcal', 'Calories'], ['protein', 'Protein g'], ['carbs', 'Carbs g'], ['fat', 'Fat g']].map(([k, l]) =>
        h('label', null, l, h('input', { type: 'number', name: k, min: 0, step: 'any', required: true, value: m?.[k] ?? '' })))),
      h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'Save by hand'),
        m?.source === 'manual' ? h('button', { class: 'btn', type: 'button', onclick: async (e) => busy(e.target, async () => { await api(`/days/${date}/macros`, { method: 'DELETE' }); dlg.close(); await refresh(); toast('Cleared; the next sync refills it'); }) }, 'Clear and use MyFitnessPal') : null));
    return f;
  };
  dlg = dialog(fmtLong(date), [
    h('div', null, h('div', { class: 'label' }, 'Body and activity'), h('div', { class: 'stats' },
      stat('Weight', d.weightKg != null ? `${num(d.weightKg, 1)} kg` : '–'), d.fatPct != null ? stat('Body fat', `${num(d.fatPct, 1)}%`) : null,
      stat('Steps', num(d.steps)), stat('Sleep', fmtDur(d.sleep?.durationS)), d.sleep?.score != null ? stat('Sleep score', num(d.sleep.score)) : null)),
    h('div', null, h('div', { class: 'label' }, `Food${m?.source === 'manual' ? ' (entered by hand)' : ''}`),
      m ? h('div', { class: 'stats' }, stat('Calories', num(m.kcal)), stat('Protein', `${num(m.protein)} g`), stat('Carbs', `${num(m.carbs)} g`), stat('Fat', `${num(m.fat)} g`)) : h('p', { class: 'help' }, 'Nothing logged.'),
      isOwner() ? h('details', null, h('summary', null, 'Enter or correct by hand'), macroForm()) : null),
    h('div', null, h('div', { class: 'label' }, 'Workouts'), acts.length ? h('div', { class: 'list' }, acts.map((a) => workoutCard(a, false))) : h('p', { class: 'help' }, 'No workout recorded.')),
    h('div', null, h('div', { class: 'label' }, 'Photos'), photos.length ? h('div', { class: 'grid' }, photos.map(thumb)) : h('p', { class: 'help' }, 'No photos for this day.'),
      h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn', onclick: () => { dlg.close(); openUpload(date); } }, icon('upload'), 'Add photos for this day'))),
  ]);
}

function tagFields(p = {}) {
  const kind = h('select', { name: 'kind' }, h('option', { value: 'progress' }, 'Progress photo'), h('option', { value: 'meal' }, 'Meal photo'));
  const pose = h('select', { name: 'pose' }, h('option', { value: '' }, 'Not set'), ['front', 'side', 'back'].map((x) => h('option', { value: x }, title(x))));
  kind.value = p.kind || 'progress'; pose.value = p.pose || '';
  const poseLabel = h('label', null, 'Pose', pose);
  const syncPose = () => { poseLabel.hidden = kind.value !== 'progress'; };
  kind.addEventListener('change', syncPose); syncPose();
  return [h('div', { class: 'row' }, h('label', null, 'Type', kind), poseLabel),
    h('label', null, 'Note (optional)', h('textarea', { class: 'plain', name: 'note', maxLength: 500, value: p.note || '' }))];
}

function openPhoto(p) {
  let dlg;
  const form = canEdit(p) ? h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    await busy(form.querySelector('button'), async () => { await api(`/photos/${p.id}`, { method: 'PATCH', body: v }); dlg.close(); await refresh(); toast('Photo updated'); });
  } },
    h('label', null, 'Date taken', h('input', { type: 'date', name: 'date', value: p.date, max: addDays(state.me.today, 1), required: true })),
    tagFields(p),
    h('div', { class: 'row' }, h('button', { class: 'btn primary' }, 'Save changes'),
      h('button', { class: 'btn danger', type: 'button', onclick: async (e) => { if (!confirm('Delete this photo for everyone? This cannot be undone.')) return; await busy(e.currentTarget, async () => { await api(`/photos/${p.id}`, { method: 'DELETE' }); dlg.close(); await refresh(); toast('Photo deleted'); }); } }, icon('trash'), 'Delete'))) : null;
  dlg = dialog(fmtLong(p.date), [
    h('div', { class: 'viewer' }, h('img', { src: photoUrl(p), alt: `${p.kind} photo` })),
    h('div', { class: 'row' }, kindTag(p), h('span', { class: 'help' }, `Added by ${p.uploadedBy === 'owner' ? 'the owner' : 'the trainer'}`)),
    p.note ? h('p', null, p.note) : null,
    form ? h('details', null, h('summary', null, 'Change date, type or note'), form) : null,
  ]);
}

/** Shrinks a photo in the browser so uploads are quick and small; returns a JPEG blob. */
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = h('canvas', { width: Math.round(bmp.width * scale), height: Math.round(bmp.height * scale) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
    if (blob) return blob;
  } catch { /* fall through to the original file */ }
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  throw new Error(`"${file.name}" is not a photo format this page can read. Try a JPEG.`);
}
const fileDate = (f) => { const d = new Date(f.lastModified || Date.now()); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

function openUpload(presetDate) {
  const rows = h('div', { class: 'stack', style: 'max-width:none;margin:0' });
  const picker = h('input', { type: 'file', accept: 'image/*', multiple: true, required: true, onchange: () => {
    rows.replaceChildren(...[...picker.files].map((f, i) => h('div', { class: 'upload-row' },
      h('img', { src: URL.createObjectURL(f), alt: '' }),
      h('label', null, `Date taken: ${f.name}`.slice(0, 60), h('input', { type: 'date', name: `date-${i}`, required: true, max: addDays(state.me.today, 1), value: presetDate || fileDate(f) })))));
  } });
  const status = h('p', { class: 'help', role: 'status' });
  let dlg;
  const form = h('form', { class: 'stack', style: 'max-width:none;margin:0', onsubmit: async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const files = [...picker.files];
    await busy(form.querySelector('button.primary'), async () => {
      for (const [i, f] of files.entries()) {
        status.textContent = `Uploading ${i + 1} of ${files.length}…`;
        const blob = await shrink(f);
        const q = new URLSearchParams({ date: v[`date-${i}`], kind: v.kind, pose: v.kind === 'progress' ? v.pose : '', note: v.note });
        await api(`/photos?${q}`, { method: 'POST', raw: blob, type: blob.type });
      }
      dlg.close(); state.tab = 'photos'; await refresh(); toast(`${files.length} photo${files.length > 1 ? 's' : ''} added`);
    });
    status.textContent = '';
  } },
    h('label', null, 'Photos', picker), rows, tagFields(),
    h('p', { class: 'help' }, 'Each photo is filed under its date. The date is pre-filled from the photo file; change it if it is wrong.'),
    status, h('div', { class: 'row' }, h('button', { class: 'btn primary' }, icon('upload'), 'Upload')));
  dlg = dialog('Add photos', form);
}

function openCompare() {
  const progress = state.data.photos.filter((p) => p.kind === 'progress');
  const dates = [...new Set(progress.map((p) => p.date))].sort();
  const sel = (value) => { const s = h('select', null, dates.map((d) => h('option', { value: d }, fmtLong(d)))); s.value = value; return s; };
  const a = sel(dates[0]), b = sel(dates.at(-1));
  const pose = h('select', null, h('option', { value: '' }, 'Any pose'), ['front', 'side', 'back'].map((x) => h('option', { value: x }, title(x))));
  const out = h('div', { class: 'compare' });
  const col = (date) => {
    const day = state.data.days.find((d) => d.date === date);
    const ps = progress.filter((p) => p.date === date && (!pose.value || p.pose === pose.value));
    return h('div', null, h('div', { class: 'label' }, fmtDay(date, { day: 'numeric', month: 'short', year: 'numeric' })),
      h('p', { class: 'help' }, day?.weightKg != null ? `${num(day.weightKg, 1)} kg` : 'No weigh-in in the loaded range'),
      ps.length ? ps.map((p) => h('img', { src: photoUrl(p), alt: `${p.pose || 'progress'} photo` })) : h('p', { class: 'help' }, 'No photo with this pose.'));
  };
  const draw = () => out.replaceChildren(col(a.value), col(b.value));
  [a, b, pose].forEach((s) => s.addEventListener('change', draw));
  dialog('Compare progress photos', [h('div', { class: 'row' }, h('label', null, 'Before', a), h('label', null, 'After', b), h('label', null, 'Pose', pose)), out]);
  draw();
}

// ---------- photos ----------
function viewPhotos() {
  const all = state.data.photos;
  const shown = all.filter((p) => state.photoFilter === 'all' || p.kind === state.photoFilter);
  const dates = [...new Set(shown.map((p) => p.date))].sort().reverse();
  const hasTwoProgressDates = new Set(all.filter((p) => p.kind === 'progress').map((p) => p.date)).size > 1;
  return h('div', { class: 'view' },
    pageHead('Photos', `${all.length} photo${all.length === 1 ? '' : 's'}. You and your trainer can both add photos and set their dates.`,
      hasTwoProgressDates ? h('button', { class: 'btn', onclick: openCompare }, icon('compare'), 'Compare') : null,
      h('button', { class: 'btn primary', onclick: () => openUpload() }, icon('upload'), 'Add photos')),
    h('div', { class: 'toolbar' }, h('div', { class: 'seg', role: 'group', 'aria-label': 'Photo type' }, [['all', 'All'], ['progress', 'Progress'], ['meal', 'Meals']].map(([id, label]) =>
      h('button', { 'aria-pressed': String(state.photoFilter === id), onclick: () => { state.photoFilter = id; render(); } }, label)))),
    dates.length ? dates.map((date) => {
      const day = state.data.days.find((d) => d.date === date);
      return h('section', { class: 'date-group' }, h('h3', null, fmtLong(date), day?.weightKg != null ? h('span', null, `${num(day.weightKg, 1)} kg`) : null),
        h('div', { class: 'grid' }, shown.filter((p) => p.date === date).map(thumb)));
    }) : h('p', { class: 'card empty' }, 'No photos yet. Use "Add photos" to upload the first one.'));
}

// ---------- settings (owner) ----------
const SOURCE_NAMES = { garmin: 'Garmin', withings: 'Withings', mfp: 'MyFitnessPal' };
function pill(c) {
  const map = { ok: ['ok', 'check', 'Connected'], pending: ['', 'dot', 'Connected, not synced yet'], needs_login: ['warn', 'alert', 'Sign in again'], error: ['bad', 'alert', 'Error'], not_connected: ['', 'dot', 'Not connected'] };
  const [cls, ic, text] = map[c.status] || map.not_connected;
  return h('span', { class: `pill ${cls}` }, icon(ic), text);
}
function viewSettings() {
  const c = state.me.connections;
  const link = `${location.origin}/#k=${state.me.trainerKey}`;
  const after = async (res) => { state.me.connections = res.connections; await loadData(); render(); const r = res.result; toast(r?.status === 'ok' ? 'Connected and synced' : r?.message || 'Saved'); };
  const disconnect = (name) => c[name].connected ? h('button', { class: 'btn danger', type: 'button', onclick: async (e) => { if (!confirm(`Disconnect ${SOURCE_NAMES[name]}? Data already collected stays.`)) return; await busy(e.currentTarget, async () => { state.me.connections = (await api(`/connections/${name}`, { method: 'DELETE' })).connections; render(); }); } }, 'Disconnect') : null;
  const card = (name, what, ...body) => h('div', { class: 'card' },
    h('div', { class: 'head' }, h('h3', null, SOURCE_NAMES[name]), pill(c[name])),
    h('p', null, what, c[name].lastOkAt ? ` Last successful sync ${fmtAgo(c[name].lastOkAt)}.` : ''),
    c[name].message ? h('p', { class: 'msg' }, c[name].message) : null, body);
  const submit = (path, form) => async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(form)); await busy(form.querySelector('button'), async () => after(await api(path, { method: 'POST', body: v }))); };

  const gForm = h('form', { class: 'stack' });
  gForm.append(h('div', { class: 'row' }, h('label', null, 'Garmin email', h('input', { type: 'email', name: 'email', autocomplete: 'off', required: true })), h('label', null, 'Garmin password', h('input', { type: 'password', name: 'password', autocomplete: 'off', required: true }))),
    h('p', { class: 'help' }, 'Used once to sign in. The password is not stored; only the login token Garmin returns is kept.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary' }, c.garmin.connected ? 'Sign in again' : 'Sign in to Garmin'), disconnect('garmin')));
  gForm.onsubmit = submit('/connections/garmin', gForm);
  const tForm = h('form', { class: 'stack' });
  tForm.append(h('label', null, 'Text printed by scripts/garmin-login.js', h('textarea', { name: 'tokens', required: true, spellcheck: false })), h('div', { class: 'row' }, h('button', { class: 'btn' }, 'Save Garmin login')));
  tForm.onsubmit = submit('/connections/garmin', tForm);

  const mForm = h('form', { class: 'stack' });
  mForm.append(h('label', null, 'MyFitnessPal username', h('input', { type: 'text', name: 'username', autocomplete: 'off', value: c.mfp.username || '' })),
    h('label', null, `Session cookie${c.mfp.hasCookie ? ' (one is saved; paste a new one to replace it)' : ' (only needed if your diary is not public)'}`, h('textarea', { name: 'cookie', spellcheck: false })),
    h('p', { class: 'help' }, 'Easiest: in MyFitnessPal go to Settings, Diary Settings, Diary Sharing and choose Public; then only the username is needed. To keep the diary private instead, log in at myfitnesspal.com on a computer, open the browser developer tools, find the cookie named __Secure-next-auth.session-token and paste its value here. It expires from time to time and this page will then ask for a new one.'),
    h('div', { class: 'row' }, h('button', { class: 'btn primary' }, c.mfp.connected ? 'Save and test' : 'Connect MyFitnessPal'), disconnect('mfp')));
  mForm.onsubmit = submit('/connections/mfp', mForm);

  const linkInput = h('input', { type: 'text', readOnly: true, value: link, 'aria-label': 'Trainer link', onfocus: (e) => e.target.select() });
  const syncBtn = (days, label, cls = '') => h('button', { class: `btn ${cls}`, onclick: async (e) => busy(e.currentTarget, async () => { const r = await api('/sync', { method: 'POST', body: { days } }); await refresh(); const failed = Object.entries(r.sources).filter(([, s]) => s.status === 'needs_login' || s.status === 'error').map(([n]) => SOURCE_NAMES[n]); toast(failed.length ? `Synced, but ${failed.join(' and ')} failed` : 'Synced'); }) }, cls ? icon('sync') : null, label);

  return h('div', { class: 'view' },
    pageHead('Settings', 'Only you see this tab. Your trainer sees everything else.'),
    h('div', { class: 'settings' },
      h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', null, 'Trainer link')),
        h('p', null, 'Anyone with this link can see your data and photos and add photos. Send it only to your trainer. Replacing it switches the old link off immediately.'),
        h('div', { class: 'stack' }, linkInput, h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { linkInput.focus(); toast('Press Ctrl+C to copy'); } } }, icon('copy'), 'Copy link'),
          h('button', { class: 'btn danger', onclick: async (e) => { if (!confirm('Replace the trainer link? The current link stops working straight away.')) return; await busy(e.currentTarget, async () => { state.me.trainerKey = (await api('/trainer-link/rotate', { method: 'POST' })).trainerKey; render(); toast('New link created'); }); } }, 'Replace link')))),
      h('div', { class: 'card' }, h('div', { class: 'head' }, h('h3', null, 'Sync')),
        h('p', null, `Runs by itself three times a day (${state.me.timezone} time) and re-reads the last 4 days each time. Last run ${fmtAgo(state.me.lastSyncAt)}.`),
        h('div', { class: 'row', style: 'margin-top:12px' }, syncBtn(4, 'Sync now', 'primary'), syncBtn(30, 'Re-read 30 days'), syncBtn(90, 'Re-read 90 days'))),
      card('garmin', 'Steps and workouts from your Garmin watch.', gForm,
        h('details', null, h('summary', null, 'Garmin refuses the sign-in?'), h('p', { class: 'help', style: 'margin-top:8px' }, 'Garmin sometimes blocks sign-ins from cloud servers. Run "node scripts/garmin-login.js" on your own computer, then paste what it prints.'), tForm)),
      card('withings', 'Weight, body fat and sleep, through the official Withings sign-in.',
        h('div', { class: 'row', style: 'margin-top:12px' }, h('button', { class: 'btn primary', onclick: async (e) => busy(e.currentTarget, async () => { location.href = (await api('/connections/withings/start', { method: 'POST' })).url; }) }, c.withings.connected ? 'Sign in again' : 'Connect Withings'), disconnect('withings'))),
      card('mfp', 'Calories and macros, read from your MyFitnessPal food diary.', mForm)));
}

// ---------- boot ----------
(async function boot() {
  state.key = readKey();
  if (!state.key) return gate();
  const q = new URLSearchParams(location.search);
  const withings = q.get('withings');
  if (withings) history.replaceState(null, '', location.pathname + location.hash);
  try {
    await refresh();
    if (withings === 'connected' && isOwner()) {
      state.tab = 'settings'; render(); toast('Withings connected. Reading the last 30 days…');
      await api('/sync', { method: 'POST', body: { days: 30 } }); await refresh();
    } else if (withings === 'failed') { state.tab = isOwner() ? 'settings' : state.tab; render(); toast('Withings sign-in did not complete. Try again.'); }
  } catch (e) {
    if (!document.querySelector('.gate')) gate(`Could not load the dashboard: ${e.message}`);
  }
})();
