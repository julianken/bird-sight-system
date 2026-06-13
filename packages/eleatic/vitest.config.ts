import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    // src/ holds the store/queries/server/CLI suites; ui/ holds the
    // framework-free explorer's pure-node unit suites (safe.js escaping +
    // allowlist, the metric-formatter registry, the gate evaluator, and the
    // inline-SVG point-mapper). ui/*.ts is excluded from tsconfig (tsc copies
    // ui/ verbatim, never compiles it), so these run under vitest only.
    include: ['src/**/*.test.ts', 'ui/**/*.test.ts'],
  },
});
