# Observations cold storage — see docs/plans/2026-05-20-observations-cold-storage.md.
#
# GCS Nearline bucket holding nightly Parquet exports of pruned observations.
# Hive-partitioned: observations/year=YYYY/month=MM/day=DD.parquet. BigQuery
# external table sits over the bucket for ad-hoc SQL; DuckDB and Polars
# consume the same files locally for ML.

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

# Ingestor SA writes nightly Parquet exports. Object-level role; no admin
# or bucket-level binding (the ingestor never lists or deletes archive
# objects).
resource "google_storage_bucket_iam_member" "ingestor_archive_writer" {
  bucket = google_storage_bucket.obs_archive.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.ingestor.email}"
}

# Ingestor SA also reads — needed for the temp-object → atomic-rename
# uploader pattern (T2): we PUT to a temp key, verify the md5, then
# rewrite to the final partition key. The objectCreator role does not
# include read.
resource "google_storage_bucket_iam_member" "ingestor_archive_reader" {
  bucket = google_storage_bucket.obs_archive.name
  role   = "roles/storage.objectViewer"
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
