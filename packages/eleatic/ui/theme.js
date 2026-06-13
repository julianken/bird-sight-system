// Light/dark theme toggle for the eleatic explorer, via a [data-theme] attribute
// on <html> + a localStorage-persisted preference. Ported from photo-curation's
// theme.js with a NAMESPACED storage key — `eleatic-theme`, not
// `photo-curate-theme` — so the two tools served from different origins (or the
// same browser during dev) never read each other's preference.
//
// Browser-only (touches localStorage + document); loaded via
// `<script type="module">`. No unit test (no DOM-free surface); the rendered
// toggle is exercised at the orchestrator's live-verify step.

const KEY = 'eleatic-theme';

export function initTheme() {
  const saved = localStorage.getItem(KEY) || 'light';
  document.documentElement.setAttribute('data-theme', saved);
}

export function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(KEY, next);
}
