# bird-watch — design

**Date:** 2026-04-16
**Status:** draft, pending user review

## Goal

A web application that lets a user wander Arizona visually and discover what birds have been seen where, recently. The map of Arizona is the centerpiece — a real-geographic MapLibre GL JS map (OpenFreeMap Positron tiles) with clustered eBird observation markers, color-keyed by bird family and augmented with Phylopic silhouettes. Clusters expand on click; a FamilyLegend and FiltersBar let users narrow by family, time window, notable-only, or species. URL state makes any filtered view shareable. Data comes from the eBird API; visual silhouettes from Phylopic.

The system is treated as a microservice architecture, not a single app. The user-facing app is the frontend; the data layer is owned by independent backend services.

## Architecture

Three external dependencies + four internal services.

### External (consumed, not owned)

| Service | Purpose | Cadence |
|---|---|---|
| **eBird API** | Source of all observation and hotspot data for Arizona | Polled every 30 min |
| **Phylopic** | Bird family silhouettes (CC-licensed) | One-time seed |
| **EPA / BCR** | Ecoregion polygon GeoJSON for Arizona | One-time seed |

### Internal (owned, in monorepo)

| Service | Type | Responsibility |
|---|---|---|
| **Ingestor** | Serverless function, scheduled trigger | Pulls eBird data every 30 min, plus daily back-fill; upserts into the DB; stamps each observation with its `region_id` (via PostGIS `ST_Contains`) and `silhouette_id` (via family-code lookup) |
| **Read API** | Serverless function, HTTP, behind CDN | Serves typed JSON to the frontend; sets per-endpoint cache TTLs |
| **PostgreSQL + PostGIS** | Managed serverless database | Persistent rolling store of all observations + reference data; analytics-ready |
| **Frontend** | Static React + Vite, served from CDN | Stylized map UI, badges, inline-expansion drill-in, filter bar |

### Cross-cutting

- **Terraform** — all four internal services provisioned from `infra/terraform/`. Hosting platform: **GCP Cloud Run** for compute (Service for Read API, Job for Ingestor + Cloud Scheduler triggers), **Neon** for Postgres + PostGIS, **Cloudflare Pages** for the static frontend + DNS. The compute artifact is a Docker container, so the same image moves to AWS Fargate / Azure Container Apps / Fly Machines / Kubernetes with config-only changes (see Plan 5's migration table).
- **Connection pooler** — required between serverless functions and Postgres. Currently Neon's built-in pooler endpoint (`-pooler` host suffix). If the Postgres provider changes later, equivalent options exist (Supabase PgBouncer, AWS RDS Proxy, Cloudflare Hyperdrive) — the swap is contained in `db-client`.

## Components

### Frontend (`frontend/`)

The Plan-4 SVG-ecoregion renderer was deleted in PR #166 and replaced with a MapLibre real-geographic map delivered by Plan 7. Components below reflect the shipped architecture; see `docs/plans/2026-04-22-plan-7-map-v1.md` for detail.

| Component | Purpose |
|---|---|
| `MapSurface` | Renders a MapLibre GL JS basemap (OpenFreeMap Positron tiles) scoped to Arizona; hosts the clustered observation layer and OSM + OpenFreeMap attribution per ODbL |
| `ObservationClusterLayer` | GeoJSON source with `cluster: true`; renders circle clusters at low zoom and individual observation points at high zoom, color-keyed by family |
| `ClusterInteraction` | Click/keyboard handlers that zoom into clusters via the Promise-based `getClusterExpansionZoom` API (MapLibre 4.x) and open per-point detail |
| `SpeciesDetailSurface` | Dedicated detail panel (replaced the legacy sidebar in PR #162) for a single species — silhouette, common/sci name, recent-sightings list |
| `FiltersBar` | Time window · notable-only toggle · species search · family filter |
| `ApiClient` | Typed fetch wrapper for the Read API |
| `UrlState` | Bidirectional sync between component state and URL params (`?species=`) |

### Ingestor (`services/ingestor/`)

| Module | Purpose |
|---|---|
| `handler` | Scheduled-trigger entry point |
| `ebird-client` | Wraps eBird API calls; handles auth header, retries, response shape |
| `upsert` | Inserts/updates observations and hotspots; PostGIS handles region assignment in SQL |

### Read API (`services/read-api/`)

| Module | Purpose |
|---|---|
| `handler` | HTTP entry point with route dispatch |
| `routes/observations` | `GET /api/observations?since=Nd&notable=bool&species=&family=` |
| `routes/hotspots` | `GET /api/hotspots` |
| `routes/species` | `GET /api/species/:code` |
| `cache-headers` | Sets per-endpoint `Cache-Control` headers |

### Shared packages (`packages/`)

| Package | Purpose |
|---|---|
| `shared-types` | TypeScript shapes for Observation, Region, Species, Hotspot, FamilySilhouette — used by all internal services |
| `db-client` | Typed query layer over Postgres; used by Ingestor and Read API |

`familyCode → color` and `familyCode → svgData` are no longer a compile-time lookup table: they live in the `family_silhouettes` DB table (see Data model) and are served to the frontend via `GET /api/silhouettes` (PR #172). The previous `@bird-watch/family-mapping` package was deleted in PR #192.

## Data flow

### Ingest path (every 30 minutes)

1. Scheduled trigger fires the Ingestor function.
2. Ingestor calls `eBird-client.fetchRecent("US-AZ", { back: 14 })` → returns up to 10K obs with lat/lng.
3. Ingestor calls `eBird-client.fetchNotable("US-AZ", { back: 14 })` → returns the subset flagged as notable (rare for the area). The set of `(sub_id, species_code)` keys here is used to compute `is_notable=true` on the upsert.
4. For each obs, Ingestor builds an upsert row keyed on `(sub_id, species_code)` to dedup re-fetches; sets `is_notable` based on membership in the notable set.
5. Single SQL `INSERT ... ON CONFLICT ... DO UPDATE` writes all rows. Same query computes `region_id` via `ST_Contains((SELECT geom FROM regions WHERE ST_Contains(geom, ST_MakePoint(lng, lat))), point)` and `silhouette_id` via JOIN against `family_silhouettes`.
6. Ingestor logs run metadata to `ingest_runs` table.

Ingestor does **not** trigger a CDN purge in MVP. Cache freshness is bounded by the `/observations` TTL (30 min), which matches the ingest cadence — so data is never more than ~30 min stale either way. Adding tag-based purge is a future enhancement (see Open questions).

### Daily back-fill (4am UTC)

Same flow as above but iterates over the last 30 calendar days using `/data/obs/{regionCode}/historic/{y}/{m}/{d}` to catch back-dated checklist submissions.

### Query path

1. User loads frontend → `ApiClient` issues parallel calls: `/api/observations?since=14d`, `/api/hotspots`, `/api/silhouettes`.
2. CDN serves cached responses (95%+ hit rate). Cache miss → Read API queries Postgres → response cached with appropriate TTL.
3. Frontend renders MapLibre map with clustered observation markers. URL stays in sync with filter and detail state.
4. Filter changes hit `/api/observations` with new query params (each filter combination is a separate cache key).

## Data model

### `observations`

```sql
CREATE TABLE observations (
  sub_id          TEXT NOT NULL,            -- eBird checklist id
  species_code    TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  geom            GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_MakePoint(lng, lat)) STORED,
  obs_dt          TIMESTAMPTZ NOT NULL,
  loc_id          TEXT NOT NULL,            -- hotspot id (or personal location id)
  loc_name        TEXT,
  how_many        INTEGER,
  is_notable      BOOLEAN DEFAULT false,
  region_id       TEXT REFERENCES regions(id),
  silhouette_id   TEXT REFERENCES family_silhouettes(id),
  ingested_at     TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (sub_id, species_code)
);
CREATE INDEX obs_region ON observations (region_id);
CREATE INDEX obs_species ON observations (species_code);
CREATE INDEX obs_dt ON observations (obs_dt DESC);
CREATE INDEX obs_geom ON observations USING GIST (geom);
```

### `regions`

```sql
CREATE TABLE regions (
  id          TEXT PRIMARY KEY,             -- e.g. "sky-islands-santa-ritas"
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES regions(id),  -- null for top-level ecoregions
  geom        GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  display_color TEXT NOT NULL,              -- hex
  svg_path    TEXT NOT NULL                 -- stylized poligap-style path
);
CREATE INDEX regions_geom ON regions USING GIST (geom);
```

### `hotspots`

```sql
CREATE TABLE hotspots (
  loc_id              TEXT PRIMARY KEY,
  loc_name            TEXT NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  geom                GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_MakePoint(lng, lat)) STORED,
  region_id           TEXT REFERENCES regions(id),
  num_species_alltime INTEGER,
  latest_obs_dt       TIMESTAMPTZ
);
CREATE INDEX hotspots_geom ON hotspots USING GIST (geom);
CREATE INDEX hotspots_region ON hotspots (region_id);
```

### `species_meta`

```sql
CREATE TABLE species_meta (
  species_code  TEXT PRIMARY KEY,
  com_name      TEXT NOT NULL,
  sci_name      TEXT NOT NULL,
  family_code   TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  taxon_order   NUMERIC
);
```

### `family_silhouettes`

```sql
CREATE TABLE family_silhouettes (
  id           TEXT PRIMARY KEY,             -- e.g. "trochilidae" (hummingbirds)
  family_code  TEXT NOT NULL UNIQUE,
  svg_data     TEXT,                         -- inline SVG path; NULL = pending Phylopic curation (see #55)
  color        TEXT NOT NULL,                -- hex
  source       TEXT,                         -- attribution
  license      TEXT,
  creator      TEXT NULL,                    -- Phylopic contributor credit (added migration 1700000016000)
  common_name  TEXT NULL                     -- human-readable family name (added migration 1700000019000)
);
```

### `ingest_runs`

```sql
CREATE TABLE ingest_runs (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,             -- 'recent' | 'notable' | 'backfill' | 'hotspots' | 'taxonomy'
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  obs_fetched     INTEGER,
  obs_upserted    INTEGER,
  status          TEXT NOT NULL,             -- 'running' | 'success' | 'partial' | 'failure'
  error_message   TEXT
);
```

## API contract

All responses JSON. All endpoints idempotent GETs.

```
GET /api/observations?since=14d&notable=false&species=&family=
  → Observation[]
  Cache-Control: public, max-age=1800, stale-while-revalidate=600

GET /api/hotspots
  → Hotspot[]
  Cache-Control: public, max-age=86400, stale-while-revalidate=3600

GET /api/silhouettes
  → FamilySilhouette[]
  Cache-Control: public, max-age=604800, immutable

GET /api/species/:code
  → SpeciesMeta
  Cache-Control: public, max-age=604800
```

Shapes defined in `packages/shared-types/`.

## Caching strategy

- **CDN in front of Read API.** Per-endpoint `Cache-Control` TTLs (table above). `stale-while-revalidate` keeps responses instant for users while CDN refreshes in background.
- **No active cache purge in MVP.** Data freshness is bounded by the `/observations` TTL (30 min), which is aligned with the ingest cadence. A new ingest's data becomes visible to users no later than 30 min after it lands.
- **Future: tag-based purge.** When a chosen CDN supports cache tags (Cloudflare paid, Fastly, AWS CloudFront), the Read API can emit `Cache-Tag: observations` and the Ingestor can purge that tag after a successful run to make new data visible immediately.
- **DB-side caching.** Postgres handles its own buffer cache; no application-level cache needed at the DB layer at this scale.

## Filters (MVP)

Frontend exposes four filters in the FiltersBar; all map to `/api/observations` query params:

| Filter | Param | Default |
|---|---|---|
| Time window | `?since=1d \| 7d \| 14d \| 30d` | `14d` |
| Notable only | `?notable=true` | `false` |
| Species search | `?species=:code` (autocomplete UI on common name → submits species code) | unset |
| Family filter | `?family=:code` (dropdown of AZ families derived from `species_meta`) | unset |

URL state mirrors the filter state in addition to `region` and `species`, so a fully-filtered view is shareable.

## Error handling

**Ingestor failures.** A failed run logs to `ingest_runs.status='failure'` with the error. Subsequent run picks up where it left off (idempotent upserts). Three consecutive failures triggers an alert (Sentry / log-based alarm). User-facing impact: stale data, capped at the last successful ingest's age.

**eBird API outages.** Ingestor catches and logs; falls through to next scheduled run. Read API is unaffected.

**Read API failures.** CDN serves stale cached responses if origin is down (long stale-while-revalidate window). True failure mode: empty data + empty state UI on the frontend.

**DB connection exhaustion.** Mitigated by the connection pooler. Function returns 503 on pool exhaustion; CDN serves stale.

**Frontend errors.** Each component has a fallback: if `/observations` fails, map renders with no markers; if the API is fully unavailable, the app shows a single error screen ("can't load map data"). No silent fallbacks that hide failures.

## Testing strategy

| Layer | Test type | Tooling |
|---|---|---|
| `db-client` | Unit + integration against local Postgres | Vitest, Testcontainers (or local docker-compose Postgres) |
| `ebird-client` | Unit, with mocked HTTP responses | Vitest, MSW |
| `Ingestor handler` | Integration: scheduled trigger → mock eBird → real DB → assert upserted rows | Vitest + Testcontainers |
| `Read API routes` | Integration: HTTP call → real DB → assert response shape + cache headers | Vitest, supertest |
| `Frontend components` | Unit + interaction tests | Vitest, React Testing Library |
| `Frontend map flow` | E2E: load → click region → verify expansion + URL update | Playwright |

Tests do not mock the database — they hit a real Postgres (containerized in CI). The ingest path is too geometry-dependent to mock meaningfully.

## Repo layout

```
bird-watch/
  services/
    ingestor/
      src/
        handler.ts
        ebird-client.ts
        upsert.ts
      package.json
    read-api/
      src/
        handler.ts
        routes/
        cache-headers.ts
      package.json
  frontend/
    src/
      components/
      api/
      geo/
    vite.config.ts
    package.json
  packages/
    shared-types/
    db-client/
    family-mapping/
  migrations/
    1700000001000_enable_postgis.sql
    1700000002000_regions.sql
    1700000003000_family_silhouettes.sql
    … (20 files total, timestamp-prefixed)
  infra/
    terraform/
      main.tf
      ingestor.tf
      read-api.tf
      db.tf
      frontend.tf
      dns.tf
      variables.tf
  docs/
    specs/
      2026-04-16-bird-watch-design.md  (this file)
  package.json                       # workspaces root
  README.md
```

## Out of scope (MVP)

- User accounts, personal bird lists, "your sightings vs everyone else's"
- Push notifications for rare-bird alerts
- Historical trend visualizations (handled later from the same DB)
- Mobile-native apps
- Photo galleries (silhouettes only for MVP per design decision)
- Internationalization (English-only)
- Data outside Arizona

## Open questions (deferred)

- **Animation library for inline expansion.** Framer Motion vs. plain CSS transitions vs. d3 transitions. Decide during frontend implementation.
- **Specific Phylopic silhouettes.** ~15 family silhouettes need to be picked + attributed. Curation step before first ingest.
- **Tag-based cache purge** (post-MVP). If freshness latency becomes a real issue, add `Cache-Tag` headers + Ingestor-side purge call. Mechanism depends on chosen CDN.

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| eBird `maxResults=10000` is undocumented; cap may be lower in practice | Medium | Could miss observations | Verify on first deploy; fall back to per-county pagination if needed |
| Phylopic's family coverage may not include every AZ family | Low | Some families render with generic fallback | Maintain a generic "songbird" silhouette as fallback for any unmapped family |
| Inline-expansion animation complexity may push timeline | Medium | Frontend ships later than expected | Start with a simple CSS scale transform; iterate to spring/Framer if time allows |
| Connection-pooler choice locks us to a Postgres provider | Medium | Migrating providers requires rewriting pooler integration | Keep the `db-client` package thin and pluggable |

## Success criteria for MVP

- A user can load the app and see a real-geographic MapLibre map of Arizona with recent eBird observations rendered as clustered points, color-keyed by bird family (Plan 7 exit criteria).
- Clusters expand smoothly on click/keyboard activation (Promise-based `getClusterExpansionZoom`, MapLibre 4.x); individual points open the species detail surface.
- Apply any of the four filters; URL updates; refreshing preserves state.
- Data freshness: never more than 30 minutes stale during normal operation.
- Cold-load to interactive map: under 2 seconds on broadband.
- Attribution on the map surface credits OpenStreetMap + OpenFreeMap per ODbL (PR #168).
- Zero clicking required to deploy: `terraform apply` provisions everything.
