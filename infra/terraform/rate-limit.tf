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
    expression  = "(http.request.uri.path matches \"^/api/\" and not http.request.uri.path matches \"^/api/admin/\")"
    action      = "block"
    enabled     = true

    ratelimit {
      # SECURITY (PR #597 review): characteristics are AND-keyed —
      # `["ip.src", "cf.colo.id"]` means one bucket per (IP, colo) pair, so
      # an attacker spreading requests across N Cloudflare colos (trivial via
      # Anycast) gets N× the effective per-IP ceiling. Keep `ip.src` only.
      characteristics     = ["ip.src"]
      period              = 60
      requests_per_period = 60
      # Continue blocking the offending IP for 60s after threshold trip.
      # Matches the period so a steady-state attacker stays blocked but a
      # bursty-legit client gets a fresh window quickly. Setting this far
      # higher than the period would punish legit users behind shared NAT.
      mitigation_timeout = 60
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
