import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import { useSilhouetteCatalogue } from './use-silhouette-catalogue.js';

// 1:1 colocated characterization test for U7 (#891 / epic #884). This is a
// behavior-PRESERVING extraction of the `silhouettesVersion` monotonic
// render-phase ref + the `silhouettesById` memo out of MapCanvas.tsx. The
// invariants under test are EXACTLY the ones the inline code held:
//
//   1. `silhouettesById` is referentially STABLE keyed on `[silhouettes]`
//      (re-render with the SAME array reference returns the SAME Map). This is
//      load-bearing: instability re-registers the adaptive-grid reconciler →
//      bumps `cacheGeneration` → clears `leafCache` (the #872–875-adjacent
//      churn the memo exists to prevent).
//   2. `commonName: string | null` is carried through verbatim (PR #926,
//      #920 colloquial family names + screen-reader labels).
//   3. `silhouettesVersion` is a monotonic integer counter that bumps on a
//      silhouettes prop REFERENCE change. The inline code seeds
//      `prevSilhouettesRef` with the FIRST `silhouettes` value, so the FIRST
//      render does NOT bump (counter stays 0). A fresh same-length array with
//      swapped svgData bumps it (the case `silhouettes.length` as a proxy would
//      miss); a true same-reference render does NOT bump.

const SILHOUETTES: FamilySilhouette[] = [
  {
    familyCode: 'tyrannidae',
    color: '#c3772d',
    colorDark: '#C77A2E',
    svgData: 'M0 0L1 1Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Tyrant Flycatchers',
    creator: null,
  },
  {
    familyCode: 'trochilidae',
    color: '#9637ad',
    colorDark: '#9637ad',
    svgData: 'M2 2L3 3Z',
    svgUrl: null,
    source: 'placeholder',
    license: 'CC0',
    commonName: 'Hummingbirds',
    creator: null,
  },
  {
    familyCode: 'uncurated',
    color: '#888888',
    colorDark: '#888888',
    svgData: null,
    svgUrl: null,
    source: null,
    license: null,
    commonName: null,
    creator: null,
  },
];

describe('useSilhouetteCatalogue', () => {
  it('builds silhouettesById keyed by lowercased familyCode', () => {
    const { result } = renderHook(
      ({ silhouettes }) => useSilhouetteCatalogue(silhouettes),
      { initialProps: { silhouettes: SILHOUETTES } },
    );
    const map = result.current.silhouettesById;
    expect(map.get('tyrannidae')).toEqual({
      svgData: 'M0 0L1 1Z',
      color: '#c3772d',
      colorDark: '#C77A2E',
      commonName: 'Tyrant Flycatchers',
    });
    expect(map.get('trochilidae')?.svgData).toBe('M2 2L3 3Z');
    // familyCode is lowercased on insert; an upper-case lookup misses.
    expect(map.get('TYRANNIDAE')).toBeUndefined();
  });

  it('carries commonName (string | null) verbatim — #920/#926 load-bearing', () => {
    const { result } = renderHook(
      ({ silhouettes }) => useSilhouetteCatalogue(silhouettes),
      { initialProps: { silhouettes: SILHOUETTES } },
    );
    const map = result.current.silhouettesById;
    // Curated colloquial name preserved exactly.
    expect(map.get('tyrannidae')?.commonName).toBe('Tyrant Flycatchers');
    expect(map.get('trochilidae')?.commonName).toBe('Hummingbirds');
    // null preserved as null (NOT undefined) — the field is present-and-null
    // for unseeded/uncurated families; consumers fall back to prettyFamily().
    expect(map.get('uncurated')?.commonName).toBeNull();
    expect(map.get('uncurated')).toHaveProperty('commonName');
  });

  it('CRITICAL — silhouettesById is referentially STABLE keyed on [silhouettes]', () => {
    const { result, rerender } = renderHook(
      ({ silhouettes }) => useSilhouetteCatalogue(silhouettes),
      { initialProps: { silhouettes: SILHOUETTES } },
    );
    const first = result.current.silhouettesById;
    // Re-render with the SAME array reference — the memo must NOT recompute.
    // Instability here would re-register the reconciler, bump cacheGeneration,
    // and clear leafCache (the churn the memo exists to prevent).
    rerender({ silhouettes: SILHOUETTES });
    expect(result.current.silhouettesById).toBe(first);

    // A new array identity (even with identical contents) DOES recompute —
    // that's the correct memo behavior on a [silhouettes]-keyed dep.
    const cloned: FamilySilhouette[] = SILHOUETTES.map((s) => ({ ...s }));
    rerender({ silhouettes: cloned });
    expect(result.current.silhouettesById).not.toBe(first);
  });

  it('silhouettesVersion does NOT bump on the first render or on a same-reference re-render', () => {
    const { result, rerender } = renderHook(
      ({ silhouettes }) => useSilhouetteCatalogue(silhouettes),
      { initialProps: { silhouettes: SILHOUETTES } },
    );
    // The inline ref seeds prevSilhouettesRef with the FIRST prop, so the
    // initial compare is equal — the counter stays 0 on first render.
    expect(result.current.silhouettesVersion).toBe(0);

    // Same reference: NO bump.
    rerender({ silhouettes: SILHOUETTES });
    expect(result.current.silhouettesVersion).toBe(0);
  });

  it('silhouettesVersion bumps on a fresh same-length array with swapped svgData (not on length)', () => {
    const { result, rerender } = renderHook(
      ({ silhouettes }) => useSilhouetteCatalogue(silhouettes),
      { initialProps: { silhouettes: SILHOUETTES } },
    );
    const v0 = result.current.silhouettesVersion;
    expect(v0).toBe(0);

    // Fresh array, SAME length, swapped svgData (a Phylopic refresh /
    // low-res→hi-res swap). The trigger is array IDENTITY, not length — this
    // is the exact case `silhouettes.length` as a proxy would miss.
    const swapped: FamilySilhouette[] = SILHOUETTES.map((s) => ({
      ...s,
      svgData: s.svgData === null ? null : `${s.svgData} `,
    }));
    expect(swapped.length).toBe(SILHOUETTES.length);
    rerender({ silhouettes: swapped });
    expect(result.current.silhouettesVersion).toBe(1);

    // Same reference again: NO further bump.
    rerender({ silhouettes: swapped });
    expect(result.current.silhouettesVersion).toBe(1);

    // Another fresh array → another bump (monotonic).
    rerender({ silhouettes: SILHOUETTES.map((s) => ({ ...s })) });
    expect(result.current.silhouettesVersion).toBe(2);
  });
});
