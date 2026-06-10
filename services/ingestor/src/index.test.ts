import { describe, it, expect } from 'vitest';
// Import from the package barrel — the same surface Slices 4 & 5 consume as
// `@bird-watch/ingestor`. If candidates.ts is not re-exported here, this import
// is undefined and the test fails.
import { fetchInatCandidates, type DenyContext, type InatCandidate } from './index.js';

describe('@bird-watch/ingestor barrel — candidate sourcer surface', () => {
  it('re-exports fetchInatCandidates as a callable', () => {
    expect(typeof fetchInatCandidates).toBe('function');
  });

  it('re-exports the DenyContext / InatCandidate types (compile-time lock)', () => {
    // Type-only assertions: these object literals must satisfy the re-exported
    // type names, or `tsc` (npm run build) fails. No runtime behavior.
    const deny: DenyContext = { reason: 'all on a feeder', tags: ['captive-feeder'] };
    const cand: InatCandidate = {
      inatId: 1,
      photoUrl: 'https://ex.org/photos/1/medium.jpg',
      attribution: '(c) A, CC0',
      license: 'cc0',
    };
    expect(deny.tags).toContain('captive-feeder');
    expect(cand.inatId).toBe(1);
  });
});
