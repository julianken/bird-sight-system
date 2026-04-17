# bird-sight-system

Visualize Arizona bird sightings on a stylized ecoregion map.

Status: **design + plans only** — no application code yet. Execution begins from `docs/plans/2026-04-16-plan-1-db-foundation.md`.

## What it is

A web app that divides Arizona into 9 birding-meaningful ecoregions (Sonoran Desert, Sky Islands sub-ranges, Colorado Plateau, etc.) rendered as flat geometric SVG. Each region surfaces recent eBird sightings as bird-silhouette badges, grouped by species with a count chip. Clicking a region expands it inline; URL state makes any view shareable.

## Architecture

Three external dependencies + four internal services. Monorepo. Everything provisioned by Terraform.

- **eBird API** → polled every 30 min by the Ingestor
- **Phylopic** + **EPA / BCR ecoregions** → one-time seed
- **Ingestor** (GCP Cloud Run Job, Cloud Scheduler-triggered) → upserts to Postgres, stamps `region_id` via PostGIS
- **Read API** (GCP Cloud Run Service, scale-to-zero) → serves typed JSON with per-endpoint cache TTLs
- **Postgres + PostGIS** (Neon, serverless, scale-to-zero) → persistent rolling store, analytics-ready
- **Frontend** (React + Vite, Cloudflare Pages) → stylized SVG map, inline-expansion, filters

Compute and DB are both true serverless — scale to zero, $0/month at hobbyist usage. Everything ships as Docker containers, so the same images move to AWS Fargate / Azure Container Apps / Fly Machines / Kubernetes with config-only changes.

See `docs/specs/2026-04-16-bird-watch-design.md` for the full spec.

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

## Repo layout

```
bird-sight-system/
  docs/
    specs/   ← design docs
    plans/   ← implementation plans (5 sub-projects)
  packages/  ← shared libs (created during Plan 1)
  services/  ← ingestor, read-api (created during Plans 2, 3)
  frontend/  ← React app (created during Plan 4)
  infra/     ← Terraform (created during Plan 5)
  migrations/ ← plain SQL Postgres migrations
```

## Plans

| # | Plan | Tasks |
|---|---|---|
| 1 | DB foundation — monorepo + Postgres + PostGIS + db-client | 22 |
| 2 | Ingestor service — eBird client + scheduled handler | 11 |
| 3 | Read API — Hono routes + cache headers | 9 |
| 4 | Frontend — React + Vite + Playwright E2E | 13 |
| 5 | Infra — Terraform + GCP Cloud Run + Neon + Cloudflare Pages | 12 |

Each plan is fully independent and produces working software on its own.

## Stack at a glance

TypeScript · React 18 · Vite · Hono · `pg` · PostGIS · Vitest · Playwright · Docker · GCP Cloud Run · Cloud Scheduler · Cloudflare Pages · Neon · Terraform.

## Deployment

This project deploys to **GCP Cloud Run + Neon Postgres + Cloudflare Pages** — true serverless, scale-to-zero, hobbyist free tier.

### Prerequisites

- GCP account with a project, `gcloud` CLI authenticated, billing enabled (free tier covers our usage)
- Neon account (Neon dashboard → Settings → API keys)
- Cloudflare account with a zone you control (used for Pages + DNS only)
- eBird API key (free at ebird.org/api/keygen)
- Terraform >= 1.6
- Docker + `docker buildx` for multi-arch builds
- `psql` on `$PATH`

### One-time setup

1. `cp infra/terraform/terraform.tfvars.example infra/terraform/terraform.tfvars` and fill in:
   - `gcp_project_id`, `gcp_region`
   - `neon_api_key`
   - `cloudflare_account_id`, `cloudflare_api_token`, `cloudflare_zone_id`, `domain`
   - `ebird_api_key`
2. `gcloud auth login && gcloud auth application-default login`
3. `cd infra/terraform && terraform init`
4. `./scripts/deploy.sh` — provisions infra, builds + pushes images, deploys frontend
5. `./scripts/smoke-test.sh`

### Subsequent deploys

After code changes: `./scripts/deploy.sh` rebuilds and rolls Cloud Run to the new image. Terraform sees no diff and skips infra.

### Portability

The compute is plain Docker. To migrate to AWS / Azure / Fly:

| Move | What changes | What stays |
|---|---|---|
| **GCP → AWS** | Push Dockerfiles to ECR; deploy to App Runner or Fargate; replace Cloud Scheduler with EventBridge Rules; replace Secret Manager with AWS Secrets Manager | Application code, Neon DB, frontend |
| **GCP → Azure** | Push Dockerfiles to ACR; deploy to Azure Container Apps; replace Cloud Scheduler with Azure Logic Apps or Functions Timer; replace Secret Manager with Key Vault | Application code, Neon DB, frontend |
| **GCP → Fly.io** | Push Dockerfiles to Fly registry; `fly deploy` for the API service; use Fly's Cron Manager (JSON schedules) for arbitrary crons — `fly machines run --schedule` only accepts `hourly`/`daily`/`weekly`/`monthly` literals, which covers the backfill + hotspots jobs but not the 30-minute recent cron | Application code, frontend (could move to Fly too) |
| **Neon → another Postgres** | `pg_dump` from Neon → restore to RDS / Cloud SQL / Azure DB / self-hosted; update `DATABASE_URL` secret | Compute layer, all application code |
