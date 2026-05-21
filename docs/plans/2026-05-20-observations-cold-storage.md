# Observations Cold Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan assumes zero prior context for this codebase — every task lists exact file paths, expected commands, and a commit-message template.

**Goal:** Preserve the rows we delete every night so the project keeps an indefinite, queryable, ML-friendly archive of observations without inflating the operational Cloud SQL database.

**Architecture:** Extend the nightly prune (`services/ingestor/src/run-prune.ts`) from "DELETE only" into "SELECT-and-enrich → write Parquet to GCS → DELETE". Storage is a new GCS bucket `bird-maps-prod-obs-archive` (Nearline, `us-west1`) holding one Parquet file per UTC date under a Hive-style partition layout. A BigQuery external table points at the bucket for SQL ad-hoc queries; DuckDB and Polars consume the same files locally for ML pipelines. The live map (last 14 days from Cloud SQL) is unchanged — the bucket is a side-output, never read by production.

**Tech Stack:** `@google-cloud/storage` (Node SDK; auth via the existing `bird-ingestor` service account's ADC inside Cloud Run) · `parquetjs-lite` for Parquet writes (alternative `apache-arrow` evaluated in T3) · `node-pg-migrate` for any schema additions (none expected) · Terraform `hashicorp/google` provider for the bucket + lifecycle rule + IAM binding + `google_bigquery_dataset` + `google_bigquery_table` (external) · Hive-style partitions for BigQuery/DuckDB partition pruning.

**Parent context:** No umbrella issue; this is a standalone forwards-only addition. The motivating analysis lives in conversation 2026-05-20 (locked design — see §Decision log).

---

## §1 — Background

### Current state (destructive prune)

`services/ingestor/src/run-prune.ts` is the entire write surface of the nightly retention job. It runs once a day (Cloud Scheduler → `bird-ingestor-prune` Cloud Run Job — see `infra/terraform/ingestor.tf:848-955`) and executes:

```sql
DELETE FROM observations WHERE obs_dt < now() - $1::interval  -- $1 = '14 days' by default
VACUUM (ANALYZE) observations
```

The retention window is 14 days (`DEFAULT_RETENTION_DAYS = 14` in `run-prune.ts:30`). Without this prune, the table grows unbounded; at national scale it exhausts Cloud SQL's allocated storage within months. The current design discards everything older than 14 days **forever**. There is no archive, no backup, no recovery path for the Phase 3a-era rows already deleted.

### What we lose by discarding

1. **Queryable history.** Ad-hoc questions like "what species were observed in California in March 2026?" cannot be answered against the live DB beyond 14 days back.
2. **ML training corpora.** Phenology models, occurrence-prediction models, and species-distribution models all need multi-year observation streams; rolling-window data is unusable.
3. **Per-region analytics.** Year-over-year comparisons (e.g. "is this year's Vermilion Flycatcher arrival earlier than last year's?") require archival data.
4. **Forensic debugging.** Issues like "why did this ingest run produce 3× the expected row count?" become unanswerable once the rows scroll off the window.

### Why not just enlarge the retention window?

The retention window is sized to Cloud SQL's storage tier (see `services/ingestor/src/run-prune.ts:13-15` and `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` Finding 8). At national scale, every additional day of retention costs operational DB storage; the 14-day window is the sweet spot for keeping the hot path on the tier we pay for. Cold storage on GCS is ~100× cheaper per byte than operational Postgres and decouples the analytics/ML use cases from the hot path entirely.

---

## §2 — Design

### Storage layer

- **Bucket:** `bird-maps-prod-obs-archive` in `us-west1` (same region as Cloud SQL → no cross-region egress charges on the archive writes).
- **Storage class:** `NEARLINE` initially. Lifecycle rule auto-transitions to `ARCHIVE` at 90 days.
- **Public access:** none. Bucket is private; only the ingestor SA writes; BigQuery service account + named human readers read.

**Why Nearline, not Coldline or Archive immediately?** Within the first 90 days, the data is hot-by-the-standards-of-cold-storage — anyone tuning a query, building a feature, or sanity-checking the archive itself will be re-reading recent partitions. Nearline ($0.010/GB-mo) charges no per-read fee beyond standard egress; Archive ($0.0012/GB-mo) charges $0.05/GB to retrieve and has a 365-day minimum-retention billing penalty. The lifecycle rule transitions to Archive at 90 days because by then the data is genuinely cold (used only for ML training runs that batch-read large slabs).

### File format

- **Format:** Parquet, gzip-compressed (Snappy works too; the writer choice in T3 decides).
- **Granularity:** one file per UTC date — i.e. one nightly write per partition.
- **Naming:** `day=DD/data.parquet` — `day=DD` is a DIRECTORY segment with a stable `data.parquet` filename, so BigQuery's Hive AUTO partition planner picks up `[year, month, day]` as queryable partition columns (#699). One file per UTC date today; the stable filename leaves room to shard a day across multiple files later.

**Why Parquet, not CSV or JSON or raw SQL?**

| Property | Parquet | CSV | JSON | SQL dump |
|---|---|---|---|---|
| Columnar (ML/analytics workload) | yes | no | no | no |
| Native typed (preserves TIMESTAMPTZ, DOUBLE) | yes | no | no | yes |
| Compresses well (~10×) | yes | no (~2×) | no (~2×) | n/a |
| Native BigQuery external-table support | yes | yes | yes (NDJSON) | no |
| Native DuckDB partition pruning | yes | partial | partial | no |
| Schema evolution (add column) safe | yes | risky | yes | yes |

Parquet is the only option that hits all five rows. CSV and JSON would force every ML pipeline to re-type-cast every column on every read; SQL dumps require restoring into a Postgres instance to query. The trade-off is one extra dependency on the ingestor (T3) — acceptable for the downstream win.

### Partition layout (Hive-style)

```
gs://bird-maps-prod-obs-archive/
  observations/
    year=2026/
      month=05/
        day=20/
          data.parquet
        day=21/
          data.parquet
        ...
      month=06/
        day=01/
          data.parquet
```

**Why Hive-style (`key=value`) partitioning, not flat date prefixes?** Both BigQuery external tables and DuckDB's `read_parquet('gs://...', hive_partitioning=1)` parse `year=YYYY/month=MM/day=DD` automatically and expose them as virtual columns the planner uses to prune at scan time. A query `WHERE year=2026 AND month=5` reads exactly 31 files; a flat layout would force a list-and-filter on every read. The cost difference at BigQuery's per-byte-scanned billing is the difference between $0.005 and $5 for a typical month-of-data query.

### Schema (what each Parquet file contains)

| Column | Type | Source |
|---|---|---|
| `sub_id` | STRING | `observations.sub_id` (eBird submission ID) |
| `species_code` | STRING | `observations.species_code` |
| `obs_dt` | TIMESTAMP (UTC) | `observations.obs_dt` |
| `lng` | DOUBLE | `observations.lng` |
| `lat` | DOUBLE | `observations.lat` |
| `obs_count` | INT (nullable) | `observations.how_many` (renamed for ML-friendly naming) |
| `is_notable` | BOOLEAN | `observations.is_notable` |
| `loc_id` | STRING | `observations.loc_id` |
| `loc_name` | STRING (nullable) | `observations.loc_name` |
| `common_name` | STRING (nullable) | `species_meta.com_name` (LEFT JOIN on species_code) |
| `sci_name` | STRING (nullable) | `species_meta.sci_name` (LEFT JOIN) |
| `family_code` | STRING (nullable) | `species_meta.family_code` (LEFT JOIN, renamed from spec's `observed_family` for accuracy) |
| `family_name` | STRING (nullable) | `species_meta.family_name` (LEFT JOIN) |
| `ingested_at` | TIMESTAMP (UTC) | `observations.ingested_at` |

**Note on the spec's `obs_id`:** the `observations` table has no `obs_id` column — its PK is `(sub_id, species_code)`. The archive does **not** synthesize an `obs_id`; downstream consumers compose the composite key from `sub_id || ':' || species_code` if they need a single string. T3 includes a test that proves the composite is unique per file.

**Why drop the PostGIS `geom` column?** `lng`/`lat` are the source-of-truth — the `geom` column on the live table is a `GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED` derived column (see `migrations/1700000006000_observations.sql:7`). Dropping it from the archive (a) saves ~30% of file size, (b) avoids serializing PostGIS-specific binary, (c) keeps the archive readable by ML tools (Polars, pandas) that do not speak PostGIS. BigQuery reconstructs spatial type on-demand via `ST_GEOGPOINT(lng, lat)`; DuckDB's spatial extension does the same. No information is lost.

**Why JOIN to `species_meta` at archive time?** The spec calls for `common_name`, `sci_name`, and family fields in the Parquet. These do not live on the `observations` table — they live on `species_meta`. Two options:

1. JOIN at archive time (chosen) — the Parquet is self-contained; downstream ML pipelines do not need to also load and join `species_meta`. Costs a single LEFT JOIN at SELECT time, which is cheap (Cloud SQL has `species_meta` fully indexed and it's a small table, ~10k rows).
2. JOIN at read time (rejected) — would require shipping `species_meta` snapshots alongside the observation parquet, adding another archive surface for taxonomy churn. Worse for ML simplicity.

The JOIN is `LEFT` not `INNER` so that an observation for an unmapped species code (rare but possible during taxonomy churn — e.g. eBird splits a species, our local `species_meta` is stale by a day) still archives with NULL species metadata rather than being silently dropped.

### Trigger / cadence

The archive write is **synchronous and transactional within the prune step**: a single `run-prune.ts` execution does archive-then-delete, not "archive in job A, delete in job B". Reasons:

1. **Atomic semantics.** If archive fails, the delete must not proceed. A separate job model would require a queue + dead-letter + state machine; a single job models this with a try/catch.
2. **One scheduler.** No new Cloud Scheduler entry, no new Cloud Run Job, no new IAM binding for cron invocation.
3. **One log stream.** A single `bird_ingest_archived` log entry per night carries the full archive-then-delete narrative.
4. **One failure mode.** If the archive job is broken, the prune halts and observations stack up — alarms fire from the existing `bird-ingestor-prune` Healthcheck.io heartbeat. A separate-job design would silently let the prune drift ahead of the archive.

The trade-off is a slightly longer wall-clock for the prune (archive a day of rows + upload to GCS + checksum). At national scale that's ~2-5M rows/day, which Parquet at ~50 bytes/row compressed = ~150-300 MB / day; upload to a same-region bucket takes <30s. Plenty of headroom inside the 300s job timeout.

### Query paths

| Use case | Tool | Pattern |
|---|---|---|
| Ad-hoc SQL | BigQuery external table | `SELECT count(*) FROM \`bird-maps-prod.observations_archive.observations\` WHERE year=2026 AND month=5` |
| ML training (local) | DuckDB | `duckdb -c "SELECT * FROM read_parquet('gs://bird-maps-prod-obs-archive/observations/year=2026/**/*.parquet', hive_partitioning=1)"` |
| ML feature pipeline | Python Polars | `pl.scan_parquet('gs://bird-maps-prod-obs-archive/observations/year=2026/**/*.parquet', hive_partitioning=True)` |
| One-off pandas | pandas + pyarrow | `pd.read_parquet('gs://bird-maps-prod-obs-archive/observations/year=2026/month=05/', filesystem=gcsfs)` |

See §7 for full worked examples.

### Lifecycle rule

```hcl
lifecycle_rule {
  condition { age = 90 }                  # days
  action    { type = "SetStorageClass" storage_class = "ARCHIVE" }
}
```

After 90 days, the partition's storage class drops from Nearline ($0.010/GB-mo) to Archive ($0.0012/GB-mo) — an 8× cost reduction. Archive's 365-day minimum retention is fine: these are permanent records.

### Schema evolution

Parquet handles column additions safely: old files retain their schema, new files include the new column. BigQuery external tables auto-detect schema with `autodetect = true` on each query (small per-query cost), or we can pin a schema via `schema` to lock in. DuckDB and Polars return NULL for missing columns when reading mixed-schema partitions.

If we drop a column from `observations` later, the archive writer skips it (no error); old archive files retain it. The reverse (add column) requires updating the SELECT list in T2 — covered by T2's tests.

### Cost projection

Assume national-scale steady state: ~2.5M rows/day, ~50 bytes/row Parquet+gzip → ~125 MB/day → ~46 GB/year.

| Year | Storage class | GB | $/GB-mo | $/year |
|---|---|---|---|---|
| 1 | All Nearline (no lifecycle yet) | 46 | $0.010 | **$5.52** |
| 1 (with lifecycle: 90d Nearline, 275d Archive) | mixed | 46 | weighted | **~$0.93** |
| 5 (no lifecycle) | Nearline | 230 | $0.010 | **$27.60** |
| 5 (with lifecycle, ~14d Nearline) | mostly Archive | 230 | weighted | **~$3.40** |

Numbers exclude egress (zero from BigQuery in-region; ~$0.12/GB for ad-hoc downloads outside us-west1) and operations (Nearline class-A op $0.01/10k, class-B op $0.004/10k — irrelevant at this volume).

The spec's "~$0.16/year, ~$0.18/year at year 5" assumed AZ-only volume (~5% of national). The national-scale numbers above are the production-relevant ones; even at the worst-case "all Nearline, year 5" figure ($28/year), the **real cost is implementer engineering time, not run-rate**.

### What stays the same

- The live map (`/api/observations` and `/api/tiles/...`) reads exclusively from Cloud SQL. The bucket is never on a request path.
- The 14-day retention window on the live DB is unchanged.
- The existing `bird-ingestor-prune` Cloud Run Job, its Scheduler entry, and its heartbeat all stay in place — this PR adds to the inner function, not the job surface.

---

## §3 — File structure (new + modified)

| Path | Disposition | Responsibility |
|---|---|---|
| `infra/terraform/observations-archive.tf` | **new** | GCS bucket + lifecycle rule + IAM (ingestor SA writer, BigQuery SA reader) + BigQuery dataset + BigQuery external table |
| `services/ingestor/src/archive/parquet-writer.ts` | **new** | Single-file Parquet writer (column list, schema, type mapping) |
| `services/ingestor/src/archive/parquet-writer.test.ts` | **new** | Roundtrip tests against an in-memory Buffer |
| `services/ingestor/src/archive/gcs-uploader.ts` | **new** | GCS PUT (temp object → atomic rename via copy + delete) |
| `services/ingestor/src/archive/gcs-uploader.test.ts` | **new** | `@google-cloud/storage` stubbed via dependency injection |
| `services/ingestor/src/archive/select-archivable.ts` | **new** | The SQL SELECT-JOIN that produces archive rows (pure DB layer; reusable in tests) |
| `services/ingestor/src/archive/select-archivable.test.ts` | **new** | Integration test against testcontainers Postgres (real JOIN with `species_meta`) |
| `services/ingestor/src/archive/index.ts` | **new** | Barrel export; the public surface is `archiveAndDelete(opts)` |
| `services/ingestor/src/run-prune.ts` | **modify** | Replace `runPrune` body: per-day loop → `selectArchivable → writeParquet → uploadGcs → deleteRows`. Keep `RunPruneSummary` backwards-compatible; add `archived` (count) + `gcsPaths` (string[]) fields. |
| `services/ingestor/src/run-prune.test.ts` | **modify** | Existing tests update to assert archive happens before delete; new tests cover failure modes (archive fails → DELETE does not run; partial-day boundary; empty-table no-op) |
| `services/ingestor/package.json` | **modify** | Add `@google-cloud/storage` + `parquetjs-lite` to `dependencies` |
| `services/ingestor/Dockerfile` | **modify** (if any native deps for parquetjs-lite) | Likely no change — parquetjs-lite is pure JS |
| `docs/runbooks/observations-archive.md` | **new** | Operator runbook (verification queries, restore-from-archive procedure, BQ external-table refresh) |
| `infra/terraform/ingestor.tf` | **modify** | (1) Add a cross-link comment block pointing to `observations-archive.tf` for the IAM bindings. (2) Bump the `ingestor_prune` `resources.limits.memory` from `512Mi` → `2Gi` to accommodate the archive-then-delete flow's in-process Parquet buffering at national scale (see R9). |
| `infra/terraform/monitoring.tf` | **modify** | T8: append 2 new `google_logging_metric` resources (`bird-ingest-archived-row-count`, `bird-ingest-archived-bytes-uploaded`) — distribution metrics that extract `rowCount` and `bytesUploaded` from the `bird_ingest_archived` structured-log line emitted by T2's `run-prune.ts`. Also a third `google_logging_metric` (`bird-ingest-archived-deleted-count`) for the parity widget. |
| `infra/terraform/monitoring-dashboard.tf` | **modify** | T8: append 4 new tiles (Row 5) to the existing `bird-watch overview` dashboard's `mosaicLayout.tiles` array — (1) rows archived per night, (2) bytes uploaded per night, (3) archive vs delete parity (2-line chart), (4) GCS bucket size 90d (`storage.googleapis.com/storage/total_bytes` filtered to `bird-maps-prod-obs-archive`). |

---

## Quantified plan literals (implementer checklist)

Before opening a PR for this plan, check off each item or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Provision 1 GCS bucket `bird-maps-prod-obs-archive` in region `us-west1`
- [ ] Configure 1 lifecycle rule: transition to ARCHIVE at age 90 days
- [ ] Provision 1 BigQuery dataset `observations_archive` in location `us-west1`
- [ ] Provision 1 BigQuery external table `observations` over the bucket
- [ ] Add 2 npm dependencies to `services/ingestor`: `@google-cloud/storage`, `parquetjs-lite`
- [ ] Schema includes 14 columns in every Parquet file (see §2)
- [ ] LEFT JOIN to `species_meta` yields no INNER-JOIN row loss (covered by T4 test)
- [ ] Add 3 `google_logging_metric` resources and 4 dashboard tiles for archive observability (T8)
- [ ] All 8 tasks (T1–T8) shipped or each unchecked task has a lexically-matching deferral doc

---

## §4 — Implementation tasks

### Task 1: Terraform — bucket, lifecycle, BigQuery dataset, external table, IAM

**Files:**
- Create: `infra/terraform/observations-archive.tf`
- Modify: `infra/terraform/ingestor.tf` (cross-link comment + `ingestor_prune` memory bump to `2Gi`; IAM bindings live in the new file)

- [ ] **Step 1: Write the bucket + lifecycle + IAM + BigQuery resources**

  Create `infra/terraform/observations-archive.tf` with the following (paste verbatim; rename comments only):

  ```hcl
  # Observations cold storage — see docs/plans/2026-05-20-observations-cold-storage.md.
  #
  # GCS Nearline bucket holding nightly Parquet exports of pruned observations.
  # Hive-partitioned: observations/year=YYYY/month=MM/day=DD.parquet. BigQuery
  # external table sits over the bucket for ad-hoc SQL; DuckDB and Polars
  # consume the same files locally for ML.

  resource "google_storage_bucket" "obs_archive" {
    name                        = "bird-maps-prod-obs-archive"
    location                    = "US-WEST1"
    storage_class               = "NEARLINE"
    uniform_bucket_level_access = true
    public_access_prevention    = "enforced"

    # Per-day Parquet files are reconstitutable in principle (re-export from
    # Cloud SQL) only within the 14-day live window; older partitions are
    # the sole copy of those observations. A `terraform destroy` typo would
    # wipe years of unrecoverable data — the prevent_destroy guard matches
    # the cloudflare_r2_bucket.photos pattern in infra/terraform/photos.tf.
    lifecycle {
      prevent_destroy = true
    }

    # 90-day Nearline → Archive transition. Nearline is right for the first
    # 90 days while anyone tuning a query or sanity-checking the archive
    # re-reads recent partitions; Archive's $0.0012/GB-mo is 8× cheaper but
    # has a $0.05/GB retrieval fee and a 365-day minimum-retention billing
    # penalty. After 90 days the data is genuinely cold (only ML training
    # batch-reads), and Archive is the right tier.
    lifecycle_rule {
      condition { age = 90 }
      action {
        type          = "SetStorageClass"
        storage_class = "ARCHIVE"
      }
    }
  }

  # Ingestor SA writes nightly Parquet exports. Object-level role; no admin
  # or bucket-level binding (the ingestor never lists or deletes archive
  # objects).
  resource "google_storage_bucket_iam_member" "ingestor_archive_writer" {
    bucket = google_storage_bucket.obs_archive.name
    role   = "roles/storage.objectCreator"
    member = "serviceAccount:${google_service_account.ingestor.email}"
  }

  # Ingestor SA also reads — needed for the temp-object → atomic-rename
  # uploader pattern (T2): we PUT to a temp key, verify the md5, then
  # rewrite to the final partition key. The objectCreator role does not
  # include read.
  resource "google_storage_bucket_iam_member" "ingestor_archive_reader" {
    bucket = google_storage_bucket.obs_archive.name
    role   = "roles/storage.objectViewer"
    member = "serviceAccount:${google_service_account.ingestor.email}"
  }

  # BigQuery dataset for the external table. Same region as the bucket —
  # cross-region external-table reads cost egress.
  resource "google_bigquery_dataset" "obs_archive" {
    dataset_id  = "observations_archive"
    location    = "US-WEST1"
    description = "Observations cold storage; external table over gs://bird-maps-prod-obs-archive."
  }

  # External table over the Hive-partitioned Parquet layout. autodetect on
  # schema means we don't lock in a specific column list here — a future
  # observations column addition flows through without a Terraform change.
  resource "google_bigquery_table" "observations" {
    dataset_id = google_bigquery_dataset.obs_archive.dataset_id
    table_id   = "observations"

    deletion_protection = true

    external_data_configuration {
      autodetect    = true
      source_format = "PARQUET"

      source_uris = [
        "gs://${google_storage_bucket.obs_archive.name}/observations/*.parquet",
      ]

      hive_partitioning_options {
        mode              = "AUTO"
        source_uri_prefix = "gs://${google_storage_bucket.obs_archive.name}/observations/"
      }
    }
  }

  # Budget alert at $5/mo — at national scale year-1 the bucket should sit
  # near $0.50/mo; $5 catches any 10× surprise (runaway upload, lifecycle
  # rule misconfigured, etc.) without false-firing on normal growth.
  # See infra/terraform/budget.tf for the project-wide budget shape.
  output "obs_archive_bucket_name" {
    value = google_storage_bucket.obs_archive.name
  }

  output "obs_archive_bq_dataset" {
    value = google_bigquery_dataset.obs_archive.dataset_id
  }
  ```

- [ ] **Step 2: Run `terraform fmt` and `terraform validate`**

  ```bash
  cd infra/terraform
  terraform fmt observations-archive.tf
  terraform init -upgrade
  terraform validate
  ```

  Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Run `terraform plan` and confirm the diff**

  ```bash
  terraform plan -out=archive.plan
  ```

  Expected: 6 resources to add (bucket, 2 IAM bindings, dataset, table, no changes elsewhere). Inspect the bucket region (`US-WEST1`), storage class (`NEARLINE`), lifecycle action (`SetStorageClass`/`ARCHIVE`/age 90).

  Save the plan output to the PR description. Do NOT apply yet — apply is gated on T4 (tests green) and T5 (runbook).

- [ ] **Step 4: Add the cross-link comment in `infra/terraform/ingestor.tf`**

  At the top of the `# ── Observations prune job (issue #587) ────` block (around line 831), add a `See also` comment block:

  ```hcl
  # See also infra/terraform/observations-archive.tf — the archive bucket and
  # IAM bindings the prune job writes to before deleting. The prune job's SA
  # gains storage.objectCreator/Viewer on the bucket via the observations-
  # archive.tf bindings.
  ```

- [ ] **Step 5: Bump the prune-job memory cap in `infra/terraform/ingestor.tf`**

  The pre-archive prune was a plain `DELETE`; this plan extends it into
  `SELECT → enrich → buffer in JS → Parquet write → upload → DELETE`. The
  in-process memory footprint grows by an order of magnitude:

  - Node baseline (~80–120 MB) before any work.
  - `ArchivableRow[]` from `selectArchivable` — at national scale, ~2.5M rows/day × ~250 B/row (denormalized `common_name`/`sci_name`/`family_name` strings push beyond the raw column widths) ≈ **600 MB resident** before Parquet writing starts.
  - `parquetjs-lite` column buffers during the write pass (incremental, but doubles peak for a brief window).
  - The returned `Buffer` from the writer (writer drains to tmpfs — RAM-backed on Cloud Run — then reads back; the bytes exist twice at the upload moment).

  512 MiB is comfortable for AZ-only synthetic-test volume but tight at national scale and exposes the job to a quiet OOM somewhere between regional and national rollout (testcontainers-Postgres T2 suite runs at synthetic small volume and will not catch this). Bump the `resources.limits` for `google_cloud_run_v2_job.ingestor_prune` from `memory = "512Mi"` (line ~874) to `memory = "2Gi"`:

  ```hcl
  resources {
    # Bumped from "512Mi" in PR for issue #689: the archive-then-delete prune
    # holds the day's ArchivableRow[] in JS heap (~600 MB at national scale)
    # + parquetjs-lite column buffers + the post-write Buffer round-trip.
    # See R9 in docs/plans/2026-05-20-observations-cold-storage.md. Revisit
    # if the streaming writer mitigation (R9) ships and removes the
    # double-buffering.
    limits = { cpu = "1", memory = "2Gi" }
  }
  ```

  Leave `cpu = "1"` alone — the prune is I/O-bound (Postgres roundtrips + GCS upload) and adding CPU does not help. Cloud Run Jobs bill per CPU-second + per GiB-second; the marginal cost of `2Gi` vs `512Mi` for a 5-minute nightly run is ~$0.10/year.

- [ ] **Step 6: Commit**

  ```bash
  git add infra/terraform/observations-archive.tf infra/terraform/ingestor.tf
  git commit -m "infra(archive): GCS Nearline bucket + BQ external table for observations cold storage; bump prune memory to 2Gi"
  ```

---

### Task 2: Refactor `run-prune.ts` — archive-then-delete with per-day loop

**Files:**
- Modify: `services/ingestor/src/run-prune.ts`
- Modify: `services/ingestor/src/run-prune.test.ts`
- Create: `services/ingestor/src/archive/select-archivable.ts`
- Create: `services/ingestor/src/archive/select-archivable.test.ts`
- Create: `services/ingestor/src/archive/index.ts`

- [ ] **Step 1: Write the failing test for `selectArchivable`**

  Create `services/ingestor/src/archive/select-archivable.test.ts`:

  ```typescript
  import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
  import { startTestDb, type TestDb } from '@bird-watch/db-client/dist/test-helpers.js';
  import { selectArchivable } from './select-archivable.js';

  let db: TestDb;

  beforeAll(async () => {
    db = await startTestDb();
    await db.pool.query(
      `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
       VALUES ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers')`
    );
  }, 90_000);

  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
  });

  afterAll(async () => { await db?.stop(); });

  describe('selectArchivable', () => {
    it('returns rows for a single UTC day with species_meta joined', async () => {
      await db.pool.query(
        `INSERT INTO observations
           (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
         VALUES
           ('S1', 'vermfly', 31.72, -110.88, '2026-05-01T12:00:00Z', 'L1', 'A', 2, false),
           ('S2', 'vermfly', 31.73, -110.89, '2026-05-01T18:00:00Z', 'L2', 'B', 1, true),
           ('S3', 'vermfly', 31.74, -110.90, '2026-05-02T00:00:01Z', 'L3', null, null, false)`
      );

      const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        sub_id: 'S1',
        species_code: 'vermfly',
        common_name: 'Vermilion Flycatcher',
        sci_name: 'Pyrocephalus rubinus',
        family_code: 'tyrannidae',
        family_name: 'Tyrant Flycatchers',
        is_notable: false,
      });
      expect(rows.find(r => r.sub_id === 'S2')?.is_notable).toBe(true);
    });

    it('returns rows for species with no species_meta entry (LEFT JOIN, not INNER)', async () => {
      await db.pool.query(
        `INSERT INTO observations
           (sub_id, species_code, lat, lng, obs_dt, loc_id, how_many, is_notable)
         VALUES ('S4', 'unknownsp', 31.72, -110.88, '2026-05-01T12:00:00Z', 'L1', 1, false)`
      );

      const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });

      expect(rows).toHaveLength(1);
      expect(rows[0]?.common_name).toBeNull();
      expect(rows[0]?.family_code).toBeNull();
    });

    it('returns an empty array when no rows match the day', async () => {
      const rows = await selectArchivable({ pool: db.pool, utcDate: '2026-05-01' });
      expect(rows).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  cd services/ingestor && npx vitest run src/archive/select-archivable.test.ts
  ```

  Expected: FAIL with "Cannot find module './select-archivable.js'".

- [ ] **Step 3: Implement `selectArchivable`**

  Create `services/ingestor/src/archive/select-archivable.ts`:

  ```typescript
  import type { Pool } from '@bird-watch/db-client';

  export interface ArchivableRow {
    sub_id: string;
    species_code: string;
    obs_dt: Date;
    lng: number;
    lat: number;
    obs_count: number | null;
    is_notable: boolean;
    loc_id: string;
    loc_name: string | null;
    common_name: string | null;
    sci_name: string | null;
    family_code: string | null;
    family_name: string | null;
    ingested_at: Date;
  }

  export interface SelectArchivableOptions {
    pool: Pool;
    /** UTC date in ISO YYYY-MM-DD form. Selects rows where obs_dt is on this UTC day. */
    utcDate: string;
  }

  /**
   * Selects the observations rows whose `obs_dt` falls on the given UTC day,
   * LEFT JOINed to `species_meta` for the denormalized common_name / sci_name /
   * family_code / family_name. LEFT JOIN (not INNER) so that an observation
   * for an unmapped species code still archives — with NULL species metadata —
   * rather than being silently dropped.
   *
   * The renamed columns (`how_many` → `obs_count`, `com_name` → `common_name`)
   * are aliased here so the Parquet writer sees ML-friendly names without
   * needing a second mapping layer.
   */
  export async function selectArchivable(
    o: SelectArchivableOptions
  ): Promise<ArchivableRow[]> {
    const { rows } = await o.pool.query<ArchivableRow>(
      `SELECT
         obs.sub_id,
         obs.species_code,
         obs.obs_dt,
         obs.lng,
         obs.lat,
         obs.how_many   AS obs_count,
         obs.is_notable,
         obs.loc_id,
         obs.loc_name,
         sm.com_name    AS common_name,
         sm.sci_name,
         sm.family_code,
         sm.family_name,
         obs.ingested_at
       FROM observations obs
       LEFT JOIN species_meta sm USING (species_code)
       WHERE obs.obs_dt >= ($1::date)::timestamptz
         AND obs.obs_dt <  (($1::date) + INTERVAL '1 day')::timestamptz
       ORDER BY obs.obs_dt`,
      [o.utcDate]
    );
    return rows;
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

  ```bash
  npx vitest run src/archive/select-archivable.test.ts
  ```

  Expected: 3 passed.

- [ ] **Step 5: Commit**

  ```bash
  git add services/ingestor/src/archive/select-archivable.ts services/ingestor/src/archive/select-archivable.test.ts
  git commit -m "feat(ingestor): selectArchivable — per-UTC-day observations + species_meta LEFT JOIN"
  ```

- [ ] **Step 6: Refactor `run-prune.ts` to wire the archive call**

  This step lands the orchestration layer; the Parquet writer + GCS uploader land in T3. For now, stub the archive call to a no-op so the test surface is decoupled. Modify `services/ingestor/src/run-prune.ts`:

  ```typescript
  import {
    startIngestRun, finishIngestRun,
    type Pool,
  } from '@bird-watch/db-client';
  import { selectArchivable, type ArchivableRow } from './archive/select-archivable.js';

  export interface RunPruneOptions {
    pool: Pool;
    /**
     * Rolling-window size in days. Rows with `obs_dt < now() - retentionDays`
     * are first archived to GCS, then deleted. Default 14 — matches the
     * steady-state Cloud SQL runway (see docs/analyses/2026-05-14-process-
     * scale-options/phase-4/analysis-report.md Finding 8).
     */
    retentionDays?: number;
    /**
     * Per-day archive callback. Production wires the Parquet+GCS uploader
     * (T3); tests pass a stub that captures the rows in memory. The archive
     * MUST resolve successfully before the day's rows are deleted — any
     * thrown error short-circuits the delete for that day and the runner
     * records `status: 'failure'`.
     */
     archiveDay: (utcDate: string, rows: ArchivableRow[]) => Promise<{ gcsPath: string; bytes: number }>;
  }

  export interface RunPruneSummary {
    status: 'success' | 'failure';
    deleted: number;
    archived: number;
    archivedDays: number;
    gcsPaths: string[];
    retentionDays: number;
    error?: string;
  }

  export const DEFAULT_RETENTION_DAYS = 14;

  /**
   * Nightly archive-then-prune job.
   *
   * For each UTC date that falls fully outside the retention window:
   *   1. SELECT the day's rows (LEFT JOIN species_meta) via selectArchivable.
   *   2. archiveDay(utcDate, rows) → writes Parquet to GCS (T3 wiring).
   *   3. DELETE the day's rows from observations.
   *
   * After all days are processed, VACUUM (ANALYZE) observations recovers
   * GIST/B-tree dead-tuple bloat.
   *
   * The archive-then-delete pair is per-day and synchronous: if step 2 throws
   * for day D, step 3 for day D does NOT run, and the runner returns
   * status: 'failure' with the count of days that DID succeed in archived/
   * archivedDays. Prior days that succeeded keep their archive + delete —
   * partial progress is preserved.
   */
  export async function runPrune(o: RunPruneOptions): Promise<RunPruneSummary> {
    const retentionDays = o.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const runId = await startIngestRun(o.pool, 'prune');

    let deleted = 0;
    let archived = 0;
    const gcsPaths: string[] = [];
    const archivedDays = new Set<string>();

    try {
      // Enumerate the UTC dates that need archiving: every UTC day whose
      // ENTIRE 24-hour range is older than the cutoff. We bound by
      // `date_trunc('day', now() - retention)` rather than `now() - retention`
      // so a partial-overlap day (e.g. cutoff = 03:00Z falling inside day D)
      // is skipped and rolls into tomorrow's run. Invariant: the SELECT/DELETE
      // below archive a FULL UTC day [D 00:00Z, D+1 00:00Z), so every row
      // archived must be < the cutoff — only fully-closed days satisfy that.
      // Bounded by the oldest row to avoid an unbounded loop if the cron
      // has been missed for weeks.
      const { rows: dayRows } = await o.pool.query<{ utc_date: string }>(
        `SELECT DISTINCT (obs_dt AT TIME ZONE 'UTC')::date::text AS utc_date
           FROM observations
          WHERE obs_dt < date_trunc('day', now() - ($1 || ' days')::interval)
          ORDER BY utc_date`,
        [String(retentionDays)]
      );

      for (const { utc_date } of dayRows) {
        const rows = await selectArchivable({ pool: o.pool, utcDate: utc_date });
        if (rows.length === 0) continue;

        const { gcsPath, bytes } = await o.archiveDay(utc_date, rows);
        gcsPaths.push(gcsPath);
        archived += rows.length;
        archivedDays.add(utc_date);

        const { rowCount } = await o.pool.query(
          `DELETE FROM observations
             WHERE obs_dt >= ($1::date)::timestamptz
               AND obs_dt <  (($1::date) + INTERVAL '1 day')::timestamptz`,
          [utc_date]
        );
        deleted += rowCount ?? 0;

        console.log(JSON.stringify({
          severity: 'INFO',
          message: 'bird_ingest_archived',
          date: utc_date,
          rowCount: rows.length,
          deletedCount: rowCount ?? 0,
          gcsPath,
          bytesUploaded: bytes,
        }));
      }

      await o.pool.query('VACUUM (ANALYZE) observations');
      await finishIngestRun(o.pool, runId, {
        status: 'success', obsFetched: deleted, obsUpserted: 0,
      });
      return {
        status: 'success', deleted, archived,
        archivedDays: archivedDays.size, gcsPaths, retentionDays,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await finishIngestRun(o.pool, runId, { status: 'failure', errorMessage: msg });
      return {
        status: 'failure', deleted, archived,
        archivedDays: archivedDays.size, gcsPaths, retentionDays, error: msg,
      };
    }
  }
  ```

- [ ] **Step 7: Update existing `run-prune.test.ts` for the new signature**

  Existing tests need to pass an `archiveDay` stub. Replace each `runPrune({ pool: db.pool, retentionDays: 14 })` call with:

  ```typescript
  const archived: Array<{ utcDate: string; rowCount: number }> = [];
  const stubArchive = async (utcDate: string, rows: ArchivableRow[]) => {
    archived.push({ utcDate, rowCount: rows.length });
    return { gcsPath: `gs://test/observations/year=2026/month=05/day=${utcDate.slice(8)}.parquet`, bytes: 1 };
  };
  const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stubArchive });
  ```

  Add four new tests:

  ```typescript
  it('archives the day before deleting it, never the other way', async () => {
    await seedAt('OLD-1', 30);
    const order: string[] = [];
    const stubArchive = async (utcDate: string, rows: ArchivableRow[]) => {
      // Confirm the rows still exist in the DB at archive time
      const { rows: present } = await db.pool.query(
        `SELECT count(*) FROM observations WHERE obs_dt::date = $1::date`,
        [utcDate]
      );
      order.push(`archive:${present[0]?.count}`);
      return { gcsPath: 'gs://test/x.parquet', bytes: 1 };
    };
    await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stubArchive });
    expect(order[0]).toBe('archive:1'); // row visible at archive time
    const { rowCount } = await db.pool.query('SELECT 1 FROM observations');
    expect(rowCount).toBe(0); // and gone after
  });

  it('does NOT delete the day if archive throws', async () => {
    await seedAt('OLD-1', 30);
    const stubArchive = async () => { throw new Error('GCS unreachable'); };
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stubArchive });
    expect(summary.status).toBe('failure');
    expect(summary.deleted).toBe(0);
    const { rowCount } = await db.pool.query('SELECT 1 FROM observations');
    expect(rowCount).toBe(1);
  });

  it('handles an empty table as a clean no-op', async () => {
    const stubArchive = async () => ({ gcsPath: 'unused', bytes: 0 });
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stubArchive });
    expect(summary.status).toBe('success');
    expect(summary.archived).toBe(0);
    expect(summary.deleted).toBe(0);
  });

  it('skips the partial-overlap UTC day at the retention cutoff', async () => {
    // Bug shape (pre-fix): the day-enumeration query selected any UTC day
    // with AT LEAST ONE row older than `now() - retention`. The per-day
    // DELETE then wiped the FULL UTC day [D 00:00Z, D+1 00:00Z), including
    // rows on D that were still inside the retention window. Net effect:
    // the partial-overlap day's recent rows were wrongly archived AND
    // deleted on the same run, shortening effective retention by up to 24h.
    //
    // Fix (post): bound by `date_trunc('day', now() - retention)` instead
    // of `now() - retention`. Only fully-closed UTC days are enumerated.
    //
    // To exercise the bug we need two rows on the SAME UTC day: one older
    // than cutoff (would have triggered the old enumeration), one newer
    // than cutoff (would have been wrongly deleted by the day-wide DELETE).
    // We anchor both inserts relative to `date_trunc('day', now() - INTERVAL '14 days')`
    // (the cutoff day's start in UTC) so we don't depend on CI-time-of-day.
    await db.pool.query(
      `INSERT INTO observations (sub_id, species_code, lat, lng, obs_dt, loc_id, how_many, is_notable)
       VALUES
         ('BOUNDARY-OLD', 'vermfly', 31.7, -110.9,
           date_trunc('day', now() - INTERVAL '14 days') - INTERVAL '1 hour',
           'L1', 1, false),
         ('BOUNDARY-NEW', 'vermfly', 31.7, -110.9,
           date_trunc('day', now() - INTERVAL '14 days') + INTERVAL '1 hour',
           'L1', 1, false)`
    );
    const stubArchive = async () => ({ gcsPath: 'gs://test/x.parquet', bytes: 1 });
    const summary = await runPrune({ pool: db.pool, retentionDays: 14, archiveDay: stubArchive });
    // The cutoff day itself is now skipped; the prior day (where the OLD
    // row lives) IS fully past the cutoff and IS archived+deleted.
    // BOUNDARY-OLD: on day D-1, fully past cutoff — archived+deleted.
    // BOUNDARY-NEW: on day D (the partial-overlap day) — preserved.
    const { rows: remaining } = await db.pool.query<{ sub_id: string }>(
      `SELECT sub_id FROM observations ORDER BY sub_id`
    );
    expect(remaining.map(r => r.sub_id)).toEqual(['BOUNDARY-NEW']);
    expect(summary.deleted).toBe(1);
  });
  ```

  This test specifically demonstrates the contract: rows inside the
  retention window on the cutoff day are preserved, while rows on
  fully-closed prior days are still archived and deleted. Under the
  pre-fix bounds, `BOUNDARY-NEW` would be wrongly deleted because the
  per-day DELETE wiped the entire cutoff day including its post-cutoff
  rows.

- [ ] **Step 8: Run all `run-prune` tests**

  ```bash
  npx vitest run src/run-prune.test.ts
  ```

  Expected: all previously-green tests still pass + 4 new tests pass.

- [ ] **Step 9: Commit**

  ```bash
  git add services/ingestor/src/run-prune.ts services/ingestor/src/run-prune.test.ts services/ingestor/src/archive/index.ts
  git commit -m "refactor(ingestor): archive-then-delete in runPrune; dependency-injected archiveDay"
  ```

---

### Task 3: Parquet writer — dependency choice + implementation

**Files:**
- Modify: `services/ingestor/package.json`
- Create: `services/ingestor/src/archive/parquet-writer.ts`
- Create: `services/ingestor/src/archive/parquet-writer.test.ts`

#### Library choice: `parquetjs-lite` vs `apache-arrow`

| Property | `parquetjs-lite` | `apache-arrow` |
|---|---|---|
| Size (gzip) | ~80 KB | ~2.1 MB |
| Native deps | none (pure JS) | none (WASM bundle, but pure JS API) |
| Maintenance | active fork of long-abandoned `parquetjs`, still receives updates | first-party Apache project, far more active |
| Supports gzip/snappy compression | yes (gzip via Node's `zlib`; snappy via optional dep) | yes (all formats) |
| TIMESTAMPTZ support | yes, via `TIMESTAMP_MILLIS` logical type | yes, more granular logical types |
| Streaming write | yes, via `ParquetWriter.openStream` | yes, via `RecordBatchStreamWriter` |
| Bundle size matters here? | low (Cloud Run container, not browser) | irrelevant in container |
| Existing codebase precedent | none | none |

**Recommendation: `parquetjs-lite`.** Reasons:

1. Smaller surface area for a single-purpose utility (one writer call per night). `apache-arrow` is the right pick when you need Arrow's full columnar runtime (compute kernels, IPC formats, etc.) — we don't.
2. The ingestor container is the consumer; a 2 MB dep is fine, but the smaller dep means fewer transitive vulnerabilities to track.
3. The Parquet output is consumed by BigQuery / DuckDB / Polars, all of which read the wire format identically regardless of which library wrote it.
4. If `parquetjs-lite` becomes unmaintained, the migration to `apache-arrow` is a localized swap inside one file (`parquet-writer.ts`) — no cascading change.

Fallback if `parquetjs-lite` rejects in CI (Node compat surprise, WASM build issue on the Cloud Run image): pivot to `apache-arrow` in the same task. The test suite is library-agnostic (it asserts on the roundtrip behavior, not API shape).

- [ ] **Step 1: Add the dependency**

  ```bash
  cd services/ingestor
  npm install parquetjs-lite @google-cloud/storage
  ```

  Expected: `package.json` and `package-lock.json` updated with new versions; `node_modules` populated. Verify:

  ```bash
  npm ls parquetjs-lite @google-cloud/storage
  ```

- [ ] **Step 2: Write the failing roundtrip test**

  Create `services/ingestor/src/archive/parquet-writer.test.ts`:

  ```typescript
  import { describe, it, expect } from 'vitest';
  import { writeArchiveParquet, readArchiveParquet } from './parquet-writer.js';
  import type { ArchivableRow } from './select-archivable.js';

  const sample: ArchivableRow[] = [
    {
      sub_id: 'S1', species_code: 'vermfly',
      obs_dt: new Date('2026-05-01T12:00:00Z'),
      lng: -110.88, lat: 31.72,
      obs_count: 2, is_notable: false,
      loc_id: 'L1', loc_name: 'A',
      common_name: 'Vermilion Flycatcher', sci_name: 'Pyrocephalus rubinus',
      family_code: 'tyrannidae', family_name: 'Tyrant Flycatchers',
      ingested_at: new Date('2026-05-01T13:00:00Z'),
    },
    {
      sub_id: 'S2', species_code: 'unknownsp',
      obs_dt: new Date('2026-05-01T18:30:00Z'),
      lng: -110.89, lat: 31.73,
      obs_count: null, is_notable: true,
      loc_id: 'L2', loc_name: null,
      common_name: null, sci_name: null,
      family_code: null, family_name: null,
      ingested_at: new Date('2026-05-01T19:00:00Z'),
    },
  ];

  describe('writeArchiveParquet / readArchiveParquet', () => {
    it('roundtrips a non-empty batch with nullable columns intact', async () => {
      const bytes = await writeArchiveParquet(sample);
      const round = await readArchiveParquet(bytes);
      expect(round).toHaveLength(2);
      expect(round[0]?.sub_id).toBe('S1');
      expect(round[0]?.common_name).toBe('Vermilion Flycatcher');
      expect(round[1]?.common_name).toBeNull();
      expect(round[1]?.is_notable).toBe(true);
    });

    it('produces a stable schema: 14 columns', async () => {
      const bytes = await writeArchiveParquet(sample);
      const round = await readArchiveParquet(bytes);
      const keys = Object.keys(round[0] ?? {}).sort();
      expect(keys).toEqual([
        'common_name', 'family_code', 'family_name',
        'ingested_at', 'is_notable', 'lat', 'lng',
        'loc_id', 'loc_name', 'obs_count', 'obs_dt',
        'sci_name', 'species_code', 'sub_id',
      ]);
    });

    it('writes a non-empty buffer for an empty input (header-only Parquet)', async () => {
      const bytes = await writeArchiveParquet([]);
      expect(bytes.length).toBeGreaterThan(0);
      const round = await readArchiveParquet(bytes);
      expect(round).toEqual([]);
    });
  });
  ```

- [ ] **Step 3: Run the test to verify it fails**

  ```bash
  npx vitest run src/archive/parquet-writer.test.ts
  ```

  Expected: FAIL with "Cannot find module './parquet-writer.js'".

- [ ] **Step 4: Implement the writer + reader**

  Create `services/ingestor/src/archive/parquet-writer.ts`:

  ```typescript
  // @ts-expect-error — parquetjs-lite ships without types; the API surface
  // we use (ParquetSchema, ParquetWriter, ParquetReader) is stable.
  import parquet from 'parquetjs-lite';
  import type { ArchivableRow } from './select-archivable.js';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';
  import { mkdtemp, readFile, rm } from 'node:fs/promises';

  /**
   * Schema for the observations archive. Column order matches the SELECT
   * in select-archivable.ts and the table in the plan §2. UTF8 strings,
   * DOUBLE for lng/lat, INT64 milliseconds for timestamps (TIMESTAMPTZ on
   * the source side; UTC milliseconds in Parquet). Nullable on every
   * column the upstream JOIN can leave NULL.
   *
   * Compression: gzip. Snappy is also supported but adds an optional
   * native dep — gzip via Node's zlib is fine for the row counts we ship.
   */
  const schema = new parquet.ParquetSchema({
    sub_id:       { type: 'UTF8' },
    species_code: { type: 'UTF8' },
    obs_dt:       { type: 'TIMESTAMP_MILLIS' },
    lng:          { type: 'DOUBLE' },
    lat:          { type: 'DOUBLE' },
    obs_count:    { type: 'INT32', optional: true },
    is_notable:   { type: 'BOOLEAN' },
    loc_id:       { type: 'UTF8' },
    loc_name:     { type: 'UTF8', optional: true },
    common_name:  { type: 'UTF8', optional: true },
    sci_name:     { type: 'UTF8', optional: true },
    family_code:  { type: 'UTF8', optional: true },
    family_name:  { type: 'UTF8', optional: true },
    ingested_at:  { type: 'TIMESTAMP_MILLIS' },
  });

  /**
   * Write a batch of ArchivableRow to a Parquet buffer. Returns the gzip-
   * compressed Parquet bytes ready for GCS upload. Uses a temp file under
   * the writer because parquetjs-lite's streaming API targets file paths;
   * we read the bytes back and unlink the temp file before returning.
   */
  export async function writeArchiveParquet(rows: ArchivableRow[]): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'birdwatch-archive-'));
    const path = join(dir, 'archive.parquet');
    try {
      const writer = await parquet.ParquetWriter.openFile(schema, path, {
        compression: 'GZIP',
      });
      for (const row of rows) {
        await writer.appendRow({
          ...row,
          obs_count: row.obs_count ?? undefined,
          loc_name: row.loc_name ?? undefined,
          common_name: row.common_name ?? undefined,
          sci_name: row.sci_name ?? undefined,
          family_code: row.family_code ?? undefined,
          family_name: row.family_name ?? undefined,
        });
      }
      await writer.close();
      return await readFile(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Read a Parquet buffer back into ArchivableRow shape. Test helper only —
   * production never reads from the archive (that path is BigQuery /
   * DuckDB / Polars in §7).
   */
  export async function readArchiveParquet(buf: Buffer): Promise<ArchivableRow[]> {
    const dir = await mkdtemp(join(tmpdir(), 'birdwatch-archive-read-'));
    const path = join(dir, 'archive.parquet');
    const { writeFile, rm: rmFile } = await import('node:fs/promises');
    await writeFile(path, buf);
    try {
      const reader = await parquet.ParquetReader.openFile(path);
      const cursor = reader.getCursor();
      const out: ArchivableRow[] = [];
      let r: unknown;
      while ((r = await cursor.next()) !== null) {
        const row = r as Record<string, unknown>;
        out.push({
          sub_id: row.sub_id as string,
          species_code: row.species_code as string,
          obs_dt: new Date(Number(row.obs_dt)),
          lng: row.lng as number,
          lat: row.lat as number,
          obs_count: (row.obs_count ?? null) as number | null,
          is_notable: row.is_notable as boolean,
          loc_id: row.loc_id as string,
          loc_name: (row.loc_name ?? null) as string | null,
          common_name: (row.common_name ?? null) as string | null,
          sci_name: (row.sci_name ?? null) as string | null,
          family_code: (row.family_code ?? null) as string | null,
          family_name: (row.family_name ?? null) as string | null,
          ingested_at: new Date(Number(row.ingested_at)),
        });
      }
      await reader.close();
      return out;
    } finally {
      await rmFile(path, { force: true });
      await rm(dir, { recursive: true, force: true });
    }
  }
  ```

- [ ] **Step 5: Run tests to verify pass**

  ```bash
  npx vitest run src/archive/parquet-writer.test.ts
  ```

  Expected: 3 passed.

- [ ] **Step 6: Commit**

  ```bash
  git add services/ingestor/package.json services/ingestor/package-lock.json services/ingestor/src/archive/parquet-writer.ts services/ingestor/src/archive/parquet-writer.test.ts
  git commit -m "feat(ingestor): parquetjs-lite-backed archive writer with 14-column schema"
  ```

---

### Task 4: GCS uploader + end-to-end wire-up

**Files:**
- Create: `services/ingestor/src/archive/gcs-uploader.ts`
- Create: `services/ingestor/src/archive/gcs-uploader.test.ts`
- Modify: `services/ingestor/src/archive/index.ts` — export `archiveAndUpload` as the public surface
- Modify: `services/ingestor/src/cli.ts` — wire the real `archiveAndUpload` into the `prune` branch's `archiveDay` arg

- [ ] **Step 1: Write the failing test (stubbed @google-cloud/storage)**

  Create `services/ingestor/src/archive/gcs-uploader.test.ts`:

  ```typescript
  import { describe, it, expect, vi } from 'vitest';
  import { archiveAndUpload } from './gcs-uploader.js';
  import type { ArchivableRow } from './select-archivable.js';

  const fakeRow: ArchivableRow = {
    sub_id: 'S1', species_code: 'vermfly',
    obs_dt: new Date('2026-05-01T12:00:00Z'),
    lng: -110.88, lat: 31.72,
    obs_count: 2, is_notable: false,
    loc_id: 'L1', loc_name: 'A',
    common_name: 'Vermilion Flycatcher', sci_name: 'Pyrocephalus rubinus',
    family_code: 'tyrannidae', family_name: 'Tyrant Flycatchers',
    ingested_at: new Date('2026-05-01T13:00:00Z'),
  };

  function makeStubBucket() {
    const saved: Array<{ name: string; bytes: number; md5?: string }> = [];
    const file = (name: string) => ({
      save: vi.fn(async (buf: Buffer, opts?: { metadata?: { md5Hash?: string } }) => {
        saved.push({ name, bytes: buf.length, md5: opts?.metadata?.md5Hash });
      }),
      getMetadata: vi.fn(async () => [{ md5Hash: 'fakemd5', size: '1234' }]),
      delete: vi.fn(async () => {}),
      copy: vi.fn(async (_dest: unknown) => {}),
    });
    return {
      bucket: { file },
      saved,
    };
  }

  describe('archiveAndUpload', () => {
    it('writes a parquet to a temp key then renames to the partitioned final key', async () => {
      const stub = makeStubBucket();
      const result = await archiveAndUpload({
        bucket: stub.bucket as never,
        bucketName: 'bird-maps-prod-obs-archive',
        utcDate: '2026-05-01',
        rows: [fakeRow],
      });
      expect(result.gcsPath).toBe(
        'gs://bird-maps-prod-obs-archive/observations/year=2026/month=05/day=01.parquet'
      );
      // Temp key written before the final partition key
      expect(stub.saved.map(s => s.name)).toEqual([
        expect.stringMatching(/^observations\/_tmp\//),
      ]);
    });

    it('does not write the final key if the temp save throws', async () => {
      const bucket = {
        file: (name: string) => {
          if (name.startsWith('observations/_tmp/')) {
            return {
              save: vi.fn(async () => { throw new Error('GCS down'); }),
              getMetadata: vi.fn(),
              delete: vi.fn(),
              copy: vi.fn(),
            };
          }
          return {
            save: vi.fn(),
            getMetadata: vi.fn(),
            delete: vi.fn(),
            copy: vi.fn(async () => { throw new Error('should not reach final key'); }),
          };
        },
      };
      await expect(archiveAndUpload({
        bucket: bucket as never,
        bucketName: 'bird-maps-prod-obs-archive',
        utcDate: '2026-05-01',
        rows: [fakeRow],
      })).rejects.toThrow('GCS down');
    });
  });
  ```

- [ ] **Step 2: Run the test to verify it fails**

  ```bash
  npx vitest run src/archive/gcs-uploader.test.ts
  ```

  Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement `archiveAndUpload`**

  Create `services/ingestor/src/archive/gcs-uploader.ts`:

  ```typescript
  import { writeArchiveParquet } from './parquet-writer.js';
  import type { ArchivableRow } from './select-archivable.js';
  import { randomUUID } from 'node:crypto';
  import { createHash } from 'node:crypto';

  /**
   * Minimal shape of the @google-cloud/storage Bucket we use — `bucket.file(name)`
   * returns an object with `save`, `getMetadata`, `copy`, `delete`. Typed here
   * so tests can stub without depending on the full SDK surface.
   */
  export interface BucketLike {
    file(name: string): {
      save(buf: Buffer, opts?: { metadata?: { md5Hash?: string }, resumable?: boolean }): Promise<unknown>;
      getMetadata(): Promise<[{ md5Hash?: string; size?: string }]>;
      copy(dest: { file(name: string): unknown } | unknown): Promise<unknown>;
      delete(): Promise<unknown>;
    };
  }

  export interface ArchiveAndUploadOptions {
    bucket: BucketLike;
    /**
     * Bucket name — used to construct the returned `gs://` URI. Required
     * because `BucketLike` only exposes `file(name)` and the GCS SDK's
     * `Bucket.name` is not in our minimal interface (kept narrow so tests
     * don't have to stub the full SDK shape).
     */
    bucketName: string;
    /** UTC date in ISO YYYY-MM-DD form. */
    utcDate: string;
    rows: ArchivableRow[];
  }

  export interface ArchiveAndUploadResult {
    /** Final `gs://bucket/observations/year=.../month=.../day=...parquet` path. */
    gcsPath: string;
    /** Compressed Parquet size in bytes. */
    bytes: number;
    /** md5 hex digest of the bytes (for tally / verification). */
    md5: string;
  }

  /**
   * Write Parquet → upload to a temp key → verify md5 matches → copy to the
   * final partitioned key → delete the temp key. The temp-then-rename pattern
   * gives us atomic semantics: a partial upload cannot corrupt the final
   * partition. If anything throws, the final key is never written, runPrune
   * skips the day's DELETE, and the next nightly run retries cleanly.
   */
  export async function archiveAndUpload(
    o: ArchiveAndUploadOptions
  ): Promise<ArchiveAndUploadResult> {
    const buf = await writeArchiveParquet(o.rows);
    const md5 = createHash('md5').update(buf).digest('hex');
    const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

    const [year, month, day] = o.utcDate.split('-');
    const finalKey = `observations/year=${year}/month=${month}/day=${day}.parquet`;
    const tmpKey = `observations/_tmp/${randomUUID()}.parquet`;

    const tmpFile = o.bucket.file(tmpKey);
    await tmpFile.save(buf, {
      metadata: { md5Hash: md5Base64 },
      resumable: false,
    });

    // Re-fetch md5 from GCS to confirm the write landed intact. GCS auto-
    // verifies on upload when md5Hash is supplied, but a paranoid second
    // check costs one HEAD and catches the rare path where a proxy
    // rewrites the body.
    const [meta] = await tmpFile.getMetadata();
    if (meta.md5Hash && meta.md5Hash !== md5Base64) {
      await tmpFile.delete().catch(() => {});
      throw new Error(`archive md5 mismatch: expected ${md5Base64}, got ${meta.md5Hash}`);
    }

    // Atomic rename via copy + delete. GCS does not have a server-side
    // move; copy is server-side (no bytes traverse the client) and
    // delete is a single op.
    await tmpFile.copy(o.bucket.file(finalKey));
    await tmpFile.delete().catch(() => {
      // Non-fatal: the final write succeeded; orphan _tmp objects are
      // cleaned by a separate lifecycle rule (optional follow-up).
    });

    return {
      gcsPath: `gs://${o.bucketName}/${finalKey}`,
      bytes: buf.length,
      md5,
    };
  }
  ```

- [ ] **Step 4: Update `archive/index.ts` to export the public surface**

  Create / overwrite `services/ingestor/src/archive/index.ts`:

  ```typescript
  export { selectArchivable, type ArchivableRow } from './select-archivable.js';
  export { writeArchiveParquet } from './parquet-writer.js';
  export { archiveAndUpload, type BucketLike } from './gcs-uploader.js';
  ```

- [ ] **Step 5: Run uploader tests**

  ```bash
  npx vitest run src/archive/gcs-uploader.test.ts
  ```

  Expected: 2 passed.

- [ ] **Step 6: Wire `archiveAndUpload` into `cli.ts`'s prune branch**

  Modify `services/ingestor/src/cli.ts`. In the `else if (kind === 'prune')` block (~line 305), replace the existing `runPrune` invocation:

  ```typescript
  } else if (kind === 'prune') {
    const raw = process.env.OBSERVATIONS_RETENTION_DAYS;
    const parsed = raw === undefined ? undefined : Number.parseInt(raw, 10);
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed <= 0)) {
      throw new Error(`OBSERVATIONS_RETENTION_DAYS must be a positive integer; got ${raw}`);
    }

    // GCS archive wiring. The bucket name is fixed by infra (T1) — single
    // tenant, no env override surface needed. ADC inside Cloud Run reaches
    // GCS via the ingestor SA's bucket bindings.
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
  }
  ```

  Note the dynamic `import('@google-cloud/storage')` — keeps the SDK out of the cold path for all non-prune kinds (it's a heavy dep with a slow ESM init).

- [ ] **Step 7: Update the `runPrune` signature in `CliDeps`**

  Since `runPrune`'s `RunPruneOptions` now requires `archiveDay`, the `typeof realRunPrune` in `CliDeps` already propagates. Run typecheck:

  ```bash
  npm run typecheck --workspace @bird-watch/ingestor
  ```

  Expected: clean.

- [ ] **Step 8: Run the full ingestor test suite**

  ```bash
  npm run test --workspace @bird-watch/ingestor
  ```

  Expected: all previously-green tests still pass + the 3 new files all green.

- [ ] **Step 9: Commit**

  ```bash
  git add services/ingestor/src/archive/gcs-uploader.ts services/ingestor/src/archive/gcs-uploader.test.ts services/ingestor/src/archive/index.ts services/ingestor/src/cli.ts
  git commit -m "feat(ingestor): archiveAndUpload — temp-then-rename GCS write with md5 verify; wire into cli prune"
  ```

---

### Task 5: Apply Terraform + first-run verification runbook

**Files:**
- Create: `docs/runbooks/observations-archive.md`

- [ ] **Step 1: Apply T1's Terraform**

  ```bash
  cd infra/terraform
  terraform plan -out=archive.plan
  terraform apply archive.plan
  ```

  Expected: 6 resources created (bucket, 2 IAM bindings, dataset, table; nothing modified). Note the `obs_archive_bucket_name` output (`bird-maps-prod-obs-archive`).

- [ ] **Step 2: Wait for first nightly archive run**

  The next scheduled `bird-ingestor-prune` Cloud Run Job execution will perform the first archive. Tail the logs:

  ```bash
  gcloud logging read 'resource.type=cloud_run_job AND resource.labels.job_name=bird-ingestor-prune AND jsonPayload.message="bird_ingest_archived"' --limit=50 --format=json --project=bird-maps-prod
  ```

  Expected: one log line per day archived, each with `date`, `rowCount`, `gcsPath`, `bytesUploaded`.

- [ ] **Step 3: Verify the bucket objects landed**

  ```bash
  gcloud storage ls 'gs://bird-maps-prod-obs-archive/observations/year=2026/**'
  gcloud storage du gs://bird-maps-prod-obs-archive/
  ```

  Expected: one `day=DD/data.parquet` per archived day; total size matches `bytesUploaded` summed across log lines. (Layout shipped as `day=DD.parquet` filename in the original plan; #699 restructured to `day=DD/` directory segment so BigQuery's Hive AUTO planner picks up `day` as a partition column.)

- [ ] **Step 4: Smoke-test via BigQuery**

  ```bash
  bq query --use_legacy_sql=false --project_id=bird-maps-prod '
  SELECT year, month, day, COUNT(*) AS row_count
  FROM `bird-maps-prod.observations_archive.observations`
  WHERE year = 2026
  GROUP BY year, month, day
  ORDER BY year, month, day
  LIMIT 30
  '
  ```

  Expected: one row per archived day with a plausible row_count.

- [ ] **Step 5: Tally archive vs DB delta**

  ```bash
  # For the archived date (e.g. 2026-05-06 if archive run was 2026-05-20 with 14-day retention):
  ARCHIVE_DATE="2026-05-06"
  ARCHIVED_ROWS=$(bq query --use_legacy_sql=false --format=csv --project_id=bird-maps-prod \
    "SELECT COUNT(*) FROM \`bird-maps-prod.observations_archive.observations\`
     WHERE year=2026 AND month=5 AND day=6" | tail -1)
  echo "Archived: $ARCHIVED_ROWS"
  # The matching log line's rowCount field should equal this count.
  gcloud logging read 'jsonPayload.message="bird_ingest_archived" AND jsonPayload.date="'"$ARCHIVE_DATE"'"' --limit=1 --format='value(jsonPayload.rowCount)'
  ```

  Expected: both values match exactly.

- [ ] **Step 6: Write the runbook**

  Create `docs/runbooks/observations-archive.md` with sections:

  1. **Where the archive lives** — bucket name, region, BigQuery dataset/table, sample `gs://` path.
  2. **Daily verification query** — the BigQuery query from Step 4.
  3. **Cost monitoring** — `gcloud storage du gs://bird-maps-prod-obs-archive/`; expected growth ~125 MB/day at national scale; budget alert at $5/mo.
  4. **Memory monitoring (post-rollout)** — Cloud Run Jobs surface peak container memory via Cloud Monitoring's `run.googleapis.com/container/memory/utilizations` metric. Query the last 14 prune runs:
     ```bash
     gcloud monitoring time-series list \
       --filter='metric.type="run.googleapis.com/container/memory/utilizations" AND resource.labels.job_name="bird-ingestor-prune"' \
       --interval-end-time=$(date -u +%FT%TZ) \
       --interval-start-time=$(date -u -d '14 days ago' +%FT%TZ) \
       --project=bird-maps-prod
     ```
     If peak utilization exceeds ~75% of the `2Gi` cap (i.e. ≥1.5 GB) consistently, ship R9's streaming-writer mitigation BEFORE bumping the cap higher — the 2Gi headroom was sized against national-scale row counts and a sustained breach implies a row-count or shape change, not a cap-sizing issue.
  5. **Failure response** — symptoms (prune job RED in Cloud Run, no `bird_ingest_archived` log lines, observations not shrinking), triage steps (check GCS connectivity, check IAM binding, check Healthcheck.io for missed pings, check Cloud Run memory metric for OOM).
  6. **Restoring a partition to a sandbox DB** — `gcloud storage cp` to a temp file, then `pyarrow` or `duckdb` → `INSERT` into a sandbox table. Note: NEVER restore into prod `observations`.
  7. **Cross-link** to `docs/plans/2026-05-20-observations-cold-storage.md`.

- [ ] **Step 7: Commit**

  ```bash
  git add docs/runbooks/observations-archive.md
  git commit -m "docs(runbook): observations-archive verification + cost monitoring + restore procedure"
  ```

---

### Task 8: Observability — dashboard widgets + log-based metrics for the archive pipeline

**Files:**
- Modify: `infra/terraform/monitoring.tf` (append 3 new `google_logging_metric` resources)
- Modify: `infra/terraform/monitoring-dashboard.tf` (append 4 new tiles to the `bird-watch overview` dashboard's `mosaicLayout.tiles` array — Row 5)

**Why this exists:** the archive-then-delete pipeline is silent by default — `gcloud logging read` works but is a slow read-loop. The four widgets give a single-glance view of (a) is the archive running each night, (b) how big is the data flow, (c) is archive count matching delete count (the critical invariant of T2), (d) is the bucket growing at the projected ~125 MB/day rate. The widgets land on the existing dashboard rather than a new one — operators already open `bird-watch overview` for triage; adding tiles avoids dashboard-sprawl. Alerts are explicitly out of scope for T8 (T1 sets the bucket up, T5 gates rollout); the widgets are purely a visual signal.

**Note on dashboard landmines** (per `infra/terraform/monitoring-dashboard.tf` header L1/L6): widget removals via `dashboard_json` diff-suppression silently fail unless paired with a non-removal change in the same Apply. This task is additive only — no removals — so the landmine does not bite. The dashboard uses `mosaicLayout.columns = 12` (integer), not `gridLayout.columns` (string); the new tiles below match that schema.

- [ ] **Step 1: Write the failing `terraform plan` snippet (TDD expectation)**

  Before writing any HCL, write down what `terraform plan` MUST output after this task. Save this snippet inline in the PR description (and check the actual plan against it):

  ```
  Terraform will perform the following actions:

    # google_logging_metric.archived_row_count will be created
    + resource "google_logging_metric" "archived_row_count" {
        + name              = "bird-ingest-archived-row-count"
        + value_extractor   = "EXTRACT(jsonPayload.rowCount)"
        ...
      }

    # google_logging_metric.archived_bytes_uploaded will be created
    + resource "google_logging_metric" "archived_bytes_uploaded" {
        + name              = "bird-ingest-archived-bytes-uploaded"
        + value_extractor   = "EXTRACT(jsonPayload.bytesUploaded)"
        ...
      }

    # google_logging_metric.archived_deleted_count will be created
    + resource "google_logging_metric" "archived_deleted_count" {
        + name              = "bird-ingest-archived-deleted-count"
        + value_extractor   = "EXTRACT(jsonPayload.deletedCount)"
        ...
      }

    # google_monitoring_dashboard.bird_watch_overview will be updated in-place
    ~ resource "google_monitoring_dashboard" "bird_watch_overview" {
        ~ dashboard_json = jsonencode(
              ~ {
                  ~ mosaicLayout = {
                      ~ tiles = [
                          # 14 existing tiles unchanged
                          # 4 new tiles appended (Row 5: yPos=16)
                      ]
                  }
              }
          )
      }

  Plan: 3 to add, 1 to change, 0 to destroy.
  ```

  If the Apply produces anything other than `3 to add, 1 to change, 0 to destroy`, STOP — diff suppression on `dashboard_json` may have masked a removal, or one of the existing tiles got accidentally edited. Resolve before applying.

- [ ] **Step 2: Add the 3 new `google_logging_metric` resources**

  Append to `infra/terraform/monitoring.tf` (at the bottom, after the `google_project_iam_audit_config.monitoring_data_read` block):

  ```hcl
  # ── T8: Observations archive — log-based metrics ────────────────────────
  #
  # Three metrics extracted from the `bird_ingest_archived` structured-log
  # line emitted by services/ingestor/src/run-prune.ts (T2). One emit per
  # archived day per nightly run, shape:
  #   {
  #     message: "bird_ingest_archived",
  #     date: "YYYY-MM-DD",
  #     rowCount: <int>,         // rows written to Parquet
  #     deletedCount: <int>,     // rows actually DELETEd (parity invariant)
  #     gcsPath: "gs://...",
  #     bytesUploaded: <int>
  #   }
  #
  # These power Row 5 of the bird-watch overview dashboard
  # (infra/terraform/monitoring-dashboard.tf). The two `!=NULL_VALUE` clauses
  # in each filter drop malformed entries during a future emit-shape
  # regression rather than landing garbage into the metric stream — matches
  # the pattern in `bird-ingest-run-completed` above.

  resource "google_logging_metric" "archived_row_count" {
    name = "bird-ingest-archived-row-count"
    filter = join(" AND ", [
      "resource.type=\"cloud_run_job\"",
      "resource.labels.job_name=\"bird-ingestor-prune\"",
      "jsonPayload.message=\"bird_ingest_archived\"",
      "jsonPayload.rowCount!=NULL_VALUE",
    ])
    metric_descriptor {
      metric_kind  = "DELTA"
      value_type   = "DISTRIBUTION"
      unit         = "1"
      display_name = "Observations archived per day (rowCount)"
    }
    value_extractor = "EXTRACT(jsonPayload.rowCount)"
    bucket_options {
      exponential_buckets {
        num_finite_buckets = 32
        growth_factor      = 2
        scale              = 1000 # row counts span 1k (AZ-only) → ~5M (national)
      }
    }
  }

  resource "google_logging_metric" "archived_bytes_uploaded" {
    name = "bird-ingest-archived-bytes-uploaded"
    filter = join(" AND ", [
      "resource.type=\"cloud_run_job\"",
      "resource.labels.job_name=\"bird-ingestor-prune\"",
      "jsonPayload.message=\"bird_ingest_archived\"",
      "jsonPayload.bytesUploaded!=NULL_VALUE",
    ])
    metric_descriptor {
      metric_kind  = "DELTA"
      value_type   = "DISTRIBUTION"
      unit         = "By"
      display_name = "Parquet bytes uploaded to GCS per day"
    }
    value_extractor = "EXTRACT(jsonPayload.bytesUploaded)"
    bucket_options {
      exponential_buckets {
        num_finite_buckets = 32
        growth_factor      = 2
        scale              = 100000 # ~100 KB scale spans 100 KB (AZ tiny day) → ~400 MB (national daily peak)
      }
    }
  }

  # Parity-check metric. The T2 invariant: archive-then-delete is atomic per
  # day — if archive D succeeds, delete D runs against the same row set. The
  # dashboard tile (T8 Tile 5.3 below) renders rowCount and deletedCount as
  # two lines on one widget; for healthy nights the lines are co-incident.
  # Divergence is a visual smell — root-cause via the runbook §Failure
  # response.
  resource "google_logging_metric" "archived_deleted_count" {
    name = "bird-ingest-archived-deleted-count"
    filter = join(" AND ", [
      "resource.type=\"cloud_run_job\"",
      "resource.labels.job_name=\"bird-ingestor-prune\"",
      "jsonPayload.message=\"bird_ingest_archived\"",
      "jsonPayload.deletedCount!=NULL_VALUE",
    ])
    metric_descriptor {
      metric_kind  = "DELTA"
      value_type   = "DISTRIBUTION"
      unit         = "1"
      display_name = "Observations deleted per day post-archive (deletedCount)"
    }
    value_extractor = "EXTRACT(jsonPayload.deletedCount)"
    bucket_options {
      exponential_buckets {
        num_finite_buckets = 32
        growth_factor      = 2
        scale              = 1000
      }
    }
  }
  ```

- [ ] **Step 3: Append 4 new tiles to the dashboard (Row 5)**

  The existing dashboard ends Row 4 at `yPos = 12` (height 4 → bottom edge at 16). The new row starts at `yPos = 16`. Open `infra/terraform/monitoring-dashboard.tf` and insert these 4 tile objects into the `mosaicLayout.tiles = [ ... ]` array (after the last tile — `Tile 4.2 — uptime check`):

  ```hcl
        # ── Row 5: Observations archive pipeline (T8 of issue #689) ─────
        #
        # Visibility into the nightly prune's archive-then-delete pipeline.
        # The 14-day live retention window means raw row counts on the
        # observations table do NOT carry archive throughput — these tiles
        # are the only way to see the cold-storage data flow without
        # tailing Cloud Logging by hand.
        # Tile 5.1 — Rows archived per night
        {
          xPos   = 0
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "Archive throughput — rows per night (last 30d)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-row-count\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "86400s" # daily buckets
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                label = "rows"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.2 — Bytes uploaded per night
        {
          xPos   = 3
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "GCS bytes uploaded per night (last 30d)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-bytes-uploaded\" AND resource.type=\"cloud_run_job\""
                    aggregation = {
                      alignmentPeriod    = "86400s"
                      perSeriesAligner   = "ALIGN_SUM"
                      crossSeriesReducer = "REDUCE_SUM"
                    }
                  }
                }
                plotType = "LINE"
              }]
              yAxis = {
                label = "bytes"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.3 — Archive vs Delete parity check
        # Two lines on one widget. For healthy nights the lines overlay
        # exactly (rowCount == deletedCount per the T2 atomic-per-day
        # invariant). Divergence is a visual smell — triage via the
        # runbook §Failure response.
        {
          xPos   = 6
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "Archive vs Delete parity (per-day)"
            xyChart = {
              dataSets = [
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-row-count\" AND resource.type=\"cloud_run_job\""
                      aggregation = {
                        alignmentPeriod    = "86400s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                  plotType        = "LINE"
                  legendTemplate  = "archived (rowCount)"
                },
                {
                  timeSeriesQuery = {
                    timeSeriesFilter = {
                      filter = "metric.type=\"logging.googleapis.com/user/bird-ingest-archived-deleted-count\" AND resource.type=\"cloud_run_job\""
                      aggregation = {
                        alignmentPeriod    = "86400s"
                        perSeriesAligner   = "ALIGN_SUM"
                        crossSeriesReducer = "REDUCE_SUM"
                      }
                    }
                  }
                  plotType        = "LINE"
                  legendTemplate  = "deleted (deletedCount)"
                },
              ]
              yAxis = {
                label = "rows"
                scale = "LINEAR"
              }
            }
          }
        },
        # Tile 5.4 — GCS bucket size growth (90d, with lifecycle annotation)
        # GCP-native metric — no log-based metric needed. The 90-day window
        # is chosen so the Nearline → Archive transition (which fires at
        # age=90d per T1's lifecycle_rule) is visible: bucket size growth-
        # rate inflects when old partitions transition out of Nearline
        # storage class — useful visual sanity check on the lifecycle rule.
        {
          xPos   = 9
          yPos   = 16
          width  = 3
          height = 4
          widget = {
            title = "GCS archive bucket size — 90d (Nearline → Archive transition visible)"
            xyChart = {
              dataSets = [{
                timeSeriesQuery = {
                  timeSeriesFilter = {
                    filter = "metric.type=\"storage.googleapis.com/storage/total_bytes\" AND resource.type=\"gcs_bucket\" AND resource.label.bucket_name=\"bird-maps-prod-obs-archive\""
                    aggregation = {
                      alignmentPeriod    = "86400s"
                      perSeriesAligner   = "ALIGN_MEAN"
                      crossSeriesReducer = "REDUCE_SUM"
                      groupByFields      = ["resource.label.storage_class"]
                    }
                  }
                }
                plotType        = "STACKED_AREA"
                legendTemplate  = "$${resource.labels.storage_class}"
              }]
              yAxis = {
                label = "bytes"
                scale = "LINEAR"
              }
            }
          }
        },
  ```

  Notes:
  - The 4 tiles use `width = 3` to fit a 4-wide row in the 12-column mosaic. The existing rows used `width = 4` (3-wide rows); Row 5 is denser because all 4 tiles are related to one pipeline.
  - `yPos = 16` is calculated: 4 existing rows × height 4 = bottom at 16. The next row starts at exactly 16 (mosaicLayout positions are inclusive at xPos/yPos, exclusive at width/height).
  - The trailing comma after the closing `}` of Tile 5.4 is intentional — HCL `jsonencode()` permits trailing commas in lists, and matching the existing dashboard's style (every tile ends with `,`) keeps diffs minimal if a future tile is appended.
  - Tile 5.4's `legendTemplate` uses `$${...}` (doubled `$`) because the surrounding HCL string would otherwise try to interpolate; the doubled `$` escapes to a literal `${...}` that the Monitoring API consumes at runtime.

- [ ] **Step 4: Run `terraform fmt` and `terraform validate`**

  ```bash
  cd infra/terraform
  terraform fmt monitoring.tf monitoring-dashboard.tf
  terraform init -upgrade
  terraform validate
  ```

  Expected: `Success! The configuration is valid.`

  Reminder: `terraform validate` does NOT verify the contents of `dashboard_json` against the Monitoring API's widget schema (per the `monitoring-dashboard.tf` header comment). The `terraform plan` in Step 5 is the real check — if it fails on the dashboard update, the error message will name the offending tile.

- [ ] **Step 5: Run `terraform plan` and compare against the TDD expectation**

  ```bash
  terraform plan -out=observability.plan
  ```

  Match against the snippet from Step 1. Expected exit: `Plan: 3 to add, 1 to change, 0 to destroy.`

  - 3 to add: the 3 new `google_logging_metric` resources.
  - 1 to change: the in-place update to `google_monitoring_dashboard.bird_watch_overview`'s `dashboard_json`.
  - 0 to destroy: no removals.

  If anything else shows up, STOP and investigate before applying.

- [ ] **Step 6: Apply**

  ```bash
  terraform apply observability.plan
  ```

  Expected: apply succeeds in <30s (dashboard updates are near-instant; log-based metric creation is also fast).

- [ ] **Step 7: Verify the metrics descriptors exist**

  ```bash
  for m in row-count bytes-uploaded deleted-count; do
    gcloud monitoring metrics-descriptors describe \
      "logging.googleapis.com/user/bird-ingest-archived-${m}" \
      --project=bird-maps-prod
  done
  ```

  Expected: 3 successful describes (one per metric). A `NOT_FOUND` from any of them means the corresponding `google_logging_metric` resource did not land — re-check `terraform state list | grep logging_metric`.

- [ ] **Step 8: Open the dashboard and visually confirm the 4 new tiles**

  ```bash
  terraform output dashboard_url
  ```

  Open the URL. Scroll to the bottom. Confirm Row 5 shows 4 tiles in this order: Archive throughput, GCS bytes per night, Archive vs Delete parity, GCS bucket size 90d. Tiles will be empty until the first post-T6 nightly run lands the first `bird_ingest_archived` log line (~24h after apply); Tile 5.4 starts populating immediately once GCS samples the bucket (within ~hours of the bucket's first object landing).

- [ ] **Step 9: Verify metric ingestion after first nightly run**

  After the first `bird-ingestor-prune` execution that produces a `bird_ingest_archived` log line:

  ```bash
  # Confirm at least one data point landed in each log-based metric
  for m in row-count bytes-uploaded deleted-count; do
    echo "=== bird-ingest-archived-${m} ==="
    gcloud monitoring time-series list \
      --filter="metric.type=\"logging.googleapis.com/user/bird-ingest-archived-${m}\"" \
      --interval-end-time=$(date -u +%FT%TZ) \
      --interval-start-time=$(date -u -v-2d +%FT%TZ) \
      --project=bird-maps-prod \
      --format='value(points[0].value)' | head -3
  done
  ```

  Expected: each metric returns ≥1 non-empty data point. If `row-count` populates but `bytes-uploaded` doesn't, the T2 emit may be omitting `bytesUploaded` for empty-row days — cross-check against `gcloud logging read 'jsonPayload.message="bird_ingest_archived"' --limit=5`.

- [ ] **Step 10: Cross-link in the runbook**

  Append to `docs/runbooks/observations-archive.md` §Daily verification query a pointer to the dashboard:

  ```markdown
  ## Dashboard tiles (Row 5 of bird-watch overview)

  The bird-watch overview dashboard's Row 5 holds 4 tiles for the archive
  pipeline (T8 of plan `2026-05-20-observations-cold-storage.md`):

  1. **Archive throughput** — rows per night, last 30 days.
  2. **GCS bytes uploaded** — per night, last 30 days.
  3. **Archive vs Delete parity** — two lines (rowCount, deletedCount); for
     healthy nights they overlay exactly. Divergence = T2 atomic-per-day
     invariant violation; triage via §Failure response.
  4. **GCS bucket size 90d** — `total_bytes` grouped by storage class
     (Nearline / Archive); the lifecycle transition at age=90 makes
     the Archive series take over from Nearline visibly.

  Dashboard URL: `terraform output dashboard_url` (or the console URL in
  `infra/terraform/monitoring-dashboard.tf`'s `dashboard_url` output).
  ```

- [ ] **Step 11: Commit**

  ```bash
  git add infra/terraform/monitoring.tf infra/terraform/monitoring-dashboard.tf docs/runbooks/observations-archive.md
  git commit -m "infra(monitoring): T8 — 4 dashboard tiles + 3 log-based metrics for the observations archive pipeline"
  ```

**Acceptance criterion:** dashboard URL renders Row 5 with 4 new tiles; all 3 `google_logging_metric` descriptors return from `gcloud monitoring metrics-descriptors describe`; after the first post-deploy nightly run, the parity widget shows two co-incident lines (rowCount == deletedCount).

**Test plan:**
- `terraform plan` exits `3 to add, 1 to change, 0 to destroy` (Step 5).
- All 3 `gcloud monitoring metrics-descriptors describe` calls return 0-exit (Step 7).
- Dashboard URL opens and Row 5 is visually present (Step 8).
- ≥24h post-apply: each metric has ≥1 data point per the Step 9 query.

---

### Task 6: Backfill — explicit forwards-only stance

**Files:**
- Modify: `docs/runbooks/observations-archive.md` (add a §Backfill section)

There is **no recovery path** for observations already deleted by the pre-archive prune (Phase 3a era → 2026-05-20). The Cloud SQL backups have a separate retention policy (operator-only) and are not designed for point-in-time row-level recovery into the archive bucket.

This plan ships forwards-only. The first archived partition will be the date of the first prune-job run after the Terraform apply (T5) and the cli wire-up (T4) both land on `bird-ingestor-prune`'s image. All earlier observations are lost.

- [ ] **Step 1: Document the forwards-only stance**

  Add a §Backfill section to `docs/runbooks/observations-archive.md`:

  ```markdown
  ## Backfill (none — forwards-only)

  Observations deleted by the prune job prior to the archive landing (2026-05-20)
  are not recoverable. The archive's first partition is the first nightly run
  after Terraform apply T1 and cli wire-up T4 are both in production.

  Cloud SQL automated backups retain a separate copy of the DB on a separate
  cadence; those backups are operator-tool-only and are NOT a viable input to
  the archive bucket. Do not attempt to "backfill" the archive from a Cloud SQL
  PITR snapshot — the snapshot's row set is not a clean per-day partition and
  would require non-trivial re-extraction work that does not pay off given the
  modest historical row count.
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add docs/runbooks/observations-archive.md
  git commit -m "docs(runbook): explicit forwards-only stance for the archive backfill"
  ```

---

### Task 7: Plan freeze + execution handoff

This task captures the plan-author hand-off, not implementation work.

- [ ] **Step 1: Run the self-review checklist (writing-plans skill §Self-Review)**

  - Spec coverage: every spec bullet in the issue context has a T1–T6 task; T8 covers the observability extension added 2026-05-20.
  - Placeholder scan: no `TBD`, `TODO`, `implement later`, or "Add appropriate error handling".
  - Type consistency: `ArchivableRow`, `RunPruneSummary`, `archiveDay` signature match across T2–T4.

- [ ] **Step 2: Confirm zero `frontend/**` touches**

  Grep:
  ```bash
  grep -n "frontend/" docs/plans/2026-05-20-observations-cold-storage.md
  ```
  Expected: no matches. This plan does not touch `frontend/**`; the CSS sub-task gate (writing-plans extension §Frontend) does not apply.

- [ ] **Step 3: Save the plan**

  Save this issue body verbatim to `docs/plans/2026-05-20-observations-cold-storage.md`. The plan is identical to the issue body — single source of truth.

- [ ] **Step 4: Commit the plan file**

  ```bash
  git add docs/plans/2026-05-20-observations-cold-storage.md
  git commit -m "plan(archive): observations cold storage — Parquet on GCS, queryable via BigQuery / DuckDB / Polars"
  ```

---

## §5 — Risks + mitigations

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | GCS write succeeds for some days but fails for a later day → live DB has partial state | M | H | Per-day archive-then-delete inside one job: if archive D fails, delete D does not run; prior days that succeeded keep their archive+delete (forward progress). The runner returns `status: 'failure'` so Healthcheck.io fires; the next nightly run picks up from the failed day. Tested in T2 step 7. |
| R2 | GCS write returns 200 but bytes corrupt in transit | L | H | Temp-key upload with `md5Hash` metadata; GCS verifies on write. We also re-`getMetadata` and compare md5 before issuing the copy-to-final. The whole flow is in T4 step 3. |
| R3 | Schema drift between Cloud SQL `observations` and the Parquet writer (e.g. someone adds a column to `observations` without updating `selectArchivable`) | M | M | The Parquet writer is column-explicit; a SELECT mismatch is caught at T2 integration test time. Document in `docs/runbooks/observations-archive.md` §Schema evolution: when adding an `observations` column, also add it to `select-archivable.ts` and `parquet-writer.ts` schema map. Long-term: extract the column list into `packages/shared-types/` (out of scope for this plan; tracked as a follow-up issue when the cost of the manual update becomes material — likely never given the table's stable shape). |
| R4 | Cost surprise (bucket grows 100×) | L | M | Budget alert at $5/mo (T1 step 1 sets the output; operator wires to `infra/terraform/budget.tf`). `gcloud storage du` check is part of T5 step 5 and the runbook §Cost monitoring. The Nearline tier alone caps at ~$28/year at national scale; even the failure mode here is a small absolute number. |
| R5 | Bucket / IAM misconfig — ingestor SA cannot write | L | H | T1's Terraform sets the bindings; T5 smoke-tests the first archive run end-to-end. If the binding is missing, the first nightly run fails with a clear `403` in Cloud Logging. |
| R6 | BigQuery query cost runaway (someone runs `SELECT *` without partition filter at petabyte scale) | L (today) / M (year 5) | M | T1 enables `hive_partitioning_options.mode = AUTO` so `WHERE year=YYYY AND month=MM` prunes at scan time. Runbook §Daily verification query shows the pattern. Project-level budget alert in `infra/terraform/budget.tf` already covers BigQuery. Optional follow-up: BigQuery custom quota on the dataset (deferred — not warranted at v1 scale). |
| R7 | `parquetjs-lite` becomes unmaintained / has a CVE | L | L | All Parquet logic lives in `services/ingestor/src/archive/parquet-writer.ts` — a one-file swap to `apache-arrow` is well-scoped. The test suite is library-agnostic. |
| R8 | The 90-day Nearline→Archive lifecycle transition fires before the partition is "cold" (someone is still tuning a query) | L | L | Lifecycle transition adds $0.05/GB to retrievals from Archive but does not block them. A query against an Archive-tier partition is slightly more expensive, not unavailable. If this becomes annoying, bump the lifecycle age to 180 days in T1's TF (one line). |
| R9 | A day's archive run exhausts the prune job's memory (Node heap + ArchivableRow[] + parquetjs buffers + writer Buffer round-trip) | M | H | The prune-job memory cap is bumped from `512Mi` → `2Gi` in T1 step 5 (`infra/terraform/ingestor.tf` `google_cloud_run_v2_job.ingestor_prune`). Sizing: ~600 MB resident for the row array + ~150–300 MB for the Parquet bytes (held twice during the tmpfs round-trip) + ~120 MB Node baseline ≈ ~1.0–1.2 GB peak. `2Gi` gives ≥40% headroom. The runbook T5 step 6 adds a Cloud Run memory-utilization check; if peaks creep above 1.5 GB after national rollout, ship the streaming-writer mitigation (write directly to a `Storage.File` write stream, no tmpfs and no JS-side concatenation buffer) which collapses the peak to ~700 MB. |

---

## §6 — Cost projection

National-scale assumptions: ~2.5M rows/day × 50 bytes/row Parquet+gzip = ~125 MB/day = ~46 GB/year. AZ-only is ~5% of national.

| Scenario | Year-1 storage | Year-1 cost | Year-5 storage | Year-5 cost |
|---|---|---|---|---|
| All Nearline (no lifecycle) | 46 GB | $5.52 | 230 GB | $27.60 |
| 90d Nearline → 275d/yr Archive (this plan) | 46 GB | ~$0.93 | 230 GB | ~$3.40 |
| AZ-only, all Nearline | 2.3 GB | $0.28 | 11.5 GB | $1.38 |
| AZ-only, with lifecycle | 2.3 GB | $0.05 | 11.5 GB | $0.17 |

Egress: zero from BigQuery in-region. Per-tile retrieval to a Polars notebook outside us-west1 is $0.12/GB — a 1 GB monthly notebook costs $0.12; even monthly multi-GB downloads stay well below $10/year.

Operations: irrelevant at the volume we ship. Nearline class-A ops are $0.01/10k; we issue ~3 ops/day (PUT temp, copy, delete temp) = ~1,100/year = $0.001/year.

The cost run-rate is rounding noise. The real cost is the engineering time in T1–T5.

---

## §7 — Query examples

### BigQuery (ad-hoc SQL)

Count Vermilion Flycatcher observations in May 2026, AZ only:

```sql
SELECT COUNT(*) AS sightings
FROM `bird-maps-prod.observations_archive.observations`
WHERE year = 2026 AND month = 5
  AND species_code = 'vermfly'
  AND lat BETWEEN 31 AND 37
  AND lng BETWEEN -114.8 AND -109;
```

Top 10 hotspot location IDs by observation count in 2026:

```sql
SELECT loc_id, loc_name, COUNT(*) AS obs
FROM `bird-maps-prod.observations_archive.observations`
WHERE year = 2026
GROUP BY loc_id, loc_name
ORDER BY obs DESC
LIMIT 10;
```

Reconstruct PostGIS spatial type for a GIS export:

```sql
SELECT
  sub_id, species_code, common_name,
  ST_GEOGPOINT(lng, lat) AS point,
  obs_dt
FROM `bird-maps-prod.observations_archive.observations`
WHERE year = 2026 AND month = 5;
```

### DuckDB (zero-cost ML training, local)

```python
import duckdb

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")  # for gs:// reads
# Authenticate via ADC: export GOOGLE_APPLICATION_CREDENTIALS=...

df = con.execute("""
  SELECT species_code, common_name, lat, lng, obs_dt, is_notable
  FROM read_parquet(
    'gs://bird-maps-prod-obs-archive/observations/year=2026/**/*.parquet',
    hive_partitioning = 1
  )
  WHERE year = 2026 AND month BETWEEN 3 AND 5
""").df()
print(df.head())
```

DuckDB's `hive_partitioning = 1` exposes `year`, `month`, `day` as virtual columns and prunes scans at the file-list level — a 3-month query reads ~90 files, not the full bucket.

### Polars (ML feature pipeline)

```python
import polars as pl

# Lazy scan — reads metadata only until .collect() forces evaluation.
lf = pl.scan_parquet(
    'gs://bird-maps-prod-obs-archive/observations/year=2026/**/*.parquet',
    hive_partitioning = True,
)

# Daily species-richness feature, May 2026:
features = (
    lf
    .filter((pl.col('year') == 2026) & (pl.col('month') == 5))
    .group_by([pl.col('obs_dt').dt.date().alias('day'), 'loc_id'])
    .agg(pl.col('species_code').n_unique().alias('species_richness'))
    .sort(['day', 'species_richness'], descending=[False, True])
    .collect()
)
print(features.head(20))
```

### Pandas + pyarrow (one-off analytics)

```python
import pandas as pd
import pyarrow.dataset as ds

dataset = ds.dataset(
    'gs://bird-maps-prod-obs-archive/observations/',
    format='parquet',
    partitioning='hive',
)
df = dataset.to_table(
    filter=(ds.field('year') == 2026) & (ds.field('month') == 5),
    columns=['species_code', 'lat', 'lng', 'obs_dt', 'is_notable'],
).to_pandas()
print(df.shape)
```

---

## §8 — Non-goals (out of scope)

This plan deliberately does NOT solve:

- **Photo cold storage.** Bird photos live in R2 (`birdwatch-photos`, `infra/terraform/photos.tf`) and have their own ingest pipeline + bucket. Photos are reconstitutable from iNaturalist; observations are not.
- **Cloud SQL backup retention.** Cloud SQL's automated backups are a separate concern (operator triage, point-in-time recovery for the live DB). Not a substitute for the archive bucket and not extended by this plan.
- **Online analytics dashboards.** No Looker / Metabase / Grafana wiring; no public-facing analytics surface. BigQuery + DuckDB are the query path; visualizations are a future concern.
- **Phenology cold storage.** Phenology summaries (if/when they ship as their own table) get their own archive plan when the volume warrants. Premature to design for it now.
- **Per-region or per-state partitioning.** All partitions are by date only. If a future use case needs region pruning, the existing schema's `loc_id` and `lat`/`lng` make region filtering cheap at scan time without re-partitioning the bucket.
- **Real-time streaming archive (CDC).** The nightly cadence is intentional. A CDC pipeline (Debezium / pg_logical) would add a long-running process to maintain, dead-letter handling, and a separate failure mode — none of which is warranted for analytics-grade data.
- **Tile builds reading from the archive.** The `bird-tile-builder` job (issue #628 / pmtiles plan) reads exclusively from the live `observations` table. The archive is for analytics, not for serving tiles older than 14 days.

---

## §9 — Decision log

Design locked via conversation on 2026-05-20.

| Decision | Chosen | Rejected alternatives | Why |
|---|---|---|---|
| File format | Parquet | CSV, JSON (NDJSON), SQL dump | Parquet is the only format with native BigQuery / DuckDB / Polars support, columnar layout, typed columns, and ~10× compression. |
| Partition layout | Hive-style (`key=value`) | Flat date prefix (`YYYY-MM-DD.parquet`) | BigQuery + DuckDB prune scans automatically with Hive — orders of magnitude cheaper at query time. |
| Initial storage class | Nearline (90 days), then Archive via lifecycle | Coldline immediately; Archive immediately | First 90 days the data is hot-by-cold-storage-standards (query tuning, sanity checks). Coldline / Archive add per-retrieval fees that bite during the bootstrap window. |
| Archive trigger model | Extend `runPrune` into archive-then-delete | Separate Cloud Run Job for archive, prune unchanged | Single failure mode + atomic semantics. Separate jobs add scheduler/IAM surface, queue/dead-letter design, and a silent-divergence risk. |
| Parquet library | `parquetjs-lite` | `apache-arrow` | Smaller surface for single-purpose use; Arrow is the right pick when you need the full Arrow runtime, which we don't. Localized swap if it becomes unmaintained. |
| Geometry column | Drop; keep lng/lat | Keep PostGIS WKB in Parquet | lng/lat are source-of-truth (the live `geom` is GENERATED ALWAYS AS). BigQuery / DuckDB reconstruct spatial type on demand. Saves bytes, improves ML friendliness. |
| Bucket region | `us-west1` | Multi-region US, EU | Same region as Cloud SQL → no cross-region egress on writes. Multi-region adds redundancy we don't need (the archive is already a redundant copy of Cloud SQL). |
| Atomic write | Temp-key + md5 verify + copy-to-final + delete | Direct write to final key | Atomic semantics. A partial upload to the temp key never corrupts the final partition. md5 verify catches the rare in-flight corruption that GCS itself does not flag. |
| Backfill of pre-archive deletions | None — forwards-only | Restore from Cloud SQL PITR snapshot | Snapshot row sets are not per-day partitions; re-extraction is non-trivial and the historical row count is modest. Forwards-only is the right call. |
| `species_meta` join time | At archive time (denormalize into Parquet) | At read time (ship `species_meta` snapshots alongside) | Self-contained Parquet is simpler for ML consumers; the JOIN at SELECT time is cheap. |
| `obs_id` column | Skip (use `(sub_id, species_code)` composite) | Synthesize an opaque id | The live table has no `obs_id`; downstream consumers compose the composite if they need a single string. Synthesizing adds a never-stable surface. |
| T8 — observability widgets | Added 2026-05-20 per orchestrator session | Defer to a follow-up issue post-rollout; rely on `gcloud logging read` only | Visibility into the archive→delete pipeline is operationally load-bearing — without the dashboard tiles, divergence between archive rowCount and delete deletedCount (the T2 atomic invariant) is silent until a manual log audit. Adding 4 tiles + 3 log-based metrics + a separate `deletedCount` field in the T2 emit is small enough to fold in-plan rather than queue a follow-up. Lands on the existing `bird-watch overview` dashboard (Row 5) — no new dashboard surface. |

---

## §10 — Acceptance criteria

Plan is complete when:

- [ ] T1 applied: `gs://bird-maps-prod-obs-archive` exists, lifecycle rule active, BigQuery external table queryable.
- [ ] T2–T4 shipped: `npm run test --workspace @bird-watch/ingestor` green; `cli prune` end-to-end test in T4 step 8 green.
- [ ] T5 verified: at least one nightly run has archived at least one day, `gcloud storage ls` shows the partitioned object, BigQuery returns matching row counts.
- [ ] T6: runbook §Backfill spells out the forwards-only stance.
- [ ] Cost monitoring wired: budget alert at $5/mo on the bucket; `gcloud storage du` documented in the runbook.
- [ ] T8 applied: `bird-watch overview` dashboard Row 5 renders 4 new tiles (archive throughput, GCS bytes/night, archive-vs-delete parity, GCS bucket size 90d); 3 `google_logging_metric` descriptors (`bird-ingest-archived-row-count`, `bird-ingest-archived-bytes-uploaded`, `bird-ingest-archived-deleted-count`) returnable from `gcloud monitoring metrics-descriptors describe`.

---

🤖 Plan generated 2026-05-20 via the writing-plans skill (project-level extension).
