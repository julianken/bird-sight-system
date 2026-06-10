import { initTheme, toggleTheme } from '/theme.js';
initTheme();
document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

const SUBSCORE_KEYS = ['framing', 'subjectClarity', 'liveness', 'naturalness', 'pose', 'background', 'lighting'];

function scoreClass(overall) {
  if (overall === null) return 'bad';
  if (overall >= 75) return 'great';
  if (overall >= 50) return 'good';
  return 'bad';
}

function card(row) {
  const el = document.createElement('article');
  el.className = 'card' + (row.overall !== null && row.overall < 50 ? ' below-threshold' : '');
  const flags = row.flags.map(f => `<span class="flag-chip">${f}</span>`).join('');
  const subs = SUBSCORE_KEYS.map(k => `<span class="subscore"><span>${k}</span><span>${row.criteria[k]}</span></span>`).join('');
  el.innerHTML = `
    <img class="card-photo" src="${row.url}" alt="${row.comName}" loading="lazy" />
    <div class="card-body">
      <p class="card-name">${row.comName}</p>
      <p class="card-sci">${row.sciName}</p>
      <span class="score-badge ${scoreClass(row.overall)}">${row.overall ?? '—'}</span>
      <div class="flag-chips">${flags}</div>
      <div class="subscores">${subs}</div>
      <div class="card-actions">
        <label class="mark-swap"><input type="checkbox" class="mark-cb" ${row.markedForSwap ? 'checked' : ''}/> Mark for swap</label>
        <a class="swap-link" href="/swap/${row.speciesCode}">Review →</a>
      </div>
    </div>`;
  el.querySelector('.mark-cb').addEventListener('change', async (e) => {
    await fetch('/api/decision', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ speciesCode: row.speciesCode, action: e.target.checked ? 'pending' : 'keep' }),
    });
    load();
  });
  return el;
}

async function load() {
  const sort = document.getElementById('sort').value;
  const filter = document.getElementById('filter').value;
  const res = await fetch(`/api/overview?sort=${sort}&filter=${filter}`);
  const data = await res.json();
  document.getElementById('staged').textContent = `staged: ${data.stagedApproved} approved`;
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  if (data.rows.length === 0) { grid.innerHTML = '<p class="empty">No species match this filter.</p>'; return; }
  for (const row of data.rows) grid.appendChild(card(row));
}

document.getElementById('sort').addEventListener('change', load);
document.getElementById('filter').addEventListener('change', load);
load();
