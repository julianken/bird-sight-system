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
