# ── Admin API (#502) — silhouette override service ──────────────────────
#
# Cloud Run service that accepts bearer-token-authenticated PUT/DELETE
# requests to override the Phylopic-curated default silhouette for any
# family. Uploads SVGs to the bird-maps-silhouettes R2 bucket (via the
# S3-compatible endpoint), updates family_silhouettes in Neon, and purges
# the /api/silhouettes JSON cache on Cloudflare.
#
# Mirrors read-api.tf's resource shape (Cloud Run v2 + secret-bound env
# vars + allUsers invoker). Reuses existing secrets (bird-watch-db-url,
# bird-watch-r2-*, bird-watch-cloudflare-*) and adds one new secret
# (bird-watch-admin-api-token) for the bearer token.

# ── Bearer-token secret ──────────────────────────────────────────────────
#
# Initial version is added out-of-band post-apply via:
#   echo "$(openssl rand -hex 32)" | gcloud secrets versions add \
#       bird-watch-admin-api-token --data-file=- --project=<gcp_project_id>
# See docs/runbooks/silhouette-override.md.
resource "google_secret_manager_secret" "admin_api_token" {
  secret_id = "bird-watch-admin-api-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

# ── Service account ──────────────────────────────────────────────────────
resource "google_service_account" "admin_api" {
  account_id   = "bird-admin-api"
  display_name = "bird-watch Admin API (#502)"
}

# ── Secret-accessor IAM bindings ────────────────────────────────────────
resource "google_secret_manager_secret_iam_member" "admin_api_db" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_token" {
  secret_id = google_secret_manager_secret.admin_api_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_r2_endpoint" {
  secret_id = google_secret_manager_secret.r2_endpoint.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_r2_access_key_id" {
  secret_id = google_secret_manager_secret.r2_access_key_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_r2_secret_access_key" {
  secret_id = google_secret_manager_secret.r2_secret_access_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_cloudflare_zone_id" {
  secret_id = google_secret_manager_secret.cloudflare_zone_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

resource "google_secret_manager_secret_iam_member" "admin_api_cloudflare_api_token" {
  secret_id = google_secret_manager_secret.cloudflare_api_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.admin_api.email}"
}

# ── Cloud Run service ───────────────────────────────────────────────────
resource "google_cloud_run_v2_service" "admin_api" {
  name     = "bird-admin-api"
  location = var.gcp_region

  template {
    service_account = google_service_account.admin_api.email

    scaling {
      min_instance_count = 0 # true scale-to-zero — operator-only traffic
      max_instance_count = 2 # admin endpoints serialize: low ceiling
    }

    containers {
      image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/admin-api:latest"

      ports { container_port = 8080 }

      resources {
        limits            = { cpu = "1", memory = "256Mi" }
        cpu_idle          = true
        startup_cpu_boost = true
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
        name = "ADMIN_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.admin_api_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "R2_ENDPOINT"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.r2_endpoint.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "R2_ACCESS_KEY_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.r2_access_key_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "R2_SECRET_ACCESS_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.r2_secret_access_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "R2_BUCKET_NAME"
        value = cloudflare_r2_bucket.silhouettes.name
      }

      env {
        name  = "SILHOUETTES_PUBLIC_PREFIX"
        value = "https://silhouettes.${var.domain}"
      }

      env {
        name = "CLOUDFLARE_ZONE_ID"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cloudflare_zone_id.secret_id
            version = "latest"
          }
        }
      }

      env {
        name = "CLOUDFLARE_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.cloudflare_api_token.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "API_HOST"
        value = "api.${var.domain}"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  # The image tag is rolled forward by .github/workflows/deploy-admin-api.yml
  # on every push to main touching admin-api. Without this, `terraform apply`
  # would revert the service to the :latest tag pinned above and silently
  # roll back the CD deploy. Same pattern as read-api.tf.
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.admin_api_db,
    google_secret_manager_secret_iam_member.admin_api_token,
    google_secret_manager_secret_iam_member.admin_api_r2_endpoint,
    google_secret_manager_secret_iam_member.admin_api_r2_access_key_id,
    google_secret_manager_secret_iam_member.admin_api_r2_secret_access_key,
    google_secret_manager_secret_iam_member.admin_api_cloudflare_zone_id,
    google_secret_manager_secret_iam_member.admin_api_cloudflare_api_token,
  ]
}

# Allow public access — the bearer-token middleware is the gate, not Cloud
# Run IAM. Same posture as read-api: a CDN sits in front (eventually) but
# the bearer token is the real auth boundary. The runbook is explicit that
# the token must be rotated on leak.
resource "google_cloud_run_v2_service_iam_member" "admin_api_public" {
  name     = google_cloud_run_v2_service.admin_api.name
  location = google_cloud_run_v2_service.admin_api.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "admin_api_url" {
  value = google_cloud_run_v2_service.admin_api.uri
}
