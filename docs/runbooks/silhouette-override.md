# Silhouette override runbook

## Purpose

The admin-api lets an operator (Julian or any agent) drop in a hand-sourced
SVG for any family whose Phylopic-curated silhouette is missing or
unsatisfactory, without a code change or deploy. Issue #502.

## Prerequisites

```bash
export ADMIN_API_URL="https://admin.bird-maps.com"          # or the .run.app URL
export ADMIN_API_TOKEN="$(gcloud secrets versions access latest --secret=bird-watch-admin-api-token --project=bird-maps-prod)"
```

If `admin.bird-maps.com` isn't yet wired (custom-domain mapping is a deliberate
follow-up, see plan §"open decisions" #7), pull the `.run.app` URL directly:

```bash
export ADMIN_API_URL="$(gcloud run services describe bird-admin-api \
  --region=us-west1 --project=bird-maps-prod --format='value(status.url)')"
```

## Initial deploy (one-time)

After `terraform apply` lands the new resources for the first time, mint the
bearer-token secret value:

```bash
echo "$(openssl rand -hex 32)" | gcloud secrets versions add \
  bird-watch-admin-api-token --data-file=- --project=bird-maps-prod
# Store the value in a password manager — there is no way to retrieve it back
# from Secret Manager outside the running Cloud Run instance.
```

Cloud Run picks up the new secret version at the next instance start. Force
a recycle if the first request returns 500 (unbound env):

```bash
gcloud run services update bird-admin-api --region=us-west1 --quiet
```

## Upload a silhouette

```bash
npm run silhouette set <family-code> <path-to-svg>
# example
npm run silhouette set cuculidae ./roadrunner.svg
```

SVG constraints (enforced server-side; mismatches return 400):

- Single `<svg>` root with exactly one `<path>` child
- viewBox `"0 0 24 24"` (or absent)
- Body ≤ 64 KB
- path-d charset: digits, the SVG command letters, space, dash, dot, comma
- No `<script>`, `<style>`, `<g>`, `<defs>`, `<use>`, event handlers, or `xlink:*`

> **IMPORTANT — Phylopic-shaped SVGs.** Files downloaded directly from
> Phylopic typically wrap their geometry in one or more `<g>` transform
> elements, which the validation rejects. Before uploading a Phylopic-sourced
> SVG, flatten it via the project's curation pipeline so the file ends up as
> a single bare `<path>`:
>
> ```bash
> # Re-run curate-phylopic for the affected family; the script flattens
> # <g> wrappers into a single path-d. The resulting path-d will be in the
> # curated output; copy it into a minimal `<svg viewBox="0 0 24 24">…<path d="…"/></svg>` wrapper for upload.
> node scripts/curation/curate-phylopic.mjs --family cuculidae
> ```
>
> Without this preprocessing the upload fails the validator's "no `<g>` wrappers"
> rule with a 400 response naming the failing rule.

Within ~30s a hard-reload of bird-maps.com renders the new silhouette in:

- (a) the FamilyLegend chip for that family
- (b) the map cluster mosaic for observations in that family (transitively —
  the SDF pipeline reads the refreshed `svg_data` from the cache-purged
  `/api/silhouettes` JSON on next page load)
- (c) the SpeciesDetailSurface for any species in that family (masthead
  fallback when `photoUrl` is null)

## Revert a silhouette

```bash
npm run silhouette unset <family-code>
```

This nulls both `svg_url` and `svg_data` in the DB and removes the R2 object.
The row reverts to `_FALLBACK` state (legend renders the generic shape
tinted with the family color). To restore the Phylopic-curated default,
re-run `npm run curate:phylopic` for the family and ship the resulting
migration.

## Rotate the bearer token

```bash
NEW=$(openssl rand -hex 32)
echo "$NEW" | gcloud secrets versions add bird-watch-admin-api-token \
  --data-file=- --project=bird-maps-prod
# Cloud Run picks up the new version at the next instance start. Force a
# recycle if you want to invalidate the old token immediately:
gcloud run services update bird-admin-api --region=us-west1 --quiet
```

Distribute the new value via the same path as the initial deploy (password
manager). The CLI reads `ADMIN_API_TOKEN` from the shell env, so operators
just re-export with the new value.

## Verifying a deploy

End-to-end smoke after a fresh `terraform apply` + image push:

```bash
# 1. Sanity ping
curl -s "$ADMIN_API_URL/health"
# expect: {"ok":true}

# 2. Upload a known fixture (any small valid SVG; the validation IS the contract)
npm run silhouette set cuculidae ./test-fixtures/cuckoo.svg
# expect: OK: cuculidae → https://silhouettes.bird-maps.com/family/cuculidae.<sha>.svg

# 3. Verify the CDN serves the new object
curl -sI "https://silhouettes.bird-maps.com/family/cuculidae.<sha>.svg" | head -5
# expect: HTTP/2 200, content-type: image/svg+xml

# 4. Reload bird-maps.com → within ~30s the cuculidae chip in the legend
#    renders the new silhouette tinted with cuculidae's color, and any
#    open cuckoo SpeciesDetailSurface masthead shows the same.

# 5. Revert
npm run silhouette unset cuculidae
# expect: OK: cuculidae reverted to _FALLBACK
# Reload → cuculidae renders the generic _FALLBACK shape.
```

## Troubleshooting

- **Upload returns 200 but render hasn't updated.** Cache purge may have
  failed (look for `X-Purge-Status: failed` on the response). Run
  `scripts/cache/purge-silhouettes-cache.sh` manually, or hit
  `https://api.bird-maps.com/api/silhouettes` with `?cb=$(date +%s)` to
  force a fresh fetch on next page load.
- **Upload returns 400.** SVG fails one of the validation rules above. The
  response body names the failing rule. For Phylopic-sourced SVGs the most
  common cause is a `<g>` wrapper — see the IMPORTANT note above.
- **Upload returns 401.** `ADMIN_API_TOKEN` env var doesn't match the
  Cloud Run-resolved value. Re-export from Secret Manager and retry.
- **Upload returns 404.** Family code doesn't exist in `family_silhouettes`.
  Confirm via the audit query in `scripts/curation/curate-phylopic.mjs` comments or
  by listing seeded family codes from a psql shell.
- **`silhouettes.bird-maps.com/family/<code>.<sha>.svg` returns 404.** R2 PUT
  may have raced ahead of the cache miss; wait 60s (the Worker's miss-cache
  TTL) and retry. If it persists, confirm the object exists via the R2
  dashboard.
- **Upload returns 500 with "R2_ENDPOINT is required".** Cloud Run hasn't
  picked up the secret-bound env yet. Force a revision recycle:
  `gcloud run services update bird-admin-api --region=us-west1 --quiet`.
