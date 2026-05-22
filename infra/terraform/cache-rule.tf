# CDN cache rule for /api/* — addresses the 0.06% baseline hit ratio
# documented in issue #705 (May 22 2026 prod investigation).
#
# Cloudflare's default cache key already includes the full URI with query
# string, so we only need `ignore_query_strings_order` here. Both ttl modes
# use `respect_origin` so the origin's `Cache-Control: public, s-maxage=300,
# stale-while-revalidate=600` is the single source of truth for TTLs.
#
# The expression mirrors infra/terraform/rate-limit.tf exactly — same scope,
# excluding /api/admin/. Phase is http_request_cache_settings; rate-limit
# is http_ratelimit; the two rulesets do not conflict (different phases).
#
# Provider v4.20 uses HCL block syntax (not v5 list-of-objects). See
# rate-limit.tf for the canonical pattern in this repo.

resource "cloudflare_ruleset" "api_cache" {
  zone_id     = var.cloudflare_zone_id
  name        = "api-cache-rule"
  description = "Cache /api/* responses respecting origin Cache-Control. See issue #705."
  kind        = "zone"
  phase       = "http_request_cache_settings"

  rules {
    description = "Cache /api/* per origin s-maxage"
    expression  = "(starts_with(http.request.uri.path, \"/api/\") and not starts_with(http.request.uri.path, \"/api/admin/\"))"
    action      = "set_cache_settings"
    enabled     = true

    action_parameters {
      cache = true

      edge_ttl {
        mode = "respect_origin"
      }
      browser_ttl {
        mode = "respect_origin"
      }

      cache_key {
        ignore_query_strings_order = true
      }
    }
  }
}
