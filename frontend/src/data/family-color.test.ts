import { describe, it, expect } from 'vitest';
import { buildFamilyColorResolver, FAMILY_COLOR_FALLBACK } from './family-color.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';

const sampleSilhouettes: FamilySilhouette[] = [
  { familyCode: 'tyrannidae',   color: '#C77A2E', svgData: null, source: null, license: null, commonName: null, creator: null },
  { familyCode: 'trochilidae',  color: '#7B2D8E', svgData: null, source: null, license: null, commonName: null, creator: null },
  { familyCode: 'picidae',      color: '#FF0808', svgData: null, source: null, license: null, commonName: null, creator: null },
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
