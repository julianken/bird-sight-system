import type { KnipConfig } from 'knip';

/**
 * Knip configuration — calibrated ignore rules.
 *
 * Maintenance contract: every ignore rule carries a dated comment naming
 * (a) what it silences and (b) what class of finding it risks missing.
 * Quarterly re-audit: next at 2026-07-27.  Remove any rule whose comment
 * is older than 90 days unless explicitly re-justified at that time.
 */
const config: KnipConfig = {
  ignore: [
    // 2026-04-27: Plan-7 prototype canned demo — not imported by any workspace,
    //             not in any build pipeline. Intentionally one-shot; silences 4
    //             unused files in docs/plans/2026-04-22-map-v1-prototype/prototype/.
    //             Risk: masks genuinely orphaned files added to that directory later
    //             — re-audit if new files appear under docs/plans/.
    'docs/plans/2026-04-22-map-v1-prototype/prototype/**',

    // 2026-05-28: state-scope C0 render prototype — a standalone Vite entry
    //             (its own index.html + vite.config.ts; root: __dirname) that
    //             validates the chooser-first scoped-map render at production
    //             volume for plan 2026-05-28-state-scope-selector. Not imported
    //             by any workspace and not in the frontend build (frontend
    //             tsconfig.json `include` is ["src"]; tsc -b + vite build ignore
    //             prototypes/). Same one-shot profile as the 2026-04-22 map-v1
    //             prototype above.
    //             Risk: masks genuinely orphaned files added under this dir
    //             later — re-audit 2026-07-27 by confirming the directory is
    //             still a standalone prototype (own index.html) and not wired
    //             into frontend/src/.
    'frontend/prototypes/scope-prototype/**',

    // 2026-05-02: photo-server worker is loaded by Terraform (infra/terraform/
    //             photos.tf:38 `file("${path.module}/../workers/photo-server.js")`)
    //             which knip's static analysis cannot trace. The worker is live in
    //             production fronting the birdwatch-photos R2 bucket.
    //             Risk: masks a genuine orphan if the Terraform reference is ever
    //             removed without also deleting the .js file — re-audit at the
    //             next quarterly review (2026-07-27) by spot-checking that
    //             `grep -rn photo-server.js infra/terraform/` still returns hits.
    'infra/workers/photo-server.js',
    'infra/workers/photo-server.test.js',

    // 2026-05-02: shared-types index.test.ts is a compile-time-only "type
    //             laboratory" run via `tsc -p tsconfig.test.json` (see the file's
    //             own header comment). It has no runtime test runner, so knip
    //             classifies it as orphaned. The package's test gate explicitly
    //             compiles it; removing the file would silently weaken the gate.
    //             Risk: masks a genuine orphan if the package's test config ever
    //             stops compiling this path. Re-audit by confirming
    //             `packages/shared-types/package.json` "test" script still
    //             references the test tsconfig.
    'packages/shared-types/src/index.test.ts',

    // 2026-05-13: silhouette-server worker (#502) is loaded by Terraform
    //             (infra/terraform/silhouettes.tf
    //             `file("${path.module}/../workers/silhouette-server.js")`)
    //             which knip's static analysis cannot trace. Mirrors the
    //             photo-server worker ignore above.
    //             Risk: masks a genuine orphan if the Terraform reference is
    //             ever removed without also deleting the .js file — re-audit
    //             at the next quarterly review (2026-07-27) by spot-checking
    //             that `grep -rn silhouette-server.js infra/terraform/` still
    //             returns hits.
    'infra/workers/silhouette-server.js',
    'infra/workers/silhouette-server.test.js',

    // 2026-05-13: scripts/silhouette.test.mjs is the test sibling of
    //             scripts/silhouette.mjs (Task 11 of #502). It runs under
    //             `node --test` (no static test-runner config knip can trace);
    //             the test step is invoked via the root package.json's
    //             "test:scripts" script. Knip classifies it as orphaned.
    //             Risk: masks a genuine orphan if scripts/silhouette.mjs is
    //             ever deleted without also removing the test. Re-audit
    //             2026-07-27 by confirming scripts/silhouette.mjs still exists
    //             and its test is invoked by an npm script.
    'scripts/silhouette.test.mjs',

    // 2026-05-18: scripts/curate-phylopic.test.mjs is the test sibling of
    //             scripts/curate-phylopic.mjs (the --national-coverage mode
    //             added for Phase 3a). Same orphan profile as
    //             silhouette.test.mjs — no static test-runner config picks
    //             it up; it's operator-run via `vitest run` from the repo
    //             root when validating mode='national' emit-output changes.
    //             Risk: masks a genuine orphan if scripts/curate-phylopic.mjs
    //             is ever deleted without also removing the test. Re-audit
    //             2026-07-27 alongside silhouette.test.mjs.
    'scripts/curate-phylopic.test.mjs',

    // 2026-05-28: scripts/generate-state-boundaries.mjs is the run-once
    //             offline generator (Task A1, #728) that emits both
    //             migrations/1700000050000_state_boundaries.sql's INSERT block
    //             and data/us-state-polygons.geojson from the Census state
    //             shapefile. It is statically unreferenced by design — an
    //             operator runs it by hand when regenerating the boundaries
    //             (see scripts/README-state-boundaries.md). It depends on
    //             mapshaper, which is installed transiently with `npm install
    //             --no-save` (NOT a committed dependency), so knip would also
    //             flag mapshaper — the script is excluded entirely instead.
    //             Risk: masks a genuine orphan if the seed migration is ever
    //             regenerated differently or the script is abandoned. Re-audit
    //             2026-07-27 by confirming the seed migration's header still
    //             cites this script as the provenance of its INSERT rows.
    'scripts/generate-state-boundaries.mjs',

    // 2026-05-28: scripts/zip-etl/* (Task D2, #730) is the offline ZIP ETL —
    //             build-zip-index.ts reads the sha256-pinned ZCTA gazetteer
    //             (fetched by fetch-zcta-gazetteer.sh) and emits
    //             frontend/public/zip-index.json, with state precomputed by
    //             point-in-polygon (state-polygons.ts) against
    //             data/us-state-polygons.geojson. Like generate-state-
    //             boundaries.mjs it is a run-once operator tool, statically
    //             unreferenced by any workspace; the test is operator-run via
    //             `npx vitest run` (mirrors scripts/silhouette.test.mjs — no
    //             static test-runner config knip can trace).
    //             Risk: masks a genuine orphan if zip-index.json regeneration
    //             is abandoned. Re-audit 2026-07-27 by confirming
    //             scripts/zip-etl/SIZE-REPORT.md still documents the live
    //             frontend/public/zip-index.json and the frontend zip-lookup
    //             module (D3) still fetches it.
    'scripts/zip-etl/build-zip-index.ts',
    'scripts/zip-etl/build-zip-index.test.ts',
    'scripts/zip-etl/state-polygons.ts',
  ],

  // 2026-04-27: React component Props interfaces and other exports used only
  //             within the same file (e.g. prop types inferred by JSX) are not
  //             traceable by knip across JSX call sites.  This flag suppresses
  //             those false positives wholesale.
  //             Risk: masks genuinely orphaned exports that happen to be defined
  //             in the same file as their sole consumer — acceptable trade-off at
  //             current codebase size; revisit if the export count grows.
  ignoreExportsUsedInFile: true,

  ignoreDependencies: [
    // 2026-04-27: @testcontainers/postgresql — pulled at integration-test runtime
    //             via dynamic require from the vitest worker config, not via a
    //             static import knip can trace.
    //             Risk: masks a genuine unused-dep if the package is removed from
    //             integration tests without also removing the package.json entry.
    '@testcontainers/postgresql',

    // 2026-04-27: testcontainers — peer dependency of @testcontainers/postgresql;
    //             same dynamic-require reason; same risk profile.
    'testcontainers',

    // 2026-06-09: tsx ignore REMOVED. The root `db:seed` script
    //             (`tsx packages/db-client/src/dev-seed.ts`) now invokes tsx
    //             directly from the root package.json, so knip traces it as a
    //             used root devDependency. The prior 2026-04-28 ignore (added
    //             because only workspace scripts referenced tsx) is now
    //             redundant — knip emits a "Remove from ignoreDependencies"
    //             hint for it. Re-add only if `db:seed` stops using tsx AND no
    //             other root script does.

    // 2026-05-29: geojson — `import type { Feature, MultiPolygon, Polygon,
    //             Position } from 'geojson'` (#760/#762 state-artboard mask:
    //             frontend/src/components/map/mask.ts, MapCanvas.tsx,
    //             MapSurface.tsx, frontend/src/data/state-polygons.ts, and the
    //             co-located test files). The `geojson` MODULE declarations are
    //             provided by the @types/geojson package, which ships
    //             transitively (maplibre-gl depends on it) and is NOT a direct
    //             dependency. Knip sees the bare `from 'geojson'` import and
    //             reports an unlisted dependency; it is a type-only import
    //             resolved at compile time, never a runtime require (a
    //             transitive-types ignore, like the @testcontainers entries above).
    //             Risk: masks a genuine missing dep if a RUNTIME geojson import
    //             is ever added (there is none — these are all `import type`).
    //             Re-audit 2026-07-27 by confirming every `from 'geojson'` in
    //             frontend/src is still `import type`.
    'geojson',

    // 2026-05-28: @turf/boolean-point-in-polygon is used ONLY by the run-once
    //             ZIP ETL (scripts/zip-etl/state-polygons.ts, Task D2 #730),
    //             whose files are themselves knip-ignored above. Knip therefore
    //             reports the devDependency as unused. It is a genuine
    //             build-time dependency of the offline precompute.
    //             Risk: masks a genuine unused-dep if the ZIP ETL is deleted
    //             without also removing this entry. Re-audit 2026-07-27
    //             alongside the scripts/zip-etl/* ignore.
    '@turf/boolean-point-in-polygon',
  ],

  workspaces: {
    // Root workspace (monorepo plumbing scripts, not an npm package)
    '.': {},

    frontend: {
      // 2026-04-28: Design-token type aliases (IconSizeToken, ZIndexToken,
      //             OpacityToken, SpacingToken, DurationToken) in tokens.ts
      //             are declared as `export type X = keyof typeof <obj>` for
      //             future use as typed function-parameter constraints, but no
      //             consumer file imports them yet. Knip correctly flags them
      //             as unused exports; they are intentionally forward-declared.
      //             Ignoring the whole file is acceptable because tokens.ts is
      //             a leaf module with no call-site logic; only the 5 type
      //             aliases are flagged.
      //             Re-audit 2026-07-27: remove if those types gain import
      //             sites knip can trace, or drop the types if still unused.
      //
      // 2026-05-10: basemap-style.ts — basemapStyleLight and basemapStyleDark
      //             both alias the same OpenFreeMap positron URL string. Knip
      //             correctly detects the duplicate value and reports it as a
      //             "Duplicate exports" finding. The aliasing is INTENTIONAL
      //             and gated on G7/G8 (family-palette × dark-tile contrast):
      //             dark resolves to the light URL until the gate closes, at
      //             which point basemapStyleDark switches to the real dark URL
      //             and the duplicate goes away. Until then, both names are
      //             part of the public mechanism contract — the MapCanvas
      //             MutationObserver imports both names by their semantic role,
      //             so collapsing them would force a rename when G8 closes.
      //             Risk: masks a genuine duplicate export added later under
      //             this file. Re-audit 2026-07-27 by confirming both names
      //             are still consumed by MapCanvas.tsx OR the dark URL has
      //             diverged from the light one.
      ignore: [
        'src/tokens.ts',
        'src/components/map/basemap-style.ts',
        // 2026-05-10: ds/index.ts barrel export — Phase 2 ships the 6 ds/
        //             primitives but no surface mounts them yet (Phase 3–5).
        //             Knip correctly flags the barrel as unused; this is by
        //             design per the Phase 2 scope boundary documented in
        //             docs/design/02-phases/phase-2-primitives.md. The ignore
        //             should be removed when Phase 3 imports from this barrel,
        //             making the finding self-healing. Re-audit 2026-07-27
        //             (or when Phase 3 lands) by confirming at least one
        //             surface imports a named export from ds/index.ts.
        //             Risk: masks a genuine orphan added to ds/ later without
        //             a Phase 3+ consumer.
        'src/components/ds/index.ts',
        // 2026-05-10: dev/DsPreview.tsx — ignore removed 2026-05-13 after
        //             knip confirmed the dynamic import in main.tsx is now
        //             traceable (knip 6.11.0+). No longer needs silencing.
        // 2026-05-10: SurfaceNav.tsx — ignore removed 2026-05-13 after
        //             knip confirmed the _SurfaceNav import in App.tsx is
        //             now traceable. No longer needs silencing.
      ],
    },

    'services/read-api': {},
    'services/ingestor': {},
    'services/admin-api': {
      // 2026-05-13: @bird-watch/shared-types is pulled in by Dockerfile's
      //             `npm run build --workspace @bird-watch/shared-types`
      //             pre-build step (so admin-api's TypeScript can resolve
      //             types at runtime even though no admin-api source file
      //             currently imports from it). Knip can't trace
      //             Dockerfile-only references.
      //             Risk: masks a genuine unused-dep if shared-types stops
      //             being needed at build time without also removing the
      //             Dockerfile reference. Re-audit 2026-07-27.
      ignoreDependencies: ['@bird-watch/shared-types'],
    },
    'packages/db-client': {},
    'packages/geo': {},
    'packages/shared-types': {},
  },
};

export default config;
