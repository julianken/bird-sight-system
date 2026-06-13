# `eleatic`

A domain-agnostic, local eval-results explorer: cross-run comparison, per-row
diff, judgment drill-down, faceted filter/sort, metric trends, and human
adjudication — over a generic three-table SQLite store, with no knowledge of any
particular eval domain.

It has two halves: a tiny TypeScript write/read library (`openStore` +
`makeReader`) that any eval runner records into, and a framework-free browser
explorer served by the `eleatic serve` bin. The first consumer is bird-maps'
photo-judge eval (`tools/photo-curation`), but the package depends on nothing in
this monorepo — that one-way boundary (`tools/photo-curation` → `eleatic`, never
the reverse) is enforced by `src/no-coupling.test.ts` and is what lets the
package `git mv` to its own repo later. See **Abstraction-readiness checklist**.

Runtime dependencies: `better-sqlite3`, `express`, `commander`. No
`@bird-watch/*` dependency in any group (guard-enforced).

## Usage

Record an eval run from any runner, then explore it:

```ts
import { openStore } from '@bird-watch/eleatic';

const store = openStore('eval.sqlite'); // ':memory:' default in tests

// 1. Write the run header before any row (eval_row FKs eval_run).
store.recordRun({ id: runId, label, baseline, config, startedAt });

// 2. One row per evaluated item — output/expected/scores/metadata are JSON-or-NULL.
for (const item of items) {
  store.recordRow({ runId, rowKey, label, imageUrl, contentHash, output, expected, scores, metadata });
}

// 3. Patch the run's aggregates once they're computed (the runner computes them late).
store.finalizeRun(runId, { rowCount, metrics });
store.close();
```

```sh
# Boot the explorer over a store (defaults: --port 8788).
npx eleatic serve --db eval.sqlite --port 8788
# Optional: --config <path> to an eleatic config JSON (metric registry, gates).
```

Human adjudication (`store.recordAdjudication({ rowKey, verdict, … })`) upserts a
verdict keyed on the item; the explorer round-trips it through the UI.

## Build / test

```sh
npm run build --workspace @bird-watch/eleatic   # tsc → dist/, then copies ui/ → dist/ui/
npm run test  --workspace @bird-watch/eleatic   # vitest (incl. the zero-coupling guard)
```

`tsc` only emits from `rootDir: src`; the `build` script appends a portable
`cpSync('ui','dist/ui')` so `eleatic serve` can serve the explorer's static
assets from the published package (`build-output.test.ts` asserts the copy ran).

## Abstraction-readiness checklist

`eleatic` is built to leave the monorepo whole. When the extraction is triggered
(a Julian-initiated `git mv packages/eleatic → its own repo`), this is the
cold-start brief — **not executed now**:

1. **Inline the tsconfig base.** `tsconfig.json` is the only sanctioned
   file-system coupling: it `extends "../../tsconfig.base.json"`. Replace that
   line with the resolved `compilerOptions` inline:

   ```jsonc
   {
     "compilerOptions": {
       "target": "ES2022",
       "module": "ES2022",
       "moduleResolution": "Bundler",
       "esModuleInterop": true,
       "skipLibCheck": true,
       "strict": true,
       "noUncheckedIndexedAccess": true,
       "exactOptionalPropertyTypes": true,
       "noImplicitOverride": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "resolveJsonModule": true,
       "lib": ["ES2022"],
       "rootDir": "src",
       "outDir": "dist"
     },
     "include": ["src/**/*.ts"],
     "exclude": ["src/**/*.test.ts"]
   }
   ```

   (`rootDir`/`outDir` already live in the local `compilerOptions`; the rest are
   the inherited base, copied verbatim.)
2. **Rename the package.** `@bird-watch/eleatic` → the published name; drop
   `"private": true` and set a real `version`.
3. **Repoint the consumer.** `tools/photo-curation/package.json` depends on
   `"@bird-watch/eleatic": "*"` (workspace glob). Change it to the
   versioned/published dep (`"eleatic": "^x.y.z"` under its new name), and update
   the imports in `tools/photo-curation/src/eval/eleatic-adapter.ts`.
4. **Drop the monorepo knip entry.** Remove the `'packages/eleatic'` block from
   the root `knip.ts` (the `ui/*.js` runtime-resolved-specifier ignores travel
   into the new repo's own knip config).
5. **The guard travels with the package.** `src/no-coupling.test.ts` is
   self-contained (pure `node:fs`, scans `{src,ui}` + `package.json`) — it ships
   unchanged and keeps the one-way boundary honest in the new repo too.

## End-to-end verification

A run-once recipe that exercises the whole eleatic surface against a real
photo-judge eval. Needs a prod `DATABASE_URL` (read-only suffices), a
`GEMINI_API_KEY`, and a thumbnail cache — run by a maintainer, not in CI. Env
var names match `tools/photo-curation/scripts/run-eval-local.ts` and
`analyze-experiment.ts`; reconcile against those scripts if a knob moves.

```sh
# 1. Build the package and assert the explorer's static assets were copied.
npm ci
npm run build -w @bird-watch/eleatic
test -f packages/eleatic/dist/ui/index.html   # build copied ui/ → dist/ui/

# 2. Run a photo-judge eval that writes the eleatic store (eval.sqlite).
#    REVIEW_DB  — the local review.sqlite (dataset source: photo_current/photo_score)
#    THUMB_DIR  — the local thumbnail cache the judge reads images from
#    DATABASE_URL — prod, read-only (the frozen Opus baseline)
#    GEMINI_API_KEY — the judge under test
#    EVAL_DB    — the eleatic store this run writes (the analyzer reads it back)
#    --first N  — optional smoke cap (e.g. --first 5) for a fast pass
REVIEW_DB=tools/photo-curation/review.sqlite \
THUMB_DIR=tools/photo-curation/thumbs \
EVAL_DB=tools/photo-curation/eval.sqlite \
DATABASE_URL=postgres://… \
GEMINI_API_KEY=… \
npm run eval -w @bird-watch/photo-curation -- --first 5
#    → prints `eval run <run-id> (<n> rows) written to tools/photo-curation/eval.sqlite`

# 3. Open the explorer over that store and walk every surface.
npx eleatic serve --db tools/photo-curation/eval.sqlite --port 8788
#    In the browser at http://localhost:8788 verify, with zero console errors:
#      • the hub lists the run(s) with their metrics
#      • a cross-run diff (pick two runs, inspect the per-row diff)
#      • a facet gallery (filter/sort by a facet, e.g. keep-disagreements)
#      • a per-row judgment drill-down (output vs expected, criteria, tokens/cost)
#      • a human-adjudication round-trip (record a verdict, reload, confirm it persisted)

# 4. Re-derive the dataset-level diagnostics from the same eleatic store.
#    EVAL_DB points the analyzer at the store step 2 wrote (defaults ./eval.sqlite);
#    the run-id is the first positional, `--band lo:hi` optional (default 40:70).
EVAL_DB=tools/photo-curation/eval.sqlite \
npm run analyze -w @bird-watch/photo-curation -- <run-id>
```
