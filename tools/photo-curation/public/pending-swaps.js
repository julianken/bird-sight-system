import { initTheme, toggleTheme } from '/theme.js';
import { esc, safeImg } from './safe.js';

initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// Interactive swap-review v2 readout of selectSwaps(): per keep=0 species with
// scored NON-DUPLICATE candidates, the current photo at card size (left) and the
// SELECTED candidate at card size (right), with the remaining candidates as
// smaller thumbnails. Click any thumbnail to PROMOTE it to the card image and
// make it the pick (the previous pick returns to a thumbnail); the override is
// POSTed to /api/select-swap and persists. "Use auto pick" reverts to the Δ≥20
// gate; "No swap" deselects (explicit). All interpolated species/attribution
// text + image URLs go through esc()/safeImg() (untrusted eBird taxonomy + iNat
// user content) — this page never injects raw HTML.

function scoreClass(score) {
  if (score === null || score === undefined) return 'bad';
  if (score >= 75) return 'great';
  if (score >= 50) return 'good';
  return 'bad';
}

function scoreBadge(score) {
  return `<span class="score-badge ${scoreClass(score)}">${esc(score ?? '—')}</span>`;
}

function marksHtml(marks) {
  if (!marks || marks.length === 0) return '';
  return `<div class="flag-chips">${marks.map(m => `<span class="flag-chip">${esc(m)}</span>`).join('')}</div>`;
}

function deltaHtml(s) {
  // delta = best NON-duplicate candidate quality − current quality.
  const sign = s.delta > 0 ? '+' : '';
  const cls = s.outscores ? 'great' : 'bad';
  return `<span class="delta-badge ${cls}">Δ ${sign}${esc(s.delta)}</span>`;
}

/** The species' current selected candidate (its inat id), or null for "no swap". */
function selectedInatId(s) {
  return s.proposed ? s.proposed.inatId : null;
}

function currentPane(s) {
  return `
    <div class="pane">
      <div class="pane-label">Current (live) · ${scoreBadge(s.current.qualityScore)}</div>
      <img class="pane-photo" src="${safeImg(s.current.photoUrl)}" alt="current ${esc(s.comName)}" loading="lazy" />
      <div class="pane-body">
        ${marksHtml(s.current.fieldMarks)}
        <p class="rationale">${esc(s.current.rationale ?? '')}</p>
        <p class="attribution">${esc(s.current.attribution)} · ${esc(s.current.license)}</p>
      </div>
    </div>`;
}

/** The right (selected-candidate) pane. Reflects the current pick, auto or operator. */
function proposedPane(s) {
  const pickLabel = s.operatorChosen ? 'Operator pick' : 'Auto pick (Δ≥20)';
  if (!s.proposed) {
    const reason = s.operatorChosen
      ? 'Operator chose <strong>no swap</strong> for this species.'
      : `No improvement clears Δ≥20 — best candidate scored ${esc((s.current.qualityScore ?? 0) + s.delta)}, current ${esc(s.current.qualityScore ?? '—')}.`;
    return `
      <div class="pane no-improvement">
        <div class="pane-label">Selected · ${esc(pickLabel)}</div>
        <div class="pane-body">
          <p class="empty">${reason}</p>
        </div>
      </div>`;
  }
  const p = s.proposed;
  return `
    <div class="pane proposed">
      <div class="pane-label">Selected · ${esc(pickLabel)} · ${scoreBadge(p.qualityScore)}</div>
      <img class="pane-photo" src="${safeImg(p.photoUrl)}" alt="selected replacement" loading="lazy" />
      <div class="pane-body">
        ${marksHtml(p.fieldMarks)}
        <p class="rationale">${esc(p.rationale ?? '')}</p>
        <p class="attribution">${esc(p.attribution)} · ${esc(p.license)} · iNat ${esc(p.inatId)}</p>
      </div>
    </div>`;
}

/** The candidate thumbnail strip — every non-duplicate candidate, the pick highlighted. */
function candidatesStripHtml(s) {
  if (s.candidates.length === 0) return '';
  const sel = selectedInatId(s);
  const items = s.candidates.map(c => `
    <button type="button" class="alt ${c.inatId === sel ? 'selected' : ''}"
      data-code="${esc(s.speciesCode)}" data-inat="${esc(c.inatId)}"
      title="${esc(c.rationale ?? '')}" aria-pressed="${c.inatId === sel ? 'true' : 'false'}">
      <img src="${safeImg(c.photoUrl)}" alt="candidate ${esc(c.inatId)}" loading="lazy" />
      <div class="alt-score">${esc(c.qualityScore ?? '—')}</div>
    </button>`).join('');
  return `
    <div class="rejected">
      <div class="rejected-label">Candidates — click to pick</div>
      <div class="alternates">${items}</div>
    </div>`;
}

/** The per-species control row: revert to auto, or choose "no swap". */
function controlsHtml(s) {
  return `
    <div class="action-bar">
      <button type="button" class="btn keep" data-code="${esc(s.speciesCode)}" data-action="auto"
        ${s.operatorChosen ? '' : 'disabled'}>Use auto pick</button>
      <button type="button" class="btn deny" data-code="${esc(s.speciesCode)}" data-action="no-swap"
        ${s.operatorChosen && !s.proposed ? 'disabled' : ''}>No swap</button>
    </div>`;
}

function speciesCard(s) {
  const el = document.createElement('article');
  el.className = 'swap-card' + (s.proposed ? ' has-swap' : ' no-swap');
  el.dataset.code = s.speciesCode;
  el.innerHTML = cardInnerHtml(s);
  return el;
}

function cardInnerHtml(s) {
  return `
    <div class="swap-head">
      <span class="com">${esc(s.comName)}</span>
      <span class="sci">${esc(s.sciName)}</span>
      ${deltaHtml(s)}
    </div>
    <div class="compare arrow-between">
      ${currentPane(s)}
      <div class="swap-arrow" aria-hidden="true">→</div>
      ${proposedPane(s)}
    </div>
    ${candidatesStripHtml(s)}
    ${controlsHtml(s)}`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

// Keep the loaded swaps in memory keyed by code so a click re-renders one card
// from the server's authoritative re-read (which re-applies the override + gates).
let byCode = new Map();

async function persistAndRefreshCard(code, inatId) {
  await fetch('/api/select-swap', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ speciesCode: code, inatId }),
  });
  // Re-read the single species so the card reflects the server's gate+override
  // resolution (a stale override id silently falls back to "no swap" server-side).
  const data = await fetch('/api/pending-swaps').then(r => r.json());
  const fresh = data.swaps.find(x => x.speciesCode === code);
  const card = document.querySelector(`.swap-card[data-code="${cssEscape(code)}"]`);
  if (fresh && card) {
    byCode.set(code, fresh);
    card.className = 'swap-card' + (fresh.proposed ? ' has-swap' : ' no-swap');
    card.innerHTML = cardInnerHtml(fresh);
  }
  updateSummary(data);
}

// Minimal CSS.escape fallback for the species-code attribute selector (codes are
// lowercase ASCII like "norcar", but be defensive against a stray non-ident char).
function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function updateSummary(data) {
  document.getElementById('summary').textContent =
    `${data.proposedCount} of ${data.total} have a proposed swap`;
}

// One delegated listener on the list handles every card's thumbnails + controls.
document.getElementById('list').addEventListener('click', (ev) => {
  const alt = ev.target.closest('.alt');
  if (alt) {
    const code = alt.dataset.code;
    const inatId = Number(alt.dataset.inat);
    const current = byCode.get(code);
    // Clicking the already-selected pick is a no-op (keeps it selected).
    if (current && selectedInatId(current) === inatId) return;
    persistAndRefreshCard(code, inatId).then(() => toast('Pick saved'));
    return;
  }
  const btn = ev.target.closest('.btn[data-action]');
  if (btn) {
    const code = btn.dataset.code;
    if (btn.dataset.action === 'no-swap') {
      // Explicit "no swap" — POST inatId:null (the server records an override row).
      persistAndRefreshCard(code, null).then(() => toast('Marked: no swap'));
    } else if (btn.dataset.action === 'auto') {
      // Revert to the auto gate: DELETE the override row (distinct from a "no
      // swap" override). Then re-read + re-render the card.
      fetch(`/api/select-swap/${encodeURIComponent(code)}`, { method: 'DELETE' })
        .then(async () => {
          const data = await fetch('/api/pending-swaps').then(r => r.json());
          const fresh = data.swaps.find(x => x.speciesCode === code);
          const card = document.querySelector(`.swap-card[data-code="${cssEscape(code)}"]`);
          if (fresh && card) {
            byCode.set(code, fresh);
            card.className = 'swap-card' + (fresh.proposed ? ' has-swap' : ' no-swap');
            card.innerHTML = cardInnerHtml(fresh);
          }
          updateSummary(data);
          toast('Reverted to auto pick');
        });
    }
  }
});

async function load() {
  const res = await fetch('/api/pending-swaps');
  const data = await res.json();
  const list = document.getElementById('list');
  list.innerHTML = '';
  byCode = new Map();
  updateSummary(data);
  if (data.total === 0) {
    list.innerHTML = '<p class="empty">No needs-replacement species with non-duplicate scored candidates. Run source-prepare + score the candidates first.</p>';
    return;
  }
  for (const s of data.swaps) {
    byCode.set(s.speciesCode, s);
    list.appendChild(speciesCard(s));
  }
}

load();
