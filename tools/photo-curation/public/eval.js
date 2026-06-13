import { initTheme, toggleTheme } from '/theme.js';
import { esc, safeImg } from './safe.js';
initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

// UNIT CONTRACT (#1094): the server stores `agreement` and `scoreMae` as 0–1
// FRACTIONS — the gate (`PASS`/`fail`) is derived server-side (see
// src/server/eval-queries.ts), so this page only renders. The `%` columns
// multiply by 100 for display; never re-derive the gate here.
function pct(fraction) {
  return `${(fraction * 100).toFixed(1)}%`;
}
function usd(cost) {
  return `$${Number(cost).toFixed(2)}`;
}

let selectedRun = new URLSearchParams(location.search).get('run');

function runRow(run, isSelected) {
  const tr = document.createElement('tr');
  tr.className = 'run-row' + (isSelected ? ' selected' : '');
  tr.dataset.id = run.id;
  const gateClass = run.gate === 'PASS' ? 'gate-pass' : 'gate-fail';
  tr.innerHTML = `
    <td class="run-model">${esc(run.model)}</td>
    <td class="run-baseline">${esc(run.baselineModel)} · ${esc(run.baselineRubric)}</td>
    <td class="num">${esc(run.sampleSize)}</td>
    <td class="num">${esc(pct(run.agreement))}</td>
    <td class="num">${esc(run.falseKeep)}</td>
    <td class="num">${esc(run.falseReplace)}</td>
    <td class="num">${esc(pct(run.scoreMae))}</td>
    <td class="num">${esc(usd(run.totalCost))}</td>
    <td><span class="gate-badge ${gateClass}">${esc(run.gate)}</span></td>`;
  tr.addEventListener('click', () => selectRun(run.id));
  return tr;
}

function figure(fk) {
  return `
    <figure class="fk-figure">
      <img class="fk-img" src="${safeImg(fk.sourceUrl)}" alt="${esc(fk.comName)}" loading="lazy" />
      <figcaption class="fk-caption">
        <span class="fk-name">${esc(fk.comName)}</span>
        <span class="fk-scores">Gemini keep@${esc(fk.geminiQuality)} · Opus replace@${esc(fk.opusQuality)}</span>
      </figcaption>
    </figure>`;
}

async function loadFalseKeeps(runId) {
  const gallery = document.getElementById('gallery');
  const title = document.getElementById('gallery-title');
  const res = await fetch(`/api/eval/false-keeps?run=${encodeURIComponent(runId)}`);
  if (!res.ok) {
    gallery.innerHTML = '<p class="empty">Could not load falseKeeps for this run.</p>';
    return;
  }
  const data = await res.json();
  title.textContent = `falseKeeps · ${data.falseKeeps.length}`;
  if (data.falseKeeps.length === 0) {
    gallery.innerHTML = '<p class="empty">No falseKeeps — the candidate judge kept nothing the baseline replaced.</p>';
    return;
  }
  gallery.innerHTML = data.falseKeeps.map(figure).join('');
}

function renderRuns(runs) {
  const body = document.getElementById('runs-body');
  body.innerHTML = '';
  for (const run of runs) body.appendChild(runRow(run, run.id === selectedRun));
}

function selectRun(runId) {
  selectedRun = runId;
  document.querySelectorAll('.run-row').forEach((tr) => tr.classList.toggle('selected', tr.dataset.id === runId));
  const url = new URL(location.href);
  url.searchParams.set('run', runId);
  history.replaceState(null, '', url);
  loadFalseKeeps(runId);
}

async function load() {
  const res = await fetch('/api/eval/runs');
  const data = await res.json();
  document.getElementById('summary').textContent = `${data.runs.length} run${data.runs.length === 1 ? '' : 's'}`;
  if (data.runs.length === 0) {
    document.getElementById('runs-body').innerHTML = '<tr><td colspan="9" class="empty">No eval runs yet — run <code>npm run eval</code>.</td></tr>';
    document.getElementById('gallery').innerHTML = '';
    document.getElementById('gallery-title').textContent = 'falseKeeps';
    return;
  }
  // Default to the newest run (the API returns newest-first) unless ?run= named
  // a run that actually exists.
  const known = data.runs.some((r) => r.id === selectedRun);
  if (!known) selectedRun = data.runs[0].id;
  renderRuns(data.runs);
  loadFalseKeeps(selectedRun);
}

load();
