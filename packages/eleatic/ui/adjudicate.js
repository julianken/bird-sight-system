// The human-adjudication panel inside the eleatic drawer.
//
// Renders a verdict <select> (vocabulary from /config.js — NOT hard-coded; the
// package invents no domain verbs), a free-text note, and a staleness badge, then
// POSTs to `/api/adjudications` on submit. This is the ONLY write the eleatic UI
// performs: adjudications are run-independent, keyed on `row_key`, upsert — no
// audit history.
//
// Server contract (E4, src/server/app.ts): POST accepts
// `{ rowKey, verdict, run?, note? }`. The server captures `against_hash` itself
// from the row's CURRENT content_hash via `run` at decision time (the UI does
// not send a hash — sending `run` is what lets the server anchor the verdict).
// We thread the resolved `run` (diff view → run b, facets/hub view → page run)
// through so a submitted verdict is anchored and a later row edit flips isStale.
//
// Staleness: a pre-existing verdict is stale when its stored `against_hash`
// differs from the row's current content_hash (the isStale pure unit). The drawer
// passes both in; we render a "stale — re-decide" badge when stale.
//
// Optimistic update: on a 200 response we re-render the panel in place reflecting
// the just-submitted verdict (now anchored against the current hash, so fresh).
//
// Plain ESM with a named export. Browser-only at runtime (touches the DOM +
// fetch); no unit test — the logic lives in the isStale pure unit, this is glue.
// Verified live at the epic's E2E recipe.

import { esc } from './safe.js';
import { isStale } from './staleness.js';
import { config } from '/config.js';

/**
 * Render the adjudication panel into `container`.
 *
 * @param {HTMLElement} container
 * @param {{
 *   rowKey: string,
 *   run: string,                       // resolved run for the POST's against_hash capture
 *   contentHash?: string,              // the row's CURRENT content_hash
 *   current?: { verdict?: string, note?: string, againstHash?: string } // existing verdict, if any
 * }} opts
 */
export function renderAdjudication(container, opts) {
  const { rowKey, run, contentHash, current } = opts;
  const verdicts = Array.isArray(config.verdictVocabulary) ? config.verdictVocabulary : [];

  const currentVerdict = current?.verdict ?? '';
  const currentNote = current?.note ?? '';
  const stale = isStale(current?.againstHash, contentHash);

  const options = [
    `<option value=""${currentVerdict === '' ? ' selected' : ''}>— choose verdict —</option>`,
    ...verdicts.map(
      (v) => `<option value="${esc(v)}"${v === currentVerdict ? ' selected' : ''}>${esc(v)}</option>`,
    ),
  ].join('');

  const staleBadge = stale
    ? '<span class="adj-stale" title="The item changed since this verdict was decided">⚠ stale — re-decide</span>'
    : '';

  const decided = current?.verdict
    ? `<p class="adj-current">Current verdict: <strong>${esc(currentVerdict)}</strong>${staleBadge}</p>`
    : '<p class="adj-current adj-none">No verdict yet</p>';

  container.innerHTML = `
    <div class="adjudicate">
      <h3 class="adj-title">Adjudicate</h3>
      ${decided}
      <form class="adj-form" data-row-key="${esc(rowKey)}">
        <label class="adj-field">
          <span class="adj-label">Verdict</span>
          <select class="adj-verdict" name="verdict" required>${options}</select>
        </label>
        <label class="adj-field">
          <span class="adj-label">Note <span class="adj-optional">(optional)</span></span>
          <textarea class="adj-note" name="note" rows="2" placeholder="Why?">${esc(currentNote)}</textarea>
        </label>
        <div class="adj-actions">
          <button type="submit" class="adj-submit">Save verdict</button>
          <span class="adj-status" role="status" aria-live="polite"></span>
        </div>
      </form>
    </div>`;

  const form = container.querySelector('.adj-form');
  const status = container.querySelector('.adj-status');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const verdict = form.querySelector('.adj-verdict').value;
    const note = form.querySelector('.adj-note').value;
    if (!verdict) {
      status.textContent = 'Pick a verdict first.';
      return;
    }
    status.textContent = 'Saving…';
    // Send what we have: rowKey + verdict always, run (for against_hash capture)
    // and note when present. Omittable keys are left off so the store coerces
    // them to NULL at its boundary (exactOptionalPropertyTypes).
    const payload = { rowKey, verdict };
    if (run) payload.run = run;
    if (note) payload.note = note;
    try {
      const res = await fetch('/api/adjudications', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        status.textContent = body.error ? `Failed: ${body.error}` : 'Failed to save.';
        return;
      }
      // Optimistic re-render in place: the verdict is now anchored against the
      // row's current hash, so the freshly-saved verdict is no longer stale.
      const next = { verdict };
      if (note) next.note = note;
      if (contentHash) next.againstHash = contentHash;
      renderAdjudication(container, {
        rowKey,
        run,
        ...(contentHash ? { contentHash } : {}),
        current: next,
      });
      container.querySelector('.adj-status').textContent = 'Saved.';
    } catch {
      status.textContent = 'Network error — not saved.';
    }
  });
}
