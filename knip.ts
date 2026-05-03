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

    // 2026-04-28: tsx is used by services/{read-api,ingestor}/package.json scripts
    //             ("dev"/"ingest:local") that invoke `tsx src/...`. Knip can't trace
    //             npm-script bin invocations. NOT a knip dependency — keep this
    //             ignore until those scripts migrate to a different runner
    //             (e.g., bun, ts-node, native node --import).
    'tsx',
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
      ignore: ['src/tokens.ts'],
    },

    'services/read-api': {},
    'services/ingestor': {},
    'packages/db-client': {},
    'packages/shared-types': {},
  },
};

export default config;
