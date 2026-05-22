# Observations cold storage — see docs/plans/2026-05-20-observations-cold-storage.md.
#
# GCS Nearline bucket holding nightly Parquet exports of pruned observations.
# Hive-partitioned: observations/year=YYYY/month=MM/day=DD/data.parquet —
# `day=DD` is a directory segment so BigQuery's Hive AUTO partition planner
# picks up `[year, month, day]` as queryable partition columns (#699). The
# stable `data.parquet` filename leaves room for future sharding if a single
# day ever outgrows one file. BigQuery external table sits over the bucket
# for ad-hoc SQL; DuckDB and Polars consume the same files locally for ML.

resource "google_storage_bucket" "obs_archive" {
  name                        = "bird-maps-prod-obs-archive"
  location                    = "US-WEST1"
  storage_class               = "NEARLINE"
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # Per-day Parquet files are reconstitutable in principle (re-export from
  # Cloud SQL) only within the 14-day live window; older partitions are
  # the sole copy of those observations. A `terraform destroy` typo would
  # wipe years of unrecoverable data — the prevent_destroy guard matches
  # the cloudflare_r2_bucket.photos pattern in infra/terraform/photos.tf.
  lifecycle {
    prevent_destroy = true
  }

  # 90-day Nearline → Archive transition. Nearline is right for the first
  # 90 days while anyone tuning a query or sanity-checking the archive
  # re-reads recent partitions; Archive's $0.0012/GB-mo is 8× cheaper but
  # has a $0.05/GB retrieval fee and a 365-day minimum-retention billing
  # penalty. After 90 days the data is genuinely cold (only ML training
  # batch-reads), and Archive is the right tier.
  lifecycle_rule {
    condition { age = 90 }
    action {
      type          = "SetStorageClass"
      storage_class = "ARCHIVE"
    }
  }

  # Belt-and-suspenders mop-up for orphaned temp objects (issue #698).
  # archiveAndUpload writes Parquet to `observations/_tmp/<uuid>.parquet`
  # then server-side-copies to the final partition key and deletes the
  # temp. The application-level cleanup now propagates delete failures
  # (so runPrune skips the source-row DELETE on failure), but a process
  # crash between copy and delete still strands a temp object. This rule
  # guarantees those orphans never accumulate: anything under
  # `observations/_tmp/` older than 1 day is auto-deleted. The 1-day
  # window is generous — temps live for milliseconds in the happy path —
  # and avoids racing a long-running run that has already passed the
  # md5 check but is still mid-copy.
  lifecycle_rule {
    condition {
      age            = 1
      matches_prefix = ["observations/_tmp/"]
    }
    action {
      type = "Delete"
    }
  }
}

# Ingestor SA needs create + get + delete on this bucket's objects.
# The atomic-rename uploader (services/ingestor/src/archive/gcs-uploader.ts)
# does four object-level operations:
#   1. PUT  observations/_tmp/<uuid>.parquet  (storage.objects.create)
#   2. HEAD temp object for md5 verify        (storage.objects.get)
#   3. Server-side COPY to final partition    (storage.objects.create)
#   4. DELETE the temp object                 (storage.objects.delete) ← was
#      missing from the prior objectCreator + objectViewer split; caused the
#      2026-05-22 prune-job failure (#709).
#
# roles/storage.objectUser covers all four operations (create, get, list,
# update, delete) at object scope with no bucket-level or IAM-level powers.
# A narrower IAM condition scoping delete to observations/_tmp/* was
# considered and rejected as overkill: the lifecycle rule already bounds
# _tmp/ retention to 1 day, and conditions add operational drag with no
# real security gain given the bucket's private-only, single-SA access model.
resource "google_storage_bucket_iam_member" "ingestor_archive_user" {
  bucket = google_storage_bucket.obs_archive.name
  role   = "roles/storage.objectUser"
  member = "serviceAccount:${google_service_account.ingestor.email}"
}

# BigQuery dataset for the external table. Same region as the bucket —
# cross-region external-table reads cost egress.
resource "google_bigquery_dataset" "obs_archive" {
  dataset_id  = "observations_archive"
  location    = "US-WEST1"
  description = "Observations cold storage; external table over gs://bird-maps-prod-obs-archive."
}

# External table over the Hive-partitioned Parquet layout. autodetect on
# schema means we don't lock in a specific column list here — a future
# observations column addition flows through without a Terraform change.
resource "google_bigquery_table" "observations" {
  dataset_id = google_bigquery_dataset.obs_archive.dataset_id
  table_id   = "observations"

  deletion_protection = true

  external_data_configuration {
    autodetect    = true
    source_format = "PARQUET"

    source_uris = [
      "gs://${google_storage_bucket.obs_archive.name}/observations/*.parquet",
    ]

    hive_partitioning_options {
      mode              = "AUTO"
      source_uri_prefix = "gs://${google_storage_bucket.obs_archive.name}/observations/"
    }
  }
}

# Budget alert at $5/mo — at national scale year-1 the bucket should sit
# near $0.50/mo; $5 catches any 10× surprise (runaway upload, lifecycle
# rule misconfigured, etc.) without false-firing on normal growth.
# See infra/terraform/budget.tf for the project-wide budget shape.
output "obs_archive_bucket_name" {
  value = google_storage_bucket.obs_archive.name
}

output "obs_archive_bq_dataset" {
  value = google_bigquery_dataset.obs_archive.dataset_id
}
