import Clarity from '@microsoft/clarity';

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
 * No env-var gate here: `clarity.ts` is the gate (PROD + project ID).
 * The runtime guard below (`window.clarity` exists) only fires before the
 * injected script has wired its queue function — i.e. in dev, in tests,
 * and on prod builds where the env gate suppressed init. This avoids
 * leaking SDK internals (`TypeError: window.clarity is not a function`)
 * into call-site test environments.
 */
interface Analytics {
  capture(eventName: string, properties?: Record<string, unknown>): void;
  setView(view: string): void;
}

function clarityReady(): boolean {
  return typeof window !== 'undefined' &&
    typeof (window as unknown as { clarity?: unknown }).clarity === 'function';
}

export const analytics: Analytics = {
  capture(eventName, properties) {
    if (!clarityReady()) return;
    Clarity.event(eventName);
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        Clarity.setTag(key, String(value));
      }
    }
  },
  setView(view) {
    if (!clarityReady()) return;
    Clarity.setTag('view', view);
  },
};
