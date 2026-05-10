import { describe, it, expect } from 'vitest';
import { REGION_LABEL } from './region.js';

describe('REGION_LABEL', () => {
  it('is the string "Arizona"', () => {
    expect(REGION_LABEL).toBe('Arizona');
  });

  it('is a non-empty string', () => {
    expect(typeof REGION_LABEL).toBe('string');
    expect(REGION_LABEL.length).toBeGreaterThan(0);
  });
});
