#!/usr/bin/env bash
# Purge cached /api/species/* responses from Cloudflare's edge cache.
#
# Run after a successful descriptions ingest so updated bodies/etag/license
# data reaches users immediately, instead of waiting for the per-route
# Cache-Control max-age to expire. The descriptions ingest job
# (bird-ingestor-descriptions) shells out to this script when
# DESCRIPTIONS_PURGE_CACHE=1 and the run wrote at least one row.
#
# The /api/species/:code route is owned by services/read-api/src/app.ts;
# the descriptions-write affects every species's response (the projection
# in #372 surfaces description fields onto that route). Purging the prefix
# is conservative — we don't enumerate the 344 species codes the run might
# have touched, but the prefix-purge cost on a single-zone Cloudflare plan
# is negligible vs the 7-day max-age penalty of stale data.
#
# See docs/runbooks/cache-purge.md for the full ops procedure and the
# secret-store layout for CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN.
#
# Flags:
#   --dry-run   Print the request that would be sent and exit 0 without
#               calling the Cloudflare API. Used by CI to keep this
#               script from rotting silently. SHIPPED --dry-run-ONLY
#               INITIALLY: the live-purge gate flips in a follow-up PR
#               once the descriptions cron has run successfully a few
#               times in production.
set -euo pipefail
: "${CLOUDFLARE_ZONE_ID:?required}"
: "${CLOUDFLARE_API_TOKEN:?required}"
API_HOST="${API_HOST:-api.bird-maps.com}"
PURGE_URL="https://${API_HOST}/api/species/"
PAYLOAD="$(jq -nc --arg url "$PURGE_URL" '{prefixes: [$url]}')"
if [[ "${1:-}" == "--dry-run" ]]; then
  echo "DRY RUN — would POST to https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache"
  echo "Payload: ${PAYLOAD}"
  exit 0
fi
# Initial-rollout safety: this script is shipped --dry-run-only. The live
# branch below is unreachable until a follow-up PR removes this guard.
echo "ERROR: live cache-purge is gated; pass --dry-run for now (see header comment)"
exit 1
# shellcheck disable=SC2317  # follow-up PR enables the live path
curl -fsSL -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "${PAYLOAD}"
