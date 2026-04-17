#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

REGISTRY=$(cd infra/terraform && terraform output -raw artifact_registry_url)
SERVICE="${1:?usage: build-push.sh <service> (read-api | ingestor)}"
TAG="${2:-latest}"

echo "Building $SERVICE → $REGISTRY/$SERVICE:$TAG ..."
docker buildx build --platform linux/amd64 \
  -f "services/$SERVICE/Dockerfile" \
  -t "$REGISTRY/$SERVICE:$TAG" \
  --push .

echo "Pushed $REGISTRY/$SERVICE:$TAG"
