import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import type { RefObject } from 'react';
import { computeScopeBounds, useScopeCamera } from './use-scope-camera.js';
import type {
  ScopeCameraMap,
  ScopeCameraMapRef,
  HashRestoreOptions,
} from './use-scope-camera.js';
import {
  CONUS_BOUNDS,
  FIT_BOUNDS_PADDING,
  INITIAL_VIEW,
  MIN_STATE_ONSCREEN,
  zoomAwareClampBounds,
} from '@/components/map/geometry/camera-config.js';
import { padBounds } from '@/components/map/geometry/mask.js';
import type { LngLatBounds } from '@/components/map/geometry/mask.js';
import { encodeViewbox } from '@/state/viewbox-link.js';

/* ── computeScopeBounds — pure scope bounds-math (U12 / #897) ─────────────────
   The three derived camera values factored out of MapCanvas.tsx's render body:
   `activeBounds` (fit target, tight), `clampBounds` (reactive maxBounds clamp),
   and the mount `initialViewState`. The guard FORMS are load-bearing and pinned
   here against regression:
     - activeBounds = bounds ?? CONUS_BOUNDS
     - clampBounds  = bounds && clampPad
                        ? zoomAwareClampBounds(bounds, clampPad, viewportSpan)
                        : activeBounds
       (#1059 — the clamp is now ZOOM-AWARE: caps the per-side pad by the live
       viewport span so a fully-void viewport is unreachable. With no live span
       — mount — it reduces to padBounds(bounds, clampPad), the pre-#1059 value.
       NOT `zoomAwareClampBounds(...) ?? activeBounds` — non-nullable; that form
       would call the derivation with undefined bounds and throw)
     - initialViewState = bounds ? {bounds, fitBoundsOptions} : INITIAL_VIEW
   The imperative effect (flyTo/fitBounds/#848 corrector) is characterized in
   MapCanvas.test.tsx's `MapCanvas controllable camera (#736)` suite. */

const AZ_BOUNDS: LngLatBounds = [
  [-114.815, 31.332],
  [-109.045, 37.004],
];

describe('computeScopeBounds', () => {
  describe('activeBounds (fit target — tight, never padded)', () => {
    it('is the scope bounds when present', () => {
      expect(computeScopeBounds(AZ_BOUNDS, undefined).activeBounds).toEqual(
        AZ_BOUNDS,
      );
    });

    it('falls back to CONUS_BOUNDS when bounds is undefined', () => {
      expect(computeScopeBounds(undefined, undefined).activeBounds).toEqual(
        CONUS_BOUNDS,
      );
    });

    it('stays TIGHT (unpadded) even when a clampPad is supplied', () => {
      // The fit target frames you on the state; only the CLAMP is padded.
      const { activeBounds } = computeScopeBounds(AZ_BOUNDS, 1.0);
      expect(activeBounds).toEqual(AZ_BOUNDS);
    });
  });

  describe('clampBounds (reactive maxBounds clamp)', () => {
    it('is the static padded envelope at mount (no live span) when BOTH bounds AND clampPad are present', () => {
      const { clampBounds } = computeScopeBounds(AZ_BOUNDS, 1.0);
      // Single source of truth: at mount (viewportSpan undefined) the zoom-aware
      // clamp reduces EXACTLY to the static padBounds(bounds, clampPad) — entry
      // framing is byte-identical to the pre-#1059 derivation. Equals the pure
      // zoomAwareClampBounds(..., undefined), not a re-literaled value.
      expect(clampBounds).toEqual(zoomAwareClampBounds(AZ_BOUNDS, 1.0, undefined));
      expect(clampBounds).toEqual(padBounds(AZ_BOUNDS, 1.0));
      // And it must actually differ from the tight fit target (sanity: padding
      // expanded it).
      expect(clampBounds).not.toEqual(AZ_BOUNDS);
    });

    it('TIGHTENS to the zoom-aware clamp when a live viewport span is supplied (#1059 — M-30 void unreachable)', () => {
      // At a high-zoom span (≪ one state-width) the per-side pad is capped by the
      // viewport span, so the clamp is the zoom-aware value, NOT the static one —
      // and the viewport can no longer pan fully off the state.
      const span: [number, number] = [0.067, 0.067]; // ≈ 390px @ z12
      const { clampBounds } = computeScopeBounds(AZ_BOUNDS, 1.0, span);
      // Single source of truth: delegates to the pure derivation.
      expect(clampBounds).toEqual(zoomAwareClampBounds(AZ_BOUNDS, 1.0, span));
      // It is STRICTLY tighter than the static clamp (the pad shrank).
      expect(clampBounds).not.toEqual(padBounds(AZ_BOUNDS, 1.0));
      // The pure-function pan guarantee, re-asserted at the hook seam: the west
      // viewport edge pinned at the clamp west still has its east edge intersect
      // the state, with ≥ MIN_STATE_ONSCREEN of the span overlapping.
      const [w] = AZ_BOUNDS[0];
      const [[cw]] = clampBounds;
      expect(cw + span[0]).toBeGreaterThan(w);
      expect(cw + span[0] - w).toBeGreaterThanOrEqual(
        MIN_STATE_ONSCREEN * span[0] - 1e-9,
      );
    });

    it('falls back to activeBounds (raw bounds, no pad) when clampPad is absent — ?scope=us / legacy callers', () => {
      const { clampBounds } = computeScopeBounds(AZ_BOUNDS, undefined);
      expect(clampBounds).toEqual(AZ_BOUNDS);
    });

    it('is CONUS_BOUNDS (via activeBounds) when neither bounds nor clampPad is present', () => {
      const { clampBounds } = computeScopeBounds(undefined, undefined);
      expect(clampBounds).toEqual(CONUS_BOUNDS);
    });

    it('does NOT pad when bounds is absent even if a clampPad is passed (guard short-circuits before padBounds — never throws)', () => {
      // The load-bearing guard: `bounds && clampPad ? padBounds(...) : activeBounds`.
      // With bounds undefined the ternary must NOT reach padBounds (which would
      // throw on the [[w,s],[e,n]] destructure of undefined). The `??`-form would
      // have thrown here.
      expect(() => computeScopeBounds(undefined, 1.0)).not.toThrow();
      expect(computeScopeBounds(undefined, 1.0).clampBounds).toEqual(CONUS_BOUNDS);
    });

    it('does NOT pad when clampPad is 0 (falsy) — falls back to activeBounds', () => {
      const { clampBounds } = computeScopeBounds(AZ_BOUNDS, 0);
      expect(clampBounds).toEqual(AZ_BOUNDS);
    });
  });

  describe('initialViewState (mount first-paint frame)', () => {
    it('frames the scope bounds with the asymmetric fitBoundsOptions when bounds is present', () => {
      const { initialViewState } = computeScopeBounds(AZ_BOUNDS, 1.0);
      expect(initialViewState).toEqual({
        bounds: AZ_BOUNDS,
        fitBoundsOptions: { padding: FIT_BOUNDS_PADDING, maxZoom: 12 },
      });
      // The padding is the single-source FIT_BOUNDS_PADDING (top:80, others:48).
      expect(
        (
          initialViewState as {
            fitBoundsOptions: { padding: typeof FIT_BOUNDS_PADDING };
          }
        ).fitBoundsOptions.padding,
      ).toEqual({ top: 80, bottom: 48, left: 48, right: 48 });
    });

    it('is the legacy CONUS INITIAL_VIEW when bounds is undefined', () => {
      const { initialViewState } = computeScopeBounds(undefined, undefined);
      expect(initialViewState).toBe(INITIAL_VIEW);
    });

    // #1242 (C4) — a `#map=` hash camera is the HIGHEST-PRECEDENCE first-paint
    // frame: it wins over the scope bounds frame AND the legacy CONUS view so a
    // copied link's captured view shows with no flash. It touches ONLY the mount
    // frame — activeBounds / clampBounds stay scope-derived (AC5).
    describe('hash-camera precedence (#1242)', () => {
      const HASH_CAM = { zoom: 11.5, lat: 32.221, lng: -110.974 };

      it('frames the first paint on the hash camera (lng/lat/zoom) when present, over scope bounds', () => {
        const { initialViewState } = computeScopeBounds(AZ_BOUNDS, 1.0, undefined, HASH_CAM);
        expect(initialViewState).toEqual({
          longitude: -110.974,
          latitude: 32.221,
          zoom: 11.5,
        });
      });

      it('carries optional bearing/pitch into the first paint (AC6)', () => {
        const { initialViewState } = computeScopeBounds(AZ_BOUNDS, 1.0, undefined, {
          ...HASH_CAM,
          bearing: 45,
          pitch: 30,
        });
        expect(initialViewState).toEqual({
          longitude: -110.974,
          latitude: 32.221,
          zoom: 11.5,
          bearing: 45,
          pitch: 30,
        });
      });

      it('leaves activeBounds + clampBounds scope-derived (hash does NOT touch the fit target / clamp)', () => {
        const { activeBounds, clampBounds } = computeScopeBounds(
          AZ_BOUNDS,
          1.0,
          undefined,
          HASH_CAM,
        );
        // The fit target stays the tight scope envelope and the clamp stays the
        // padded artboard — both unaffected by the hash camera (AC5 maxBounds).
        expect(activeBounds).toEqual(AZ_BOUNDS);
        expect(clampBounds).toEqual(padBounds(AZ_BOUNDS, 1.0));
      });

      it('falls back to the scope bounds frame when no hash camera is supplied', () => {
        const { initialViewState } = computeScopeBounds(AZ_BOUNDS, 1.0, undefined, undefined);
        expect(initialViewState).toEqual({
          bounds: AZ_BOUNDS,
          fitBoundsOptions: { padding: FIT_BOUNDS_PADDING, maxZoom: 12 },
        });
      });
    });
  });
});

/* ── useScopeCamera — #1242 (C4) hash restore + write-back ────────────────────
   The imperative effect's third (highest-precedence) hash branch and the
   debounced idle write-back. A hand-rolled fake map (the narrow
   `ScopeCameraMap` surface) spies the camera methods; `idle` listeners are
   captured so a test can fire a settle. */

/** Build a fake `ScopeCameraMap` + a ref to it, capturing the `idle` listeners. */
function makeFakeMap(center = { lng: -110.974, lat: 32.221 }) {
  const idleListeners: Array<() => void> = [];
  const map = {
    flyTo: vi.fn(),
    cameraForBounds: vi.fn(() => ({ center: { lng: -111.93, lat: 34 }, zoom: 6 })),
    fitBounds: vi.fn(),
    getCenter: vi.fn(() => center),
    setMaxBounds: vi.fn(),
    jumpTo: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    getZoom: vi.fn(() => 11.5),
    getBearing: vi.fn(() => 0),
    getPitch: vi.fn(() => 0),
    on: vi.fn((type: 'idle', listener: () => void) => {
      if (type === 'idle') idleListeners.push(listener);
    }),
  } satisfies ScopeCameraMap;
  const ref: RefObject<ScopeCameraMapRef | null> = createRef<ScopeCameraMapRef>();
  ref.current = { getMap: () => map };
  const fireIdle = () => idleListeners.forEach(l => l());
  return { map, ref, fireIdle };
}

const PRM_FALSE: RefObject<boolean> = { current: false };
// AZ_BOUNDS already declared above; a hash camera inside it.
const AZ_HASH = { zoom: 11.5, lat: 32.221, lng: -110.974 };

describe('useScopeCamera — hash restore (#1242)', () => {
  it('jumpTo the hash camera on first run when in-scope, and SUPPRESSES the scope fitBounds (AC1)', () => {
    const { map, ref } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        camera: AZ_HASH,
        inScope: true,
      } satisfies HashRestoreOptions),
    );
    expect(map.jumpTo).toHaveBeenCalledTimes(1);
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: { lng: AZ_HASH.lng, lat: AZ_HASH.lat },
      zoom: AZ_HASH.zoom,
    });
    // The scope fit is suppressed on the first run (the hash wins).
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('applies bearing/pitch via jumpTo when the hash carries rotation (AC6)', () => {
    const { map, ref } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        camera: { ...AZ_HASH, bearing: 45, pitch: 30 },
        inScope: true,
      }),
    );
    expect(map.jumpTo).toHaveBeenCalledWith({
      center: { lng: AZ_HASH.lng, lat: AZ_HASH.lat },
      zoom: AZ_HASH.zoom,
      bearing: 45,
      pitch: 30,
    });
  });

  it('returns restoredHashCamera = the applied camera (drives the data-hash-camera handle)', () => {
    const { ref } = makeFakeMap();
    const { result } = renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        camera: AZ_HASH,
        inScope: true,
      }),
    );
    expect(result.current.restoredHashCamera).toEqual(AZ_HASH);
  });

  it('falls back to the scope fitBounds when the hash is OUT of scope (AC5)', () => {
    const { map, ref } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        camera: { zoom: 6, lat: 31.0, lng: -99.0 }, // a Texas center, outside AZ
        inScope: false,
      }),
    );
    // No restore — the scope fit runs instead, framing the AZ envelope.
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(map.fitBounds.mock.calls[0]?.[0]).toEqual(AZ_BOUNDS);
  });

  it('SUPPRESSES the scope fit while validation is pending (inScope=null) — no flash before /api/states (AC1)', () => {
    const { map, ref } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, CONUS_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        camera: AZ_HASH,
        inScope: null,
      }),
    );
    // Neither restored NOR scope-fit — the first paint (hash) holds while undecided.
    expect(map.jumpTo).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('restores on the holding→real transition: inScope null→true re-runs and jumps the hash (load beats /api/states)', () => {
    const { map, ref } = makeFakeMap();
    const props = {
      camera: AZ_HASH as typeof AZ_HASH,
      inScope: null as boolean | null,
    };
    const { rerender } = renderHook(
      (p: { camera: typeof AZ_HASH; inScope: boolean | null }) =>
        useScopeCamera(ref, true, CONUS_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
          camera: p.camera,
          inScope: p.inScope,
        }),
      { initialProps: props },
    );
    // Pending: suppressed.
    expect(map.jumpTo).not.toHaveBeenCalled();
    // /api/states resolves AZ in-scope.
    rerender({ camera: AZ_HASH, inScope: true });
    expect(map.jumpTo).toHaveBeenCalledTimes(1);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });

  it('a genuine LATER scope change ignores the consumed hash and reframes via fitBounds (AC2)', () => {
    const { map, ref } = makeFakeMap();
    const { rerender } = renderHook(
      (p: { boundsKey: string; bounds: LngLatBounds }) =>
        useScopeCamera(ref, true, p.bounds, p.boundsKey, undefined, 1.0, PRM_FALSE, undefined, {
          camera: AZ_HASH,
          inScope: true,
        }),
      { initialProps: { boundsKey: 'US-AZ', bounds: AZ_BOUNDS } },
    );
    expect(map.jumpTo).toHaveBeenCalledTimes(1); // restored AZ
    expect(map.fitBounds).not.toHaveBeenCalled();

    // User switches to a different state — a new boundsKey. The hash is ignored.
    const FL_BOUNDS: LngLatBounds = [
      [-87.63, 24.52],
      [-80.03, 31.0],
    ];
    rerender({ boundsKey: 'US-FL', bounds: FL_BOUNDS });
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    expect(map.fitBounds.mock.calls[0]?.[0]).toEqual(FL_BOUNDS);
  });

  it('does NOT restore until mapReady (the load gate still holds)', () => {
    const { map, ref } = makeFakeMap();
    const { rerender } = renderHook(
      (p: { ready: boolean }) =>
        useScopeCamera(ref, p.ready, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
          camera: AZ_HASH,
          inScope: true,
        }),
      { initialProps: { ready: false } },
    );
    expect(map.jumpTo).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(map.jumpTo).toHaveBeenCalledTimes(1);
  });
});

describe('useScopeCamera — idle write-back (#1242)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const gate = (active: boolean, until: number) => ({
    scopeActiveRef: { current: active } as RefObject<boolean>,
    scopeMoveUntilRef: { current: until } as RefObject<number>,
  });

  it('writes the live camera to the hash via replaceState on idle when the gate is open', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    window.location.hash = '';
    const { ref, fireIdle } = makeFakeMap({ lng: -111.5, lat: 33.0 });
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        writeBackGate: gate(true, 0), // active + settle window already closed
      }),
    );
    fireIdle();
    vi.advanceTimersByTime(300); // debounce
    const expected = `#${encodeViewbox({ zoom: 11.5, lat: 33.0, lng: -111.5 })}`;
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy.mock.calls[0]?.[2]).toBe(expected);
    replaceSpy.mockRestore();
  });

  it('NEVER pushState (replaceState only — no history growth)', () => {
    const pushSpy = vi.spyOn(window.history, 'pushState');
    const { ref, fireIdle } = makeFakeMap({ lng: -111.5, lat: 33.0 });
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        writeBackGate: gate(true, 0),
      }),
    );
    fireIdle();
    vi.advanceTimersByTime(300);
    expect(pushSpy).not.toHaveBeenCalled();
    pushSpy.mockRestore();
  });

  it('does NOT write while the scope-move settle window is still open (gated on scopeMoveUntilRef)', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const { ref, fireIdle } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        writeBackGate: gate(true, Date.now() + 5000), // window open for 5s
      }),
    );
    fireIdle();
    vi.advanceTimersByTime(300);
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('does NOT write while unscoped (scopeActive false)', () => {
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    const { ref, fireIdle } = makeFakeMap();
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        writeBackGate: gate(false, 0),
      }),
    );
    fireIdle();
    vi.advanceTimersByTime(300);
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
  });

  it('is idempotent — skips the write when the encoded hash is unchanged', () => {
    const { ref, fireIdle } = makeFakeMap({ lng: -111.5, lat: 33.0 });
    // Pre-set the hash to exactly what the live camera encodes.
    window.location.hash = `#${encodeViewbox({ zoom: 11.5, lat: 33.0, lng: -111.5 })}`;
    const replaceSpy = vi.spyOn(window.history, 'replaceState');
    renderHook(() =>
      useScopeCamera(ref, true, AZ_BOUNDS, 'US-AZ', undefined, 1.0, PRM_FALSE, undefined, {
        writeBackGate: gate(true, 0),
      }),
    );
    fireIdle();
    vi.advanceTimersByTime(300);
    expect(replaceSpy).not.toHaveBeenCalled();
    replaceSpy.mockRestore();
    window.location.hash = '';
  });
});
