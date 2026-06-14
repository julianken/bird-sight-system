import {
  upsertObservations, findMissingSpeciesMeta,
  startIngestRun, finishIngestRun, type Pool,
} from '@bird-watch/db-client';
import { CONUS_STATE_CODES } from '@bird-watch/shared-types';
import { EbirdClient, EbirdClientError } from '../ebird/client.js';
import { toObservationInput, notableKeyset } from '../transform.js';

export interface RunIngestOptions {
  pool: Pool;
  apiKey: string;
  /**
   * Vestigial single-region knob retained for back-compat. The `recent` ingest
   * now fans out per-state over `CONUS_STATE_CODES` (issue #840) because eBird's
   * region-`recent` endpoint dedups to one-observation-per-species region-wide,
   * starving non-AZ states when called once for `US`. `regionCode` no longer
   * drives the fan-out; pass `stateCodes` to scope it (tests do this).
   */
  regionCode?: string;
  back?: number;
  /** Test hooks — used by retry tests on the underlying client. */
  maxRetries?: number;
  retryBaseMs?: number;
  /** Inject a client for tests; if omitted, one is constructed. */
  client?: EbirdClient;
  /**
   * The list of eBird region codes to fan out over. Defaults to the 49 CONUS
   * states (incl. DC, excl. AK/HI) — the single source of truth shared with the
   * read-api validator and frontend scope selector. Injectable so unit tests can
   * scope the fan-out to a handful of states against an `onUnhandledRequest:
   * 'error'` MSW server without standing up 49 handlers.
   */
  stateCodes?: readonly string[];
  /**
   * Min millis between successive eBird calls — applied PER CALL (#999):
   * every /recent and /recent/notable request sleeps `paceMs` first, except
   * the very first call of the run. eBird enforces a 1 req/sec burst cap
   * (effective 2026-06-10; 429 on breach), so a state's pair must never fire
   * in the same instant — the pre-#999 per-round pacing let exactly that
   * happen and depleted the burst bucket ~13 states into every sweep.
   * Default 1500ms: 49 states × 2 calls = 98 calls/run, ≈ 98 × (1.5s pace +
   * latency) ≈ 3–4 min — comfortably under the 900s Cloud Run job timeout
   * and the 30-min cron interval. Tests pass 0.
   */
  paceMs?: number;
  /**
   * Number of states that may fail (non-429 errors: 500/timeout) while the run
   * still reports `partial` rather than `failure`. `cli.ts` pings the success
   * heartbeat on both `success` AND `partial`, so this threshold controls when
   * Healthchecks.io stays green over a degraded national map. Default 5 (#840):
   * `success` = 0 failed, `partial` = 1..5 failed, `failure` = >5 failed.
   */
  partialFailureThreshold?: number;
  /**
   * Consecutive eBird 429s that trip the circuit-break and abort the run as
   * `failure`. A burst of 429s means the key is throttled; grinding through the
   * remaining states only digs the penalty-box deeper (and the every-30-min
   * scheduler would re-burst 30 min later). Default 3.
   */
  max429Streak?: number;
}

export interface RunSummary {
  status: 'success' | 'partial' | 'failure';
  fetched: number;
  upserted: number;
  /** States that returned data (recent + notable) without error. */
  statesSucceeded: number;
  /** States whose fetch failed (non-429) and were skipped. */
  statesFailed: number;
  /** Per-state failure reasons, capped, for the run-completed log line. */
  failures?: { state: string; error: string }[];
  error?: string;
}

const DEFAULT_PACE_MS = 1_500;
const DEFAULT_PARTIAL_THRESHOLD = 5;
const DEFAULT_MAX_429_STREAK = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * One thrown sentinel that aborts the fan-out loop early when eBird rate-limits
 * us repeatedly. Caught by the outer try so the run is finalized as `failure`
 * (not `partial`) — a throttled key must NOT ping the success heartbeat.
 */
class RateLimitCircuitBreak extends Error {
  constructor(public streak: number) {
    super(
      `eBird returned ${streak} consecutive 429s — aborting the per-state ` +
      `recent fan-out to avoid deepening the rate-limit penalty box. ` +
      `The every-30-min scheduler will retry next cycle.`
    );
    this.name = 'RateLimitCircuitBreak';
  }
}

function is429(err: unknown): err is EbirdClientError {
  return err instanceof EbirdClientError && err.status === 429;
}

export async function runIngest(opts: RunIngestOptions): Promise<RunSummary> {
  const clientOpts: import('../ebird/client.js').EbirdClientOptions = {
    apiKey: opts.apiKey,
    ...(opts.maxRetries !== undefined && { maxRetries: opts.maxRetries }),
    ...(opts.retryBaseMs !== undefined && { retryBaseMs: opts.retryBaseMs }),
  };
  const client = opts.client ?? new EbirdClient(clientOpts);
  const states = opts.stateCodes ?? CONUS_STATE_CODES;
  const back = opts.back ?? 14;
  const paceMs = opts.paceMs ?? DEFAULT_PACE_MS;
  const partialThreshold = opts.partialFailureThreshold ?? DEFAULT_PARTIAL_THRESHOLD;
  const max429Streak = opts.max429Streak ?? DEFAULT_MAX_429_STREAK;
  const retryBaseMs = opts.retryBaseMs ?? 250;

  const runId = await startIngestRun(opts.pool, 'recent');

  // Accumulate inputs across states; the #484 invariant + upsert run ONCE on
  // the aggregate so a single missing species_meta row aborts the whole batch
  // (preserved from the pre-fan-out implementation).
  const inputs: ReturnType<typeof toObservationInput>[] = [];
  let statesSucceeded = 0;
  const failures: { state: string; error: string }[] = [];
  let consecutive429 = 0;

  try {
    // Per-call pacing (#999): sleep before EVERY eBird call except the very
    // first of the run. eBird's 1 req/sec burst cap (effective 2026-06-10)
    // counts individual requests, so pacing per state ROUND while the pair
    // fired concurrently drained the burst bucket two tokens at a time.
    let firstCall = true;
    const paceBeforeCall = async () => {
      if (!firstCall && paceMs > 0) await sleep(paceMs);
      firstCall = false;
    };

    for (const state of states) {
      try {
        // Per-state notable intersection: `is_notable` requires BOTH this
        // state's /recent AND its /recent/notable. Keysets are built per state
        // and NOT intersected across states (a subId/speciesCode pair is
        // state-local). The pair is fetched SEQUENTIALLY — recent, then
        // notable — never concurrently, so the per-call pacing above actually
        // bounds the instantaneous request rate (#999). A 429 on either call
        // marks the whole state rate-limited, same as the concurrent shape did.
        await paceBeforeCall();
        const recent = await client.fetchRecent(state, { back });
        await paceBeforeCall();
        const notable = await client.fetchNotable(state, { back });
        const notableKeys = notableKeyset(notable);
        for (const o of recent) inputs.push(toObservationInput(o, notableKeys));
        statesSucceeded++;
        consecutive429 = 0; // a clean round resets the rate-limit streak
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (is429(err)) {
          consecutive429++;
          console.warn(JSON.stringify({
            severity: 'WARNING',
            kind: 'recent',
            message: 'bird_ingest_state_rate_limited',
            state,
            consecutive429,
            error: msg.slice(0, 500),
          }));
          if (consecutive429 >= max429Streak) {
            throw new RateLimitCircuitBreak(consecutive429);
          }
          // Back off before the next state: honor eBird's Retry-After when
          // present, else exponential on the streak length.
          const backoff = err.retryAfterMs ?? retryBaseMs * Math.pow(2, consecutive429);
          await sleep(backoff);
          // This state did not contribute data; count it as failed so the
          // status ladder reflects the missing coverage.
          failures.push({ state, error: msg });
          continue;
        }
        // Non-429 (500 / timeout / etc.): isolate — record and continue so one
        // state's failure does not abort the other 48.
        consecutive429 = 0;
        failures.push({ state, error: msg });
        console.warn(JSON.stringify({
          severity: 'WARNING',
          kind: 'recent',
          message: 'bird_ingest_state_failed',
          state,
          error: msg.slice(0, 500),
        }));
      }
    }

    // Dedup the cross-state aggregate by (subId, speciesCode) — the same
    // conflict target `upsertObservations` uses. eBird checklist subIds are
    // globally unique, so a state's /recent shouldn't surface a checklist that
    // also appears in another state's, but a single batch with two rows sharing
    // the conflict key makes Postgres throw "ON CONFLICT DO UPDATE command
    // cannot affect row a second time". Coalesce `isNotable` with OR so a
    // notable stamp from ANY state wins (matches upsertObservations' own
    // OR-coalesce for repeat runs).
    const byKey = new Map<string, (typeof inputs)[number]>();
    for (const input of inputs) {
      const key = `${input.subId}|${input.speciesCode}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.isNotable = existing.isNotable || input.isNotable;
      } else {
        byKey.set(key, input);
      }
    }
    const deduped = [...byKey.values()];

    // Invariant (issue #484): every observation we insert must have a matching
    // `species_meta` row, otherwise the read-api 404s on /api/species/:code for
    // a code the same API also returns from /api/observations. The check runs
    // BEFORE upsert so a leak aborts the whole batch — converting future eBird
    // hybrid/spuh additions into a loud CI/cron failure instead of a silent
    // prod 404. The error names every offending code so a triage agent can jump
    // straight to a `species_meta` backfill PR (see migration
    // 1700000032000_backfill_species_meta_spuh_hybrid.sql for the 10 codes this
    // fix unblocked).
    const speciesCodes = deduped.map(o => o.speciesCode);
    const missing = await findMissingSpeciesMeta(opts.pool, speciesCodes);
    if (missing.length > 0) {
      throw new Error(
        `ingest invariant violation: ${missing.length} observation species_code(s) ` +
        `have no species_meta row — refusing to insert observations the read-api ` +
        `cannot resolve. Missing codes: ${missing.join(', ')}. ` +
        `Fix: add species_meta rows for these codes (see issue #484 for the pattern).`
      );
    }

    const upserted = await upsertObservations(opts.pool, deduped);

    // Status ladder (#840): success = all states ok; partial = 1..threshold
    // failed; failure = >threshold failed. (429 circuit-break is handled in the
    // catch below — it throws, so it never reaches this branch as `partial`.)
    const statesFailed = failures.length;
    const status: RunSummary['status'] =
      statesFailed === 0 ? 'success'
        : statesFailed <= partialThreshold ? 'partial'
          : 'failure';
    const firstError = failures[0]?.error;

    await finishIngestRun(opts.pool, runId, {
      status,
      obsFetched: deduped.length,
      obsUpserted: upserted,
      ...(status !== 'success' && firstError !== undefined && { errorMessage: firstError }),
    });

    return {
      status,
      fetched: deduped.length,
      upserted,
      statesSucceeded,
      statesFailed,
      ...(failures.length > 0 && { failures: failures.slice(0, 10) }),
      ...(status === 'failure' && firstError !== undefined && { error: firstError }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishIngestRun(opts.pool, runId, {
      status: 'failure',
      errorMessage: msg,
    });
    return {
      status: 'failure',
      fetched: 0,
      upserted: 0,
      statesSucceeded,
      statesFailed: failures.length,
      ...(failures.length > 0 && { failures: failures.slice(0, 10) }),
      error: msg,
    };
  }
}
