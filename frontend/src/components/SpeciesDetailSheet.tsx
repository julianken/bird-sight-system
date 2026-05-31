import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { ApiClient } from '../api/client.js';
import type { BBox } from '../state/url-state.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';

type SnapState = 'peek' | 'half' | 'full';

// MOB-6: PEEK_PX raised from 96 → 120 so the peek strip is comfortably
// reachable by a thumb at the bottom of a 390×844 screen (96px was tight
// against the safe-area-inset-bottom on notched devices). DISMISS_THRESHOLD_PX
// lowered from 160 → 80 so a short downward flick dismisses the sheet — the
// old 160px required a deliberate two-thirds swipe that felt sluggish.
const PEEK_PX = 120;
// half + full are computed at runtime against window.innerHeight so they
// honor the actual viewport (post safe-area, post URL-bar collapse on
// mobile Safari). Constants here are the FRACTIONS:
const HALF_FRACTION = 0.6;
const FULL_INSET_PX = 8;
// Drag dismissal: dragging the handle down past peek by this many pixels
// dismisses the sheet (calls onClose). 80px ≈ one thumb's travel.
const DISMISS_THRESHOLD_PX = 80;
// Drag transition thresholds — half travel between adjacent snaps flips.
const SNAP_TRANSITION_RATIO = 0.5;

export interface SpeciesDetailSheetProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /** Cluster bbox to pass through to SpeciesDetailSurface (Phase 3 / #560). */
  bbox?: BBox | null;
  /** Clears the bbox URL param — passed through to SpeciesDetailSurface. */
  onClearBbox?: () => void;
  /** Ref to the inert target element (O1: #map-layer) — receives `inert` at full snap.
   *  App passes `mapLayerRef` so the live MapLibre canvas is frozen, not <main>. */
  mainRef: RefObject<HTMLElement | null>;
}

/**
 * Mobile bottom-sheet detail surface (Sky Atlas Phase 4). Apple Maps
 * "Look Up" idiom: three snap points (peek 120px / half 60vh / full
 * 100vh−8px). The sheet is NOT a <dialog> at peek/half — peek/half
 * leave the map underneath interactive, which a modal <dialog> by
 * definition cannot. The role flips with snap state per
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
 *   - .species-detail-body: touch-action: pan-y (browser owns scroll)
 */
export function SpeciesDetailSheet(props: SpeciesDetailSheetProps) {
  const { speciesCode, apiClient, onClose, mainRef, bbox, onClearBbox } = props;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const [snap, setSnap] = useState<SnapState>('peek');
  const [dragOffset, setDragOffset] = useState<number>(0); // px: positive = pulled down
  const dragStartRef = useRef<{ y: number; snap: SnapState } | null>(null);

  // Pull the species name into the sheet (for aria-label at full). The
  // body component fetches the same data via its own hook; the cache
  // (`useSpeciesDetail` is idempotent at the apiClient layer) makes this
  // a no-op second mount.
  const { data } = useSpeciesDetail(apiClient, speciesCode);
  const speciesName = data?.comName;

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

  // Pointer Events drag handlers. Bound on the handle, NOT the sheet
  // body — touch-action discipline requires the sheet body to keep its
  // native pan-y scroll behavior.
  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      // setPointerCapture is not available in JSDOM (only real browsers).
      if (typeof e.currentTarget.setPointerCapture === 'function') {
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      dragStartRef.current = { y: e.clientY, snap };
      setDragOffset(0);
    },
    [snap],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    const start = dragStartRef.current;
    if (!start) return;
    setDragOffset(e.clientY - start.y);
  }, []);

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (typeof e.currentTarget.releasePointerCapture === 'function') {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      const start = dragStartRef.current;
      dragStartRef.current = null;
      const delta = e.clientY - (start?.y ?? e.clientY);
      setDragOffset(0);

      // Dismiss path: dragging down from peek by more than
      // DISMISS_THRESHOLD_PX dismisses the sheet entirely.
      if (snap === 'peek' && delta > DISMISS_THRESHOLD_PX) {
        onClose();
        return;
      }

      // Snap-transition: which adjacent snap is closest, after the drag?
      // We measure delta against the height-difference between the
      // current snap and the adjacent snap in the drag direction.
      const order: SnapState[] = ['peek', 'half', 'full'];
      const currentIdx = order.indexOf(snap);

      if (delta < 0) {
        // Drag up: maybe advance.
        const nextIdx = Math.min(order.length - 1, currentIdx + 1);
        if (nextIdx === currentIdx) return;
        const nextSnap = order[nextIdx]!;
        const span = heightFor(nextSnap) - heightFor(snap);
        if (-delta > span * SNAP_TRANSITION_RATIO) goToSnap(nextSnap);
      } else if (delta > 0) {
        // Drag down: maybe retract.
        const prevIdx = Math.max(0, currentIdx - 1);
        if (prevIdx === currentIdx) return; // already at peek
        const prevSnap = order[prevIdx]!;
        const span = heightFor(snap) - heightFor(prevSnap);
        if (delta > span * SNAP_TRANSITION_RATIO) goToSnap(prevSnap);
      }
    },
    [snap, heightFor, goToSnap, onClose],
  );

  // Initial focus on mount: heading first only when the sheet opens at
  // full (not peek/half — at peek/half the user expects map focus to
  // persist so they can keep clicking clusters). At full the heading
  // gets focus exactly like the desktop modal.
  useEffect(() => {
    if (snap !== 'full') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    queueMicrotask(() => {
      sheet.querySelector<HTMLElement>('#detail-title')?.focus();
    });
  }, [snap]);

  const isFull = snap === 'full';
  const height = heightFor(snap);
  const translate = Math.max(0, dragOffset);

  return (
    <div
      ref={sheetRef}
      data-testid="species-detail-sheet"
      className={`species-detail-sheet species-detail-sheet--${snap}`}
      data-snap-state={snap}
      role={isFull ? 'dialog' : 'region'}
      aria-label={isFull ? (speciesName ?? 'Species detail') : 'Selected sighting'}
      {...(isFull ? { 'aria-modal': 'true' as const } : {})}
      style={{
        height: `${height}px`,
        transform: `translateY(${translate}px)`,
      }}
    >
      <button
        ref={handleRef}
        type="button"
        data-testid="species-detail-sheet-handle"
        className="sheet-handle"
        aria-label={isFull ? 'Collapse species detail' : 'Expand species detail'}
        onClick={isFull ? collapse : expand}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span aria-hidden="true" className="sheet-handle-grip" />
      </button>
      {/* axe `scrollable-region-focusable` (WCAG 2.1.1): .sheet-scroll has
          overflow-y: auto so it can scroll when species detail content
          (photo + prose) exceeds the sheet height. Keyboard users must be
          able to focus the scrollable region itself — tabIndex={0} adds
          it to the tab order. Mirrors the same fix on #main-surface in
          App.tsx. */}
      <div className="sheet-scroll" tabIndex={0}>
        <SpeciesDetailSurface
          speciesCode={speciesCode}
          apiClient={apiClient}
          {...(bbox !== undefined ? { bbox } : {})}
          {...(onClearBbox !== undefined ? { onClearBbox } : {})}
        />
      </div>
    </div>
  );
}
