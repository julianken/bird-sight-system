/**
 * Plan 6 — Release 1 exit-criteria grep assertions.
 *
 * The Plan 6 analysis surfaced five "latent fields" — fields that the Read API
 * already returns but the UI was historically ignoring. Waves 0/1/2 closed
 * that gap; this test is the machine-checkable guard that no future refactor
 * silently drops them again.
 *
 * Each assertion counts production (non-test) matches for one latent-field
 * pattern across `frontend/src/`. A count of zero means the field has gone
 * unused — which is exactly the regression Plan 6 was written to prevent.
 *
 * Node `fs` + regex is used instead of shelling to `rg` so the test runs
 * identically on any CI image that can execute Vitest, without assuming a
 * ripgrep binary is installed.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

// Vitest runs with cwd = `frontend/`. Resolving to `frontend/src/` this way
// keeps the test decoupled from how Vite or Node encodes `import.meta.url`
// under jsdom (it is not always a `file://` URL, so `fileURLToPath` fails).
const SRC_DIR = resolve(process.cwd(), 'src');

/**
 * Recursively collect every `.ts` / `.tsx` file under `dir`, excluding any
 * file whose basename matches `*.test.ts` / `*.test.tsx`. Mirrors the
 * `-g '!*.test.*'` filter used by the Plan 6 `rg` commands.
 */
function collectProductionFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...collectProductionFiles(full));
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry)) continue;
    if (/\.test\.(ts|tsx)$/.test(entry)) continue;
    // Exclude this file itself — the patterns appear in its own string
    // literals, which would produce self-referential matches.
    if (full.endsWith('release-1-assertions.test.ts')) continue;
    out.push(full);
  }
  return out;
}

const PRODUCTION_FILES = collectProductionFiles(SRC_DIR);

/**
 * Return the list of production files (relative paths) whose contents match
 * `pattern` at least once. Used to produce informative failure messages:
 * when a pattern reports 0 matches, the empty array shows up in the diff.
 */
function filesMatching(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of PRODUCTION_FILES) {
    const content = readFileSync(file, 'utf8');
    if (pattern.test(content)) {
      hits.push(relative(SRC_DIR, file));
    }
  }
  return hits;
}

describe('Release 1 exit criteria — latent-field usage', () => {
  // The five patterns below are transcribed from Plan 6 Task 10 Step 5. The
  // literal `ripgrep` patterns were:
  //   1. observation\.obsDt|o\.obsDt|obs\.obsDt
  //   2. \.lat[^a-zA-Z]|\.lng[^a-zA-Z]
  //   3. locName|howMany
  //   4. isNotable
  //   5. taxonOrder|familyCode
  // JS regex literals share rg's PCRE-ish syntax for these patterns, so no
  // escaping translation is needed beyond switching backslashes to JS form.

  it('1. observation.obsDt / o.obsDt / obs.obsDt is read in production code', () => {
    const hits = filesMatching(/observation\.obsDt|o\.obsDt|obs\.obsDt/);
    expect(hits, 'expected at least one non-test file to read obsDt').not.toEqual([]);
  });

  it('2. .lat / .lng coordinate fields are read in production code', () => {
    const hits = filesMatching(/\.lat[^a-zA-Z]|\.lng[^a-zA-Z]/);
    expect(hits, 'expected at least one non-test file to read .lat/.lng').not.toEqual([]);
  });

  it('3. locName / howMany are read in production code', () => {
    const hits = filesMatching(/locName|howMany/);
    expect(hits, 'expected at least one non-test file to read locName/howMany').not.toEqual([]);
  });

  it('4. isNotable is read in production code', () => {
    const hits = filesMatching(/isNotable/);
    expect(hits, 'expected at least one non-test file to read isNotable').not.toEqual([]);
  });

  it('5. taxonOrder / familyCode are read in production code', () => {
    const hits = filesMatching(/taxonOrder|familyCode/);
    expect(hits, 'expected at least one non-test file to read taxonOrder/familyCode').not.toEqual([]);
  });
});
