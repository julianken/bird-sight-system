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

  # Photos are reconstitutable only via rate-limited iNaturalist re-fetch
  # (~344 species × monthly cadence). A `terraform destroy` typo would cost
  # hours of ingest work, not just data — the one-line guard is cheap
  # insurance and matches the bucket's "treat as durable archive" role.
  lifecycle {
    prevent_destroy = true
  }
}

# ── Public read-only Worker in front of the R2 bucket ────────────────────
#
# The bucket has no public ACL; this Worker is the only public ingress.
# Mirrors the `cloudflare_workers_script.map_server` + `cloudflare_workers_route`
# + `cloudflare_record` triplet from map-v1.tf — same shape, different
# binding name (PHOTOS vs TILES) and different hostname.
#
# Worker source lives in infra/workers/photo-server.js (kept as a real .js
# file, not an inline heredoc, so it can be unit-tested with `node --test`).

resource "cloudflare_workers_script" "photo_server" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-photo-server"
  module     = true

  content = file("${path.module}/../workers/photo-server.js")

  r2_bucket_binding {
    name        = "PHOTOS"
    bucket_name = cloudflare_r2_bucket.photos.name
  }
}

resource "cloudflare_workers_route" "photos" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "photos.${var.domain}/*"
  script_name = cloudflare_workers_script.photo_server.name
}

# photos.bird-maps.com CNAME — Worker-routed hostname needs Cloudflare proxy
# (proxied = true) so the Worker route fires. Same pattern as tiles.
resource "cloudflare_record" "photos" {
  zone_id = var.cloudflare_zone_id
  name    = "photos"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
}
