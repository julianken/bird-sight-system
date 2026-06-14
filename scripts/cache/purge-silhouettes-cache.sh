#!/usr/bin/env bash
# Purge the /api/silhouettes response from Cloudflare's edge cache.
#
# Run this after merging a `family_silhouettes` migration so the new
# rows reach users immediately, instead of waiting up to 7 days for
# the browser cache to expire (max-age=604800).
#
# See docs/runbooks/cache-purge.md for the full ops procedure and the
# secret-store layout for CLOUDFLARE_ZONE_ID / CLOUDFLARE_API_TOKEN.
#
# Flags:
#   --dry-run   Print the request that would be sent and exit 0 without
#               calling the Cloudflare API. Used by CI to keep this
#               script from rotting silently.
set -euo pipefail
: "${CLOUDFLARE_ZONE_ID:?required}"
: "${CLOUDFLARE_API_TOKEN:?required}"
API_HOST="${API_HOST:-api.bird-maps.com}"
PURGE_URL="https://${API_HOST}/api/silhouettes"
PAYLOAD="$(jq -nc --arg url "$PURGE_URL" '{files: [$url]}')"
if [[ "${1:-}" == "--dry-run" ]]; then
  echo "DRY RUN — would POST to https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache"
  echo "Payload: ${PAYLOAD}"
  exit 0
fi
curl -fsSL -X POST \
  "https://api.cloudflare.com/client/v4/zones/${CLOUDFLARE_ZONE_ID}/purge_cache" \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "${PAYLOAD}"
