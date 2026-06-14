#!/usr/bin/env bash
set -euo pipefail

# Applies pending `-- Up Migration` SQL files under migrations/ against the
# Postgres pointed at by $DATABASE_URL via node-pg-migrate. Designed to run
# against Cloud SQL (Postgres 16) through the Cloud SQL Auth Proxy started by
# .github/workflows/deploy-migrations.yml, but it works against any Postgres
# URL — PostGIS is created by migration 1700000001000_enable_postgis.sql
# rather than by an out-of-band `CREATE EXTENSION`, so the only environmental
# requirement is a reachable database the connecting user can write to.
#
# Partial-failure contract: non-zero exit on the first migration that errors,
# matching the workflow's contract (no auto-rollback).

cd "$(dirname "$0")/../.."

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set" >&2
  exit 1
fi

echo "Running migrations..."
# -d (a.k.a. --database-url-var) takes the NAME of the env var, not the URL value.
# (salsita.github.io/node-pg-migrate/cli)
npx node-pg-migrate up -m migrations -d DATABASE_URL --ignore-pattern '(^\..*)|(.*\.md$)'

echo "Done."
