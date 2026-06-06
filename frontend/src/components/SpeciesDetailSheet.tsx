import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import {
  buildFamilyColorResolver,
  buildFamilyPathResolver,
  buildFamilyImgUrlResolver,
} from '../data/family-color.js';
import { SpeciesDescription } from './SpeciesDescription.js';
import { Photo } from './ds/Photo.js';
import type { FamilyCode } from '../config/family-palette.js';

export type SnapState = 'peek' | 'half' | 'full';

export type ContentTier = 'compact' | 'mid' | 'full';

// PEEK_PX — the identity-row detent: tall enough for the handle + a compact
// header (thumbnail + name + family), short enough to keep the map visible.
const PEEK_PX = 104;
// half + full are computed at runtime against window.innerHeight so they
// honor the actual viewport (post safe-area, post URL-bar collapse on
// mobile Safari). Constants here are the FRACTIONS:
const HALF_FRACTION = 0.6;
const FULL_INSET_PX = 8;
// A flick faster than this (>500px/s) advances or retracts a detent on release,
// independent of where the drag settled by position.
const VELOCITY_FLICK_PX_PER_MS = 0.5;
// The sheet can shrink below peek during a downward drag toward the dismiss
// threshold; it never renders shorter than this.
const DRAG_MIN_HEIGHT_PX = 56;
const order: SnapState[] = ['peek', 'half', 'full'];

// Content-tier hysteresis. The visible content tier ([data-content]) is driven
// by the LIVE sheet height so content blooms during the drag — but a single
// boundary thrashes when the finger hovers near it. resolveContentTier applies
// a ±HYSTERESIS_PX dead-band around each boundary: a tier only changes once the
// height crosses the boundary by more than the band, and within the band the
// previous tier holds. Pure + exported so it is unit-testable in isolation.
const HYSTERESIS_PX = 24;
// compact↔mid boundary: just above the peek detent height.
const COMPACT_MID_BOUNDARY_PX = PEEK_PX + 64;

/**
 * Map a live sheet height to a content tier with a ±24px hysteresis dead-band.
 *
 * Boundaries:
 *   compact ↔ mid  at COMPACT_MID_BOUNDARY_PX (PEEK_PX + 64)
 *   mid     ↔ full at the midpoint between the half and full detent heights
 *                  (derived from `vh` so it tracks the live viewport)
 *
 * Hysteresis: ascending, the tier promotes only once height exceeds a boundary
 * by more than HYSTERESIS_PX; descending, it demotes only once height drops
 * below the boundary by more than HYSTERESIS_PX. Inside the ±band the tier
 * holds at `prevTier` — so a finger oscillating around a boundary does not
 * thrash the layout.
 */
export function resolveContentTier(
  height: number,
  prevTier: ContentTier,
  vh: number,
): ContentTier {
  const half = Math.round(vh * HALF_FRACTION);
  const full = vh - FULL_INSET_PX;
  const midFullBoundary = (half + full) / 2;

  // Order the tiers low→high so we can reason about promote/demote uniformly.
  const tiers: ContentTier[] = ['compact', 'mid', 'full'];
  const boundaries = [COMPACT_MID_BOUNDARY_PX, midFullBoundary];

  const prevIdx = tiers.indexOf(prevTier);
  // Defensive: an unrecognized prevTier collapses to the position-only result.
  const safePrevIdx = prevIdx < 0 ? 0 : prevIdx;

  // Promote upward as long as the height clears the next boundary by the band.
  let idx = safePrevIdx;
  while (idx < boundaries.length && height >= boundaries[idx]! + HYSTERESIS_PX) {
    idx++;
  }
  // Demote downward as long as the height falls below the current lower
  // boundary by the band.
  while (idx > 0 && height < boundaries[idx - 1]! - HYSTERESIS_PX) {
    idx--;
  }
  return tiers[idx]!;
}

export interface SpeciesDetailSheetProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /** Ref to the inert target element (O1: #map-layer) — receives `inert` at full snap.
   *  App passes `mapLayerRef` so the live MapLibre canvas is frozen, not <main>. */
  mainRef: RefObject<HTMLElement | null>;
  /**
   * Optional callback fired whenever the snap state changes. Used by App.tsx
   * to derive the forceCollapsed signal for FamilyLegend (O5 #783): the legend
   * is force-collapsed on mobile when the sheet is at half or full snap.
   */
  onSnapChange?: (snap: SnapState) => void;
}

/**
 * Mobile bottom-sheet detail surface (field-guide direction). Apple Maps
 * "Look Up" idiom: three detents (peek 104px identity row / half 60vh
 * plate card / full 100vh−8px field-guide entry). Opens at `half` for
 * immediate readability; `peek` is the map-preserving collapsed state
 * reached by dragging down. The sheet is NOT a <dialog> at peek/half —
 * peek/half leave the map underneath interactive, which a modal <dialog>
 * by definition cannot. The role flips with snap state per
 * accessibility.md §New contract — bottom-sheet ARIA:
 *
 *   peek/half → role="region", aria-label="Selected sighting"
 *   full      → role="dialog", aria-modal="true", aria-label={species}
 *
 * Sequencing at half→full: `inert` is set on mainRef.current (O1: #map-layer)
 * BEFORE the role attribute flips. On full→collapse the order reverses
 * (React renders region first, then JS removes inert). The advance
 * side writes `inert` synchronously inside the click/drag handler
 * BEFORE calling setSnap('full'), so the DOM observer order is
 * inert → role. The collapse side runs the inert-removal in a
 * useLayoutEffect that fires AFTER the role-attribute commit.
 *
 * The sheet height is computed from snap state; transform is applied
 * during drag.
 *
 * Drag implementation uses native Pointer Events — no third-party
 * gesture library. touch-action discipline:
 *   - .sheet-handle: touch-action: none (we own the gesture)
 *   - .sheet-fg: touch-action: pan-y (browser owns scroll)
 */
export function SpeciesDetailSheet(props: SpeciesDetailSheetProps) {
  const { speciesCode, apiClient, onClose, mainRef, onSnapChange } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  // Open at `half` (the plate-card detent) for immediate readability; the
  // identity-row detent (`peek`) is the map-preserving collapsed state,
  // reached by dragging down.
  const [snap, setSnap] = useState<SnapState>('half');
  const [dragging, setDragging] = useState<boolean>(false);
  // During a drag we drive the sheet HEIGHT directly (1:1 with the finger);
  // null means "use the detent height for `snap`".
  const [liveHeight, setLiveHeight] = useState<number | null>(null);
  const dragRef = useRef<{
    startY: number;
    startHeight: number;
    lastY: number;
    lastT: number;
    vy: number; // px/ms, positive = moving down
    moved: boolean;
  } | null>(null);
  const didDragRef = useRef<boolean>(false);

  // O5 (#783) — notify App.tsx of snap changes so it can drive forceCollapsed
  // on FamilyLegend. Fires on every snap transition (peek→half→full and back).
  useEffect(() => {
    onSnapChange?.(snap);
  }, [snap, onSnapChange]);

  // Pull the species name into the sheet (for aria-label at full). The
  // body component fetches the same data via its own hook; the cache
  // (`useSpeciesDetail` is idempotent at the apiClient layer) makes this
  // a no-op second mount.
  const { data } = useSpeciesDetail(apiClient, speciesCode);
  const speciesName = data?.comName;
  // Family-resolvers for the accent rule / dot and the <Photo> silhouette
  // fallback. useSilhouettes is module-cached — no extra network call. The
  // color/path/imgUrl trio mirrors SpeciesDetailSurface so the sheet's
  // masthead fallback renders the operator-curated family shape, not the
  // generic glyph.
  const { silhouettes } = useSilhouettes(apiClient);
  const resolveColor = useMemo(() => buildFamilyColorResolver(silhouettes), [silhouettes]);
  const resolvePath = useMemo(() => buildFamilyPathResolver(silhouettes), [silhouettes]);
  const resolveImgUrl = useMemo(() => buildFamilyImgUrlResolver(silhouettes), [silhouettes]);

  // Compute snap heights against the live viewport. Recompute on
  // resize so an orientation change or mobile-Safari URL-bar collapse
  // doesn't leave the sheet half off-screen.
  const [vh, setVh] = useState<number>(() =>
    typeof window === 'undefined' ? 800 : window.innerHeight,
  );
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const heightFor = useCallback(
    (s: SnapState): number => {
      switch (s) {
        case 'peek':
          return PEEK_PX;
        case 'half':
          return Math.round(vh * HALF_FRACTION);
        case 'full':
          return vh - FULL_INSET_PX;
      }
    },
    [vh],
  );

  // Inert sequencing — collapse side. When `snap` transitions away
  // from 'full', the React commit runs first (the new role="region"
  // attribute lands on the sheet), then this layout effect fires and
  // removes `inert` from #map-layer. Observable order: role → inert-removal.
  //
  // The cleanup function is the load-bearing fix for the viewport-flip bug:
  // if the user rotates the device mid-snap, App.tsx swaps SpeciesDetailSheet
  // for SpeciesDetailModal and this sheet unmounts without ever reaching the
  // snap !== 'full' branch above. Without cleanup, `inert` leaks onto #map-layer
  // indefinitely — pointer events blocked, tab order broken.
  //
  // Cleanup closure mechanics: `snap` is captured at effect-run time. When the
  // effect ran with snap==='full', the cleanup removes inert — covering both
  // the normal collapse path and the unmount-at-full (viewport-flip) path.
  // When the effect ran with snap!=='full', the cleanup is a no-op (inert
  // was already removed in the effect body), so intermediate snap transitions
  // (peek→half, half→peek, etc.) don't disturb the sequencing contract.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (snap !== 'full') {
      main.removeAttribute('inert');
    }
    const wasAtFull = snap === 'full';
    return () => {
      // If this effect ran while at full snap, remove inert on teardown.
      // This covers both normal snap transitions (cleanup before next effect
      // body) and unmount mid-snap (viewport-flip: sheet→modal handoff).
      if (wasAtFull) {
        main.removeAttribute('inert');
      }
    };
  }, [snap, mainRef]);

  const goToSnap = useCallback(
    (next: SnapState) => {
      const main = mainRef.current;
      // Advance into full: write inert BEFORE setSnap so the DOM mutation
      // record for inert lands before the role-attribute mutation that
      // follows the React commit. Order: inert → role.
      if (next === 'full' && main && !main.hasAttribute('inert')) {
        main.setAttribute('inert', '');
      }
      setSnap(next);
    },
    [mainRef],
  );

  const expand = useCallback(() => {
    if (snap === 'peek') goToSnap('half');
    else if (snap === 'half') goToSnap('full');
  }, [snap, goToSnap]);

  const collapse = useCallback(() => {
    if (snap === 'full') goToSnap('half');
    else if (snap === 'half') goToSnap('peek');
    else onClose();
  }, [snap, goToSnap, onClose]);

  // ESC scoped: only collapse when focus is inside the sheet. If focus
  // is on a map element (cluster button), MapLibre handles ESC itself.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const sheet = sheetRef.current;
      if (!sheet) return;
      if (!sheet.contains(document.activeElement)) return;
      collapse();
      e.preventDefault();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [collapse]);

  // Height-driven 1:1 drag. Bound on the handle only (touch-action discipline
  // unchanged — .sheet-handle owns the gesture; .sheet-fg keeps native pan-y).
  // We drive `liveHeight` directly so the sheet tracks the finger in BOTH
  // directions, then settle to a detent on release using velocity + position.
  // The CSS height transition is gated off while `dragging` (via
  // [data-dragging="true"]) so the drag is 1:1, not eased.
  const settleTo = useCallback(
    (next: SnapState) => {
      const main = mainRef.current;
      // Preserve inert sequencing: write inert BEFORE the snap/role commit.
      if (next === 'full' && main && !main.hasAttribute('inert')) {
        main.setAttribute('inert', '');
      }
      setLiveHeight(null);
      setSnap(next);
    },
    [mainRef],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      // setPointerCapture is not available in JSDOM (only real browsers).
      if (typeof e.currentTarget.setPointerCapture === 'function') {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      dragRef.current = {
        startY: e.clientY,
        startHeight: heightFor(snap),
        lastY: e.clientY,
        lastT: performance.now(),
        vy: 0,
        moved: false,
      };
      didDragRef.current = false;
      setDragging(true);
    },
    [snap, heightFor],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT);
      d.vy = (e.clientY - d.lastY) / dt; // px/ms, positive = moving down
      d.lastY = e.clientY;
      d.lastT = now;
      if (Math.abs(e.clientY - d.startY) > 4) d.moved = true;
      // Drag up (clientY decreases) grows the sheet; drag down shrinks it.
      const grow = d.startY - e.clientY;
      const maxH = heightFor('full');
      const next = Math.min(maxH, Math.max(DRAG_MIN_HEIGHT_PX, d.startHeight + grow));
      setLiveHeight(next);
    },
    [heightFor],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (typeof e.currentTarget.releasePointerCapture === 'function') {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d) return;
      didDragRef.current = d.moved;

      const maxH = heightFor('full');
      const finalH = Math.min(
        maxH,
        Math.max(DRAG_MIN_HEIGHT_PX, d.startHeight + (d.startY - d.lastY)),
      );

      // Dismiss: released well below peek while not flicking back upward.
      if (finalH < PEEK_PX * 0.6 && d.vy >= 0) {
        setLiveHeight(null);
        onClose();
        return;
      }

      // Settle to the nearest detent by height, then bias by flick velocity:
      // a fast upward flick advances a detent, a fast downward flick retracts.
      let nearest: SnapState = order[0]!;
      let best = Infinity;
      for (const s of order) {
        const diff = Math.abs(heightFor(s) - finalH);
        if (diff < best) {
          best = diff;
          nearest = s;
        }
      }
      let target = nearest;
      const idx = order.indexOf(nearest);
      if (d.vy < -VELOCITY_FLICK_PX_PER_MS) target = order[Math.min(order.length - 1, idx + 1)]!;
      else if (d.vy > VELOCITY_FLICK_PX_PER_MS) target = order[Math.max(0, idx - 1)]!;

      settleTo(target);
    },
    [heightFor, onClose, settleTo],
  );

  // Initial focus on mount: move focus to the DIALOG CONTAINER (not the visible
  // species name) only when the sheet opens at full — at peek/half the user
  // expects map focus to persist so they can keep clicking clusters.
  //
  // #907 design-review finding 2: focusing the visible `#detail-title` heading
  // painted a stray `:focus-visible` ring around the species name on
  // keyboard-driven open. Focus the sheet root instead (tabIndex={-1} makes it
  // programmatically focusable without a tab stop). The dialog's accessible
  // name is still the species name via `aria-label`, so AT announces the same
  // thing on entry; the visible name no longer rings on either pointer or
  // keyboard open.
  useEffect(() => {
    if (snap !== 'full') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    queueMicrotask(() => {
      sheetRef.current?.focus();
    });
  }, [snap]);

  const isFull = snap === 'full';
  const height = liveHeight ?? heightFor(snap);
  // Three size-appropriate content tiers, chosen by LIVE height so content
  // blooms DURING the drag. compact → identity row; mid → plate card; full →
  // field-guide entry. resolveContentTier hysteresizes the boundaries (±24px
  // dead-band) so a finger near a threshold doesn't thrash the layout; the
  // previous tier is carried across renders in prevTierRef.
  const prevTierRef = useRef<ContentTier>('mid');
  const content = resolveContentTier(height, prevTierRef.current, vh);
  prevTierRef.current = content;
  const famColor = resolveColor(data?.familyCode);
  // descriptionBody is sanitized HTML (rendered via SpeciesDescription at full);
  // the mid teaser wants a plain-text 2-line clamp, so strip tags for it.
  const descPlain = data?.descriptionBody
    ? data.descriptionBody
        .replace(/<\/(p|div|li|h\d)>/gi, ' ') // block-close → a single space
        .replace(/<[^>]+>/g, '') // strip inline tags WITHOUT a space (no " ," artifact)
        .replace(/\s+/g, ' ')
        .trim()
    : '';

  return (
    <div
      ref={sheetRef}
      data-testid="species-detail-sheet"
      className={`species-detail-sheet species-detail-sheet--${snap}`}
      data-snap-state={snap}
      data-dragging={dragging ? 'true' : 'false'}
      data-content={content}
      // #907 finding 2 — programmatically focusable (no tab stop) so open-focus
      // can land on the dialog container instead of the visible species name,
      // which avoided a stray :focus-visible ring on the title.
      tabIndex={-1}
      role={isFull ? 'dialog' : 'region'}
      aria-label={isFull ? (speciesName ?? 'Species detail') : 'Selected sighting'}
      {...(isFull ? { 'aria-modal': 'true' as const } : {})}
      style={{
        // Reserve the bottom safe-area BELOW the detent content so the collapsed
        // row is neither clipped by the home indicator nor padded with slack.
        // Not added at full — full already spans to the inset.
        height: isFull
          ? `${height}px`
          : `calc(${height}px + env(safe-area-inset-bottom, 0px))`,
      }}
    >
      <button
        ref={handleRef}
        type="button"
        data-testid="species-detail-sheet-handle"
        className="sheet-handle"
        aria-label={isFull ? 'Collapse species detail' : 'Expand species detail'}
        onClick={() => {
          // Suppress the click that fires after a drag (pointerup → click).
          // A pure tap (no movement) still expands/collapses as a fallback.
          if (didDragRef.current) {
            didDragRef.current = false;
            return;
          }
          (isFull ? collapse : expand)();
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span aria-hidden="true" className="sheet-handle-grip" />
      </button>
      {/* Field-guide layout: three size-appropriate tiers in one grid that
          re-templates per [data-content]. The photo is a SINGLE <Photo>
          element kept mounted across detents; only its frame morphs via CSS.
          The grid scrolls (tabIndex=0 satisfies axe scrollable-region-focusable). */}
      <div className="sheet-fg" tabIndex={0}>
        <div className="sheet-fg-photo">
          {/* Decorative photo (alt=""): the species name always sits adjacent
              and we have no plumage metadata, so a non-empty alt would triple-
              announce. <Photo> owns the no-photo silhouette fallback (emits
              .photo--silhouette) and the family shape/color via the resolvers. */}
          <Photo
            src={data?.photoUrl ?? null}
            alt=""
            family={(data?.familyCode as FamilyCode | null) ?? null}
            color={resolveColor(data?.familyCode)}
            pathD={resolvePath(data?.familyCode)}
            imgUrl={resolveImgUrl(data?.familyCode)}
            priority
            layout="masthead"
          />
        </div>

        <div className="sheet-fg-identity">
          {/* h2: the map identity ("Bird Maps") owns the page h1; the species
              name is the top heading INSIDE the dialog. Not a focus target:
              open-focus lands on the dialog container (#907 finding 2), so this
              heading carries no tabIndex and never paints a focus ring. */}
          <h2 id="detail-title" className="sheet-fg-name">
            {data?.comName ?? 'Loading…'}
          </h2>
          <p className="sheet-fg-sci">
            <em>{data?.sciName}</em>
          </p>
          <p className="sheet-fg-family">
            <span
              className="sheet-fg-family-dot"
              aria-hidden="true"
              style={{ background: famColor }}
            />
            {data?.familyName}
          </p>
        </div>

        <div className="sheet-fg-rule" aria-hidden="true" style={{ background: famColor }} />

        {/* MID tier — labeled field record (real <dl> so AT ties label→value) */}
        <dl className="sheet-fg-record">
          <div className="sheet-fg-cell">
            <dt className="sheet-fg-label">Family</dt>
            <dd className="sheet-fg-value">{data?.familyName ?? '—'}</dd>
          </div>
          <div className="sheet-fg-cell">
            <dt className="sheet-fg-label">eBird taxonomic order</dt>
            <dd className="sheet-fg-value">
              {data?.taxonOrder != null ? `#${data.taxonOrder}` : '—'}
            </dd>
          </div>
        </dl>
        <div className="sheet-fg-teaser">
          <p className="sheet-fg-teaser-text">
            {descPlain || 'No description available.'}
          </p>
          <button
            type="button"
            className="sheet-fg-readaccount"
            aria-expanded={isFull}
            aria-controls="sheet-fg-account"
            onClick={() => goToSnap('full')}
          >
            Read account <span aria-hidden="true">⌄</span>
          </button>
        </div>

        {/* FULL tier — taxonomy table + ABOUT prose + credits */}
        <dl className="sheet-fg-taxonomy">
          <div className="sheet-fg-taxrow">
            <dt>Scientific name</dt>
            <dd><em>{data?.sciName}</em></dd>
          </div>
          <div className="sheet-fg-taxrow">
            <dt>Family</dt>
            <dd>{data?.familyName}</dd>
          </div>
          <div className="sheet-fg-taxrow">
            <dt>eBird taxonomic order</dt>
            <dd>{data?.taxonOrder != null ? `#${data.taxonOrder}` : '—'}</dd>
          </div>
        </dl>
        <div className="sheet-fg-about" id="sheet-fg-account">
          {data?.descriptionBody ? (
            <>
              <h3 className="sheet-fg-about-eyebrow">About</h3>
              <SpeciesDescription
                descriptionBody={data.descriptionBody}
                descriptionAttributionUrl={data.descriptionAttributionUrl}
              />
            </>
          ) : (
            <p className="sheet-fg-prose">No description available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
