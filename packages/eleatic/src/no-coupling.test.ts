import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zero-coupling guard: eleatic must contain NO `@bird-watch/*` import and no
 * `../../`-escaping relative import anywhere under {src,ui}. That one-way
 * boundary (tools/photo-curation -> eleatic, never the reverse, and no monorepo
 * imports) is what lets the package `git mv` cleanly to its own repo later.
 *
 * Minimal by design — E9 owns the full CI step + abstraction-readiness checklist.
 * The single `extends "../../tsconfig.base.json"` line is the only sanctioned
 * file-system coupling and lives in tsconfig.json (a JSON config, not scanned
 * here); E9 tracks inlining it on extraction.
 */

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIRS = ['src', 'ui'];
const SCAN_EXT = /\.(ts|js|html)$/;

function collectFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // dir may not exist yet (ui/ holds only .gitkeep today)
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full));
    } else if (SCAN_EXT.test(name)) {
      out.push(full);
    }
  }
  return out;
}

// import / require / export-from lines that name a module specifier.
const BIRD_WATCH = /(?:import|export|require)\b[^;\n]*['"]@bird-watch\/[^'"]+['"]/;
const ESCAPING_RELATIVE = /(?:import|export|require)\b[^;\n]*['"]\.\.\/\.\.\/[^'"]*['"]/;

describe('zero-coupling guard', () => {
  const files = SCAN_DIRS.flatMap((d) => collectFiles(join(PKG_ROOT, d)));

  it('scans at least the source files (sanity: the scan is not silently empty)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('no source file imports a @bird-watch/* package', () => {
    const offenders = files.filter((f) => BIRD_WATCH.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('no source file uses a ../../-escaping relative import', () => {
    const offenders = files.filter((f) => ESCAPING_RELATIVE.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
