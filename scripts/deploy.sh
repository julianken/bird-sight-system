#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] terraform apply..."
(cd infra/terraform && terraform apply -auto-approve)

echo "[2/6] migrations..."
DB_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
DATABASE_URL="$DB_URL" ./scripts/migrate-deploy.sh

echo "[3/6] read-api deploy handled by .github/workflows/deploy-read-api.yml"

echo "[4/6] build + push ingestor image..."
./scripts/build-push.sh ingestor latest

echo "[5/6] roll Cloud Run to new revisions..."
REGION=$(cd infra/terraform && terraform output -raw gcp_region)
REGISTRY=$(cd infra/terraform && terraform output -raw artifact_registry_url)
gcloud run jobs update bird-ingestor \
  --region="$REGION" \
  --image="$REGISTRY/ingestor:latest"

echo "[6/6] frontend deploy..."
echo "frontend deploy handled by .github/workflows/deploy-frontend.yml"

DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  bird-ingestor (cron-driven via Cloud Scheduler)"
