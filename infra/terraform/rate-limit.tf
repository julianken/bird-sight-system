# ── Audience-protection rate limit (issue #596) ──────────────────────────
#
# Three-layer design — this file is Layers 1 & 2; Layer 3 (Hono token-bucket
# middleware) lives in services/read-api/src/rate-limit.ts.
#
# Driver: docs/analyses/2026-05-14-process-scale-options/phase-4/analysis-report.md
# Recommendation 1E — at the committed 200x audience multiplier (national
# expansion + HN-scale spike risk), per-IP rate limiting becomes load-bearing
# rather than precautionary. A single viral burst without a ceiling →
# Cloud Run autoscale runs hot → Neon connection pool saturates → 503s and
# a surprise GCP bill.
#
# Why a ruleset and not cloudflare_rate_limit (legacy):
# The legacy `cloudflare_rate_limit` resource is deprecated in favor of the
# unified ruleset engine. New rules should use `cloudflare_ruleset` with
# phase = "http_ratelimit" — that path also gets the dashboard's modern UX
# and is what Cloudflare recommends for net-new deployments.

# Layer 1: rate-limit ruleset on /api/* — 60 requests per 60 seconds per IP.
# Free-tier zones include 1 rule of this kind for free; this is that one rule.
# Adding a second rule (e.g. a stricter limit on /api/admin/*) would cost
# $5/mo and is deferred until traffic data justifies it.
resource "cloudflare_ruleset" "read_api_rate_limit" {
  zone_id     = var.cloudflare_zone_id
  name        = "read-api-rate-limit"
  description = "60 req/min/IP on /api/* — audience-protection ceiling (issue #596)"
  kind        = "zone"
  phase       = "http_ratelimit"

  rules {
    description = "Rate limit /api/* at 60 req/min/IP"
    # Free-tier expression operators: only simple comparisons (no `matches`
    # regex). starts_with is sufficient — /api/ prefix excludes /api/admin/.
    expression = "(starts_with(http.request.uri.path, \"/api/\") and not starts_with(http.request.uri.path, \"/api/admin/\"))"
    action     = "block"
    enabled    = true

    ratelimit {
      # Cloudflare API REQUIRES `cf.colo.id` in characteristics — rate limiting
      # is enforced at the colocation level and the API rejects characteristics
      # without it (error 20155: "characteristics field is missing 'cf.colo.id'").
      # The PR #597 round-2 SUGGESTION to remove cf.colo.id was unenforceable;
      # the bucket key is effectively (IP, colo). At ~300 active CF colos, the
      # theoretical per-IP ceiling becomes ~300× the per-colo limit for an
      # attacker who can route across all colos — mitigated in practice by
      # Anycast typically pinning a client to one colo. Layer 3 (Hono
      # token-bucket on the origin) is the real per-IP cap and is unaffected.
      characteristics = ["ip.src", "cf.colo.id"]
      # Free-tier Cloudflare only permits `period = 10` (seconds). The intent
      # is 60 req/min/IP, so requests_per_period=10 over period=10 gives
      # 1 req/sec sustained = 60 req/min — same effective ceiling, different
      # granularity (slightly more bursty: an IP that pauses can still spike
      # to 10 in a single second). Acceptable for a hobby map app.
      period              = 10
      requests_per_period = 10
      # Free-tier Cloudflare locks mitigation_timeout to 10s (must equal period).
      # An offending IP that trips the limit is blocked for 10s, then can spike
      # again. Layer 3 (Hono middleware) provides the sustained-attack cap.
      mitigation_timeout = 10
    }

    action_parameters {
      response {
        status_code = 429
        # Body matches what the Layer-3 middleware returns so clients see a
        # consistent shape regardless of which layer fired.
        content      = "{\"error\":\"rate limit exceeded\"}"
        content_type = "application/json"
      }
    }
  }
}

# Layer 2: Cloudflare WAF managed challenge for obvious scraper/bot signatures.
#
# MANUAL: the `http_request_firewall_managed` phase ruleset for free-tier zones
# is configured via the Cloudflare dashboard ("Security → WAF → Managed rules")
# and is not exposed as a Terraform resource on the cloudflare/cloudflare v4
# provider's free-tier path. Set the following from the dashboard once per
# environment and record the toggle state in the runbook:
#
#   1. Security → Bots → Bot Fight Mode: ON (free-tier built-in; no cost)
#   2. Security → Settings → Security Level: Medium
#   3. Security → Settings → Challenge Passage: 30 minutes
#
# These three together provide managed-challenge behavior against the
# established bad-bot signatures Cloudflare maintains. The decision NOT to
# write custom WAF rules is deliberate (false-positive risk on legitimate
# birding-app traffic patterns).
#
# Revisit when: (a) we upgrade to a paid Cloudflare plan, at which point
# cloudflare_ruleset on phase = "http_request_firewall_managed" becomes
# directly assignable and this block should be replaced with HCL; or
# (b) a real bot-driven incident reveals the managed-rule defaults are
# insufficient, in which case we add a single `cloudflare_ruleset` of phase
# http_request_firewall_custom with the narrowest possible expression.
