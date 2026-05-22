# ── Notification channels ────────────────────────────────────────────────
#
# Single subscriber for v1: julian.kennon.d@gmail.com. SMS, PagerDuty, Slack
# are future iterations. The channel resource is provisioned via Terraform so
# every alert policy below can reference it without click-ops drift.
#
# Plan: docs/plans/2026-05-17-monitoring-and-alerts.md

resource "google_monitoring_notification_channel" "email_julian" {
  display_name = "Julian (email)"
  type         = "email"
  labels       = { email_address = var.alert_email }
}

# ── Healthchecks.io secret manifests ─────────────────────────────────────
#
# One Secret Manager secret per cron. Values are populated out-of-band:
#   gcloud secrets versions add bird-watch-healthchecks-recent \
#     --project=bird-maps-prod --data-file=- <<< "https://hc-ping.com/<uuid>"
# Terraform declares the secret + IAM binding; the URL itself never lands
# in tfvars or state. Mirrors the R2-credentials pattern in ingestor.tf.

locals {
  # "digest" is the daily health-digest cron (issue #643) — single send at
  # 09:00 UTC, heartbeat fires when the digest is NOT delivered. Gated on
  # SendGrid 2xx (analysis report §F7); a sender-auth misconfig that lets
  # SendGrid accept but Gmail reject will still trip the heartbeat eventually
  # (no ping = HC alarms), but a tighter delivery-webhook gate is a follow-up.
  healthchecks_kinds = ["recent", "backfill", "hotspots", "taxonomy", "photos", "descriptions", "prune", "digest", "cache-warm"]
}

resource "google_secret_manager_secret" "healthchecks_url" {
  for_each  = toset(local.healthchecks_kinds)
  secret_id = "bird-watch-healthchecks-${each.key}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.secretmanager]
}

resource "google_secret_manager_secret_iam_member" "ingestor_healthchecks" {
  for_each  = google_secret_manager_secret.healthchecks_url
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.ingestor.email}"
}

# ── S1: Ingest job non-zero exit ─────────────────────────────────────────
#
# Threshold: ≥1 failed execution in rolling 1h.
# Rationale: ingestor sets process.exitCode=1 on RunSummary.status==='failure'
# (services/ingestor/src/cli.ts). The "42 silent failures" finding from
# docs/analyses/2026-05-14-process-scale-options/phase-4 motivates this. 1h
# window matches the */30 recent-ingest cron — sub-hour is below sampling
# resolution; multi-hour delays the page past one full cron interval.

resource "google_monitoring_alert_policy" "ingest_job_failure" {
  display_name          = "Ingest job non-zero exit (S1)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "Cloud Run Job execution failed in last 1h"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/job/completed_execution_count\" AND resource.type=\"cloud_run_job\" AND metric.label.result=\"failed\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period   = "3600s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "604800s" # 7d — auto-closes after a week of no re-fire
  }
}

# ── S2: Data staleness (freshestObservationAt > 6h) ──────────────────────
#
# Threshold: 6h. Rationale: recent-ingest cron is */30; eBird obs land within
# 5-15min of submission; AZ has sub-hour gaps. 6h staleness => ≥12 consecutive
# recent-ingest runs made zero forward progress on observation timestamps.
# Below 6h is noise (legitimate quiet hours mid-day); above 12h is too late.
#
# The metric source is a log-based metric extracted from a structured-log
# line emitted by the `/api/observations` handler — the endpoint that
# actually computes and returns `meta.freshestObservationAt`
# (services/read-api/src/app.ts). Task 5 lands the emit; the log-based metric
# below pulls the value out as a distribution, and the alert fires when the
# p95 over a 30min window exceeds 21600s (6h).

resource "google_logging_metric" "meta_freshness_seconds" {
  name   = "bird-meta-freshness-seconds"
  filter = "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\" AND jsonPayload.meta_freshness_seconds!=NULL_VALUE"
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "DISTRIBUTION"
    unit        = "s"
  }
  value_extractor = "EXTRACT(jsonPayload.meta_freshness_seconds)"
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 60
    }
  }
}

resource "google_monitoring_alert_policy" "data_staleness" {
  display_name          = "Data staleness > 6h (S2)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "freshestObservationAt older than 6h for 30min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/bird-meta-freshness-seconds\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 21600 # 6h in seconds
      duration        = "1800s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
}

# ── S3: Read-API 5xx rate > 1% over 5min, gated by ≥100 req/window ───────
#
# Threshold: >1% AND request_count ≥ 100 over the 5min window.
# Rationale: 1% is the canonical "bad day" threshold; on its own it fires
# constantly during low-traffic hours (1 error in 50 requests = 2%, fires).
# The 100-request floor (~20 req/min sustained over 5min) is the
# alert-fatigue gate. `denominator_filter` by itself produces a ratio but
# does NOT impose a minimum-volume floor on that ratio — to gate the
# alert on absolute traffic we combine TWO conditions via combiner = "AND":
#   (a) 5xx_rate > 1%  AND  (b) total_request_count > 100 over the window.
# Both conditions use the same 300s alignment, so the AND-combiner evaluates
# them coherently. At HN-scale launch traffic condition (b) is invisible;
# at 03:00 idle traffic it correctly suppresses the alert.

resource "google_monitoring_alert_policy" "read_api_5xx" {
  display_name          = "Read API 5xx rate > 1% (S3)"
  combiner              = "AND"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "5xx rate >1% over 5min"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\" AND metric.label.response_code_class=\"5xx\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.01
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
      # Ratio numerator/denominator. The denominator_filter expresses the
      # ratio; it does NOT impose a min-volume floor on its own — that's
      # the second condition below.
      denominator_filter = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
      denominator_aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }

  # Minimum-volume gate. Combined with the ratio condition via
  # combiner = "AND" above. Threshold is 100 requests over the 5min window,
  # expressed as a rate threshold: 100 req / 300s = 0.333 req/s.
  conditions {
    display_name = "request count >= 100 over 5min (min-volume floor)"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_count\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0.33 # 100 req / 300s — use 0.33 (not 0.333) so a window with exactly 100 evenly-spaced requests is unambiguously >= floor; GT 0.333 only passes 100/300s by 3.3e-5
      duration        = "300s"
      aggregations {
        alignment_period     = "300s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

# ── S4: Read-API p95 latency > 2000ms over 10min ─────────────────────────
#
# Threshold: 2000ms p95. Rationale: current p95 is 150-300ms; 2000ms is the
# "user tabs away" threshold. 10min smooths over cold-start spikes (scale-
# to-zero) without missing a real degradation.

resource "google_monitoring_alert_policy" "read_api_latency" {
  display_name          = "Read API p95 latency > 2s (S4)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "p95 > 2000ms over 10min"
    condition_threshold {
      filter          = "metric.type=\"run.googleapis.com/request_latencies\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"bird-read-api\""
      comparison      = "COMPARISON_GT"
      threshold_value = 2000
      duration        = "600s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_PERCENTILE_95"
        cross_series_reducer = "REDUCE_MAX"
      }
    }
  }
}

# ── S5: Cloud Run instance crash / OOM ───────────────────────────────────
#
# Log-based metric: counts severity>=ERROR messages matching the
# Cloud Run kill phrases. Threshold ≥1 in rolling 1h batches transient
# flaps into one notification.

resource "google_logging_metric" "container_crash" {
  name   = "bird-container-crash"
  filter = <<-EOT
    resource.type="cloud_run_revision" AND
    (resource.labels.service_name=~"bird-(read-api|ingestor.*)") AND
    severity>=ERROR AND
    (textPayload=~"Container terminated" OR textPayload=~"out of memory" OR textPayload=~"OOMKilled")
  EOT
  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

resource "google_monitoring_alert_policy" "container_crash" {
  display_name          = "Cloud Run container crash / OOM (S5)"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = ">=1 crash log in 1h"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/bird-container-crash\" AND resource.type=\"cloud_run_revision\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "0s"
      aggregations {
        alignment_period     = "3600s"
        per_series_aligner   = "ALIGN_SUM"
        cross_series_reducer = "REDUCE_SUM"
      }
    }
  }
}

# ── Uptime check on the public read-api ─────────────────────────────────
#
# Synthetic monitoring: GCP regions ping /health every 60s. Alert
# fires if regions fail for consecutive checks. Catches DNS / TLS /
# Cloud Run cold-fail issues that the request_count metric can't see
# (because by definition there are no requests landing).

resource "google_monitoring_uptime_check_config" "read_api" {
  display_name = "read-api /health"
  timeout      = "10s"
  period       = "60s"

  http_check {
    path           = "/health"
    port           = 443
    use_ssl        = true
    validate_ssl   = true
    request_method = "GET"
  }

  monitored_resource {
    type = "uptime_url"
    labels = {
      host       = "api.bird-maps.com"
      project_id = var.gcp_project_id
    }
  }
}

resource "google_monitoring_alert_policy" "read_api_uptime" {
  display_name          = "Read API uptime check failing"
  combiner              = "OR"
  notification_channels = [google_monitoring_notification_channel.email_julian.id]

  conditions {
    display_name = "uptime check failures over 3 consecutive checks"
    condition_threshold {
      filter = "metric.type=\"monitoring.googleapis.com/uptime_check/check_passed\" AND resource.type=\"uptime_url\" AND metric.label.check_id=\"${google_monitoring_uptime_check_config.read_api.uptime_check_id}\""
      # Intent: fire when the uptime check FAILS. REDUCE_COUNT_FALSE collapses
      # per-region check_passed=false values into a count of failing regions.
      # COMPARISON_GT against threshold 0 => fires when ≥1 region is failing.
      # (Previously COMPARISON_LT 1 against the same count meant "fire when
      # ZERO regions are failing" — inverted intent.)
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "180s"
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_NEXT_OLDER"
        cross_series_reducer = "REDUCE_COUNT_FALSE"
        group_by_fields      = ["resource.label.*"]
      }
      trigger {
        count = 2
      }
    }
  }
}

# ── Per-kind ingest completion counter ────────────────────────────────────
#
# Counter log-based metric extracted from the compact structured emit at
# services/ingestor/src/cli.ts:174 (`bird_ingest_run_completed`). Powers the
# Row 2.1 widget on the bird-watch overview dashboard
# (infra/terraform/monitoring-dashboard.tf).
#
# Emit-shape contract (must remain stable — see docs/runbooks/monitoring.md):
#   { message: "bird_ingest_run_completed", kind, status, duration_seconds }
# The two `!=NULL_VALUE` clauses drop malformed entries during a future
# emit-shape regression rather than landing garbage into the metric stream.

resource "google_logging_metric" "ingest_run_completed" {
  name = "bird-ingest-run-completed"
  filter = join(" AND ", [
    "resource.type=\"cloud_run_job\"",
    "resource.labels.job_name=~\"^bird-ingestor\"",
    "jsonPayload.message=\"bird_ingest_run_completed\"",
    "jsonPayload.kind!=NULL_VALUE",
    "jsonPayload.status!=NULL_VALUE",
  ])
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Ingest run completions by kind+status"
    labels {
      key         = "kind"
      value_type  = "STRING"
      description = "Ingest kind"
    }
    labels {
      key         = "status"
      value_type  = "STRING"
      description = "Terminal status"
    }
  }
  label_extractors = {
    "kind"   = "EXTRACT(jsonPayload.kind)"
    "status" = "EXTRACT(jsonPayload.status)"
  }
}

# ── Per-kind ingest duration distribution ─────────────────────────────────
#
# Distribution metric extracting `duration_seconds` from the same emit.
# Powers the Row 2.2 widget (p95 duration by kind). Bucket layout:
# exponential(scale=1, growth=2, finite=32) covers 1s..~4×10^9 s — comfortably
# spans the slowest ingest kind (`backfill-extended`, multi-hour) without
# wasting bucket density at the fast end.

resource "google_logging_metric" "ingest_run_duration_seconds" {
  name = "bird-ingest-run-duration-seconds"
  filter = join(" AND ", [
    "resource.type=\"cloud_run_job\"",
    "resource.labels.job_name=~\"^bird-ingestor\"",
    "jsonPayload.message=\"bird_ingest_run_completed\"",
    "jsonPayload.kind!=NULL_VALUE",
    "jsonPayload.duration_seconds!=NULL_VALUE",
  ])
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "DISTRIBUTION"
    unit         = "s"
    display_name = "Ingest run duration by kind"
    labels {
      key         = "kind"
      value_type  = "STRING"
      description = "Ingest kind"
    }
  }
  value_extractor = "EXTRACT(jsonPayload.duration_seconds)"
  label_extractors = {
    "kind" = "EXTRACT(jsonPayload.kind)"
  }
  bucket_options {
    exponential_buckets {
      num_finite_buckets = 32
      growth_factor      = 2
      scale              = 1
    }
  }
}

# ── Dashboard-opens audit (for 30-day stickiness review) ──────────────────
#
# Counts `monitoring.dashboards.get` audit-log calls; powers the audit
# follow-up that decides at T+30d whether the dashboard is being used (and
# at T+90d whether to kill it if quarterly opens ≤ 1). The resourceName
# clause narrows the count to OUR dashboard only — project-wide audit calls
# on other dashboards (alert-policy debugging, ad-hoc chart exploration) do
# not inflate the stickiness signal.

resource "google_logging_metric" "bird_watch_dashboard_opened" {
  name = "bird-watch-dashboard-opened"
  filter = join(" AND ", [
    "logName=~\"cloudaudit.googleapis.com\"",
    "protoPayload.methodName=\"monitoring.dashboards.get\"",
    "protoPayload.resourceName=~\"projects/.+/dashboards/a6aa8bcb-2849-4e8e-85ba-1ef38648947d\"",
  ])
  metric_descriptor {
    metric_kind  = "DELTA"
    value_type   = "INT64"
    unit         = "1"
    display_name = "Bird-watch dashboard opens (Cloud Audit)"
  }
}

# ── Enable Data Access audit logs for Cloud Monitoring ────────────────────
#
# Required for `monitoring.dashboards.get` to land in audit logs (Data Access
# audit logs are off by default for all GCP services). Marginal cost is ~$0
# against current monitoring traffic — dashboard reads are low-volume and
# count against the same audit-log ingest quota that admin-activity logs use.
# This must be paired with `google_logging_metric.bird_watch_dashboard_opened`
# above; the metric extracts events that this resource enables.

resource "google_project_iam_audit_config" "monitoring_data_read" {
  project = var.gcp_project_id
  service = "monitoring.googleapis.com"
  audit_log_config {
    log_type = "DATA_READ"
  }
}

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
#
# Type choice: DELTA INT64 (not DISTRIBUTION) so the dashboard's per-day
# ALIGN_SUM aggregation works. Sums of distributions are undefined in GCP
# Monitoring — DISTRIBUTION-typed metrics under ALIGN_SUM render "0 time
# series" on xyChart widgets. INT64/DELTA matches `bird-container-crash`
# and `bird-watch-dashboard-opened` above; the value_extractor pulls the
# scalar emit field straight onto the time series. The PR-697 bot review
# flagged this exact concern as a narrow non-blocking risk; this PR
# realizes the follow-up.

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
    value_type   = "INT64"
    unit         = "1"
    display_name = "Observations archived per day (rowCount)"
  }
  value_extractor = "EXTRACT(jsonPayload.rowCount)"
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
    value_type   = "INT64"
    unit         = "By"
    display_name = "Parquet bytes uploaded to GCS per day"
  }
  value_extractor = "EXTRACT(jsonPayload.bytesUploaded)"
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
    value_type   = "INT64"
    unit         = "1"
    display_name = "Observations deleted per day post-archive (deletedCount)"
  }
  value_extractor = "EXTRACT(jsonPayload.deletedCount)"
}
