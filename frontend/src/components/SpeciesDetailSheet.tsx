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
import { analytics } from '../analytics.js';
import { SpeciesDescription } from './SpeciesDescription.js';
import { Photo } from './ds/Photo.js';
import { SheetHeader } from './ds/SheetHeader.js';
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
// Drag slop (#431). Below this many px of travel from the pointerdown anchor
// the gesture is treated as a tap, not a drag: NEITHER the `moved` flag (which
// suppresses the post-drag click) NOR the live-height translation engages, so a
// finger that jiggles a few px on a tap does not nudge the sheet ("drag-start
// jiggle"). The old 4px threshold gated only `moved` (click suppression) — the
// translation still started on the FIRST pointermove. 6px gates BOTH.
const DRAG_SLOP_PX = 6;
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
  // F9 (#910) — focus restore on close. Capture document.activeElement on mount
  // so EVERY close path (button, ESC, drag-dismiss) can return focus to whatever
  // opened the sheet. Mirrors SpeciesDetailRail/AttributionModal's
  // document.contains-guarded restore; the fallback is #main-surface (a real,
  // focusable <main tabIndex={0}>, App.tsx) — NOT the dead #surface-tab-map.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // F10 (#910) — visually-hidden polite live region. At HALF the identity
  // becomes legible but, unlike full, no focus moves into the dialog, so AT
  // gets no entry announcement. We announce the species into this region on the
  // FIRST readable detent (peek→half) only — never at peek (map focus must
  // persist) and never again on full→half (the full focus-move owns the full
  // announce; re-announcing would double-fire). `announcedRef` is the
  // once-per-readable-detent latch.
  const [liveMessage, setLiveMessage] = useState<string>('');
  const announcedRef = useRef<boolean>(false);
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

  // ── Analytics (T3 #909) ──────────────────────────────────────────────────
  // Re-wired off SpeciesDetailSurface (SpeciesDetailSurface.tsx:73-115): T1
  // (#907) stopped composing the surface inside this sheet and silently dropped
  // these three events. They are reproduced here verbatim — same event names
  // and prop shapes — so the mobile funnel keeps emitting them. The sheet must
  // NOT import SpeciesDetailSurface (it owns its own layout); only the analytics
  // contract is shared.
  //
  // panel_opened / panel_dwell_ms — fire on species data-arrival, dwell on
  // effect cleanup. Keyed on data?.speciesCode so a species change re-fires the
  // pair (dwell for the old, open for the new).
  useEffect(() => {
    if (!data?.speciesCode) return;
    const t0 = Date.now();
    const code = data.speciesCode;
    analytics.capture('panel_opened', {
      species_code: code,
      has_description: !!data.descriptionBody,
    });
    return () => {
      analytics.capture('panel_dwell_ms', {
        species_code: code,
        dwell_ms: Date.now() - t0,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.speciesCode]);

  // panel_scrolled_to_bottom — first IntersectionObserver hit on the bottom
  // sentinel, once per species. The sentinel is a DIRECT child of .sheet-fg
  // (the only detent scroll container) AFTER the About block, with no tier-gated
  // display:none — a display:none element has a zero box and never intersects,
  // so it must stay in layout to be observable. firedForSpeciesRef +
  // observer.disconnect() is the no-double-fire guard.
  //
  // ONCE PER SPECIES (#910 T3 bot finding): the latch is keyed on speciesCode,
  // NOT a plain boolean that resets on every full re-arm. A full→half→full
  // round-trip re-arms the observer (the effect re-runs on the snap change), but
  // the latch must NOT reset for the SAME species — otherwise a second
  // intersection re-fires `panel_scrolled_to_bottom` for a species we already
  // counted. We reset the latch only when the species changes (the stored code
  // differs from the current one), so each species fires the event at most once
  // across the whole detail session.
  //
  // DETENT GATE (#914 bot finding): the observer is armed ONLY at the `full`
  // snap. At peek/half the About + taxonomy blocks are display:none, so the
  // .sheet-fg content is short enough that the trailing sentinel can already sit
  // within the viewport the moment data resolves — a viewport-rooted observer
  // would then fire `panel_scrolled_to_bottom` ON OPEN with no actual scroll
  // (an over-count). The surface (SpeciesDetailSurface.tsx) never collapses, so
  // its sentinel is reliably below the fold and it can arm on data-resolve; the
  // sheet's detent collapse breaks that invariant, so we gate on snap === 'full'
  // — the only detent where the About content is shown and .sheet-fg scrolls.
  // We also root the observer on the .sheet-fg scroll container (not the
  // viewport) so "intersecting" means the sentinel has actually been scrolled
  // into the scroller's box, not merely that it overlaps the layout viewport.
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Stores the speciesCode that already fired `panel_scrolled_to_bottom`. The
  // latch is "has THIS species fired?" — keyed on the code, not a boolean that
  // resets on every full re-arm (#910). null = nothing fired yet.
  const firedForSpeciesRef = useRef<string | null>(null);
  const speciesCodeForObserver = data?.speciesCode;
  useEffect(() => {
    if (!speciesCodeForObserver) return;
    // Only count a real scroll-to-bottom at the full detent — peek/half keep the
    // About/taxonomy blocks display:none, so the sentinel can be visible on open
    // (over-count). Not arming the observer outside full is the fix.
    if (snap !== 'full') return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;
    // Already fired for THIS species? Don't re-arm — a full→half→full round-trip
    // for the same species must not re-fire the event (#910 once-per-species).
    if (firedForSpeciesRef.current === speciesCodeForObserver) return;
    const observer = new IntersectionObserver(
      entries => {
        const intersected = entries.some(entry => entry.isIntersecting);
        if (intersected && firedForSpeciesRef.current !== speciesCodeForObserver) {
          firedForSpeciesRef.current = speciesCodeForObserver;
          analytics.capture('panel_scrolled_to_bottom', {
            species_code: speciesCodeForObserver,
          });
          observer.disconnect();
        }
      },
      // Root on the scroll container so the intersection is relative to the
      // .sheet-fg box, not the layout viewport. Falls back to the viewport if
      // the ref is not yet attached.
      { root: scrollerRef.current ?? null },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [speciesCodeForObserver, snap]);

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

  // F9 (#910) — close + restore focus. Restore to the previously-focused
  // element if it's still attached (calling .focus() on a detached node is a
  // silent no-op that drops focus onto <body>), otherwise fall back to the
  // stable #main-surface landmark. Used by every close path so keyboard users
  // never lose their place when the sheet dismisses.
  const closeWithRestore = useCallback(() => {
    const previous = previouslyFocusedRef.current;
    const isAttached =
      previous !== null &&
      typeof previous.focus === 'function' &&
      document.contains(previous);
    if (isAttached) {
      previous!.focus();
    } else {
      document.querySelector<HTMLElement>('#main-surface')?.focus();
    }
    onClose();
  }, [onClose]);

  const expand = useCallback(() => {
    if (snap === 'peek') goToSnap('half');
    else if (snap === 'half') goToSnap('full');
  }, [snap, goToSnap]);

  const collapse = useCallback(() => {
    if (snap === 'full') goToSnap('half');
    else if (snap === 'half') goToSnap('peek');
    else closeWithRestore();
  }, [snap, goToSnap, closeWithRestore]);

  // Escape DISMISSES the sheet (#1026) — matching the desktop rail
  // (SpeciesDetailRail) and the filters sheet (App.tsx), NOT the old
  // stepwise-collapse-by-detent behavior. WCAG no-keyboard-trap: the prior
  // handler early-returned unless focus was inside the sheet, so Escape did
  // nothing in the normal post-open state (focus on body/map) — a trap.
  //
  // BUBBLE phase (NOT capture): the scope popover claims Escape via
  // stopPropagation() on a React synthetic handler (AppHeader), which fires at
  // the React root BELOW document; a capture-phase document listener would beat
  // it and defeat that claim. On the bubble phase, the scope popover's
  // stopPropagation halts the event before it reaches this document listener.
  //
  // Bail in exactly three cases, else closeWithRestore() + preventDefault():
  //   1. e.defaultPrevented — an inner widget already claimed the key.
  //   2. focus is inside an open native <dialog> — the Credits modal closes
  //      NATIVELY on Escape without setting defaultPrevented; without this guard
  //      one keypress would close the modal AND the sheet. (A native <dialog>'s
  //      implicit role is NOT matched by closest('[role="dialog"]'), so guard 3
  //      can't cover it — this separate closest('dialog') check is required.)
  //   3. focus is inside any [role="dialog"] surface OR inside the map layer
  //      (mainRef). The map half preserves MapLibre-controls Escape intent. The
  //      [role="dialog"] half covers the Cell/ClusterList popovers: they portal
  //      to document.body so mainRef containment can't reach them; their own
  //      Escape handlers don't preventDefault and register after this one, so
  //      without the guard one keypress would double-close popover + sheet. Both
  //      popovers focus their heading on mount, so closest('[role="dialog"]') is
  //      truthy whenever one is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // 1. Already handled by an inner widget.
      if (e.defaultPrevented) return;
      const active = document.activeElement;
      // 2. Inside an open native <dialog> (Credits) — it closes natively.
      const nativeDialog = active?.closest?.('dialog');
      if (nativeDialog instanceof HTMLDialogElement && nativeDialog.open) return;
      // 3. Inside an explicit dialog-role surface (portaled popovers) OR the map.
      //    Exclude the sheet's OWN root, which carries role="dialog" at full —
      //    a focus-inside-sheet Escape must DISMISS, not bail on its own role.
      const dialogAncestor = active?.closest?.('[role="dialog"]');
      if (dialogAncestor && dialogAncestor !== sheetRef.current) return;
      if (mainRef.current?.contains(active)) return;
      closeWithRestore();
      e.preventDefault();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closeWithRestore, mainRef]);

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
      // #431 drag-slop: until the finger has travelled past DRAG_SLOP_PX from the
      // anchor, treat the gesture as a tap — do NOT set `moved` and do NOT start
      // the translation (the height holds at the detent). This kills the
      // drag-start jiggle a sub-threshold tap-drag used to produce.
      if (Math.abs(e.clientY - d.startY) <= DRAG_SLOP_PX) return;
      d.moved = true;
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
        // F9 (#910) — drag-dismiss is a close path; restore focus.
        closeWithRestore();
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
    [heightFor, closeWithRestore, settleTo],
  );

  // F9 (#910) — capture the element that had focus when the sheet mounted so
  // every close path can restore to it. Mount-only: the sheet is keyed on
  // state.detail in App.tsx (remounts per species), so a fresh capture per
  // species is correct. queueMicrotask is NOT used — we want the activeElement
  // as it stands at mount, before the sheet moves focus anywhere.
  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    // Mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // F8 (#910) — real focus trap at FULL. At full the sheet is
  // role="dialog"/aria-modal, but `inert` only covers #map-layer (the O1
  // unified target); the AppHeader floating chrome sits above the backdrop and
  // stays tabbable, so Tab used to escape the dialog into AppHeader controls.
  // Mirror the filters-panel Tab-wrap (App.tsx ~L287): collect focusables with
  // the same selector and wrap first↔last. Active ONLY at snap==='full' and
  // torn down when leaving full or unmounting. This is a PURE keydown handler —
  // it does NOT touch the inert/role timing (goToSnap/settleTo/useLayoutEffect
  // own that sequencing; the MutationObserver tests stay green).
  useEffect(() => {
    if (snap !== 'full') return;
    const sheet = sheetRef.current;
    if (!sheet) return;

    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    // Exclude tier-hidden controls so the wrap lands on a focusable element.
    // At full the mid-only .sheet-fg-teaser (and its "Read account" button)
    // stays in the DOM but is hidden by the reveal channel (display + opacity:0
    // / visibility), so .focus() on it is a silent no-op that would break the
    // wrap. We can't use offsetParent (always null in jsdom → would exclude
    // everything in unit tests); instead walk up to the sheet checking computed
    // display/visibility/opacity. The real browser resolves these from the
    // stylesheet (excluding the opacity:0 teaser at full); jsdom does NOT apply
    // the stylesheet cascade to getComputedStyle, so every control stays
    // included there — which keeps the unit Tab-wrap tests meaningful.
    const isVisible = (el: HTMLElement): boolean => {
      let node: HTMLElement | null = el;
      while (node && node !== sheet.parentElement) {
        const cs = getComputedStyle(node);
        if (
          cs.display === 'none' ||
          cs.visibility === 'hidden' ||
          cs.opacity === '0'
        ) {
          return false;
        }
        node = node.parentElement;
      }
      return true;
    };
    const focusables = (): HTMLElement[] =>
      Array.from(sheet.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        isVisible,
      );

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        // Backward from the first control (or from outside the sheet) → last.
        if (active === first || !sheet.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        // Forward from the last control (or from outside the sheet) → first.
        if (active === last || !sheet.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    sheet.addEventListener('keydown', onKeyDown);
    return () => sheet.removeEventListener('keydown', onKeyDown);
  }, [snap]);

  // F10 (#910) — announce the species the first time a READABLE detent is
  // reached. `half` is the first readable detent (the identity card is legible)
  // and it does NOT move focus, so the polite live region is the only entry
  // announcement AT gets there. Fire exactly once, on the first time we are at
  // half with a resolved species name:
  //   • peek  → no announce (the map keeps focus; the row is too compact)
  //   • half  → announce once (first peek→half), latched so full→half won't
  //             re-fire
  //   • full  → no live-region push (the dialog focus-move announces via
  //             aria-label; a second push here would double-fire)
  useEffect(() => {
    if (snap !== 'half') return;
    if (announcedRef.current) return;
    if (!speciesName) return;
    announcedRef.current = true;
    setLiveMessage(speciesName);
  }, [snap, speciesName]);

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
  // ── Page-side-by-side (#08) page selection ────────────────────────────────
  // The sheet body is split into two STABLE, separately-rendered layout pages
  // (the catalog `.t-page` model) that cross-dissolve on the mid↔full leg:
  //   • card page  — photo-LEFT layout; serves compact AND mid (same structure,
  //                  compact just hides sci/rule/record/teaser). compact↔mid is
  //                  therefore an IN-PAGE card-resize (#01) + panel-reveal (#07),
  //                  NO cross-fade (the card page stays active across both).
  //   • entry page — photo-TOP masthead; serves full (taxonomy + About + the IO
  //                  sentinel; the only scrolling layout).
  // `page` drives data-page on the .sheet-pages container: compact|mid → 'card',
  // full → 'entry'. The mid↔full cross-dissolve and the container-height tween
  // both read the single --sheet-settle clock, so they start+finish on one frame.
  const page: 'card' | 'entry' = content === 'full' ? 'entry' : 'card';
  const cardActive = page === 'card';
  const entryActive = page === 'entry';
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
      // #08 settle gate. Pure state-derived attr (NOT a measure/reflow): the
      // page cross-dissolve + the in-page reveals fire ONLY at settle. During a
      // drag [data-settled='false'] pins them transition:none (alongside the
      // existing [data-dragging] height gate) so the drag is 1:1 and the
      // mid/full page swap is an instant hard-cut; the cross-fade plays on
      // release. resolveContentTier still blooms content DURING the drag — only
      // the MOTION is gated, never the presence.
      data-settled={dragging ? 'false' : 'true'}
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
      {/* F10 (#910) — visually-hidden polite live region. A DESCENDANT of the
          sheet root so it is announced under aria-modal at full. It carries the
          species name once a readable detent (half) is first reached; at full
          the dialog focus-move owns the announce, so this is not re-pushed. */}
      <div
        data-testid="sheet-live-region"
        className="sr-only"
        role="status"
        aria-live="polite"
      >
        {liveMessage}
      </div>
      {/* Shared sheet header (#1026): grabber (the pointer-wired drag handle) +
          bare × close, the same affordance vocabulary the filters sheet adopts.
          The grabber is handed in as a slot so this sheet keeps full ownership
          of the drag/snap/inert wiring (refs, pointer handlers, tap-toggle).
          The × is the single-pointer, non-drag dismissal (WCAG 2.5.7); it runs
          through closeWithRestore so #910 focus-restore holds on this path too,
          and it is visible at every snap (the SheetHeader is always rendered). */}
      <SheetHeader
        closeLabel="Close species detail"
        onClose={closeWithRestore}
        grabber={
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
        }
      />
      {/* Field-guide body: TWO stable layout pages cross-dissolved by recipe #08
          (page-side-by-side). data-page selects the active page; the inactive
          page is opacity:0 + pointer-events:none + a short translate/blur per
          #08 (CSS). Each page owns its OWN grid that NEVER re-templates — the
          mid→full morph is a genuine cross-fade between two stable layouts, not
          a grid re-template snap. The container height still card-resize-tweens
          on the sheet root, so mid→full reads as: height grows + card fades out
          + entry fades in, one clean motion. */}
      <div className="sheet-pages" data-page={page}>
        {/* ── CARD PAGE (photo-LEFT) — compact + mid ─────────────────────────
            Same structure for both detents; compact just hides sci/rule/record/
            teaser. compact↔mid is an in-page card-resize (#01) on the photo
            (44↔120, both fixed px, top-left anchored) + panel-reveal (#07) for
            sci/rule/record/teaser. NO page swap on compact↔mid (this page stays
            active). Inert + aria-hidden when the entry page is active so its
            DUPLICATED name/sci/family are not tabbable or double-announced. */}
        <section
          className="sheet-page sheet-page--card"
          data-page-id="card"
          aria-hidden={cardActive ? undefined : 'true'}
          // `inert` removes the inactive page from tab order + pointer + the
          // a11y tree; React renders the boolean attribute when true only.
          {...(cardActive ? {} : { inert: '' })}
        >
          <div className="sheet-fg-photo">
            {/* Decorative photo (alt=""): the species name always sits adjacent
                and we have no plumage metadata, so a non-empty alt would triple-
                announce. <Photo> owns the no-photo silhouette fallback (emits
                .photo--silhouette) and the family shape/color via the resolvers.
                The SAME cached photoUrl is rendered in both pages — no double
                network load (the <img> src is identical + browser-cached). */}
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
            {/* No id here — #detail-title lives on the ENTRY page (the full
                dialog heading) so the two pages don't collide on a duplicate id
                (axe duplicate-id). The dialog's accessible name comes from
                aria-label on the root, not aria-labelledby, so the card heading
                needs no id. */}
            <h2 className="sheet-fg-name">{data?.comName ?? 'Loading…'}</h2>
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
        </section>

        {/* ── ENTRY PAGE (photo-TOP masthead) — full ─────────────────────────
            The only scrolling layout: scrollerRef is the IntersectionObserver
            root and the bottom sentinel is its direct child (after About).
            tabIndex=0 satisfies axe scrollable-region-focusable. The focus trap
            queries focusables in THIS page. Inert + aria-hidden when the card
            page is active so its duplicated content stays out of the a11y tree
            and the tab order until full. */}
        <section
          className="sheet-page sheet-page--entry sheet-fg"
          data-page-id="entry"
          tabIndex={entryActive ? 0 : -1}
          ref={scrollerRef}
          aria-hidden={entryActive ? undefined : 'true'}
          {...(entryActive ? {} : { inert: '' })}
        >
          <div className="sheet-fg-photo">
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
                heading carries no tabIndex and never paints a focus ring.
                #detail-title is unique to the entry page (the card heading has no
                id) so the two always-rendered pages never duplicate the id. */}
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

          {/* Bottom sentinel for panel_scrolled_to_bottom (T3 #909). A DIRECT
              child of the entry page (.sheet-fg, the only scroll container)
              AFTER the About block. The entry page is always rendered (the #08
              cross-fade keeps both pages mounted), so the sentinel stays in
              layout; the observer is still armed only at snap==='full' (#914),
              the only detent the entry page is active and .sheet-fg scrolls. */}
          <div
            ref={sentinelRef}
            data-testid="detail-bottom-sentinel"
            aria-hidden="true"
          />
        </section>
      </div>
    </div>
  );
}
