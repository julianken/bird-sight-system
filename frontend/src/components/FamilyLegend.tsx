import { useEffect, useMemo, useState } from 'react';
import type { FamilySilhouette, Observation } from '@bird-watch/shared-types';
import { prettyFamily } from '../derived.js';

const STORAGE_KEY = 'family-legend-expanded';

export interface FamilyLegendProps {
  /** All known family→silhouette rows (mounted by App via useSilhouettes). */
  silhouettes: FamilySilhouette[];
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
   * Driven by the responsive @media query in styles.css through MapSurface
   * (390-ish viewports start collapsed; >=760 start expanded). Once the
   * user manually toggles, the localStorage value overrides this on
   * subsequent mounts — the responsive default is a first-visit hint, not
   * a sticky rule.
   */
  defaultExpanded: boolean;
}

function readStoredExpanded(): boolean | null {
  try {
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

/**
 * Renders a tiny inline-SVG silhouette for an entry. Uses the seeded
 * 24-unit viewBox path from the family_silhouettes table; falls back to a
 * simple filled circle when svgData is null (pre-curation rows). All
 * silhouettes are rendered in the entry's family color.
 */
function SilhouetteGlyph({ silhouette }: { silhouette: FamilySilhouette }) {
  const size = 28;
  if (silhouette.svgData) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <path d={silhouette.svgData} fill={silhouette.color} />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx={12} cy={12} r={6} fill={silhouette.color} />
    </svg>
  );
}

interface LegendEntry {
  familyCode: string;
  label: string;
  count: number;
  silhouette: FamilySilhouette;
}

function buildEntries(
  silhouettes: FamilySilhouette[],
  observations: Observation[],
): LegendEntry[] {
  // Per-family observation counts. familyCode is nullable on Observation —
  // skip rows without one (they cannot be filtered by family anyway).
  const counts = new Map<string, number>();
  for (const o of observations) {
    if (!o.familyCode) continue;
    counts.set(o.familyCode, (counts.get(o.familyCode) ?? 0) + 1);
  }
  const byCode = new Map<string, FamilySilhouette>();
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
  // Initial state precedence: localStorage > defaultExpanded prop. The
  // function-form initializer means readStoredExpanded only runs once at
  // mount, not on every render.
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = readStoredExpanded();
    return stored ?? defaultExpanded;
  });

  // Persist on every change — including the initial-from-default value, so
  // the next mount across a viewport flip still honors the user's first
  // active choice. Skip the very first effect run when storage already had
  // a value (avoid clobbering the same value).
  useEffect(() => {
    writeStoredExpanded(expanded);
  }, [expanded]);

  const entries = useMemo(
    () => buildEntries(silhouettes, observations),
    [silhouettes, observations],
  );

  // Render nothing when the legend has no useful content. Covers two
  // cases: zero silhouettes available (cache miss / API failure), and
  // zero observations to count against (filtered to empty). In either
  // case the floating overlay would be visual noise.
  if (silhouettes.length === 0) return null;

  const toggleId = 'family-legend-toggle';

  return (
    <aside
      className="family-legend"
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
            return (
              <li key={entry.familyCode} className="family-legend-entry-item">
                <button
                  type="button"
                  data-testid="family-legend-entry"
                  className={'family-legend-entry' + (active ? ' is-active' : '')}
                  aria-pressed={active}
                  onClick={() => onFamilyToggle(entry.familyCode)}
                >
                  <SilhouetteGlyph silhouette={entry.silhouette} />
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
