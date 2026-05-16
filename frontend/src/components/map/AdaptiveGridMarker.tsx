import { useState, useId, useRef, useEffect } from 'react';
import type { MouseEvent, CSSProperties, KeyboardEvent } from 'react';
import type { AdaptiveTile, ResolvedGrid } from './adaptive-grid.js';
import { visibleCapacity } from './adaptive-grid.js';
import { FALLBACK_SILHOUETTE_PATH } from './silhouette-fallback.js';
import { isCellPopoverEnabled } from '../../feature-flags.js';
import { useMediaQuery } from '../../hooks/use-media-query.js';
import { CellHoverPreview } from './CellHoverPreview.js';
import { CellPopover } from './CellPopover.js';
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
 *   - `tabIndex={-1}` (spec §4.7 — keyboard users use the skip-link to the
 *     FeedSurface list landmark).
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
 *     placeholder shape at opacity 0.5.
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
 * When `VITE_FF_CELL_POPOVER=true` AND the pointer is fine (not coarse),
 * each `<TileCell>` becomes a `<button>` with per-cell hover/focus/click
 * interaction. The hit-extender overlay's `pointerEvents` toggles to `'none'`
 * in that mode so it doesn't intercept individual cell events.
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
  onClick: (e: MouseEvent<HTMLElement>) => void;
  /** Phase 1 (#558): forwarded from per-cell popover row clicks. */
  onSelectSpecies?: (speciesCode: string) => void;
}

// Layout constants — match MosaicMarker's 22px tile / 2px gap (issue #248).
export const CELL_PX = 22;
export const GRID_GAP_PX = 2;
export const GRID_PADDING_PX = 3;

const HIT_MIN_FINE = 44;
const HIT_MIN_COARSE = 48;

const NOTABLE_AMBER = '#f59e0b';

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
  } = props;

  const flag = isCellPopoverEnabled();
  const isPointerFine = useMediaQuery('(pointer: fine)');
  const perCellInteractive = flag && isPointerFine && !isCoarsePointer;

  const clusterListInteractive = flag && isCoarsePointer === true;
  const [isClusterListOpen, setIsClusterListOpen] = useState<boolean>(false);
  const outerRef = useRef<HTMLElement | null>(null);

  // Build the FamilyAggregate[] and speciesByFamily Map from tiles (Phase 0
  // already threads `species` per tile; no re-aggregation needed).
  const families = tiles.map((t) => ({ familyCode: t.familyCode, count: t.count }));
  const speciesByFamily = new Map(tiles.map((t) => [t.familyCode, t.species]));

  // Single-leaf preservation (spec §4.10): clusters with totalCount === 1 fall
  // through to the existing onClick handler (which routes to setSelectedObs in
  // MapCanvas). The cluster-list popover never opens for single-leaf markers.
  const isSingleLeaf = props.totalCount === 1;

  const markerId = useId();
  const [activeCell, setActiveCell] = useState<{ index: number; mode: 'preview' | 'popover' } | null>(null);
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

  function onCellMouseLeave(i: number) {
    // Spec §4.5: 250ms delay; skipped when click-promoted to popover.
    mouseLeaveTimers.current[i] = window.setTimeout(() => {
      setActiveCell((prev) => (prev?.index === i && prev.mode === 'preview' ? null : prev));
    }, 250);
  }

  function onCellFocus(i: number) {
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
        tabIndex: -1,
        onClick: (e: MouseEvent<HTMLElement>) => {
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
            showBadge={showBadgeFor(tile.count)}
            isNotable={isNotable}
            perCellInteractive={perCellInteractive}
            isExpanded={activeCell?.index === i && activeCell.mode === 'popover'}
            {...(perCellInteractive && activeCell?.index === i && previewId ? { previewId } : {})}
            cellRef={(el) => { cellRefs.current[i] = el; }}
            onCellMouseEnter={() => onCellMouseEnter(i)}
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
          <CellHoverPreview
            familyCode={activeTile.familyCode}
            familyCount={activeTile.count}
            species={activeTile.species}
            id={previewId!}
          />
        ) : (
          cellRefs.current[activeCell.index] ? (
            <CellPopover
              familyCode={activeTile.familyCode}
              familyCount={activeTile.count}
              species={activeTile.species}
              anchorEl={cellRefs.current[activeCell.index]!}
              onDismiss={onPopoverDismiss}
              onSelectSpecies={(code: string) => {
                if (onSelectSpecies) {
                  onSelectSpecies(code);
                }
              }}
            />
          ) : null
        )
      )}
      {clusterListInteractive && isClusterListOpen && outerRef.current && (
        <ClusterListPopover
          families={families}
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
  showBadge: boolean;
  isNotable: boolean | undefined;
  perCellInteractive: boolean;
  isExpanded: boolean;
  /** Spec §4.8: only the active cell carries aria-describedby. Non-active cells omit it. */
  previewId?: string;
  cellRef: (el: HTMLButtonElement | null) => void;
  onCellMouseEnter?: () => void;
  onCellMouseLeave?: () => void;
  onCellFocus?: () => void;
  onCellBlur?: () => void;
  onCellClick?: () => void;
  onCellKeyDown?: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

function TileCell({
  tile,
  showBadge,
  isNotable,
  perCellInteractive,
  isExpanded,
  previewId,
  cellRef,
  onCellMouseEnter,
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
    if (perCellInteractive) {
      return (
        <button
          ref={cellRef}
          type="button"
          tabIndex={0}
          data-testid="adaptive-grid-marker-cell-fallback"
          className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback"
          aria-haspopup="dialog"
          aria-expanded={isExpanded ? 'true' : 'false'}
          aria-describedby={previewId}
          onMouseEnter={onCellMouseEnter}
          onMouseLeave={onCellMouseLeave}
          onFocus={onCellFocus}
          onBlur={onCellBlur}
          onClick={(e) => { e.stopPropagation(); onCellClick?.(); }}
          onKeyDown={onCellKeyDown}
          style={{ all: 'unset', cursor: 'pointer', display: 'block', opacity: 0.5 }}
        >
          <svg
            viewBox="0 0 24 24"
            width={CELL_PX}
            height={CELL_PX}
            aria-hidden="true"
            focusable="false"
            preserveAspectRatio="xMidYMid meet"
          >
            <path d={FALLBACK_SILHOUETTE_PATH} fill={tile.color} />
          </svg>
          {showBadge && <Badge count={tile.count} />}
        </button>
      );
    }

    return (
      <div
        data-testid="adaptive-grid-marker-cell-fallback"
        className="adaptive-grid-marker__cell adaptive-grid-marker__cell--fallback"
        style={{ opacity: 0.5 }}
      >
        <svg
          viewBox="0 0 24 24"
          width={CELL_PX}
          height={CELL_PX}
          aria-hidden="true"
          focusable="false"
          preserveAspectRatio="xMidYMid meet"
        >
          <path d={FALLBACK_SILHOUETTE_PATH} fill={tile.color} />
        </svg>
        {showBadge && <Badge count={tile.count} />}
      </div>
    );
  }

  // rendered
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
          stroke={NOTABLE_AMBER}
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
      <path d={tile.svgData} fill={tile.color} />
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
        aria-haspopup="dialog"
        aria-expanded={isExpanded ? 'true' : 'false'}
        aria-describedby={previewId}
        onMouseEnter={onCellMouseEnter}
        onMouseLeave={onCellMouseLeave}
        onFocus={onCellFocus}
        onBlur={onCellBlur}
        onClick={(e) => { e.stopPropagation(); onCellClick?.(); }}
        onKeyDown={onCellKeyDown}
        style={{ all: 'unset', cursor: 'pointer', display: 'block' }}
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
      {count}
    </span>
  );
}
