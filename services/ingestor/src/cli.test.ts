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
    runPrune: vi.fn(),
    runCacheWarm: vi.fn(),
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
    const successSummary: RunSummary = {
      status: 'success', fetched: 10, upserted: 10,
      statesSucceeded: 49, statesFailed: 0,
    };
    const deps = makeDeps({ runIngest: vi.fn().mockResolvedValue(successSummary) });

    await runCli('recent', deps);

    expect(process.exitCode).toBeUndefined();
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it('"recent" kind drives the per-state fan-out — does NOT pass regionCode:"US" (#840)', async () => {
    // The old single-nationwide-call bug passed `regionCode: 'US'`, which
    // eBird deduped to one-obs-per-species, starving non-AZ states. runIngest
    // now loops CONUS_STATE_CODES internally; cli must NOT re-pin a region.
    const runIngestSpy = vi.fn().mockResolvedValue({
      status: 'success', fetched: 0, upserted: 0,
      statesSucceeded: 49, statesFailed: 0,
    } as RunSummary);
    const deps = makeDeps({ runIngest: runIngestSpy });

    await runCli('recent', deps);

    expect(runIngestSpy).toHaveBeenCalledTimes(1);
    const arg = runIngestSpy.mock.calls[0]![0] as { regionCode?: string };
    expect(arg.regionCode).toBeUndefined();
  });

  it('"recent" partial status still pings the heartbeat (does not set exitCode)', async () => {
    process.env.HEALTHCHECKS_URL_RECENT = 'https://hc-ping.com/uuid-recent-partial';
    const partialSummary: RunSummary = {
      status: 'partial', fetched: 5, upserted: 5,
      statesSucceeded: 46, statesFailed: 3,
      failures: [{ state: 'US-NM', error: 'boom' }],
    };
    const pingSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      runIngest: vi.fn().mockResolvedValue(partialSummary),
      pingHeartbeat: pingSpy,
    });

    await runCli('recent', deps);

    expect(process.exitCode).toBeUndefined();
    expect(pingSpy).toHaveBeenCalledWith('https://hc-ping.com/uuid-recent-partial', 'recent');
    delete process.env.HEALTHCHECKS_URL_RECENT;
  });

  it('"recent" partial run surfaces statesFailed + failed state codes in the run-completed line (#840 review)', async () => {
    // A degraded-but-green run (some states 500'd, under the failure threshold)
    // correctly still pings the success heartbeat — but if the aggregate
    // bird_ingest_run_completed line drops the failed-state count, the dashboard
    // metrics see a clean INFO line and the silent-degradation is invisible
    // (the same class of bug that hid the original #840 single-region starve).
    // The summary line MUST carry statesFailed (and the failed state codes) so a
    // partial run reads as degraded in Cloud Logging without joining against the
    // per-state WARNING lines.
    const partialSummary: RunSummary = {
      status: 'partial', fetched: 5, upserted: 5,
      statesSucceeded: 46, statesFailed: 3,
      failures: [
        { state: 'US-NM', error: 'boom' },
        { state: 'US-TX', error: 'timeout' },
        { state: 'US-NV', error: '500' },
      ],
    };
    const deps = makeDeps({ runIngest: vi.fn().mockResolvedValue(partialSummary) });

    await runCli('recent', deps);

    const emitted = logSpy.mock.calls
      .map((args: unknown[]): unknown => {
        try { return JSON.parse(args[0] as string); } catch { return null; }
      })
      .filter((o: unknown): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'bird_ingest_run_completed'
      );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      severity: 'INFO',
      message: 'bird_ingest_run_completed',
      kind: 'recent',
      status: 'partial',
      statesFailed: 3,
      failedStates: ['US-NM', 'US-TX', 'US-NV'],
      firstError: 'boom',
    });
  });

  it('"recent" success run omits statesFailed/failedStates from the run-completed line', async () => {
    // A clean run (0 failed) must not clutter the structured line with a
    // statesFailed:0 / empty failedStates field — those keys appear ONLY when
    // there is degradation to surface, mirroring the existing conditional
    // `state` / `firstError` field shape.
    const successSummary: RunSummary = {
      status: 'success', fetched: 10, upserted: 10,
      statesSucceeded: 49, statesFailed: 0,
    };
    const deps = makeDeps({ runIngest: vi.fn().mockResolvedValue(successSummary) });

    await runCli('recent', deps);

    const emitted = logSpy.mock.calls
      .map((args: unknown[]): unknown => {
        try { return JSON.parse(args[0] as string); } catch { return null; }
      })
      .filter((o: unknown): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'bird_ingest_run_completed'
      );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).not.toHaveProperty('statesFailed');
    expect(emitted[0]).not.toHaveProperty('failedStates');
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

  // ── Phase 3.5 per-state backfill flags ────────────────────────────────────
  // CLI accepts --state=US-XX and --back=N for the `backfill` kind so the
  // Terraform fan-out can target one state per scheduler job. Defaults preserve
  // the legacy no-flag prod scheduler (regionCode=US-AZ, days=19).
  describe('backfill flag parsing (Phase 3.5)', () => {
    it('default no-flag invocation preserves regionCode=US-AZ, days=19', async () => {
      process.argv = ['node', 'cli.ts', 'backfill'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 19,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(runBackfillSpy).toHaveBeenCalledWith(
        expect.objectContaining({ regionCode: 'US-AZ', days: 19 })
      );
    });

    it('accepts --state=US-CA', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA', '--back=14'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 14,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(runBackfillSpy).toHaveBeenCalledWith(
        expect.objectContaining({ regionCode: 'US-CA', days: 14 })
      );
    });

    it('rejects --state=US-ZZ-style malformed regions', async () => {
      // Non-existent USPS code; regex enforces /^US-[A-Z]{2}$/ shape but does
      // not enumerate. ZZ is intentionally shape-valid here for parity with the
      // simpler rejection path — we use a clearly malformed value instead.
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-ZZZ'];
      const runBackfillSpy = vi.fn();
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(process.exitCode).toBe(1);
      expect(runBackfillSpy).not.toHaveBeenCalled();
    });

    it('accepts --back=14', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--back=14'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 14,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(runBackfillSpy).toHaveBeenCalledWith(
        expect.objectContaining({ regionCode: 'US-AZ', days: 14 })
      );
    });

    it('emits structured `state` field on the run-completion log for per-state backfill', async () => {
      // Phase 3.5: scripts/verify-backfill.sh and Cloud Logging dashboards
      // partition by jsonPayload.state. The summary line must carry `state`
      // as a top-level field, not embedded in a message string.
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA', '--back=14'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 14,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      const emitted = logSpy.mock.calls
        .map((args: unknown[]): unknown => {
          try { return JSON.parse(args[0] as string); } catch { return null; }
        })
        .filter((o: unknown): o is Record<string, unknown> =>
          typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'bird_ingest_run_completed'
        );
      expect(emitted).toHaveLength(1);
      expect(emitted[0]).toMatchObject({
        message: 'bird_ingest_run_completed',
        kind: 'backfill',
        status: 'success',
        state: 'US-CA',
      });
    });

    it('rejects --back=31 (above eBird /recent 30-day cap)', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--back=31'];
      const runBackfillSpy = vi.fn();
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(process.exitCode).toBe(1);
      expect(runBackfillSpy).not.toHaveBeenCalled();
    });

    // ── County (subnational2) codes ──────────────────────────────────────
    // A per-day full-state /historic call can blow past eBird's response-size
    // limit (observed: HTTP 500 on CA backfill), and the mitigation is to fan
    // out per county. The --state flag must accept the subnational2 shape
    // US-XX-NNN (numeric FIPS) and US-XX-AAA (alpha sub-codes) without
    // dropping rejection on truly malformed values.

    it('accepts --state=US-CA-001 (numeric county FIPS subnational2 code)', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA-001', '--back=14'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 14,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(runBackfillSpy).toHaveBeenCalledWith(
        expect.objectContaining({ regionCode: 'US-CA-001', days: 14 })
      );
    });

    it('accepts --state=US-CA-LAS (alphabetic subnational2 sub-code)', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA-LAS', '--back=14'];
      const runBackfillSpy = vi.fn().mockResolvedValue({
        status: 'success' as const, fetched: 0, upserted: 0, daysProcessed: 14,
      });
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(runBackfillSpy).toHaveBeenCalledWith(
        expect.objectContaining({ regionCode: 'US-CA-LAS', days: 14 })
      );
    });

    it('rejects --state=US-CA- (trailing hyphen, empty subnational2 segment)', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA-'];
      const runBackfillSpy = vi.fn();
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(process.exitCode).toBe(1);
      expect(runBackfillSpy).not.toHaveBeenCalled();
    });

    it('rejects --state=US-CA-001-x (more than one subnational segment)', async () => {
      process.argv = ['node', 'cli.ts', 'backfill', '--state=US-CA-001-x'];
      const runBackfillSpy = vi.fn();
      const deps = makeDeps({ runBackfill: runBackfillSpy });
      await runCli('backfill', deps);
      expect(process.exitCode).toBe(1);
      expect(runBackfillSpy).not.toHaveBeenCalled();
    });
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

  it("'prune' kind dispatches to runPrune with the pool, default retention, and an archiveDay callback", async () => {
    delete process.env.OBSERVATIONS_RETENTION_DAYS;
    const successSummary = {
      status: 'success' as const, deleted: 0, archived: 0,
      archivedDays: 0, gcsPaths: [], retentionDays: 14,
    };
    const runPruneSpy = vi.fn().mockResolvedValue(successSummary);
    const deps = makeDeps({ runPrune: runPruneSpy });

    await runCli('prune', deps);

    expect(runPruneSpy).toHaveBeenCalledTimes(1);
    // After T2/T4 the runPrune call carries an archiveDay callback wired
    // to archiveAndUpload over @google-cloud/storage. We assert on the
    // pool + callback presence; the callback's internal wiring is
    // exercised by archive/gcs-uploader.test.ts.
    const call = runPruneSpy.mock.calls[0]?.[0];
    expect(call?.pool).toBe(POOL_SENTINEL);
    expect(typeof call?.archiveDay).toBe('function');
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("'prune' kind forwards OBSERVATIONS_RETENTION_DAYS as a parsed integer", async () => {
    process.env.OBSERVATIONS_RETENTION_DAYS = '30';
    const runPruneSpy = vi.fn().mockResolvedValue({
      status: 'success' as const, deleted: 0, archived: 0,
      archivedDays: 0, gcsPaths: [], retentionDays: 30,
    });
    const deps = makeDeps({ runPrune: runPruneSpy });

    await runCli('prune', deps);

    const call = runPruneSpy.mock.calls[0]?.[0];
    expect(call?.pool).toBe(POOL_SENTINEL);
    expect(call?.retentionDays).toBe(30);
    expect(typeof call?.archiveDay).toBe('function');
  });

  it("'prune' rejects a non-positive OBSERVATIONS_RETENTION_DAYS value", async () => {
    process.env.OBSERVATIONS_RETENTION_DAYS = '0';
    const deps = makeDeps();
    await expect(runCli('prune', deps)).rejects.toThrow(/positive integer/);
  });

  it("Unknown-kind error string includes 'prune' so operators see the new kind", async () => {
    const deps = makeDeps();
    await expect(runCli('bogus', deps)).rejects.toThrow(/prune/);
  });

  // ── #878 — precompute grid refresh hook ───────────────────────────────────
  // refreshGridAgg must fire after a `recent` ingest+reconcile AND after a
  // `prune` (the "no stale cells" Must-NOT needs BOTH: recent adds rows, prune
  // drops aged-out cells). It must NOT fire on other kinds, and must be skipped
  // on a failed run (observations unchanged → prior grid still correct).
  describe('precompute grid refresh (#878)', () => {
    const recentSuccess: RunSummary = {
      status: 'success', fetched: 10, upserted: 10, statesSucceeded: 49, statesFailed: 0,
    };
    const pruneSuccess = {
      status: 'success' as const, deleted: 5, archived: 5,
      archivedDays: 1, gcsPaths: ['gs://x'], retentionDays: 14,
    };

    it("fires refreshGridAgg after a successful 'recent' run, with the pool", async () => {
      const refreshSpy = vi.fn().mockResolvedValue(150);
      const deps = makeDeps({
        runIngest: vi.fn().mockResolvedValue(recentSuccess),
        refreshGridAgg: refreshSpy,
      });
      await runCli('recent', deps);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledWith(POOL_SENTINEL);
    });

    it("fires refreshGridAgg after a successful 'prune' run", async () => {
      delete process.env.OBSERVATIONS_RETENTION_DAYS;
      const refreshSpy = vi.fn().mockResolvedValue(150);
      const deps = makeDeps({
        runPrune: vi.fn().mockResolvedValue(pruneSuccess),
        refreshGridAgg: refreshSpy,
      });
      await runCli('prune', deps);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(refreshSpy).toHaveBeenCalledWith(POOL_SENTINEL);
    });

    it("fires after a 'partial' recent run (forward progress landed rows)", async () => {
      const refreshSpy = vi.fn().mockResolvedValue(150);
      const deps = makeDeps({
        runIngest: vi.fn().mockResolvedValue({
          ...recentSuccess, status: 'partial', statesFailed: 2,
          failures: [{ state: 'US-CA', error: 'x' }, { state: 'US-TX', error: 'y' }],
        }),
        refreshGridAgg: refreshSpy,
      });
      await runCli('recent', deps);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire on a FAILED recent run (observations unchanged → grid still valid)", async () => {
      const refreshSpy = vi.fn().mockResolvedValue(150);
      const deps = makeDeps({
        runIngest: vi.fn().mockResolvedValue({
          status: 'failure', fetched: 0, upserted: 0,
          statesSucceeded: 0, statesFailed: 49, error: 'boom',
        }),
        refreshGridAgg: refreshSpy,
      });
      await runCli('recent', deps);
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("does NOT fire on a non-recent/non-prune kind ('taxonomy')", async () => {
      const refreshSpy = vi.fn().mockResolvedValue(150);
      const deps = makeDeps({
        runTaxonomy: vi.fn().mockResolvedValue({
          status: 'success', totalFetched: 1, speciesInserted: 1,
          nonSpeciesFiltered: 0, reconciled: 0,
        } satisfies RunTaxonomySummary),
        refreshGridAgg: refreshSpy,
      });
      await runCli('taxonomy', deps);
      expect(refreshSpy).not.toHaveBeenCalled();
    });

    it("a refresh failure is non-fatal: the recent run still succeeds (exitCode untouched)", async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const refreshSpy = vi.fn().mockRejectedValue(new Error('grid boom'));
      const deps = makeDeps({
        runIngest: vi.fn().mockResolvedValue(recentSuccess),
        refreshGridAgg: refreshSpy,
      });
      await runCli('recent', deps);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      // The ingest landed rows; a grid-refresh failure must not fail the job.
      expect(process.exitCode).toBeUndefined();
      // It is surfaced loudly so a persistently-stale grid is visible.
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });
  });

  // ── cache-warm kind (issue #711) ──────────────────────────────────────
  // The cache-warm kind is pure HTTP — no DB pool, no eBird API. Its early
  // return must precede the EBIRD_API_KEY / DATABASE_URL guards so a manual
  // `gcloud run jobs execute bird-ingestor --args=cache-warm` works on a job
  // execution where those env vars are unset (or being rotated).

  it("'cache-warm' kind dispatches to runCacheWarm without creating a DB pool", async () => {
    const runCacheWarmSpy = vi.fn().mockResolvedValue({
      total: 77, miss: 0, hit: 77, expired: 0, dynamic: 0, other: 0, error: 0,
      p50ms: 50, p95ms: 100,
    });
    const deps = makeDeps({ runCacheWarm: runCacheWarmSpy });

    await runCli('cache-warm', deps);

    expect(runCacheWarmSpy).toHaveBeenCalledTimes(1);
    expect(runCacheWarmSpy).toHaveBeenCalledWith({
      baseUrl: 'https://api.bird-maps.com',
    });
    // Pure HTTP — no createPool / closePool.
    expect(deps.createPool).not.toHaveBeenCalled();
    expect(deps.closePool).not.toHaveBeenCalled();
  });

  it("'cache-warm' kind early-returns ahead of the EBIRD_API_KEY / DATABASE_URL guards", async () => {
    // Same shape as the probe-* kinds: the operator must be able to invoke
    // `--args=cache-warm` without standing up eBird/DB secrets in their
    // shell. Pre-fix the EBIRD_API_KEY guard would have fired first.
    delete process.env.EBIRD_API_KEY;
    delete process.env.DATABASE_URL;
    const runCacheWarmSpy = vi.fn().mockResolvedValue({
      total: 77, miss: 77, hit: 0, expired: 0, dynamic: 0, other: 0, error: 0,
      p50ms: 1000, p95ms: 1500,
    });
    const deps = makeDeps({ runCacheWarm: runCacheWarmSpy });

    await runCli('cache-warm', deps);

    expect(runCacheWarmSpy).toHaveBeenCalledTimes(1);
  });

  it("'cache-warm' kind pings HEALTHCHECKS_URL_CACHE_WARM on completion", async () => {
    // Validates the env-var name derivation: kind 'cache-warm' →
    // HEALTHCHECKS_URL_CACHE_WARM (upper-cased, hyphen → underscore).
    process.env.HEALTHCHECKS_URL_CACHE_WARM = 'https://hc-ping.com/uuid-cw';
    const pingSpy = vi.fn().mockResolvedValue(undefined);
    const runCacheWarmSpy = vi.fn().mockResolvedValue({
      total: 77, miss: 0, hit: 77, expired: 0, dynamic: 0, other: 0, error: 0,
      p50ms: 50, p95ms: 100,
    });
    const deps = makeDeps({ runCacheWarm: runCacheWarmSpy, pingHeartbeat: pingSpy });

    await runCli('cache-warm', deps);

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(pingSpy).toHaveBeenCalledWith('https://hc-ping.com/uuid-cw', 'cache-warm');
    delete process.env.HEALTHCHECKS_URL_CACHE_WARM;
  });

  it("'cache-warm' kind respects CACHE_WARM_BASE_URL env override", async () => {
    process.env.CACHE_WARM_BASE_URL = 'http://localhost:8080';
    const runCacheWarmSpy = vi.fn().mockResolvedValue({
      total: 77, miss: 77, hit: 0, expired: 0, dynamic: 0, other: 0, error: 0,
      p50ms: 0, p95ms: 0,
    });
    const deps = makeDeps({ runCacheWarm: runCacheWarmSpy });
    try {
      await runCli('cache-warm', deps);
      expect(runCacheWarmSpy).toHaveBeenCalledWith({ baseUrl: 'http://localhost:8080' });
    } finally {
      delete process.env.CACHE_WARM_BASE_URL;
    }
  });

  it("Unknown-kind error string includes 'cache-warm' so operators see the new kind", async () => {
    const deps = makeDeps();
    await expect(runCli('bogus', deps)).rejects.toThrow(/cache-warm/);
  });

  // ── Heartbeat wiring (S7) ──────────────────────────────────────────────
  // Plan: docs/plans/2026-05-17-monitoring-and-alerts.md §"Heartbeat strategy".
  // Heartbeat must fire on success and on partial, and MUST NOT fire on failure
  // — the absence of a heartbeat is the failure signal Healthchecks.io alerts on.

  it('pings heartbeat on success with HEALTHCHECKS_URL_<KIND> env value', async () => {
    process.env.HEALTHCHECKS_URL_RECENT = 'https://hc-ping.com/uuid-recent';
    const successSummary: RunSummary = {
      status: 'success',
      regionCode: 'US-AZ',
      observationsFetched: 0,
      observationsUpserted: 0,
      checklistsUpserted: 0,
      speciesUpserted: 0,
      notableObservationCount: 0,
    } as unknown as RunSummary;
    const pingSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      runIngest: vi.fn().mockResolvedValue(successSummary),
      pingHeartbeat: pingSpy,
    });

    await runCli('recent', deps);

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(pingSpy).toHaveBeenCalledWith('https://hc-ping.com/uuid-recent', 'recent');
    delete process.env.HEALTHCHECKS_URL_RECENT;
  });

  it('does NOT ping heartbeat on failure', async () => {
    const failureSummary: RunTaxonomySummary = {
      status: 'failure',
      totalFetched: 0,
      speciesInserted: 0,
      nonSpeciesFiltered: 0,
      reconciled: 0,
      error: 'boom',
    };
    const pingSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      runTaxonomy: vi.fn().mockResolvedValue(failureSummary),
      pingHeartbeat: pingSpy,
    });

    await runCli('taxonomy', deps);

    expect(pingSpy).not.toHaveBeenCalled();
  });

  // ── Structured emit shape (issue #641, epic #638 PR-2) ────────────────
  // The main-path emit at cli.ts:174 must be a single compact JSON line — not
  // pretty-printed — so Cloud Logging's `jsonPayload.*` extraction picks up
  // the fields the dashboard's log-based metrics depend on. Snapshotting the
  // payload directly would flap on `duration_seconds` (computed from
  // Date.now()); parse-then-toMatchObject + expect.any(Number) is stable.
  it('emits compact structured JSON with bird_ingest_run_completed message on success', async () => {
    const successSummary: RunSummary = {
      status: 'success', fetched: 1, upserted: 1,
      statesSucceeded: 49, statesFailed: 0,
    };
    const deps = makeDeps({ runIngest: vi.fn().mockResolvedValue(successSummary) });

    await runCli('recent', deps);

    const emitted = logSpy.mock.calls
      .map((args: unknown[]): unknown => {
        try { return JSON.parse(args[0] as string); } catch { return null; }
      })
      .filter((o: unknown): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'bird_ingest_run_completed'
      );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      severity: 'INFO',
      message: 'bird_ingest_run_completed',
      kind: 'recent',
      status: 'success',
      duration_seconds: expect.any(Number),
    });
    // Single-line emit: the stringified payload must not contain a newline,
    // otherwise Cloud Logging will split it back into separate textPayload
    // entries — which is exactly what this PR fixes.
    const rawLine = logSpy.mock.calls.find(
      (args: unknown[]) =>
        typeof args[0] === 'string' && args[0].includes('bird_ingest_run_completed')
    )?.[0] as string;
    expect(rawLine).not.toContain('\n');
  });

  it('emits severity=ERROR in the structured line when summary.status === "failure"', async () => {
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

    const emitted = logSpy.mock.calls
      .map((args: unknown[]): unknown => {
        try { return JSON.parse(args[0] as string); } catch { return null; }
      })
      .filter((o: unknown): o is Record<string, unknown> =>
        typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'bird_ingest_run_completed'
      );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      severity: 'ERROR',
      message: 'bird_ingest_run_completed',
      kind: 'taxonomy',
      status: 'failure',
      duration_seconds: expect.any(Number),
    });
  });

  it('uppercases and replaces hyphens in kind when computing env-var name', async () => {
    process.env.HEALTHCHECKS_URL_BACKFILL_EXTENDED = 'https://hc-ping.com/uuid-bf-ext';
    const partialSummary = {
      status: 'partial',
    } as unknown as Awaited<ReturnType<typeof import('./run-backfill.js').runBackfill>>;
    const pingSpy = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps({
      runBackfill: vi.fn().mockResolvedValue(partialSummary),
      pingHeartbeat: pingSpy,
    });

    await runCli('backfill-extended', deps);

    expect(pingSpy).toHaveBeenCalledWith('https://hc-ping.com/uuid-bf-ext', 'backfill-extended');
    delete process.env.HEALTHCHECKS_URL_BACKFILL_EXTENDED;
  });
});
