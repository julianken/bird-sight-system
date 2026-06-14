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

/**
 * Domain-agnosticism guard for the trace renderers (T7 / epic #1193 §8).
 *
 * eleatic renders a GENERIC span tree from an opaque `trace` blob. A span's
 * `name` ('judge', a scorer name, …) flowing through trace_json is DATA — fine
 * and expected. The coupling risk is a RENDERER hardcoding that vocabulary,
 * e.g. `if (span.name === 'judge')` or an `iconByKind` that keys off a scorer
 * name. A quoted-string scan of the trace UI source catches exactly that: a
 * hardcoded photo-judge literal lands in source as a quoted token, while the
 * same word arriving as runtime data does not.
 *
 * Why a QUOTED-string scan and why 'eval'/'task' are DELIBERATELY EXCLUDED:
 * 'eval' and 'task' collide with the package's own identifiers and prose —
 * EvalSpan/EvalRowRecord/evalGate, the synthesized legacy-root `kind: 'eval'`
 * (trace-tree.js), and "eleatic invents no eval domain" comments (trace.js:3,
 * trace-view.js). A `\beval\b`/`\btask\b` scan would false-positive and fail
 * this guard the moment it landed. The quoted scorer/judge terms below are
 * high-signal and collision-free against the package's own vocabulary.
 *
 * If this block ever fails: DO NOT weaken the regex to make it pass. A match
 * means a renderer hardcoded a photo-judge literal — a real coupling bug to
 * fix (rename to a generic token, or read the value as data), not to silence.
 */
const TRACE_UI_FILES = [
  'trace.js',
  'trace-tree.js',
  'trace-view.js',
  'trace-view-page.js',
  'trace-format.js',
];

// Quoted-string form, high-signal + collision-free. 'eval'/'task' are EXCLUDED
// (see block comment) — they collide with EvalSpan/evalGate and the legacy-root
// `kind: 'eval'` and would false-positive. Verified to BITE: temporarily
// injecting `if (span.name === 'judge')` into a renderer turns this assertion
// red (then reverted — never committed).
const PHOTO_JUDGE_LITERAL =
  /['"`](judge|scorer|species|rubric|keep_agreement|score_mae|keep_confusion|criteria_mae|falseKeep|falseReplace)/;

describe('trace renderer stays domain-agnostic', () => {
  it.each(TRACE_UI_FILES)('ui/%s hardcodes no photo-judge quoted literal', (name) => {
    const src = readFileSync(join(PKG_ROOT, 'ui', name), 'utf8');
    const match = PHOTO_JUDGE_LITERAL.exec(src);
    // On failure, surface the offending file + matched token so the coupling
    // bug is locatable (escalate it; do not loosen the scan to pass).
    expect(match, `ui/${name} contains a forbidden photo-judge literal: ${match?.[0]}`).toBeNull();
  });
});
