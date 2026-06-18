import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ZIP_FLYTO_ZOOM } from '@/state/scope-types.js';
import {
  CONUS_BOUNDS,
  FIT_BOUNDS_PADDING,
  INITIAL_VIEW,
  zoomAwareClampBounds,
} from '@/components/map/geometry/camera-config.js';
import type { LngLatBounds } from '@/components/map/geometry/mask.js';
import { encodeViewbox } from '@/state/viewbox-link.js';
import type { ViewboxCamera } from '@/state/viewbox-link.js';

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
  // #1242 (C4) — `jumpTo` gained optional `bearing`/`pitch` so the hash-camera
  // restore can apply a rotated/tilted viewbox (the codec carries them, AC6).
  // The scope-reframe corrector still calls it with only `{ center, zoom }`
  // (north-up), so both fields stay optional.
  jumpTo: (options: {
    center: { lng: number; lat: number };
    zoom: number;
    bearing?: number;
    pitch?: number;
  }) => void;
  once: (type: 'moveend', listener: () => void) => void;
  // #1242 (C4) — `off` now also detaches the `idle` write-back listener.
  off: (type: 'idle' | 'moveend', listener: () => void) => void;
  // #1242 (C4) — read-back surface for the idle write-back: the live camera the
  // encoder serializes into the `#map=` hash. `on('idle')` registers the
  // debounced writer; the getters read the settled camera.
  getZoom: () => number;
  getBearing: () => number;
  getPitch: () => number;
  on: (type: 'idle', listener: () => void) => void;
}

/**
 * The minimal react-map-gl `MapRef` surface: only `getMap()`, returning a
 * {@link ScopeCameraMap}. `mapRef.current?.getMap()` is the live maplibre handle.
 */
export interface ScopeCameraMapRef {
  getMap: () => ScopeCameraMap;
}

/**
 * #1242 (C4) — first-paint camera reconstructed from a `#map=` viewbox hash.
 * Highest-precedence `initialViewState` variant: when a (raw, mount-known) hash
 * camera is present, the FIRST PAINT lands directly on it — so a copied link's
 * captured view shows with no CONUS/scope flash, BEFORE `/api/states` resolves
 * and independent of the imperative effect (AC1). `longitude`/`latitude`/`zoom`
 * (+ optional `bearing`/`pitch`, AC6) is the uncontrolled react-map-gl shape,
 * mirroring `INITIAL_VIEW`.
 */
export interface HashInitialViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing?: number;
  pitch?: number;
}

/** The mount `initialViewState` the `<Map>` is constructed with. */
export type ScopeInitialViewState =
  | HashInitialViewState
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
 * @param initialHashCamera #1242 (C4) — RAW camera parsed from a `#map=` hash
 *                     (App.tsx, once at mount). HIGHEST PRECEDENCE for the
 *                     first-paint `initialViewState` only: when present it frames
 *                     the first paint on the captured view (no scope/CONUS flash),
 *                     regardless of `bounds`. Does NOT touch `activeBounds`/
 *                     `clampBounds` — those stay scope-derived so `maxBounds` and
 *                     the imperative fit target remain the scope envelope (AC5).
 */
export function computeScopeBounds(
  bounds: LngLatBounds | undefined,
  clampPad: number | undefined,
  viewportSpan?: [number, number],
  initialHashCamera?: ViewboxCamera,
): ScopeBounds {
  const activeBounds = bounds ?? CONUS_BOUNDS;
  const clampBounds =
    bounds && clampPad
      ? zoomAwareClampBounds(bounds, clampPad, viewportSpan)
      : activeBounds;
  // First-paint precedence: hash camera > scope bounds frame > legacy CONUS.
  // Only the mount frame is affected; the clamp + fit target stay scope-derived.
  let initialViewState: ScopeInitialViewState;
  if (initialHashCamera) {
    initialViewState = {
      longitude: initialHashCamera.lng,
      latitude: initialHashCamera.lat,
      zoom: initialHashCamera.zoom,
      ...(initialHashCamera.bearing !== undefined
        ? { bearing: initialHashCamera.bearing }
        : {}),
      ...(initialHashCamera.pitch !== undefined
        ? { pitch: initialHashCamera.pitch }
        : {}),
    };
  } else if (bounds) {
    initialViewState = { bounds, fitBoundsOptions: { padding: FIT_BOUNDS_PADDING, maxZoom: 12 } };
  } else {
    initialViewState = INITIAL_VIEW;
  }
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
 * @param hashRestore         #1242 (C4) — the viewbox-restore wiring. Optional;
 *                            absent for legacy/test callers (no hash behavior).
 *                            See {@link HashRestoreOptions}.
 */
export interface HashRestoreOptions {
  /**
   * RAW camera parsed once from the `#map=` hash (App.tsx, non-reactive). Drives
   * the first-paint `initialViewState` AND the imperative first-run suppression
   * — both mount-known, so a copied link never flashes the scope/CONUS view.
   * `undefined` when there is no `#map=` (normal scope-derived load).
   */
  camera?: ViewboxCamera;
  /**
   * VALIDATION verdict of `camera`'s center against the RESOLVED scope envelope
   * (App.tsx, reactive — `null` while `/api/states` is still holding CONUS,
   * `true` once validated in-scope, `false` once validated out-of-scope). The
   * imperative restore waits for a non-null verdict so it never locks onto a
   * transient holding-CONUS pass (AC5: an out-of-scope hash must fall back to
   * the scope `fitBounds`, not stick under the artboard mask). Drives the
   * effect's re-fire (it is in the dep array) so the decision lands even if the
   * map `load` event beats `/api/states`.
   */
  inScope?: boolean | null;
  /**
   * Live gate inputs for the idle WRITE-BACK, read at `idle` time (NOT render
   * time) so the verdict is always fresh:
   *   - `scopeActiveRef`     — true while a scope is active (App's live mirror).
   *   - `scopeMoveUntilRef`  — timestamp through which the programmatic-camera
   *                            settle window is open; the write-back fires only
   *                            once `Date.now()` has passed it.
   * The write-back therefore fires ONLY on a genuine user pan, never during the
   * scope reframe / hash restore animation. Absent ⇒ no write-back (legacy/test
   * callers). Passing the two refs (rather than a pre-computed boolean) is
   * load-bearing: a boolean computed at render time would be stale at `idle`
   * time, since the settle window closes between renders.
   */
  writeBackGate?: {
    scopeActiveRef: RefObject<boolean>;
    scopeMoveUntilRef: RefObject<number>;
  };
}

export function useScopeCamera(
  mapRef: RefObject<ScopeCameraMapRef | null>,
  mapReady: boolean,
  bounds: LngLatBounds | undefined,
  boundsKey: string | undefined,
  flyTo: ScopeFlyTo | undefined,
  clampPad: number | undefined,
  prefersReducedMotionRef: RefObject<boolean>,
  viewportSpan?: [number, number],
  hashRestore?: HashRestoreOptions,
): {
  clampBounds: LngLatBounds;
  initialViewState: ScopeInitialViewState;
  restoredHashCamera: ViewboxCamera | null;
} {
  const hashCamera = hashRestore?.camera;
  const hashInScope = hashRestore?.inScope ?? null;
  const { activeBounds, clampBounds, initialViewState } = computeScopeBounds(
    bounds,
    clampPad,
    viewportSpan,
    hashCamera,
  );

  /**
   * First-paint frame (#736, contract item 2). Read `initialViewState` once at
   * mount via a ref so a later `bounds` prop change re-frames through the
   * imperative effect (the single camera model), not by mutating
   * `initialViewState` (which is construction-only and would not re-apply
   * anyway). The camera model stays UNCONTROLLED + imperative (ctx7 §4).
   */
  const initialViewStateRef = useRef(initialViewState);

  // #1242 (C4) — hash-restore state. `hashSettledRef` latches the one-time
  // decision (restore the hash OR fall back to the scope fit) so a later
  // SAME-scope effect re-run (e.g. the #850 framing churn) can't clobber it.
  // `mountBoundsKeyRef` pins the `boundsKey` AT MOUNT: the holding→real-envelope
  // transition keeps the SAME key (App.tsx), so `boundsKey === mountBoundsKey`
  // is the "still the initial scope" test (AC2 — a genuine later scope change
  // flips the key and is NOT suppressed). `restoredCameraRef` holds the camera
  // we actually applied, surfaced for the `data-hash-camera` e2e handle.
  const hashSettledRef = useRef(false);
  const mountBoundsKeyRef = useRef(boundsKey);
  // STATE (not a ref) so a restore triggers a re-render — MapCanvas then emits
  // the `data-hash-camera` attribute for the GPU-free e2e assertion (a ref
  // mutation would not re-render and the attribute would never appear).
  const [restoredHashCamera, setRestoredHashCamera] = useState<ViewboxCamera | null>(null);
  // MIRROR of the above in a ref, for the EFFECT's internal reads. The effect
  // must NOT depend on `restoredHashCamera` (state) — listing it would re-fire
  // the camera effect when the restore sets it, double-running fitBounds on a
  // genuine scope change (the clear→re-run→fitBounds-again class). A ref carries
  // the value into the effect without participating in the trigger set.
  const restoredHashCameraRef = useRef<ViewboxCamera | null>(null);
  const setRestoredHashBoth = (cam: ViewboxCamera | null) => {
    restoredHashCameraRef.current = cam;
    setRestoredHashCamera(cam);
  };

  useEffect(() => {
    if (!mapReady) return;
    const atMountScope = boundsKey === mountBoundsKeyRef.current;

    // ── #1242 (C4) third, HIGHEST-PRECEDENCE branch: restore the `#map=` hash ──
    // Runs only on the INITIAL scope (mount-value `boundsKey` guard) and only
    // once (`hashSettledRef`). It precedes flyTo/fitBounds so a copied link wins
    // over the scope framing on cold load.
    if (hashCamera && atMountScope && !hashSettledRef.current) {
      const map = mapRef.current?.getMap();
      if (!map) return;
      if (hashInScope === null) {
        // Validation pending (states table still holding CONUS). SUPPRESS the
        // scope fit so there is no CONUS flash — the first paint already shows
        // the hash camera. We re-run when `inScope` resolves (it is a dep).
        return;
      }
      hashSettledRef.current = true;
      if (hashInScope === true) {
        // In-scope: lock onto the captured view. `jumpTo` (synchronous, no
        // animation) lands exactly on it — rotation/tilt included (AC6).
        map.jumpTo({
          center: { lng: hashCamera.lng, lat: hashCamera.lat },
          zoom: hashCamera.zoom,
          ...(hashCamera.bearing !== undefined ? { bearing: hashCamera.bearing } : {}),
          ...(hashCamera.pitch !== undefined ? { pitch: hashCamera.pitch } : {}),
        });
        setRestoredHashBoth(hashCamera);
        return; // suppress the scope fitBounds on this first run (AC1)
      }
      // hashInScope === false → out of scope (AC5): fall through to the normal
      // scope flyTo/fitBounds so the camera frames the scope, not the stray hash.
    } else if (hashSettledRef.current && atMountScope && restoredHashCameraRef.current) {
      // The hash was restored for this initial scope; a later same-scope
      // re-run (framing churn) must NOT re-frame over it. A genuine scope change
      // flips `boundsKey` (atMountScope false) and skips this guard (AC2).
      return;
    } else if (!atMountScope && restoredHashCameraRef.current) {
      // AC2 — a GENUINE scope change reframes via fitBounds/flyTo below; the
      // restored hash camera is now stale (the camera no longer shows it), so
      // clear the `data-hash-camera` handle. Falls through to the scope reframe.
      // The ref clears synchronously (no re-fire); the state clears for the
      // attribute on the consequent render.
      setRestoredHashBoth(null);
    }

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
    //
    // #1242 (C4): `hashInScope` IS a dep — the hash-restore branch above must
    // re-run when the validation verdict resolves (null→true/false) so the
    // decision lands even when the map `load` event beats `/api/states`. The
    // mount-value `boundsKey` guard keeps that re-run scoped to the initial
    // scope; a genuine scope change is still the `boundsKey` trigger. The
    // restored camera is read through `restoredHashCameraRef` (NOT the state) so
    // a restore does not re-fire the effect and double-run fitBounds.
  }, [mapReady, boundsKey, flyTo?.key, hashCamera, hashInScope]);

  // #1242 (C4) — debounced idle WRITE-BACK. A `map.on('idle')` listener
  // serializes the live camera into the `#map=` hash via `replaceState` only
  // (never pushState / synthetic popstate — a viewbox write must not grow the
  // history stack or re-fire `useUrlState`'s popstate read). Idempotent: skips
  // when the encoded hash equals the live one. Gated on `writeBackEnabledRef`
  // (App: `scopeActive` AND past the scope-move settle window) so it fires only
  // on genuine user pans, never during the scope reframe / hash restore.
  const writeBackGate = hashRestore?.writeBackGate;
  useEffect(() => {
    if (!mapReady) return;
    if (!writeBackGate) return;
    const map = mapRef.current?.getMap();
    if (!map) return;
    const { scopeActiveRef, scopeMoveUntilRef } = writeBackGate;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const WRITE_DEBOUNCE_MS = 300;
    const writeHash = () => {
      // Evaluate the gate LIVE (the settle window closes between renders): only
      // write on a genuine user pan — scope active AND past the camera-settle
      // window. Never during the scope reframe / hash restore animation.
      if (!scopeActiveRef.current) return;
      if (Date.now() < (scopeMoveUntilRef.current ?? 0)) return;
      const center = map.getCenter();
      const camera: ViewboxCamera = {
        zoom: map.getZoom(),
        lat: center.lat,
        lng: center.lng,
      };
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      if (bearing !== 0) camera.bearing = bearing;
      if (pitch !== 0) camera.pitch = pitch;
      const next = `#${encodeViewbox(camera)}`;
      // Idempotent no-op guard: skip the write (and the history churn) when the
      // serialized camera is byte-identical to what is already in the bar.
      if (window.location.hash === next) return;
      window.history.replaceState(window.history.state, '', next);
    };
    const onIdle = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(writeHash, WRITE_DEBOUNCE_MS);
    };
    map.on('idle', onIdle);
    return () => {
      if (timer) clearTimeout(timer);
      map.off('idle', onIdle);
    };
    // mapReady is the gate; writeBackEnabledRef is a stable ref (read live in
    // writeHash). No other deps — the listener is registered once per map load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  return {
    clampBounds,
    initialViewState: initialViewStateRef.current,
    restoredHashCamera,
  };
}
