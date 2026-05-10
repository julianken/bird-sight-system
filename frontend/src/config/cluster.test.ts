import { describe, it, expect } from 'vitest';
import { clusterTier, CLUSTER_TIER_BOUNDARIES } from './cluster.js';

describe('CLUSTER_TIER_BOUNDARIES', () => {
  it('exports sand = 100', () => {
    expect(CLUSTER_TIER_BOUNDARIES.sand).toBe(100);
  });

  it('exports ember = 750', () => {
    expect(CLUSTER_TIER_BOUNDARIES.ember).toBe(750);
  });
});

describe('clusterTier()', () => {
  it('returns sky for count = 1', () => {
    expect(clusterTier(1)).toBe('sky');
  });

  it('returns sky for count = 99 (one below sand boundary)', () => {
    expect(clusterTier(99)).toBe('sky');
  });

  it('returns sand for count = 100 (at sand boundary)', () => {
    expect(clusterTier(100)).toBe('sand');
  });

  it('returns sand for count = 749 (one below ember boundary)', () => {
    expect(clusterTier(749)).toBe('sand');
  });

  it('returns ember for count = 750 (at ember boundary)', () => {
    expect(clusterTier(750)).toBe('ember');
  });

  it('returns ember for count = 10000 (well above ember boundary)', () => {
    expect(clusterTier(10000)).toBe('ember');
  });

  it('returns sky for count = 0 (empty cluster edge case)', () => {
    expect(clusterTier(0)).toBe('sky');
  });
});
