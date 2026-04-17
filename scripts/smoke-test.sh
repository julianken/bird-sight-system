#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

DOMAIN=$(cd infra/terraform && terraform output -raw root_domain)
API="https://api.$DOMAIN"
WEB="https://$DOMAIN"

echo "Checking $API/health..."
curl -fsS "$API/health" | tee /dev/stderr | grep -q '"ok":true'

echo
echo "Checking $API/api/regions returns 9 regions..."
COUNT=$(curl -fsS "$API/api/regions" | jq 'length')
test "$COUNT" -eq 9

echo
echo "Checking $API/api/observations is reachable..."
curl -fsS "$API/api/observations?since=14d" > /dev/null

echo
echo "Checking Cache-Control header on /api/regions..."
curl -fsSI "$API/api/regions" | grep -i 'cache-control: public, max-age=604800, immutable'

echo
echo "Checking frontend HTML..."
curl -fsS "$WEB" | grep -q '<title>bird-watch'

echo
echo "All smoke checks passed."
