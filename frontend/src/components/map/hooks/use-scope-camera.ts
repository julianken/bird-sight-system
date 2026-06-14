import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { ZIP_FLYTO_ZOOM } from '@/state/scope-types.js';
import {
  CONUS_BOUNDS,
  FIT_BOUNDS_PADDING,
  INITIAL_VIEW,
  zoomAwareClampBounds,
} from '@/components/map/geometry/camera-config.js';
import type { LngLatBounds } from '@/components/map/geometry/mask.js';

/**
 * Scope-camera hook (extracted verbatim from `MapCanvas.tsx`, epic #884 · U12 /
 * #897). Owns the pure scope bounds-math (`activeBounds`/`clampBounds`/the mount
 * `initialViewState`) AND the SINGLE scope-driven camera-intent effect (the
 * `flyTo`-vs-`fitBounds` chooser + the #848 `moveend` longitude corrector). The
 * `mapRef` + the `<Map>` JSX stay in `MapCanvas`; only the math and the effect
 * move here. Behaviour-preserving: the effect body, its deps, and the
 * exhaustive-deps disable are 1:1 with the pre-extraction code.
 *
 * The #850 framing-offset, #736 S2-resize, and #848 mid-flight longitude
 * regressions are pinned by the `MapCanvas controllable camera (#736)`
 * characterization suite (`MapCanvas.test.tsx`); the bounds-math is pinned by
 * `computeScopeBounds` unit tests (`use-scope-camera.test.ts`).
 */

/**
 * `flyTo` intent carried by the `flyTo` prop (a ZIP "point inside the state"
 * camera target). Mirrors `MapCanvasProps['flyTo']` — kept local so the hook's
 * dependency surface is visible in its own type.
 */
export interface ScopeFlyTo {
  center: [number, number];
  zoom: number;
  key: string;
}

/**
 * The minimal maplibre-map surface this hook's effect touches: the imperative
 * camera methods of the scope-reframe path. Deliberately NOT maplibre's full
 * `Map` (same narrow-shape idiom as `use-map-resize.ts`'s `MapResizeMap`): the
 * surface documents exactly which camera APIs the scope effect drives.
 */
export interface ScopeCameraMap {
  flyTo: (options: {
    center: [number, number];
    zoom: number;
    essential: boolean;
    duration: number;
  }) => void;
  cameraForBounds: (
    bounds: LngLatBounds,
    options: { padding: typeof FIT_BOUNDS_PADDING; maxZoom: number },
  ) => { center: { lng: number; lat: number }; zoom: number } | undefined;
  fitBounds: (
    bounds: LngLatBounds,
    options: {
      padding: typeof FIT_BOUNDS_PADDING;
      maxZoom: number;
      essential: boolean;
      duration: number;
    },
  ) => void;
  getCenter: () => { lng: number; lat: number };
  setMaxBounds: (bounds: LngLatBounds) => void;
  jumpTo: (options: { center: { lng: number; lat: number }; zoom: number }) => void;
  once: (type: 'moveend', listener: () => void) => void;
  off: (type: 'moveend', listener: () => void) => void;
}

/**
 * The minimal react-map-gl `MapRef` surface: only `getMap()`, returning a
 * {@link ScopeCameraMap}. `mapRef.current?.getMap()` is the live maplibre handle.
 */
export interface ScopeCameraMapRef {
  getMap: () => ScopeCameraMap;
}

/** The mount `initialViewState` the `<Map>` is constructed with. */
export type ScopeInitialViewState =
  | {
      bounds: LngLatBounds;
      fitBoundsOptions: { padding: typeof FIT_BOUNDS_PADDING; maxZoom: number };
    }
  | typeof INITIAL_VIEW;

/** Result of {@link computeScopeBounds}: the three derived camera values. */
export interface ScopeBounds {
  /**
   * FIT TARGET — the envelope the camera frames on entry (`fitBounds` + the
   * mount `initialViewState`): the scope `bounds` when present, else the CONUS
   * fallback. TIGHT on the state (never padded) so entry framing lands on the
   * state (#760 AC: "entry still frames tightly").
   */
  activeBounds: LngLatBounds;
  /**
   * REACTIVE `maxBounds` clamp — distinct from the fit target. For a state scope
   * with `clampPad`, the state envelope padded outward by a ZOOM-AWARE per-side
   * pad: the smaller of the static `clampPad`× gate (the zoom-OUT framing) and a
   * cap derived from the live viewport span (the #1059 / M-30 zoom-IN backstop,
   * so a fully-void viewport is unreachable). The math lives in the pure
   * `zoomAwareClampBounds` (`camera-config.ts`); when no live span is supplied
   * (mount, before the first camera settle) it reduces EXACTLY to
   * `padBounds(bounds, clampPad)`, so entry framing is unchanged. For `?scope=us`
   * / legacy callers (no `clampPad`) it stays the raw `bounds ?? CONUS_BOUNDS`.
   *
   * Guard form is load-bearing: `bounds && clampPad ? zoomAwareClampBounds(...) :
   * activeBounds`. The ternary short-circuits before the derivation when `bounds`
   * is undefined, so the `[[w,s],[e,n]]` destructure inside never sees undefined.
   * A `zoomAwareClampBounds(bounds, clampPad, span) ?? activeBounds` form would
   * never fall through (the function is non-nullable) and would call the
   * derivation with `undefined` bounds → throw. Do NOT rewrite it into `??` form.
   */
  clampBounds: LngLatBounds;
  /**
   * First-paint frame (#736, contract item 2). When a scope `bounds` is present
   * AT MOUNT, frame the first paint to those bounds (uncontrolled `{ bounds,
   * fitBoundsOptions }`) so there is no flash of the CONUS overview before the
   * load-gated `fitBounds` effect runs. Otherwise keep the legacy CONUS view.
   * Read once at mount via a ref (see the hook below).
   */
  initialViewState: ScopeInitialViewState;
}

/**
 * Pure scope bounds-math (extracted from `MapCanvas.tsx`, #897). Derives the fit
 * target, the reactive clamp, and the mount `initialViewState` from the scope
 * `bounds` + `clampPad` (+ the live `viewportSpan` for the #1059 zoom-aware
 * clamp). No React, no maplibre — unit-tested directly.
 *
 * The guard forms below are preserved from HEAD; see {@link ScopeBounds} for why
 * `clampBounds` must stay a `bounds && clampPad ?` ternary.
 *
 * @param bounds       tight state envelope, or undefined (CONUS fallback)
 * @param clampPad     artboard pad factor (state scope only), else undefined
 * @param viewportSpan live `[lngSpan, latSpan]` in degrees (from the last camera
 *                     settle) for the zoom-aware clamp; undefined at mount, where
 *                     the clamp reduces to the static `padBounds(bounds, clampPad)`.
 */
export function computeScopeBounds(
  bounds: LngLatBounds | undefined,
  clampPad: number | undefined,
  viewportSpan?: [number, number],
): ScopeBounds {
  const activeBounds = bounds ?? CONUS_BOUNDS;
  const clampBounds =
    bounds && clampPad
      ? zoomAwareClampBounds(bounds, clampPad, viewportSpan)
      : activeBounds;
  const initialViewState: ScopeInitialViewState = bounds
    ? { bounds, fitBoundsOptions: { padding: FIT_BOUNDS_PADDING, maxZoom: 12 } }
    : INITIAL_VIEW;
  return { activeBounds, clampBounds, initialViewState };
}

/**
 * SINGLE scope-driven camera-intent hook (#736 — Task C3; extracted #897). Runs
 * the camera effect ported from the C0 prototype's `ScopedMap` and returns the
 * derived `clampBounds` (the reactive `maxBounds` prop) + the mount-stable
 * `initialViewState`. Keyed on `[mapReady, boundsKey, flyTo?.key]` (+ the
 * reduced-motion value). Load-bearing properties:
 *
 *  - Gated on `mapReady` (the maplibre `load` event), NOT on `mapRef.current`
 *    being non-null. The chooser-first model (#740) remounts the `<Map>` on every
 *    scope pick, so an imperative call on the first commit races GL init.
 *  - PREFERS `flyTo` over `fitBounds`: a ZIP entry is a "point inside the state"
 *    intent and must win over the whole-state framing on the same chooser→map
 *    mount (finding (f)).
 *  - `essential: true` is the reduced-motion bypass (ctx7 §3): the scope reframe
 *    changes what data the user sees, so the move must always LAND; we pass
 *    `duration: 0` under reduced motion to make the instant landing deterministic.
 *
 * Legacy callers (no `boundsKey` AND no `flyTo`) get no scope reframe — the
 * uncontrolled `initialViewState` keeps the legacy CONUS framing.
 *
 * @param mapRef               ref to the react-map-gl `MapRef` (`getMap()` → maplibre)
 * @param mapReady             gate: only move the camera once the `load` event fired
 * @param bounds              scope envelope (tight state bbox), or undefined
 * @param boundsKey           identity key for `bounds`; a change is the reframe trigger
 * @param flyTo               ZIP `flyTo` intent (wins over `fitBounds`), or undefined
 * @param clampPad            artboard clamp padding factor (state scope only)
 * @param prefersReducedMotionRef ref tracking the LIVE reduced-motion preference
 *                            (#1063: `usePrefersReducedMotion` is now a live
 *                            sensor). Passed as a REF, not a value, on purpose:
 *                            the flight `duration` reads `.current` at call time
 *                            (so an OS toggle takes effect on the NEXT reframe)
 *                            while the effect dep array stays inert — a live VALUE
 *                            in the deps would re-fire the reframe on a mid-session
 *                            toggle, the exact #848/#736 spurious-recenter class the
 *                            exhaustive-deps disable below guards against.
 * @param viewportSpan        live `[lngSpan, latSpan]` (deg) from the last camera
 *                            settle, feeding the #1059 zoom-aware clamp; undefined
 *                            at mount (clamp falls back to the static padded value)
 */
export function useScopeCamera(
  mapRef: RefObject<ScopeCameraMapRef | null>,
  mapReady: boolean,
  bounds: LngLatBounds | undefined,
  boundsKey: string | undefined,
  flyTo: ScopeFlyTo | undefined,
  clampPad: number | undefined,
  prefersReducedMotionRef: RefObject<boolean>,
  viewportSpan?: [number, number],
): { clampBounds: LngLatBounds; initialViewState: ScopeInitialViewState } {
  const { activeBounds, clampBounds, initialViewState } = computeScopeBounds(
    bounds,
    clampPad,
    viewportSpan,
  );

  /**
   * First-paint frame (#736, contract item 2). Read `initialViewState` once at
   * mount via a ref so a later `bounds` prop change re-frames through the
   * imperative effect (the single camera model), not by mutating
   * `initialViewState` (which is construction-only and would not re-apply
   * anyway). The camera model stays UNCONTROLLED + imperative (ctx7 §4).
   */
  const initialViewStateRef = useRef(initialViewState);

  useEffect(() => {
    if (!mapReady) return;
    if (boundsKey === undefined && flyTo === undefined) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    if (flyTo) {
      // The incoming `flyTo.zoom` is built from the shared `ZIP_FLYTO_ZOOM`
      // by App.tsx (`zipResolutionToScope`); we pass it through rather than
      // re-literaling 10. The void reference below keeps the import live as
      // the documented single-source contract even though the value rides in
      // on the prop.
      void ZIP_FLYTO_ZOOM;
      map.flyTo({
        center: flyTo.center,
        zoom: flyTo.zoom,
        essential: true,
        duration: prefersReducedMotionRef.current ? 0 : 800,
      });
      // The ZIP `flyTo` branch is IMMUNE to the #848 mid-flight longitude bug:
      // flyTo's easeFunc snaps to the exact targetCenter at `k===1`, so an
      // interrupted in-flight flyTo still lands the requested center. No
      // corrector is registered here — the branch is untouched.
      return;
    }

    // #848 — Switching to a new state WHILE the camera is mid-animation frames
    // the new state at the wrong longitude (zoom + latitude land correctly).
    // VERIFIED live + traced into maplibre-gl 5.24.0: this is the SAME in-flight
    // transform-clone replay class as the #762/#765 `renderWorldCopies` clobber
    // (MapCanvas world-copies effect) — on the `maxBounds`/`lngRange` axis.
    //
    // Sequence (verified frame-by-frame in the e2e harness):
    //   1. The state switch re-renders; react-map-gl's layout effect runs FIRST
    //      and `setMaxBounds(newState)` → `transform.lngRange` momentarily holds
    //      the NEW state envelope ("Not a stale-maxBounds clamp" is true at this
    //      instant — react-map-gl DID apply the new bounds).
    //   2. But the still-in-flight `easeTo` from before the switch re-`apply`s a
    //      CLONE of its start transform (with the OLD state's `lngRange`) on its
    //      next animation frame — clobbering `lngRange` back to the OLD state
    //      BEFORE this passive effect even runs (passive effects fire after a
    //      paint, i.e. after ≥1 animation frame).
    //   3. So by the time this effect calls `fitBounds`, `transform.lngRange` is
    //      the OLD (e.g. western) state's. `fitBounds` → Mercator `handleEaseTo`
    //      captures its `from`-basis against that clobbered transform; with no
    //      `k===1` target snap (unlike flyTo) and `renderWorldCopies=false` (no
    //      world-copy wrap), the camera lands edge-pinned at the OLD state's
    //      eastern `lngRange` edge — the wrong, western-ish longitude.
    //
    // `cameraForBounds` returns the geometry-correct target even mid-flight (it
    // derives from absolute world geometry, independent of the live transform).
    // So we read the target up front and, on the settle `moveend` (after the
    // clobbering animation has fully ended so the clone no longer re-applies),
    // RE-ASSERT the new state's `maxBounds` (undoing the clone clobber of
    // `lngRange`) and `jumpTo` the target. This mirrors #762/#765's
    // imperative-reassert-on-moveend exactly, one axis over.
    //
    // Why the maxBounds reassert is REQUIRED (not just jumpTo): the clobbered
    // `lngRange` would clamp the corrective `jumpTo` straight back to the OLD
    // state's edge — verified live. The reassert is the ONE sanctioned imperative
    // `setMaxBounds` site (an idempotent reassert of the same declarative
    // `clampBounds`), NOT the reactive clamp mechanism: `maxBounds` remains a
    // reactive `<Map>` prop (finding-(a), invariant documented at the clampBounds
    // block in MapCanvas.tsx). It runs only behind this `moveend`, never during
    // reactive reconciliation; the finding-(a) guard fires no `moveend`, so it
    // stays green. NOT a bare `map.stop()` in the effect: `easeTo` already
    // self-`_stop`s, freezing the western basis — stop alone fixes neither the
    // longitude nor the `lngRange` clobber.
    const target = map.cameraForBounds(activeBounds, {
      padding: FIT_BOUNDS_PADDING,
      maxZoom: 12,
    });
    let corrector: (() => void) | undefined;
    // `fitBounds` first `stop()`s the in-flight `easeTo` — which fires a
    // SYNCHRONOUS cancellation `moveend` (at the frozen western position) DURING
    // the `fitBounds()` call, before fitBounds starts its own animation. We must
    // NOT correct on that cancellation moveend: a `jumpTo` there is immediately
    // clobbered by fitBounds's subsequent animation (verified live). We correct
    // only on fitBounds's OWN settle moveend, which fires asynchronously AFTER
    // `fitBounds()` returns. `fitBoundsDispatched` gates that: a moveend that
    // fires while it is still `false` is the synchronous cancellation (or, under
    // reduced motion, the instant settle that needs no correction) — re-arm and
    // skip.
    let fitBoundsDispatched = false;
    if (target) {
      const EPS = 1e-3; // ≈100 m — far below the 15–41° bug magnitude, above float noise.
      corrector = () => {
        if (!fitBoundsDispatched) {
          // Synchronous cancellation moveend (still inside the fitBounds call) —
          // re-arm for the real settle rather than correcting prematurely.
          if (corrector) map.once('moveend', corrector);
          return;
        }
        const c = map.getCenter();
        if (
          Math.abs(c.lng - target.center.lng) > EPS ||
          Math.abs(c.lat - target.center.lat) > EPS
        ) {
          // Re-assert the new scope's clamp (undo the in-flight clone's
          // `lngRange` clobber) so the corrective jumpTo is not re-clamped back
          // to the old state's edge, THEN land the geometry-correct target.
          map.setMaxBounds(clampBounds);
          map.jumpTo({ center: target.center, zoom: target.zoom });
        }
      };
      // Register the one-shot corrector BEFORE calling fitBounds — ordering is
      // load-bearing: under prefers-reduced-motion `fitBounds` runs `duration: 0`
      // and fires `moveend` SYNCHRONOUSLY inside the call, so the listener must
      // already exist. `map.once` is self-removing, so `jumpTo`'s own `moveend`
      // cannot re-fire the corrector (no loop).
      map.once('moveend', corrector);
    }

    map.fitBounds(activeBounds, {
      // Asymmetric top inset (FIT_BOUNDS_PADDING) clears the floating header +
      // scope-control chrome that stacks over the full-bleed canvas top edge
      // post-#761/S2 — resolves the deferred TODO(#737). top > bottom/left/right.
      padding: FIT_BOUNDS_PADDING,
      maxZoom: 12,
      essential: true,
      duration: prefersReducedMotionRef.current ? 0 : 600,
    });
    // fitBounds has returned: any synchronous cancellation moveend it fired
    // (while stopping the in-flight easeTo) is now past. From here, the next
    // moveend is fitBounds's own settle — the corrector may act.
    fitBoundsDispatched = true;

    // Belt-and-suspenders: detach the corrector on cleanup so a re-fired effect
    // (next boundsKey change) cannot leave a stale listener.
    return () => {
      if (corrector) map.off('moveend', corrector);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boundsKey +
    // flyTo?.key are the intentional triggers; `activeBounds` identity derives
    // from boundsKey and re-running on its reference churn is undesirable
    // (prototype documents this exact disable). The reduced-motion preference is
    // read through `prefersReducedMotionRef.current` at flight-dispatch time, NOT
    // from a value dep: #1063 made `usePrefersReducedMotion` a LIVE sensor, and a
    // live VALUE in this array would re-fire the reframe the instant a user
    // toggles OS reduce-motion mid-session — a spurious recenter on an unchanged
    // scope, the exact #848/#736 "camera moves when it shouldn't" class this unit
    // guards. A stable ref carries the live value into the flight `duration`
    // without participating in the trigger set: the duration tracks the live
    // preference on the NEXT reframe while the effect stays keyed only on real
    // scope changes. The ref is intentionally NOT listed (refs are stable; ESLint
    // would not require it anyway).
  }, [mapReady, boundsKey, flyTo?.key]);

  return { clampBounds, initialViewState: initialViewStateRef.current };
}
