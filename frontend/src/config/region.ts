/**
 * Region configuration.
 *
 * REGION_LABEL is the source of truth for the region name used in the
 * wordmark ("Bird Maps · Arizona"), the lede, and any region claim in
 * the UI.
 *
 * The label is derived from the build-time env var `VITE_REGION_CODE`
 * via a small mapping table. Default is `US-AZ` → "Arizona", which keeps
 * the current AZ deploy unchanged. To flip the build to national/USA,
 * set `VITE_REGION_CODE=US` at build time — no code change required.
 *
 * Spec: docs/design/01-spec/architecture.md §Cross-cutting structures
 */
export const REGION_CODE: string =
  (import.meta.env.VITE_REGION_CODE as string | undefined) ?? 'US-AZ';

const REGION_LABELS: Record<string, string> = {
  'US-AZ': 'Arizona',
  US: 'USA',
};

export const REGION_LABEL: string = REGION_LABELS[REGION_CODE] ?? REGION_CODE;
