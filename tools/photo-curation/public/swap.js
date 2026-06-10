import { initTheme, toggleTheme } from '/theme.js';
import { esc, safeImg } from './safe.js';
initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

const QUICK_CHIPS = ['too-dark', 'wrong-sex-morph', 'still-distant', 'cluttered-background', 'captive-feeder', 'not-sharp'];
const SUBSCORE_KEYS = ['framing', 'subjectClarity', 'liveness', 'naturalness', 'pose', 'background', 'lighting'];
const code = location.pathname.split('/').pop();
let featured = null; // candidateId

function subscoresHtml(criteria) {
  return `<div class="subscores">${SUBSCORE_KEYS.map(k => `<span class="subscore"><span>${esc(k)}</span><span>${esc(criteria[k])}</span></span>`).join('')}</div>`;
}
function flagsHtml(flags) {
  return `<div class="flag-chips">${flags.map(f => `<span class="flag-chip">${esc(f)}</span>`).join('')}</div>`;
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2500);
}

async function render() {
  const res = await fetch(`/api/swap/${code}`);
  if (res.status === 404) { document.getElementById('root').innerHTML = '<p class="empty">Unknown species.</p>'; return; }
  const v = await res.json();
  featured = v.proposed ? v.proposed.candidateId : null;

  const proposedPane = v.proposed ? `
    <div class="pane">
      <div class="pane-label">Proposed replacement · ${esc(v.proposed.overall ?? '—')}</div>
      <img class="pane-photo" src="${safeImg(v.proposed.photoUrl)}" alt="proposed" />
      <div class="pane-body">
        ${flagsHtml(v.proposed.flags)}${subscoresHtml(v.proposed.criteria)}
        <p class="attribution">${esc(v.proposed.attribution)} · ${esc(v.proposed.license)}</p>
      </div>
    </div>` : `<div class="pane"><div class="pane-label">Proposed replacement</div><p class="empty">No scored candidate left — re-source queued; run <code>source-candidates</code> then refresh.</p></div>`;

  const alts = v.alternates.map(a => `
    <div class="alt ${a.candidateId === featured ? 'selected' : ''}" data-id="${esc(a.candidateId)}">
      <img src="${safeImg(a.photoUrl)}" alt="alt" />
      <div class="alt-score">${esc(a.overall ?? '—')}</div>
    </div>`).join('');

  const chips = QUICK_CHIPS.map(c => `<button type="button" class="quick-chip" data-tag="${esc(c)}">${esc(c)}</button>`).join('');

  document.getElementById('root').innerHTML = `
    <div class="swap-head"><span class="com">${esc(v.comName)}</span><span class="sci">${esc(v.sciName)}</span></div>
    <div class="compare">
      <div class="pane">
        <div class="pane-label">Current (live) · ${esc(v.current.overall ?? '—')}</div>
        <img class="pane-photo" src="${safeImg(v.current.url)}" alt="current" />
        <div class="pane-body">
          ${flagsHtml(v.current.flags)}${subscoresHtml(v.current.criteria)}
          <p class="attribution">${esc(v.current.attribution)} · ${esc(v.current.license)}</p>
        </div>
      </div>
      ${proposedPane}
    </div>
    <div class="alternates" id="alternates">${alts}</div>
    <div class="action-bar">
      <button class="btn approve" id="approve" ${featured === null ? 'disabled' : ''}>Approve</button>
      <button class="btn keep" id="keep">Keep original</button>
      <button class="btn deny" id="deny-toggle">Deny…</button>
    </div>
    <div class="deny-panel" id="deny-panel">
      <textarea id="deny-reason" placeholder="Why is every candidate wrong? (feeds re-sourcing)"></textarea>
      <div class="quick-chips" id="quick-chips">${chips}</div>
      <button class="btn deny" id="deny-submit">Deny & re-source</button>
    </div>`;

  // feature an alternate
  document.querySelectorAll('.alt').forEach(el => el.addEventListener('click', () => {
    featured = Number(el.dataset.id);
    document.querySelectorAll('.alt').forEach(x => x.classList.toggle('selected', Number(x.dataset.id) === featured));
    document.getElementById('approve').disabled = false;
  }));

  document.getElementById('approve').addEventListener('click', async () => {
    const chosenCandidateId = alternateInatId(v, featured);
    if (chosenCandidateId === null) { toast('Pick a replacement candidate before approving'); return; }
    await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speciesCode: code, action: 'approve', chosenCandidateId }) });
    toast('Approved (staged — nothing live until apply-swaps)');
  });
  document.getElementById('keep').addEventListener('click', async () => {
    await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speciesCode: code, action: 'keep' }) });
    toast('Kept original (staged)');
  });
  document.getElementById('deny-toggle').addEventListener('click', () => {
    document.getElementById('deny-panel').classList.toggle('open');
  });
  document.querySelectorAll('.quick-chip').forEach(c => c.addEventListener('click', () => c.classList.toggle('active')));
  document.getElementById('deny-submit').addEventListener('click', async () => {
    const reason = document.getElementById('deny-reason').value;
    const tags = [...document.querySelectorAll('.quick-chip.active')].map(c => c.dataset.tag);
    // Exclude the shown candidate(s): the proposed one currently on screen.
    const excludeIds = v.proposed ? [v.proposed.inatId] : [];
    const r = await fetch('/api/deny', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speciesCode: code, reason, tags, excludeIds }) }).then(x => x.json());
    // Server never scores. Common case: denyAndAdvance returned the next already-
    // scored alternate as result.next (resourceQueued:false) — re-render shows it
    // instantly. Pool exhausted (resourceQueued:true): no proposed; re-source.
    if (r.resourceQueued) {
      toast('Re-source queued — run `source-candidates` then refresh');
    } else {
      toast('Denied — advanced to next pre-scored candidate');
    }
    render(); // re-render: either the next pre-scored alternate, or the empty/queued state
  });
}

// chosen_candidate_id in the contract stores the candidate's inat id.
// The default approve path features the *proposed* candidate, which lives in
// its own pane — not the alternates strip — so search proposed first, then the
// ranked alternates. Returns null only if nothing matches (server then 400s the
// approve rather than persisting a null swap).
function alternateInatId(view, candidateId) {
  const hit = [view.proposed, ...view.alternates].find(x => x && x.candidateId === candidateId);
  return hit ? hit.inatId : null;
}

render();
