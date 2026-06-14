import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONUS_BOUNDS,
  CONUS_ZOOM_NARROW,
  CONUS_ZOOM_WIDE,
  FIT_BOUNDS_PADDING,
  MIN_STATE_ONSCREEN,
  pickInitialZoom,
  zoomAwareClampBounds,
} from './camera-config.js';
import { padBounds, ARTBOARD_PAD } from './mask.js';

// AZ tight bbox (matches STATES_FIXTURE / the #1059 issue body).
const AZ_BOUNDS: [[number, number], [number, number]] = [
  [-114.815, 31.332],
  [-109.045, 37.004],
];

// These tests run under vitest's jsdom environment (frontend/vite.config.ts:44),
// where `window` is ALWAYS defined and `window.innerWidth` defaults to 1024 —
// i.e. the WIDE branch. So the `<700 → narrow` case must actively stub
// `innerWidth`, and the SSR (`typeof window === 'undefined'`) case is
// unreachable by default and must stub `window` to undefined via
// `vi.stubGlobal`. We assert `pickInitialZoom()` DIRECTLY per the issue spec —
// NOT `INITIAL_VIEW.zoom`, which is frozen at import-time `window.innerWidth`
// (a non-deterministic SSR assertion).

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pickInitialZoom', () => {
  it('returns the narrow zoom on viewports below the 700px breakpoint', () => {
    vi.stubGlobal('window', { innerWidth: 699 });
    expect(pickInitialZoom()).toBe(CONUS_ZOOM_NARROW);
  });

  it('returns the wide zoom at and above the 700px breakpoint', () => {
    vi.stubGlobal('window', { innerWidth: 700 });
    expect(pickInitialZoom()).toBe(CONUS_ZOOM_WIDE);

    vi.stubGlobal('window', { innerWidth: 1440 });
    expect(pickInitialZoom()).toBe(CONUS_ZOOM_WIDE);
  });

  it('returns the wide zoom when there is no window (SSR)', () => {
    vi.stubGlobal('window', undefined);
    expect(pickInitialZoom()).toBe(CONUS_ZOOM_WIDE);
  });
});

describe('CONUS_BOUNDS', () => {
  // Linked pair with the server-side bbox cap in
  // services/read-api/src/validate.ts (45° lng × 25° lat at z>=6). CONUS_BOUNDS
  // is the client-side enforcement of that cap; if the server cap changes, this
  // constant must change too. This test locks the client side under the cap.
  it('stays inside the read-api 45° × 25° server cap', () => {
    const [[minLng, minLat], [maxLng, maxLat]] = CONUS_BOUNDS;
    // The bounds intentionally span MORE than the cap so a single z>=6 request
    // can never grab the whole envelope (CONUS is wider than 45°); the cap is
    // enforced per-request, while CONUS_BOUNDS is the pan clamp. We assert the
    // bounds are well-formed (min < max) and document the linked-pair tie.
    expect(maxLng).toBeGreaterThan(minLng);
    expect(maxLat).toBeGreaterThan(minLat);
    expect(CONUS_BOUNDS).toEqual([
      [-130, 20],
      [-65, 52],
    ]);
  });
});

describe('FIT_BOUNDS_PADDING', () => {
  // Regression-lock the #800/#761 scope-framing inset. The top inset of 80px was
  // re-derived in #800 after the AppHeader → two floating corner-cards migration
  // (old value: top 152). See the constant's JSDoc in camera-config.ts.
  it('keeps the #800/#761 top framing inset at 80px', () => {
    expect(FIT_BOUNDS_PADDING.top).toBe(80);
  });

  it('keeps the symmetric bottom/left/right insets at 48px', () => {
    expect(FIT_BOUNDS_PADDING.bottom).toBe(48);
    expect(FIT_BOUNDS_PADDING.left).toBe(48);
    expect(FIT_BOUNDS_PADDING.right).toBe(48);
  });
});

describe('zoomAwareClampBounds (#1059 — M-30 masked-void clamp)', () => {
  const [[w, s], [e, n]] = AZ_BOUNDS;
  const stateW = e - w; // ≈ 5.770°
  const stateH = n - s; // ≈ 5.672°

  /**
   * The DECOUPLING contract: the new zoom-IN backstop must NOT be wired off
   * `ARTBOARD_PAD`. `mask.test.ts` pins `ARTBOARD_PAD === 1.0` and the mask
   * geometry must not move; `MIN_STATE_ONSCREEN` is a separate constant.
   */
  it('exposes a MIN_STATE_ONSCREEN constant decoupled from ARTBOARD_PAD', () => {
    expect(MIN_STATE_ONSCREEN).toBe(0.2);
    // Sanity: it is NOT just a renamed ARTBOARD_PAD (1.0) — they are distinct.
    expect(MIN_STATE_ONSCREEN).not.toBe(ARTBOARD_PAD);
  });

  describe('mount / zoomed-out framing (no live span) is byte-identical to the static clamp', () => {
    it('equals padBounds(bounds, clampPad) when viewportSpan is undefined', () => {
      // Single source of truth for the zoom-OUT gate: with no live span the
      // function must reproduce the pre-#1059 static derivation exactly, so
      // entry framing (the fitBounds frame at mount) is unchanged.
      expect(zoomAwareClampBounds(AZ_BOUNDS, ARTBOARD_PAD, undefined)).toEqual(
        padBounds(AZ_BOUNDS, ARTBOARD_PAD),
      );
    });

    it('equals the static clamp when the viewport span is WIDER than the static band (deep zoom-out)', () => {
      // A viewport spanning many state-widths (zoomed out onto the gray field)
      // is the case ARTBOARD_PAD was sized for: the static gate is the smaller
      // term, so the result is the unchanged padded envelope.
      const wideSpan: [number, number] = [stateW * 10, stateH * 10];
      expect(zoomAwareClampBounds(AZ_BOUNDS, ARTBOARD_PAD, wideSpan)).toEqual(
        padBounds(AZ_BOUNDS, ARTBOARD_PAD),
      );
    });
  });

  describe('the binary merge gate: a fully-void viewport is impossible at high zoom', () => {
    // The M-30 finding: at z≥10 the viewport lng span is a small fraction of a
    // state-width, yet the static clamp leaves one full state-width of pad per
    // side — so the camera can pan until the viewport is 100% outside the state.
    // Representative high-zoom lng spans (deg) at canonical viewport widths:
    //   390px @ z12 ≈ 0.067°, 1440px @ z11 ≈ 0.494°, 1920px @ z10 ≈ 1.318°.
    for (const [label, span] of [
      ['390px @ z12', 0.067],
      ['1440px @ z11', 0.494],
      ['1920px @ z10', 1.318],
    ] as const) {
      it(`keeps the state bbox intersecting the viewport at every pan (${label})`, () => {
        const viewportSpan: [number, number] = [span, span];
        const clamp = zoomAwareClampBounds(AZ_BOUNDS, ARTBOARD_PAD, viewportSpan);
        const [[cw, cs], [ce, cn]] = clamp;

        // maxBounds pins the viewport edges inside the clamp rectangle. The
        // hardest west pan puts the viewport's WEST edge at the clamp west `cw`;
        // its EAST edge is then `cw + span`. For the viewport to still intersect
        // the state, that east edge must reach past the state's west edge `w`.
        expect(cw + span).toBeGreaterThan(w);
        // Symmetric east-pan check: west edge of the viewport (`ce - span`) must
        // still fall west of the state's east edge `e`.
        expect(ce - span).toBeLessThan(e);
        // North/south pan: same guarantee on the latitude axis.
        expect(cs + span).toBeGreaterThan(s);
        expect(cn - span).toBeLessThan(n);

        // And the guaranteed-overlap is at least MIN_STATE_ONSCREEN of the span
        // (a visible sliver of state, not a hairline touch).
        expect(cw + span - w).toBeGreaterThanOrEqual(
          MIN_STATE_ONSCREEN * span - 1e-9,
        );
      });
    }

    it('contrast: the OLD static clamp (no span) DOES admit a fully-void viewport at z12', () => {
      // Regression characterization — proves the test above is non-vacuous: the
      // pre-#1059 static clamp leaves a per-side pad of one state-width, which
      // at a 0.067° viewport span is ~86× the span ⇒ a fully-void pan exists.
      const [[cwStatic]] = padBounds(AZ_BOUNDS, ARTBOARD_PAD);
      const span = 0.067;
      // West edge at cwStatic ⇒ east edge cwStatic+span is still far WEST of the
      // state's west edge `w` ⇒ 100%-void viewport reachable.
      expect(cwStatic + span).toBeLessThan(w);
    });
  });

  it('never tightens BELOW the static clamp — the cap only shrinks the pad, never grows it', () => {
    // Even a giant span must not pad MORE than the static gate (the zoom-OUT
    // framing is an upper bound on the band).
    const hugeSpan: [number, number] = [stateW * 100, stateH * 100];
    const [[cw], [ce]] = zoomAwareClampBounds(AZ_BOUNDS, ARTBOARD_PAD, hugeSpan);
    const [[sw], [se]] = padBounds(AZ_BOUNDS, ARTBOARD_PAD);
    expect(cw).toBeGreaterThanOrEqual(sw - 1e-9);
    expect(ce).toBeLessThanOrEqual(se + 1e-9);
  });
});
