import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build-output contract: `tsc` compiles src/ -> dist/ but does NOT copy ui/
 * (it only emits from rootDir). The package `build` script therefore appends a
 * portable `cpSync('ui','dist/ui',...)` so `eleatic serve` (E4) can serve static
 * assets from the published package. This test asserts that copy ran.
 *
 * It is deliberately gated on dist/ presence: dist/ is gitignored and does not
 * exist on a fresh checkout, so the CI `test` job (which runs before `build`)
 * would otherwise flake. When dist/ exists (post-build, locally or in the build
 * job), the copied marker MUST be there — proving tsc-alone did not silence the
 * copy step. When dist/ is absent the test documents the contract and no-ops.
 */

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

describe('build output', () => {
  it('copies ui/ -> dist/ui/ during build (tsc alone would not)', () => {
    if (!existsSync(DIST)) {
      // Pre-build (e.g. the CI `test` job): nothing to assert yet.
      return;
    }
    // ui/ currently holds only .gitkeep (real assets land in E5/E6). Either the
    // placeholder or a future index.html proves the copy step ran.
    const copied =
      existsSync(join(DIST, 'ui', '.gitkeep')) || existsSync(join(DIST, 'ui', 'index.html'));
    expect(copied).toBe(true);
  });
});
