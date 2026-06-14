// The eleatic comparison hub — framework-free vanilla ESM, NO build step.
//
// Renders the landing page served at `GET /`:
//   1. A union-of-metrics table over `GET /api/runs`. Columns are the UNION of
//      every run's `metrics_json` keys (generic — eleatic invents no fixed
//      agreement/falseKeep columns). Each cell is rendered with the per-metric
//      formatter named in /config.js (percent/usd/integer/raw). A configurable
//      gate badge ({metric,op,threshold} from /config.js) shows PASS/fail per
//      run; the run named by `baseline` carries a ★ marker. Each row also carries
//      an "Explore rows →" link to `/facets?run=<id>` — the single-run path into
//      the row gallery + drilldown drawer (compare needs two runs; explore one).
//   2. A "compare 2" affordance: a checkbox per row, exactly two selectable,
//      enabling a "Compare →" link to `/diff?a=<id>&b=<id>` (the E4 diff route).
//   3. Inline-SVG trends from `GET /api/trends?metric=<m>`: ONE <polyline> per
//      run-label group (no chart dependency — the geometry comes from
//      format.js#mapPoints). A metric picker switches the trended metric.
//
// State (selected metric for trends, the up-to-2 compare selection) is synced to
// the URL query string so a view is shareable / reload-safe.
//
// Event handling: a SINGLE delegated listener on the table container reads
// `data-*` off the event target (deliberately improving on photo-curation's
// eval.js, which binds one click listener PER ROW inside its render loop). One
// listener survives full re-renders and scales to the epic's 150–1000-row range.

import { initTheme, toggleTheme } from './theme.js';
import { esc, setImageHostAllowlist } from './safe.js';
import { formatMetric, evalGate, mapPoints } from './format.js';
import { config } from '/config.js';

// ── Boot ──
initTheme();
setImageHostAllowlist(config.imageHostAllowlist);
const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) themeBtn.addEventListener('click', toggleTheme);

const params = new URLSearchParams(location.search);
// Compare selection: up to two run ids carried in the URL (?sel=a,b).
let selected = (params.get('sel') ?? '').split(',').filter(Boolean).slice(0, 2);
// The metric currently trended (?trend=<metric>); resolved against the data once loaded.
let trendMetric = params.get('trend') ?? '';

let runs = [];

// ── Pure helpers over the loaded runs ──

/** The sorted union of every run's metrics_json keys (generic columns). */
function unionMetricKeys(runList) {
  const keys = new Set();
  for (const run of runList) {
    for (const k of Object.keys(run.metrics ?? {})) keys.add(k);
  }
  return [...keys].sort();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
// A small categorical palette for the per-label trend lines (CSS var on line 0,
// then explicit hues). Distinct enough at the 2–6 series the hub targets.
const SERIES_COLORS = ['var(--accent)', '#d97706', '#15803d', '#9333ea', '#dc2626', '#0891b2'];

// ── URL sync ──
function syncUrl() {
  const next = new URLSearchParams(location.search);
  if (selected.length > 0) next.set('sel', selected.join(','));
  else next.delete('sel');
  if (trendMetric) next.set('trend', trendMetric);
  else next.delete('trend');
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ── Runs table ──
function renderRunsTable() {
  const host = document.getElementById('runs');
  const metricKeys = unionMetricKeys(runs);

  if (runs.length === 0) {
    host.innerHTML =
      '<p class="empty">No eval runs yet — ingest a run with <code>eleatic ingest</code>.</p>';
    return;
  }

  const head = `
    <th class="col-select" scope="col"><span class="visually-hidden">compare</span></th>
    <th scope="col">Run</th>
    <th scope="col">Started</th>
    <th class="num" scope="col">Rows</th>
    ${metricKeys.map((k) => `<th class="num" scope="col">${esc(k)}</th>`).join('')}
    ${config.gate ? '<th scope="col">Gate</th>' : ''}`;

  const rows = runs
    .map((run) => {
      const isSel = selected.includes(run.id);
      const isBaseline = run.baseline !== undefined && run.baseline === run.id;
      const metricCells = metricKeys
        .map(
          (k) =>
            `<td class="num">${esc(formatMetric(run.metrics?.[k], config.metricFormatters?.[k]))}</td>`,
        )
        .join('');
      let gateCell = '';
      if (config.gate) {
        const verdict = evalGate(config.gate, run.metrics);
        gateCell =
          verdict === undefined
            ? '<td><span class="gate-badge gate-none">n/a</span></td>'
            : `<td><span class="gate-badge ${verdict === 'PASS' ? 'gate-pass' : 'gate-fail'}">${esc(verdict)}</span></td>`;
      }
      // Disable the checkbox for unselected rows once two are picked.
      const disabled = !isSel && selected.length >= 2 ? 'disabled' : '';
      return `
        <tr class="run-row${isSel ? ' selected' : ''}" data-run-id="${esc(run.id)}">
          <td class="col-select">
            <input type="checkbox" class="run-select" data-run-id="${esc(run.id)}"
                   ${isSel ? 'checked' : ''} ${disabled}
                   aria-label="Select ${esc(run.label)} to compare" />
          </td>
          <td class="run-label">${esc(run.label)}${isBaseline ? '<span class="baseline-star" title="baseline">★</span>' : ''}<div class="run-id">${esc(run.id)}</div><a class="explore-link" href="/facets?run=${encodeURIComponent(run.id)}" aria-label="Explore rows of ${esc(run.label)}">Explore rows →</a></td>
          <td>${esc(run.startedAt)}</td>
          <td class="num">${esc(formatMetric(run.rowCount, 'integer'))}</td>
          ${metricCells}
          ${gateCell}
        </tr>`;
    })
    .join('');

  host.innerHTML = `
    <div class="table-scroll">
      <table class="runs-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// ── Compare bar ──
function renderCompareBar() {
  const bar = document.getElementById('compare-bar');
  if (runs.length < 2) {
    bar.innerHTML = '';
    return;
  }
  const ready = selected.length === 2;
  const hint = ready
    ? `Comparing ${selected.length} runs`
    : `Select ${2 - selected.length} more run${selected.length === 1 ? '' : 's'} to compare`;
  const href = ready
    ? `/diff?a=${encodeURIComponent(selected[0])}&b=${encodeURIComponent(selected[1])}`
    : '';
  bar.innerHTML = `
    <span class="compare-hint">${esc(hint)}</span>
    ${
      ready
        ? `<a class="compare-btn" href="${esc(href)}">Compare →</a>`
        : '<span class="compare-btn" aria-disabled="true">Compare →</span>'
    }`;
}

// ── Trends (inline SVG, one polyline per label group) ──
async function renderTrends() {
  const section = document.getElementById('trends');
  const metricKeys = unionMetricKeys(runs);
  if (runs.length === 0 || metricKeys.length === 0) {
    section.innerHTML = '<p class="trend-empty">No run-level metrics to trend yet.</p>';
    return;
  }
  if (!metricKeys.includes(trendMetric)) trendMetric = metricKeys[0];

  // Metric picker.
  const picker = `
    <div class="trend-controls">
      <label for="trend-metric">Trend metric</label>
      <select id="trend-metric">
        ${metricKeys.map((k) => `<option value="${esc(k)}"${k === trendMetric ? ' selected' : ''}>${esc(k)}</option>`).join('')}
      </select>
    </div>`;

  // Fetch the trend for the active metric (all runs, oldest→newest).
  let trend = [];
  try {
    const res = await fetch(`/api/trends?metric=${encodeURIComponent(trendMetric)}`);
    if (res.ok) trend = (await res.json()).trend ?? [];
  } catch {
    trend = [];
  }

  // Join trend points to run labels, then group into one series per label.
  const labelOf = new Map(runs.map((r) => [r.id, r.label]));
  const seriesByLabel = new Map();
  for (const point of trend) {
    const label = labelOf.get(point.runId) ?? point.runId;
    if (!seriesByLabel.has(label)) seriesByLabel.set(label, []);
    // null-value points are gaps; mapPoints drops them but keeps the x slot.
    seriesByLabel.get(label).push(point.value ?? null);
  }

  const box = { width: 240, height: 60, pad: 6 };
  const fmt = config.metricFormatters?.[trendMetric];
  const labels = [...seriesByLabel.keys()];

  const lines = labels
    .map((label, idx) => {
      const color = SERIES_COLORS[idx % SERIES_COLORS.length];
      const pts = mapPoints(seriesByLabel.get(label), box);
      if (pts.length === 0) {
        return `<svg class="trend-svg" viewBox="0 0 ${box.width} ${box.height}" role="img" aria-label="${esc(label)}: no data"></svg>`;
      }
      const polyPts = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
      const dots = pts
        .map((p) => `<circle class="trend-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" style="fill:${color}" />`)
        .join('');
      const last = seriesByLabel.get(label).filter((v) => typeof v === 'number').pop();
      const lastLabel = last === undefined ? '—' : formatMetric(last, fmt);
      return `
        <svg class="trend-svg" viewBox="0 0 ${box.width} ${box.height}" role="img"
             aria-label="${esc(label)} ${esc(trendMetric)} trend, latest ${esc(lastLabel)}">
          <polyline class="trend-line" points="${polyPts}" style="stroke:${color}" />
          ${dots}
        </svg>`;
    })
    .join('');

  const legend = labels
    .map(
      (label, idx) =>
        `<span class="trend-swatch"><i style="background:${SERIES_COLORS[idx % SERIES_COLORS.length]}"></i>${esc(label)}</span>`,
    )
    .join('');

  section.innerHTML = `
    ${picker}
    <div class="trend-card">
      <p class="trend-metric">${esc(trendMetric)} over time</p>
      ${lines || '<p class="trend-empty">No data for this metric.</p>'}
      <div class="trend-legend">${legend}</div>
    </div>`;

  // Re-bind the picker (innerHTML replaced its node).
  const sel = document.getElementById('trend-metric');
  if (sel) {
    sel.addEventListener('change', (e) => {
      trendMetric = e.target.value;
      syncUrl();
      renderTrends();
    });
  }
}

// ── Single delegated table listener (NOT one per row) ──
//
// Bound ONCE to the persistent #runs container. It survives every re-render of
// the table's innerHTML and reads the acted-on run id from the target's
// data-run-id. Improves on photo-curation eval.js, which binds a click listener
// inside its per-row render loop (re-created on every render, O(rows) listeners).
function onRunsChange(e) {
  const cb = e.target.closest('.run-select');
  if (!cb) return;
  const id = cb.getAttribute('data-run-id');
  if (!id) return;
  if (cb.checked) {
    if (!selected.includes(id) && selected.length < 2) selected.push(id);
  } else {
    selected = selected.filter((s) => s !== id);
  }
  syncUrl();
  renderRunsTable();
  renderCompareBar();
}

function bindDelegation() {
  const host = document.getElementById('runs');
  // `change` fires for the checkbox inputs; one handler, read data-* off target.
  host.addEventListener('change', onRunsChange);
}

// ── Load ──
async function load() {
  try {
    const res = await fetch('/api/runs');
    runs = res.ok ? (await res.json()).runs ?? [] : [];
  } catch {
    runs = [];
  }
  // Drop any URL-carried selection that names a run that no longer exists.
  const known = new Set(runs.map((r) => r.id));
  selected = selected.filter((id) => known.has(id)).slice(0, 2);
  syncUrl();

  renderRunsTable();
  renderCompareBar();
  await renderTrends();
}

bindDelegation();
load();
