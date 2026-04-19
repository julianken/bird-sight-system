#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] terraform apply..."
(cd infra/terraform && terraform apply -auto-approve)

echo "[2/6] migrations..."
DB_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
DATABASE_URL="$DB_URL" ./scripts/migrate-deploy.sh

echo "[3/6] read-api deploy handled by .github/workflows/deploy-read-api.yml"

echo "[4/6] ingestor deploy handled by .github/workflows/deploy-ingestor.yml"

echo "[5/6] Cloud Run revisions rolled by per-service deploy workflows"

echo "[6/6] frontend deploy..."
echo "frontend deploy handled by .github/workflows/deploy-frontend.yml"

DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  bird-ingestor (cron-driven via Cloud Scheduler)"
