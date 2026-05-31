# Ingestor — scheduled ingest + enrichment

`@bird-watch/ingestor` is the batch service behind bird-maps.com. It is a CLI
(not an HTTP service): a single entry point dispatches on `argv[2]` to one of
twelve *kinds*. In production each kind runs as a Cloud Run v2 **Job** triggered
by Cloud Scheduler; locally it runs under `tsx`.

Two responsibilities:

- **Ingest** — pull bird observations, hotspots, and taxonomy from eBird into
  Postgres (PostGIS). The recent-observations lane is national (`regionCode
  'US'`); hotspots and the default backfill remain `US-AZ`.
- **Enrichment** — fill out species metadata from external sources: iNaturalist
  (photos + taxon resolution), Wikipedia (descriptions), and Phylopic family
  silhouettes (seeded via DB migrations, written by the separate admin-api).

There are also operational kinds: retention prune with cold-storage archival,
a daily health digest email, a Cloudflare cache-warm pass, and two operator
probe tools.

The platform-agnostic ingest core lives in the `run-*.ts` runners. The Cloud
Run Job entry point is `src/cli.ts`. A second file, `src/handler.ts`, exports a
`handleScheduled` covering only a six-kind subset and is **not** the production
entry point — treat `cli.ts` as authoritative for the kind list.

## Run a kind locally

The CLI is `src/cli.ts` (shebang `#!/usr/bin/env tsx`). The package script
`ingest:local` wraps it:

```sh
# Default kind is `recent` when argv[2] is omitted.
EBIRD_API_KEY=<YOUR_EBIRD_KEY> DATABASE_URL=<YOUR_DATABASE_URL> \
  npm run ingest:local --workspace @bird-watch/ingestor

# An explicit kind:
EBIRD_API_KEY=<YOUR_EBIRD_KEY> DATABASE_URL=<YOUR_DATABASE_URL> \
  npm run ingest:local --workspace @bird-watch/ingestor -- hotspots
```

### Backfill flags

`backfill` accepts two optional flags (`src/cli.ts:255-300`):

```sh
# Per-state, 14-day window. --state accepts US-XX or an eBird county code US-XX-NNN.
... -- backfill --state=US-CA --back=14
```

- `--state=US-XX` (default `US-AZ`) — validated against `/^US-[A-Z]{2}(-[A-Z0-9]+)?$/`.
  County codes (`US-XX-NNN`) exist because a single per-day full-state historic
  call can exceed eBird's response-size limit on large states; the fix is to fan
  out per county.
- `--back=N` (default `19`) — integer 1–30 (eBird's `recent` window cap).

`backfill-extended` is a one-shot 365-day backfill at 1 rps
(`src/cli.ts:301-324`). It is **not** scheduled — it runs on the shared
`bird-ingestor` Cloud Run Job, whose `timeout` is `900s`
(`infra/terraform/ingestor.tf:101`). Its wall time is ~364s (365 calls at 1
rps), comfortably under that ceiling, so no per-execution timeout override is
needed. (The inline comment at `src/cli.ts:308-309` still claims `timeout =
"300s"` and cites `ingestor.tf:91`; that is stale — line 91 is now the
bump-comment and the live value at line 101 is `900s`.)

### Probe tools (no DB / no eBird auth)

`probe-wiki <title>` and `probe-taxon <binomial>` early-return ahead of the
`EBIRD_API_KEY` / `DATABASE_URL` guards (`src/cli.ts:116-134`), so they run from
a laptop with no secrets:

```sh
npx tsx services/ingestor/src/cli.ts probe-taxon "Cardinalis cardinalis"
npx tsx services/ingestor/src/cli.ts probe-wiki "Northern cardinal"
```

## Reference

### Kinds

All kinds dispatch from `src/cli.ts`. `regionCode` applies only to eBird ingest
kinds. Schedules are the production Cloud Scheduler cadences (UTC); kinds with
no schedule are operator-triggered.

| Kind | What it does | regionCode | Schedule (cron) |
| --- | --- | --- | --- |
| `recent` | eBird recent + notable intersect → observations (default kind) | `US` | `*/30 * * * *` |
| `hotspots` | eBird hotspots → hotspots table | `US-AZ` | `0 5 * * 0` (weekly Sun) |
| `backfill` | eBird historic backfill; `--state`/`--back` flags | `US-AZ` (or `--state`) | `0 4 * * *`; per-state fan-out staggered |
| `backfill-extended` | one-shot 365-day backfill at 1 rps | `US-AZ` | — (operator only) |
| `taxonomy` | eBird taxonomy (7 categories) → species_meta | n/a | `0 6 1 * *` (monthly) |
| `photos` | iNaturalist (Tier 1) → Wikipedia lead-image fallback → species_photos | n/a | `0 7 1 * *` (monthly) |
| `descriptions` | Wikipedia REST summary → iNat summary fallback → species_descriptions | n/a | `0 8 * * *` (daily) |
| `prune` | 14-day retention; archive-then-delete to GCS Parquet, then VACUUM | n/a | `5 10 * * *` (daily) |
| `cache-warm` | prime the Cloudflare cache for popular `/api` URLs | n/a | `2,32 * * * *` |
| `digest` | daily health-digest email via SendGrid | n/a | `0 9 * * *` (daily) |
| `probe-taxon` | operator triage: hit iNat `/v1/taxa` for one binomial | n/a | — |
| `probe-wiki` | operator triage: fetch one Wikipedia summary by title | n/a | — |

The per-state backfill fan-out is a Cloud Scheduler `for_each` that invokes the
shared `bird-ingestor` job with `--args=backfill --state=US-XX --back=14` at
staggered times (`infra/terraform/ingestor.tf`).

### eBird ingest details

- **`is_notable` requires two calls.** `recent` fetches `/data/obs/{region}/recent`
  and `/data/obs/{region}/recent/notable` in parallel, builds a key set from the
  notable response, and stamps `is_notable` per observation by membership
  (`src/run-ingest.ts:37-42`, `src/transform.ts`). Without both calls the notable
  filter does not work. The notable call passes `detail=simple`; both default to
  `back=14` days (`src/ebird/client.ts:36-48`).
- **species_meta invariant.** Before upserting observations, `findMissingSpeciesMeta`
  checks every `species_code` against `species_meta`; a single missing row aborts
  the whole batch loudly (issue #484, `src/run-ingest.ts:54-63`). The monthly
  `taxonomy` cron keeps all 7 eBird categories so hybrid/spuh/slash codes get
  rows.
- **Taxonomy** fetches `cat=species,issf,hybrid,spuh,slash,domestic,form` with no
  `version` param (eBird then defaults to the latest taxonomy;
  `src/ebird/client.ts:83-89`).

### Enrichment lanes

- **Photos** (`src/run-photos.ts`, `src/inat/`) — iNaturalist is the Tier-1
  source with a region → US → global cascade; Wikipedia lead-image is the next
  fallback. There is no further photo source — the family silhouette is the final
  fallback. Only species that appear in `observations` are iterated (an `EXISTS`
  filter).
- **Descriptions** (`src/run-descriptions.ts`, `src/wikipedia/`, `src/inat/`) —
  resolves a Wikipedia title via the cached `inat_taxon_id` (warm) or iNat
  `/v1/taxa` (cold), conditional-GETs the Wikipedia REST summary (304
  short-circuit), sanitizes the HTML, and persists to `species_descriptions`. On
  a cold-cache Wikipedia 404 it falls back to the iNat summary plaintext
  (`source='inat'`). Wikipedia text is stored CC-BY-SA-4.0.
- **Silhouettes** — the ingestor does **not** write silhouettes at runtime. Family
  silhouettes (`family_silhouettes` table: family → color and SDF shape) are
  seeded and backfilled via DB migrations (Phylopic crawl) and overridden by the
  separate `services/admin-api`. See that service's source for the upload path.

iNaturalist and Wikipedia run with a `User-Agent` of
`bird-maps.com/1.0 (https://bird-maps.com)` and pace at roughly 1 rps.

### Prune + cold storage

`prune` runs `runPrune` (`src/run-prune.ts`): 14-day rolling retention
(`DEFAULT_RETENTION_DAYS=14`, override via `OBSERVATIONS_RETENTION_DAYS`). For
each UTC day outside the window it archives the day's rows to gzip Parquet on
the GCS bucket `bird-maps-prod-obs-archive`, then deletes them, then
`VACUUM (ANALYZE)` the table. Archive-then-delete is per-day and synchronous: if
the archive throws for a day, that day's delete is skipped and the run reports
`failure` while preserving prior days' progress.

Parquet is Hive-partitioned (`observations/year=YYYY/month=MM/day=DD/data.parquet`)
for BigQuery partition pruning, written with a temp-key + md5-verify + copy +
delete atomic rename (`src/archive/`). A BigQuery external table reads the
archive; production never reads it back through this service.

### Digest

`digest` composes a daily health-summary email from Postgres + Cloud Monitoring
signals and sends it via SendGrid (`src/digest.ts`, `src/digest-providers.ts`).
It branches before the `EBIRD_API_KEY` guard (no eBird call) but still requires
`DATABASE_URL`. The Healthchecks.io heartbeat fires only on
`status === 'delivered'`, not on `queued` (`src/cli.ts:160-213`).

### Environment

| Var | Used by | Notes |
| --- | --- | --- |
| `EBIRD_API_KEY` | all ingest kinds | enforced uniformly across the shared image; not strictly needed by DB-only kinds |
| `DATABASE_URL` | all DB kinds | Cloud SQL Postgres 16 (Auth Proxy) in production |
| `OBSERVATIONS_RETENTION_DAYS` | `prune` | positive integer; overrides the 14-day default |
| `CACHE_WARM_BASE_URL` | `cache-warm` | defaults to `https://api.bird-maps.com` |
| `SENDGRID_API_KEY`, `DIGEST_EMAIL_RECIPIENT`, `DIGEST_FROM_ADDRESS` | `digest` | from address defaults to `digest@bird-maps.com` |
| `HEALTHCHECKS_URL_<KIND>` | per-kind heartbeat | e.g. `HEALTHCHECKS_URL_RECENT`. Ingest kinds ping on success/partial, never on failure (`src/cli.ts:399-405`). Two kinds deviate: `digest` pings only on `status === 'delivered'`, not on `queued` (`src/cli.ts:205-208`); `cache-warm` always pings on completion, with no failure path (`src/cli.ts:147-157`). |

### Deployment

Built into the shared Docker image and run as five Cloud Run v2 Jobs
(`bird-ingestor`, `bird-ingestor-photos`, `bird-ingestor-descriptions`,
`bird-ingestor-prune`, `bird-digest-daily`), each triggered by Cloud Scheduler.
The default `bird-ingestor` job (`args=["recent"]`) also serves `backfill`,
`backfill-extended`, `hotspots`, `taxonomy`, and `cache-warm` via per-scheduler
arg overrides. The per-state backfill fan-out adds **no** extra Cloud Run Jobs:
it is a single `google_cloud_scheduler_job` with `for_each`
(`backfill_per_state`, `infra/terraform/ingestor.tf:383-416`) whose members are
named `bird-ingestor-backfill-<state>` and invoke the shared `bird-ingestor`
job with `args=["backfill","--state=US-XX","--back=14"]`; these schedulers ship
paused (`paused = true`). See `infra/terraform/ingestor.tf` and
`infra/terraform/digest.tf`. Run exit codes: a runner `failure` sets
`process.exitCode = 1` (Cloud Run marks the execution failed) without killing
the pool-close; `partial` backfill is treated as success.

### Related

- Workspace dependency layer: `@bird-watch/db-client` (typed `pg` query layer),
  `@bird-watch/shared-types` (wire/domain types, `CONUS_STATE_CODES`).
- Repo conventions, context7 libraries, and the architecture spec: see the repo
  root `CLAUDE.md`.
