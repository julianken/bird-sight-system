import Clarity from '@microsoft/clarity';

/**
 * Microsoft Clarity init (issue #657).
 *
 * Reads `VITE_CLARITY_PROJECT_ID` at module-evaluation time (which happens
 * once during app startup via the side-effect import in `main.tsx`).
 *
 * `Clarity.init` is called only when:
 *   - `import.meta.env.PROD` is true (production build only — dev/test
 *     never load Clarity; otherwise the SDK injects a `<script>` that
 *     races HMR and spams the Clarity project with junk sessions).
 *   - `VITE_CLARITY_PROJECT_ID` is a non-empty string.
 *
 * The SDK is idempotent — its injector checks for an existing
 * `<script id="clarity-script">` before inserting, so this is safe to
 * call exactly once at startup.
 *
 * No SPA route tracking is wired: bird-maps.com uses query-string view
 * state (no react-router), and Clarity's auto-SPA detection captures
 * virtual navigations without manual `Clarity.identify()` calls.
 *
 * No masking config: Clarity's default-mask is ON, which is correct for
 * bird-maps.com (public bird sighting data; no PII rendered).
 *
 * No consent gate: bird-watch has no consent banner today (matches the
 * existing PostHog wiring). EEA traffic is near-zero given the current
 * US-AZ region lock — tracked for revisit in #658.
 */
const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID ?? '';

if (import.meta.env.PROD && projectId) {
  Clarity.init(projectId);
}
