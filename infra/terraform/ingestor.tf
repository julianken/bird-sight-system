resource "google_service_account" "ingestor" {
  account_id   = "bird-ingestor"
  display_name = "bird-watch Ingestor"
}

resource "google_secret_manager_secret_iam_member" "ingestor_db" {
  secret_id = google_secret_manager_secret.db_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_secret_manager_secret" "ebird_key" {
  secret_id = "bird-watch-ebird-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_version" "ebird_key" {
  secret      = google_secret_manager_secret.ebird_key.id
  secret_data = var.ebird_api_key
}

resource "google_secret_manager_secret_iam_member" "ingestor_ebird" {
  secret_id = google_secret_manager_secret.ebird_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_cloud_run_v2_job" "ingestor" {
  name     = "bird-ingestor"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingestor.email
      timeout         = "300s"
      max_retries     = 1

      containers {
        image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/ingestor:latest"

        # Args are appended to ENTRYPOINT. CLI takes "recent" | "hotspots" | "backfill".
        args = ["recent"]

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
        env {
          name = "EBIRD_API_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.ebird_key.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.ingestor_db,
    google_secret_manager_secret_iam_member.ingestor_ebird,
  ]
}

# Service account that Scheduler uses to invoke the Job.
resource "google_service_account" "scheduler" {
  account_id   = "bird-scheduler"
  display_name = "bird-watch Cloud Scheduler invoker"
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke" {
  name     = google_cloud_run_v2_job.ingestor.name
  location = google_cloud_run_v2_job.ingestor.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  job_run_url = "https://${var.gcp_region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${var.gcp_project_id}/jobs/${google_cloud_run_v2_job.ingestor.name}:run"
}

# Three crons matching the spec: every 30 min, daily 4am UTC, weekly Sun 5am UTC.
resource "google_cloud_scheduler_job" "ingest_recent" {
  name      = "bird-ingest-recent"
  region    = var.gcp_region
  schedule  = "*/30 * * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["recent"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}

resource "google_cloud_scheduler_job" "ingest_backfill" {
  name      = "bird-ingest-backfill"
  region    = var.gcp_region
  schedule  = "0 4 * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["backfill"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}

resource "google_cloud_scheduler_job" "ingest_hotspots" {
  name      = "bird-ingest-hotspots"
  region    = var.gcp_region
  schedule  = "0 5 * * 0"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["hotspots"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}
