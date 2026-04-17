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
REGION=$(cd infra/terraform && terraform output -raw gcp_region)
REGISTRY=$(cd infra/terraform && terraform output -raw artifact_registry_url)
gcloud run services update bird-read-api \
  --region="$REGION" \
  --image="$REGISTRY/read-api:latest"
gcloud run jobs update bird-ingestor \
  --region="$REGION" \
  --image="$REGISTRY/ingestor:latest"

echo "[6/6] build + deploy frontend..."
DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
echo "VITE_API_BASE_URL=https://api.$DOMAIN" > frontend/.env.production
CLOUDFLARE_API_TOKEN=$(cd infra/terraform && terraform output -raw cloudflare_api_token)
export CLOUDFLARE_API_TOKEN
(cd frontend && npm run build && npx wrangler pages deploy dist --project-name=birdwatch --branch=main)

echo
echo "Deployed."
echo "  Frontend:  https://$DOMAIN"
echo "  API:       https://api.$DOMAIN"
echo "  Ingestor:  bird-ingestor (cron-driven via Cloud Scheduler)"
