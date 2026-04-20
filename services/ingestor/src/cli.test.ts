import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCli, type CliDeps } from './cli.js';
import type { RunTaxonomySummary } from './run-taxonomy.js';
import type { RunSummary } from './run-ingest.js';

// Stubs for closePool/createPool — runCli should always close the pool even
// on run-level failure, so we assert closePool was called.
const POOL_SENTINEL = Symbol('pool') as unknown as import('@bird-watch/db-client').Pool;

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    createPool: vi.fn().mockReturnValue(POOL_SENTINEL),
    closePool: vi.fn().mockResolvedValue(undefined),
    runIngest: vi.fn(),
    runHotspotIngest: vi.fn(),
    runBackfill: vi.fn(),
    runTaxonomy: vi.fn(),
    ...overrides,
  };
}

describe('runCli', () => {
  const ORIGINAL_ENV = process.env;
  const ORIGINAL_EXIT_CODE = process.exitCode;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, EBIRD_API_KEY: 'k', DATABASE_URL: 'postgres://x' };
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.exitCode = ORIGINAL_EXIT_CODE;
    logSpy.mockRestore();
  });

  it('sets process.exitCode = 1 when summary.status === "failure" (and still closes pool)', async () => {
    const failureSummary: RunTaxonomySummary = {
      status: 'failure',
      totalFetched: 0,
      speciesInserted: 0,
      nonSpeciesFiltered: 0,
      reconciled: 0,
      error: 'boom',
    };
    const deps = makeDeps({
      runTaxonomy: vi.fn().mockResolvedValue(failureSummary),
    });

    await runCli('taxonomy', deps);

    expect(process.exitCode).toBe(1);
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
    // Summary is still logged so Cloud Run Job logs keep the diagnostic payload.
    expect(logSpy).toHaveBeenCalled();
  });

  it('leaves process.exitCode untouched when summary.status === "success"', async () => {
    const successSummary: RunSummary = { status: 'success', fetched: 10, upserted: 10 };
    const deps = makeDeps({ runIngest: vi.fn().mockResolvedValue(successSummary) });

    await runCli('recent', deps);

    expect(process.exitCode).toBeUndefined();
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it('still closes pool when the runner throws', async () => {
    const deps = makeDeps({
      runTaxonomy: vi.fn().mockRejectedValue(new Error('thrown')),
    });

    await expect(runCli('taxonomy', deps)).rejects.toThrow('thrown');
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it('throws on unknown kind (preserves existing contract)', async () => {
    const deps = makeDeps();
    await expect(runCli('bogus', deps)).rejects.toThrow(/Unknown kind/);
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it('throws if EBIRD_API_KEY is not set', async () => {
    delete process.env.EBIRD_API_KEY;
    const deps = makeDeps();
    await expect(runCli('recent', deps)).rejects.toThrow(/EBIRD_API_KEY/);
  });

  it('throws if DATABASE_URL is not set', async () => {
    delete process.env.DATABASE_URL;
    const deps = makeDeps();
    await expect(runCli('recent', deps)).rejects.toThrow(/DATABASE_URL/);
  });
});
