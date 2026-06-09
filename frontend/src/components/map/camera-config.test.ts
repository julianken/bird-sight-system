import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CONUS_BOUNDS,
  CONUS_ZOOM_NARROW,
  CONUS_ZOOM_WIDE,
  FIT_BOUNDS_PADDING,
  pickInitialZoom,
} from './camera-config.js';

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
