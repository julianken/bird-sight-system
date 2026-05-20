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
 * No consent gate: bird-watch has no consent banner today. EEA traffic
 * is near-zero given the current US-AZ region lock — tracked for
 * revisit in #658.
 */
const projectId = import.meta.env.VITE_CLARITY_PROJECT_ID ?? '';

if (import.meta.env.PROD && projectId) {
  Clarity.init(projectId);
}

function isClarityReady(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { clarity?: unknown }).clarity === 'function'
  );
}

/**
 * Guarded Clarity API. The `@microsoft/clarity` SDK throws
 * `TypeError: window.clarity is not a function` when methods are called
 * before `Clarity.init` runs (e.g. dev/test environments, or prod builds
 * with `VITE_CLARITY_PROJECT_ID` unset). The runtime guard here makes
 * pre-init calls safe no-ops.
 *
 * **Convention**: This is the single entry point to the Clarity SDK
 * across the codebase. Do NOT `import Clarity from '@microsoft/clarity'`
 * from any other file — import `safeClarity` from here instead. Only
 * `clarity.ts` is allowed to touch the SDK directly. (Init is the lone
 * exception, called above at module load.)
 *
 * Methods are added as the codebase needs them. Today: `event` for
 * custom events, `setTag` for dimensions. Future additions for the
 * consent banner (#658) should add `consentV2` and `consent` here.
 */
export const safeClarity = {
  event(name: string): void {
    if (isClarityReady()) Clarity.event(name);
  },
  setTag(key: string, value: string): void {
    if (isClarityReady()) Clarity.setTag(key, value);
  },
};
