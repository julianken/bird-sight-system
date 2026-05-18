import { describe, it, expect, vi } from 'vitest';
import {
  DIGEST_INGEST_KINDS,
  renderDigestBody,
  runDigest,
  type DigestData,
  type IngestRunCount,
  type MonitoringSignals,
  type SendResult,
} from './digest.js';
import type { Pool } from '@bird-watch/db-client';

const FIXED_NOW_ISO = '2026-05-18T09:00:00.000Z';
const FIXED_NOW_DATE = new Date(FIXED_NOW_ISO);

function makeMonitoring(overrides: Partial<MonitoringSignals> = {}): MonitoringSignals {
  return {
    readApiP95Ms: 187,
    cloudSqlCpuPct: 0.21,
    freshnessMaxSeconds: 540,
    topErrors: [],
    ...overrides,
  };
}

function makeDigestData(
  ingestRuns24h: IngestRunCount[],
  overrides: Partial<MonitoringSignals> = {}
): DigestData {
  return { ingestRuns24h, ...makeMonitoring(overrides) };
}

describe('renderDigestBody', () => {
  it('enumerates all 5 covered ingest kinds even when some have no runs (F9 coverage gap is legible)', () => {
    // Only "recent" had runs in the last 24h — the other 4 kinds did not. The
    // rendered digest must still show all 5 lines so the operator can see
    // exactly which crons fired and which did not, AND can see that
    // photos/descriptions are absent (deliberate: they don't emit ingest_runs).
    const ingestRuns24h: IngestRunCount[] = [
      { kind: 'recent', status: 'success', count: 47 },
      { kind: 'recent', status: 'failure', count: 1 },
    ];
    const body = renderDigestBody(makeDigestData(ingestRuns24h), FIXED_NOW_ISO);

    for (const kind of DIGEST_INGEST_KINDS) {
      expect(body).toContain(kind);
    }
    // Coverage-gap text — operator-visible.
    expect(body).toContain('5 of the 7 ingest kinds');
    expect(body).toContain('photos');
    expect(body).toContain('descriptions');
    // The line for "recent" carries the per-status breakdown.
    expect(body).toMatch(/recent\s+1 failure \/ 47 success/);
    // Kinds with no runs render an explicit empty marker, not a missing line.
    expect(body).toMatch(/backfill\s+no runs in last 24h/);
    expect(body).toMatch(/hotspots\s+no runs in last 24h/);
    expect(body).toMatch(/taxonomy\s+no runs in last 24h/);
    expect(body).toMatch(/prune\s+no runs in last 24h/);
  });

  it('renders monitoring signals with units, and "unavailable" when the source returns null', () => {
    const presentBody = renderDigestBody(
      makeDigestData([], {
        readApiP95Ms: 412.3,
        cloudSqlCpuPct: 0.078,
        freshnessMaxSeconds: 3600,
      }),
      FIXED_NOW_ISO
    );
    expect(presentBody).toContain('412 ms');
    expect(presentBody).toContain('7.8 %');
    expect(presentBody).toContain('3600 s');

    const absentBody = renderDigestBody(
      makeDigestData([], {
        readApiP95Ms: null,
        cloudSqlCpuPct: null,
        freshnessMaxSeconds: null,
      }),
      FIXED_NOW_ISO
    );
    expect(absentBody.match(/unavailable/g)?.length).toBe(3);
  });

  it('renders top-3 errors with their counts, or "none" when the list is empty', () => {
    const withErrors = renderDigestBody(
      makeDigestData([], {
        topErrors: [
          { message: 'pool exhausted', count: 12 },
          { message: 'eBird 500 on /recent', count: 4 },
          { message: 'invalid JSON from upstream', count: 2 },
          { message: '4th error — must be trimmed', count: 1 },
        ],
      }),
      FIXED_NOW_ISO
    );
    expect(withErrors).toContain('[12] pool exhausted');
    expect(withErrors).toContain('[4] eBird 500 on /recent');
    expect(withErrors).toContain('[2] invalid JSON from upstream');
    expect(withErrors).not.toContain('4th error');

    const noErrors = renderDigestBody(makeDigestData([]), FIXED_NOW_ISO);
    expect(noErrors).toMatch(/Top 3 errors[\s\S]*?none/);
  });
});

describe('runDigest', () => {
  // The pool is a sentinel because the test stubs fetchIngestRuns24h via
  // a pool.query mock — the SQL it would otherwise run is integration-tested
  // separately via @testcontainers/postgresql elsewhere if needed; here we
  // exercise the composition + send path.
  function makePool(rows: Array<{ kind: string; status: string; count: string }>): Pool {
    return {
      query: vi.fn().mockResolvedValue({ rows }),
    } as unknown as Pool;
  }

  it('returns the SendResult from sendEmail verbatim — caller decides heartbeat', async () => {
    const sendEmail = vi.fn<(s: string, b: string) => Promise<SendResult>>().mockResolvedValue({
      status: 'delivered',
      providerMessageId: 'sg-msg-1',
    });
    const pool = makePool([
      { kind: 'recent', status: 'success', count: '47' },
    ]);

    const result = await runDigest({
      pool,
      emailRecipient: 'julian.kennon.d@gmail.com',
      sendEmail,
      fetchMonitoringSignals: async () => makeMonitoring(),
      now: () => FIXED_NOW_DATE,
    });

    expect(result.status).toBe('delivered');
    expect(result.providerMessageId).toBe('sg-msg-1');
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [subject, body] = sendEmail.mock.calls[0]!;
    expect(subject).toContain('2026-05-18');
    // The body carries the F9 coverage note and the per-kind breakdown.
    expect(body).toContain('5 of the 7 ingest kinds');
    expect(body).toContain('recent');
    expect(body).toContain('47 success');
  });

  it('forwards a failed SendResult unchanged — failure path stays observable to caller', async () => {
    const sendEmail = vi
      .fn<(s: string, b: string) => Promise<SendResult>>()
      .mockResolvedValue({ status: 'failed', error: 'SPF fail' });
    const pool = makePool([]);

    const result = await runDigest({
      pool,
      emailRecipient: 'julian.kennon.d@gmail.com',
      sendEmail,
      fetchMonitoringSignals: async () => makeMonitoring(),
      now: () => FIXED_NOW_DATE,
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('SPF fail');
  });

  it('queries ingest_runs filtered to the 5 covered kinds (photos/descriptions excluded at SQL)', async () => {
    const sendEmail = vi
      .fn<(s: string, b: string) => Promise<SendResult>>()
      .mockResolvedValue({ status: 'delivered' });
    const pool = makePool([]);

    await runDigest({
      pool,
      emailRecipient: 'julian.kennon.d@gmail.com',
      sendEmail,
      fetchMonitoringSignals: async () => makeMonitoring(),
      now: () => FIXED_NOW_DATE,
    });

    // The query receives the 5-kind array as its sole parameter so photos
    // and descriptions cannot leak into the rendered digest even if a future
    // ingest_runs migration starts populating them — the SQL filter is the
    // load-bearing constraint, the renderer is just secondary defense.
    const queryCall = (pool.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(queryCall).toBeDefined();
    const [, params] = queryCall!;
    expect(params).toEqual([
      ['recent', 'backfill', 'hotspots', 'taxonomy', 'prune'],
    ]);
  });
});

describe('heartbeat gating contract (caller-side simulation)', () => {
  // These tests document the contract cli.ts is expected to honor: ping the
  // heartbeat ONLY when runDigest returned status === 'delivered'. The CLI
  // wrapper itself is exercised by cli.test.ts; here we lock the contract
  // shape via a small simulation so a future refactor that changes the
  // SendResult shape breaks loudly at the digest-test boundary.

  function gateHeartbeat(result: SendResult, ping: () => void): void {
    if (result.status === 'delivered') ping();
  }

  it('does NOT call ping when sendEmail returns status=failed', () => {
    const ping = vi.fn();
    gateHeartbeat({ status: 'failed', error: 'SPF rejected' }, ping);
    expect(ping).not.toHaveBeenCalled();
  });

  it('does NOT call ping when sendEmail returns status=queued (waiting on delivery webhook)', () => {
    const ping = vi.fn();
    gateHeartbeat({ status: 'queued', providerMessageId: 'sg-pending' }, ping);
    expect(ping).not.toHaveBeenCalled();
  });

  it('calls ping when sendEmail returns status=delivered', () => {
    const ping = vi.fn();
    gateHeartbeat({ status: 'delivered', providerMessageId: 'sg-ok' }, ping);
    expect(ping).toHaveBeenCalledTimes(1);
  });
});
