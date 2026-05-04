# ── Storage backend for per-species bird photos ─────────────────────────
#
# Cloudflare R2 bucket holding the iNaturalist-sourced JPEG/PNG/WebP photos
# rendered by SpeciesDetailSurface. Public access is provided by a separate
# Worker (task-1b) at photos.${var.domain}; the bucket itself stays private.
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
# Worker source lives in infra/workers/photo-server.js (kept as a real .js
# file, not an inline heredoc, so it can be unit-tested with `node --test`).
#
# v5 attribute changes (cloudflare_workers_script):
#   - `name` → `script_name`
#   - `module = true` → `main_module = "photo-server.js"`
#   - typed binding blocks (e.g. r2_bucket_binding {...}) collapse into a
#     single `bindings = [{ type = "r2_bucket", ... }]` list. The legacy
#     `r2_bucket_binding` attribute name is removed entirely in v5.
#   - `compatibility_date` is now required for module workers.
# Same resource type, no `moved` block needed.
resource "cloudflare_workers_script" "photo_server" {
  account_id         = var.cloudflare_account_id
  script_name        = "birdwatch-photo-server"
  main_module        = "photo-server.js"
  compatibility_date = "2024-09-23"

  content = file("${path.module}/../workers/photo-server.js")

  bindings = [
    {
      name        = "PHOTOS"
      type        = "r2_bucket"
      bucket_name = cloudflare_r2_bucket.photos.name
    },
  ]
}

# v5 attribute rename: cloudflare_workers_route.script_name → script. The
# rhs is the script's `script_name` (not `.id`, not `.name`) — verified
# against context7 v5 schema (plan §1).
resource "cloudflare_workers_route" "photos" {
  zone_id = var.cloudflare_zone_id
  pattern = "photos.${var.domain}/*"
  script  = cloudflare_workers_script.photo_server.script_name
}

moved {
  from = cloudflare_record.photos
  to   = cloudflare_dns_record.photos
}

# photos.bird-maps.com CNAME — Worker-routed hostname needs Cloudflare proxy
# (proxied = true) so the Worker route fires. Same pattern as tiles.
resource "cloudflare_dns_record" "photos" {
  zone_id = var.cloudflare_zone_id
  name    = "photos"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
}
