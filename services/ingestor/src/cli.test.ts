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
    runPhotos: vi.fn(),
    runDescriptions: vi.fn(),
    fetchWikipediaSummary: vi.fn(),
    fetchInatTaxon: vi.fn(),
    ...overrides,
  };
}

describe('runCli', () => {
  const ORIGINAL_ENV = process.env;
  const ORIGINAL_EXIT_CODE = process.exitCode;
  const ORIGINAL_ARGV = process.argv;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, EBIRD_API_KEY: 'k', DATABASE_URL: 'postgres://x' };
    process.exitCode = undefined;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.exitCode = ORIGINAL_EXIT_CODE;
    process.argv = ORIGINAL_ARGV;
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

  it('"backfill-extended" kind invokes runBackfill with days=365 and paceMs=1000', async () => {
    // The one-shot 365-day backfill must run at ~1 rps to stay under eBird's
    // rate limit AND finish inside the 600s Cloud Run job timeout
    // (365 days × 1s/call ≈ 365s, well below 600s). Operator step:
    // `gcloud run jobs execute bird-ingestor --args=backfill-extended`.
    const successSummary = {
      status: 'success' as const,
      fetched: 0, upserted: 0, daysProcessed: 365,
    };
    const runBackfillSpy = vi.fn().mockResolvedValue(successSummary);
    const deps = makeDeps({ runBackfill: runBackfillSpy });
    await runCli('backfill-extended', deps);
    expect(runBackfillSpy).toHaveBeenCalledTimes(1);
    expect(runBackfillSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        regionCode: 'US-AZ',
        days: 365,
        paceMs: 1_000,
      })
    );
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

  it('"probe-wiki" early-returns before the env guards (no DB, no eBird)', async () => {
    // probe-wiki is an operator debug kind that hits Wikipedia's public REST
    // endpoint — it has no DB writes and does not need EBIRD_API_KEY.
    // The kind dispatch must short-circuit ahead of the env guards so the
    // operator can run it without standing up the eBird/DB credentials.
    delete process.env.EBIRD_API_KEY;
    delete process.env.DATABASE_URL;
    const ORIGINAL_ARGV = process.argv;
    process.argv = ['node', 'cli.ts', 'probe-wiki', 'Vermilion_flycatcher'];
    try {
      const fakeSummary = {
        notModified: false as const,
        extractHtml: '<p>The vermilion flycatcher is...</p>',
        revisionId: '42',
        license: 'CC-BY-SA-4.0' as const,
        etag: '"abc"',
      };
      const fetchSpy = vi.fn().mockResolvedValue(fakeSummary);
      const deps = makeDeps({ fetchWikipediaSummary: fetchSpy });

      await runCli('probe-wiki', deps);

      // The wiki client received the title from argv[3] verbatim.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith('Vermilion_flycatcher');
      // The DB path is bypassed entirely.
      expect(deps.createPool).not.toHaveBeenCalled();
      expect(deps.closePool).not.toHaveBeenCalled();
      // Summary printed for operator triage.
      expect(logSpy).toHaveBeenCalledWith(JSON.stringify(fakeSummary, null, 2));
    } finally {
      process.argv = ORIGINAL_ARGV;
    }
  });

  it('"probe-wiki" without a title argument throws', async () => {
    const ORIGINAL_ARGV = process.argv;
    process.argv = ['node', 'cli.ts', 'probe-wiki'];
    try {
      const deps = makeDeps();
      await expect(runCli('probe-wiki', deps)).rejects.toThrow(
        /probe-wiki requires a title argument/
      );
    } finally {
      process.argv = ORIGINAL_ARGV;
    }
  });

  it('"probe-taxon" runs without EBIRD_API_KEY/DATABASE_URL set (debug kind, no DB)', async () => {
    // probe-taxon is an operator triage tool — it does not touch the DB and
    // does not need eBird credentials. The kind must early-return ahead of
    // the env guards so an operator can run it locally without secrets in
    // their shell. Regression check: pre-fix, the EBIRD_API_KEY guard fired
    // first and forced operators to set a junk key just to run a debug.
    delete process.env.EBIRD_API_KEY;
    delete process.env.DATABASE_URL;
    process.argv = ['node', 'cli.ts', 'probe-taxon', 'Setophaga coronata'];
    const fetchInatTaxonSpy = vi.fn().mockResolvedValue({
      inatTaxonId: 9083,
      wikipediaUrl: 'https://en.wikipedia.org/wiki/Yellow-rumped_warbler',
    });
    const deps = makeDeps({ fetchInatTaxon: fetchInatTaxonSpy });

    await runCli('probe-taxon', deps);

    expect(fetchInatTaxonSpy).toHaveBeenCalledWith('Setophaga coronata');
    // No DB pool was created — the env guards were correctly bypassed and the
    // probe path never reached the createPool branch.
    expect(deps.createPool).not.toHaveBeenCalled();
    expect(deps.closePool).not.toHaveBeenCalled();
    // Result is logged as JSON for the operator to grep.
    expect(logSpy).toHaveBeenCalled();
  });

  it('"probe-taxon" without a binomial argument throws', async () => {
    process.argv = ['node', 'cli.ts', 'probe-taxon'];
    const deps = makeDeps();
    await expect(runCli('probe-taxon', deps)).rejects.toThrow(
      /probe-taxon requires a binomial/
    );
  });

  it("'descriptions' kind dispatches to runDescriptions with the pool", async () => {
    const successSummary = {
      status: 'success' as const,
      speciesCount: 0,
      descriptionsWritten: 0,
      descriptionsSkipped: 0,
      descriptionsFailed: 0,
      errors: [] as Array<{ speciesCode: string; reason: string }>,
    };
    const runDescriptionsSpy = vi.fn().mockResolvedValue(successSummary);
    const deps = makeDeps({ runDescriptions: runDescriptionsSpy });

    await runCli('descriptions', deps);

    expect(runDescriptionsSpy).toHaveBeenCalledTimes(1);
    expect(runDescriptionsSpy).toHaveBeenCalledWith({ pool: POOL_SENTINEL });
    // No EBIRD_API_KEY forwarded — runDescriptions's upstream is iNat + Wikipedia.
    const call = runDescriptionsSpy.mock.calls[0]?.[0];
    expect(call).not.toHaveProperty('apiKey');
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("Unknown-kind error string includes 'descriptions' so operators see the new kind", async () => {
    const deps = makeDeps();
    await expect(runCli('bogus', deps)).rejects.toThrow(/descriptions/);
  });
});
