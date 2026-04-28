#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  echo "Hint: export DATABASE_URL=\$(cd infra/terraform && terraform output -raw neon_db_url)" >&2
  exit 1
fi

echo "Enabling PostGIS on Neon..."
# NOTE: redundant with migrations/1700000001000_enable_postgis.sql, which runs
# CREATE EXTENSION IF NOT EXISTS postgis via the migrations ledger. Kept for
# belt-and-suspenders on brand-new Neon branches where the ledger is empty.
# Safe to delete in a follow-up cleanup (see issue #65 Gotchas, "optional").
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS postgis;"

echo "Running migrations..."
# -d (a.k.a. --database-url-var) takes the NAME of the env var, not the URL value.
# (salsita.github.io/node-pg-migrate/cli)
npx node-pg-migrate up -m migrations -d DATABASE_URL --ignore-pattern '(^\..*)|(.*\.md$)'

echo "Done."
