// The deep-linkable drill-down drawer — shared by diff.js and facets.js.
//
// A drawer is opened from a diff row or a facet card by a `&row=<run>:<row_key>`
// deep-link (the colon-joined pair makes the link self-contained regardless of
// which view opened it). On `&row=` present in the URL — on load OR after a click
// — we fetch `GET /api/row?run=<run>&row=<row_key>` (E4) and render:
//   • side-by-side PRETTY-PRINTED output_json / expected_json (OPAQUE blobs — the
//     package never destructures them; rendered via the escaping prettyJson unit),
//   • a score bar per scores_json entry,
//   • the row's metadata,
//   • a collapsible "Trace" section (after output-vs-expected) when the row
//     carries a trace — rendered by the escaping renderTrace pure unit; absent
//     entirely when the single-row read returned no trace,
//   • the image via safeImg,
//   • the adjudication panel (adjudicate.js).
//
// RUN RESOLUTION (the canonical API contract). The diff URL carries `a`/`b` but
// no single `run`, and `/api/row` returns 400 on a missing run. So the OPENING
// side resolves the run and bakes it into the `&row=<run>:<row_key>` deep-link:
//   • from the DIFF view → run = b (the candidate / right-hand side),
//   • from the FACETS / hub view → the page's `run`.
// The drawer simply splits `<run>:<row_key>` off the deep-link — it never has to
// know which view opened it.
//
// A11y: closing removes `&row=` from the URL and returns focus to the element
// that opened the drawer (passed to openDrawer). Escape + the backdrop close it.
//
// Browser-only glue (DOM + fetch); no unit test — the logic lives in the
// prettyJson / renderTrace / staleness pure units. Verified live at the epic's
// E2E recipe.

import { esc, safeImg } from './safe.js';
import { prettyJson } from './pretty.js';
import { renderTrace } from './trace.js';
import { renderAdjudication } from './adjudicate.js';

let lastTrigger = null;

/** Split a `<run>:<row_key>` deep-link on the FIRST colon (a row_key may itself contain colons). */
export function splitRowParam(raw) {
  if (typeof raw !== 'string' || raw === '') return null;
  const colon = raw.indexOf(':');
  if (colon === -1) return null;
  const run = raw.slice(0, colon);
  const rowKey = raw.slice(colon + 1);
  if (run === '' || rowKey === '') return null;
  return { run, rowKey };
}

/** Lazily create (once) the drawer DOM scaffold and return its parts. */
function ensureScaffold() {
  let root = document.getElementById('drawer-root');
  if (root) {
    return {
      root,
      backdrop: root.querySelector('.drawer-backdrop'),
      panel: root.querySelector('.drawer-panel'),
      body: root.querySelector('.drawer-body'),
    };
  }
  root = document.createElement('div');
  root.id = 'drawer-root';
  root.className = 'drawer-root';
  root.hidden = true;
  root.innerHTML = `
    <div class="drawer-backdrop" tabindex="-1"></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="Row detail">
      <button type="button" class="drawer-close" aria-label="Close detail">×</button>
      <div class="drawer-body"></div>
    </aside>`;
  document.body.appendChild(root);
  const backdrop = root.querySelector('.drawer-backdrop');
  const panel = root.querySelector('.drawer-panel');
  const body = root.querySelector('.drawer-body');
  root.querySelector('.drawer-close').addEventListener('click', () => closeDrawer());
  backdrop.addEventListener('click', () => closeDrawer());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !root.hidden) closeDrawer();
  });
  return { root, backdrop, panel, body };
}

/** A horizontal score bar (0..1 clamped) per scores_json entry. */
function scoreBars(scores) {
  const entries = Object.entries(scores ?? {});
  if (entries.length === 0) return '<p class="drawer-empty">No scores</p>';
  return entries
    .map(([k, v]) => {
      const num = typeof v === 'number' && Number.isFinite(v) ? v : 0;
      const pct = Math.max(0, Math.min(1, num)) * 100;
      return `
        <div class="score-row">
          <span class="score-key">${esc(k)}</span>
          <span class="score-track"><span class="score-fill" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="score-val">${esc(num)}</span>
        </div>`;
    })
    .join('');
}

/** Metadata key/value chips. */
function metadataChips(metadata) {
  const entries = Object.entries(metadata ?? {});
  if (entries.length === 0) return '<p class="drawer-empty">No metadata</p>';
  return entries
    .map(([k, v]) => `<span class="meta-chip"><span class="meta-key">${esc(k)}</span>${esc(v)}</span>`)
    .join('');
}

/**
 * Open the drawer for a `<run>:<row_key>` deep-link value.
 *
 * @param {string} rowParam  the `&row=` value, i.e. `<run>:<row_key>`
 * @param {HTMLElement|null} [trigger]  element to return focus to on close
 */
export async function openDrawer(rowParam, trigger = null) {
  const parsed = splitRowParam(rowParam);
  if (parsed === null) return;
  const { run, rowKey } = parsed;
  if (trigger) lastTrigger = trigger;

  const { root, panel, body } = ensureScaffold();
  root.hidden = false;
  body.innerHTML = '<p class="drawer-loading">Loading…</p>';
  panel.focus?.();

  let record;
  try {
    const res = await fetch(`/api/row?run=${encodeURIComponent(run)}&row=${encodeURIComponent(rowKey)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      body.innerHTML = `<p class="drawer-error">${esc(err.error ?? 'Could not load this row.')}</p>`;
      return;
    }
    record = (await res.json()).row;
  } catch {
    body.innerHTML = '<p class="drawer-error">Network error loading this row.</p>';
    return;
  }
  if (!record) {
    body.innerHTML = '<p class="drawer-error">Row not found.</p>';
    return;
  }

  body.innerHTML = `
    <header class="drawer-head">
      <h2 class="drawer-title">${esc(record.label ?? record.rowKey)}</h2>
      <p class="drawer-rowkey"><code>${esc(record.rowKey)}</code> · run <code>${esc(run)}</code></p>
    </header>
    ${record.imageUrl ? `<img class="drawer-img" src="${safeImg(record.imageUrl)}" alt="${esc(record.label ?? record.rowKey)}" loading="lazy" />` : ''}
    <section class="drawer-section">
      <h3 class="drawer-h3">Scores</h3>
      <div class="score-bars">${scoreBars(record.scores)}</div>
    </section>
    <section class="drawer-section">
      <h3 class="drawer-h3">Metadata</h3>
      <div class="meta-chips">${metadataChips(record.metadata)}</div>
    </section>
    <section class="drawer-section">
      <h3 class="drawer-h3">Output vs expected</h3>
      <div class="json-compare">
        <div class="json-col"><div class="json-col-label">output</div>${prettyJson(record.output)}</div>
        <div class="json-col"><div class="json-col-label">expected</div>${prettyJson(record.expected)}</div>
      </div>
    </section>
    ${record.trace !== undefined ? `
    <section class="drawer-section">
      <details class="trace-details">
        <summary class="drawer-h3 trace-summary">Trace</summary>
        ${renderTrace(record.trace)}
      </details>
    </section>` : ''}
    <section class="drawer-section" id="drawer-adjudicate"></section>`;

  // Fetch the existing adjudication (if any) so the panel pre-fills + flags stale.
  let current;
  try {
    const res = await fetch('/api/adjudications');
    if (res.ok) {
      const list = (await res.json()).adjudications ?? [];
      current = list.find((a) => a.rowKey === record.rowKey);
    }
  } catch {
    current = undefined;
  }

  renderAdjudication(document.getElementById('drawer-adjudicate'), {
    rowKey: record.rowKey,
    run,
    ...(record.contentHash ? { contentHash: record.contentHash } : {}),
    ...(current ? { current } : {}),
  });
}

/** Close the drawer: hide it, drop `&row=` from the URL, restore focus. */
export function closeDrawer() {
  const root = document.getElementById('drawer-root');
  if (root) root.hidden = true;
  const params = new URLSearchParams(location.search);
  if (params.has('row')) {
    params.delete('row');
    const qs = params.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }
  if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  lastTrigger = null;
}
