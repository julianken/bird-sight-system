// The generic facet gallery/table controller (E6) — framework-free vanilla ESM.
//
// Renders `/facets?run=<id>&f=<clause>[&f=…]&view=gallery|table`. Each `f=` clause
// (`<axis>.<key>:<op>[:<value>]`, axis ∈ scores|metadata) is parsed by the
// facet-grammar pure unit into an E2 `FacetFilter` `{ path, op, value? }`; the set
// is assembled into an E2 `FacetQuery` `{ filters?, sort?, limit?, offset? }` and
// passed to `GET /api/rows?run=&f=…` (E4 over E2's `facetRows`). The saved-URL
// shape the epic names — the photo-judge "falseKeep gallery" — falls out as
// `?run=…&f=metadata.disagreement:eq:falseKeep&view=gallery` with NO bespoke code.
//
// A facet-key discovery dropdown lets a user add a clause without hand-editing
// the URL: keys are discovered from a sample of the run's rows (scores/metadata
// object keys). A gallery|table view toggle switches rendering.
//
// SCALE GUARD: the gallery is CAPPED + lazy + paged for 150–1000 rows — a visible
// cap with a "Show more" affordance, and every <img> is `loading="lazy"`. We never
// render 1000 eager <img> at once.
//
// Drawer deep-link: a card/row opens the drawer via `&row=<run>:<row_key>` — the
// `run:rowKey` deep-link resolved to the page's `run` (see drawer.js). EVENT
// DELEGATION: ONE listener on #facet-results reading data-* off the target — NOT
// per-row binding (eval.js's per-row addEventListener is the anti-pattern; the
// 150–1000-row scale forbids it).

import { initTheme, toggleTheme } from './theme.js';
import { esc, safeImg, setImageHostAllowlist } from './safe.js';
import { parseFacets, serializeFacets } from './facet-grammar.js';
import { openDrawer } from './drawer.js';
import { config } from '/config.js';

// ── Boot ──
initTheme();
setImageHostAllowlist(config.imageHostAllowlist);
document.getElementById('theme-toggle')?.addEventListener('click', toggleTheme);

const params = new URLSearchParams(location.search);
const run = params.get('run') ?? '';
let view = params.get('view') === 'table' ? 'table' : 'gallery';
let clauses = parseFacets(params); // FacetFilter[]

// Gallery cap: render at most PAGE_SIZE cards, growing by PAGE_SIZE on "Show more".
const PAGE_SIZE = 60;
let shownCount = PAGE_SIZE;

let allRows = []; // the full result set for the current facet query
let discovered = { scores: new Set(), metadata: new Set() };

// ── URL sync ──
function syncUrl() {
  const parts = [];
  if (run) parts.push(`run=${encodeURIComponent(run)}`);
  const f = serializeFacets(clauses);
  if (f) parts.push(f);
  parts.push(`view=${view}`);
  const rowParam = new URLSearchParams(location.search).get('row');
  if (rowParam) parts.push(`row=${encodeURIComponent(rowParam)}`);
  history.replaceState(null, '', `?${parts.join('&')}`);
}

// ── Facet controls (discovery dropdown + active-clause chips) ──
function renderControls() {
  const host = document.getElementById('facet-controls');
  const keyOptions = [
    ...[...discovered.scores].sort().map((k) => `scores.${k}`),
    ...[...discovered.metadata].sort().map((k) => `metadata.${k}`),
  ];
  const optionsHtml = keyOptions
    .map((p) => `<option value="${esc(p)}">${esc(p)}</option>`)
    .join('');
  const ops = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'exists'];

  const chips = clauses
    .map((c, i) => {
      const val =
        c.op === 'exists'
          ? ''
          : `: ${esc(Array.isArray(c.value) ? c.value.join(',') : c.value)}`;
      return `<span class="facet-chip">${esc(c.path)} ${esc(c.op)}${val}
        <button type="button" class="facet-chip-x" data-remove="${i}" aria-label="Remove filter">×</button></span>`;
    })
    .join('');

  host.innerHTML = `
    <div class="facet-active">${chips || '<span class="facet-none">No filters — all rows</span>'}</div>
    <form class="facet-add" id="facet-add">
      <select class="facet-add-key" name="key" aria-label="Facet key">${optionsHtml || '<option value="">no keys</option>'}</select>
      <select class="facet-add-op" name="op" aria-label="Facet op">${ops.map((o) => `<option value="${o}">${o}</option>`).join('')}</select>
      <input class="facet-add-val" name="value" placeholder="value" aria-label="Facet value" />
      <button type="submit" class="facet-add-btn">Add filter</button>
    </form>`;
}

// ── Result rendering ──
function galleryCard(row) {
  const score = row.scores ? Object.entries(row.scores)[0] : undefined;
  const scoreLabel = score ? `${esc(score[0])} ${esc(score[1])}` : '';
  return `
    <figure class="facet-figure" data-row-key="${esc(row.rowKey)}" tabindex="0" role="button"
            aria-label="Open detail for ${esc(row.label ?? row.rowKey)}">
      <img class="facet-img" src="${safeImg(row.imageUrl)}" alt="${esc(row.label ?? row.rowKey)}" loading="lazy" />
      <figcaption class="facet-caption">
        <span class="facet-name">${esc(row.label ?? row.rowKey)}</span>
        ${scoreLabel ? `<span class="facet-score">${scoreLabel}</span>` : ''}
      </figcaption>
    </figure>`;
}

function renderGallery() {
  const host = document.getElementById('facet-results');
  if (allRows.length === 0) {
    host.innerHTML = '<p class="empty">No rows match these filters.</p>';
    return;
  }
  const page = allRows.slice(0, shownCount);
  const cards = page.map(galleryCard).join('');
  const more =
    allRows.length > shownCount
      ? `<button type="button" class="facet-more" id="facet-more">Show more (${allRows.length - shownCount} of ${allRows.length} hidden)</button>`
      : '';
  host.innerHTML = `<div class="facet-grid">${cards}</div>${more}`;
}

function renderTable() {
  const host = document.getElementById('facet-results');
  if (allRows.length === 0) {
    host.innerHTML = '<p class="empty">No rows match these filters.</p>';
    return;
  }
  // Columns = the discovered scores + metadata keys.
  const scoreKeys = [...discovered.scores].sort();
  const metaKeys = [...discovered.metadata].sort();
  const head = `
    <th scope="col">Row</th>
    ${scoreKeys.map((k) => `<th class="num" scope="col">${esc(k)}</th>`).join('')}
    ${metaKeys.map((k) => `<th scope="col">${esc(k)}</th>`).join('')}
    <th scope="col"><span class="visually-hidden">open</span></th>`;
  const body = allRows
    .map(
      (row) => `
        <tr class="facet-trow" data-row-key="${esc(row.rowKey)}">
          <td class="facet-rowkey"><code>${esc(row.label ?? row.rowKey)}</code></td>
          ${scoreKeys.map((k) => `<td class="num">${esc(row.scores?.[k] ?? '—')}</td>`).join('')}
          ${metaKeys.map((k) => `<td>${esc(row.metadata?.[k] ?? '—')}</td>`).join('')}
          <td><button type="button" class="facet-open-btn" data-row-key="${esc(row.rowKey)}" aria-label="Open detail for ${esc(row.rowKey)}">Open ›</button></td>
        </tr>`,
    )
    .join('');
  host.innerHTML = `<div class="table-scroll"><table class="facet-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function renderResults() {
  document.getElementById('facet-count').textContent =
    `${allRows.length} row${allRows.length === 1 ? '' : 's'}`;
  // Reflect the active view on the toggle buttons.
  for (const btn of document.querySelectorAll('.facet-view')) {
    btn.classList.toggle('active', btn.getAttribute('data-view') === view);
    btn.setAttribute('aria-pressed', String(btn.getAttribute('data-view') === view));
  }
  if (view === 'table') renderTable();
  else renderGallery();
}

/** Discover scores/metadata keys from the loaded rows (for the dropdown + table cols). */
function discoverKeys(rowList) {
  const scores = new Set();
  const metadata = new Set();
  for (const r of rowList) {
    for (const k of Object.keys(r.scores ?? {})) scores.add(k);
    for (const k of Object.keys(r.metadata ?? {})) metadata.add(k);
  }
  return { scores, metadata };
}

// ── Load ──
async function load() {
  const count = document.getElementById('facet-count');
  if (!run) {
    count.textContent = 'Provide ?run=<id> to explore a run.';
    document.getElementById('facet-results').innerHTML =
      '<p class="empty">No run selected. Pick a run on the hub.</p>';
    return;
  }
  // Build the FacetQuery from the parsed clauses → the `f=` query string E4 parses.
  const f = serializeFacets(clauses);
  const url = f ? `/api/rows?run=${encodeURIComponent(run)}&${f}` : `/api/rows?run=${encodeURIComponent(run)}`;
  try {
    const res = await fetch(url);
    if (res.ok) {
      allRows = (await res.json()).rows ?? [];
    } else {
      const err = await res.json().catch(() => ({}));
      count.textContent = err.error ?? 'Could not load rows.';
      allRows = [];
    }
  } catch {
    count.textContent = 'Network error loading rows.';
    allRows = [];
  }
  // Discover keys from the (possibly filtered) result; on a filtered first load
  // also union the unfiltered run's keys so the dropdown still offers them.
  discovered = discoverKeys(allRows);
  if (clauses.length > 0 || allRows.length === 0) {
    try {
      const all = await fetch(`/api/rows?run=${encodeURIComponent(run)}`);
      if (all.ok) {
        const merged = discoverKeys((await all.json()).rows ?? []);
        for (const k of merged.scores) discovered.scores.add(k);
        for (const k of merged.metadata) discovered.metadata.add(k);
      }
    } catch {
      /* keep the filtered-result keys */
    }
  }
  shownCount = PAGE_SIZE;
  renderControls();
  renderResults();

  const rowParam = params.get('row');
  if (rowParam) openDrawer(rowParam, null);
}

// ── Single delegated listener on #facet-results (NOT one per row) ──
function openRow(rowKey, trigger) {
  const next = new URLSearchParams(location.search);
  next.set('row', `${run}:${rowKey}`);
  history.replaceState(null, '', `?${next.toString()}`);
  openDrawer(`${run}:${rowKey}`, trigger);
}

function bindDelegation() {
  const results = document.getElementById('facet-results');
  results.addEventListener('click', (ev) => {
    if (ev.target.closest('#facet-more')) {
      shownCount += PAGE_SIZE;
      renderGallery();
      return;
    }
    const trigger = ev.target.closest('[data-row-key]');
    if (!trigger) return;
    const rowKey = trigger.getAttribute('data-row-key');
    if (rowKey) openRow(rowKey, trigger);
  });
  // Keyboard: Enter/Space on a focused gallery figure opens it.
  results.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const fig = ev.target.closest('.facet-figure');
    if (!fig) return;
    ev.preventDefault();
    const rowKey = fig.getAttribute('data-row-key');
    if (rowKey) openRow(rowKey, fig);
  });

  // View toggle (buttons are static in the HTML shell).
  for (const btn of document.querySelectorAll('.facet-view')) {
    btn.addEventListener('click', () => {
      view = btn.getAttribute('data-view') === 'table' ? 'table' : 'gallery';
      shownCount = PAGE_SIZE;
      syncUrl();
      renderResults();
    });
  }

  // Facet controls: add a clause / remove a chip (delegated on the controls host).
  const controls = document.getElementById('facet-controls');
  controls.addEventListener('click', (ev) => {
    const rm = ev.target.closest('.facet-chip-x');
    if (!rm) return;
    const idx = Number(rm.getAttribute('data-remove'));
    if (Number.isInteger(idx)) {
      clauses = clauses.filter((_, i) => i !== idx);
      syncUrl();
      load();
    }
  });
  controls.addEventListener('submit', (ev) => {
    if (!ev.target.closest('#facet-add')) return;
    ev.preventDefault();
    const form = ev.target;
    const path = form.querySelector('.facet-add-key').value;
    const op = form.querySelector('.facet-add-op').value;
    const rawVal = form.querySelector('.facet-add-val').value;
    if (!path) return;
    // Round-trip the new clause through the grammar unit so coercion matches.
    const token = op === 'exists' ? `${path}:exists` : `${path}:${op}:${rawVal}`;
    const sp = new URLSearchParams();
    sp.append('f', token);
    const parsed = parseFacets(sp);
    if (parsed.length === 1) {
      clauses = [...clauses, parsed[0]];
      syncUrl();
      load();
    }
  });
}

bindDelegation();
load();
