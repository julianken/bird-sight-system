# read-api

Hono-based HTTP service exposing read-only endpoints for the bird-maps.com
frontend. Platform-agnostic by design — the app is exported from `src/app.ts`
and adapted by `src/index.ts` (Cloud Run / node) and `src/local.ts` (local
dev). Cloud-specific code must stay out of `app.ts`.

## Audience-protection rate limit (issue #596)

National expansion is committed at Hacker News scale (~200x audience
multiplier). Without rate limiting, a single viral burst clips Cloud Run
autoscale into the Neon connection-pool ceiling and produces both 503s and a
surprise GCP bill. The rate limit caps cost at a known, configurable rate
instead of whatever Reddit decides today.

Three composing layers:

| Layer | Where | What |
|---|---|---|
| 1 | Cloudflare rate-limit rule (`infra/terraform/rate-limit.tf`) | 60 req/min/IP on `/api/*`, returns 429 + `Retry-After`. Actual production ceiling. |
| 2 | Cloudflare WAF managed challenge (manual — see `rate-limit.tf` MANUAL note) | Broad scraper/bot signature defense via free-tier Bot Fight Mode + medium security level. |
| 3 | Hono token-bucket middleware (`src/rate-limit.ts`) | Defense in depth: catches direct `*.a.run.app` hits that bypass Cloudflare. |

Layer 3 is **in-memory per Cloud Run instance** — no Redis, no extra Neon
pressure. Across N instances an attacker gets up to N × `burst` tokens; that
surplus is bounded and known, and Layer 1 is the global ceiling. The
middleware exists to prevent a single instance from exhausting its DB pool
when Cloudflare is bypassed.

### Configuration (Layer 3)

| Env var | Default | Meaning |
|---|---|---|
| `READ_API_RATE_BURST` | `60` | Max tokens in the bucket (also: initial fill). |
| `READ_API_RATE_REFILL_PER_SEC` | `1` | Tokens added back per second. |

The defaults intentionally match Layer 1: a client that doesn't bypass CF will
hit Layer 1 first, so Layer 3 only fires for the bypass path. Excluded routes:
`/health` (uptime probes) and `/api/admin/*` (separate auth + budget).

429 responses carry a `Retry-After` header (seconds, never less than 1) so
well-behaved clients back off.
