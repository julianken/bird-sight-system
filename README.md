# bird-sight-system

Visualize Arizona bird sightings on a stylized ecoregion map.

Status: **design + plans only** — no application code yet. Execution begins from `docs/superpowers/plans/2026-04-16-plan-1-db-foundation.md`.

## What it is

A web app that divides Arizona into 9 birding-meaningful ecoregions (Sonoran Desert, Sky Islands sub-ranges, Colorado Plateau, etc.) rendered as flat geometric SVG. Each region surfaces recent eBird sightings as bird-silhouette badges, grouped by species with a count chip. Clicking a region expands it inline; URL state makes any view shareable.

## Architecture

Three external dependencies + four internal services. Monorepo. Everything provisioned by Terraform.

- **eBird API** → polled every 30 min by the Ingestor
- **Phylopic** + **EPA / BCR ecoregions** → one-time seed
- **Ingestor** (Cloudflare Worker, scheduled) → upserts to Postgres, stamps `region_id` via PostGIS
- **Read API** (Cloudflare Worker, HTTP) → serves typed JSON with per-endpoint cache TTLs
- **Postgres + PostGIS** (Neon, serverless) → persistent rolling store, analytics-ready
- **Frontend** (React + Vite, Cloudflare Pages) → stylized SVG map, inline-expansion, filters

See `docs/superpowers/specs/2026-04-16-bird-watch-design.md` for the full spec.

## Repo layout

```
bird-sight-system/
  docs/superpowers/
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
| 5 | Infra — Terraform + Cloudflare + Neon + deploy scripts | 12 |

Each plan is fully independent and produces working software on its own.

## Stack at a glance

TypeScript · React 18 · Vite · Hono · `pg` · PostGIS · Vitest · Playwright · Cloudflare Workers · Cloudflare Pages · Cloudflare Hyperdrive · Neon · Terraform.
