import { memo, useEffect, useMemo, useState } from 'react';
import type { FamilySilhouette as FamilySilhouetteData, Observation } from '@bird-watch/shared-types';
import { prettyFamily } from '../derived.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';
import { getFamilyChannel } from '../config/family-palette.js';
import type { FamilyCode, ShapeVariant } from '../config/family-palette.js';
import { FAMILY_PALETTE } from '../config/family-palette.js';
import { useTheme } from '../hooks/use-theme.js';

const STORAGE_KEY = 'family-legend-expanded.v2';
const LEGACY_STORAGE_KEY = 'family-legend-expanded';

export interface FamilyLegendProps {
  /** All known family→silhouette rows (mounted by App via useSilhouettes). */
  silhouettes: FamilySilhouetteData[];
  /** Observations currently in scope — drives per-family counts. */
  observations: Observation[];
  /**
   * #859 F: EXACT per-family observation counts (familyCode → count), used in
   * aggregated (low-zoom) mode where there are no per-observation rows. When
   * provided this is the authoritative count source — summed from
   * `bucket.families[].count`, NEVER the capped species list — and
   * `observations` is ignored for counting. Absent (per-observation mode) ⇒
   * counts derive from `observations` as before.
   */
  familyCounts?: ReadonlyMap<string, number>;
  /** Currently active family filter (drives the toggle/aria-pressed state). */
  familyCode: string | null;
  /**
   * Toggle handler — App.tsx wires this to:
   *   set({ familyCode: prev === code ? null : code })
   * Single source of truth for URL-state writes; FamilyLegend never calls
   * useUrlState directly. Mirrors FiltersBar's `onChange` prop pattern.
   */
  onFamilyToggle: (familyCode: string) => void;
  /**
   * Default expansion state on first paint when localStorage is empty.
   * Driven by the responsive @media query in MapSurface (mobile collapsed,
   * desktop expanded). Once the user toggles, the new .v2 storage key
   * wins on subsequent mounts — the responsive default is a first-visit
   * hint, not a sticky rule.
   */
  defaultExpanded: boolean;
  /**
   * Transient display override — when `true`, render the collapsed toggle bar
   * ONLY (no entries), regardless of the user's internal `expanded` state.
   * Does NOT mutate or persist `expanded` (the stored preference survives).
   * Used by App.tsx to suppress the legend while another overlay holds focus
   * on mobile (chooser scrim, filters sheet, half/full detail sheet).
   * Reflected as `data-force-collapsed` for e2e assertions. (O5 #783)
   */
  forceCollapsed?: boolean;
}

function readStoredExpanded(): boolean | null {
  try {
    // Migration: drop the legacy key so it can't clobber the mobile
    // viewport hint on first paint. This runs on every mount; effectively
    // free since the key is absent after first migration.
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredExpanded(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
  } catch {
    // Storage failures (private mode, quota) are non-fatal — the legend
    // simply forgets the preference next mount.
  }
}

interface LegendEntry {
  familyCode: string;
  label: string;
  count: number;
  silhouette: FamilySilhouetteData;
}

function buildEntries(
  silhouettes: FamilySilhouetteData[],
  observations: Observation[],
  familyCounts?: ReadonlyMap<string, number>,
): LegendEntry[] {
  // Per-family counts. In aggregated mode (#859 F) the caller supplies EXACT
  // counts summed from bucket.families[].count — use them verbatim. Otherwise
  // count the per-observation rows (familyCode is nullable on Observation —
  // skip rows without one; they cannot be filtered by family anyway).
  const counts = new Map<string, number>();
  if (familyCounts) {
    for (const [code, count] of familyCounts) counts.set(code, count);
  } else {
    for (const o of observations) {
      if (!o.familyCode) continue;
      counts.set(o.familyCode, (counts.get(o.familyCode) ?? 0) + 1);
    }
  }
  const byCode = new Map<string, FamilySilhouetteData>();
  for (const s of silhouettes) byCode.set(s.familyCode, s);

  const out: LegendEntry[] = [];
  for (const [code, count] of counts.entries()) {
    if (count === 0) continue;
    const silhouette = byCode.get(code);
    if (!silhouette) continue;
    out.push({
      familyCode: code,
      label: silhouette.commonName ?? prettyFamily(code),
      count,
      silhouette,
    });
  }
  // Stable display order: alphabetic by label so the legend reads like an
  // index. Counts shift between filter changes; a stable label sort keeps
  // entries visually anchored.
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function FamilyLegendImpl({
  silhouettes,
  observations,
  familyCounts,
  familyCode,
  onFamilyToggle,
  defaultExpanded,
  forceCollapsed = false,
}: FamilyLegendProps) {
  // Initial state precedence: localStorage .v2 > defaultExpanded prop.
  // The function-form initializer means readStoredExpanded only runs once
  // at mount, not on every render. The legacy .v1 key is deleted inside
  // readStoredExpanded so it can never clobber a mobile first-paint.
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = readStoredExpanded();
    return stored ?? defaultExpanded;
  });

  // Persist on every change. The write is idempotent; cost is trivial.
  // Only written after a manual toggle — first paints defer to defaultExpanded.
  // forceCollapsed does NOT trigger this effect — it is a transient display
  // override and must NOT mutate the user's stored preference. (O5 #783)
  useEffect(() => {
    writeStoredExpanded(expanded);
  }, [expanded]);

  const entries = useMemo(
    () => buildEntries(silhouettes, observations, familyCounts),
    [silhouettes, observations, familyCounts],
  );

  // Phase 1 contrast (#578, F3): read [data-theme] so legend swatches use the
  // correct palette column. The legend card surface is #131C30 in dark mode —
  // a different (lighter) background than the light basemap (#f4f1ea), so the
  // light `color` (darkened for contrast on cream) fails ≥3:1 against the dark
  // card. `colorDark` is the original lighter/brighter hex that passes both
  // #0E1116 (Phase 3 dark basemap) and #131C30 (legend card).
  const isDark = useTheme() === 'dark';

  // Render nothing when the legend has no useful content. Covers two
  // cases: zero silhouettes available (cache miss / API failure), and
  // zero observations to count against (filtered to empty). In either
  // case the floating overlay would be visual noise.
  if (silhouettes.length === 0) return null;

  const toggleId = 'family-legend-toggle';

  // When forceCollapsed is true, the effective rendered state is collapsed
  // regardless of the internal `expanded` value. aria-expanded reflects the
  // effective rendered state (what the user actually sees), not the stored
  // preference. (O5 #783 — AC: "aria-expanded accurate to effective state")
  const effectiveExpanded = forceCollapsed ? false : expanded;

  return (
    <aside
      className="family-legend"
      role="complementary"
      aria-labelledby={toggleId}
      data-expanded={expanded ? 'true' : 'false'}
      {...(forceCollapsed ? { 'data-force-collapsed': 'true' } : {})}
    >
      <button
        id={toggleId}
        type="button"
        className="family-legend-toggle"
        aria-expanded={effectiveExpanded}
        {...(effectiveExpanded && entries.length > 0 ? { 'aria-controls': 'family-legend-entries' } : {})}
        onClick={() => {
          // forceCollapsed is a transient display override — the toggle
          // click still advances the stored preference if forceCollapsed
          // is true (the stored preference persists; the force-collapsed
          // visual is driven by the parent prop, not by expanded state).
          if (!forceCollapsed) setExpanded(prev => !prev);
        }}
      >
        <span className="family-legend-title">Bird families in view</span>
        <span className="family-legend-chevron" aria-hidden="true">
          {effectiveExpanded ? '▾' : '▸'}
        </span>
      </button>
      {effectiveExpanded && entries.length > 0 && (
        <ul
          id="family-legend-entries"
          className="family-legend-entries"
          role="list"
        >
          {entries.map(entry => {
            const active = entry.familyCode === familyCode;
            // Shape is still sourced from the palette channel (WCAG 1.4.1 —
            // color is not the sole discriminator). Codes not in FAMILY_PALETTE
            // fall back to the null-channel shape (circle). The fill color,
            // however, now comes from the DB silhouettes payload — using
            // `colorDark` in dark mode so the swatch passes ≥3:1 against the
            // dark legend card surface (#131C30), and `color` in light mode for
            // the light basemap (#f4f1ea). Mirrors AdaptiveGridMarker's pattern.
            const paletteCode = (entry.familyCode in FAMILY_PALETTE)
              ? (entry.familyCode as FamilyCode)
              : null;
            const channel = getFamilyChannel(paletteCode);
            const shape: ShapeVariant = channel.shape;
            const swatchColor = isDark ? entry.silhouette.colorDark : entry.silhouette.color;
            return (
              <li key={entry.familyCode} className="family-legend-entry-item">
                <button
                  type="button"
                  data-testid="family-legend-entry"
                  className={'family-legend-entry' + (active ? ' is-active' : '')}
                  aria-pressed={active}
                  onClick={() => onFamilyToggle(entry.familyCode)}
                >
                  <FamilySilhouette
                    family={entry.familyCode}
                    layout="thumb"
                    shape={shape}
                    color={swatchColor}
                    {...(entry.silhouette.svgUrl != null ? { imgUrl: entry.silhouette.svgUrl } : {})}
                    {...(entry.silhouette.svgData != null ? { pathD: entry.silhouette.svgData } : {})}
                  />
                  <span className="family-legend-entry-label">{entry.label}</span>
                  <span
                    className="family-legend-entry-count"
                    aria-label={`${entry.count} observations in view`}
                  >
                    {entry.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/**
 * O8 (#784): React.memo boundary — prevents re-renders when App-level state
 * (e.g. nowTick / visibilitychange) changes but FamilyLegend's own props are
 * unchanged. All props are primitives or useCallback-stable references, so the
 * default shallow comparison short-circuits on a same-minute nowTick bump.
 */
export const FamilyLegend = memo(FamilyLegendImpl);
FamilyLegend.displayName = 'FamilyLegend';
