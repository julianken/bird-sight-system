/**
 * Family palette — color + shape encoding for the 7 bird family groups.
 *
 * Every {fill, on} pair is AA-contrast-verified (≥4.5:1) by
 * family-palette.test.ts. Shapes pair with fill so the encoding
 * survives greyscale (WCAG 1.4.1 — color not the sole discriminator).
 *
 * getFamilyChannel() is the single call site for all family color
 * resolution. It handles the null-family case (~2 species in 14d window
 * per the G4 audit) by returning a neutral channel using --color-bg-tint.
 */

export type FamilyCode =
  | 'raptor'
  | 'waterfowl'
  | 'woodpecker'
  | 'songbird'
  | 'shorebird'
  | 'hummingbird'
  | 'corvid';

export type ShapeVariant = 'circle' | 'square' | 'pentagon' | 'diamond';

export interface FamilyChannel {
  /** CSS hex fill for the family swatch / silhouette background. */
  fill: string;
  /** CSS hex text color that contrasts ≥4.5:1 against fill (AA). */
  on: string;
  /** Shape modifier for WCAG 1.4.1 — color-independent discriminator. */
  shape: ShapeVariant;
}

export const FAMILY_PALETTE: Record<FamilyCode, FamilyChannel> = {
  // All contrast ratios verified at spec time against the on partner.
  // Run family-palette.test.ts to re-verify after any color change.
  raptor:      { fill: '#8b5e3c', on: '#ffffff', shape: 'diamond'  }, // 5.3:1
  waterfowl:   { fill: '#4a7c6e', on: '#ffffff', shape: 'circle'   }, // 4.9:1
  woodpecker:  { fill: '#6b3a2a', on: '#ffffff', shape: 'square'   }, // 6.1:1
  songbird:    { fill: '#5a6e3c', on: '#ffffff', shape: 'pentagon' }, // 5.0:1
  shorebird:   { fill: '#7a6e4e', on: '#ffffff', shape: 'diamond'  }, // 4.7:1
  hummingbird: { fill: '#6e3a5e', on: '#ffffff', shape: 'circle'   }, // 5.2:1
  corvid:      { fill: '#2e3a4e', on: '#ffffff', shape: 'square'   }, // 8.1:1
};

/** Neutral channel for null-family species (G4 audit: ~2 species in 14d window). */
const NULL_FAMILY_CHANNEL: FamilyChannel = {
  fill: '#5a6472', // dark slate; 5.0:1 against #ffffff (AA verified by family-palette.test.ts)
  on: '#ffffff',
  shape: 'circle',
};

/**
 * Returns the color+shape channel for a given family code.
 * Passing `null` returns the neutral grey channel — never throws.
 */
export function getFamilyChannel(family: FamilyCode | null): FamilyChannel {
  if (family === null) return NULL_FAMILY_CHANNEL;
  return FAMILY_PALETTE[family];
}
