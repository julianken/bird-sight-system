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

  it("'prune' kind dispatches to runPrune with the pool and default retention", async () => {
    delete process.env.OBSERVATIONS_RETENTION_DAYS;
    const successSummary = {
      status: 'success' as const, deleted: 0, retentionDays: 14,
    };
    const runPruneSpy = vi.fn().mockResolvedValue(successSummary);
    const deps = makeDeps({ runPrune: runPruneSpy });

    await runCli('prune', deps);

    expect(runPruneSpy).toHaveBeenCalledTimes(1);
    expect(runPruneSpy).toHaveBeenCalledWith({ pool: POOL_SENTINEL });
    expect(deps.closePool).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("'prune' kind forwards OBSERVATIONS_RETENTION_DAYS as a parsed integer", async () => {
    process.env.OBSERVATIONS_RETENTION_DAYS = '30';
    const runPruneSpy = vi.fn().mockResolvedValue({
      status: 'success' as const, deleted: 0, retentionDays: 30,
    });
    const deps = makeDeps({ runPrune: runPruneSpy });

    await runCli('prune', deps);

    expect(runPruneSpy).toHaveBeenCalledWith({
      pool: POOL_SENTINEL, retentionDays: 30,
    });
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
    const successSummary: RunSummary = { status: 'success', fetched: 1, upserted: 1 };
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

  // ── list-subregions kind ──────────────────────────────────────────────
  // Operator helper that prints the eBird-canonical subnational2 county
  // list for a given state. Used to seed per-county backfill fanout for
  // big states whose state-level /historic returns HTTP 500. No DB writes,
  // no DATABASE_URL required; EBIRD_API_KEY is required.
  describe('list-subregions kind', () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Stub global fetch — the kind hits eBird's /ref/region/list/subnational2
      // endpoint directly (read-only, no shared client needed).
      fetchSpy = vi.spyOn(globalThis, 'fetch');
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('emits one INFO log per county plus a summary count', async () => {
      process.argv = ['node', 'cli.ts', 'list-subregions', '--state=US-CO'];
      delete process.env.DATABASE_URL; // proves no DB needed
      const counties = [
        { code: 'US-CO-001', name: 'Adams' },
        { code: 'US-CO-003', name: 'Alamosa' },
        { code: 'US-CO-014', name: 'Broomfield' },
      ];
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(counties), { status: 200 })
      );
      const deps = makeDeps();

      await runCli('list-subregions', deps);

      const emitted = logSpy.mock.calls
        .map((args: unknown[]): unknown => {
          try { return JSON.parse(args[0] as string); } catch { return null; }
        })
        .filter((o: unknown): o is Record<string, unknown> =>
          typeof o === 'object' && o !== null && (o as Record<string, unknown>).message === 'list-subregions'
        );
      // 3 per-county lines + 1 summary line = 4 emits
      expect(emitted).toHaveLength(4);
      expect(emitted[0]).toMatchObject({
        message: 'list-subregions',
        kind: 'list-subregions',
        state: 'US-CO',
        subregionCode: 'US-CO-001',
        subregionName: 'Adams',
      });
      expect(emitted[2]).toMatchObject({
        subregionCode: 'US-CO-014',
        subregionName: 'Broomfield',
      });
      expect(emitted[3]).toMatchObject({
        message: 'list-subregions',
        state: 'US-CO',
        count: 3,
      });
      // No DB pool was created — early-return path.
      expect(deps.createPool).not.toHaveBeenCalled();
    });

    it('passes X-eBirdApiToken header to the eBird ref endpoint', async () => {
      process.env.EBIRD_API_KEY = 'fake-key-123';
      process.argv = ['node', 'cli.ts', 'list-subregions', '--state=US-FL'];
      fetchSpy.mockResolvedValueOnce(new Response('[]', { status: 200 }));
      const deps = makeDeps();

      await runCli('list-subregions', deps);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.ebird.org/v2/ref/region/list/subnational2/US-FL',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-ebirdapitoken': 'fake-key-123',
          }),
        })
      );
    });

    it('rejects --state=US-CA-001 (county code is invalid input here)', async () => {
      process.argv = ['node', 'cli.ts', 'list-subregions', '--state=US-CA-001'];
      const deps = makeDeps();

      await runCli('list-subregions', deps);

      expect(process.exitCode).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('rejects missing --state flag', async () => {
      process.argv = ['node', 'cli.ts', 'list-subregions'];
      const deps = makeDeps();

      await runCli('list-subregions', deps);

      expect(process.exitCode).toBe(1);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sets exitCode=1 on eBird HTTP error', async () => {
      process.argv = ['node', 'cli.ts', 'list-subregions', '--state=US-TX'];
      fetchSpy.mockResolvedValueOnce(new Response('upstream barfed', { status: 500 }));
      const deps = makeDeps();

      await runCli('list-subregions', deps);

      expect(process.exitCode).toBe(1);
    });

    it('throws if EBIRD_API_KEY is not set', async () => {
      delete process.env.EBIRD_API_KEY;
      process.argv = ['node', 'cli.ts', 'list-subregions', '--state=US-NY'];
      const deps = makeDeps();

      await expect(runCli('list-subregions', deps)).rejects.toThrow(/EBIRD_API_KEY/);
    });
  });

  it("Unknown-kind error string includes 'list-subregions' so operators see the new kind", async () => {
    const deps = makeDeps();
    await expect(runCli('bogus', deps)).rejects.toThrow(/list-subregions/);
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
