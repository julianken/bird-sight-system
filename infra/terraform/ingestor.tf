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

  # Once .github/workflows/deploy-ingestor.yml takes over image rollouts, Terraform
  # must stop reconciling the image tag back to :latest on every apply. Jobs wrap
  # the pod template in an execution template, hence the double template[0] —
  # different from google_cloud_run_v2_service which uses single template[0].
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
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

# The scheduler job body sends containerOverrides (to pick the CLI subcommand —
# "recent", "backfill", "hotspots", "taxonomy" — on a single shared image), so
# the API call is run.jobs.runWithOverrides, not run.jobs.run. roles/run.invoker
# grants only the latter and 403s the former; roles/run.jobsExecutorWithOverrides
# is the predefined role that grants both. See issue #106.
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke" {
  name     = google_cloud_run_v2_job.ingestor.name
  location = google_cloud_run_v2_job.ingestor.location
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

# Scheduler's http_target uses oauth_token { service_account_email = scheduler }.
# Before the HTTP call fires, the Cloud Scheduler service agent must mint an
# OAuth token on behalf of that SA — which requires tokenCreator on the SA
# itself. Without this binding the request 403s before reaching Cloud Run, so
# the invoker-side bindings above never come into play. See issue #106.
data "google_project" "current" {}

resource "google_service_account_iam_member" "scheduler_token_creator" {
  service_account_id = google_service_account.scheduler.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:service-${data.google_project.current.number}@gcp-sa-cloudscheduler.iam.gserviceaccount.com"
}

locals {
  # Cloud Run Jobs v2 REST endpoint. v2 is the current API surface for
  # google_cloud_run_v2_job and uses a cleaner path than the v1 Knative
  # alias (/apis/run.googleapis.com/v1/namespaces/...).
  job_run_url = "https://run.googleapis.com/v2/projects/${var.gcp_project_id}/locations/${var.gcp_region}/jobs/${google_cloud_run_v2_job.ingestor.name}:run"
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

# Monthly refresh of species_meta from eBird's taxonomy endpoint. eBird ships a
# new taxonomy version yearly, so monthly is comfortably ahead of drift. After
# upsert, the job also reconciles region_id / silhouette_id across observations
# that lacked a species_meta row at original ingest time (the #83 fix path).
resource "google_cloud_scheduler_job" "ingest_taxonomy" {
  name      = "bird-ingest-taxonomy"
  region    = var.gcp_region
  schedule  = "0 6 1 * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["taxonomy"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}
