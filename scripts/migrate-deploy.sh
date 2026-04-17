#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  echo "Hint: export DATABASE_URL=\$(cd infra/terraform && terraform output -raw neon_db_url)" >&2
  exit 1
fi

echo "Enabling PostGIS on Neon..."
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "Running migrations..."
npx node-pg-migrate up -m migrations -d "$DATABASE_URL"

echo "Done."
