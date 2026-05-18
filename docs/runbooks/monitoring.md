# Monitoring & Alerts Runbook

Operator runbook for the alerts provisioned by Plan
[`2026-05-17-monitoring-and-alerts`](../plans/2026-05-17-monitoring-and-alerts.md).
Lives at `infra/terraform/monitoring.tf` (five alert policies, two log-based
metrics, one uptime check, one notification channel). The S7 heartbeat layer
is hosted at Healthchecks.io; the read-api `meta_freshness` log emit is in
`services/read-api/src/app.ts`.

Single notification channel for v1: email to `julian.kennon.d@gmail.com`.
There is no on-call rotation, no escalation tier, no Slack mirror — every
alert lands in one inbox.

## Threshold rationale (verbatim from the plan)

| # | Signal | Source | Threshold | Rationale |
|---|---|---|---|---|
| S1 | Ingest job non-zero exit | `run.googleapis.com/job/completed_execution_count` filtered by `result="failed"` | ≥1 failed execution in rolling 1h | Per-execution failure mode. One failure is recoverable (transient eBird 5xx), two-in-a-row is the start of the 42-execution silence. 1h window matches the `*/30` cron. |
| S2 | Data-staleness | Log-based metric `bird-meta-freshness-seconds` extracted from the `/api/observations` handler's structured log | `freshestObservationAt` older than 6h (p95 over 30min) | Recent-ingest fires every 30min; AZ is high-volume. 6h staleness => ≥12 consecutive runs made zero forward progress. Below 6h is quiet-hours noise; above 12h is too late. |
| S3 | Read-API 5xx rate | `run.googleapis.com/request_count` filtered by `response_code_class="5xx"` | >1% over rolling 5min **AND** request_count ≥ 100 over the same window | 1% is the canonical "bad day" threshold; the 100-req floor (~20 req/min) prevents single-error fires at idle traffic. At HN-scale traffic the floor is invisible. |
| S4 | Read-API p95 latency | `run.googleapis.com/request_latencies` distribution, p95 | >2000ms over rolling 10min | Current p95 is 150-300ms. 2000ms is "user tabs away". 10min smooths cold-start spikes (scale-to-zero) without missing real degradation. |
| S5 | Cloud Run instance crash / OOM | Log-based metric `bird-container-crash` on `severity>=ERROR` matching `Container terminated` OR `out of memory` | ≥1 in rolling 1h | Crashes are always notable. 1h batches transient flaps into one notification. |
| S7 | Heartbeat miss — ingest cron didn't fire | Healthchecks.io check per cron | No ping in 40min (cron 30min + 10min grace) | Cloud Monitoring cannot detect "scheduled invocation that never happened" — Healthchecks.io is the inverse trigger. |
| Uptime | Public read-api unreachable | Uptime check on `https://api.bird-maps.com/api/regions` | failures across regions for ≥3 consecutive checks (~3min) | Catches DNS / TLS / Cloud Run cold-fail issues invisible to `request_count` (no requests landing = no metric). |

## Triage by alert

When an alert email arrives, work top-to-bottom. **Before changing anything,
verify the alert is real** — Cloud Monitoring has ~1-2min metric-availability
delay, and a stale alert can fire while the underlying issue has already
resolved.

### S1: Ingest job non-zero exit

What it means: a Cloud Run Job execution finished with a non-zero exit code.
The ingestor's `RunSummary.status === 'failure'` path sets
`process.exitCode = 1` (services/ingestor/src/cli.ts).

First moves:

```sh
# Most recent executions, newest first
gcloud run jobs executions list --job=bird-ingestor --region=us-west1 \
  --project=bird-maps-prod --limit=10

# Logs from the failing execution
gcloud run jobs executions describe <execution-id> --region=us-west1 \
  --project=bird-maps-prod
gcloud logging read \
  'resource.type=cloud_run_job AND resource.labels.job_name=bird-ingestor' \
  --project=bird-maps-prod --limit=50 --order=desc
```

Common causes:
- Transient eBird 5xx (single execution recovers on the next `*/30` cron — acknowledge and wait).
- A bad migration. Check the latest commit to `migrations/` against the failing execution start time.

### S2: Data staleness > 6h

What it means: `/api/observations` has been returning a `meta.freshestObservationAt` older than 6h for at least 30min.

First moves — verify before changing anything:

```sh
curl -s "https://api.bird-maps.com/api/observations?since=1d" | jq .meta.freshestObservationAt
# If the timestamp is < 6h ago, the alert is stale and will auto-close.
```

If real:
- Is the recent-ingest scheduler still scheduling? `gcloud scheduler jobs describe bird-ingest-recent --location=us-west1 --project=bird-maps-prod`.
- Are recent-ingest executions running but failing? See S1 triage.
- Distinct from S7: S2 = "cron ran but didn't make forward progress"; S7 = "cron didn't run at all".

### S3: Read API 5xx rate > 1%

What it means: ≥1% of read-api requests returned 5xx over a 5min window AND total request count crossed 100 in that window.

First moves:

```sh
# 5xx requests in the last 30min
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=bird-read-api AND httpRequest.status>=500' \
  --project=bird-maps-prod --limit=50 --order=desc --freshness=30m
```

Common causes:
- Pool exhaustion. Check `bird-read-api` revision concurrency settings.
- Bad SQL from a recent migration / db-client change.
- Cloud Run revision serving without a fresh image (look for ECONNREFUSED in startup probes).

### S4: Read API p95 latency > 2s

What it means: p95 latency exceeded 2000ms for 10min.

Common causes: missing index after a query change, CDN bypass on a hot route, slow SQL after a query change.

```sh
# p95 by route in last hour, via metric explorer or:
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=bird-read-api AND httpRequest.latency>="2s"' \
  --project=bird-maps-prod --limit=20 --order=desc --freshness=1h
```

### S5: Container crash / OOM

What it means: a Cloud Run container hit `Container terminated` or `out of memory`.

If OOM: bump `resources.limits.memory` on the affected service/job (currently
`512Mi` for ingestor, `256Mi` for read-api). If unhandled exception: read
the preceding stack trace from the same log entry; fix the code.

### S7: Heartbeat miss (Healthchecks.io)

What it means: a cron job did not ping its Healthchecks.io URL within `schedule + grace`.

First moves:

```sh
# Did Scheduler even try to invoke the job?
gcloud scheduler jobs describe bird-ingest-recent --location=us-west1 --project=bird-maps-prod

# Did the Job execute?
gcloud run jobs executions list --job=bird-ingestor --region=us-west1 \
  --project=bird-maps-prod --limit=5 --filter="metadata.creationTimestamp > '$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)'"
```

If Scheduler didn't fire: the GCP Cloud Scheduler control plane has issues — check the GCP status page.
If Scheduler fired but no execution: an IAM problem on the scheduler service account.
If execution ran but no ping: a network egress regression — check the run-cli end of `services/ingestor/src/cli.ts`.

### Uptime: Read API unreachable

First moves:

```sh
curl -I https://api.bird-maps.com/api/regions
# If 5xx: see S3/S5. If timeout: Cloudflare layer (DNS, cert, origin pull) likely.
dig api.bird-maps.com
```

## Muting / snoozing during planned maintenance

- **Cloud Monitoring policies (S1..S5, uptime):** Cloud Monitoring console → Alerting → Policies → select the policy → "Snooze". Pick a duration. Snoozes are click-ops; record the rationale in the policy's notes field for audit.
- **Healthchecks.io (S7):** healthchecks.io dashboard → select the check → "Pause". Resume manually when work completes (a paused check never fires regardless of ping cadence).

Never disable a policy permanently as a workaround. If a policy is too noisy, file a follow-up to retune the threshold per the plan's kill-threshold metric (60-day window, < 40% fixed-rate triggers retro at `docs/analyses/<date>-alert-fatigue-retrospective.md`).

## End-to-end smoke tests

Each alert is verified end-to-end the first time it ships. Document the verification date in the "Smoke test log" section below so a future audit can see when the alert was last known to actually fire.

### S1 — force a non-zero ingest exit

```sh
gcloud run jobs execute bird-ingestor --args=unknown-kind \
  --region=us-west1 --project=bird-maps-prod --wait
# cli.ts throws on unknown kind => exit 1; the Cloud Run Jobs metric
# records result=failed within 1-2 min.
```

Wait up to 1h for alert evaluation, OR temporarily lower `aggregations.alignment_period` to `60s` in HCL, `terraform apply`, force the failure, confirm email lands, revert HCL, `terraform apply`.

### S2 — force data staleness

Pause `bird-ingest-recent` in Cloud Scheduler. Wait 6h+30min for the alert window, OR temporarily edit the threshold down to 600s and `terraform apply`; confirm email; restore.

### S3 — force 5xx rate

```sh
# Generate ≥100 req over 5min to satisfy the floor:
brew install hey  # if not present
hey -z 6m -c 5 -q 4 https://api.bird-maps.com/api/observations?since=1d
# In parallel, force 5xx — easiest path is to deploy a temporary revision
# that 500s on a sentinel path, or pause Neon to break the pool mid-load.
```

### S4 — force p95 > 2s

Synthetic load with a deliberately-large bbox is the cheapest path:

```sh
hey -z 11m -c 50 https://api.bird-maps.com/api/observations?since=30d
```

### S5 — force OOM

Temporarily lower `resources.limits.memory` on `bird-read-api` to `64Mi` in HCL; `terraform apply`; trigger a normal request; container OOMs and the kill phrase lands in logs. Restore `256Mi` and reapply immediately.

### S7 — force heartbeat miss

Pause `bird-ingest-recent` in Cloud Scheduler. After 40min (30min cadence + 10min grace) Healthchecks.io emails. Resume the scheduler.

### Uptime check

Temporarily set the check `path` to `/does-not-exist` in HCL; `terraform apply`. After ~3min the alert fires across regions. Restore `/api/regions` and reapply.

## Smoke test log

| Signal | Last verified to fire | Verifier | Notes |
|---|---|---|---|
| S1 | — | — | Pending — verify post first `terraform apply` of Tasks 3+4. |
| S2 | — | — | Pending — depends on the log emit (this PR) being deployed. |
| S3 | — | — | Pending. |
| S4 | — | — | Pending. |
| S5 | — | — | Pending. |
| S7 | — | — | Pending — depends on Task 6 secret population + env-wiring. |
| Uptime | — | — | Pending. |
| Digest | — | — | Pending — verify post first `terraform apply` of #643 + manual invoke. |

Smoke tests are deliberate, opt-in operator work — do not run them on autopilot. Each one perturbs prod briefly; coordinate before firing.

## Digest

Daily 09:00 UTC health digest delivered to `julian.kennon.d@gmail.com` via
SendGrid. The Cloud Run Job composes a 5-signal summary
(`docs/analyses/2026-05-18-monitoring-dashboard-issue-638/phase-4/analysis-report.md`
§H Contract C3) and pings the `digest` Healthchecks.io URL on delivery
confirmation — NOT on function-success. The runtime-vs-delivery distinction
matters because SendGrid will accept and 2xx a message that Gmail then rejects
at the SMTP layer for sender-domain misalignment (SPF/DKIM/DMARC drift —
analysis report §F7); pinging on function-success would mark the digest
"alive" on Healthchecks.io when it never actually landed in the inbox,
destroying the negative-space surveillance.

Coverage note: the digest body enumerates 5 of the 7 ingest kinds
(`recent`, `backfill`, `hotspots`, `taxonomy`, `prune`). `photos` and
`descriptions` are deliberately excluded because they do not yet write
to the `ingest_runs` table (see analysis report §F9). The retrofit is
tracked as a follow-up at PR-2 (#642) merge time per Contract C4. Until
then, the digest's explicit enumeration of the 5 covered kinds keeps the
absence operator-visible.

### Heartbeat check + secrets

- **Healthchecks.io check name**: `bird-watch-digest` (create at
  healthchecks.io with schedule `0 9 * * *` UTC + grace 10min).
- **Healthchecks.io URL secret**: `bird-watch-healthchecks-digest` —
  populated out-of-band:
  ```sh
  gcloud secrets versions add bird-watch-healthchecks-digest \
    --project=bird-maps-prod --data-file=- <<< "https://hc-ping.com/<uuid-from-HC>"
  ```
- **SendGrid API key secret**: `bird-watch-sendgrid-api-key` — populated
  out-of-band:
  ```sh
  gcloud secrets versions add bird-watch-sendgrid-api-key \
    --project=bird-maps-prod --data-file=- <<< "SG.xxxxxxxx"
  ```

### Manual invoke

```sh
gcloud run jobs execute bird-digest-daily \
  --region=us-west1 --project=bird-maps-prod --wait
```

The job exits 0 on `delivered` or `queued` (heartbeat fires only on
`delivered`) and exit 1 on `failed`. The Cloud Logging payload includes a
single-line `bird_digest_sent` entry carrying `status`, `providerMessageId`,
and (on failure) `error`.

### Sender authentication (DNS records on `bird-maps.com`)

SendGrid requires three DNS records before Gmail will accept the inbound
message. Records are managed in Cloudflare; verify with the `dig` commands
below.

| Record | Type | Value | Verify |
|---|---|---|---|
| `@` (apex) | TXT | `v=spf1 include:sendgrid.net ~all` | `dig +short TXT bird-maps.com` |
| `s1._domainkey` | CNAME | `s1.domainkey.uXXXX.wlYYY.sendgrid.net` (UUIDs minted in SendGrid sender-auth UI) | `dig +short CNAME s1._domainkey.bird-maps.com` |
| `s2._domainkey` | CNAME | `s2.domainkey.uXXXX.wlYYY.sendgrid.net` | `dig +short CNAME s2._domainkey.bird-maps.com` |
| `_dmarc` | TXT | `v=DMARC1; p=none; rua=mailto:julian.kennon.d@gmail.com` (start permissive; tighten to `p=quarantine` after 30 days of clean reports) | `dig +short TXT _dmarc.bird-maps.com` |

After populating those records, click "Verify" in the SendGrid sender-auth UI;
the verification call queries DNS once and caches the result.

### Digest on-fire runbook

The S7-shape alert fires when Healthchecks.io stops receiving the daily ping
inside its grace window (40min after the scheduled 09:00 UTC fire). Triage:

1. **Did Cloud Scheduler fire?**
   ```sh
   gcloud scheduler jobs describe bird-ingest-digest \
     --location=us-west1 --project=bird-maps-prod
   ```
   Check `state` (should be `ENABLED`) and `lastAttemptTime`.

2. **Did the Cloud Run Job execute?**
   ```sh
   gcloud run jobs executions list --job=bird-digest-daily \
     --region=us-west1 --project=bird-maps-prod --limit=5
   gcloud logging read \
     'resource.type=cloud_run_job AND resource.labels.job_name=bird-digest-daily' \
     --project=bird-maps-prod --limit=50 --order=desc --freshness=2h
   ```
   Look for the `bird_digest_sent` structured-log line — `status` reveals
   whether the function reached the SendGrid call at all.

3. **Did SendGrid accept the message?** Open the SendGrid Activity Feed
   for the day. A 2xx with no bounce event means the function-success
   half is healthy; a 4xx points to API-key rotation drift or sender-auth
   misconfig. A bounce event means Gmail rejected the message — re-check
   DNS records with the `dig` commands above.

4. **Did Healthchecks.io receive the ping?** Open the `bird-watch-digest`
   check in the HC dashboard. If the check shows `late` but the
   `bird_digest_sent` log line shows `status: delivered`, the network
   egress from Cloud Run to HC failed — check the HC URL secret value
   (`gcloud secrets versions list bird-watch-healthchecks-digest`).

5. **Resolution checklist before closing the incident**:
   - SendGrid Activity Feed shows the day's send as delivered.
   - Gmail inbox confirms receipt of the digest.
   - Healthchecks.io shows the ping as on-time for the next scheduled fire.

Distinct from S2/S7: S2 = "ingest cron ran but didn't make forward
progress"; S7 = "ingest cron didn't run at all"; Digest miss = "the
operator-visible daily summary stopped arriving — A+H surveillance gap
has reopened".
