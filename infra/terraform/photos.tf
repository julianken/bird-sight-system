# ── Storage backend for per-species bird photos ─────────────────────────
#
# Cloudflare R2 bucket holding the iNaturalist-sourced JPEG/PNG/WebP photos
# rendered by SpeciesDetailSurface. Public access is provided by a separate
# Worker (task-1b) at photos.${var.domain}; the bucket itself stays private.
# Mirrors the cloudflare_r2_bucket.pmtiles pattern from map-v1.tf.
# See issue #327 §Approach.

resource "cloudflare_r2_bucket" "photos" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-photos"
  location   = "WNAM" # Western North America — closest to AZ users
}
