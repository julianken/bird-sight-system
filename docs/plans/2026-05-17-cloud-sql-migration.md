# Neon → Cloud SQL Postgres migration (us-west1 collocation)

**Date:** 2026-05-17
**Author:** Julian (plan-only run; no execution)
**Triggering analysis:** `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` — Finding 9 (cross-cloud egress flips sign at 5–6% Cloudflare cache-miss).
**Triggering measurement:** `docs/analyses/2026-05-14-process-scale-options/cache-hit-ratio.md` — Cloudflare zone analytics on 2026-05-17 read **100% miss (24h)** and **99.91% miss (30d)** on `bird-maps.com`. That is ~17× the 5–6% break-even. Recommendation 2B (Cloud SQL collocation) is the only honest 50-state branch.
**Precondition:** user has committed to national scale (Hacker News-scale audience, ≥200× AZ multiplier). At AZ scale alone this migration *loses* ~$65/mo; it is justified by the committed scale, not by today's traffic.
**Live infra:** bird-maps.com — GCP `bird-maps-prod` (us-west1), Cloudflare account `bcbb962d…`, current DB on Neon `org-green-boat-15736536` (aws-us-west-2, Postgres 16 + PostGIS).

## §1 Scope

In scope:
1. Provision a Cloud SQL for Postgres 16 instance in `bird-maps-prod` / us-west1 alongside the existing Neon project (parallel run).
2. Restore a `pg_dump` of the Neon `birdwatch` database into Cloud SQL with PostGIS extension and geometry-column fidelity.
3. Cut the three services (read-api, ingestor, admin-api) over to the Cloud SQL pooled connection via a single Secret Manager version flip.
4. Remove the Neon project, provider, and `local.neon_pooled_url` in a follow-up PR after a clean observation window.

Explicitly out of scope:
- BigQuery cold tier (Recommendation 2B's second half). Filed as `docs/plans/<future>-bigquery-cold-tier.md`. Cold tier is irreversible coupling on the phenology read-path; do not bundle.
- Schema or query changes. The migration is a transport swap; the DDL is the same.
- pgvector / extension additions beyond PostGIS. The current schema uses `postgis` only (see `migrations/1700000001000_enable_postgis.sql`).
- Multi-region read replicas. Cloud SQL single-zone + HA-as-flag covers the committed scale band.

## §2 Sizing

### Tier

**Choice: `db-g1-small` (1 vCPU shared, 1.7 GB RAM), single-zone, no HA.**

Justification:
- Current Neon footprint is bounded by the **Launch plan ceiling (~10 GB)** with actual usage <1 GB after the 14-day prune model (see `services/ingestor/src/prune.ts` and `migrations/170000000{6,7}000_*`). 50-state expansion under the same prune model lands at ~3 GB steady-state hot tables + indexes (Finding 8 / Iterator-4).
- `db-f1-micro` (614 MB RAM, shared CPU, no HA option) is the cheapest tier but cannot enable HA and is the only tier Google does not document for production use. `db-g1-small` is the smallest **production-supported** shared-core tier; both shared-core tiers are billed as a flat hourly rate, not per-vCPU/RAM, and `db-g1-small` is ~$25/mo on-demand in us-west1 vs ~$9/mo for `db-f1-micro`.
- The committed scale is "Hacker News spike", which is a peak-RAM problem on the read-API connection pool, not a sustained-vCPU problem. 1.7 GB RAM is the bound that matters.
- Headroom for one in-place vertical scale to `db-custom-1-3840` (~$45/mo) takes a single `terraform apply` with seconds of unavailability; we are not locked in.

### Storage

- `disk_type = "PD_SSD"` (default; HDD is not offered for shared-core tiers).
- `disk_size = 10` GB initial.
- `disk_autoresize = true`, `disk_autoresize_limit = 50` GB. Autoresize is one-way (no shrink), so the limit caps a runaway-ingest accident before it costs >$10/mo of unused SSD.

### HA

**Off (single-zone) at launch.** Justification:
- HA doubles instance cost (~$25 → ~$50/mo) and the project is a hobbyist budget. The committed scale is bounded by what one person funds out-of-pocket.
- Cloud SQL single-zone has a published 99.95% SLA; the existing ingestor already handles transient connection loss via pg pool retries (`packages/db-client/src/pool.ts`).
- Daily automated backups + 7-day PITR (see Backups below) give a ~5-minute RPO on the only data class that is irreplaceable (silhouettes, descriptions, photo URLs). Observations are re-derivable from eBird; the worst-case data-loss event is "re-run the ingestor".
- HA is a one-flag change later (`availability_type = "REGIONAL"` + a `terraform apply`) — the only side effect is a brief failover during the switch. Reversible.

### Backups

- `backup_configuration.enabled = true`.
- `backup_configuration.point_in_time_recovery_enabled = true` (requires `enable_binary_log` on MySQL; on Postgres it just toggles WAL archival — no extra flag).
- `backup_configuration.start_time = "09:00"` UTC (02:00 America/Phoenix; off-peak for both ingestor and read traffic).
- `transaction_log_retention_days = 7` (PITR window).
- `backup_retention_settings.retained_backups = 7`, `retention_unit = "COUNT"`.

### Networking

- **Public IP + authorized networks initially; Cloud SQL Auth Proxy via Cloud Run's built-in `cloud_sql_instance` volume mount for service-to-DB traffic.** No public-IP allowlist of operator workstations — operator access goes through `gcloud sql connect` (the same Auth Proxy path).
- `ip_configuration.ipv4_enabled = true`.
- `ip_configuration.ssl_mode = "ENCRYPTED_ONLY"`.
- `ip_configuration.authorized_networks = []` (empty — services use the proxy, not direct TCP).
- Private IP (`private_network = google_compute_network.default.id`) is the right long-term shape but requires a VPC connector for Cloud Run v2 (`google_vpc_access_connector`) and a Service Networking peering. Filed as a follow-up; not load-bearing for the cost lever.

## §3 Terraform

All changes land in `infra/terraform/db.tf` and `infra/terraform/read-api.tf`. The Neon resources stay through cutover and are removed in a follow-up PR.

### §3.1 New file `infra/terraform/cloud-sql.tf`

```hcl
# Cloud SQL Postgres 16 instance, collocated with read-api / ingestor in us-west1.
# Justification: docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md
# Finding 9 — Cloudflare cache-miss 99.91% (30d) flips egress sign by ~$230/mo at 50-state.

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "random_password" "cloudsql_app_user" {
  length  = 32
  special = false # Cloud SQL Postgres tolerates symbols but pg connection strings need URL-encoding;
                  # a 32-char alnum is >190 bits of entropy and dodges the encoding hazard entirely.
}

resource "google_sql_database_instance" "birdwatch" {
  name             = "birdwatch-pg16"
  database_version = "POSTGRES_16"
  region           = var.gcp_region # us-west1

  deletion_protection = true

  settings {
    tier              = "db-g1-small"
    availability_type = "ZONAL" # single-zone; flip to REGIONAL later if traffic warrants
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true
    disk_autoresize_limit = 50

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "09:00" # UTC
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled        = true
      ssl_mode            = "ENCRYPTED_ONLY"
      authorized_networks = []
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }

    maintenance_window {
      day          = 7   # Sunday
      hour         = 10  # 10:00 UTC = 03:00 America/Phoenix
      update_track = "stable"
    }
  }

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_database" "birdwatch" {
  name     = "birdwatch"
  instance = google_sql_database_instance.birdwatch.name
}

resource "google_sql_user" "app" {
  name     = "birdwatch_app"
  instance = google_sql_database_instance.birdwatch.name
  password = random_password.cloudsql_app_user.result
}

locals {
  # Cloud SQL Auth Proxy unix socket path inside Cloud Run's cloud_sql_instance volume mount.
  # Format documented at cloud.google.com/sql/docs/postgres/connect-run.
  cloudsql_socket_dir = "/cloudsql/${google_sql_database_instance.birdwatch.connection_name}"

  # libpq accepts `host=/path` to use a unix socket. URL-encode the path.
  cloudsql_pooled_url = "postgres://${google_sql_user.app.name}:${random_password.cloudsql_app_user.result}@/${google_sql_database.birdwatch.name}?host=${local.cloudsql_socket_dir}"
}

output "cloudsql_connection_name" {
  value = google_sql_database_instance.birdwatch.connection_name
}

output "cloudsql_db_url" {
  value     = local.cloudsql_pooled_url
  sensitive = true
}
```

**Provider-attribute verification** (context7, 2026-05-17): `google_sql_database_instance.settings.ip_configuration.ssl_mode = "ENCRYPTED_ONLY"` is the v6+ replacement for the deprecated `require_ssl` boolean. `backup_retention_settings` is a nested block under `backup_configuration` (not a top-level setting). `disk_autoresize_limit` is the correct attribute (not `disk_size_limit`). Re-verify before C2 lands.

### §3.2 Edit `infra/terraform/read-api.tf` — secret payload swap

The Secret Manager secret keeps its `secret_id` (`bird-watch-db-url`). The **payload** changes from `local.neon_pooled_url` to `local.cloudsql_pooled_url`. Services read `version = "latest"` so the flip is atomic at the Cloud Run side after a revision rollout.

The pre-cutover Terraform shape adds a second version while keeping the first as "latest" until the cutover commit:

```hcl
# Pre-cutover (kept from current state, untouched in §3.1's commit):
resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = local.neon_pooled_url
}

# Cutover commit adds:
resource "google_secret_manager_secret_version" "db_url_cloudsql" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = local.cloudsql_pooled_url
  # No `enabled = false` — version becomes latest on apply. Sequencing in §6 ensures
  # Cloud Run revisions are restarted within the cutover window so they pick it up.
}
```

### §3.3 Edit Cloud Run services to mount the Cloud SQL socket volume

`read-api.tf`, `ingestor.tf` (three Cloud Run Job blocks: recent/historic/silhouettes — three locations all using the same pattern), and `admin-api.tf` each get a `volumes` + `volume_mounts` pair on the existing `template`:

```hcl
template {
  # existing scaling / service_account / containers blocks unchanged

  volumes {
    name = "cloudsql"
    cloud_sql_instance {
      instances = [google_sql_database_instance.birdwatch.connection_name]
    }
  }

  containers {
    # existing image / ports / resources / env blocks unchanged
    volume_mounts {
      name       = "cloudsql"
      mount_path = "/cloudsql"
    }
  }
}
```

The DATABASE_URL secret-keyref env block is unchanged. The library code in `packages/db-client/src/pool.ts` reads `connectionString` and `pg`/`libpq` natively parses `host=/cloudsql/<conn>` as a unix-socket connection — no app code change required.

### §3.4 Removed in follow-up PR (not this PR)

After ≥48h of clean Cloud SQL operation:
- `infra/terraform/db.tf` (entire file) — `neon_project.birdwatch`, `neon_database.main`, `local.neon_pooled_url`, both outputs.
- `infra/terraform/versions.tf` — drop the `kislerdm/neon` provider entry.
- `google_secret_manager_secret_version.db_url` (the Neon version) — removing it after the Cloud SQL version is latest is safe; Cloud Run revisions pin `version = "latest"` and re-resolve on next restart.
- `.terraform.lock.hcl` re-pinned via `terraform init -upgrade`.
- `infra/terraform/terraform.tfvars` — `neon_org_id`, `neon_api_key` no longer required (delete the variable declarations in `variables.tf`).

## §4 Data migration

### §4.1 PostGIS version check (do this first)

Neon's current `postgis` version is `3.4.x` (Postgres 16 default on Neon as of 2026-05). Cloud SQL Postgres 16 ships PostGIS `3.4.x` as well (verify with `gcloud sql tiers list` and the [PostgreSQL extensions support page](https://cloud.google.com/sql/docs/postgres/extensions)). Operator must confirm exact patch versions before C2:

```sh
# Against Neon:
psql "$NEON_URL" -c "SELECT postgis_full_version();"
# Against a throwaway Cloud SQL instance, or read from the GCP docs:
gcloud sql instances describe birdwatch-pg16 --format='value(databaseInstalledVersion)'
psql "$CLOUDSQL_URL" -c "SELECT postgis_full_version();"
```

**Risk gate:** if PostGIS major versions differ, the `pg_dump --section=pre-data` will emit `CREATE EXTENSION postgis VERSION '3.4.0'` (or whatever Neon has) and the restore will fail. Fix by stripping the `VERSION` clause from the dump before restore. If minor versions differ only, `pg_dump` does not pin a minor — no action needed.

### §4.2 Dump

The schema uses one GENERATED column with PostGIS geometry (`observations.geom` is `geometry(Point, 4326) GENERATED ALWAYS AS ...` per `migrations/1700000006000_observations.sql` — verify before the dump). Generated columns are computed at restore time from their expression, so they should NOT be dumped — `pg_dump` already handles this with `--no-tablespaces` and the default schema-aware mode, but operator should grep for `GENERATED` in the dump to confirm geom columns appear in `CREATE TABLE` and not in `COPY` data.

```sh
# Run from operator workstation with Neon URL exported.
# --no-owner / --no-privileges: ownership and grants are different across vendors;
#   recreate them manually in §4.3's post-restore step.
# --section split: lets us restore extensions BEFORE schema, schema BEFORE data, data BEFORE indexes.
# -Fc (custom format) gives parallelism options and is required for pg_restore -j.

mkdir -p /tmp/birdwatch-migration
cd /tmp/birdwatch-migration

pg_dump "$NEON_URL" \
  --no-owner --no-privileges \
  --format=custom \
  --file=birdwatch.dump

# Sanity: list the dump's table-of-contents and look for the postgis extension marker.
pg_restore --list birdwatch.dump > toc.txt
grep -i postgis toc.txt   # expect: a "DROP EXTENSION postgis" and a matching CREATE
grep -i geom    toc.txt   # expect: indexes (gist_*) and columns; NOT COPY data lines for generated cols

# Record row counts for §4.5 sanity check.
psql "$NEON_URL" -At -c "
  SELECT table_schema || '.' || table_name || ' ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY 1;
" > rowcounts-neon.txt
```

### §4.3 Restore

The Cloud SQL Postgres image pre-installs the postgis binaries but the extension is NOT created in `birdwatch` by default. Operator creates it as the `birdwatch_app` user; Cloud SQL grants `cloudsqlsuperuser` to user-created users which is sufficient for `CREATE EXTENSION postgis`.

```sh
# From operator workstation. cloud-sql-proxy listens on a local socket dir.
cloud-sql-proxy --unix-socket /tmp/cloudsql-proxy "$(terraform -chdir=infra/terraform output -raw cloudsql_connection_name)" &
PROXY_PID=$!

# libpq via unix socket:
export CLOUDSQL_URL="postgres://birdwatch_app:$(terraform -chdir=infra/terraform output -raw cloudsql_db_url | sed -E 's|.*:([^@]+)@.*|\1|')@/birdwatch?host=/tmp/cloudsql-proxy/$(terraform -chdir=infra/terraform output -raw cloudsql_connection_name)"

# Enable PostGIS first (must precede schema restore — CREATE TABLE references geometry type).
psql "$CLOUDSQL_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql "$CLOUDSQL_URL" -c "SELECT postgis_full_version();"

# Restore in custom-format with parallelism. -1 wraps the whole thing in one txn — safer rollback.
pg_restore \
  --dbname="$CLOUDSQL_URL" \
  --no-owner --no-privileges \
  --jobs=2 \
  --verbose \
  birdwatch.dump 2>&1 | tee restore.log

# Expect: zero errors. Acceptable: NOTICE messages about extension already exists, and one
# expected error about `CREATE EXTENSION postgis` already existing (since we created it above).
# Unacceptable: any ERROR on a CREATE TABLE, CREATE INDEX, or COPY.

kill $PROXY_PID
```

### §4.4 Migration-history table

`node-pg-migrate` reads `pgmigrations` (the default name) to know which migrations have run. The dump includes it (it is a regular user table); after restore, sanity-check:

```sh
psql "$CLOUDSQL_URL" -c "SELECT name, run_on FROM pgmigrations ORDER BY id DESC LIMIT 5;"
# Expect: 1700000045000_drop_regions_table (or whatever migration id is latest in main).
```

### §4.5 Sanity-check queries

```sh
# Row-count parity: every table within ±0 rows. The ingestor is paused (§6 step 4) during dump,
# so post-pause-to-post-restore delta must be exactly zero.
psql "$CLOUDSQL_URL" -At -c "
  SELECT table_schema || '.' || table_name || ' ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY 1;
" > rowcounts-cloudsql.txt
diff rowcounts-neon.txt rowcounts-cloudsql.txt
# Expect: zero diff.

# Geometry validity: every observation row has a valid Point(4326).
psql "$CLOUDSQL_URL" -c "
  SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE geom IS NULL) AS null_geom,
         COUNT(*) FILTER (WHERE NOT ST_IsValid(geom)) AS invalid_geom,
         COUNT(*) FILTER (WHERE ST_SRID(geom) != 4326) AS wrong_srid
  FROM observations;
"
# Expect: null_geom = 0, invalid_geom = 0, wrong_srid = 0.

# GIST index present (read-API depends on it for bbox queries):
psql "$CLOUDSQL_URL" -c "\d observations" | grep -i gist
# Expect: one entry naming observations_geom_idx (or whatever the migration named it).

# Smoke a representative read-API query — region bbox + species count:
psql "$CLOUDSQL_URL" -c "
  SELECT species_code, COUNT(*)
  FROM observations
  WHERE geom && ST_MakeEnvelope(-115, 31, -109, 37, 4326)
  GROUP BY species_code
  ORDER BY 2 DESC
  LIMIT 5;
"
# Expect: returns rows in <500ms; values match the same query run against Neon.
```

## §5 Connection-string + secret rotation

The Secret Manager secret `bird-watch-db-url` is the single source of truth. Three things consume it:

1. `services/read-api` (Cloud Run service, `min_instance_count = 0`, scale-to-zero — picks up new secret version on next cold start or on revision-restart).
2. `services/ingestor` (Cloud Run Jobs — `recent` every 30 min, `historic`/`silhouettes` ad-hoc — each job execution resolves `version = "latest"` at start).
3. `services/admin-api` (Cloud Run service, low-traffic).

Application code touched: **none.** `packages/db-client/src/pool.ts` consumes `process.env.DATABASE_URL` verbatim. The unix-socket path `?host=/cloudsql/...` is honored by `pg` (which delegates to libpq's connection-string parser) — verified against `pg` 8.x parsing behavior, no code change required.

The sequencing that guarantees no service ever runs against a missing DB:

1. Apply Cloud SQL instance + new secret version (latest). Neon stays up.
2. Force-restart each Cloud Run service so the running revision picks up the new secret. Cloud Run Jobs do this automatically on the next execution; services need an explicit `gcloud run services update --update-secrets DATABASE_URL=bird-watch-db-url:latest` or a no-op deploy.
3. Verify on each service via `/health` + a representative read.
4. Only then proceed to remove Neon in the follow-up PR.

**Rotation discipline:** the Cloud SQL app-user password is in Terraform state via `random_password`. To rotate, `terraform taint random_password.cloudsql_app_user && terraform apply` — this regenerates the password, updates `google_sql_user.app`, and pushes a new secret version. Cloud Run picks it up on next restart. RTO ~3 min.

## §6 Cutover

**Strategy: read-only Neon snapshot → atomic secret swap → traffic on Cloud SQL → drain Neon.**

Dual-write was considered and rejected:
- The ingestor writes from one process every 30 min; the read path is read-only. Total write window per ingest cycle is <30s.
- Dual-writing requires either an app-code change (write to both `pg.Pool` instances) or a logical-replication subscription (Neon supports `pglogical` but Cloud SQL's `pglogical` support is gated behind enabling specific `cloudsql.logical_decoding` flags and is non-trivial to wire end-to-end). Either path costs more wall-time than a 30-min ingest-pause cutover.
- The freshness SLO on `bird-maps.com` is "within an hour"; a 30-minute write pause is invisible to users.

Cutover steps (one operator session, ~45 min wall):

1. **T-24h: Pre-flight.** Verify §4.1's PostGIS-version check. Pre-apply §3.1's Cloud SQL instance (no traffic yet). Pre-test §4.3's restore against a *throwaway* dump (Neon snapshot from now) — measure wall-clock time; expect <10 min for <1 GB.
2. **T-0: Pause ingestor.** `gcloud scheduler jobs pause ingestor-recent --location=us-west1` (Cloud Scheduler trigger for the recent job). Verify with `gcloud scheduler jobs describe ingestor-recent --location=us-west1` — `state: PAUSED`. Active Cloud Run Job executions are allowed to finish (the 30-min recent job typically completes in <60s).
3. **T+1: Mark Neon read-only.** This is belt-and-suspenders — the ingestor is the only writer, and step 2 stopped it. To enforce: `psql "$NEON_URL" -c "ALTER DATABASE birdwatch SET default_transaction_read_only = true;"`. New connections become read-only; existing connections are unaffected until they reconnect.
4. **T+2: Dump + restore.** Run §4.2 and §4.3 against current Neon state. Expected wall: <10 min.
5. **T+12: Sanity check.** Run §4.5. Stop on any non-zero row-count diff or invalid geom.
6. **T+15: Secret swap.** `terraform apply` the cutover commit (adds `google_secret_manager_secret_version.db_url_cloudsql`). Verify `gcloud secrets versions list bird-watch-db-url` shows the new version as `latest`.
7. **T+18: Restart Cloud Run services.** `gcloud run services update bird-read-api --region=us-west1 --update-secrets=DATABASE_URL=bird-watch-db-url:latest` and same for `bird-admin-api`. This forces a new revision pointing at the same image with the refreshed secret resolution.
8. **T+22: Smoke read-API.** `curl -sf https://api.bird-maps.com/api/regions | jq '.regions | length'` (expect >0). `curl -sf 'https://api.bird-maps.com/api/observations?bbox=-115,31,-109,37&days=7' | jq '. | length'` (expect non-zero match against current ingest state).
9. **T+25: Resume ingestor pointing at Cloud SQL.** `gcloud scheduler jobs resume ingestor-recent --location=us-west1`. Wait for the next scheduled execution (≤30 min) and verify in Logs Explorer that it ran green against `/cloudsql/<conn>`.
10. **T+55: Confirm freshness.** `psql "$CLOUDSQL_URL" -c "SELECT MAX(obs_dt) FROM observations;"` — should advance within 5 min of the ingestor's first post-cutover run.
11. **T+60: Lift Neon read-only.** `psql "$NEON_URL" -c "ALTER DATABASE birdwatch RESET default_transaction_read_only;"`. (Keeps Neon as a hot rollback target.)
12. **T+24h: Open follow-up PR (§3.4)** removing Neon. Do not delete the Neon project from the dashboard until Terraform has destroyed the resources cleanly via `terraform apply`.

### Rollback (~15 min RTO)

If steps 5–10 fail, before §3.4 ships:

1. `gcloud run services update bird-read-api --region=us-west1 --update-secrets=DATABASE_URL=bird-watch-db-url:1` (pin to the Neon version explicitly — version 1 is the original Neon payload).
2. Same for `bird-admin-api`.
3. `gcloud scheduler jobs pause ingestor-recent` if still paused, otherwise `resume`.
4. Lift Neon read-only (`ALTER DATABASE birdwatch RESET default_transaction_read_only`).
5. Verify smoke: `curl -sf https://api.bird-maps.com/api/regions`. Expected wall to recovery: ~10–15 min.
6. File issue on what failed; do not retry until root-caused.

After §3.4 ships, rollback is **forward-only** — re-creating the Neon project from `kislerdm/neon` Terraform is supported but loses the parallel-running state (Neon will be empty until a fresh `pg_dump | pg_restore` *from* Cloud SQL back to a freshly-provisioned Neon). Plan accordingly: do not merge §3.4 until 48h of clean Cloud SQL operation.

## §7 Cost comparison

Numbers sourced from `docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md` Tables A–B and recommendation blocks 2A/2B. All figures monthly USD.

| Scale | DB platform | DB cost | Egress | Total (DB + egress) | Notes |
|---|---|---|---|---|---|
| AZ today | Neon Free (current) | $0 | $0 | $0 | What we have today; cache-miss is irrelevant because read volume is tiny |
| AZ today | Neon Launch (next tier) | ~$29 | $0 | ~$29 | Where AZ ends up when storage exceeds Free tier |
| AZ today | Cloud SQL `db-g1-small` zonal | ~$25 | ~$0 | ~$25 | This plan, at AZ scale — slightly *cheaper* than Neon Launch but with no scale-to-zero |
| 50-state (200× audience) | Neon Launch + cross-cloud egress @ 99.91% miss | ~$29 + ~$230 | ~$230 | **~$259** | Cross-cloud GCP↔AWS bytes are billed at ~$0.12/GB Neon-side once past 100 GB inclusive |
| 50-state (200× audience) | Cloud SQL `db-g1-small` zonal (this plan) | ~$25 | ~$0 | **~$25** | Egress is intra-region (GCP us-west1 → Cloudflare PoP); free for our pattern |
| 50-state (200× audience) | Cloud SQL `db-custom-1-3840` zonal (one tier up) | ~$45 | ~$0 | **~$45** | The likely landing tier once Hacker News-scale RAM pressure surfaces |

**Delta at AZ scale today:** Cloud SQL is **~$25/mo more** than Neon Free, and **~$4/mo cheaper** than the Neon Launch we are otherwise headed toward as storage grows. Either way, this migration is not justified by AZ-today costs.

**Delta at 50-state scale:** Cloud SQL is **~$230/mo cheaper** than staying on Neon, dominated entirely by avoiding cross-cloud egress. This is the load-bearing economic justification.

**Break-even on the migration itself:** if 50-state launch takes ≥1 month after this plan ships, the migration pays back in <1 month of post-launch operation. The plan is a sunk one-time investment of ~30–40 hours (consistent with the analysis report's 30–50h estimate for "Recommendation 2B without the BQ cold tier"). Even on a hobbyist budget, that is a clear-positive ROI.

## §8 Risk register

| # | Risk | Class | Mitigation |
|---|---|---|---|
| 1 | PostGIS minor-version skew breaks restore (Neon 3.4.x vs Cloud SQL 3.4.x — verify before dump) | Data | §4.1 pre-flight check; strip `VERSION` clause from dump if pinned |
| 2 | Generated geometry column ends up in dump as `COPY` data instead of being recomputed at restore | Data | §4.2 sanity: grep `GENERATED` in toc; if `geom` appears in COPY section, regenerate dump with `--column-inserts` or strip the column from data section |
| 3 | Cloud SQL Postgres ships PostGIS at a version that lacks `ST_*` functions used by `services/read-api` (specifically `ST_MakeEnvelope`, `ST_Intersects`, `ST_Within`) | Data | §4.5 smoke query exercises `ST_MakeEnvelope` + GIST. All listed functions are in PostGIS ≥2.0 (Cloud SQL ships ≥3.x), so risk is low; smoke catches drift |
| 4 | `random_password.cloudsql_app_user` ends up in plaintext in Terraform state | Secrets | State already lives in GCS with object-versioning + IAM; this is not a new exposure surface vs current `neon_project.database_password` |
| 5 | Cloud SQL Auth Proxy unix-socket path is wrong format and `pg` rejects connection string | Config | Pre-test on throwaway instance during §6 step 1; the format `postgres://user:pw@/db?host=/cloudsql/<conn>` is documented and used by hundreds of GCP deployments |
| 6 | Cloud Run Job (ingestor) `cloud_sql_instance` volume mount differs from Cloud Run Service mount syntax in Terraform | Config | The block shape is identical (`template { volumes { cloud_sql_instance { instances = [...] }}}`), verified in `google_cloud_run_v2_job` schema via context7 |
| 7 | Ingestor pause during cutover (~45 min) causes one missed 30-min ingest cycle | Operational | eBird's `/recent` endpoint is rolling 7d; missed cycle is recovered on the next run with no data loss |
| 8 | Neon → Cloud SQL latency change on read-API queries is negative (slower) | Performance | Strongly counter-indicated: intra-region (Cloud Run us-west1 → Cloud SQL us-west1) should be ~1–3ms vs current ~30–50ms cross-cloud. Worst case (Cloud SQL cold cache) is bounded by the GIST index already present. Measure with §4.5's smoke query and the read-API's existing p95 metric |
| 9 | Public-IP-with-auth-proxy posture is less secure than private-IP/VPC peering | Security | Cloud SQL Auth Proxy uses IAM-authenticated mTLS; `ssl_mode = "ENCRYPTED_ONLY"` blocks any plaintext attempt. `authorized_networks = []` means no IP-based access at all. Private IP is a follow-up, not a launch requirement |
| 10 | HA is off; a us-west1 zone failure produces an outage until Cloud SQL fails over (no automatic failover in zonal mode) | Reliability | Accepted per §2 sizing rationale. Flip to `availability_type = "REGIONAL"` is a single Terraform commit; cost gate revisits at month-3 post-launch |
| 11 | Cloud SQL backup/PITR fails silently and we don't notice until a recovery event | Reliability | `monitoring.googleapis.com` already in the project; add a Cloud Monitoring alert on `cloudsql.googleapis.com/database/backup/failed` in a follow-up infra commit. Filed but not load-bearing for cutover |
| 12 | `deletion_protection = true` makes `terraform destroy` of the workspace impossible without operator intervention | Operational | Intentional. The escape hatch is `terraform apply` with `deletion_protection = false` first, then destroy. Documented inline |
| 13 | Neon project removal in §3.4 deletes data we still needed | Data | The 48h observation window catches anything not-yet-noticed; if Neon must be preserved longer, push §3.4 out, do not rush it. Removing Neon from Terraform does NOT immediately delete the project from the Neon dashboard — the provider issues an API DELETE, which is irreversible. Sanity: take a manual `pg_dump` of Cloud SQL to local disk on the day §3.4 merges, retain for 30 days |
| 14 | Terraform state corruption mid-apply during cutover | Operational | Pre-cutover `terraform state pull > /tmp/tfstate-pre-cloudsql-$(date -u +%Y%m%dT%H%M%SZ).backup` (same shape as the Cloudflare v5 migration's P5). Forward-recovery section of that plan applies analogously |
| 15 | `kislerdm/neon` provider apply fails during §3.4's destroy if the Neon API returns 5xx | Operational | Retryable; if persistently failing, `terraform state rm` the Neon resources and manually delete the project from the Neon dashboard, then commit a follow-up removing the lines |

## §9 Task breakdown

Each task is sized for one PR via `superpowers:subagent-driven-development`. Tasks are sequential (T2 depends on T1's Cloud SQL instance existing, etc.) — do not parallelize.

### T1 — `infra(db): provision Cloud SQL alongside Neon`

**Files:**
- New: `infra/terraform/cloud-sql.tf` (verbatim from §3.1).
- Edit: `infra/terraform/versions.tf` (no change — `hashicorp/google` provider already present; verify version constraint allows current resource set with `terraform init -upgrade`).

**Operator commands:**
```sh
cd infra/terraform
terraform init -upgrade
terraform plan -out=plan.bin
terraform show plan.bin | grep -E '^\s*\+ resource' # expect: 4 new resources (instance, database, user, sqladmin service)
terraform apply plan.bin
gcloud sql instances describe birdwatch-pg16 --format='value(state)' # expect: RUNNABLE
```

**Gate:** `terraform plan` is empty after apply; Cloud SQL instance is `RUNNABLE`; `gcloud sql databases list --instance=birdwatch-pg16` lists `birdwatch`.

**Commit boilerplate:**
```
infra(db): provision Cloud SQL Postgres 16 in us-west1

Adds a Cloud SQL Postgres 16 instance (db-g1-small, zonal) alongside the
existing Neon project. No traffic cuts over in this PR — Neon remains the
live DB. Justification: docs/analyses/2026-05-14-process-scale-options/
phase-4/analysis-report.md Finding 9; cache-miss measured at 99.91% (30d)
in docs/analyses/2026-05-14-process-scale-options/cache-hit-ratio.md, 17×
the break-even for Cloud SQL collocation.
```

### T2 — `infra(db): mount Cloud SQL socket on Cloud Run services`

**Files:**
- Edit: `infra/terraform/read-api.tf` (add `volumes` + `volume_mounts` per §3.3).
- Edit: `infra/terraform/admin-api.tf` (same shape).
- Edit: `infra/terraform/ingestor.tf` (three Cloud Run Job blocks, same shape).

**Operator commands:**
```sh
terraform plan # expect: in-place updates to read-api, admin-api, and 3 ingestor jobs; no replacements
terraform apply
gcloud run services describe bird-read-api --region=us-west1 \
  --format='value(spec.template.spec.volumes[0].csi.driver)' # expect: empty (we use cloudsql, not csi)
gcloud run services describe bird-read-api --region=us-west1 --format=yaml \
  | grep -A2 cloudSqlInstance # expect: instances list with the connection name
```

**Gate:** no Cloud Run revision shows `revision failed`; each service still serves traffic (the secret still points at Neon — this PR mounts the socket but does not switch DBs).

**Commit boilerplate:**
```
infra(db): mount Cloud SQL socket on read-api / admin-api / ingestor

Pre-cutover wiring. Each Cloud Run service and Cloud Run Job now has the
/cloudsql/<conn> unix-socket volume mounted; DATABASE_URL still points at
Neon. The cutover PR (T4) will flip the secret payload.
```

### T3 — `data: dump Neon → restore Cloud SQL (operator-only, no PR)`

This is an operator session, not a code PR. Logs and row-count diffs go in `docs/analyses/2026-05-17-cloud-sql-migration/` (create the folder). Follow §4 verbatim.

**Done when:** §4.5 sanity checks pass; row counts match Neon exactly; geometry validity = 0 invalid; smoke query returns identical results from both DBs.

### T4 — `infra(db): cutover — flip DATABASE_URL secret to Cloud SQL`

**Files:**
- Edit: `infra/terraform/read-api.tf` — add `google_secret_manager_secret_version.db_url_cloudsql` (per §3.2). Do NOT remove the existing `db_url` version.

**Operator session sequencing:** all of §6 steps 2–11 in one window.

**Operator commands:**
```sh
gcloud scheduler jobs pause ingestor-recent --location=us-west1
psql "$NEON_URL" -c "ALTER DATABASE birdwatch SET default_transaction_read_only = true;"
# Run T3 dump/restore if not already done this session (re-do if data has drifted).
terraform plan # expect: 1 new resource (db_url_cloudsql version)
terraform apply
gcloud run services update bird-read-api --region=us-west1 \
  --update-secrets=DATABASE_URL=bird-watch-db-url:latest
gcloud run services update bird-admin-api --region=us-west1 \
  --update-secrets=DATABASE_URL=bird-watch-db-url:latest
curl -sf https://api.bird-maps.com/api/regions | jq '.regions | length' # expect: >0
curl -sf 'https://api.bird-maps.com/api/observations?bbox=-115,31,-109,37&days=7' | jq 'length' # expect: >0
gcloud scheduler jobs resume ingestor-recent --location=us-west1
# Wait ≤30 min, then:
psql "$CLOUDSQL_URL" -c "SELECT MAX(obs_dt) FROM observations;" # expect: within 35 min of now
psql "$NEON_URL" -c "ALTER DATABASE birdwatch RESET default_transaction_read_only;"
```

**Gate:** read-API returns non-empty responses; ingestor's next scheduled run completes green against Cloud SQL; freshness advances in Cloud SQL.

**Commit boilerplate:**
```
infra(db): cut DATABASE_URL secret over to Cloud SQL

Atomically flips bird-watch-db-url latest version from the Neon pooled URL
to the Cloud SQL Auth Proxy unix-socket URL. Cloud Run services restarted
in the same operator session; ingestor resumed after verification. Neon
is left online (read-only released) as a hot rollback target for 48h.
```

### T5 — `infra(db): remove Neon` (≥48h after T4 merges)

**Files:**
- Delete: `infra/terraform/db.tf`.
- Edit: `infra/terraform/variables.tf` — remove `neon_org_id`, `neon_api_key`.
- Edit: `infra/terraform/versions.tf` — remove `kislerdm/neon` provider entry.
- Edit: `infra/terraform/terraform.tfvars.example` — remove neon variables.
- Edit: `infra/terraform/read-api.tf` — remove `google_secret_manager_secret_version.db_url` (the Neon version). The Cloud SQL version stays; `db_url_cloudsql` is now the only version and remains `latest`.

**Operator commands:**
```sh
# 48h since T4. Verify no degradation.
gcloud monitoring time-series list ... # or read the dashboards; freshness OK, error rate flat.

# Take a safety dump from Cloud SQL before Neon goes away.
pg_dump "$CLOUDSQL_URL" -Fc -f /tmp/cloudsql-safety-$(date -u +%Y%m%d).dump

terraform plan # expect: ~6 destroys (neon_project, neon_database, neon secret version)
terraform apply
gcloud secrets versions list bird-watch-db-url # expect: only the Cloud SQL version
```

**Gate:** `terraform plan` clean after apply; read-API still green; Neon project gone from `app.neon.tech`.

**Commit boilerplate:**
```
infra(db): remove Neon — Cloud SQL is the only database

48h post-cutover (T4) with clean operation. Deletes neon_project,
neon_database, the kislerdm/neon provider, and the obsolete Neon secret
version. Safety pg_dump of Cloud SQL retained at <local-archive-path>
for 30 days.
```

## §10 Honest open items

- **HA is off.** Documented choice, but if Hacker News-scale traffic surfaces a single-zone availability incident before month-3 review, the user will discover it the same way the current silent-drift was discovered: by reading the dashboard. Pair this plan with a Cloud SQL "down" alert hooked into Workflows (Tier-0 alert from the analysis report).
- **Backup/PITR is not actively monitored.** §8 risk #11 acknowledges this. A `cloudsql.googleapis.com/database/backup/failed` alert is a 5-line follow-up PR; left out here to keep scope focused.
- **Private IP is the right long-term shape.** Public IP + Auth Proxy is correct for launch but should be revisited at month-3. Filed.
- **Egress break-even is theoretical.** Finding 9 is *medium* confidence in the analysis report; the cache-miss number that triggered this plan is real, but the $230/mo upside is modeled, not measured. Validate at 50-state by reading the GCP billing line item for `network-egress-from-us-west1-to-internet` at month+1 post-launch.
- **No dual-write.** If product requirements shift to require zero-downtime cutover, the strategy changes to `pglogical` subscription + dual-write window, which is a 3× wall-time plan rewrite. Surfaced here so the choice is explicit.

## Methodology

This plan was produced by a single-session pass: (1) read `analysis-report.md` Finding 9 + Recommendations 2A/2B; (2) read `cache-hit-ratio.md` (the trigger); (3) inventory current Neon Terraform shape (`db.tf`, `read-api.tf`, references in `ingestor.tf` / `admin-api.tf`); (4) verify `hashicorp/google` provider attribute names via context7 for `google_sql_database_instance`, `google_sql_database`, `google_sql_user`, and the Cloud Run v2 `cloud_sql_instance` volume mount; (5) cross-reference the existing migration-plan template (`docs/plans/2026-05-03-cloudflare-provider-v5-migration.md`) for commit-sequence + rollback voice. No critic pass was run; the plan is single-author and benefits from a review pass before execution.
