/**
 * O9 (#781) — scope-gated MapCanvas chunk prefetch.
 *
 * `MapCanvas` (and its ~1,028 kB raw / ~273 kB gzip `maplibre-gl` dependency)
 * is code-split behind the `React.lazy()` boundary in
 * `components/MapSurface.tsx`. That split is deliberate and must stay (OQ5):
 * eager-inlining maplibre would regress every cold start — including the
 * unscoped chooser landing where the map never renders. The cost of the split
 * is that the chunk fetch only *starts* when `<MapSurface>` first mounts, i.e.
 * after the user has already chosen a scope; on a scoped deep-link (`?state=`/
 * `?scope=us`) or a chooser scope-pick the fetch then sits on the critical path
 * between intent and map paint.
 *
 * `prefetchMapCanvas()` warms that exact chunk *earlier* — but ONLY once a scope
 * is known (App.tsx calls it on a scoped landing and on each scope-pick, NEVER
 * on the unscoped chooser landing). It references the SAME module specifier as
 * the lazy boundary (`MapSurface.tsx` imports `'./map/MapCanvas.js'`; from here
 * the same file is `'./components/map/MapCanvas.js'`) so the bundler dedupes
 * both to a single chunk — the prefetch warms the browser module cache the
 * Suspense boundary then reads from on mount. It does NOT replace the lazy
 * boundary; the real render path keeps its own Suspense/ErrorBoundary.
 *
 * Properties:
 *   - idempotent: a module-level `warmed` guard issues the underlying `import()`
 *     at most once, so re-renders and multiple scope picks coalesce to one fetch;
 *   - low priority: scheduled via `requestIdleCallback` (with a `setTimeout`
 *     fallback for Safari/jsdom) so it never competes with first paint;
 *   - rejection-safe: the import's rejection is swallowed — a transient prefetch
 *     failure must never surface as an unhandled rejection (the mount-time lazy
 *     boundary retries and owns the real error UX);
 *   - SSR-safe: a strict no-op when `typeof window === 'undefined'`.
 */

let warmed = false;

function warm(): void {
  // Same chunk as the MapSurface.tsx React.lazy boundary
  // (`import('./map/MapCanvas.js')`). Swallow rejection: the real render path
  // has its own Suspense/ErrorBoundary; a failed warm-up must stay silent.
  import('./components/map/MapCanvas.js').catch(() => {});
}

export function prefetchMapCanvas(): void {
  // SSR / non-DOM (jsdom without the scheduling primitives): strict no-op.
  if (typeof window === 'undefined') return;
  // Warm at most once per page lifetime.
  if (warmed) return;
  warmed = true;

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => warm(), { timeout: 2000 });
  } else {
    // Safari/jsdom lack requestIdleCallback — defer one tick so the warm-up
    // still yields to the current frame's work.
    setTimeout(() => warm(), 1);
  }
}
