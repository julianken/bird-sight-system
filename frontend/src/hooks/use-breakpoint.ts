/**
 * useBreakpoint — shared responsive breakpoint hook (#800 / #761 #803).
 *
 * Returns one of three named tiers keyed to the overlay breakpoint tokens
 * from tokens.css:
 *   - `'compact'`  — viewport width ≤ --overlay-bp-compact (480px)
 *   - `'roomy'`    — 480px < width < --overlay-bp-wide (1024px)
 *   - `'wide'`     — viewport width ≥ --overlay-bp-wide (1024px)
 *
 * The compact boundary is INCLUSIVE of 480 (F2 #1062): the CSS is desktop-first
 * (`@media (max-width: 480px)` = ≤480) and the deleted `useIsPhone` hook queried
 * `(max-width: 480px)` too, so at exactly w=480 every authority must agree on
 * `'compact'`. Before #1062 the engine queried one px below BP_COMPACT (≤479)
 * and disagreed with CSS at the single-pixel boundary. The `'wide'` boundary
 * stays EXCLUSIVE (≥1024 is wide) — that is `min-width`-style and uncontested.
 *
 * Uses `window.matchMedia` so the hook reacts to live viewport resizes.
 * SSR-safe: in environments where `window` is undefined (e.g. jsdom without
 * matchMedia) the hook returns the desktop fallback `'wide'` on the first
 * render, then re-evaluates on mount — same discipline as
 * `readLegendDefaultExpanded()` in MapSurface.tsx.
 *
 * The pixel values here mirror `--overlay-bp-compact` (480) and
 * `--overlay-bp-wide` (1024) from tokens.css Layer 1. Both sides must stay in
 * sync; tokens.test.ts covers the tokens.ts scale; update this file if either
 * pixel value changes.
 */

import { useState, useEffect } from 'react';

export type Breakpoint = 'compact' | 'roomy' | 'wide';

/** Token values in px — must stay in sync with tokens.css `--overlay-bp-*`. */
const BP_COMPACT = 480;
const BP_WIDE = 1024;

function readBreakpoint(): Breakpoint {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    // SSR / jsdom without matchMedia — default wide so server-rendered HTML
    // matches the desktop fallback (same discipline as readLegendDefaultExpanded).
    return 'wide';
  }
  if (window.matchMedia(`(max-width: ${BP_COMPACT}px)`).matches) {
    return 'compact';
  }
  if (window.matchMedia(`(max-width: ${BP_WIDE - 1}px)`).matches) {
    return 'roomy';
  }
  return 'wide';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(readBreakpoint);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const mqlCompact = window.matchMedia(`(max-width: ${BP_COMPACT}px)`);
    const mqlRoomy = window.matchMedia(`(max-width: ${BP_WIDE - 1}px)`);

    function onchange() {
      setBp(readBreakpoint());
    }

    mqlCompact.addEventListener('change', onchange);
    mqlRoomy.addEventListener('change', onchange);

    // Evaluate once on mount in case window.matchMedia wasn't available during
    // the initial useState call (SSR hydration reconciliation).
    setBp(readBreakpoint());

    return () => {
      mqlCompact.removeEventListener('change', onchange);
      mqlRoomy.removeEventListener('change', onchange);
    };
  }, []);

  return bp;
}
