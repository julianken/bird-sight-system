#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[1/6] terraform apply..."
(cd infra/terraform && terraform apply -auto-approve)

echo "[2/6] migrations..."
DB_URL=$(cd infra/terraform && terraform output -raw neon_db_url)
DATABASE_URL="$DB_URL" ./scripts/migrate-deploy.sh

echo "[3/6] build + push read-api image..."
./scripts/build-push.sh read-api latest

echo "[4/6] build + push ingestor image..."
./scripts/build-push.sh ingestor latest

echo "[5/6] roll Cloud Run to new revisions..."
REGION=$(cd infra/terraform && terraform output -raw gcp_region 2>/dev/null || echo us-west1)
gcloud run services update bird-read-api \
  --region="$REGION" \
  --image="$(cd infra/terraform && terraform output -raw artifact_registry_url)/read-api:latest"
gcloud run jobs update bird-ingestor \
  --region="$REGION" \
  --image="$(cd infra/terraform && terraform output -raw artifact_registry_url)/ingestor:latest"

echo "[6/6] build + deploy frontend..."
DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
echo "VITE_API_BASE_URL=https://api.$DOMAIN" > frontend/.env.production
(cd frontend && npm run build && npx wrangler pages deploy dist --project-name=birdwatch --branch=main)

echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  bird-ingestor (cron-driven via Cloud Scheduler)"
