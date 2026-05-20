import { safeClarity } from './clarity.js';

/**
 * Analytics wrapper, Clarity-backed (PR #659 follow-up to issue #357).
 *
 * The previous PostHog wiring never actually shipped — `VITE_POSTHOG_KEY`
 * was never injected by the deploy workflow, so every `analytics.capture`
 * call was a silent no-op in prod. This module replaces the dead transport
 * with Microsoft Clarity (the SDK that PR #659 already initializes via
 * `clarity.ts`) WITHOUT touching the four existing call sites
 * (`url-state.ts` + `SpeciesDetailSurface.tsx`). The public
 * `analytics.capture(name, props)` shape is preserved on purpose.
 *
 * Clarity's API splits what PostHog folded together:
 *   - `Clarity.event(name)` takes a name only (no payload).
 *   - `Clarity.setTag(key, value)` attaches a string dimension to the
 *     current session.
 * So we fan a single PostHog-style `capture(name, props)` call out to one
 * `event` and N `setTag` calls — the *intent* (event + its dimensions)
 * survives, just split across two SDK methods.
 *
 * The Clarity SDK itself is accessed via `safeClarity` from `./clarity.js`,
 * not imported here directly. `clarity.ts` is the single canonical entry
 * point to the SDK: it owns init (the env gate: PROD + project ID) AND the
 * runtime guard (`window.clarity` exists), so pre-init calls in dev/test/
 * un-gated-prod become safe no-ops without leaking the SDK internal
 * (`TypeError: window.clarity is not a function`) into call-site test
 * environments. Future Clarity callers (consent banner #658, identify,
 * upgrade) should import `safeClarity` here too — never
 * `@microsoft/clarity` directly.
 */
interface Analytics {
  capture(eventName: string, properties?: Record<string, unknown>): void;
  setView(view: string): void;
}

export const analytics: Analytics = {
  capture(eventName, properties) {
    safeClarity.event(eventName);
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        safeClarity.setTag(key, String(value));
      }
    }
  },
  setView(view) {
    safeClarity.setTag('view', view);
  },
};
