// The per-row run-diff controller (E6) — framework-free vanilla ESM, no build.
//
// Renders `/diff?a=<a>&b=<b>`: one row per `row_key` from `GET /api/diff?a=&b=`
// (E4, which returns E2's `RunDiff[]`). For each row it derives, via the
// diff-classify pure unit, a classification (regression | improvement | unchanged
// | new | removed), shows whether each side matched its expected_json, counts the
// run-level regressions, and deep-links into the shared drawer.
//
// Matched-ness of a side = its OPAQUE output_json deep-equals its expected_json.
// The blobs are never destructured — equality is a stable-key JSON compare.
// Divergence = run A's output differs from run B's output.
//
// Drawer deep-link: a row opens the drawer via `&row=<b>:<row_key>` — the
// `run:rowKey` deep-link resolved to candidate run `b` (the diff URL has `a`/`b`
// but no single `run`; see drawer.js's run-resolution rule). EVENT DELEGATION:
// ONE listener on #diff-body reading data-* off the target — NOT per-row binding
// (eval.js's per-row addEventListener is the anti-pattern this view corrects; the
// 150–1000-row scale forbids it).

import { initTheme, toggleTheme } from './theme.js';
import { esc, setImageHostAllowlist } from './safe.js';
import { classifyRow } from './diff-classify.js';
import { openDrawer } from './drawer.js';
import { config } from '/config.js';

// ── Boot ──
initTheme();
setImageHostAllowlist(config.imageHostAllowlist);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const params = new URLSearchParams(location.search);
const a = params.get('a') ?? '';
const b = params.get('b') ?? '';

let rows = []; // [{ rowKey, classification, aPresent, bPresent, aMatched, bMatched }]
let divergentOnly = params.get('divergent') === '1';

/** Stable, key-sorted JSON serialization so {a,b} and {b,a} compare equal. */
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** Did a side's output match its expected? (both present required upstream). */
function matched(side) {
  if (!side) return false;
  return stableStringify(side.output) === stableStringify(side.expected);
}

const CLASS_LABEL = {
  regression: 'regression',
  improvement: 'improvement',
  unchanged: 'unchanged',
  new: 'new',
  removed: 'removed',
};

function deriveRows(diff) {
  return diff.map((d) => {
    const aPresent = d.a !== undefined;
    const bPresent = d.b !== undefined;
    const aMatched = matched(d.a);
    const bMatched = matched(d.b);
    const diverged =
      aPresent && bPresent && stableStringify(d.a.output) !== stableStringify(d.b.output);
    const classification = classifyRow({ aPresent, bPresent, aMatched, bMatched, diverged });
    return { rowKey: d.rowKey, classification, aPresent, bPresent, aMatched, bMatched, diverged };
  });
}

function check(present, isMatched) {
  if (!present) return '<span class="diff-absent" title="absent in this run">—</span>';
  return isMatched
    ? '<span class="diff-match" title="matched expected">✓</span>'
    : '<span class="diff-miss" title="did not match expected">✗</span>';
}

function render() {
  const body = document.getElementById('diff-body');
  const shown = divergentOnly ? rows.filter((r) => r.classification !== 'unchanged') : rows;

  if (rows.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No rows to diff for these runs.</td></tr>';
    return;
  }
  if (shown.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No divergent rows.</td></tr>';
    return;
  }

  body.innerHTML = shown
    .map(
      (r) => `
        <tr class="diff-row class-${esc(r.classification)}">
          <td class="diff-rowkey"><code>${esc(r.rowKey)}</code></td>
          <td class="diff-side">${check(r.aPresent, r.aMatched)}</td>
          <td class="diff-side">${check(r.bPresent, r.bMatched)}</td>
          <td><span class="diff-class diff-class-${esc(r.classification)}">${esc(CLASS_LABEL[r.classification] ?? r.classification)}</span></td>
          <td class="diff-open">
            <button type="button" class="diff-open-btn" data-row-key="${esc(r.rowKey)}" aria-label="Open detail for ${esc(r.rowKey)}">Open ›</button>
          </td>
        </tr>`,
    )
    .join('');
}

function renderSummary() {
  const summary = document.getElementById('summary');
  const badge = document.getElementById('regression-count');
  const regressions = rows.filter((r) => r.classification === 'regression').length;
  const improvements = rows.filter((r) => r.classification === 'improvement').length;
  summary.textContent = `${rows.length} rows · ${regressions} regression${regressions === 1 ? '' : 's'} · ${improvements} improvement${improvements === 1 ? '' : 's'}`;
  badge.textContent = `${regressions} regression${regressions === 1 ? '' : 's'}`;
  badge.classList.toggle('diff-regression-zero', regressions === 0);
}

function syncUrl() {
  const next = new URLSearchParams(location.search);
  if (a) next.set('a', a);
  if (b) next.set('b', b);
  if (divergentOnly) next.set('divergent', '1');
  else next.delete('divergent');
  const qs = next.toString();
  history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
}

// ── Single delegated listener on #diff-body (NOT one per row) ──
function bindDelegation() {
  const body = document.getElementById('diff-body');
  body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.diff-open-btn');
    if (!btn) return;
    const rowKey = btn.getAttribute('data-row-key');
    if (!rowKey) return;
    // Resolve the drawer run to b (candidate side) and bake it into the deep-link.
    const next = new URLSearchParams(location.search);
    next.set('row', `${b}:${rowKey}`);
    history.replaceState(null, '', `?${next.toString()}`);
    openDrawer(`${b}:${rowKey}`, btn);
  });

  document.getElementById('divergent-only')?.addEventListener('change', (ev) => {
    divergentOnly = ev.target.checked;
    syncUrl();
    render();
  });
}

async function load() {
  const summary = document.getElementById('summary');
  if (!a || !b) {
    summary.textContent = 'Provide ?a=<run>&b=<run> to compare two runs.';
    document.getElementById('diff-body').innerHTML =
      '<tr><td colspan="5" class="empty">No runs selected. Pick two runs on the hub.</td></tr>';
    return;
  }
  let diff = [];
  try {
    const res = await fetch(`/api/diff?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
    if (res.ok) {
      diff = (await res.json()).diff ?? [];
    } else {
      const err = await res.json().catch(() => ({}));
      summary.textContent = err.error ?? 'Could not load the diff.';
    }
  } catch {
    summary.textContent = 'Network error loading the diff.';
  }
  rows = deriveRows(diff);
  const cb = document.getElementById('divergent-only');
  if (cb) cb.checked = divergentOnly;
  renderSummary();
  render();

  // Reopen the drawer if the URL carries a row deep-link (deep-link / reload).
  const rowParam = params.get('row');
  if (rowParam) openDrawer(rowParam, null);
}

bindDelegation();
load();
