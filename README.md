# bird-sight-system

Visualize recent US bird sightings on a real-geographic map, scoped by state or ZIP.

Status: **live at [bird-maps.com](https://bird-maps.com)** — shipped 2026-04-19.

## What it is

A map-first web app that renders recent eBird observations across the continental US (CONUS — the 48 contiguous states plus DC) on a full-viewport MapLibre GL JS map (OpenFreeMap tiles, light/dark). The map is always mounted; floating cards anchor to the four corners over an edge-to-edge canvas (top-left identity + scope, top-right controls pill, bottom-left FamilyLegend, bottom-right attribution). There is no nav bar and no separate feed or species surface — the app is scope-driven, not tab-driven.

Observations are keyed to bird family by color and silhouette (silhouettes sourced from Phylopic). At low zoom the Read API returns server-side aggregated buckets; below max zoom, observations render as MapLibre supercluster pills; at max zoom, markers de-cluster into an adaptive 4×4 cell grid (clicking a cell opens a species popover). Filters (time window, notable-only, species, family) live in a floating sheet opened from the controls pill, and FamilyLegend is a floating corner card. URL state (`?state=`, `?scope=us`, filters, `?detail=`) makes any view shareable.

The system covers the whole CONUS by default but opens on a scope chooser; see **Scope model** below.

## Scope model

Scope is a discriminated union with three landing states, encoded in the URL (`frontend/src/state/url-state.ts`):

- **Unscoped** (bare URL) — the default landing. The map mounts behind an inert, focus-trapped scope-chooser modal and fires zero `/api/observations` requests until a scope is picked.
- **State** (`?state=US-XX`) — the only shareable scope unit. The server applies a hard PostGIS `ST_Intersects` clip against a `state_boundaries` table (49 seeded CONUS polygons). A Sketch-style "artboard mask" paints everything outside the selected state a flat theme-aware gray, and `maxBounds` is padded so small states can zoom out onto the gray field.
- **Whole-US** (`?scope=us`) — the de-emphasized CONUS escape hatch.

ZIP entry is transient (never persisted): a ZIP resolves to a state plus a `flyTo` camera via a vendored Census ZCTA index. State codes are validated against the 49-code CONUS allowlist (`CONUS_STATE_CODES` in `@bird-watch/shared-types`). No Alaska, Hawaii, or territories.

Scope-selector and artboard-mask design: `docs/plans/2026-05-28-state-scope-selector.md`, `docs/plans/2026-05-29-state-artboard-mask.md`. Map-first floating-card layout: `docs/design/2026-05-30-floating-ui-design-spec.md` and the "Floating-card four-corner anchor contract" section of `CLAUDE.md`.

## Architecture

Monorepo, everything provisioned by Terraform. Three deployable Node services (`ingestor`, `read-api`, `admin-api`) and two Cloudflare Workers, fed by four external enrichment sources.

External sources:

- **eBird API** — recent + notable observations (intersected for the `is_notable` flag) and the monthly taxonomy ref.
- **Phylopic** — family silhouettes.
- **iNaturalist** — species photos and Wikipedia-title resolution.
- **Wikipedia REST** — species descriptions and lead-image photos.

Internal services:

- **Ingestor** (GCP Cloud Run Jobs, Cloud Scheduler-triggered) — CLI dispatched on a `kind` argument (`recent`, `hotspots`, `backfill`, `backfill-extended`, `taxonomy`, `photos`, `descriptions`, `prune`, `cache-warm`, `digest`, plus probe kinds). The `recent` lane is **national** (`regionCode 'US'`, every 30 min); hotspots and the default backfill remain US-AZ, with national coverage achieved via a per-state backfill fan-out (`--state=US-XX`). Entry point: `services/ingestor/src/cli.ts`. Upserts to Postgres, stamps `silhouette_id` via family-code lookup, archives pruned rows to GCS Parquet, warms the Cloudflare cache, and sends a daily SendGrid health digest. Pings Healthchecks.io as a liveness heartbeat.
- **Read API** (GCP Cloud Run Service `bird-read-api`, scale-to-zero, behind Cloudflare CDN at `api.bird-maps.com`) — platform-agnostic Hono app (`createApp({ pool })` exported from `services/read-api/src/app.ts`). Serves typed JSON: `GET /health`, `/api/hotspots`, `/api/observations`, `/api/silhouettes`, `/api/states`, `/api/species/:code`, `/api/species/:code/phenology`. `/api/observations` supports `bbox` filtering, zoom-aware aggregated-bucket mode (below zoom 6), the `?state=` `ST_Intersects` clip, strict allowlist param validation, and a row-cap brake surfaced as `meta.truncated`. National-scale guards: a Hono in-memory token-bucket rate limiter behind the Cloudflare rate-limit ruleset, plus per-endpoint `Cache-Control` (`s-maxage` + `stale-while-revalidate`) respected by the Cloudflare `/api/*` cache rule and Smart Tiered Cache.
- **Admin API** (GCP Cloud Run Service `bird-admin-api`, operator-only, bearer-auth) — Hono app for silhouette overrides: `PUT`/`DELETE /admin/silhouettes/family/:code` validate and upload an SVG to a Cloudflare R2 bucket, update the `family_silhouettes` table, and purge the Cloudflare cache. Operator reference: [`docs/runbooks/silhouette-override.md`](docs/runbooks/silhouette-override.md).
- **Postgres + PostGIS** — GCP Cloud SQL for Postgres 16 (`birdwatch-pg16`, `db-g1-small`, `us-west1`, zonal), reached over the Cloud SQL Auth Proxy. Persistent rolling store; 14-day retention with Parquet cold-storage on GCS (queryable via a BigQuery external table).
- **Frontend** (React + Vite, Cloudflare Pages) — map-first always-mounted MapLibre GL JS (5.x) canvas: supercluster pills + adaptive 4×4 grid de-clustering, server-side aggregation at low zoom, floating FamilyLegend, floating Filters sheet, and four-corner floating chrome. Analytics via Microsoft Clarity (prod-only, env-gated).

Cloudflare Workers (source in `infra/workers/`, not npm workspaces): `birdwatch-silhouette-server` and `birdwatch-photo-server` serve the R2 silhouette/photo buckets at `silhouettes.bird-maps.com` and `photos.bird-maps.com`.

> The service topology has moved past `docs/specs/2026-04-16-bird-watch-design.md` (which predates the national flip, the admin-api, the Cloud SQL migration, and the map-first re-architecture). Treat the spec as historical design rationale; `CLAUDE.md` ("Repo state" + the floating-card contract) is the current high-trust prose.

## Local development

**Prerequisites:** Node >= 20, Docker (for Postgres + PostGIS), npm >= 9.

```bash
# Install all workspace dependencies
npm install

# Start local Postgres with PostGIS
npm run db:up

# Run migrations (seeds are applied as SQL migrations)
npm run db:migrate

# Run all tests
npm run test
```

Set `DATABASE_URL` in a `.env` file at the repo root (not committed):

```
DATABASE_URL=postgres://birdwatch:birdwatch@localhost:5432/birdwatch
```

For the frontend dev server and the live UI-verification protocol (5 canonical viewports × 2 themes, Playwright MCP), see the **Testing** section of `CLAUDE.md`.

## Deployment

This project deploys to **GCP Cloud Run + Cloud SQL Postgres 16 + Cloudflare (Pages, R2, Workers)**. Cloud Run services scale to zero; the Cloud SQL instance is an always-on `db-g1-small` (not serverless), guarded by a $100/mo GCP billing budget. Everything compute-side ships as Docker containers, so the same images move to AWS Fargate / Azure Container Apps / Fly Machines / Kubernetes with config-only changes.

### Prerequisites

- GCP account with a project, `gcloud` CLI authenticated, billing enabled
- Cloudflare account with a zone you control (Pages + DNS + R2 + Workers)
- eBird API key (free at ebird.org/api/keygen)
- Terraform >= 1.6
- Docker + `docker buildx` for multi-arch builds
- `psql` on `$PATH`

### One-time setup

1. `cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars` and fill in (reconcile against `infra/terraform/variables.tf`):
   - `gcp_project_id`, `gcp_region`, `gcp_billing_account_id`
   - `cloudflare_account_id`, `cloudflare_api_token`, `cloudflare_zone_id`, `domain`
   - `ebird_api_key`
   - `alert_email`
2. `gcloud auth login && gcloud auth application-default login`
3. `cd infra/terraform && terraform init` — the database is Cloud SQL Postgres 16, provisioned through the `google` provider (no separate DB-vendor account or API key required).
4. `./scripts/deploy.sh` — runs `terraform apply -auto-approve` to provision infra. The migrations, read-api, ingestor, and frontend deploys are not done by this script; they run in CI (the `.github/workflows/deploy-*.yml` workflows) on push to `main`. The script just echoes which workflow owns each.
5. `./scripts/smoke-test.sh`

### Subsequent deploys

After code changes, the per-service GitHub Actions workflows (`deploy-migrations.yml`, `deploy-read-api.yml`, `deploy-ingestor.yml`, `deploy-frontend.yml`) build the images and roll Cloud Run / Pages to the new revisions on push to `main`. `./scripts/deploy.sh` only applies Terraform (infra changes); it does not build, push, or deploy images itself. Terraform uses `ignore_changes` on the container image, so `terraform apply` does not roll back a CD deploy.

### Portability

The compute is plain Docker. To migrate to AWS / Azure / Fly:

| Move | What changes | What stays |
|---|---|---|
| **GCP → AWS** | Push Dockerfiles to ECR; deploy to App Runner or Fargate; replace Cloud Scheduler with EventBridge Rules; replace Secret Manager with AWS Secrets Manager; repoint the DB at RDS for Postgres | Application code, frontend, the Postgres schema |
| **GCP → Azure** | Push Dockerfiles to ACR; deploy to Azure Container Apps; replace Cloud Scheduler with Azure Logic Apps or Functions Timer; replace Secret Manager with Key Vault; repoint the DB at Azure Database for PostgreSQL | Application code, frontend, the Postgres schema |
| **GCP → Fly.io** | Push Dockerfiles to Fly registry; `fly deploy` for the API services; replace Cloud Scheduler with a Fly-side scheduler for the ingestor lanes | Application code, frontend |

The data layer is portable too: `pg_dump` from Cloud SQL → restore to any Postgres 16 + PostGIS host, then update the `DATABASE_URL` secret. The R2 buckets and Cloudflare Workers are Cloudflare-specific and would need an equivalent object store + edge function on a non-Cloudflare target.

## Repo layout

```
bird-sight-system/
  docs/
    specs/   ← design docs (2026-04-16 spec is historical)
    plans/   ← implementation plans (39 entries)
    design/  ← floating-UI design spec
    runbooks/ ← operator references
  packages/  ← shared libs (db-client, shared-types)
  services/  ← ingestor, read-api, admin-api
  frontend/  ← React app
  infra/     ← Terraform + Cloudflare Workers (not an npm workspace)
  migrations/ ← plain SQL Postgres migrations
  scripts/   ← deploy.sh, smoke-test.sh, zip-etl/, …
```

npm workspaces are `packages/*`, `services/*`, and `frontend`. (`packages/family-mapping` is a stale orphan directory with no `package.json` or source — its family-code→color logic now lives in `frontend/src/data/family-color.ts` and the `family_silhouettes` table.)

## Plans

Implementation plans live under `docs/plans/` (39 entries). Plans 1–5 are the original build sequence (DB foundation → ingestor → read-api → frontend → infra); Plans 6–7 and a long tail of post-launch epics shipped after the 2026-04-19 launch.

Notable post-launch plans on disk:

- `2026-05-14-adaptive-cluster-grid` — adaptive 4×4 cell grid (retired the prior mosaic + auto-spider clustering)
- `2026-05-15`/`16-cell-species-popover-phase-0..3`, `2026-05-15-marker-overlap-deconflict`, `2026-05-16-adaptive-grid-tile-contrast`
- `2026-05-13-silhouette-admin-api`, `2026-05-12-backfill-38-family-silhouettes`
- `2026-05-17-cloud-sql-migration` (Neon → Cloud SQL Postgres 16)
- `2026-05-17-going-national` (US-AZ → CONUS recent lane), `2026-05-17-monitoring-and-alerts`
- `2026-05-20-observations-cold-storage` (GCS Parquet + BigQuery), `2026-05-18-pmtiles-observation-tiles` (planned/deferred — not the live render path)
- `2026-05-28-state-scope-selector`, `2026-05-29-state-artboard-mask`
- the map-first re-architecture epic (#761) — full-viewport always-mounted canvas, feed surface removed, floating-card chrome

The `spider-v2` auto-spider plan is retired (the auto-spider + mosaic code was deleted when the adaptive cluster grid cut over).

## Stack at a glance

TypeScript · React 18 · Vite · Hono · `pg` · PostGIS · MapLibre GL JS (5.x) · Vitest · Playwright · Docker · GCP Cloud Run · Cloud Scheduler · Cloud SQL Postgres 16 · Cloud Monitoring · GCS · BigQuery · Cloudflare (Pages, R2, Workers) · Microsoft Clarity · iNaturalist · Wikipedia · SendGrid · Terraform. Live at [bird-maps.com](https://bird-maps.com) since 2026-04-19.

## Operator runbooks

- Silhouette upload (technical reference) — [`docs/runbooks/silhouette-override.md`](docs/runbooks/silhouette-override.md)
- Curating fallback silhouettes (human-in-the-loop workflow) — [`.claude/skills/curating-fallback-silhouettes/SKILL.md`](.claude/skills/curating-fallback-silhouettes/SKILL.md)
