import { describe, it, expect } from 'vitest';
import { computeScopeBounds } from './use-scope-camera.js';
import { CONUS_BOUNDS, FIT_BOUNDS_PADDING, INITIAL_VIEW } from './camera-config.js';
import { padBounds } from './mask.js';
import type { LngLatBounds } from './mask.js';

/* ── computeScopeBounds — pure scope bounds-math (U12 / #897) ─────────────────
   The three derived camera values factored out of MapCanvas.tsx's render body:
   `activeBounds` (fit target, tight), `clampBounds` (reactive maxBounds clamp),
   and the mount `initialViewState`. The guard FORMS are load-bearing and pinned
   here against regression:
     - activeBounds = bounds ?? CONUS_BOUNDS
     - clampBounds  = bounds && clampPad ? padBounds(bounds, clampPad) : activeBounds
       (NOT `padBounds(bounds, clampPad) ?? activeBounds` — padBounds is
       non-nullable; that form would call padBounds(undefined,undefined) and throw)
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
    it('is the padded envelope when BOTH bounds AND clampPad are present', () => {
      const { clampBounds } = computeScopeBounds(AZ_BOUNDS, 1.0);
      // Single source of truth: must equal padBounds(bounds, clampPad), not a
      // re-literaled value.
      expect(clampBounds).toEqual(padBounds(AZ_BOUNDS, 1.0));
      // And it must actually differ from the tight fit target (sanity: padding
      // expanded it).
      expect(clampBounds).not.toEqual(AZ_BOUNDS);
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
  });
});
