#!/usr/bin/env tsx
import { pathToFileURL } from 'node:url';
import {
  createPool as realCreatePool,
  closePool as realClosePool,
  type Pool,
} from '@bird-watch/db-client';
import { runIngest as realRunIngest, type RunSummary } from './run-ingest.js';
import {
  runHotspotIngest as realRunHotspotIngest,
  type RunHotspotSummary,
} from './run-hotspots.js';
import {
  runBackfill as realRunBackfill,
  type RunBackfillSummary,
} from './run-backfill.js';
import {
  runTaxonomy as realRunTaxonomy,
  type RunTaxonomySummary,
} from './run-taxonomy.js';
import {
  runPhotos as realRunPhotos,
  type RunPhotosSummary,
} from './run-photos.js';
import {
  runDescriptions as realRunDescriptions,
  type RunDescriptionsSummary,
} from './run-descriptions.js';
import {
  runPrune as realRunPrune,
  type RunPruneSummary,
} from './run-prune.js';
import { runCacheWarm as realRunCacheWarm } from './run-cache-warm.js';
import { runDigest as realRunDigest, type SendResult } from './digest.js';
import {
  makeSendGridSender,
  makeNullMonitoringSignalsFetcher,
} from './digest-providers.js';
import { fetchWikipediaSummary as realFetchWikipediaSummary } from './wikipedia/client.js';
import { fetchInatTaxon as realFetchInatTaxon } from './inat/taxon-client.js';
import { pingHeartbeat as realPingHeartbeat } from './heartbeat.js';

/**
 * Every run summary discriminates on `status`. `RunBackfillSummary` can also be
 * `'partial'`, which we intentionally treat as non-failure — the job made
 * forward progress and Cloud Run Jobs should see it as success.
 */
type AnyRunSummary =
  | RunSummary
  | RunHotspotSummary
  | RunBackfillSummary
  | RunTaxonomySummary
  | RunPhotosSummary
  | RunDescriptionsSummary
  | RunPruneSummary;

/**
 * Injectable dependencies for `runCli`. In production `cli.ts`'s IIFE passes
 * the real pool/runner functions; tests pass stubs to drive specific branches
 * (including the silent-failure path that bit us in prod with PR #84).
 */
export interface CliDeps {
  createPool: (opts: { databaseUrl: string }) => Pool;
  closePool: (pool: Pool) => Promise<void>;
  runIngest: typeof realRunIngest;
  runHotspotIngest: typeof realRunHotspotIngest;
  runBackfill: typeof realRunBackfill;
  runTaxonomy: typeof realRunTaxonomy;
  runPhotos: typeof realRunPhotos;
  runDescriptions: typeof realRunDescriptions;
  runPrune: typeof realRunPrune;
  runCacheWarm: typeof realRunCacheWarm;
  runDigest?: typeof realRunDigest;
  fetchWikipediaSummary: typeof realFetchWikipediaSummary;
  fetchInatTaxon: typeof realFetchInatTaxon;
  pingHeartbeat?: typeof realPingHeartbeat;
  /**
   * Email sender for the `digest` kind. Production wires SendGrid via the
   * SENDGRID_API_KEY secret; tests inject a stub returning a canned
   * SendResult. Optional because every non-digest kind ignores it.
   *
   * `| undefined` is explicit because tsconfig's
   * `exactOptionalPropertyTypes: true` requires opt-in for the
   * "key present, value undefined" shape that the cli.ts IIFE uses when
   * SENDGRID_API_KEY isn't set (non-digest invocations).
   */
  sendDigestEmail?: ((subject: string, body: string) => Promise<SendResult>) | undefined;
  /**
   * Monitoring signals fetcher for the `digest` kind. Production wires the
   * real Cloud Monitoring + Cloud Logging clients; tests inject canned
   * MonitoringSignals. Optional because every non-digest kind ignores it.
   */
  fetchMonitoringSignals?: (() => Promise<
    import('./digest.js').MonitoringSignals
  >) | undefined;
}

/**
 * Executes one ingest run and returns without throwing for run-level failures.
 *
 * Sets `process.exitCode = 1` on `summary.status === 'failure'` so Cloud Run
 * Jobs record the job as failed. We do NOT call `process.exit(1)` — that would
 * kill the event loop before the `finally` block's `closePool(pool)` runs.
 * Setting `exitCode` lets the loop drain naturally and Node exits with that
 * code once the microtask queue is empty.
 *
 * Unknown-kind and missing-env errors still `throw`, matching the pre-fix
 * contract: those are programmer errors, not runner-level failures, and the
 * outer IIFE catches them to print a stack trace and exit 1.
 */
export async function runCli(kind: string, deps: CliDeps): Promise<void> {
  // Operator debug kinds that don't touch the DB or eBird short-circuit
  // ahead of the env guards below — that lets `probe-wiki` run from a
  // laptop without standing up `EBIRD_API_KEY`/`DATABASE_URL`. Same shape
  // as `probe-taxon` (sibling PR #369).
  if (kind === 'probe-wiki') {
    const title = process.argv[3];
    if (!title) throw new Error('probe-wiki requires a title argument');
    const summary = await deps.fetchWikipediaSummary(title);
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  // probe-taxon is an operator triage tool that hits iNat's /v1/taxa endpoint
  // directly — no DB, no eBird auth. Early-return ahead of the env guards so
  // an operator can `npx tsx services/ingestor/src/cli.ts probe-taxon "..."`
  // locally without setting EBIRD_API_KEY or DATABASE_URL in their shell.
  if (kind === 'probe-taxon') {
    const sciName = process.argv[3];
    if (!sciName) throw new Error('probe-taxon requires a binomial argument');
    const taxon = await deps.fetchInatTaxon(sciName);
    console.log(JSON.stringify(taxon, null, 2));
    return;
  }

  // cache-warm: post-ingestion Cloudflare cache-warm (issue #711). Pure HTTP
  // — no DB pool, no eBird API. Early-returns ahead of the EBIRD_API_KEY /
  // DATABASE_URL guards so a `gcloud run jobs execute bird-ingestor
  // --args=cache-warm` invocation does not require eBird/DB secrets to be
  // resolvable; the shared job ships both for parity, but skipping the
  // createPool() call here keeps cold-start fast and avoids holding a Cloud
  // SQL connection for the duration of the 77-URL walk.
  //
  // Heartbeat on completion (no failure path — the runner records per-URL
  // fetch failures into `summary.error` but does not throw, matching the
  // Healthchecks-on-success semantics every other kind follows).
  if (kind === 'cache-warm') {
    const baseUrl = process.env.CACHE_WARM_BASE_URL ?? 'https://api.bird-maps.com';
    const summary = await deps.runCacheWarm({ baseUrl });
    // Reuse the shared HEALTHCHECKS_URL_<KIND> env-var derivation pattern so
    // Terraform's existing for_each on local.healthchecks_kinds auto-wires
    // the env binding when "cache-warm" is added to the list.
    const envKey = `HEALTHCHECKS_URL_${kind.toUpperCase().replace(/-/g, '_')}`;
    const ping = deps.pingHeartbeat ?? realPingHeartbeat;
    await ping(process.env[envKey], kind);
    void summary; // returned for future log-line plumbing; not used here yet
    return;
  }

  // digest: daily 09:00 UTC health digest (issue #643). Distinct shape from
  // the ingest kinds — composes a 5-signal summary email and returns a
  // SendResult. Heartbeat is gated on result.status === 'delivered' per
  // analysis report §F7: SendGrid/SMTP can reject for SPF/DKIM/DMARC drift
  // even when the function returns 200, and the negative-space surveillance
  // requires the heartbeat to confirm delivery, not function-success.
  //
  // Branches BEFORE the EBIRD_API_KEY guard because the digest talks to
  // Postgres + Cloud Monitoring + SendGrid only — no eBird. DATABASE_URL is
  // still required (it queries ingest_runs for signal 1) so we re-check below.
  if (kind === 'digest') {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error('DATABASE_URL not set');
    const recipient = process.env.DIGEST_EMAIL_RECIPIENT;
    if (!recipient) throw new Error('DIGEST_EMAIL_RECIPIENT not set');
    if (!deps.sendDigestEmail) throw new Error('sendDigestEmail dep not provided');
    if (!deps.fetchMonitoringSignals) {
      throw new Error('fetchMonitoringSignals dep not provided');
    }
    const pool = deps.createPool({ databaseUrl: dbUrl });
    const runDigest = deps.runDigest ?? realRunDigest;
    try {
      const result = await runDigest({
        pool,
        emailRecipient: recipient,
        sendEmail: deps.sendDigestEmail,
        fetchMonitoringSignals: deps.fetchMonitoringSignals,
      });
      // Structured single-line log for the bird_digest_sent observability hook
      // referenced in the issue body. Keep this on stdout so Cloud Logging
      // captures it; downstream log-based metrics can filter on the message.
      console.log(JSON.stringify({
        message: 'bird_digest_sent',
        status: result.status,
        providerMessageId: result.providerMessageId ?? null,
        error: result.error ?? null,
      }));
      if (result.status === 'failed') {
        process.exitCode = 1;
        return;
      }
      // ONLY `delivered` triggers the heartbeat. `queued` defers to a
      // follow-up delivery-confirmation webhook caller (if/when that's
      // wired) — the function exits 0 but does NOT mark itself "alive" on
      // Healthchecks.io.
      if (result.status === 'delivered') {
        const ping = deps.pingHeartbeat ?? realPingHeartbeat;
        await ping(process.env.HEALTHCHECKS_URL_DIGEST, 'digest');
      }
      return;
    } finally {
      await deps.closePool(pool);
    }
  }

  const apiKey = process.env.EBIRD_API_KEY;
  const dbUrl = process.env.DATABASE_URL;
  // `prune` and `photos`/`descriptions` style DB-only kinds don't strictly
  // require EBIRD_API_KEY, but keeping a single env contract for the shared
  // image keeps Cloud Run Job configuration uniform — secrets are wired once
  // on the `bird-ingestor-*` jobs and reused across kinds. Only DATABASE_URL
  // is genuinely required for prune; EBIRD_API_KEY is enforced uniformly to
  // catch a misconfigured job before the runner discovers it.
  if (!apiKey) throw new Error('EBIRD_API_KEY not set');
  if (!dbUrl) throw new Error('DATABASE_URL not set');

  const pool = deps.createPool({ databaseUrl: dbUrl });
  // Capture wall-clock start AFTER probe early-returns and env-guard checks so
  // `duration_seconds` measures only real run work — not setup or probe paths.
  const startedAt = Date.now();
  try {
    let summary: AnyRunSummary;
    // For the per-state backfill fan-out, capture the resolved regionCode so
    // the run-completion summary log carries `state` as a structured
    // jsonPayload field. Cloud Logging queries like
    // `jsonPayload.state="US-CA"` then partition per-state runs cleanly —
    // see scripts/verify-backfill.sh.
    let backfillState: string | undefined;
    if (kind === 'recent') {
      // Per-state fan-out (#840): runIngest loops CONUS_STATE_CODES internally
      // (one /recent + /recent/notable per state) because eBird's region-recent
      // endpoint dedups to one-observation-per-species region-wide — a single
      // 'US' call starved every non-AZ state. paceMs defaults to 1000ms inside
      // runIngest, applied as ONE inter-round pause per state (recent + notable
      // fire concurrently per round), so ~48 pauses × 1s ≈ 48s of pacing — well
      // under the 900s job timeout. (The two endpoints per state make ~98 HTTP
      // calls total, but they're not serialized 1s apart; the pacing is the ~48
      // inter-round sleeps, not the call count.) The status ladder (success |
      // partial | failure) is keyed on per-state failure count + 429
      // circuit-break, and `partial` still pings the success heartbeat below
      // (only `failure` skips it).
      summary = await deps.runIngest({ pool, apiKey });
    } else if (kind === 'hotspots') {
      summary = await deps.runHotspotIngest({ pool, apiKey, regionCode: 'US-AZ' });
    } else if (kind === 'backfill') {
      // Phase 3.5 per-state fan-out (plan: ~/.claude/plans/are-we-ready-to-starry-dove.md).
      // Optional CLI flags --state=US-XX (default US-AZ to preserve the
      // existing prod scheduler's no-flag invocation) and --back=N (default
      // 19 with no flags, so the legacy daily backfill keeps its current
      // window; new per-state schedulers pass --back=14 explicitly).
      // --state also accepts eBird subnational2 (county) codes of the form
      // US-XX-NNN or US-XX-AAA — needed because a per-day full-state
      // /historic call can blow past eBird's response-size limit (HTTP 500
      // on large states like CA), and the mitigation is to fan out per
      // county.
      // argv shape: ["node", "cli.ts", "backfill", "--state=US-CA", "--back=14"]
      //         or: ["node", "cli.ts", "backfill", "--state=US-CA-001", "--back=14"].
      const flags = process.argv.slice(3);
      let regionCode = 'US-AZ';
      let days = 19;
      for (const f of flags) {
        if (f.startsWith('--state=')) {
          const v = f.slice('--state='.length);
          if (!/^US-[A-Z]{2}(-[A-Z0-9]+)?$/.test(v)) {
            console.log(JSON.stringify({
              severity: 'ERROR',
              message: 'bird_ingest_invalid_flag',
              flag: '--state',
              value: v,
              expected: 'US-XX (state) or US-XX-NNN (county/subnational2)',
            }));
            process.exitCode = 1;
            return;
          }
          regionCode = v;
        } else if (f.startsWith('--back=')) {
          const raw = f.slice('--back='.length);
          const n = Number.parseInt(raw, 10);
          if (!Number.isInteger(n) || n < 1 || n > 30 || String(n) !== raw) {
            console.log(JSON.stringify({
              severity: 'ERROR',
              message: 'bird_ingest_invalid_flag',
              flag: '--back',
              value: raw,
              expected: 'integer 1-30 (eBird /data/obs/{region}/recent cap)',
            }));
            process.exitCode = 1;
            return;
          }
          days = n;
        } else {
          console.log(JSON.stringify({
            severity: 'ERROR',
            message: 'bird_ingest_invalid_flag',
            flag: f,
            expected: '--state=US-XX[-NNN] or --back=N',
          }));
          process.exitCode = 1;
          return;
        }
      }
      backfillState = regionCode;
      summary = await deps.runBackfill({ pool, apiKey, regionCode, days });
    } else if (kind === 'backfill-extended') {
      // 'backfill-extended': one-shot 365-day backfill at 1 rps; this is NOT
      // scheduled — it's an operator-triggered one-shot to populate historical
      // phenology data. See run-backfill.ts paceMs comment.
      //
      // Wall time is ~364s (paceMs=1000 between calls 2..365, plus per-call
      // fetch + upsert work). The shared `bird-ingestor` Cloud Run job has
      // `timeout = "300s"` — see infra/terraform/ingestor.tf:91 — so the
      // default execution will be killed by Cloud Run after ~300 days,
      // silently producing a partial backfill. Override the per-execution
      // timeout to 600s when invoking this kind:
      //
      //   gcloud run jobs execute bird-ingestor \
      //     --args=backfill-extended \
      //     --task-timeout=600s \
      //     --region=us-west1 --project=bird-maps-prod --wait
      //
      // The `--task-timeout` flag overrides the Terraform default for one
      // execution only and does not require a Terraform apply. Splitting into
      // two runs (days 1-180 then 181-365) is also acceptable, but the
      // override is cleaner.
      summary = await deps.runBackfill({
        pool, apiKey, regionCode: 'US-AZ', days: 365, paceMs: 1_000,
      });
    } else if (kind === 'taxonomy') {
      summary = await deps.runTaxonomy({ pool, apiKey });
    } else if (kind === 'photos') {
      summary = await deps.runPhotos({ pool });
    } else if (kind === 'descriptions') {
      summary = await deps.runDescriptions({ pool });
    } else if (kind === 'prune') {
      // 14-day rolling retention by default; OBSERVATIONS_RETENTION_DAYS
      // overrides at the job level (set via Cloud Run Job env in Terraform
      // when the operator needs a different window without a redeploy).
      const raw = process.env.OBSERVATIONS_RETENTION_DAYS;
      const parsed = raw === undefined ? undefined : Number.parseInt(raw, 10);
      if (parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
        throw new Error(`OBSERVATIONS_RETENTION_DAYS must be a positive integer; got ${raw}`);
      }

      // GCS archive wiring. The bucket name is fixed by infra (T1) — single
      // tenant, no env override surface needed. ADC inside Cloud Run reaches
      // GCS via the ingestor SA's bucket bindings (T1 IAM members:
      // roles/storage.objectCreator + roles/storage.objectViewer).
      //
      // Dynamic import: keeps the @google-cloud/storage SDK (heavy ESM init,
      // ~118 transitive packages) out of the cold path for every non-prune
      // kind. The prune Cloud Run Job pays the import cost once per run.
      const ARCHIVE_BUCKET = 'bird-maps-prod-obs-archive';
      const { Storage } = await import('@google-cloud/storage');
      const storage = new Storage();
      const bucket = storage.bucket(ARCHIVE_BUCKET);
      const { archiveAndUpload } = await import('./archive/index.js');

      summary = await deps.runPrune({
        pool,
        ...(parsed === undefined ? {} : { retentionDays: parsed }),
        archiveDay: async (utcDate, rows) => {
          const r = await archiveAndUpload({
            bucket,
            bucketName: ARCHIVE_BUCKET,
            utcDate,
            rows,
          });
          return { gcsPath: r.gcsPath, bytes: r.bytes };
        },
      });
    } else {
      throw new Error(`Unknown kind: ${kind}. Try recent | hotspots | backfill | backfill-extended | taxonomy | photos | descriptions | prune | cache-warm | digest | probe-taxon | probe-wiki`);
    }
    // Cloud Run / Cloud Logging splits stdout on newlines and treats each
    // resulting line as its own `textPayload` entry — pretty-printed JSON
    // therefore shreds into N rows with zero `jsonPayload.*` coverage, and
    // any log-based metric that depends on `jsonPayload.message` is silently
    // empty. Emit a single compact line carrying the fields the dashboard's
    // log-based metrics extract (see issue #641 + epic #638, PR-2 in #642).
    // Sibling pattern: `services/read-api/src/app.ts:161` (meta_freshness).
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
    // Per-state fan-out degradation (#840 review): a `partial` recent run pings
    // the SUCCESS heartbeat (correctly — the map made forward progress), so the
    // ONLY aggregate signal that it was degraded is this line. Without the
    // failed-state count here, a degraded-but-green run reads as a clean INFO
    // line and the silent-degradation is invisible — the same class of bug that
    // hid the original single-region starve. Surface `statesFailed` + the failed
    // state codes whenever any state failed (covers `partial` AND the per-state
    // `failure` path; `summary.error` is only set on `failure`, so a `partial`
    // run otherwise carried no error context at all).
    const statesFailed =
      'statesFailed' in summary && typeof summary.statesFailed === 'number'
        ? summary.statesFailed
        : 0;
    const failedStates =
      'failures' in summary && Array.isArray(summary.failures)
        ? summary.failures.map(f => f.state)
        : [];
    const firstFanoutError =
      'failures' in summary && Array.isArray(summary.failures)
        ? summary.failures[0]?.error
        : undefined;
    console.log(JSON.stringify({
      severity: summary.status === 'failure' ? 'ERROR' : 'INFO',
      message: 'bird_ingest_run_completed',
      kind,
      status: summary.status,
      duration_seconds: durationSeconds,
      // Per-state backfill (Phase 3.5): emit `state` as a top-level jsonPayload
      // field so Cloud Logging can filter by `jsonPayload.state="US-CA"`.
      // Omitted for non-backfill kinds to keep the structured shape minimal.
      ...(backfillState !== undefined && { state: backfillState }),
      // Per-state fan-out: emit the degraded-state count + codes ONLY when there
      // is degradation to surface (mirrors the conditional `state` shape above).
      ...(statesFailed > 0 && { statesFailed, failedStates: failedStates.slice(0, 10) }),
      // Surface the first error in the run-completed summary so Cloud Logging
      // triage doesn't require joining against the per-state/per-day WARNING
      // lines. `summary.error` covers fatal pre-loop / >threshold failure; the
      // per-state `failures[0].error` covers the `partial` path where
      // `summary.error` is unset.
      ...((() => {
        const err =
          summary.status !== 'success' && 'error' in summary && typeof summary.error === 'string'
            ? summary.error
            : firstFanoutError;
        return err !== undefined ? { firstError: err.slice(0, 500) } : {};
      })()),
    }));
    if (summary.status === 'failure') {
      // Flag the process as failed without killing the loop mid-pool-close.
      process.exitCode = 1;
    } else {
      // Success or partial: ping the per-kind heartbeat. Healthchecks.io
      // (or equivalent) fires alerts on MISSED pings, so we MUST NOT ping
      // on failure — see docs/plans/2026-05-17-monitoring-and-alerts.md §S7.
      const envKey = `HEALTHCHECKS_URL_${kind.toUpperCase().replace(/-/g, '_')}`;
      const ping = deps.pingHeartbeat ?? realPingHeartbeat;
      await ping(process.env[envKey], kind);
    }
  } finally {
    await deps.closePool(pool);
  }
}

// Only run the IIFE when invoked as a script, not when imported by tests.
// `import.meta.url` resolves to this file; `pathToFileURL(process.argv[1])`
// is the entry point the user ran. When they match, this is the CLI
// entrypoint. Using pathToFileURL is the canonical Node idiom and handles
// Windows paths correctly (vs. naively prefixing with `file://`).
const isEntrypoint = (() => {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return pathToFileURL(argv1).href === import.meta.url;
  } catch {
    return false;
  }
})();

if (isEntrypoint) {
  const KIND = process.argv[2] ?? 'recent';
  // SendGrid sender is constructed lazily only for the digest kind — the
  // SENDGRID_API_KEY secret is wired only on the bird-digest-daily Cloud Run
  // Job, and a missing key on a non-digest invocation must NOT throw at
  // module-load time. The factory returns a sender that itself throws on
  // first call, so non-digest kinds never even construct it.
  const sendDigestEmail: CliDeps['sendDigestEmail'] =
    process.env.SENDGRID_API_KEY && process.env.DIGEST_EMAIL_RECIPIENT
      ? makeSendGridSender({
          apiKey: process.env.SENDGRID_API_KEY,
          recipient: process.env.DIGEST_EMAIL_RECIPIENT,
          from: process.env.DIGEST_FROM_ADDRESS ?? 'digest@bird-maps.com',
        })
      : undefined;
  runCli(KIND, {
    createPool: realCreatePool,
    closePool: realClosePool,
    runIngest: realRunIngest,
    runHotspotIngest: realRunHotspotIngest,
    runBackfill: realRunBackfill,
    runTaxonomy: realRunTaxonomy,
    runPhotos: realRunPhotos,
    runDescriptions: realRunDescriptions,
    runPrune: realRunPrune,
    runCacheWarm: realRunCacheWarm,
    runDigest: realRunDigest,
    sendDigestEmail,
    fetchMonitoringSignals: makeNullMonitoringSignalsFetcher(),
    fetchWikipediaSummary: realFetchWikipediaSummary,
    fetchInatTaxon: realFetchInatTaxon,
  }).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
