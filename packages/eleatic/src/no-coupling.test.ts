import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zero-coupling guard: eleatic must contain NO `@bird-watch/*` import and no
 * `../../`-escaping relative import anywhere under {src,ui}, and its
 * package.json must declare NO `@bird-watch/*` dependency. That one-way
 * boundary (tools/photo-curation -> eleatic, never the reverse, and no monorepo
 * imports) is what lets the package `git mv` cleanly to its own repo later.
 *
 * E9 (#1152) extends the original E1 guard to also assert the package.json
 * dependency surface (manifest coupling, not just source-level imports) and
 * pins the recursive scan to `readdirSync` (the `recursive` option needs
 * Node >= 18.17/20 — satisfied by the repo `engines.node` >= 20). The single
 * `extends "../../tsconfig.base.json"` line is the only sanctioned file-system
 * coupling and lives in tsconfig.json (a JSON config, not scanned here); the
 * README's abstraction-readiness checklist tracks inlining it on extraction.
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

  it('package.json declares no @bird-watch/* dependency in any dep group', () => {
    // Manifest-level coupling is invisible to the source scan above: a
    // `@bird-watch/*` entry in dependencies/devDependencies/peer/optional would
    // tie the package to the monorepo even with zero import statements. Scan
    // every dependency group so the package stays publishable standalone.
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    const DEP_GROUPS = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ];
    const offenders = DEP_GROUPS.flatMap((group) => {
      const deps = pkg[group];
      if (deps === null || typeof deps !== 'object') return [];
      return Object.keys(deps as Record<string, unknown>)
        .filter((name) => name.startsWith('@bird-watch/'))
        .map((name) => `${group}.${name}`);
    });
    expect(offenders).toEqual([]);
  });
});
