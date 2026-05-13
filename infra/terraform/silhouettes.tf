# ── Storage backend for admin-api-uploaded family silhouettes (#502) ────
#
# Cloudflare R2 bucket holding the operator-curated SVGs that override the
# Phylopic-curated default in family_silhouettes. Public access via a
# separate Worker at silhouettes.${var.domain}; the bucket itself stays
# private. See D1 in docs/plans/2026-05-13-silhouette-admin-api.md.

resource "cloudflare_r2_bucket" "silhouettes" {
  account_id = var.cloudflare_account_id
  name       = "bird-maps-silhouettes"
  location   = "WNAM" # Western North America — closest to AZ users

  # No prevent_destroy: silhouette objects are re-runnable from local SVG
  # files via `npm run silhouette set`. A destroy costs ~10 minutes of
  # operator re-uploading, not curation work — a different durability class
  # than birdwatch-photos (which has prevent_destroy=true because re-fetch
  # is rate-limited iNaturalist work).
}

# ── Public read-only Worker in front of the R2 bucket ────────────────────
#
# The bucket has no public ACL; this Worker is the only public ingress.
# Worker source lives in infra/workers/silhouette-server.js (kept as a real .js
# file, not an inline heredoc, so it can be unit-tested with `node --test`).
# Mirrors the photos pipeline exactly — only the Content-Type table and the
# binding name differ.

resource "cloudflare_workers_script" "silhouette_server" {
  account_id = var.cloudflare_account_id
  name       = "birdwatch-silhouette-server"
  module     = true

  content = file("${path.module}/../workers/silhouette-server.js")

  r2_bucket_binding {
    name        = "SILHOUETTES"
    bucket_name = cloudflare_r2_bucket.silhouettes.name
  }
}

resource "cloudflare_workers_route" "silhouettes" {
  zone_id     = var.cloudflare_zone_id
  pattern     = "silhouettes.${var.domain}/*"
  script_name = cloudflare_workers_script.silhouette_server.name
}

# silhouettes.bird-maps.com CNAME — Worker-routed hostname needs Cloudflare
# proxy (proxied = true) so the Worker route fires. Same pattern as photos.
resource "cloudflare_record" "silhouettes" {
  zone_id = var.cloudflare_zone_id
  name    = "silhouettes"
  type    = "CNAME"
  content = var.domain
  proxied = true
  ttl     = 1
}
