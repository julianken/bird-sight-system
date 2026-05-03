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

# ── R2 (Cloudflare) credentials for the photos ingest job ────────────────
#
# The photos kind (run-photos.ts) downloads iNaturalist images and PUTs them
# into the `birdwatch-photos` R2 bucket via the S3-compatible endpoint. R2
# credentials are minted in the Cloudflare R2 dashboard (account-scoped
# access keys) and live outside Terraform's reach — we declare the secret
# resources here, but values are populated out-of-band post-`terraform apply`
# via `gcloud secrets versions add`. This keeps R2 keys off `terraform.tfvars`
# and out of any plan/state JSON exfiltrated to CI logs. Same shape as
# `ebird_key` minus the `_version` resource (which would require the value
# at apply time via a `var.*`).
resource "google_secret_manager_secret" "r2_endpoint" {
  secret_id = "bird-watch-r2-endpoint"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "r2_access_key_id" {
  secret_id = "bird-watch-r2-access-key-id"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "r2_secret_access_key" {
  secret_id = "bird-watch-r2-secret-access-key"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "ingestor_r2_endpoint" {
  secret_id = google_secret_manager_secret.r2_endpoint.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_secret_manager_secret_iam_member" "ingestor_r2_access_key_id" {
  secret_id = google_secret_manager_secret.r2_access_key_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_secret_manager_secret_iam_member" "ingestor_r2_secret_access_key" {
  secret_id = google_secret_manager_secret.r2_secret_access_key.id
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

# ── Photos ingest job (issue #327) ───────────────────────────────────────
#
# Separate Cloud Run Job because the photos kind needs a 600s timeout to
# walk ~344 species × (iNat fetch + R2 PUT). The other kinds (recent,
# backfill, hotspots, taxonomy) finish well within 300s and are tuned for
# that ceiling — bumping the shared job's timeout would mask runtime
# regressions in the eBird-driven kinds. Mirrors the .ingestor job's shape
# (image, env, lifecycle.ignore_changes) so deploy-ingestor.yml's image-tag
# rollout reaches both jobs from a single Artifact Registry push.
resource "google_cloud_run_v2_job" "ingestor_photos" {
  name     = "bird-ingestor-photos"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingestor.email
      timeout         = "600s"
      max_retries     = 1

      containers {
        image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/ingestor:latest"

        # CLI takes the kind as positional arg; Scheduler override below sets it
        # to "photos", but the baked-in default keeps a manual `gcloud run jobs
        # execute bird-ingestor-photos` working without overrides.
        args = ["photos"]

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
      }
    }
  }

  # Same rationale as .ingestor: deploy-ingestor.yml rolls the image tag,
  # Terraform must not reconcile it back to :latest on every apply.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.ingestor_db,
    google_secret_manager_secret_iam_member.ingestor_ebird,
    google_secret_manager_secret_iam_member.ingestor_r2_endpoint,
    google_secret_manager_secret_iam_member.ingestor_r2_access_key_id,
    google_secret_manager_secret_iam_member.ingestor_r2_secret_access_key,
  ]
}

# Same role + same scheduler SA as `.scheduler_invoke` — Scheduler still uses
# containerOverrides to pin args=["photos"] (matches the bake-in default but
# is explicit at the cron-call site), which routes through runWithOverrides.
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke_photos" {
  name     = google_cloud_run_v2_job.ingestor_photos.name
  location = google_cloud_run_v2_job.ingestor_photos.location
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  # v2 endpoint for the photos-only job — separate URL because the path
  # includes the job name, not the project + location alone.
  job_run_url_photos = "https://run.googleapis.com/v2/projects/${var.gcp_project_id}/locations/${var.gcp_region}/jobs/${google_cloud_run_v2_job.ingestor_photos.name}:run"
}

# Monthly photos refresh. iNat photos rotate slowly (license drift, better
# observations getting voted up) so monthly is the right cadence — matches the
# taxonomy cron (also monthly) but offset by one hour to avoid concurrent
# load on Neon's connection pool. ingest_taxonomy fires at 06:00 UTC on the
# 1st; photos fires at 07:00 UTC on the 1st.
resource "google_cloud_scheduler_job" "ingest_photos" {
  name      = "bird-ingest-photos"
  region    = var.gcp_region
  schedule  = "0 7 1 * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url_photos
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["photos"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}

# ── Descriptions ingest job (issue #371) ────────────────────────────────────
#
# Separate Cloud Run Job because the descriptions kind needs a 1800s timeout
# to walk ~344 species × (iNat /v1/taxa fetch + Wikipedia REST summary fetch
# + DOMPurify sanitize + DB write) at the documented 1 rps pace. The Wikipedia
# REST API recommends pacing requests; iNat's recommended-practices doc asks
# for ~100 rpm. At 1 rps the wall-clock budget is ~344s for the round-trips
# plus per-request fetch + sanitize work; 1800s leaves comfortable headroom
# for retry-after-429 backoffs and steady-state 304 cache hits that would
# pull the budget down further on subsequent runs.
#
# Mirrors the photos job's secret-env wiring shape verbatim. Cloudflare zone
# id and API token are NEW secrets — they're consumed by the cache-purge
# fork inside run-descriptions.ts when DESCRIPTIONS_PURGE_CACHE=1, which is
# off by default in tests but on in the Cloud Run env. The /api/species/*
# prefix is the cache surface the descriptions write affects (species-meta
# route at services/read-api/src/app.ts).
resource "google_secret_manager_secret" "cloudflare_zone_id" {
  secret_id = "bird-watch-cloudflare-zone-id"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret" "cloudflare_api_token" {
  secret_id = "bird-watch-cloudflare-api-token"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "ingestor_cloudflare_zone_id" {
  secret_id = google_secret_manager_secret.cloudflare_zone_id.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_secret_manager_secret_iam_member" "ingestor_cloudflare_api_token" {
  secret_id = google_secret_manager_secret.cloudflare_api_token.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

resource "google_cloud_run_v2_job" "ingestor_descriptions" {
  name     = "bird-ingestor-descriptions"
  location = var.gcp_region

  template {
    template {
      service_account = google_service_account.ingestor.email
      timeout         = "1800s"
      max_retries     = 1

      containers {
        image = "${google_artifact_registry_repository.birdwatch.location}-docker.pkg.dev/${var.gcp_project_id}/${google_artifact_registry_repository.birdwatch.repository_id}/ingestor:latest"

        # CLI takes the kind as positional arg; Scheduler override below sets
        # it to "descriptions", but the baked-in default keeps a manual
        # `gcloud run jobs execute bird-ingestor-descriptions` working without
        # overrides.
        args = ["descriptions"]

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
        # The cache-purge fork in run-descriptions.ts consumes these two when
        # DESCRIPTIONS_PURGE_CACHE=1. When the script is shipped --dry-run
        # only (the conservative initial state), the secrets are still
        # present but the script exits 0 without calling Cloudflare's API.
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
          name  = "DESCRIPTIONS_PURGE_CACHE"
          value = "1"
        }
      }
    }
  }

  # Same rationale as .ingestor: deploy-ingestor.yml rolls the image tag,
  # Terraform must not reconcile it back to :latest on every apply.
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image]
  }

  depends_on = [
    google_project_service.run,
    google_secret_manager_secret_iam_member.ingestor_db,
    google_secret_manager_secret_iam_member.ingestor_ebird,
    google_secret_manager_secret_iam_member.ingestor_cloudflare_zone_id,
    google_secret_manager_secret_iam_member.ingestor_cloudflare_api_token,
  ]
}

# Same role + same scheduler SA as the other invoke bindings — Scheduler uses
# containerOverrides to pin args=["descriptions"], routing through
# runWithOverrides.
resource "google_cloud_run_v2_job_iam_member" "scheduler_invoke_descriptions" {
  name     = google_cloud_run_v2_job.ingestor_descriptions.name
  location = google_cloud_run_v2_job.ingestor_descriptions.location
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.scheduler.email}"
}

locals {
  # v2 endpoint for the descriptions-only job — separate URL because the path
  # includes the job name, not the project + location alone.
  job_run_url_descriptions = "https://run.googleapis.com/v2/projects/${var.gcp_project_id}/locations/${var.gcp_region}/jobs/${google_cloud_run_v2_job.ingestor_descriptions.name}:run"
}

# Daily descriptions refresh at 08:00 UTC. Wikipedia pages drift slowly but
# are edited daily across a population of 344 species; a daily cadence keeps
# the cached body fresh without bombarding Wikipedia's REST API. Offset from
# the photos cron (which fires monthly at 07:00 UTC on the 1st) so the two
# never overlap on Neon's connection pool. The conditional-GET ETag in
# species_descriptions makes most days a sequence of fast 304s — the cron
# spends real wall-clock budget only on the species that changed since the
# last run.
resource "google_cloud_scheduler_job" "ingest_descriptions" {
  name      = "bird-ingest-descriptions"
  region    = var.gcp_region
  schedule  = "0 8 * * *"
  time_zone = "Etc/UTC"

  http_target {
    uri         = local.job_run_url_descriptions
    http_method = "POST"
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = {
        containerOverrides = [{ args = ["descriptions"] }]
      }
    }))
    oauth_token {
      service_account_email = google_service_account.scheduler.email
    }
  }

  depends_on = [google_project_service.scheduler]
}
