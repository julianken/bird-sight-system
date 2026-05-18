# ── Daily health digest (issue #643) ─────────────────────────────────────────
#
# Cloud Run Job `bird-digest-daily` invoked once per day at 09:00 UTC by Cloud
# Scheduler. Composes a 5-signal health digest (ingest_runs counts, read-api
# p95, Cloud SQL CPU, freshness, top errors) and ships it to the operator's
# inbox via SendGrid. Heartbeat is gated on delivery confirmation per analysis
# report §F7: SendGrid/SMTP can reject for SPF/DKIM/DMARC drift even when the
# function returns 200, and the negative-space surveillance requires the
# heartbeat to actually confirm delivery — not function-success.
#
# Why a Cloud Run Job (not a Cloud Function gen2): the digest re-uses the
# `bird-ingestor` container image — the digest CLI kind lives at
# services/ingestor/src/cli.ts ("digest") and depends on the same db-client +
# pool wiring. A Cloud Run Job is the same shape as `bird-ingestor-prune`
# (single-purpose scheduled) and keeps the deploy pipeline uniform (one
# Artifact Registry push, every job picks up the new image tag via the
# ignore_changes lifecycle dance documented on the other jobs).
#
# Sender-authentication discipline lives in docs/runbooks/monitoring.md#digest.
# DNS records for bird-maps.com (SPF, 2× DKIM CNAMEs, DMARC) MUST be populated
# out-of-band; Terraform declares the SendGrid API key secret but NOT the
# value — the operator populates the value via `gcloud secrets versions add`
# post-apply. Same pattern as R2 credentials in ingestor.tf.

# SendGrid API key. Value populated out-of-band:
#   gcloud secrets versions add bird-watch-sendgrid-api-key \
#     --project=bird-maps-prod --data-file=- < /path/to/sendgrid-key
# Terraform never sees the value; rotating is a one-liner via the same command.
resource "google_secret_manager_secret" "sendgrid_api_key" {
  secret_id = "bird-watch-sendgrid-api-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "ingestor_sendgrid_api_key" {
  secret_id = google_secret_manager_secret.sendgrid_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_cloud_run_v2_job" "ingestor_digest" {
  name     = "bird-digest-daily"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingestor.email
      # Digest finishes in seconds at steady state (one DB query, one
      # Monitoring API call, one SendGrid POST). 300s is the same defensive
      # ceiling carried by the prune job — comfortably above the steady-state
      # wall-clock and short enough that a stuck SendGrid retry loop fails
      # within a single cron interval (24h).
      timeout     = "300s"
      max_retries = 1

      containers {
        image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/ingestor:latest"

        # CLI kind is `digest`. Scheduler override below sets the same arg
        # explicitly so a `gcloud run jobs execute bird-digest-daily` manual
        # invoke also works without overrides.
        args = ["digest"]

        resources {
          limits = { cpu = "1", memory = "512Mi" }
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
        # EBIRD_API_KEY is not required for digest, but cli.ts enforces a
        # uniform env contract across kinds — keeping the same secret wired
        # here matches the prune job's pattern and avoids a one-off branch
        # in the CLI's env-guard logic.
        env {
          name = "EBIRD_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.ebird_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name = "SENDGRID_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.sendgrid_api_key.secret_id
              version = "latest"
            }
          }
        }
        env {
          name  = "DIGEST_EMAIL_RECIPIENT"
          value = var.alert_email
        }
        env {
          name  = "DIGEST_FROM_ADDRESS"
          value = "digest@${var.domain}"
        }
        # Healthchecks.io URL for the digest kind. The for_each in
        # monitoring.tf includes "digest" in `local.healthchecks_kinds`,
        # which auto-generates the secret + IAM binding — we just consume
        # it here.
        env {
          name = "HEALTHCHECKS_URL_DIGEST"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.healthchecks_url["digest"].secret_id
              version = "latest"
            }
          }
        }

        # Cloud SQL Auth Proxy socket mount — matches the pattern on the
        # other 4 ingestor jobs. Digest queries ingest_runs via DATABASE_URL
        # which routes through the proxy.
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
  }

  # Same rationale as the other ingestor jobs: deploy-ingestor.yml rolls the
  # image tag, Terraform must not reconcile it back to :latest on every apply.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.ingestor_db,
    google_secret_manager_secret_iam_member.ingestor_ebird,
    google_secret_manager_secret_iam_member.ingestor_sendgrid_api_key,
    google_secret_manager_secret_iam_member.ingestor_healthchecks,
  ]
}

# Same role + same scheduler SA as the other invoke bindings — Scheduler uses
# containerOverrides to pin args=["digest"] (matches the bake-in default but
# is explicit at the cron-call site), which routes through runWithOverrides.
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke_digest" {
  name     = google_cloud_run_v2_job.ingestor_digest.name
  location = google_cloud_run_v2_job.ingestor_digest.location
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  # v2 endpoint for the digest-only job — separate URL because the path
  # includes the job name, not the project + location alone.
  job_run_url_digest = "https://run.googleapis.com/v2/projects/${var.gcp_project_id}/locations/${var.gcp_region}/jobs/${google_cloud_run_v2_job.ingestor_digest.name}:run"
}

# Daily digest at 09:00 UTC. 09:00 UTC = 02:00 MST (Arizona, no DST) — sits
# in the middle of the operator's low-engagement window so the inbox notification
# lands when daily ingest activity has already happened (recent at 09:30 UTC is
# the next tick after the digest fires, but the previous 24h are fully captured).
resource "google_cloud_scheduler_job" "ingest_digest" {
  name      = "bird-ingest-digest"
  region    = var.gcp_region
  schedule  = "0 9 * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url_digest
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["digest"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}
