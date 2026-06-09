import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMapResize } from './use-map-resize.js';
import type { MapResizeMapRef, MapResizeTarget } from './use-map-resize.js';

/**
 * Characterization tests for the corrective `map.resize()` ResizeObserver
 * effect extracted from MapCanvas.tsx (epic #884 · U9).
 *
 * The load-bearing invariants this locks (written against the pre-extraction
 * behavior, confirmed RED→GREEN):
 *   1. rAF-debounced `resize()` fires on `observe()` (ResizeObserver delivers
 *      one callback synchronously on observe — the one-shot post-`mapReady`
 *      reparent correction).
 *   2. CAMERA-NEUTRAL — it NEVER calls `fitBounds`/`easeTo`/`flyTo`. This is the
 *      #737 / S4 scope-gate invariant (report R1): the resize must not be able
 *      to schedule a bbox `/api/observations` refetch.
 *   3. Cleanup — on unmount the observer's `disconnect()` is called and a
 *      pending rAF is cancelled, so a `<Map>` remount across a scope pick leaks
 *      neither (the JSDoc guard against leaking across a scope-pick `<Map>`
 *      remount).
 */

// A controllable ResizeObserver stub: capturing the callback lets the test
// drive the observe-fire deterministically (jsdom has no layout engine, so a
// real observer never fires).
class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  callback: ResizeObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.instances.push(this);
  }
  // Simulate the observer delivering a box-change notification.
  fire(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

// A spy maplibre map exposing the full camera surface so the negative
// assertions are meaningful (a camera method that fired would register here).
function makeSpyMap() {
  return {
    resize: vi.fn(),
    fitBounds: vi.fn(),
    easeTo: vi.fn(),
    flyTo: vi.fn(),
  };
}

describe('useMapResize', () => {
  let rafQueue: Array<() => void>;
  let rafIdSeq: number;
  let cancelledRafIds: number[];
  let originalRO: typeof globalThis.ResizeObserver | undefined;

  beforeEach(() => {
    StubResizeObserver.instances = [];
    rafQueue = [];
    cancelledRafIds = [];
    rafIdSeq = 0;

    // Deterministic rAF: enqueue and flush manually so the debounce is observable.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafIdSeq += 1;
      const id = rafIdSeq;
      rafQueue.push(() => cb(performance.now()));
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelledRafIds.push(id);
    });

    originalRO = globalThis.ResizeObserver;
    vi.stubGlobal('ResizeObserver', StubResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.ResizeObserver = originalRO as typeof globalThis.ResizeObserver;
  });

  function flushRaf(): void {
    const pending = rafQueue;
    rafQueue = [];
    pending.forEach(run => run());
  }

  function makeRefs(map: ReturnType<typeof makeSpyMap>) {
    const mapRef = {
      current: { getMap: () => map as unknown } as MapResizeMapRef,
    };
    const wrapperRef = { current: document.createElement('div') as MapResizeTarget };
    return { mapRef, wrapperRef };
  }

  it('observes the wrapper and fires a rAF-debounced resize() on observe', () => {
    const map = makeSpyMap();
    const { mapRef, wrapperRef } = makeRefs(map);

    renderHook(() => useMapResize(mapRef, wrapperRef, true));

    const observer = StubResizeObserver.instances[0];
    expect(observer).toBeDefined();
    expect(observer.observe).toHaveBeenCalledWith(wrapperRef.current);

    // Simulate the observe-callback fire; resize is deferred to the next frame.
    observer.fire();
    expect(map.resize).not.toHaveBeenCalled();
    flushRaf();
    expect(map.resize).toHaveBeenCalledTimes(1);
  });

  it('coalesces a burst of observer fires into a single rAF resize()', () => {
    const map = makeSpyMap();
    const { mapRef, wrapperRef } = makeRefs(map);

    renderHook(() => useMapResize(mapRef, wrapperRef, true));
    const observer = StubResizeObserver.instances[0];

    observer.fire();
    observer.fire();
    observer.fire();
    flushRaf();

    expect(map.resize).toHaveBeenCalledTimes(1);
  });

  it('is CAMERA-NEUTRAL — never calls fitBounds/easeTo/flyTo', () => {
    const map = makeSpyMap();
    const { mapRef, wrapperRef } = makeRefs(map);

    renderHook(() => useMapResize(mapRef, wrapperRef, true));
    const observer = StubResizeObserver.instances[0];
    observer.fire();
    flushRaf();

    expect(map.resize).toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.easeTo).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('does nothing until mapReady is true', () => {
    const map = makeSpyMap();
    const { mapRef, wrapperRef } = makeRefs(map);

    renderHook(() => useMapResize(mapRef, wrapperRef, false));

    expect(StubResizeObserver.instances).toHaveLength(0);
    expect(map.resize).not.toHaveBeenCalled();
  });

  it('disconnects the observer and cancels a pending rAF on unmount', () => {
    const map = makeSpyMap();
    const { mapRef, wrapperRef } = makeRefs(map);

    const { unmount } = renderHook(() => useMapResize(mapRef, wrapperRef, true));
    const observer = StubResizeObserver.instances[0];

    // Queue a frame but don't flush — it's pending at unmount.
    observer.fire();
    expect(rafQueue).toHaveLength(1);

    unmount();

    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(cancelledRafIds).toHaveLength(1);
  });
});
