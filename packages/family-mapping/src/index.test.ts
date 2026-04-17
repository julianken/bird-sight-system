import { describe, it, expect } from 'vitest';
import { silhouetteForFamily, colorForFamily, FALLBACK_FAMILY } from './index.js';

describe('silhouetteForFamily', () => {
  it('returns the correct silhouette id for a known family', () => {
    expect(silhouetteForFamily('trochilidae')).toBe('trochilidae');
  });

  it('returns the fallback for an unknown family', () => {
    expect(silhouetteForFamily('non-existent-family')).toBe(FALLBACK_FAMILY);
  });
});

describe('colorForFamily', () => {
  it('returns a valid hex color for a known family', () => {
    expect(colorForFamily('accipitridae')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('returns a fallback color for an unknown family', () => {
    expect(colorForFamily('non-existent-family')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
