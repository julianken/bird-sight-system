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
}

resource "google_sql_database_instance" "birdwatch" {
  name             = "birdwatch-pg16"
  database_version = "POSTGRES_16"
  region           = var.gcp_region # us-west1

  deletion_protection = true

  settings {
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
      name  = "max_connections"
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
