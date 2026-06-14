import { useState, useId, useRef, useEffect } from 'react';
import type { MouseEvent as ReactMouseEvent, CSSProperties, KeyboardEvent } from 'react';
import type { AdaptiveTile, ResolvedGrid } from '@/components/map/geometry/adaptive-grid.js';
import { visibleCapacity } from '@/components/map/geometry/adaptive-grid.js';
import { prettyFamily } from '@/derived.js';
import { FALLBACK_SILHOUETTE_PATH } from '@/components/map/geometry/silhouette-fallback.js';
import { useMediaQuery } from '@/hooks/use-media-query.js';
import { useTheme } from '@/hooks/use-theme.js';
import { CellHoverPreview } from './CellHoverPreview.js';
import { CellPopover } from './CellPopover.js';
import { countNoun, formatCount } from '@/lib/format-count.js';
import { ClusterListPopover } from './ClusterListPopover.js';

/**
 * `<AdaptiveGridMarker>` — pure display component for the adaptive cluster
 * grid (epic #539, spec `docs/specs/2026-05-14-adaptive-cluster-grid-design.md`
 * §4.3–4.8, §5.1). Renders a 1×1 / 2×1 / 2×2 / 3×3 / 4×4 grid (or 3×3 with a
 * "+N more" overflow indicator on mobile) of family silhouettes with per-cell
 * count badges.
 *
 * The marker is a **pure display component**: it never inspects its own
 * shape to choose between parent-domain actions. The caller selects the
 * click handler (`zoomToExpansion` vs `openObsPanel`) based on
 * `isSingleLeaf(clusterId)` before rendering — see spec §4.5.
 *
 * Hit-extender contract (spec §4.4, corrected per Phase 0 issue #541):
 *   - The outer `<button>` IS the click surface.
 *   - `tabIndex={-1}` (spec §4.7 — keyboard users use the live "Explore map
 *     markers" skip-link to reach the first marker cell, #558).
 *   - A transparent overlay `<span class="adaptive-grid-marker__hit">`
 *     extends OUTWARD via per-axis `top/bottom/left/right` style values
 *     so the hit zone is ≥44×44 (fine pointer) or ≥48×48 (coarse). The
 *     spec's prose §4.4 formula (`inset: min(0, (44-size)/2)`) is wrong on
 *     two counts: (a) for `size < 44` the inner value is positive so the
 *     min clamps to 0 (no extension at all), and (b) for non-square
 *     markers a single scalar leaves the short axis under 44. The
 *     per-axis form below is the corrected formula from issue #541.
 *
 * Tile variants (spec §5.1):
 *   - `rendered`: catalogue loaded, family has CC-licensed art → paint
 *     halo + colored path. Notable amber ring layers BEFORE the path
 *     (spec AC8, inherited from StackedSilhouetteMarker).
 *   - `fallback`: catalogue loaded, no art for this family → generic
 *     placeholder shape at opacity 0.85 + dashed border (Phase 2 #571).
 *   - `pending`: catalogue not loaded yet → animated shimmer skeleton.
 *     Distinct from `fallback` so a cold-load map doesn't look like a
 *     coverage gap (spec §5.1 type comment).
 *
 * Two-tier ARIA (spec §4.6): the parent passes a fully-constructed
 * `ariaLabel` plus optional `describedByListId` + `describedByItems` (an
 * `<ul>` of up to 9 family enumerations). The marker never builds the
 * label string itself — the parent owns the per-state label format from
 * the §4.6 table.
 *
 * Phase 1 cell popover (spec §4.5, §4.6, §4.7, §4.8, epic #556, issue #558):
 * When the pointer is fine (not coarse), each `<TileCell>` becomes a
 * `<button>` with per-cell hover/focus/click interaction. The hit-extender
 * overlay's `pointerEvents` toggles to `'none'` in that mode so it doesn't
 * intercept individual cell events.
 */

export interface AdaptiveGridMarkerProps {
  /** Narrowed by the parent — pill is rendered by a sibling component. */
  shape: ResolvedGrid;
  /**
   * Tiles in render order (already sorted descending count by
   * `aggregateClusterFamilies`). Length is ≤ `visibleCapacity(shape)`;
   * empty trailing slots render as transparent padders.
   */
  tiles: ReadonlyArray<AdaptiveTile>;
  /**
   * Cluster's full `point_count`. Not used for badge visibility (per spec
   * §4.3 that's a per-cell decision driven by `cellCount > 1`) but kept on
   * the public prop shape because callers thread it for aria-label
   * construction and parity with sibling marker components.
   */
  totalCount: number;
  /** For aria-label parity; not currently rendered (parent threads label). */
  uniqueFamilies: number;
  /** Pre-built per spec §4.6 table — the parent owns label format. */
  ariaLabel: string;
  /** Optional id of the visually-hidden `<ul>` for two-tier disclosure. */
  describedByListId?: string;
  /** Up to 9 family enumeration strings (8 + "and N more families"). */
  describedByItems?: ReadonlyArray<string>;
  /** `useMediaQuery('(pointer: coarse)')` — raises hit zone to 48×48. */
  isCoarsePointer?: boolean;
  /** Phase 0 AC8 — paint amber ring before silhouette path. */
  isNotable?: boolean;
  /** Species name for the notable single-obs case (unused today; reserved). */
  notableSpeciesName?: string;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  /** Phase 1 (#558): forwarded from per-cell popover row clicks. */
  onSelectSpecies?: (speciesCode: string) => void;
  /**
   * #859: invoked when the user activates a per-family `<CellPopover>` "+N more"
   * drill-in. The caller eases the camera into this marker's cell so the top-N
   * per-family cap no longer applies (the same active drill-in the cluster-list
   * path uses). Absent ⇒ the per-family "+N more" stays inert footer text.
   * A single callback suffices: every cell in one marker shares the marker's
   * geographic center, so the drill target is identical regardless of which
   * family's "+N more" was clicked.
   */
  onDrillIn?: () => void;
  /**
   * #761 O6 (#782) → reversed by #976: true when a detail overlay
   * (SpeciesDetailRail / Sheet) holds focus (App-level `state.detail` under an
   * active scope). #782 originally SUPPRESSED the passive `<CellHoverPreview>`
   * mount in this state; #976 reverses that product decision (Julian wants
   * hover-to-compare to work with a detail open). The preview now ALWAYS mounts
   * in the preview branch and this flag is forwarded as `belowDetail`, which
   * DEMOTES the tooltip beneath every detail surface (z `--z-under-detail` = 5,
   * below sheet peek/half/full AND the rail) so it stays visible on the map but
   * is occluded wherever it overlaps the detail — honoring #782's anti-clutter
   * intent without suppression. The click-driven `<CellPopover>` /
   * `<ClusterListPopover>` remain UNAFFECTED. Defaults to `false`.
   */
  detailOpen?: boolean;
}

// Layout constants — match MosaicMarker's 22px tile / 2px gap (issue #248).
export const CELL_PX = 22;
export const GRID_GAP_PX = 2;
export const GRID_PADDING_PX = 3;

const HIT_MIN_FINE = 44;
const HIT_MIN_COARSE = 48;

/**
 * O2 (#1030, WCAG 4.1.2): accessible name for a per-family silhouette `<button>`
 * cell. The cells were name-less (`aria-haspopup`/`aria-describedby` only) — a
 * Lighthouse `button-name` fail. Format: "{family}, {count} observation[s]".
 *
 * `displayName` is the tile's resolved colloquial family name
 * (`resolveFamilyName(familyCode, …)`); it falls back to `prettyFamily(code)`
 * (a capitalized scientific code) when blank/absent so the label is NEVER
 * empty. The count is pluralized so the announcement reads naturally.
 */
function cellAriaLabel(tile: AdaptiveTile): string {
  const family =
    tile.displayName && tile.displayName.trim().length > 0
      ? tile.displayName
      : prettyFamily(tile.familyCode);
  return `${family}, ${countNoun(tile.count, 'observation')}`;
}

// C50 (#1032, WCAG 1.4.11): #f59e0b on the cream light basemap #f4f1ea = 1.90:1
// — below the 3:1 non-text floor. Theme-paired: dark keeps the amber (8.56:1 on
// #0d1424); light uses --c-deep-ember #c43a1a (4.69:1 on #f4f1ea, >3:1).
const NOTABLE_AMBER_DARK = '#f59e0b';
const NOTABLE_AMBER_LIGHT = '#c43a1a';

/**
 * Rows `<CellPopover>` shows per family — mirrors its private `POPOVER_CAP`
 * (and the backend's `TOP_SPECIES_PER_FAMILY`). Used here to size the active
 * "+N more" overflow from the tile's TRUE distinct-species count.
 */
const CELL_POPOVER_CAP = 8;

/**
 * #859: derive the per-family `<CellPopover>` drill-in props from a tile.
 *
 * When the aggregated path threaded a true `speciesCount` onto the tile AND it
 * exceeds the rows the popover renders, we pass an EXACT `overflowCount` plus
 * `onDrillIn` so the "+N more" becomes an active control that eases the camera
 * into this cell — matching the cluster-list path. When `speciesCount` is
 * absent (per-observation path) or there's no overflow, we pass nothing and the
 * popover keeps its legacy static footer.
 */
function cellPopoverDrillProps(
  tile: AdaptiveTile,
  onDrillIn: (() => void) | undefined,
): { overflowCount?: number; onDrillIn?: () => void } {
  if (tile.speciesCount === undefined || typeof onDrillIn !== 'function') return {};
  const shown = Math.min(tile.species.length, CELL_POPOVER_CAP);
  const overflowCount = Math.max(0, tile.speciesCount - shown);
  if (overflowCount === 0) return {};
  return { overflowCount, onDrillIn };
}

/**
 * Minimum possible rendered marker width/height, used by the deconflict
 * module (issue #554) to derive the spatial-bucket key:
 *
 *   BUCKET_PX = MIN_MARKER_PX / 2 = 14
 *
 * Equals the 1×1 grid width: 1*22 + 0*2 + 2*3 = 28.
 */
// Derived from the cell constants: 1 column × CELL_PX + 0 gaps × GRID_GAP_PX
// + 2 × GRID_PADDING_PX = 22 + 0 + 6 = 28. Keeping the derivation in code
// ensures the bucket size stays consistent if the cell constants ever shift.
export const MIN_MARKER_PX = 1 * CELL_PX + 0 * GRID_GAP_PX + 2 * GRID_PADDING_PX;

export function markerDimensions(shape: ResolvedGrid): { w: number; h: number } {
  const w = shape.cols * CELL_PX + (shape.cols - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  const h = shape.rows * CELL_PX + (shape.rows - 1) * GRID_GAP_PX + 2 * GRID_PADDING_PX;
  return { w, h };
}

export function AdaptiveGridMarker(props: AdaptiveGridMarkerProps) {
  const {
    shape,
    tiles,
    ariaLabel,
    describedByListId,
    describedByItems,
    isCoarsePointer,
    isNotable,
    onClick,
    onSelectSpecies,
    onDrillIn,
    detailOpen = false,
  } = props;

  const isPointerFine = useMediaQuery('(pointer: fine)');
  const perCellInteractive = isPointerFine && !isCoarsePointer;

  // Phase 1 contrast (#570): read [data-theme] so SVG fills use the correct
  // palette column. In dark mode, tiles render `colorDark` (the original
  // lighter/brighter hex that passes #0E1116); in light mode they render
  // `color` (the darkened hex that passes #f4f1ea). The dead code path for
  // dark mode becomes live once Phase 4 flips the BASEMAP_DARK alias.
  const theme = useTheme();
  const isDark = theme === 'dark';

  const clusterListInteractive = isCoarsePointer === true;
  const [isClusterListOpen, setIsClusterListOpen] = useState<boolean>(false);
  const outerRef = useRef<HTMLElement | null>(null);

  // Build the FamilyAggregate[] and speciesByFamily Map from tiles (Phase 0
  // already threads `species` per tile; no re-aggregation needed).
  const families = tiles.map((t) => ({ familyCode: t.familyCode, count: t.count }));
  const speciesByFamily = new Map(tiles.map((t) => [t.familyCode, t.species]));
  // #920: each tile already carries its resolved colloquial `displayName`
  // (`resolveFamilyName(familyCode, { commonName })`). Thread it to the
  // <ClusterListPopover> so the family-toggle headers show the curated name
  // instead of the scientific `prettyFamily(code)`.
  const familyNames = new Map(tiles.map((t) => [t.familyCode, t.displayName]));

  // Single-leaf preservation (spec §4.10): clusters with totalCount === 1 fall
  // through to the existing onClick handler (which routes to setSelectedObs in
  // MapCanvas). The cluster-list popover never opens for single-leaf markers.
  const isSingleLeaf = props.totalCount === 1;

  const markerId = useId();
  const [activeCell, setActiveCell] = useState<{ index: number; mode: 'preview' | 'popover' } | null>(null);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const mouseLeaveTimers = useRef<Array<number | null>>([]);

  const visibleN = visibleCapacity(shape);
  const { w: markerWidth, h: markerHeight } = markerDimensions(shape);

  // Per-axis hit-extender — corrected formula from issue #541.
  // For non-square markers (e.g. 2×1 = 52×28), a single scalar `inset` using
  // max(w,h) would leave the short axis at 28px. Each axis extends OUTWARD
  // by half its own deficit so BOTH dimensions reach the WCAG target.
  const hitMin = isCoarsePointer ? HIT_MIN_COARSE : HIT_MIN_FINE;
  const widthDeficit = Math.max(0, hitMin - markerWidth);
  const heightDeficit = Math.max(0, hitMin - markerHeight);
  const hitOverlayStyle: CSSProperties = {
    position: 'absolute',
    top: -heightDeficit / 2,
    bottom: -heightDeficit / 2,
    left: -widthDeficit / 2,
    right: -widthDeficit / 2,
    background: 'transparent',
    // Phase 1 (#558): when per-cell interaction is active, disable pointer
    // events on the overlay so individual cell buttons receive events directly.
    pointerEvents: perCellInteractive ? 'none' : 'auto',
  };

  // Per spec §4.3 line 124: hidden when cell.count === 1 (regardless of the
  // cluster's total observation count). In a 1×1 single-observation marker,
  // this collapses to the same outcome as the prior "totalCount > 1" guard
  // because cellCount === totalCount === 1.
  const showBadgeFor = (cellCount: number): boolean => cellCount > 1;

  // Per-cell interaction handlers (Phase 1, #558).
  function onCellMouseEnter(i: number) {
    if (mouseLeaveTimers.current[i]) {
      window.clearTimeout(mouseLeaveTimers.current[i]!);
      mouseLeaveTimers.current[i] = null;
    }
    setActiveCell((prev) => (prev?.mode === 'popover' ? prev : { index: i, mode: 'preview' }));
  }

  function onCellMouseMove(e: ReactMouseEvent<HTMLElement>) {
    setCursorPos({ x: e.clientX, y: e.clientY });
  }

  function onCellMouseLeave(i: number) {
    // Do NOT reset cursorPos here. The preview stays mounted for the 250ms
    // dwell below; clearing cursorPos now would flip <CellHoverPreview> from its
    // cursor-anchored render (position:fixed, portaled to body) to the
    // CSS-anchored fallback (position:absolute, inline) for that whole window —
    // a visible "tooltip jumps to a different spot, then disappears" glitch.
    // The preview either follows the cursor or unmounts; never an in-between.
    // Positioning is reset on keyboard focus (onCellFocus) instead, which is the
    // only path that legitimately needs the CSS-anchored render.
    // Spec §4.5: 250ms delay; skipped when click-promoted to popover.
    mouseLeaveTimers.current[i] = window.setTimeout(() => {
      setActiveCell((prev) => (prev?.index === i && prev.mode === 'preview' ? null : prev));
    }, 250);
  }

  function onCellFocus(i: number) {
    // Keyboard/programmatic focus carries no pointer coordinate. Reset cursorPos
    // so the preview renders CSS-anchored near the focused cell rather than
    // following a stale mouse coordinate left over from an earlier hover.
    setCursorPos(null);
    setActiveCell((prev) => (prev?.mode === 'popover' ? prev : { index: i, mode: 'preview' }));
  }

  function onCellBlur(i: number) {
    setActiveCell((prev) => (prev?.index === i && prev.mode === 'preview' ? null : prev));
  }

  function onCellClick(i: number) {
    setActiveCell({ index: i, mode: 'popover' });
  }

  function onCellKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setActiveCell({ index: i, mode: 'popover' });
    }
  }

  function onPopoverDismiss() {
    setActiveCell(null);
    // Focus return handled inside <CellPopover> via anchorEl.
  }

  // Fix: clear pending mouseleave timers on unmount to prevent late setTimeout
  // firing into an unmounted component (React warn + memory leak).
  useEffect(() => {
    return () => {
      for (const id of mouseLeaveTimers.current) {
        if (id !== null) clearTimeout(id);
      }
      mouseLeaveTimers.current = [];
    };
  }, []);

  // E1 (#1053): close marker-local popovers on the RISING edge of `detailOpen`.
  // When the user opens a species detail, any open click-driven popover must be
  // dismissed — desktop: it otherwise lingers mid-map beside the detail card;
  // mobile: it paints ON TOP of the detail sheet, occluding the heading. We
  // clear the click-promoted cell popover (`activeCell` in 'popover' mode — a
  // 'preview' hover stays, that's the #976 hover-to-compare path) and the
  // coarse-pointer cluster list. RISING-edge only (tracked via a ref): a popover
  // opened WHILE detail is already up is left alone, so hover-to-compare on the
  // open detail still works. The sibling rising-edge effect for the
  // MapCanvas-owned `selectedObs`/`clusterList` lives in MapCanvas.tsx.
  const prevDetailOpen = useRef(detailOpen);
  useEffect(() => {
    if (detailOpen && !prevDetailOpen.current) {
      setActiveCell((prev) => (prev?.mode === 'popover' ? null : prev));
      setIsClusterListOpen(false);
    }
    prevDetailOpen.current = detailOpen;
  }, [detailOpen]);

  const activeTile = activeCell !== null ? tiles[activeCell.index] : null;
  const previewId = activeTile
    ? `cell-${markerId}-${activeTile.familyCode}-preview`
    : undefined;

  // Fix: when per-cell interaction is active, the outer element must NOT be a
  // <button> because each TileCell is already a <button> — nested interactive
  // elements are invalid HTML (WHATWG §4.10.6). Spec §4.5 explicitly licenses
  // this: the outer click is a no-op when cells handle their own clicks.
  // ARIA label + describedby stay on the outer container for SR coherence.
  const OuterTag = perCellInteractive ? 'div' : 'button';
  const outerInteractiveProps = perCellInteractive
    ? ({ role: 'group' as const })
    : ({
        type: 'button' as const,
        // C48 (#1030, WCAG 2.4.1+2.1.1): on coarse pointers the per-cell
        // silhouettes are non-focusable <div>s, so this OUTER button is the only
        // focusable surface — it MUST be in the Tab order (tabIndex=0) for an
        // iPad + hardware keyboard to reach the marker layer (and the skip-link
        // targets it, never a non-focusable element). On fine pointers without
        // per-cell interaction the cluster is reached via the per-cell buttons /
        // hit layer, so the outer button stays out of the Tab order (-1),
        // preserving #558's single-tab-stop and the existing test contract.
        tabIndex: clusterListInteractive ? 0 : -1,
        onClick: (e: ReactMouseEvent<HTMLElement>) => {
          if (clusterListInteractive && !isSingleLeaf) {
            // Phase 2: open the cluster-list popover instead of the parent's
            // zoom handler. Single-leaf clusters fall through to onClick
            // (preserves the existing tap-to-obs UX per spec §4.10).
            e.preventDefault();
            if (!isClusterListOpen) setIsClusterListOpen(true);
            return;
          }
          onClick(e);
        },
      });

  return (
    <OuterTag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ref={(el: any) => { outerRef.current = el; }}
      data-testid="adaptive-grid-marker"
      className="adaptive-grid-marker"
      aria-label={ariaLabel}
      aria-describedby={describedByListId}
      style={{
        position: 'relative',
        padding: 0,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        width: markerWidth,
        height: markerHeight,
      }}
      {...outerInteractiveProps}
    >
      <span
        data-testid="adaptive-grid-marker-hit"
        className="adaptive-grid-marker__hit"
        aria-hidden="true"
        style={hitOverlayStyle}
      />
      <div
        className="adaptive-grid-marker__grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${shape.cols}, ${CELL_PX}px)`,
          gridTemplateRows: `repeat(${shape.rows}, ${CELL_PX}px)`,
          gap: GRID_GAP_PX,
          padding: GRID_PADDING_PX,
          position: 'relative',
        }}
      >
        {tiles.slice(0, visibleN).map((tile, i) => (
          <TileCell
            key={`${tile.familyCode}-${i}`}
            tile={tile}
            isDark={isDark}
            showBadge={showBadgeFor(tile.count)}
            isNotable={isNotable}
            perCellInteractive={perCellInteractive}
            isExpanded={activeCell?.index === i && activeCell.mode === 'popover'}
            {...(perCellInteractive && activeCell?.index === i && previewId ? { previewId } : {})}
            cellRef={(el) => { cellRefs.current[i] = el; }}
            onCellMouseEnter={() => onCellMouseEnter(i)}
            onCellMouseMove={onCellMouseMove}
            onCellMouseLeave={() => onCellMouseLeave(i)}
            onCellFocus={() => onCellFocus(i)}
            onCellBlur={() => onCellBlur(i)}
            onCellClick={() => onCellClick(i)}
            onCellKeyDown={(e) => onCellKeyDown(e, i)}
          />
        ))}
        {shape.tag === 'grid-overflow' && (
          <div
            data-testid="adaptive-grid-marker-overflow"
            className="adaptive-grid-marker__cell adaptive-grid-marker__overflow"
          >
            +{shape.hiddenCount}
          </div>
        )}
      </div>
      {describedByListId && describedByItems && (
        <ul id={describedByListId} className="sr-only">
          {describedByItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>
      )}
      {perCellInteractive && activeCell !== null && activeTile && (
        activeCell.mode === 'preview' ? (
          // #761 O6 (#782) → #976: the passive hover preview ALWAYS mounts now
          // (hover-to-compare must work with a detail open). When a detail
          // overlay holds focus we pass `belowDetail` so the tooltip is DEMOTED
          // beneath every detail surface (z `--z-under-detail` 5 < sheet/rail)
          // instead of suppressed — visible on the map, occluded over the
          // detail. The click-driven popover branch below stays ungated.
          <CellHoverPreview
            familyCode={activeTile.familyCode}
            familyName={activeTile.displayName}
            familyCount={activeTile.count}
            species={activeTile.species}
            id={previewId!}
            cursorPos={cursorPos}
            belowDetail={detailOpen}
          />
        ) : (
          cellRefs.current[activeCell.index] ? (
            <CellPopover
              familyCode={activeTile.familyCode}
              familyName={activeTile.displayName}
              familyCount={activeTile.count}
              species={activeTile.species}
              anchorEl={cellRefs.current[activeCell.index]!}
              onDismiss={onPopoverDismiss}
              onSelectSpecies={(code: string) => {
                if (onSelectSpecies) {
                  onSelectSpecies(code);
                }
              }}
              {...cellPopoverDrillProps(activeTile, onDrillIn)}
            />
          ) : null
        )
      )}
      {clusterListInteractive && isClusterListOpen && outerRef.current && (
        <ClusterListPopover
          families={families}
          familyNames={familyNames}
          speciesByFamily={speciesByFamily}
          totalCount={props.totalCount}
          uniqueFamilies={props.uniqueFamilies}
          anchorEl={outerRef.current}
          onDismiss={() => setIsClusterListOpen(false)}
          onSelectSpecies={(code: string) => {
            if (onSelectSpecies) {
              onSelectSpecies(code);
            }
            // Dismiss after navigating so the popover doesn't linger over the new
            // surface. The species detail route will mount on top.
            setIsClusterListOpen(false);
          }}
        />
      )}
    </OuterTag>
  );
}

interface TileCellProps {
  tile: AdaptiveTile;
  /** When true, render uses `tile.colorDark` instead of `tile.color`. */
  isDark: boolean;
  showBadge: boolean;
  isNotable: boolean | undefined;
  perCellInteractive: boolean;
  isExpanded: boolean;
  /** Spec §4.8: only the active cell carries aria-describedby. Non-active cells omit it. */
  previewId?: string;
  cellRef: (el: HTMLButtonElement | null) => void;
  onCellMouseEnter?: () => void;
  onCellMouseMove?: (e: ReactMouseEvent<HTMLElement>) => void;
  onCellMouseLeave?: () => void;
  onCellFocus?: () => void;
  onCellBlur?: () => void;
  onCellClick?: () => void;
  onCellKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

function TileCell({
  tile,
  isDark,
  showBadge,
  isNotable,
  perCellInteractive,
  isExpanded,
  previewId,
  cellRef,
  onCellMouseEnter,
  onCellMouseMove,
  onCellMouseLeave,
  onCellFocus,
  onCellBlur,
  onCellClick,
  onCellKeyDown,
}: TileCellProps) {
  if (tile.kind === 'pending') {
    return (
      <div
        data-testid="adaptive-grid-marker-cell-pending"
        className="adaptive-grid-marker__cell adaptive-grid-marker__cell--pending"
        aria-hidden="true"
      />
    );
  }

  if (tile.kind === 'fallback') {
    // Phase 1 contrast (#570): use colorDark in dark mode for correct basemap contrast.
    const fillColor = isDark ? tile.colorDark : tile.color;
    if (perCellInteractive) {
      return (
        <button
          ref={cellRef}
          type="button"
          tabIndex={0}
          data-testid="adaptive-grid-marker-cell-fallback"
          className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback"
          aria-label={cellAriaLabel(tile)}
          aria-haspopup="dialog"
          aria-expanded={isExpanded ? 'true' : 'false'}
          aria-describedby={previewId}
          onMouseEnter={onCellMouseEnter}
          onMouseMove={onCellMouseMove}
          onMouseLeave={onCellMouseLeave}
          onFocus={onCellFocus}
          onBlur={onCellBlur}
          onClick={(e) => { e.stopPropagation(); onCellClick?.(); }}
          onKeyDown={onCellKeyDown}
          style={{ cursor: 'pointer', display: 'block', opacity: 0.85, color: fillColor }}
        >
          <svg
            viewBox="0 0 24 24"
            width={CELL_PX}
            height={CELL_PX}
            aria-hidden="true"
            focusable="false"
            preserveAspectRatio="xMidYMid meet"
          >
            <path d={FALLBACK_SILHOUETTE_PATH} style={{ fill: fillColor, forcedColorAdjust: 'auto' }} />
          </svg>
          {showBadge && <Badge count={tile.count} />}
        </button>
      );
    }

    return (
      <div
        data-testid="adaptive-grid-marker-cell-fallback"
        className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback"
        style={{ opacity: 0.85, color: fillColor }}
      >
        <svg
          viewBox="0 0 24 24"
          width={CELL_PX}
          height={CELL_PX}
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={FALLBACK_SILHOUETTE_PATH} style={{ fill: fillColor, forcedColorAdjust: 'auto' }} />
        </svg>
        {showBadge && <Badge count={tile.count} />}
      </div>
    );
  }

  // rendered
  // Phase 1 contrast (#570): use colorDark in dark mode for correct basemap contrast.
  const fillColor = isDark ? tile.colorDark : tile.color;
  const svgContent = (
    <svg
      viewBox="0 0 24 24"
      width={CELL_PX}
      height={CELL_PX}
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {/*
        Paint order (back → front), matching StackedSilhouetteMarker:
          1. Amber notable ring (only if isNotable)
          2. White halo path (behind silhouette for contrast)
          3. Colored silhouette path
      */}
      {isNotable && (
        <circle
          cx="12"
          cy="12"
          r="11"
          fill="none"
          stroke={isDark ? NOTABLE_AMBER_DARK : NOTABLE_AMBER_LIGHT}
          strokeWidth="2"
        />
      )}
      <path
        d={tile.svgData}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d={tile.svgData} style={{ fill: fillColor, forcedColorAdjust: 'auto' }} />
    </svg>
  );

  if (perCellInteractive) {
    return (
      <button
        ref={cellRef}
        type="button"
        tabIndex={0}
        data-testid="adaptive-grid-marker-cell-rendered"
        className="adaptive-grid-marker__cell"
        aria-label={cellAriaLabel(tile)}
        aria-haspopup="dialog"
        aria-expanded={isExpanded ? 'true' : 'false'}
        aria-describedby={previewId}
        onMouseEnter={onCellMouseEnter}
        onMouseMove={onCellMouseMove}
        onMouseLeave={onCellMouseLeave}
        onFocus={onCellFocus}
        onBlur={onCellBlur}
        onClick={(e) => { e.stopPropagation(); onCellClick?.(); }}
        onKeyDown={onCellKeyDown}
        style={{ cursor: 'pointer', display: 'block' }}
      >
        {svgContent}
        {showBadge && <Badge count={tile.count} />}
      </button>
    );
  }

  return (
    <div
      data-testid="adaptive-grid-marker-cell-rendered"
      className="adaptive-grid-marker__cell"
    >
      {svgContent}
      {showBadge && <Badge count={tile.count} />}
    </div>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <span
      data-testid="adaptive-grid-marker-badge"
      className="adaptive-grid-marker__badge"
      style={{
        // Inline box-shadow keeps the 1px white stroke contract verifiable
        // in jsdom (which does not load <link> stylesheets). The CSS rule
        // in ds-primitives.css replicates this for the production render.
        boxShadow: '0 0 0 1px rgba(255,255,255,0.9)',
      }}
    >
      {formatCount(count)}
    </span>
  );
}
