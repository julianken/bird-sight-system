# Cloud SQL Postgres 16 instance, collocated with read-api / ingestor in us-west1.
# Justification: docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md
# Finding 9 — Cloudflare cache-miss 99.91% (30d) flips egress sign by ~$230/mo at 50-state.
#
# Stage 1 of docs/plans/2026-05-17-cloud-sql-migration.md (T1):
# provisions the Cloud SQL instance ALONGSIDE the existing Neon project. No
# traffic cuts over in this PR — Neon remains the live DB. The cutover (secret
# version flip) is a separate, explicitly user-gated PR.

resource "google_project_service" "sqladmin" {
  service            = "sqladmin.googleapis.com"
  disable_on_destroy = false
}

resource "random_password" "cloudsql_app_user" {
  length  = 32
  special = false # Cloud SQL Postgres tolerates symbols but pg connection strings need URL-encoding;
  # a 32-char alnum is >190 bits of entropy and dodges the encoding hazard entirely.
  #
  # Rotation: `terraform apply -replace=random_password.cloudsql_app_user`
  # then re-apply to push the new value through google_sql_user.app and the
  # downstream Secret Manager version. (`terraform taint` was deprecated in
  # Terraform 1.6 — see versions.tf for the pin.)
}

resource "google_sql_database_instance" "birdwatch" {
  name             = "birdwatch-pg16"
  database_version = "POSTGRES_16"
  region           = var.gcp_region # us-west1

  deletion_protection = true

  settings {
    edition               = "ENTERPRISE" # db-g1-small is invalid under ENTERPRISE_PLUS (the GCP default for new instances)
    tier                  = "db-g1-small"
    availability_type     = "ZONAL" # single-zone; flip to REGIONAL later if traffic warrants
    disk_type             = "PD_SSD"
    disk_size             = 10
    disk_autoresize       = true
    disk_autoresize_limit = 50

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "09:00" # UTC = 02:00 America/Phoenix; off-peak
      transaction_log_retention_days = 7
      backup_retention_settings {
        retained_backups = 7
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
      # No `authorized_networks` blocks — services use Cloud SQL Auth Proxy
      # via the cloud_sql_instance volume mount; no IP-based access path exists.
    }

    database_flags {
      name = "max_connections"
      # Sized for stage-3 cutover overlap window where both Neon and Cloud Run
      # generations may be live simultaneously. Budget:
      #   read-api   max_instance_count=5 × pg Pool max=5  = 25
      #   admin-api  max_instance_count=2 × pg Pool max=5  = 10
      #   ingestor   Cloud Run job, ~5 concurrent          =  5
      #   cutover overlap (double-stack during T3 flip)   ≈ 40
      #   cloudsqlsuperuser/admin sessions + headroom     ≈ 20
      # Total ~100. Cloud SQL `db-g1-small` default is 50 (memory-tier based);
      # 100 is the next reasonable step without bumping tier. If Cloud Run
      # max-instances or pg Pool `max` ever moves, re-derive this number.
      value = "100"
    }

    insights_config {
      query_insights_enabled  = true
      record_application_tags = false
      record_client_address   = false
    }

    maintenance_window {
      day          = 7  # Sunday
      hour         = 10 # 10:00 UTC = 03:00 America/Phoenix
      update_track = "stable"
    }
  }

  depends_on = [google_project_service.sqladmin]
}

resource "google_sql_database" "birdwatch" {
  name     = "birdwatch"
  instance = google_sql_database_instance.birdwatch.name
}

# PostGIS extension enablement.
#
# Cloud SQL Postgres does NOT auto-install PostGIS, and there is no
# `database_flag` that toggles it — extensions are runtime objects, not
# instance config. We deliberately do NOT use a `null_resource` +
# `local-exec` to run `gcloud sql connect` here: that path requires
# temporarily mutating `authorized_networks` with the operator's IP, which
# conflicts with the Auth-Proxy-only access model declared in
# `ip_configuration` above (no `authorized_networks` blocks, by design).
#
# Therefore PostGIS is an explicit operator step, run ONCE before stage-T3
# (`pg_restore` Neon → Cloud SQL). The dump references PostGIS types
# (`geometry`), GiST indexes, and PostGIS functions; without the extension
# pre-created the restore fails.
#
# Operator runbook (run from a host with gcloud auth and project=bird-maps-prod):
#
#   # 1. Briefly add operator IP to enable an admin connection.
#   gcloud sql instances patch birdwatch-pg16 \
#     --authorized-networks="$(curl -s ifconfig.me)/32"
#
#   # 2. Create PostGIS as the `postgres` superuser (auto-created by Cloud SQL).
#   gcloud sql connect birdwatch-pg16 --user=postgres --database=birdwatch \
#     --quiet <<'SQL'
#   CREATE EXTENSION IF NOT EXISTS postgis;
#   SELECT postgis_full_version();
#   SQL
#
#   # 3. Remove the operator IP — return to Auth-Proxy-only access.
#   gcloud sql instances patch birdwatch-pg16 --clear-authorized-networks
#
# Verification (also runs as plan §4.1 pre-flight): `postgis_full_version()`
# must return a row before T3 (`pg_dump | pg_restore`) is permitted.
# Tracked in docs/plans/2026-05-17-cloud-sql-migration.md §T3 prerequisites.

resource "google_sql_user" "app" {
  name     = "birdwatch_app"
  instance = google_sql_database_instance.birdwatch.name
  password = random_password.cloudsql_app_user.result
}

locals {
  # Cloud SQL Auth Proxy unix socket path inside Cloud Run's cloud_sql_instance volume mount.
  # Format documented at cloud.google.com/sql/docs/postgres/connect-run.
  cloudsql_socket_dir = "/cloudsql/${google_sql_database_instance.birdwatch.connection_name}"

  # libpq accepts `host=/path` to use a unix socket. The Cloud SQL Auth Proxy
  # sidecar (mounted via the `cloud_sql_instance` volume on Cloud Run) listens
  # at /cloudsql/<connection_name>/.s.PGSQL.5432.
  cloudsql_pooled_url = "postgres://${google_sql_user.app.name}:${random_password.cloudsql_app_user.result}@/${google_sql_database.birdwatch.name}?host=${local.cloudsql_socket_dir}"
}

output "cloudsql_connection_name" {
  value = google_sql_database_instance.birdwatch.connection_name
}

output "cloudsql_db_url" {
  value     = local.cloudsql_pooled_url
  sensitive = true
}

# ── Cloud SQL connection-string secret ────────────────────────────────────
#
# Wraps `local.cloudsql_pooled_url` in Secret Manager so services running on
# Cloud Run can mount it as `SECONDARY_DATABASE_URL` (the dual-write env var
# the admin-api and ingestor read during Stage 2 of the Neon→Cloud SQL
# migration). The same secret is referenced from `admin-api.tf` and
# `ingestor.tf`; the parallel ingestor PR may create this resource first —
# whichever PR lands second should drop this block in rebase.
resource "google_secret_manager_secret" "cloudsql_db_url" {
  secret_id = "bird-watch-cloudsql-db-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "cloudsql_db_url" {
  secret      = google_secret_manager_secret.cloudsql_db_url.id
  secret_data = local.cloudsql_pooled_url
}
