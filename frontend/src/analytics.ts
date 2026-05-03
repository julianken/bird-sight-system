import posthog from 'posthog-js';

/**
 * PostHog analytics module (issue #357).
 *
 * Reads `VITE_POSTHOG_KEY` at module-evaluation time (which happens once
 * during app startup via the import in `main.tsx`).  When the key is unset
 * or empty:
 *
 *   1. `posthog.init` is NEVER called.  posthog-js emits a console warning
 *      on `posthog.init('')`, which would fail every e2e spec's
 *      console-cleanliness assertion (species-detail.spec.ts,
 *      map-symbol-layer.spec.ts).
 *   2. `analytics` is a tiny no-op stub exposing only `capture`.  All
 *      component-level call sites (`analytics.capture('panel_opened', ...)`)
 *      execute as a no-op without touching posthog-js.
 *
 * When the key is present (i.e. only in the production Cloudflare Pages
 * deploy where `VITE_POSTHOG_KEY` is set as a build-time env var):
 *
 *   1. `posthog.init` is called once with privacy-respecting options:
 *      - `autocapture: false` — no auto-instrumented click/scroll events.
 *      - `capture_pageview: false` — we capture our own panel events.
 *      - `respect_dnt: true` — honor browser Do-Not-Track headers.
 *      (No session recordings, no GDPR banner, no autocapture — see the
 *      "Out of scope" section of issue #357.)
 *   2. `analytics` IS the posthog-js default export.  All `analytics.capture`
 *      calls flow straight through.
 *
 * The narrow `Analytics` interface keeps consumer call-sites loose-coupled
 * to the underlying library; the no-op stub only needs to implement
 * `capture`.  If we add `identify` or `reset` later, extend this interface
 * and the stub in lockstep.
 */
interface Analytics {
  capture(eventName: string, properties?: Record<string, unknown>): void;
}

const key = import.meta.env.VITE_POSTHOG_KEY ?? '';

if (key) {
  posthog.init(key, {
    api_host: 'https://us.i.posthog.com',
    autocapture: false,
    capture_pageview: false,
    respect_dnt: true,
  });
}

export const analytics: Analytics = key
  ? posthog
  : { capture: () => {} };
