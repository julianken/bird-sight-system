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

    // 2026-04-27: tsx — used by knip itself as the TypeScript loader to execute
    //             knip.ts (this config file) at analysis time.  Knip loads tsx
    //             via dynamic require from its own internals, so no static import
    //             appears in project source.
    //             Risk: masks a genuine unused-dep if tsx is removed from
    //             devDependencies without also migrating this config to knip.json.
    'tsx',
  ],

  workspaces: {
    // Root workspace (monorepo plumbing scripts, not an npm package)
    '.': {},

    frontend: {},

    'services/read-api': {},
    'services/ingestor': {},
    'packages/db-client': {},
    'packages/shared-types': {},
  },
};

export default config;
