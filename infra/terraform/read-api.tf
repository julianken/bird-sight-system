# Store the read-api DATABASE_URL in Secret Manager so we don't ship it in plain env.
resource "google_secret_manager_secret" "db_url" {
  secret_id = "bird-watch-db-url"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

# Read path runs against Cloud SQL via the pooled URL exposed in cloud-sql.tf.
# T4 (2026-05-18) flipped read-api from Neon → Cloud SQL; T5 (this change)
# decommissions Neon entirely, dropping SECONDARY_DATABASE_URL fan-out and the
# Neon provider.
resource "google_secret_manager_secret_version" "db_url" {
  secret      = google_secret_manager_secret.db_url.id
  secret_data = local.cloudsql_pooled_url
}

# Service account the Read API runs as.
resource "google_service_account" "read_api" {
  account_id   = "bird-read-api"
  display_name = "bird-watch Read API"
}

resource "google_secret_manager_secret_iam_member" "read_api_db" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.read_api.email}"
}

resource "google_cloud_run_v2_service" "read_api" {
  name     = "bird-read-api"
  location = var.gcp_region

  template {
    service_account = google_service_account.read_api.email

    scaling {
      min_instance_count = 0 # true scale-to-zero
      max_instance_count = 5
    }

    containers {
      image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/read-api:latest"

      ports { container_port = 8080 }

      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = true # CPU only allocated during requests (cheaper)
        startup_cpu_boost = true # quicker cold starts
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.db_url.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "FRONTEND_ORIGINS"
        value = var.frontend_origins
      }

      # Layer-3 (Hono token-bucket) rate limit is opt-in via env so the e2e
      # suite (which boots the read-api locally and hammers it from a single
      # 127.0.0.1 worker pool) is not throttled. Cloud Run sets it true; local
      # dev and CI leave it unset. NODE_ENV=production also enables it as a
      # safety net.
      env {
        name  = "RATE_LIMIT_ENABLED"
        value = "true"
      }

      # Cloud SQL Auth Proxy socket mount — Stage 2 of the Neon→Cloud SQL
      # migration (docs/plans/2026-05-17-cloud-sql-migration.md §3.2). The
      # mount is purely additive: DATABASE_URL still points at Neon, so the
      # socket sits unused at /cloudsql/<connection_name>/.s.PGSQL.5432 until
      # Stage 3 flips the secret. This unblocks the cutover without a code
      # or image change — a Stage-3 Secret Manager version bump is all it
      # takes to switch traffic.
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.birdwatch.connection_name]
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # The image tag is rolled forward by .github/workflows/deploy-read-api.yml
  # (Cloud Run service update on every push to main touching read-api).
  # Without this, `terraform apply` would revert the service to the :latest
  # tag pinned above and silently roll back the CD deploy.
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.read_api_db,
  ]
}

# Allow public access (CDN sits in front).
resource "google_cloud_run_v2_service_iam_member" "read_api_public" {
  name     = google_cloud_run_v2_service.read_api.name
  location = google_cloud_run_v2_service.read_api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "read_api_url" {
  value = google_cloud_run_v2_service.read_api.uri
}
