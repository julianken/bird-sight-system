import { describe, it, expect } from 'vitest';
import { silhouetteForFamily, FALLBACK_FAMILY } from './index.js';

// Issue #55 option (a): `colorForFamily` + `FAMILY_TO_COLOR` were removed
// from this package. The DB-backed `/api/silhouettes` endpoint (Read API) is
// now the single source of truth for family → color. Parity between what the
// DB returns and what the old hardcoded map contained is asserted in
// `packages/db-client/src/silhouettes.test.ts` so a future palette change
// has to move through one place.

describe('silhouetteForFamily', () => {
  it('returns the correct silhouette id for a known family', () => {
    expect(silhouetteForFamily('trochilidae')).toBe('trochilidae');
  });

  it('returns the fallback for an unknown family', () => {
    expect(silhouetteForFamily('non-existent-family')).toBe(FALLBACK_FAMILY);
  });
});
