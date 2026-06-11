import { initTheme, toggleTheme } from '/theme.js';
import { esc, safeImg } from './safe.js';

initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// READ-ONLY readout of selectSwaps(): per keep=0 species with scored candidates,
// the current photo + score on the left, the proposed replacement (or a "no
// improvement" state) on the right, the score delta, and the rejected candidate
// thumbnails below. All interpolated species/attribution text + image URLs go
// through esc()/safeImg() (untrusted eBird taxonomy + iNat user content) — this
// page never injects raw HTML.

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
  // delta = best candidate quality − current quality. Positive = improvement.
  const sign = s.delta > 0 ? '+' : '';
  const cls = s.outscores ? 'great' : 'bad';
  return `<span class="delta-badge ${cls}">Δ ${sign}${esc(s.delta)}</span>`;
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

function proposedPane(s) {
  if (!s.proposed) {
    return `
      <div class="pane no-improvement">
        <div class="pane-label">Proposed replacement</div>
        <div class="pane-body">
          <p class="empty">No improvement found — keeping original.</p>
          <p class="rationale-dim">Best candidate scored ${esc((s.current.qualityScore ?? 0) + s.delta)}, not above the current ${esc(s.current.qualityScore ?? '—')}.</p>
        </div>
      </div>`;
  }
  const p = s.proposed;
  return `
    <div class="pane proposed">
      <div class="pane-label">Proposed replacement · ${scoreBadge(p.qualityScore)}</div>
      <img class="pane-photo" src="${safeImg(p.photoUrl)}" alt="proposed replacement" loading="lazy" />
      <div class="pane-body">
        ${marksHtml(p.fieldMarks)}
        <p class="rationale">${esc(p.rationale ?? '')}</p>
        <p class="attribution">${esc(p.attribution)} · ${esc(p.license)} · iNat ${esc(p.inatId)}</p>
      </div>
    </div>`;
}

function rejectedHtml(s) {
  // Every non-selected candidate (the alternates the gate did not pick).
  const rejected = s.candidates.filter(c => !c.selected);
  if (rejected.length === 0) return '';
  const items = rejected.map(c => `
    <div class="alt" title="${esc(c.rationale ?? '')}">
      <img src="${safeImg(c.photoUrl)}" alt="rejected candidate ${esc(c.inatId)}" loading="lazy" />
      <div class="alt-score">${esc(c.qualityScore ?? '—')}</div>
    </div>`).join('');
  return `
    <div class="rejected">
      <div class="rejected-label">Other candidates (not selected)</div>
      <div class="alternates">${items}</div>
    </div>`;
}

function speciesCard(s) {
  const el = document.createElement('article');
  el.className = 'swap-card' + (s.outscores ? ' has-swap' : ' no-swap');
  el.innerHTML = `
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
    ${rejectedHtml(s)}`;
  return el;
}

async function load() {
  const res = await fetch('/api/pending-swaps');
  const data = await res.json();
  const list = document.getElementById('list');
  list.innerHTML = '';
  document.getElementById('summary').textContent =
    `${data.proposedCount} of ${data.total} have a proposed swap`;
  if (data.total === 0) {
    list.innerHTML = '<p class="empty">No needs-replacement species with scored candidates. Run source-prepare + score the candidates first.</p>';
    return;
  }
  for (const s of data.swaps) list.appendChild(speciesCard(s));
}

load();
