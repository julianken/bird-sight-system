import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest sets globals:false so @testing-library/react cannot detect afterEach
// as a global. Register cleanup manually so DOM is cleared between tests.
afterEach(() => {
  cleanup();
  // Reset any matchMedia overrides between tests. Individual tests that
  // set matchMedia via setMatchMedia() below get a fresh slate each time
  // so viewport state doesn't leak.
  resetMatchMedia();
});

/**
 * Controlled `window.matchMedia` mock.
 *
 * jsdom does not implement matchMedia, and even when polyfilled it does not
 * fire `change` events when the underlying viewport is simulated (there is
 * no layout engine). Tests that drive useMediaQuery() need to:
 *   1. Decide which queries match on mount (initial value).
 *   2. Trigger a matches→!matches transition without a real resize event.
 *
 * `setMatchMedia(matcher)` installs a mock where `matcher(query)` returns a
 * boolean indicating whether the query matches. The returned MediaQueryList-
 * like object carries a live `dispatchChange(newMatches)` method that tests
 * can call to flip `matches` and notify the registered listeners — which is
 * what useMediaQuery's effect registers on.
 */
export interface MockMediaQueryList {
  matches: boolean;
  media: string;
  addEventListener: (type: 'change', listener: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: 'change', listener: (e: MediaQueryListEvent) => void) => void;
  // Non-standard — tests call this to simulate a viewport change.
  dispatchChange: (matches: boolean) => void;
  // Legacy handlers kept null so `Object.assign({}, mql)` doesn't crash in
  // any consumer inspecting the full MediaQueryList surface.
  onchange: null;
  addListener: () => void;
  removeListener: () => void;
  dispatchEvent: () => boolean;
}

const registries: Map<string, MockMediaQueryList> = new Map();

export function setMatchMedia(matcher: (query: string) => boolean): void {
  window.matchMedia = (query: string) => {
    // Reuse the same MQL object per query so dispatchChange in a test hits
    // the same listener set the hook registered on mount.
    const existing = registries.get(query);
    if (existing) {
      existing.matches = matcher(query);
      return existing as unknown as MediaQueryList;
    }
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mql: MockMediaQueryList = {
      matches: matcher(query),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (type, listener) => {
        if (type === 'change') listeners.add(listener);
      },
      removeEventListener: (type, listener) => {
        if (type === 'change') listeners.delete(listener);
      },
      dispatchChange: (matches: boolean) => {
        mql.matches = matches;
        const event = { matches, media: query } as MediaQueryListEvent;
        listeners.forEach(listener => listener(event));
      },
      dispatchEvent: () => true,
    };
    registries.set(query, mql);
    return mql as unknown as MediaQueryList;
  };
}

export function getMockMediaQuery(query: string): MockMediaQueryList | undefined {
  return registries.get(query);
}

export function resetMatchMedia(): void {
  registries.clear();
  // @ts-expect-error — deliberately scrubbing the stub between tests.
  delete window.matchMedia;
}
