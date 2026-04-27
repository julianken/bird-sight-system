#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
API="https://api.$DOMAIN"
WEB="https://$DOMAIN"

echo "Checking $API/health..."
curl -fsS "$API/health" | tee /dev/stderr | grep -q '"ok":true'

echo
echo "Checking $API/api/observations returns observations array..."
COUNT=$(curl -fsS "$API/api/observations?since=14d&loc=US-AZ" | jq 'length')
test "$COUNT" -gt 0

echo
echo "Checking Cache-Control header on /api/observations..."
curl -fsSI "$API/api/observations?since=14d&loc=US-AZ" | grep -i 'cache-control: public, max-age=1800'

echo
echo "Checking $API/api/hotspots returns hotspots array..."
COUNT=$(curl -fsS "$API/api/hotspots" | jq 'length')
test "$COUNT" -gt 0

echo
echo "Checking Cache-Control header on /api/hotspots..."
curl -fsSI "$API/api/hotspots" | grep -i 'cache-control: public, max-age=86400'

echo
echo "Checking $API/api/silhouettes returns silhouettes array..."
COUNT=$(curl -fsS "$API/api/silhouettes" | jq 'length')
test "$COUNT" -gt 0

echo
echo "Checking Cache-Control header on /api/silhouettes..."
curl -fsSI "$API/api/silhouettes" | grep -i 'cache-control: public, max-age=604800'

echo
echo "Checking $API/api/species/grhowl returns species object with comName..."
curl -fsS "$API/api/species/grhowl" | jq -e '.comName' > /dev/null

echo
echo "Checking Cache-Control header on /api/species/grhowl (immutable)..."
curl -fsSI "$API/api/species/grhowl" | grep -i 'cache-control: public, max-age=604800, immutable'

echo
echo "Checking frontend HTML..."
curl -fsS "$WEB" | grep -q '<title>bird-watch'

echo
echo "All smoke checks passed."
