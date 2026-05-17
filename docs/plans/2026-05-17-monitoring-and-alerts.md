# Monitoring & Alerts for Ingest Pipeline + Read API

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax. This plan assumes zero prior context — every task lists exact file paths, full HCL, expected commands, and a commit-message template.

**Date:** 2026-05-17
**Author:** Julian (orchestrated)
**Live infra:** bird-maps.com (GCP `bird-maps-prod`, region `us-west1`, Cloudflare account `bcbb962d…`, Neon `org-green-boat-15736536`)

**Goal:** Close the "failure observability is rich; failure subscription is empty" gap (Theme 1, `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md`). Today the system has zero `google_monitoring_alert_policy`, zero notification channels, zero uptime checks. 42 consecutive non-zero ingest job exits went unnoticed before the audit caught them manually; data-staleness drift on `meta.freshestObservationAt` was rediscovered by accident. Hacker-News-scale national launch is imminent and inbound; landing this **before** national is the highest-ROI move available (~$0.03/mo, ~2h PR per Rec 0A in the report).

**Architecture:** All alerting flows through Google Cloud Monitoring (already present in `bird-maps-prod`, no new project enabled). A single email notification channel to `julian.kennon.d@gmail.com` is the only subscriber for v1. Each signal becomes one `google_monitoring_alert_policy` keyed off built-in Cloud Run / Cloud Run Jobs metrics OR a log-based metric extracted from the existing structured logs. One out-of-band heartbeat (Healthchecks.io free tier) catches "scheduled job never ran" — Cloud Monitoring cannot detect a Scheduler invocation that never happened, because the absence of an event is not itself an event in Cloud Monitoring's model. The Shape 2 species-rollup contract probe (Open Question O2 from the report) is a GitHub Actions scheduled workflow — see §"Shape 2 re-sample" below for the fold-vs-sibling decision.

**Tech stack:** `hashicorp/google` provider (already pinned, version per `infra/terraform/versions.tf`); Cloud Monitoring built-in metrics + log-based metrics; one external SaaS (`healthchecks.io`, free tier — 20 checks, more than we'll ever need). No new app code changes for v1 beyond a single `fetch()` ping at the end of each successful ingest run.

---

## Background and motivation

Two independent signals pointed at the same hole this week:

1. **Analysis-funnel finding (Theme 1).** The phase-4 report found that the ingestor's `RunSummary.status === 'failure'` branch sets `process.exitCode = 1` (services/ingestor/src/cli.ts:151) and Cloud Run Jobs faithfully record the execution as failed — but nothing subscribes to that signal. 42 consecutive failed executions of `bird-ingest-recent` had piled up before a human noticed. The deaf-system property compounds quadratically with scale: at HN-launch traffic, a silently-failing ingestor produces a silently-stale map.
2. **Today's session.** `meta.freshestObservationAt` slipping past 6h was rediscovered manually — the same drift class the August 2026 funnel ran on. No alert, no email, no Slack ping; just a curl by a human who happened to look.

Recommendation 0A in the analysis report scores this as the highest-ROI move available pre-national: ~$0.03/mo Cloud Monitoring cost (free tier covers all of v1's alerts), ~2h PR, full coverage of the seven signals listed below. The cost of NOT landing it before national is unbounded: a silent failure during a Hacker News spike turns the front page into a stale-data demo.

### Resolved design decisions (plan invariants)

1. **Single notification channel for v1: email to `julian.kennon.d@gmail.com`.** SMS/PagerDuty/Slack are future iterations. Email is sufficient for a single-operator system pre-team. Channel is provisioned via Terraform so it's reproducible and not a click-ops artifact.
2. **Alerts express thresholds, not symptoms.** Every alert ships with a written threshold-rationale comment in the HCL. Bad thresholds cause alert fatigue and the system becomes deaf again — same end state as today. See §"Threshold rationale" below.
3. **Cloud Monitoring built-in metrics first, log-based second.** Built-ins (`run.googleapis.com/job/completed_task_attempt_count`, `run.googleapis.com/request_count`, etc.) are stable, low-latency, and free. Log-based metrics are used only where the built-in surface is insufficient (e.g. `meta.freshestObservationAt` staleness — that lives in the DB, not in a metric).
4. **Heartbeat for "scheduled job never ran" is out-of-band.** Healthchecks.io free tier. One ping per successful run at end-of-cli; missing ping = job didn't even start. Cloud Monitoring's alerting model is event-driven and cannot natively express "no event in the last N minutes" for a non-metric signal — the canonical GCP workaround is also a heartbeat metric, but Healthchecks.io is simpler, has zero infra cost, and ships an email-on-miss for free.
5. **Shape 2 re-sample is a sibling plan, not folded.** It's a 9-curl probe, runs weekly, has its own GitHub Actions surface and its own assertion semantics. Folding it into a Cloud Monitoring plan inflates scope without simplifying anything. See §"Shape 2 re-sample probe" below for the sibling plan stub.
6. **No SLO objects in v1.** `google_monitoring_slo` + burn-rate alerting is the correct shape for a team running on-call; for a single-operator pre-national system, raw alert policies are simpler to reason about and tune. SLOs land in a follow-up plan once we have ≥30 days of green baseline data to anchor an objective on.

---

## Signals to alert on (v1)

| # | Signal | Source | Threshold | Rationale |
|---|---|---|---|---|
| S1 | Ingest job non-zero exit | `run.googleapis.com/job/completed_execution_count` filtered by `result="failed"` | ≥1 failed execution in rolling 1h | The ingestor's failure mode is per-execution. One failure is recoverable (transient eBird 5xx), two-in-a-row is the start of the 42-execution silence. 1h window matches the `*/30` cron — anything ≤1h is below sampling resolution. |
| S2 | Data-staleness | Log-based metric extracted from a new `/internal/meta` periodic poll, OR direct probe (see Task 5) | `freshestObservationAt` older than 6h | Recent-ingest fires every 30min; eBird observations land within ~5-15min of submission; AZ is a high-volume region with sub-hour gaps. 6h staleness means at least 12 consecutive recent-ingest runs failed to make forward progress. Below 6h is noise (legitimate quiet hours); above 12h is too late (a full overnight outage). |
| S3 | Read-API 5xx rate | `run.googleapis.com/request_count` filtered by `response_code_class="5xx"` | >1% of requests in rolling 5min, min 20 requests | 1% is the standard "bad day" threshold for a public API. The 20-request minimum prevents a single 5xx during a low-traffic minute from firing (1/1 = 100%). 5min window catches a real incident within one cron interval. |
| S4 | Read-API p95 latency | `run.googleapis.com/request_latencies` distribution, percentile 95 | >2000ms over rolling 10min | Current p95 is ~150-300ms (per phase-4 report). 2000ms is the "user notices and tabs away" threshold. 10min window smooths over cold-start spikes (Cloud Run scale-to-zero) without missing a real degradation. |
| S5 | Cloud Run instance crash / OOM | Log-based metric on `severity>=ERROR` matching `Container terminated` OR `out of memory` in `bird-read-api` OR `bird-ingestor*` logs | ≥1 in rolling 1h | Crashes are always notable — they're either an OOM (need to bump memory) or an unhandled exception (need to fix code). 1h batches transient flaps into one notification. |
| S6 | Neon connection failure | Log-based metric on log entries matching `getaddrinfo ENOTFOUND` OR `ECONNREFUSED` OR `Connection terminated unexpectedly` against `bird-*` services | ≥3 in rolling 10min | Single transient connection drops happen on serverless-Postgres (Neon free tier suspends idle endpoints). Three in 10min means the pool is genuinely broken, not just suspending. Threshold tightens to ≥1 once Cloud SQL migration lands (sibling plan; Cloud SQL doesn't suspend, so a single ENOTFOUND is a real incident). |
| S7 | Heartbeat miss — ingest cron didn't fire | Healthchecks.io check for `bird-ingest-recent` | No ping in 40min (cron is 30min + 10min grace) | Cloud Monitoring cannot detect "scheduled invocation that never happened" — the absence of a Cloud Scheduler event is not itself an event in the alert-policy model. Healthchecks.io's whole purpose is the inverse trigger. 30min cron + 10min grace covers Cloud Run Jobs cold-start + a real 5min run. The other crons (backfill daily, hotspots weekly, taxonomy monthly, photos monthly, descriptions daily) each get their own heartbeat with cadence-appropriate grace. |

**Why no alert on `is_notable`-intersection failure (the CLAUDE.md bullet about the dual eBird call):** S1 already covers it — that codepath sets `exitCode=1` on the same surface S1 listens to. Adding a separate alert would be a duplicate notification on the same failure.

**Why no alert on Cloudflare zone egress / Worker CPU:** Workers are flat-rate per request on the free-tier-equivalent (`infra/workers/photo-server.js`, `silhouette-server.js`); a runaway Worker bills before it pages anyone. Not v1.

---

## Heartbeat strategy (S7)

Why an out-of-band SaaS instead of a Cloud Monitoring approach:

- **Cloud Monitoring cannot natively detect a scheduled-job no-show.** The supported workaround is to emit a heartbeat metric from inside the job and alert on its absence (`absent_for` condition). That works but requires (a) shipping a custom metric per job, (b) explaining a double-negative threshold in HCL, and (c) trusting Cloud Monitoring's metric-write path — which is the same path that just failed if Cloud Run is the underlying failure.
- **Healthchecks.io is purpose-built for the inverse case.** Free tier covers 20 checks (we use 5-6). Each check has a URL the job pings on success; if no ping arrives within `period + grace`, Healthchecks.io emails. Same exact UX as Cloud Monitoring email, fewer moving parts, decoupled from GCP failure modes.
- **Better Stack alternative considered.** Better Stack's free tier is shape-equivalent but their email-on-miss has a documented ~5min delay vs. Healthchecks.io's near-immediate fire. For a 30min cron + 10min grace, both fit; Healthchecks.io wins on simplicity (no team account, no extra dashboard).

Implementation: each successful run-cli ends with a `fetch(process.env.HEALTHCHECKS_URL + '/' + kind)` — one URL per cron (`recent`, `backfill`, `hotspots`, `taxonomy`, `photos`, `descriptions`). The URL is provisioned out-of-band via the Healthchecks.io web UI and stored in Secret Manager as `bird-watch-healthchecks-url`. Failure to ping is logged but never throws — the heartbeat is best-effort and must not affect the job's exit code (S1 is the source of truth for exit-code failures; S7 is the source of truth for cron no-shows).

---

## Shape 2 re-sample probe (sibling plan)

The phase-4 report's Open Question O2 calls for a recurring re-sample of the species-rollup behavior in `/data/obs/{region}/recent`: 9 curls, weekly through fall migration, asserting that row counts match per-species rollup expectations. If this contract silently breaks, the entire 50-state architecture flips.

**Decision: sibling plan, not folded into this one.** Reasons:

1. **Different cadence, different signal.** Monitoring alerts fire on metrics over rolling minutes; the Shape 2 probe is a boolean assertion over a fixed 9-call output, evaluated weekly. The alert-policy data model is the wrong shape for an integration test masquerading as a probe.
2. **Different infra surface.** Cloud Monitoring's alerts live in `infra/terraform/`; an HTTP-probe-with-JSON-shape-assertion lives more naturally in `.github/workflows/` as a scheduled workflow (the eBird API key is already a CI secret, the assertion logic is plain TypeScript or jq). Folding it into Terraform would require either a custom Cloud Run Job (overkill) or a synthetic Cloud Monitoring uptime check (can't express shape assertions, only response-code/keyword match).
3. **Independent execution.** The Shape 2 probe can ship before or after this plan with zero dependency.

The sibling plan stub:

- **File:** `docs/plans/2026-05-17-shape-2-rollup-probe.md` (write this as a separate plan; outside this plan's scope).
- **Shape:** GitHub Actions workflow, `cron: '0 14 * * 1'` (every Monday 14:00 UTC). 9 curls against `/data/obs/{US-AZ,US-TX,US-CA,US-NY,US-FL,US-WA,US-MA,US-IL,US-CO}/recent` (the 9-region sample matches the O2 spec). Asserts on row-count parity with the per-species rollup endpoint. Single boolean + per-region counts to job output; fails the workflow (and therefore emails) on falsy.
- **Cost:** $0 (GitHub Actions free tier covers it; 1 workflow × 4 runs/mo × <1min wallclock).

This plan does not block on the sibling plan landing.

---

## Threshold rationale (consolidated)

Every alert above ships with a `comment` block in HCL stating its rationale (excerpted from the table). The rationale block is mandatory — alert thresholds drift from "calibrated" to "vestigial" within 6 months unless the original calibration is written down. The 60-day kill-threshold metric from the drift system (`closed-as-fixed / closed-total < 40%`) applies here too: if alert-fire-to-incident-resolution drops below 40% (i.e. 6 of 10 fires are false alarms), evaluate downgrading the noisiest policy and file a retrospective at `docs/analyses/<date>-alert-fatigue-retrospective.md`.

---

## File structure

| Path | Disposition | Responsibility |
|---|---|---|
| `infra/terraform/monitoring.tf` | Create | Notification channel + all 6 alert policies (S1–S6). Uptime check on read-api root. Log-based metrics where required (S2, S5, S6). |
| `infra/terraform/variables.tf` | Modify | Add `variable "alert_email"` (default `julian.kennon.d@gmail.com`); add `variable "healthchecks_recent_url"` and 5 siblings (sensitive). |
| `infra/terraform/terraform.tfvars.example` | Modify | Document the new vars and how to mint Healthchecks.io URLs. |
| `infra/terraform/ingestor.tf` | Modify | Add `env { name = "HEALTHCHECKS_URL_<KIND>" ... }` to each of the 4 ingest-job container blocks (`ingestor`, `ingestor_photos`, `ingestor_descriptions`; plus the shared `ingestor` covers `recent`/`backfill`/`hotspots`/`taxonomy` via overrides). Wire each to its own Secret Manager secret. |
| `services/ingestor/src/heartbeat.ts` | Create | Pure function `pingHeartbeat(url: string \| undefined, kind: string, fetcher = fetch): Promise<void>`. Best-effort; logs on failure, never throws. |
| `services/ingestor/src/heartbeat.test.ts` | Create | Unit tests: undefined URL → no-op; 200 response → resolves; 5xx response → resolves with warn log; network error → resolves with warn log; verifies fetcher is called with `${url}` and `method: 'POST'`. |
| `services/ingestor/src/cli.ts` | Modify | After successful `runCli` (i.e. `summary.status === 'success'` or `'partial'`), call `pingHeartbeat(process.env[`HEALTHCHECKS_URL_${kind.toUpperCase()}`], kind)`. Do NOT ping on failure — the absence of a heartbeat IS the alert. |
| `services/ingestor/src/cli.test.ts` | Modify | Add test: success path calls heartbeat with the expected URL; failure path does NOT call heartbeat. |
| `docs/runbooks/monitoring.md` | Create | Operator runbook: what each alert means, what to check first, how to mute during planned maintenance (Healthchecks.io: pause check; Cloud Monitoring: snooze policy via console). Includes the threshold-rationale table from this plan, verbatim. |
| `docs/plans/2026-05-17-monitoring-and-alerts.md` | Create | This plan. |

---

## Critical-path checkpoints

Tasks land in CI-green order. Branch protection requires `test`, `lint`, `build`, `e2e` green on every PR.

1. **Heartbeat module + cli wiring** (Tasks 1-2). Pure code, fully unit-testable, no infra. CI green.
2. **Terraform additions** (Tasks 3-5). Notification channel first (no policy depends on it being applied first, but apply order is cleanest this way), then alert policies in a single PR. Apply via the existing operator-`terraform apply` flow. CI green (no app surface touched).
3. **Healthchecks.io secret provisioning** (Task 6). Out-of-band: operator creates 6 checks in the Healthchecks.io UI, writes the resulting URLs into Secret Manager via `gcloud secrets versions add`. Plan documents the exact commands; no code/Terraform change in this task.
4. **End-to-end smoke** (Task 7). Manually trigger each alert (lower threshold temporarily, force a failure, confirm email arrives, restore threshold). Documented in the runbook.

---

## Task breakdown

### Task 1 — `feat(ingestor): heartbeat module (best-effort ping)`

- [ ] **Read** `services/ingestor/src/cli.ts` lines 1-50 and 145-160 for the exit-code surface.
- [ ] **Write failing test:** `services/ingestor/src/heartbeat.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import { pingHeartbeat } from './heartbeat.js';

describe('pingHeartbeat', () => {
  it('is a no-op when url is undefined', async () => {
    const fetcher = vi.fn();
    await pingHeartbeat(undefined, 'recent', fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('POSTs to the configured url on success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    await pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('https://hc.io/abc', { method: 'POST' });
  });

  it('swallows 5xx without throwing', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response);
    await expect(pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch))
      .resolves.toBeUndefined();
  });

  it('swallows network errors without throwing', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Run:** `npm test --workspace @bird-watch/ingestor -- heartbeat` → confirm 4 failures.
- [ ] **Write minimal implementation:** `services/ingestor/src/heartbeat.ts`

```ts
/**
 * Best-effort heartbeat ping to Healthchecks.io (or equivalent).
 *
 * Pings are fire-and-forget: a failure to ping does not change the ingest
 * job's exit code. The semantics are inverse-of-presence: if Healthchecks.io
 * sees a ping, the job ran to success; if it doesn't, Healthchecks.io fires
 * the alert (we never need to fire one ourselves).
 *
 * Why `fetcher` is injectable: lets tests pass a mock without touching
 * global fetch state, which is otherwise leaked across tests in the same
 * vitest worker.
 */
export async function pingHeartbeat(
  url: string | undefined,
  kind: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!url) return;
  try {
    const res = await fetcher(url, { method: 'POST' });
    if (!res.ok) {
      console.warn(`[heartbeat] ${kind}: non-2xx response ${res.status}`);
    }
  } catch (err) {
    console.warn(`[heartbeat] ${kind}: network error`, err);
  }
}
```

- [ ] **Run:** `npm test --workspace @bird-watch/ingestor -- heartbeat` → 4/4 pass.
- [ ] **Commit:**

```
feat(ingestor): heartbeat module (best-effort ping)

New pure function pingHeartbeat(url, kind, fetcher) that POSTs to a
Healthchecks.io URL on successful ingest completion. Best-effort: a
failed ping never changes the job's exit code. Heartbeat absence is the
alert signal (S7 in docs/plans/2026-05-17-monitoring-and-alerts.md).
```

### Task 2 — `feat(ingestor): wire heartbeat into cli.ts success path`

- [ ] **Edit** `services/ingestor/src/cli.ts`:
  - Add `import { pingHeartbeat } from './heartbeat.js';` at top.
  - After the `console.log(JSON.stringify(summary, null, 2));` line and the `if (summary.status === 'failure') process.exitCode = 1;` block, add an else-branch:

```ts
    } else {
      // Success or partial: ping the per-kind heartbeat. Healthchecks.io
      // (or equivalent) fires alerts on MISSED pings, so we MUST NOT ping
      // on failure — see docs/plans/2026-05-17-monitoring-and-alerts.md S7.
      const envKey = `HEALTHCHECKS_URL_${kind.toUpperCase().replace(/-/g, '_')}`;
      await pingHeartbeat(process.env[envKey], kind);
    }
```

  - This sits inside the existing `if (summary.status === 'failure') { ... } else { ... }` shape — refactor the existing single-line `if` into a block-form `if/else`.

- [ ] **Write failing test:** extend `services/ingestor/src/cli.test.ts` with two cases — success branch calls heartbeat, failure branch does not. Inject a spy via the `CliDeps` shape (extend `CliDeps` with `pingHeartbeat?: typeof pingHeartbeat`; default to real impl).
- [ ] **Run:** `npm test --workspace @bird-watch/ingestor` → confirm 2 new failures, then pass after wiring.
- [ ] **Commit:**

```
feat(ingestor): ping heartbeat on success, never on failure

cli.ts now invokes pingHeartbeat at the end of a successful run, keyed
off env var HEALTHCHECKS_URL_<KIND>. Failure path remains unchanged:
process.exitCode=1 surfaces via S1 alert (Cloud Run Jobs failed-count
metric); heartbeat absence surfaces via S7 (Healthchecks.io).
```

### Task 3 — `infra(monitoring): notification channel + variables`

- [ ] **Context7 check:** fetch latest `hashicorp/google` provider docs for `google_monitoring_notification_channel`, `google_monitoring_alert_policy`, `google_monitoring_uptime_check_config`, `google_logging_metric`. Resource attribute names move; verify before quoting.
- [ ] **Edit** `infra/terraform/variables.tf`:

```hcl
variable "alert_email" {
  description = "Email address to receive monitoring alerts. v1: single subscriber; team channel routing is a future iteration."
  type        = string
  default     = "julian.kennon.d@gmail.com"
}

# Healthchecks.io ping URLs — one per cron job. Provisioned out-of-band via
# the Healthchecks.io web UI (free tier: 20 checks), then stored in Secret
# Manager via `gcloud secrets versions add bird-watch-healthchecks-<kind>
# --data-file=-`. Plan: docs/plans/2026-05-17-monitoring-and-alerts.md §S7.
# These vars are NOT referenced by HCL — they document the secret-id contract
# only. The secrets themselves are declared in infra/terraform/monitoring.tf.
```

- [ ] **Edit** `infra/terraform/terraform.tfvars.example` — add the same docs.
- [ ] **Create** `infra/terraform/monitoring.tf` with the notification channel and (initially) one secret declaration:

```hcl
# ── Notification channels ────────────────────────────────────────────────
#
# Single subscriber for v1: julian.kennon.d@gmail.com. SMS, PagerDuty, Slack
# are future iterations. The channel resource is provisioned via Terraform so
# every alert policy below can reference it without click-ops drift.

resource "google_monitoring_notification_channel" "email_julian" {
  display_name = "Julian (email)"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

# ── Healthchecks.io secret manifests ─────────────────────────────────────
#
# One Secret Manager secret per cron. Values are populated out-of-band:
#   gcloud secrets versions add bird-watch-healthchecks-recent \
#     --data-file=- <<< "https://hc-ping.com/<uuid>"
# Terraform declares the secret + IAM binding; the URL itself never lands
# in tfvars or state. Mirrors the R2-credentials pattern in ingestor.tf.

locals {
  healthchecks_kinds = ["recent", "backfill", "hotspots", "taxonomy", "photos", "descriptions"]
}

resource "google_secret_manager_secret" "healthchecks_url" {
  for_each  = toset(local.healthchecks_kinds)
  secret_id = "bird-watch-healthchecks-${each.key}"
  replication { auto {} }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "ingestor_healthchecks" {
  for_each  = google_secret_manager_secret.healthchecks_url
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}
```

- [ ] **Verify:** `cd infra/terraform && terraform fmt -check && terraform validate` → pass. (Apply happens at Task 6 once values exist in Secret Manager — applying before then would create alert policies that reference empty secrets and the ingestor would fail-start. Order is: declare empty secrets → apply → populate values → re-apply to wire env. See Task 6.)
- [ ] **Commit:**

```
infra(monitoring): notification channel + healthchecks secret manifests

Adds google_monitoring_notification_channel.email_julian (the only v1
subscriber) and 6 google_secret_manager_secret resources for the
per-cron Healthchecks.io URLs. Secret VALUES are populated out-of-band
post-apply; declared empty here so terraform apply is non-destructive
to the existing ingestor before the heartbeat wiring lands.
```

### Task 4 — `infra(monitoring): alert policies S1..S6 + uptime check`

- [ ] **Append to** `infra/terraform/monitoring.tf`:

```hcl
# ── S1: Ingest job non-zero exit ─────────────────────────────────────────
#
# Threshold: ≥1 failed execution in rolling 1h.
# Rationale: ingestor sets process.exitCode=1 on RunSummary.status==='failure'
# (services/ingestor/src/cli.ts:151). The "42 silent failures" finding from
# docs/analyses/2026-05-14-process-scale-options/phase-4 motivates this. 1h
# window matches the */30 recent-ingest cron — sub-hour is below sampling
# resolution; multi-hour delays the page past one full cron interval.

resource "google_monitoring_alert_policy" "ingest_job_failure" {
  display_name          = "Ingest job non-zero exit (S1)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "Cloud Run Job execution failed in last 1h"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/job/completed_execution_count\" AND resource.type=\"cloud_run_job\" AND metric.label.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "604800s" # 7d — auto-closes after a week of no re-fire
  }
}

# ── S2: Data staleness (freshestObservationAt > 6h) ──────────────────────
#
# Threshold: 6h. Rationale: recent-ingest cron is */30; eBird obs land within
# 5-15min of submission; AZ has sub-hour gaps. 6h staleness => ≥12 consecutive
# recent-ingest runs made zero forward progress on observation timestamps.
# Below 6h is noise (legitimate quiet hours mid-day); above 12h is too late.
#
# The metric source is a log-based metric extracted from the /api/meta
# endpoint's structured-log line emitted once per request. The read-api
# already logs `meta_freshness_seconds` on every /api/meta hit (sky-atlas
# phase-3 added this). The log-based metric pulls the value out as a
# distribution; the alert fires when the max over a 30min window exceeds
# 21600s (6h).
#
# If /api/meta logs are missing the field, FILE A BLOCKER on this task
# before applying — falling back to a Cloud Run Job that probes the DB
# directly is doable but doubles the surface.

resource "google_logging_metric" "meta_freshness_seconds" {
  name   = "bird-meta-freshness-seconds"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\" AND jsonPayload.meta_freshness_seconds!=NULL_VALUE"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "s"
  }
  value_extractor = "EXTRACT(jsonPayload.meta_freshness_seconds)"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 60
    }
  }
}

resource "google_monitoring_alert_policy" "data_staleness" {
  display_name          = "Data staleness > 6h (S2)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "freshestObservationAt older than 6h for 30min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/bird-meta-freshness-seconds\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 21600 # 6h in seconds
      duration        = "1800s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
}

# ── S3: Read-API 5xx rate > 1% over 5min ─────────────────────────────────
#
# Threshold: >1% with a minimum of 20 requests over the window. Rationale:
# 1% is the canonical "bad day" threshold; the 20-request floor prevents a
# single 5xx in a low-traffic minute (1/1=100%) from firing. 5min window
# catches a real incident within a cron interval.

resource "google_monitoring_alert_policy" "read_api_5xx" {
  display_name          = "Read API 5xx rate > 1% (S3)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "5xx rate >1% over 5min (min 20 req)"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      # The ratio + minimum-volume gate is expressed via denominator_filter:
      denominator_filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

# ── S4: Read-API p95 latency > 2000ms over 10min ─────────────────────────
#
# Threshold: 2000ms p95. Rationale: current p95 is 150-300ms; 2000ms is the
# "user tabs away" threshold. 10min smooths over cold-start spikes (scale-
# to-zero) without missing a real degradation.

resource "google_monitoring_alert_policy" "read_api_latency" {
  display_name          = "Read API p95 latency > 2s (S4)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "p95 > 2000ms over 10min"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2000
      duration        = "600s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
}

# ── S5: Cloud Run instance crash / OOM ───────────────────────────────────
#
# Log-based metric: counts severity>=ERROR messages matching the
# Cloud Run kill phrases. Threshold ≥1 in rolling 1h batches transient
# flaps into one notification.

resource "google_logging_metric" "container_crash" {
  name   = "bird-container-crash"
  filter = <<-EOT
    resource.type="cloud_run_revision" AND
    (resource.labels.service_name=~"bird-(read-api|ingestor.*)") AND
    severity>=ERROR AND
    (textPayload=~"Container terminated" OR textPayload=~"out of memory" OR textPayload=~"OOMKilled")
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "container_crash" {
  display_name          = "Cloud Run container crash / OOM (S5)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "≥1 crash log in 1h"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/bird-container-crash\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

# ── S6: Neon connection failures ─────────────────────────────────────────
#
# Threshold: ≥3 in rolling 10min. Rationale: Neon free tier suspends idle
# endpoints; single ENOTFOUND/ECONNREFUSED is normal cold-wake. Three in
# 10min means the pool is genuinely broken. TIGHTEN to ≥1 once the Cloud
# SQL migration lands (sibling plan) — Cloud SQL doesn't suspend, so any
# connection failure is a real incident.

resource "google_logging_metric" "neon_conn_fail" {
  name   = "bird-neon-conn-fail"
  filter = <<-EOT
    resource.type="cloud_run_revision" AND
    (resource.labels.service_name=~"bird-(read-api|ingestor.*)") AND
    (textPayload=~"getaddrinfo ENOTFOUND" OR textPayload=~"ECONNREFUSED" OR textPayload=~"Connection terminated unexpectedly")
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "neon_conn_fail" {
  display_name          = "Neon connection failures ≥3 in 10min (S6)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "≥3 conn failures in 10min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/bird-neon-conn-fail\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 3
      duration        = "0s"
      aggregations {
        alignment_period     = "600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

# ── Uptime check on the public read-api ─────────────────────────────────
#
# Synthetic monitoring: 5 GCP regions ping /api/regions every 60s. Alert
# fires if ≥2 regions fail for 3 consecutive checks (≈3min). Catches
# DNS / TLS / Cloud Run cold-fail issues that the request_count metric
# can't see (because by definition there are no requests landing).

resource "google_monitoring_uptime_check_config" "read_api" {
  display_name = "read-api /api/regions"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/api/regions"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = "api.bird-maps.com"
      project_id = var.gcp_project_id
    }
  }
}

resource "google_monitoring_alert_policy" "read_api_uptime" {
  display_name          = "Read API uptime check failing"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "≥2 region failures over 3 consecutive checks"
    condition_threshold {
      filter          = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.read_api.uptime_check_id}\""
      comparison      = "COMPARISON_LT"
      threshold_value = 1
      duration        = "180s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
      trigger { count = 2 }
    }
  }
}
```

- [ ] **Verify:** `terraform fmt -check && terraform validate && terraform plan` — plan should show 6 alert policies + 3 log-based metrics + 1 uptime check + 1 uptime alert added. No deletions; no replaces.
- [ ] **Commit:**

```
infra(monitoring): alert policies S1..S6 + uptime check

Adds 6 google_monitoring_alert_policy resources (job-failure, staleness,
5xx-rate, p95-latency, crash, neon-conn) plus 3 google_logging_metric
sources and one google_monitoring_uptime_check_config for the public
read-api. Thresholds documented inline with rationale per
docs/plans/2026-05-17-monitoring-and-alerts.md §"Threshold rationale".
```

### Task 5 — `feat(read-api): log meta_freshness_seconds on /api/meta` (gated)

> Gate: if `/api/meta` already emits `meta_freshness_seconds` in a structured log line, SKIP this task and note it in the PR body. If not, this task lands BEFORE Task 4's apply, because the S2 log-based metric depends on the field existing.

- [ ] `grep -rn 'meta_freshness_seconds\|freshestObservationAt' services/read-api/src/` to verify.
- [ ] If missing, edit `services/read-api/src/routes/meta.ts` (or equivalent — confirm the path) to add `console.log(JSON.stringify({ severity: 'INFO', meta_freshness_seconds: Math.floor((Date.now() - freshestObservationAt.getTime()) / 1000), ... }))` at handler entry/exit. TDD per the repo convention.
- [ ] **Commit:**

```
feat(read-api): emit meta_freshness_seconds structured log

Adds a structured-log emit on each /api/meta hit. Required by the S2
data-staleness alert (docs/plans/2026-05-17-monitoring-and-alerts.md)
which pulls the value via a Cloud Logging log-based metric.
```

### Task 6 — `infra(monitoring): wire healthchecks env into ingest jobs + populate secrets`

- [ ] **Out-of-band, operator step:** create 6 checks in Healthchecks.io (free tier signup with `julian.kennon.d@gmail.com`):

| Check name | Schedule | Grace |
|---|---|---|
| `bird-ingest-recent` | every 30 min | 10 min |
| `bird-ingest-backfill` | cron `0 4 * * *` | 60 min |
| `bird-ingest-hotspots` | cron `0 5 * * 0` | 60 min |
| `bird-ingest-taxonomy` | cron `0 6 1 * *` | 120 min |
| `bird-ingest-photos` | cron `0 7 1 * *` | 120 min |
| `bird-ingest-descriptions` | cron `0 8 * * *` | 60 min |

Each check yields a unique `https://hc-ping.com/<uuid>` URL.

- [ ] **Populate secrets:**

```sh
for kind in recent backfill hotspots taxonomy photos descriptions; do
  read -r URL?"Paste hc-ping URL for $kind: "
  printf '%s' "$URL" | gcloud secrets versions add bird-watch-healthchecks-$kind \
    --project=bird-maps-prod --data-file=-
done
```

- [ ] **Edit** `infra/terraform/ingestor.tf` — add `HEALTHCHECKS_URL_<KIND>` env wiring to each of the 3 Cloud Run Jobs (`ingestor`, `ingestor_photos`, `ingestor_descriptions`). The shared `bird-ingestor` job is invoked with 4 different `args` (`recent`/`backfill`/`hotspots`/`taxonomy`), and each needs its own env var matching the cli's `HEALTHCHECKS_URL_${kind.toUpperCase()}` convention:

```hcl
        # Heartbeat URLs — one per cron kind that this job handles. cli.ts
        # reads HEALTHCHECKS_URL_<KIND> at the end of a successful run.
        # Failure path is silent here (S1 alert covers it).
        env {
          name = "HEALTHCHECKS_URL_RECENT"
          value_source { secret_key_ref { secret = google_secret_manager_secret.healthchecks_url["recent"].secret_id, version = "latest" } }
        }
        env {
          name = "HEALTHCHECKS_URL_BACKFILL"
          value_source { secret_key_ref { secret = google_secret_manager_secret.healthchecks_url["backfill"].secret_id, version = "latest" } }
        }
        env {
          name = "HEALTHCHECKS_URL_HOTSPOTS"
          value_source { secret_key_ref { secret = google_secret_manager_secret.healthchecks_url["hotspots"].secret_id, version = "latest" } }
        }
        env {
          name = "HEALTHCHECKS_URL_TAXONOMY"
          value_source { secret_key_ref { secret = google_secret_manager_secret.healthchecks_url["taxonomy"].secret_id, version = "latest" } }
        }
```

For `ingestor_photos`, only `HEALTHCHECKS_URL_PHOTOS`; for `ingestor_descriptions`, only `HEALTHCHECKS_URL_DESCRIPTIONS`.

Add the corresponding `depends_on` entries (the per-kind `google_secret_manager_secret_iam_member.ingestor_healthchecks["<kind>"]`).

- [ ] **Run:** `terraform plan` — expect Cloud Run Job revision updates (env additions). Apply.
- [ ] **Verify:** trigger a manual `recent` run: `gcloud run jobs execute bird-ingestor --args=recent --region=us-west1 --project=bird-maps-prod --wait`. Then check the Healthchecks.io UI — `bird-ingest-recent` shows a green ping.
- [ ] **Commit:**

```
infra(monitoring): wire healthchecks env into ingest jobs

Adds HEALTHCHECKS_URL_<KIND> env vars to bird-ingestor (4 kinds),
bird-ingestor-photos, and bird-ingestor-descriptions, sourced from
the bird-watch-healthchecks-<kind> Secret Manager secrets populated
out-of-band. cli.ts pings these on success; absence is alerted by
Healthchecks.io (S7).
```

### Task 7 — `docs(runbook): monitoring runbook + alert-fire smoke test`

- [ ] **Create** `docs/runbooks/monitoring.md` — copy the threshold-rationale table from this plan verbatim, add a triage section ("If S1 fires: check the latest execution at `gcloud run jobs executions list --job=bird-ingestor --region=us-west1`; if S2 fires: curl `/api/meta` and confirm `freshestObservationAt` is actually old before assuming alert is real"), and document the snooze workflow.
- [ ] **Smoke test each alert end-to-end** — temporarily lower the threshold, force the condition, confirm email arrives at `julian.kennon.d@gmail.com`, restore threshold. Document the procedure for each in the runbook. Example for S1:

```
1. gcloud run jobs execute bird-ingestor --args=unknown-kind --region=us-west1 \
   --project=bird-maps-prod --wait  # forces exit 1 via cli.ts:146 throw
2. Wait up to 1h for alert evaluation, or set alignment_period=60s temporarily.
3. Confirm email lands in inbox; subject line includes "Ingest job non-zero exit".
4. Revert any temporary alignment_period change; close the test alert from the
   Cloud Monitoring UI ("Acknowledge incident").
```

- [ ] **Commit:**

```
docs(runbook): monitoring runbook + smoke-test procedure

Operator runbook for the 6 alert policies and the read-api uptime
check, including end-to-end fire tests (lower threshold → force
condition → confirm email → restore). Threshold-rationale table
mirrored verbatim from docs/plans/2026-05-17-monitoring-and-alerts.md.
```

---

## Test plan (end-to-end alert fire verification)

| Signal | Fire procedure | Restore procedure |
|---|---|---|
| S1 | `gcloud run jobs execute bird-ingestor --args=unknown-kind --wait` (throws → exit 1). | None — alert auto-closes in 7d. Acknowledge in UI. |
| S2 | Pause the `bird-ingest-recent` Scheduler job; wait 6h or temporarily edit the alert threshold down to 600s and `terraform apply`. | Resume scheduler; restore HCL threshold; apply. |
| S3 | Hit a non-existent route on the read-api in a tight loop (`for i in $(seq 30); do curl -s https://api.bird-maps.com/api/forcefail; done`). If 404 is the result, edit cli briefly to force a 500 on a test path. | None — synthetic load stops, rate drops naturally. |
| S4 | Synthetic load via `hey -z 11m -c 50 https://api.bird-maps.com/api/observations` against a deliberately-large bbox. | Stop load. |
| S5 | Lower the memory limit on `bird-read-api` to `64Mi` temporarily and apply; the next request OOMs. | Restore `256Mi` and apply. |
| S6 | Suspend the Neon endpoint via the Neon console; the read-api's next pool checkout fails. | Resume endpoint. |
| S7 | Pause the `bird-ingest-recent` Scheduler job in the GCP console. After 40min, Healthchecks.io emails. | Resume scheduler. |
| Uptime | Temporarily change the uptime check `path` to `/does-not-exist`. | Restore `/api/regions`. |

Each smoke test is a one-time validation; document the date verified in the runbook so a future audit can see when the alert was last known to actually fire.

---

## Cost

Cloud Monitoring free tier (per GCP docs, current at plan authoring):

- **150 MiB/month of log-based metric chargeable data**, free. Our 3 log-based metrics emit a handful of entries per minute (4 ingest jobs × 1/hr × 1 line + a handful of /api/meta hits per minute) — well under 150 MiB/mo.
- **Alert policies: unlimited and free.** Cloud Monitoring charges only for chargeable metric data ingestion, not for the policies themselves.
- **Uptime checks: 1 million check executions/month free.** 1 check × 60s × ~5 regions = ~216k checks/mo. Free.
- **Notification channels: free.** Email is the cheapest channel; SMS and webhook are also within free tier at our volume.

**Healthchecks.io:** free tier (20 checks, unlimited pings, email notifications).

**Projected monthly cost: $0.00** (free tier covers everything in v1). Worst case at 10× current volume: still $0.00. National launch at 200× current volume: roughly $0–$2/mo if log-based-metric volume crosses the free-tier boundary.

Cloud Run cost from the heartbeat `fetch()` is one extra outbound request per ingest run (~6 runs/day at v1 cadence; ~180/mo). Negligible.

---

## Open decisions (require Julian sign-off before execution)

### D1. Notification channel: email only, or add SMS/webhook?

**Recommendation: email only for v1.** Single subscriber, single inbox, no on-call rotation yet. SMS would be appropriate once response-SLA gets named; not yet. A future iteration adds a Slack/Discord webhook (free) for higher-fidelity routing.

### D2. Heartbeat: Healthchecks.io vs. Cloud Monitoring custom-metric absent-for

**Recommendation: Healthchecks.io.** Argued in §"Heartbeat strategy" above. The custom-metric path is doable but routes through the same Cloud Run failure surface we're trying to detect, which is a soft single-point-of-failure. Healthchecks.io decouples.

### D3. Uptime check path: `/api/regions` vs. `/health`

**Recommendation: `/api/regions`.** Hits a real route that exercises the DB pool; a static `/health` route can return 200 even when the DB connection is broken (and S6 catches that separately, but combining the signal at the uptime layer is more direct). The endpoint is light (<50ms typical), so 60s/5-region polling adds ~360 req/hr to read-api load — negligible.

### D4. Threshold tightening once Cloud SQL migration lands

**Recommendation: S6 threshold tightens from ≥3 to ≥1 in 10min after the Cloud SQL migration sibling plan ships.** Cloud SQL doesn't suspend like Neon free-tier does; a single connection failure is a real incident. File a follow-up in the Cloud SQL plan itself, not this one.

---

## Sequencing

1. Open `feat/monitoring-and-alerts` branch off `main`.
2. Task 1 → Task 2 (one PR — heartbeat code + cli wiring; CI green; lands without infra side-effects because env vars are unset and `pingHeartbeat(undefined, ...)` is a no-op).
3. Task 5 if needed (one PR — `meta_freshness_seconds` log emit; CI green).
4. Task 3 (one PR — notification channel + empty secrets; CI green; `terraform apply` lands the channel + empty secrets).
5. Task 6, out-of-band steps first (operator creates Healthchecks.io checks, populates secrets), then Task 4 + Task 6 HCL together in one PR (apply lands alerts + env-wires the heartbeat).
6. Task 7 — runbook + smoke tests; tests run against the live deployed alerts, fail-fast on any policy that doesn't actually fire.
7. Post-merge: monitor inbox for ~7 days; any alert that fires more than 3x in 7d gets its threshold revisited per the kill-threshold metric.

Total wall-clock: ~2h of work split across 3-4 PRs.

---

## Honest open items

- **`meta_freshness_seconds` log emit may already exist.** Task 5 starts with a grep to confirm; if present, skip. If absent, this is a real new code surface that needs a unit test and a deploy.
- **Healthchecks.io is a third-party SaaS.** If it disappears (free tier sunset, acquisition, etc.), S7 stops working silently. Mitigation: the `pingHeartbeat` URL is in Secret Manager, so swapping to Better Stack or a Cloud-Monitoring custom-metric approach is a single secret-version update + a single Terraform apply.
- **Log-based metric backfill latency.** Cloud Logging's log-based metrics have ~1-2min delay between log entry and metric availability. S2/S5/S6 alerts are correspondingly delayed. Not a problem at 10-minute windows; would be a problem at 30-second windows. v1 windows are all ≥5min.
- **No SLO objects.** Once we have 30 days of clean baseline data, a follow-up plan adds `google_monitoring_slo` for read-api availability + latency, with burn-rate alerts. v1 raw alert policies are the right shape for pre-team scale.
- **No alert routing tiers (P0/P1/P2).** Single channel for v1 means every alert is the same urgency. Acceptable at single-operator scale; revisit when team grows.

---

## Methodology

Plan produced by a single-pass agentic write-up off three inputs: (1) `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` Theme 1 + Recommendation 0A; (2) live infra review (`infra/terraform/ingestor.tf`, `read-api.tf`, `db.tf`) for resource naming and existing secret patterns; (3) live code review (`services/ingestor/src/cli.ts`) for the exit-code surface S1 keys off. No multi-pass critic loop because the surface is small and the threshold rationale is the only judgment-laden content — no architectural forks worth re-evaluating.
