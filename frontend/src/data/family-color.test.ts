import { describe, it, expect } from 'vitest';
import { buildFamilyColorResolver, buildFamilyPathResolver, FAMILY_COLOR_FALLBACK } from './family-color.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';

const TYRANNIDAE_PATH = 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z';
const TROCHILIDAE_PATH = 'M3 13 L8 11 L13 12 L18 9 L22 11 L18 13 L13 14 L8 14 L3 15 Z';

const sampleSilhouettes: FamilySilhouette[] = [
  { familyCode: 'tyrannidae',   color: '#C77A2E', colorDark: '#C77A2E', svgData: TYRANNIDAE_PATH, svgUrl: null, source: 'placeholder', license: 'CC0', commonName: null, creator: null },
  { familyCode: 'trochilidae',  color: '#7B2D8E', colorDark: '#7B2D8E', svgData: TROCHILIDAE_PATH, svgUrl: null, source: 'placeholder', license: 'CC0', commonName: null, creator: null },
  { familyCode: 'picidae',      color: '#FF0808', colorDark: '#FF0808', svgData: null, svgUrl: null, source: null, license: null, commonName: null, creator: null },
];

describe('buildFamilyColorResolver', () => {
  it('returns the DB-seeded color for a known family', () => {
    const color = buildFamilyColorResolver(sampleSilhouettes);
    expect(color('tyrannidae')).toBe('#C77A2E');
    expect(color('trochilidae')).toBe('#7B2D8E');
  });

  it('matches family codes case-insensitively', () => {
    const color = buildFamilyColorResolver(sampleSilhouettes);
    expect(color('TYRANNIDAE')).toBe('#C77A2E');
    expect(color('Trochilidae')).toBe('#7B2D8E');
  });

  it('returns the neutral fallback for an unknown family', () => {
    const color = buildFamilyColorResolver(sampleSilhouettes);
    // jsdom resolves CSS custom properties to an empty string (no
    // stylesheet), so the resolver falls through to the literal.
    expect(color('not-a-family')).toBe(FAMILY_COLOR_FALLBACK);
  });

  it('returns the fallback when the familyCode is null or undefined', () => {
    const color = buildFamilyColorResolver(sampleSilhouettes);
    expect(color(null)).toBe(FAMILY_COLOR_FALLBACK);
    expect(color(undefined)).toBe(FAMILY_COLOR_FALLBACK);
  });

  it('returns the fallback for every lookup when the silhouettes array is empty (pre-resolve state)', () => {
    const color = buildFamilyColorResolver([]);
    expect(color('tyrannidae')).toBe(FAMILY_COLOR_FALLBACK);
    expect(color(null)).toBe(FAMILY_COLOR_FALLBACK);
  });

  it('never returns an empty string — critical for badge rendering which would otherwise go transparent', () => {
    const color = buildFamilyColorResolver([]);
    const out = color('nope');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('transparent');
  });
});

describe('buildFamilyPathResolver', () => {
  it('returns the DB svgData path string for a family with a non-null svgData', () => {
    const path = buildFamilyPathResolver(sampleSilhouettes);
    expect(path('tyrannidae')).toBe(TYRANNIDAE_PATH);
    expect(path('trochilidae')).toBe(TROCHILIDAE_PATH);
  });

  it('matches family codes case-insensitively', () => {
    const path = buildFamilyPathResolver(sampleSilhouettes);
    expect(path('TYRANNIDAE')).toBe(TYRANNIDAE_PATH);
    expect(path('Trochilidae')).toBe(TROCHILIDAE_PATH);
  });

  it('returns null for a family whose svgData is null (Phylopic-less policy)', () => {
    // picidae row has svgData: null — resolver must return null so caller
    // falls back to the abstract FAMILY_PATHS palette, not an empty string.
    const path = buildFamilyPathResolver(sampleSilhouettes);
    expect(path('picidae')).toBeNull();
  });

  it('returns null for an unknown family code (not in silhouettes)', () => {
    const path = buildFamilyPathResolver(sampleSilhouettes);
    expect(path('not-a-family')).toBeNull();
  });

  it('returns null when familyCode is null or undefined', () => {
    const path = buildFamilyPathResolver(sampleSilhouettes);
    expect(path(null)).toBeNull();
    expect(path(undefined)).toBeNull();
  });

  it('returns null for every lookup when the silhouettes array is empty (pre-resolve state)', () => {
    const path = buildFamilyPathResolver([]);
    expect(path('tyrannidae')).toBeNull();
    expect(path(null)).toBeNull();
  });

  it('never throws — callers rely on null as the stable fallback signal', () => {
    const path = buildFamilyPathResolver([]);
    expect(() => path('anything')).not.toThrow();
    expect(() => path(null)).not.toThrow();
  });
});
