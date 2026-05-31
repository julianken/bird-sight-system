import { useEffect, useMemo, useState } from 'react';
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
): LegendEntry[] {
  // Per-family observation counts. familyCode is nullable on Observation —
  // skip rows without one (they cannot be filtered by family anyway).
  const counts = new Map<string, number>();
  for (const o of observations) {
    if (!o.familyCode) continue;
    counts.set(o.familyCode, (counts.get(o.familyCode) ?? 0) + 1);
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

export function FamilyLegend({
  silhouettes,
  observations,
  familyCode,
  onFamilyToggle,
  defaultExpanded,
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
  useEffect(() => {
    writeStoredExpanded(expanded);
  }, [expanded]);

  const entries = useMemo(
    () => buildEntries(silhouettes, observations),
    [silhouettes, observations],
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

  return (
    <aside
      className="family-legend"
      role="complementary"
      aria-labelledby={toggleId}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        id={toggleId}
        type="button"
        className="family-legend-toggle"
        aria-expanded={expanded}
        aria-controls="family-legend-entries"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="family-legend-title">Bird families in view</span>
        <span className="family-legend-chevron" aria-hidden="true">
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && entries.length > 0 && (
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
