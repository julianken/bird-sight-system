# ── Smart Tiered Cache for cross-colo cache-warm propagation ─────────────
#
# The cache-warm cron (issue #711) runs from Cloud Run us-west1 and only
# hydrates the CF colo that serves that egress IP. Live testing 2026-05-22
# from a PHX-region browser ~3min after a warm cycle returned MISS on
# CONUS z=3 — proving the warm DID populate some colo (us-west1-routed),
# just not PHX.
#
# Smart Tiered Cache inserts an upper-tier colo between MISS-ing lower-tier
# colos and origin. One cron warm hydrates the upper tier; subsequent MISS
# at PHX/JFK/LHR pulls from the upper tier (in-network ~10-30ms) instead
# of origin (~1-2s). Net effect: globally effective warm without changing
# the cron, the URL list, or per-region scheduling.
#
# Plan tier: available on Free plan (verified at
# https://developers.cloudflare.com/cache/plans/ availability matrix —
# Smart Topology is Free+, Generic Global is Enterprise-only).
#
# Cloud region hint (gcp:us-west1) is OUT of Terraform scope per repo
# convention at cloud-sql.tf:96-110 (PostGIS-style operator runbook).
# See PR body for the runbook.
#
# Closes #713.

resource "cloudflare_tiered_cache" "api" {
  zone_id    = var.cloudflare_zone_id
  cache_type = "smart"
}
