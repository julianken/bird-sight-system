import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { FamilySilhouette as FamilySilhouetteData, Observation } from '@bird-watch/shared-types';
import { prettyFamily } from '../derived.js';
import { FamilySilhouette } from './ds/FamilySilhouette.js';
import { getFamilyChannel } from '../config/family-palette.js';
import type { FamilyCode, ShapeVariant } from '../config/family-palette.js';
import { FAMILY_PALETTE } from '../config/family-palette.js';
import { useTheme } from '../hooks/use-theme.js';
import { useBreakpoint } from '../hooks/use-breakpoint.js';
import type { Breakpoint } from '../hooks/use-breakpoint.js';
import { countNoun, formatCount } from '../lib/format-count.js';

// E3 (#1055): the expansion preference is now per-breakpoint-CLASS, not a
// single global key. A desktop expand must not force the phone legend open over
// ~40% of the map on the next visit (the cross-breakpoint leak this fixes).
// `useBreakpoint()` supplies the 'compact' | 'roomy' | 'wide' tier and we key
// the stored preference by it: `family-legend-expanded.v3.<tier>`.
const STORAGE_KEY_PREFIX = 'family-legend-expanded.v3';
// Superseded breakpoint-blind key (#783-era). A non-null .v2 is migrated into
// the ACTIVE tier's key only — seeding all three tiers would re-create the
// exact cross-breakpoint leak this issue exists to kill — then .v2 is deleted.
const V2_STORAGE_KEY = 'family-legend-expanded.v2';
// Original (pre-.v2) key. The existing legacy-v1 drop is preserved verbatim.
const LEGACY_STORAGE_KEY = 'family-legend-expanded';

function storageKeyFor(tier: Breakpoint): string {
  return `${STORAGE_KEY_PREFIX}.${tier}`;
}

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
   * desktop expanded). Once the user toggles, the per-breakpoint
   * `family-legend-expanded.v3.<tier>` storage key wins on subsequent mounts
   * for that tier — the responsive default is a first-visit hint, not a
   * sticky rule, and a desktop expand never leaks into the phone tier.
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

function readStoredExpanded(tier: Breakpoint): boolean | null {
  try {
    // Migration: drop the legacy v1 key so it can't clobber the mobile
    // viewport hint on first paint. This runs on every mount; effectively
    // free since the key is absent after first migration.
    if (window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null) {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    }
    const tierKey = storageKeyFor(tier);
    // One-shot .v2 → .v3.<active-tier> migration. A non-null .v2 seeds ONLY the
    // tier the user is on right now, then .v2 is deleted. Seeding all three
    // tiers would re-create the cross-breakpoint leak this issue kills; .v2
    // absent ⇒ no seed (defaultExpanded path is untouched). Don't overwrite an
    // already-set tier key (a fresher per-tier write wins over the stale .v2).
    const v2 = window.localStorage.getItem(V2_STORAGE_KEY);
    if (v2 !== null) {
      if (window.localStorage.getItem(tierKey) === null && (v2 === 'true' || v2 === 'false')) {
        window.localStorage.setItem(tierKey, v2);
      }
      window.localStorage.removeItem(V2_STORAGE_KEY);
    }
    const v = window.localStorage.getItem(tierKey);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return null;
  } catch {
    return null;
  }
}

function writeStoredExpanded(tier: Breakpoint, value: boolean): void {
  try {
    window.localStorage.setItem(storageKeyFor(tier), value ? 'true' : 'false');
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
  // E3 (#1055): the active breakpoint tier keys the stored preference. Reacts
  // to live matchMedia resizes — a mid-session tier change re-reads the new
  // tier's preference (read-only re-key below), never clobbers it.
  const tier = useBreakpoint();

  // Initial state precedence: stored tier key (.v3.<tier>, seeded from a one-shot
  // .v2 migration) > defaultExpanded prop. The function-form initializer means
  // readStoredExpanded only runs once at mount, not on every render. The legacy
  // .v1 key is deleted inside readStoredExpanded so it can never clobber a
  // mobile first-paint.
  const [expanded, setExpanded] = useState<boolean>(() => {
    const stored = readStoredExpanded(tier);
    return stored ?? defaultExpanded;
  });

  // Track the tier the current `expanded` value belongs to so we can detect a
  // live tier transition (compact→wide drag). The write itself happens in the
  // toggle handler (a user action), NOT in an effect — that is what keeps the
  // re-key on resize strictly READ-ONLY. (#1055 reviewer AC: a tier change must
  // NOT write the old `expanded` into the new tier's key — the intra-session
  // form of the cross-breakpoint leak.)
  const tierRef = useRef(tier);

  // On a live tier transition, adopt the NEW tier's stored preference (or its
  // responsive default), writing nothing. This is the per-breakpoint
  // persistence boundary: a compact expand does not leak into the wide tier,
  // and resizing never clobbers a tier key. forceCollapsed is irrelevant here —
  // it is a transient display override, not a stored preference. (O5 #783)
  useEffect(() => {
    if (tierRef.current === tier) return;
    tierRef.current = tier;
    const stored = readStoredExpanded(tier);
    setExpanded(stored ?? defaultExpanded);
  }, [tier, defaultExpanded]);

  // The toggle is the ONLY writer: it persists to the current tier's key at
  // write time. Writing here (not in an effect keyed on `expanded`) means a
  // tier-change-induced state update never persists — the leak the reviewer
  // flagged. First paints defer to defaultExpanded and write nothing, as
  // before. forceCollapsed is a transient override and never advances or
  // persists the stored preference. (O5 #783)
  const handleToggle = () => {
    if (forceCollapsed) return;
    setExpanded(prev => {
      const next = !prev;
      writeStoredExpanded(tier, next);
      return next;
    });
  };

  const entries = useMemo(
    () => buildEntries(silhouettes, observations, familyCounts),
    [silhouettes, observations, familyCounts],
  );

  // E3 (#1055): overflow cue. macOS overlay scrollbars are invisible at rest,
  // so a half-hidden family list gave no signal that more rows lie below the
  // fold. CSS cannot detect overflow, so measure it here and stamp
  // data-overflow on the <ul>; the CSS paints a bottom fade gradient when set.
  // The flag is recomputed on entries/expand change (via the effect dep), on
  // scroll (clear it at the bottom so the fade doesn't sit over the final row),
  // and on resize. Guarded so it never runs while the list isn't mounted.
  const entriesRef = useRef<HTMLUListElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measureOverflow = () => {
    const el = entriesRef.current;
    if (!el) {
      setOverflowing(false);
      return;
    }
    // A 1px slack avoids a flickering fade from sub-pixel rounding, and clear
    // the cue once scrolled to the end (nothing more to reveal below).
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 1;
    setOverflowing(el.scrollHeight > el.clientHeight + 1 && !atBottom);
  };

  // Recompute the overflow flag when the rendered set or expansion changes, and
  // keep it current across viewport resizes (the entries max-height steps down
  // on the compact/roomy bands, changing what overflows). The <ul> may be
  // unmounted (collapsed/empty) — measureOverflow no-ops via its null guard.
  useEffect(() => {
    measureOverflow();
    if (typeof window === 'undefined') return;
    window.addEventListener('resize', measureOverflow);
    return () => window.removeEventListener('resize', measureOverflow);
    // entries identity + the gating booleans drive a remeasure; measureOverflow
    // reads live DOM so it needs no deps of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, expanded, forceCollapsed]);

  // Phase 1 contrast (#578, F3): read [data-theme] so legend swatches use the
  // correct palette column. The legend card surface is --color-bg-surface
  // (#1b2742) in dark mode — a different (lighter) background than the light
  // basemap (#f4f1ea), so the light `color` (darkened for contrast on cream)
  // fails ≥3:1 against the dark card. `colorDark` is the original
  // lighter/brighter hex that passes both the dark basemap and the legend card.
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

  // E3 (#1055): zero-in-view honesty. When there are silhouettes (so we don't
  // hit the hard `return null` above) but zero entries to show, the collapsed
  // pill must not advertise an expand whose only result is an empty card. While
  // collapsed-and-empty the toggle becomes non-interactive ("No families in
  // view"); it restores to a live toggle the moment entries return. While
  // expanded-and-empty we keep aria-expanded truthful and render one muted row
  // ("No birds in this view") rather than a bare header. forceCollapsed is a
  // transient overlay state, not a true empty-view, so it is excluded.
  const isEmpty = entries.length === 0;
  const zeroStateCollapsed = isEmpty && !forceCollapsed && !effectiveExpanded;
  const expandedEmpty = effectiveExpanded && isEmpty;
  const titleText = zeroStateCollapsed ? 'No families in view' : 'Bird families in view';

  return (
    <aside
      className="family-legend"
      role="complementary"
      aria-labelledby={toggleId}
      data-expanded={expanded ? 'true' : 'false'}
      {...(zeroStateCollapsed ? { 'data-empty': 'true' } : {})}
      {...(forceCollapsed ? { 'data-force-collapsed': 'true' } : {})}
    >
      <button
        id={toggleId}
        type="button"
        className="family-legend-toggle"
        aria-expanded={effectiveExpanded}
        {...(zeroStateCollapsed ? { disabled: true } : {})}
        {...(effectiveExpanded && entries.length > 0 ? { 'aria-controls': 'family-legend-entries' } : {})}
        onClick={handleToggle}
      >
        <span className="family-legend-title">{titleText}</span>
        {/* E3 (#1055): a ≥16px SVG chevron replaces the near-invisible
            --type-xs ▸ glyph. At rest (collapsed) it points UP — the pill
            expands upward, so "up" reads as "expand", not "navigate right".
            data-expanded drives the CSS rotate(180deg) → points down to read
            as "collapse downward". CHEVRON ROTATE ONLY — do NOT animate the
            entries <ul> (hard guard: always-mounted/animated list reintroduces
            the #837 corner overlap). The zero-state pill hides the chevron — a
            non-interactive pill has nothing to expand. */}
        {!zeroStateCollapsed && (
          <svg
            className="family-legend-chevron"
            data-expanded={effectiveExpanded ? 'true' : 'false'}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M3.5 10.5 8 6l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
      {expandedEmpty && (
        <p className="family-legend-empty" role="status">
          No birds in this view — pan or zoom out.
        </p>
      )}
      {effectiveExpanded && entries.length > 0 && (
        <ul
          ref={entriesRef}
          id="family-legend-entries"
          className="family-legend-entries"
          role="list"
          data-overflow={overflowing ? 'true' : 'false'}
          onScroll={measureOverflow}
        >
          {entries.map(entry => {
            const active = entry.familyCode === familyCode;
            // Shape is still sourced from the palette channel (WCAG 1.4.1 —
            // color is not the sole discriminator). Codes not in FAMILY_PALETTE
            // fall back to the null-channel shape (circle). The fill color,
            // however, now comes from the DB silhouettes payload — using
            // `colorDark` in dark mode so the swatch passes ≥3:1 against the
            // dark legend card surface (--color-bg-surface, #1b2742), and `color`
            // in light mode for the light basemap (#f4f1ea). Mirrors
            // AdaptiveGridMarker's pattern.
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
                  <span className="family-legend-entry-label" title={entry.label}>{entry.label}</span>
                  <span
                    className="family-legend-entry-count"
                    aria-label={`${countNoun(entry.count, 'observation')} in view`}
                  >
                    {formatCount(entry.count)}
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
