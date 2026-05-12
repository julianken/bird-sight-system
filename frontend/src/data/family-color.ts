import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * Neutral fallback color for families absent from the silhouettes response
 * (either the row isn't seeded yet or the response hasn't resolved). Matches
 * the literal value of the `--color-text-muted` design token in styles.css —
 * kept in sync manually because the function must work in SSR / test
 * environments that don't have a live stylesheet. If the token moves off
 * `#555`, update both sides.
 */
export const FAMILY_COLOR_FALLBACK = '#555';

export type FamilyPathResolver = (familyCode: string | null | undefined) => string | null;

export type FamilyColorResolver = (familyCode: string | null | undefined) => string;

/**
 * Build a `familyCode → svgData` resolver from the `/api/silhouettes` response.
 *
 * Mirrors `buildFamilyColorResolver` — the DB stores per-family SVG path data
 * keyed by real eBird family code (e.g. "tyrannidae", "accipitridae"). This
 * resolver is the single source of truth for shape; it replaces the
 * frontend-only abstract FAMILY_PATHS palette for all DB-backed families.
 *
 * Fallback semantics:
 *   - null / undefined familyCode → null (caller falls back to FAMILY_PATHS)
 *   - familyCode not in silhouettes → null
 *   - svgData is null for that family → null (Phylopic-less policy)
 *   - silhouettes === [] (pre-resolve) → null for every code
 *
 * Returns null (not a sentinel string) so callers can detect "no DB shape
 * available" and fall back to the abstract FAMILY_PATHS palette gracefully.
 * This preserves the graceful degradation contract for test environments and
 * the cold-load state before useSilhouettes resolves.
 */
export function buildFamilyPathResolver(
  silhouettes: readonly FamilySilhouette[],
): FamilyPathResolver {
  const byFamily = new Map<string, string | null>();
  for (const s of silhouettes) byFamily.set(s.familyCode.toLowerCase(), s.svgData);

  return (familyCode: string | null | undefined): string | null => {
    if (!familyCode) return null;
    const key = familyCode.toLowerCase();
    if (!byFamily.has(key)) return null;
    return byFamily.get(key) ?? null;
  };
}

/**
 * Build a `familyCode → color` resolver from the `/api/silhouettes` response.
 *
 * Issue #55 option (a) — the resolver is the frontend's only source of truth
 * for family color. The previous `colorForFamily` hardcoded map in
 * `@bird-watch/family-mapping` has been deleted; this function replaces it.
 *
 * Fallback semantics:
 *   - null / undefined familyCode → FAMILY_COLOR_FALLBACK
 *   - familyCode not in the silhouettes array → FAMILY_COLOR_FALLBACK
 *   - silhouettes === [] (pre-resolve) → FAMILY_COLOR_FALLBACK for every code
 *
 * Never throws, never returns transparent. The fallback preference order is:
 *   1. `--color-text-muted` resolved from the live stylesheet when available
 *      (production browsers). This keeps the UI in sync with palette edits
 *      without a code change.
 *   2. The hardcoded `FAMILY_COLOR_FALLBACK` literal. Covers SSR, vitest +
 *      jsdom without a stylesheet, and any other environment where
 *      `getComputedStyle` can't resolve the custom property.
 */
export function buildFamilyColorResolver(
  silhouettes: readonly FamilySilhouette[],
): FamilyColorResolver {
  const byFamily = new Map<string, string>();
  for (const s of silhouettes) byFamily.set(s.familyCode.toLowerCase(), s.color);

  return (familyCode: string | null | undefined): string => {
    if (familyCode) {
      const hit = byFamily.get(familyCode.toLowerCase());
      if (hit) return hit;
    }
    if (typeof window !== 'undefined' && typeof getComputedStyle === 'function') {
      try {
        const resolved = getComputedStyle(document.documentElement)
          .getPropertyValue('--color-text-muted')
          .trim();
        if (resolved) return resolved;
      } catch {
        // Defensive: some test environments throw on getComputedStyle. Fall
        // through to the literal so we never surface an error to the caller.
      }
    }
    return FAMILY_COLOR_FALLBACK;
  };
}
