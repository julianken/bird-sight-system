#!/usr/bin/env bash
# build-basemap.sh — One-time script to build and upload the AZ PMTiles basemap.
#
# Committed for reproducibility. NOT run in CI.
#
# Prerequisites:
#   - pmtiles CLI: https://github.com/protomaps/go-pmtiles (go install or brew)
#   - wrangler CLI: npm install -g wrangler (authenticated via `wrangler login`)
#   - CLOUDFLARE_API_TOKEN env var with R2:Edit scope, OR an active wrangler session
#
# Style validation note (from prototype Finding 2):
#   OpenFreeMap's liberty/positron styles emit MapLibre warnings at certain zooms.
#   If using a third-party style, validate it with maplibre-style-spec's linter
#   before pointing the frontend at the tile set. This script handles tile data
#   only — style spec validation is a separate S3/S4 concern.

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────
BUCKET="birdwatch-pmtiles"
AZ_BBOX="-114.82,31.33,-109.05,37.00"
# NOTE: One-time, manually-run script. The 2025-01-01 snapshot date is intentional —
# refresh this line when rebuilding the basemap. Not run in CI.
# To find a newer planet snapshot, browse https://build.protomaps.com/ and update the date below.
EXTRACT_URL="https://build.protomaps.com/20250101.pmtiles"  # pinned planet snapshot (not the rolling "weekly" build)
OUTPUT_FILE="arizona.pmtiles"
R2_KEY="arizona.pmtiles"

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

# ── Guard: skip if already uploaded ─────────────────────────────────────
if wrangler r2 object get "$BUCKET/$R2_KEY" --pipe > /dev/null 2>&1; then
  echo "✓ $R2_KEY already exists in R2 bucket '$BUCKET'. Skipping upload."
  exit 0
fi

# ── Step 1: Extract AZ region from Protomaps planet ────────────────────
echo "→ Extracting AZ tiles (bbox: $AZ_BBOX) ..."
pmtiles extract "$EXTRACT_URL" "$WORK_DIR/$OUTPUT_FILE" \
  --bbox="$AZ_BBOX"

FILESIZE=$(wc -c < "$WORK_DIR/$OUTPUT_FILE" | tr -d ' ')
echo "  Extracted $OUTPUT_FILE ($FILESIZE bytes)"

# ── Step 2: Upload to R2 ───────────────────────────────────────────────
echo "→ Uploading $OUTPUT_FILE to R2 bucket '$BUCKET' ..."
wrangler r2 object put "$BUCKET/$R2_KEY" \
  --file="$WORK_DIR/$OUTPUT_FILE" \
  --content-type="application/vnd.pmtiles"

echo "✓ Upload complete. Tile set available at: tiles.bird-maps.com/$R2_KEY"
