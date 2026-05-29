#!/usr/bin/env bash
#
# Fetch + verify the 2020 Census ZCTA Gazetteer (public domain, 17 U.S.C. §105).
#
# This is the ONLY step in the ZIP ETL that touches the network. It downloads
# the national ZCTA gazetteer zip, verifies it against a pinned sha256, and
# unzips it into the gitignored .cache/ directory. The offline ETL
# (build-zip-index.ts) then reads .cache/2020_Gaz_zcta_national.txt to produce
# frontend/public/zip-index.json. CI never runs this script — it runs the ETL
# test against a committed 10-row fixture instead.
#
# Idempotent: re-running with the file already present and matching the pin
# skips the download. A sha256 mismatch is a hard failure (non-zero exit) —
# the upstream artifact changed and the pin must be re-reviewed deliberately.
#
set -euo pipefail

# --- pinned source -----------------------------------------------------------
URL="https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip"
# sha256 of the .zip, captured 2026-05-28. A mismatch means the upstream file
# changed; do NOT silently re-pin — verify the new artifact is the genuine
# 2020 vintage before updating this value.
EXPECTED_SHA256="335402fb16b41303a3760f8956d2af005bbd6919b8dc6f4a96048af0005957a6"
TXT_NAME="2020_Gaz_zcta_national.txt"
ZIP_NAME="2020_Gaz_zcta_national.zip"

# --- paths -------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="$SCRIPT_DIR/.cache"
ZIP_PATH="$CACHE_DIR/$ZIP_NAME"
TXT_PATH="$CACHE_DIR/$TXT_NAME"

mkdir -p "$CACHE_DIR"

# --- sha256 helper (portable: macOS shasum, Linux sha256sum) -----------------
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# --- download (skip if already present and valid) ----------------------------
if [ -f "$ZIP_PATH" ] && [ "$(sha256_of "$ZIP_PATH")" = "$EXPECTED_SHA256" ]; then
  echo "Cached zip already matches pin — skipping download."
else
  echo "Downloading $URL ..."
  curl -sSL -o "$ZIP_PATH" "$URL"
fi

# --- verify ------------------------------------------------------------------
ACTUAL_SHA256="$(sha256_of "$ZIP_PATH")"
if [ "$ACTUAL_SHA256" != "$EXPECTED_SHA256" ]; then
  echo "ERROR: sha256 mismatch for $ZIP_NAME" >&2
  echo "  expected: $EXPECTED_SHA256" >&2
  echo "  actual:   $ACTUAL_SHA256" >&2
  echo "The upstream artifact changed. Re-pin deliberately after review." >&2
  exit 1
fi
echo "sha256 verified: $ACTUAL_SHA256"

# --- unzip -------------------------------------------------------------------
unzip -o "$ZIP_PATH" -d "$CACHE_DIR" >/dev/null
if [ ! -f "$TXT_PATH" ]; then
  echo "ERROR: expected $TXT_NAME inside the archive, not found." >&2
  exit 1
fi

ROW_COUNT="$(($(wc -l < "$TXT_PATH") - 1))"
echo "Ready: $TXT_PATH (~$ROW_COUNT data rows)"
echo "Next: npx tsx scripts/zip-etl/build-zip-index.ts"
