# `@bird-watch/admin-api`

Operator-only HTTP service for overriding the family **silhouette** that
bird-maps.com renders for any bird family. A `PUT` uploads a hand-sourced SVG to
the silhouettes R2 bucket, points the `family_silhouettes` DB row at it, and
purges the `/api/silhouettes` JSON cache on Cloudflare so the change is live
within ~30s; a `DELETE` reverts the family to its `_FALLBACK` shape. This is a
write path distinct from the public, read-only [`read-api`](../read-api): every
`/admin/*` route is behind a bearer token and the service runs scale-to-zero
with no CDN in front. Added for issue #502; not part of the original
`docs/specs/2026-04-16-bird-watch-design.md` service inventory.

## How it fits

```
operator → scripts/curation/silhouette.mjs (npm run silhouette)
              │  PUT/DELETE /admin/silhouettes/family/:code  (Bearer)
              ▼
         bird-admin-api (Cloud Run)
              ├── R2 PUT/DELETE        → bird-maps-silhouettes bucket
              │                          (served at silhouettes.bird-maps.com)
              ├── UPDATE family_silhouettes (svg_url, svg_data)
              └── Cloudflare purge_cache → https://api.bird-maps.com/api/silhouettes
```

The silhouettes bucket is served to the browser by the
`birdwatch-silhouette-server` Cloudflare Worker; the admin-api only writes to it.

## Quickstart (local)

The service is a [Hono](https://hono.dev) app. `createApp({ pool, storage, token })`
is exported from `src/app.ts`; `src/local.ts` is the Node entry point
(`@hono/node-server`), and `src/index.ts` re-exports `createApp` for tests.

```sh
# from the repo root
npm run dev --workspace @bird-watch/admin-api
# → "Admin API listening on http://localhost:8788"  (PORT overridable)
```

Required env for local dev (`src/local.ts`, `src/storage.ts`):

```sh
export DATABASE_URL="postgres://<USER>:<PASSWORD>@localhost:5432/birdwatch"
export ADMIN_API_TOKEN="<ANY_NON_EMPTY_STRING>"   # boot fails if empty
export R2_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
export R2_ACCESS_KEY_ID="<YOUR_R2_KEY_ID>"
export R2_SECRET_ACCESS_KEY="<YOUR_R2_SECRET>"
```

Then exercise it (the `/admin/*` routes require the bearer header; `/health`
does not):

```sh
curl -s localhost:8788/health
# {"ok":true}

curl -s -X PUT localhost:8788/admin/silhouettes/family/cuculidae \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -F "file=@./cuckoo.svg"
# {"url":"https://silhouettes.bird-maps.com/family/cuculidae.<sha>.svg","key":"...","pathD":"..."}
```

If `R2_*` / Cloudflare env is unset, the upload itself fails (R2) or the cache
purge is skipped with an `X-Purge-Status: failed` response header — the DB write
still succeeds.

### Prefer the CLI in practice

Day-to-day operators use the root-level wrapper rather than raw `curl`:

```sh
npm run silhouette set <family-code> <path-to-svg>
npm run silhouette unset <family-code>
```

It reads `ADMIN_API_URL` and `ADMIN_API_TOKEN` from the env and posts the
multipart `file` field for you (`scripts/curation/silhouette.mjs`). The end-to-end
operator procedure — minting/rotating the token, the Phylopic-SVG flattening
caveat, and post-deploy smoke steps — lives in the runbook:
[`docs/runbooks/silhouette-override.md`](../../docs/runbooks/silhouette-override.md).
For sourcing the SVG art itself, see the `curating-fallback-silhouettes` skill
(`.claude/skills/curating-fallback-silhouettes/SKILL.md`).

## Reference

### Endpoints

| Method | Path | Auth | Behavior |
| --- | --- | --- | --- |
| `GET` | `/health` | none | `{"ok":true}` |
| `PUT` | `/admin/silhouettes/family/:code` | Bearer | Multipart `file` (SVG) → validate → R2 `PUT` → `UPDATE family_silhouettes SET svg_url, svg_data` → Cloudflare purge. Returns `{ url, key, pathD }`. |
| `DELETE` | `/admin/silhouettes/family/:code` | Bearer | R2 `DELETE` of the prior object → `UPDATE family_silhouettes SET svg_url = NULL, svg_data = NULL` → Cloudflare purge. Returns `{ ok:true }`. |
| `PUT` | `/admin/species-photos/:speciesCode` | Bearer | JSON `{ sourceUrl, attribution, license }` → license + species-existence check → server-side fetch of `sourceUrl` → image validate → R2 `PUT` (photos bucket) → `insertSpeciesPhoto` upsert → Cloudflare purge. Returns `{ url, key }`. |

`:code` (silhouettes) must match `^[a-z]+$` (lowercase letters only) and
`:speciesCode` (photos) must match `^[a-z0-9]+$` — otherwise `400`.
The family row must already exist in `family_silhouettes`, and the species row
in `species_meta`, or the request `404`s (the admin-api overrides existing
rows, it does not create families or species).

### Species-photo swap (`PUT /admin/species-photos/:speciesCode`)

Pushes an operator-approved replacement **detail-panel** photo live. The
**curation tool's `apply-swaps` step** (Slice 8) calls this per species after an
operator approves a candidate; it ships a `sourceUrl`, not bytes, so the
admin-api fetches and re-validates the image itself. Write sequence (mirrors the
silhouette handler's **R2-before-DB** ordering):

1. **License backstop** — `license` must re-pass the `cc-by` / `cc-by-sa` /
   `cc0` allowlist (case-insensitive; NC/ND denied). This is a server-side
   re-check even though the local tool already filtered — the endpoint is a
   public surface and a mis-tagged image must never go live (`400` on deny,
   before any fetch).
2. **Species existence** — `species_code` must exist in `species_meta`
   (`404` otherwise; no R2 write).
3. **Server-side fetch** of `sourceUrl` (15s timeout) — must `200` and carry an
   image content-type; the body is validated for magic bytes (jpeg/png/webp/avif
   incl. the `WEBP` fourCC at bytes 8-11) and a ≥1 KB floor (`400` otherwise).
4. **R2 `PUT`** to the `birdwatch-photos` bucket at a content-hashed key
   `species/<code>.<sha8>.<ext>`, served `immutable, max-age=1yr`.
5. **`insertSpeciesPhoto` upsert** on `(species_code, 'detail-panel')` — only
   `url`/`attribution`/`license` are written; taxonomy columns are untouched.
   On a DB failure *after* the R2 upload the request `5xx`s and the uploaded
   object is left orphaned (hygiene, not breakage) — no broken-image row.
6. **Prior R2 object** (if any) is best-effort deleted (content-hashed keys
   never collide, so the old immutable object would otherwise leak per swap).
7. **Cloudflare purge** of `https://<API_HOST>/api/species/<code>`; a failure is
   non-fatal (`X-Purge-Status: failed` header, still `200`).

```sh
curl -X PUT "https://admin.bird-maps.com/admin/species-photos/norcar" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sourceUrl":"https://static.inaturalist.org/photos/12345/medium.jpg","attribution":"(c) photographer, CC-BY","license":"cc-by"}'
# {"url":"https://photos.bird-maps.com/species/norcar.<sha>.jpg","key":"species/norcar.<sha>.jpg"}
```

The apply step is driven by the curation tool's `apply-swaps` action (Slice 8),
which reuses the `ADMIN_API_URL` / `ADMIN_API_TOKEN` env precedent.

### Auth model (`src/auth.ts`)

`bearerAuth(token)` middleware guards `/admin/*`. The request's
`Authorization: Bearer <token>` value is compared to `ADMIN_API_TOKEN` with a
constant-time compare (`node:crypto` `timingSafeEqual`, length-guarded). A
missing/malformed header or any mismatch returns `401`. The middleware throws at
construction if `ADMIN_API_TOKEN` is empty, so a misconfigured deploy fails to
boot rather than serving an open endpoint. Cloud Run IAM allows public invoke —
the bearer token is the auth boundary, not network ACLs — so **rotate the token
on any leak** (runbook).

### SVG validation contract (`src/validate.ts`)

Uploads are checked against an allow-list before any side effect; a failure
returns `400` naming the rule:

- body non-empty and ≤ 64 KB
- contains an `<svg>` element
- exactly one `<path>` element; no `<g>`, `<style>`, `<script>`, `<defs>`, `<use>`
- no `on*` event-handler attribute; no `xlink:*` attribute
- `viewBox`, if present, equals `0 0 24 24`
- `<path>` has a `d` attribute whose value matches the path-data charset
  (digits, the SVG command letters, space, `-`, `.`, `,`) — the same check the
  frontend's silhouette fallback uses (issue #271)

On success the verbatim source bytes go to R2 and the extracted `d` string is
written to `family_silhouettes.svg_data`.

### Storage & purge flow

- **R2** (`src/storage.ts`, `@aws-sdk/client-s3` against the R2 S3-compatible
  endpoint): objects are content-addressed — key `family/<code>.<sha8>.svg`,
  uploaded with `Content-Type: image/svg+xml` and
  `Cache-Control: public, max-age=31536000, immutable`. The public URL is
  `<SILHOUETTES_PUBLIC_PREFIX>/<key>` (default
  `https://silhouettes.bird-maps.com`). On `PUT`, R2 is written **first**; the
  DB pointer is updated only after a successful upload (a DB row pointing at a
  missing key would render broken images). Any prior object is deleted
  **between** the new upload and the DB update — i.e. before the swap, not
  after; R2 cleanup failures are non-fatal (logged), the DB write is the
  load-bearing step.
- **Cloudflare purge** (`src/purge.ts`): a single-file `purge_cache` POST for
  `https://<API_HOST>/api/silhouettes` (default host `api.bird-maps.com`), so
  the next read returns the new silhouette. A failed/timed-out purge (5s) sets
  the `X-Purge-Status: failed` response header but does not fail the request —
  recover with `scripts/cache/purge-silhouettes-cache.sh` (runbook).

### Environment variables

| Var | Required | Default | Used by |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | `family_silhouettes` reads/writes |
| `ADMIN_API_TOKEN` | yes | — | bearer auth; empty → boot fails |
| `R2_ENDPOINT` | yes | — | R2 S3 client |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | yes (prod) | — | R2 credentials |
| `R2_BUCKET_NAME` | no | `bird-maps-silhouettes` | R2 target bucket (silhouettes) |
| `SILHOUETTES_PUBLIC_PREFIX` | no | `https://silhouettes.bird-maps.com` | public URL prefix written to DB (silhouettes) |
| `R2_PHOTOS_BUCKET` | no | `birdwatch-photos` | R2 target bucket (species photos) |
| `SPECIES_PHOTOS_PUBLIC_PREFIX` | no | `https://photos.bird-maps.com` | public URL prefix written to DB (species photos) |
| `CLOUDFLARE_ZONE_ID` / `CLOUDFLARE_API_TOKEN` | for purge | — | `purge_cache` call |
| `API_HOST` | no | `api.bird-maps.com` | purge target host |
| `PORT` | no | `8788` (local) / `8080` (container) | listen port |

### Deploy target

Deployed as the GCP **Cloud Run v2 service `bird-admin-api`** (us-west1),
scale-to-zero (`min_instance_count = 0`, `max_instance_count = 2`), with all
secret-bound env wired from Secret Manager and a Cloud SQL Auth Proxy socket
mount for the database (`infra/terraform/admin-api.tf`). The container is built
from this directory's `Dockerfile` (multi-stage, monorepo-root context, runs
`node services/admin-api/dist/local.js`). The image tag is rolled forward by
`.github/workflows/deploy-admin-api.yml`; Terraform `ignore_changes` on the
container image keeps `terraform apply` from reverting CD deploys.

There is **no** `admin.bird-maps.com` custom-domain mapping in committed
Terraform — access the service via its `*.run.app` URL (`terraform output
admin_api_url`, or `gcloud run services describe bird-admin-api`). See the
runbook for the exact commands.

## Dependencies

`@bird-watch/db-client` (typed `pg` pool, `family_silhouettes` access),
`@bird-watch/shared-types`, `hono` + `@hono/node-server`, and
`@aws-sdk/client-s3` (R2). See `package.json`.

## Tests

```sh
npm run test --workspace @bird-watch/admin-api   # vitest
```

`app.test.ts` runs against a real Postgres + PostGIS via
`@testcontainers/postgresql` (no DB mocks — repo convention); R2 is stubbed with
`aws-sdk-client-mock` and the Cloudflare purge is faked. `auth.ts`, `storage.ts`,
`purge.ts`, and `validate.ts` have unit coverage.
