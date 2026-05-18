import { describe, it, expect } from 'vitest';
import { REGION_LABEL, REGION_CODE } from './region.js';

describe('REGION_LABEL', () => {
  it('defaults to "Arizona" when VITE_REGION_CODE is unset (test env)', () => {
    // In the test env no VITE_REGION_CODE is set, so REGION_CODE falls back
    // to 'US-AZ' which maps to 'Arizona'. This guards the default deploy
    // behavior — AZ shipped builds must keep this label.
    expect(REGION_CODE).toBe('US-AZ');
    expect(REGION_LABEL).toBe('Arizona');
  });

  it('is a non-empty string', () => {
    expect(typeof REGION_LABEL).toBe('string');
    expect(REGION_LABEL.length).toBeGreaterThan(0);
  });
});
