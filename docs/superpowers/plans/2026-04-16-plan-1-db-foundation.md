# Database Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the monorepo skeleton, the Postgres + PostGIS schema with migrations, seed data for regions and family silhouettes, and the typed `db-client` + `shared-types` + `family-mapping` packages — fully tested against a real Postgres in containers.

**Architecture:** npm workspaces monorepo. Plain SQL migrations under `migrations/` run by `node-pg-migrate`. `packages/db-client` wraps the `pg` driver with typed query functions. `packages/shared-types` defines the TypeScript shapes used by every internal service. `packages/family-mapping` holds family-code → silhouette/color lookup tables. Vitest + Testcontainers run integration tests against ephemeral Postgres instances.

**Tech Stack:** TypeScript 5, npm workspaces, `pg`, `node-pg-migrate`, Vitest, `@testcontainers/postgresql`, PostGIS 3.4 on Postgres 16, Docker.

---

### Task 1: Initialize the monorepo skeleton and commit the spec

**Files:**
- Create: `bird-watch/.gitignore`
- Create: `bird-watch/package.json`
- Create: `bird-watch/tsconfig.base.json`
- Create: `bird-watch/README.md`

- [ ] **Step 1: Initialize git on the project**

```bash
cd /Users/j/repos/bird-watch
git init
git checkout -b main
git config user.email "you@example.com"
git config user.name "Your Name"
```

Expected: `Initialized empty Git repository in /Users/j/repos/bird-watch/.git/`

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
dist/
build/
.env
.env.local
*.log
.DS_Store
.superpowers/
.idea/
.vscode/
coverage/
.cache/
.turbo/
.wrangler/
*.tsbuildinfo
```

- [ ] **Step 3: Write root `package.json`**

```json
{
  "name": "bird-watch",
  "private": true,
  "type": "module",
  "workspaces": [
    "packages/*",
    "services/*",
    "frontend"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "build": "npm run build --workspaces --if-present",
    "lint": "npm run lint --workspaces --if-present",
    "db:up": "docker-compose up -d db",
    "db:down": "docker-compose down",
    "db:migrate": "node-pg-migrate up -m migrations -d $DATABASE_URL",
    "db:rollback": "node-pg-migrate down -m migrations -d $DATABASE_URL",
    "db:seed": "tsx scripts/seed.ts"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "node-pg-migrate": "^7.4.0",
    "pg": "^8.11.3",
    "tsx": "^4.7.0",
    "typescript": "^5.3.3"
  },
  "engines": {
    "node": ">=20"
  }
}
```

- [ ] **Step 4: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "lib": ["ES2022"],
    "resolveJsonModule": true
  },
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Write `README.md`**

```markdown
# bird-watch

Visualize Arizona bird sightings on a stylized map. See `docs/superpowers/specs/2026-04-16-bird-watch-design.md` for the full design.

## Local development

```bash
npm install
npm run db:up         # starts local Postgres + PostGIS
npm run db:migrate    # apply schema
npm run db:seed       # load seed regions + silhouettes
npm test              # run all workspace tests
```

## Repo layout

- `packages/` — shared libraries used by services and frontend
- `services/` — backend services (ingestor, read-api)
- `frontend/` — React + Vite app
- `migrations/` — plain SQL Postgres migrations
- `infra/terraform/` — Infrastructure as Code
- `docs/superpowers/` — design specs and implementation plans
```

- [ ] **Step 6: Install dependencies**

Run:
```bash
npm install
```

Expected: `pg`, `node-pg-migrate`, `tsx`, `typescript`, `@types/node` installed under `node_modules`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json tsconfig.base.json README.md docs/
git commit -m "chore: initialize monorepo skeleton and commit design spec"
```

---

### Task 2: docker-compose for local Postgres + PostGIS

**Files:**
- Create: `bird-watch/docker-compose.yml`
- Create: `bird-watch/.env.example`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgis/postgis:16-3.4
    container_name: birdwatch_pg
    environment:
      POSTGRES_DB: birdwatch
      POSTGRES_USER: birdwatch
      POSTGRES_PASSWORD: birdwatch
    ports:
      - "5432:5432"
    volumes:
      - birdwatch_pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U birdwatch -d birdwatch"]
      interval: 5s
      timeout: 3s
      retries: 10

volumes:
  birdwatch_pgdata:
```

- [ ] **Step 2: Write `.env.example`**

```
DATABASE_URL=postgres://birdwatch:birdwatch@localhost:5432/birdwatch
EBIRD_API_KEY=your-ebird-api-key-here
```

- [ ] **Step 3: Bring up Postgres**

```bash
docker-compose up -d db
```

Expected: container `birdwatch_pg` starts and reaches healthy state within ~10s.

- [ ] **Step 4: Verify PostGIS is loaded**

```bash
docker-compose exec db psql -U birdwatch -d birdwatch -c "CREATE EXTENSION IF NOT EXISTS postgis; SELECT postgis_version();"
```

Expected: a row showing `3.4 USE_GEOS=1 USE_PROJ=1 USE_STATS=1`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker-compose for local Postgres + PostGIS"
```

---

### Task 3: Migrations infrastructure

**Files:**
- Create: `bird-watch/migrations/.keep`
- Modify: `bird-watch/package.json` (already has scripts from Task 1)
- Create: `bird-watch/.env`

- [ ] **Step 1: Create migrations directory placeholder**

```bash
mkdir -p migrations
touch migrations/.keep
```

- [ ] **Step 2: Create local `.env`**

```
DATABASE_URL=postgres://birdwatch:birdwatch@localhost:5432/birdwatch
EBIRD_API_KEY=changeme
```

This file is gitignored. Used only for local development.

- [ ] **Step 3: Verify `node-pg-migrate` runs against the live DB**

```bash
set -a; source .env; set +a
npm run db:migrate
```

Expected: `Migrations complete!` (no migrations yet, but the tool succeeds and creates the `pgmigrations` tracking table).

Verify table exists:
```bash
docker-compose exec db psql -U birdwatch -d birdwatch -c "\dt"
```

Expected: a row for `pgmigrations`.

- [ ] **Step 4: Commit**

```bash
git add migrations/.keep
git commit -m "chore: scaffold migrations directory"
```

---

### Task 4: Migration 001 — enable PostGIS extension

**Files:**
- Create: `bird-watch/migrations/1700000001_enable_postgis.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE EXTENSION IF NOT EXISTS postgis;

-- Down Migration
-- We do NOT drop PostGIS in down — too risky if other DBs share the cluster.
```

- [ ] **Step 2: Apply the migration**

```bash
set -a; source .env; set +a
npm run db:migrate
```

Expected: `Migrating files: 1700000001_enable_postgis` then `Migrations complete!`.

- [ ] **Step 3: Verify**

```bash
docker-compose exec db psql -U birdwatch -d birdwatch -c "SELECT extname FROM pg_extension WHERE extname='postgis';"
```

Expected: one row with `postgis`.

- [ ] **Step 4: Commit**

```bash
git add migrations/1700000001_enable_postgis.sql
git commit -m "feat(db): enable PostGIS extension"
```

---

### Task 5: Migration 002 — `regions` table

**Files:**
- Create: `bird-watch/migrations/1700000002_regions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE regions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  parent_id     TEXT REFERENCES regions(id),
  geom          GEOMETRY(MULTIPOLYGON, 4326) NOT NULL,
  display_color TEXT NOT NULL,
  svg_path      TEXT NOT NULL
);
CREATE INDEX regions_geom_idx ON regions USING GIST (geom);
CREATE INDEX regions_parent_idx ON regions (parent_id);

-- Down Migration
DROP TABLE IF EXISTS regions;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d regions"
```

Expected: table with columns `id, name, parent_id, geom, display_color, svg_path`.

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000002_regions.sql
git commit -m "feat(db): add regions table with PostGIS geometry"
```

---

### Task 6: Migration 003 — `family_silhouettes` table

**Files:**
- Create: `bird-watch/migrations/1700000003_family_silhouettes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE family_silhouettes (
  id           TEXT PRIMARY KEY,
  family_code  TEXT NOT NULL UNIQUE,
  svg_data     TEXT NOT NULL,
  color        TEXT NOT NULL,
  source       TEXT,
  license      TEXT
);

-- Down Migration
DROP TABLE IF EXISTS family_silhouettes;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d family_silhouettes"
```

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000003_family_silhouettes.sql
git commit -m "feat(db): add family_silhouettes table"
```

---

### Task 7: Migration 004 — `species_meta` table

**Files:**
- Create: `bird-watch/migrations/1700000004_species_meta.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE species_meta (
  species_code  TEXT PRIMARY KEY,
  com_name      TEXT NOT NULL,
  sci_name      TEXT NOT NULL,
  family_code   TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  taxon_order   NUMERIC
);
CREATE INDEX species_meta_family_idx ON species_meta (family_code);

-- Down Migration
DROP TABLE IF EXISTS species_meta;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d species_meta"
```

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000004_species_meta.sql
git commit -m "feat(db): add species_meta table"
```

---

### Task 8: Migration 005 — `hotspots` table

**Files:**
- Create: `bird-watch/migrations/1700000005_hotspots.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE hotspots (
  loc_id              TEXT PRIMARY KEY,
  loc_name            TEXT NOT NULL,
  lat                 DOUBLE PRECISION NOT NULL,
  lng                 DOUBLE PRECISION NOT NULL,
  geom                GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  region_id           TEXT REFERENCES regions(id),
  num_species_alltime INTEGER,
  latest_obs_dt       TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX hotspots_geom_idx ON hotspots USING GIST (geom);
CREATE INDEX hotspots_region_idx ON hotspots (region_id);

-- Down Migration
DROP TABLE IF EXISTS hotspots;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d hotspots"
```

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000005_hotspots.sql
git commit -m "feat(db): add hotspots table"
```

---

### Task 9: Migration 006 — `observations` table

**Files:**
- Create: `bird-watch/migrations/1700000006_observations.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE observations (
  sub_id          TEXT NOT NULL,
  species_code    TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  geom            GEOMETRY(POINT, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(lng, lat), 4326)) STORED,
  obs_dt          TIMESTAMPTZ NOT NULL,
  loc_id          TEXT NOT NULL,
  loc_name        TEXT,
  how_many        INTEGER,
  is_notable      BOOLEAN NOT NULL DEFAULT false,
  region_id       TEXT REFERENCES regions(id),
  silhouette_id   TEXT REFERENCES family_silhouettes(id),
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (sub_id, species_code)
);
CREATE INDEX obs_region_idx ON observations (region_id);
CREATE INDEX obs_species_idx ON observations (species_code);
CREATE INDEX obs_dt_idx ON observations (obs_dt DESC);
CREATE INDEX obs_geom_idx ON observations USING GIST (geom);
CREATE INDEX obs_notable_idx ON observations (is_notable) WHERE is_notable = true;

-- Down Migration
DROP TABLE IF EXISTS observations;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d observations"
```

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000006_observations.sql
git commit -m "feat(db): add observations table with PostGIS geometry"
```

---

### Task 10: Migration 007 — `ingest_runs` table

**Files:**
- Create: `bird-watch/migrations/1700000007_ingest_runs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Up Migration
CREATE TABLE ingest_runs (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,            -- 'recent' | 'notable' | 'backfill' | 'hotspots'
  started_at      TIMESTAMPTZ NOT NULL,
  finished_at     TIMESTAMPTZ,
  obs_fetched     INTEGER,
  obs_upserted    INTEGER,
  status          TEXT NOT NULL,             -- 'success' | 'partial' | 'failure'
  error_message   TEXT
);
CREATE INDEX ingest_runs_started_idx ON ingest_runs (started_at DESC);
CREATE INDEX ingest_runs_status_idx ON ingest_runs (status, started_at DESC);

-- Down Migration
DROP TABLE IF EXISTS ingest_runs;
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "\d ingest_runs"
```

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000007_ingest_runs.sql
git commit -m "feat(db): add ingest_runs tracking table"
```

---

### Task 11: Seed — 9 Arizona ecoregion polygons

**Files:**
- Create: `bird-watch/migrations/1700000008_seed_regions.sql`

These are simplified bounding-polygon approximations of Arizona's birding regions (WGS84). They are good enough to assign observations to regions for MVP. A future migration can replace `geom` with high-fidelity EPA Level III ecoregion polygons.

- [ ] **Step 1: Write the seed migration**

```sql
-- Up Migration
INSERT INTO regions (id, name, parent_id, geom, display_color, svg_path) VALUES

('colorado-plateau',
 'Colorado Plateau',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.05 35.85, -109.05 35.85, -109.05 37.00, -114.05 37.00, -114.05 35.85)))'), 4326),
 '#C77A2E',
 'M 20 20 L 340 20 L 340 110 L 20 110 Z'),

('grand-canyon',
 'Grand Canyon',
 'colorado-plateau',
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.00 35.85, -111.50 35.85, -111.50 36.50, -114.00 36.50, -114.00 35.85)))'), 4326),
 '#9B5E20',
 'M 60 40 L 130 40 L 130 80 L 60 80 Z'),

('mogollon-rim',
 'Mogollon Rim',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.05 33.50, -109.05 33.50, -109.05 35.85, -114.05 35.85, -114.05 33.50)))'), 4326),
 '#5A6B2A',
 'M 20 110 L 340 110 L 340 170 L 20 170 Z'),

('sonoran-phoenix',
 'Sonoran — Phoenix',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-113.50 32.50, -111.00 32.50, -111.00 34.00, -113.50 34.00, -113.50 32.50)))'), 4326),
 '#D4923A',
 'M 20 170 L 200 170 L 200 260 L 20 260 Z'),

('lower-colorado',
 'Lower Colorado / Mojave',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-114.80 32.50, -113.50 32.50, -113.50 35.00, -114.80 35.00, -114.80 32.50)))'), 4326),
 '#B07020',
 'M 20 260 L 90 260 L 90 360 L 20 360 Z'),

('sonoran-tucson',
 'Sonoran — Tucson',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-112.00 32.00, -110.00 32.00, -110.00 33.00, -112.00 33.00, -112.00 32.00)))'), 4326),
 '#E0A040',
 'M 90 260 L 240 260 L 240 360 L 90 360 Z'),

('sky-islands-santa-ritas',
 'Sky Islands — Santa Ritas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-111.20 31.50, -110.60 31.50, -110.60 32.00, -111.20 32.00, -111.20 31.50)))'), 4326),
 '#FF0808',
 'M 200 170 L 340 170 L 340 215 L 200 215 Z'),

('sky-islands-huachucas',
 'Sky Islands — Huachucas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-110.60 31.30, -110.10 31.30, -110.10 31.70, -110.60 31.70, -110.60 31.30)))'), 4326),
 '#FF0808',
 'M 200 215 L 270 215 L 270 260 L 200 260 Z'),

('sky-islands-chiricahuas',
 'Sky Islands — Chiricahuas',
 NULL,
 ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-109.40 31.70, -109.00 31.70, -109.00 32.10, -109.40 32.10, -109.40 31.70)))'), 4326),
 '#FF0808',
 'M 270 215 L 340 215 L 340 260 L 270 260 Z');

-- Down Migration
DELETE FROM regions WHERE id IN (
  'colorado-plateau','grand-canyon','mogollon-rim','sonoran-phoenix',
  'lower-colorado','sonoran-tucson','sky-islands-santa-ritas',
  'sky-islands-huachucas','sky-islands-chiricahuas'
);
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "SELECT id, name FROM regions ORDER BY id;"
```

Expected: 9 rows.

- [ ] **Step 3: Verify a point falls in a region**

```bash
docker-compose exec db psql -U birdwatch -d birdwatch -c "SELECT id FROM regions WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(-110.88, 31.72), 4326));"
```

Expected: `sky-islands-santa-ritas` (Madera Canyon).

- [ ] **Step 4: Commit**

```bash
git add migrations/1700000008_seed_regions.sql
git commit -m "feat(db): seed 9 Arizona ecoregions"
```

---

### Task 12: Seed — 15 family silhouettes (placeholder SVG)

**Files:**
- Create: `bird-watch/migrations/1700000009_seed_family_silhouettes.sql`

These are minimal placeholder silhouettes. They will be replaced with curated Phylopic SVGs in a follow-up curation pass (see spec Open Questions).

- [ ] **Step 1: Write the seed migration**

```sql
-- Up Migration
INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license) VALUES
('passerellidae',  'passerellidae',  'M5 14 C5 9 9 7 13 8 L17 6 L17 9 L15 10 L15 14 L13 16 L8 16 L5 14 Z', '#D4923A', 'placeholder', 'CC0'),
('trochilidae',    'trochilidae',    'M3 13 L8 11 L13 12 L18 9 L22 11 L18 13 L13 14 L8 14 L3 15 Z',          '#7B2D8E', 'placeholder', 'CC0'),
('accipitridae',   'accipitridae',   'M2 12 L8 9 Q12 5 16 9 L22 12 L16 12 L14 15 L10 15 L8 12 Z',             '#222222', 'placeholder', 'CC0'),
('strigidae',      'strigidae',      'M6 14 C6 9 10 8 14 9 C18 8 18 14 14 16 L10 16 L6 14 Z',                 '#5A4A2A', 'placeholder', 'CC0'),
('ardeidae',       'ardeidae',       'M4 14 C4 11 8 9 13 10 L18 9 L19 7 L20 9 L19 11 L18 12 L18 15 L15 17 L7 17 L4 14 Z', '#5A6B2A', 'placeholder', 'CC0'),
('anatidae',       'anatidae',       'M3 14 C3 11 8 11 12 12 L18 11 L20 14 L18 16 L8 16 L3 14 Z',             '#3A6B8E', 'placeholder', 'CC0'),
('scolopacidae',   'scolopacidae',   'M5 14 L8 12 L13 13 L17 12 L19 14 L17 15 L13 15 L8 15 L5 16 Z',          '#9B7B3A', 'placeholder', 'CC0'),
('picidae',        'picidae',        'M6 13 C6 9 10 8 13 9 L16 7 L17 9 L15 11 L15 14 L13 16 L8 16 L6 13 Z',   '#FF0808', 'placeholder', 'CC0'),
('corvidae',       'corvidae',       'M4 13 L8 10 Q12 7 16 10 L20 13 L16 14 L14 16 L10 16 L8 13 Z',           '#222244', 'placeholder', 'CC0'),
('odontophoridae', 'odontophoridae', 'M5 15 C5 12 9 11 13 12 C17 11 18 14 17 16 L8 17 L5 15 Z',               '#7A5028', 'placeholder', 'CC0'),
('cathartidae',    'cathartidae',    'M2 12 L8 10 Q12 8 16 10 L22 12 L16 12 L14 14 L10 14 L8 12 Z',           '#444444', 'placeholder', 'CC0'),
('tyrannidae',     'tyrannidae',     'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z',   '#C77A2E', 'placeholder', 'CC0'),
('troglodytidae',  'troglodytidae',  'M6 14 C6 11 9 10 12 11 L15 10 L15 13 L12 15 L8 15 L6 14 Z',             '#7A5028', 'placeholder', 'CC0'),
('cuculidae',      'cuculidae',      'M3 13 L7 11 L12 12 L18 10 L20 12 L18 14 L14 14 L9 15 L3 14 Z',          '#5E4A20', 'placeholder', 'CC0'),
('trogonidae',     'trogonidae',     'M5 13 C5 10 9 9 13 10 L17 9 L17 11 L15 12 L15 15 L13 17 L9 17 L5 13 Z', '#FF0808', 'placeholder', 'CC0');

-- Down Migration
DELETE FROM family_silhouettes WHERE id IN (
  'passerellidae','trochilidae','accipitridae','strigidae','ardeidae',
  'anatidae','scolopacidae','picidae','corvidae','odontophoridae',
  'cathartidae','tyrannidae','troglodytidae','cuculidae','trogonidae'
);
```

- [ ] **Step 2: Apply and verify**

```bash
npm run db:migrate
docker-compose exec db psql -U birdwatch -d birdwatch -c "SELECT count(*) FROM family_silhouettes;"
```

Expected: `15`.

- [ ] **Step 3: Commit**

```bash
git add migrations/1700000009_seed_family_silhouettes.sql
git commit -m "feat(db): seed 15 placeholder family silhouettes"
```

---

### Task 13: Create `packages/shared-types`

**Files:**
- Create: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.json`
- Create: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Write `packages/shared-types/package.json`**

```json
{
  "name": "@bird-watch/shared-types",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "echo 'no tests'"
  }
}
```

- [ ] **Step 2: Write `packages/shared-types/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `packages/shared-types/src/index.ts`**

```typescript
export interface Region {
  id: string;
  name: string;
  parentId: string | null;
  displayColor: string;
  svgPath: string;
}

export interface Hotspot {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  regionId: string | null;
  numSpeciesAlltime: number | null;
  latestObsDt: string | null;
}

export interface Observation {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
  regionId: string | null;
  silhouetteId: string | null;
}

export interface SpeciesMeta {
  speciesCode: string;
  comName: string;
  sciName: string;
  familyCode: string;
  familyName: string;
  taxonOrder: number | null;
}

export interface FamilySilhouette {
  id: string;
  familyCode: string;
  svgData: string;
  color: string;
  source: string | null;
  license: string | null;
}

export interface IngestRun {
  id: number;
  kind: 'recent' | 'notable' | 'backfill' | 'hotspots';
  startedAt: string;
  finishedAt: string | null;
  obsFetched: number | null;
  obsUpserted: number | null;
  status: 'success' | 'partial' | 'failure';
  errorMessage: string | null;
}

export type ObservationFilters = {
  since?: '1d' | '7d' | '14d' | '30d';
  notable?: boolean;
  speciesCode?: string;
  familyCode?: string;
};
```

- [ ] **Step 4: Build the package**

```bash
npm install
npm run build --workspace @bird-watch/shared-types
```

Expected: `dist/index.js` and `dist/index.d.ts` produced.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types
git commit -m "feat(shared-types): define core domain types"
```

---

### Task 14: Create `packages/family-mapping`

**Files:**
- Create: `packages/family-mapping/package.json`
- Create: `packages/family-mapping/tsconfig.json`
- Create: `packages/family-mapping/src/index.ts`
- Create: `packages/family-mapping/src/index.test.ts`
- Create: `packages/family-mapping/vitest.config.ts`

- [ ] **Step 1: Write `packages/family-mapping/package.json`**

```json
{
  "name": "@bird-watch/family-mapping",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write the failing test**

`packages/family-mapping/src/index.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { silhouetteForFamily, colorForFamily, FALLBACK_FAMILY } from './index.js';

describe('silhouetteForFamily', () => {
  it('returns the correct silhouette id for a known family', () => {
    expect(silhouetteForFamily('trochilidae')).toBe('trochilidae');
  });

  it('returns the fallback for an unknown family', () => {
    expect(silhouetteForFamily('non-existent-family')).toBe(FALLBACK_FAMILY);
  });
});

describe('colorForFamily', () => {
  it('returns a valid hex color for a known family', () => {
    expect(colorForFamily('accipitridae')).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('returns a fallback color for an unknown family', () => {
    expect(colorForFamily('non-existent-family')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
```

- [ ] **Step 5: Run the test to confirm it fails**

```bash
npm install
npm test --workspace @bird-watch/family-mapping
```

Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 6: Write the implementation**

`packages/family-mapping/src/index.ts`:
```typescript
export const FALLBACK_FAMILY = 'passerellidae';

const FAMILY_TO_SILHOUETTE: Record<string, string> = {
  passerellidae: 'passerellidae',
  trochilidae: 'trochilidae',
  accipitridae: 'accipitridae',
  strigidae: 'strigidae',
  ardeidae: 'ardeidae',
  anatidae: 'anatidae',
  scolopacidae: 'scolopacidae',
  picidae: 'picidae',
  corvidae: 'corvidae',
  odontophoridae: 'odontophoridae',
  cathartidae: 'cathartidae',
  tyrannidae: 'tyrannidae',
  troglodytidae: 'troglodytidae',
  cuculidae: 'cuculidae',
  trogonidae: 'trogonidae',
};

const FAMILY_TO_COLOR: Record<string, string> = {
  passerellidae: '#D4923A',
  trochilidae: '#7B2D8E',
  accipitridae: '#222222',
  strigidae: '#5A4A2A',
  ardeidae: '#5A6B2A',
  anatidae: '#3A6B8E',
  scolopacidae: '#9B7B3A',
  picidae: '#FF0808',
  corvidae: '#222244',
  odontophoridae: '#7A5028',
  cathartidae: '#444444',
  tyrannidae: '#C77A2E',
  troglodytidae: '#7A5028',
  cuculidae: '#5E4A20',
  trogonidae: '#FF0808',
};

const FALLBACK_COLOR = '#888888';

export function silhouetteForFamily(familyCode: string): string {
  return FAMILY_TO_SILHOUETTE[familyCode.toLowerCase()] ?? FALLBACK_FAMILY;
}

export function colorForFamily(familyCode: string): string {
  return FAMILY_TO_COLOR[familyCode.toLowerCase()] ?? FALLBACK_COLOR;
}

export function listMappedFamilies(): readonly string[] {
  return Object.keys(FAMILY_TO_SILHOUETTE);
}
```

- [ ] **Step 7: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/family-mapping
```

Expected: 4 tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/family-mapping
git commit -m "feat(family-mapping): family code → silhouette/color lookup with fallback"
```

---

### Task 15: Create `packages/db-client` skeleton with connection pool

**Files:**
- Create: `packages/db-client/package.json`
- Create: `packages/db-client/tsconfig.json`
- Create: `packages/db-client/vitest.config.ts`
- Create: `packages/db-client/src/pool.ts`
- Create: `packages/db-client/src/pool.test.ts`
- Create: `packages/db-client/src/index.ts`
- Create: `packages/db-client/src/test-helpers.ts`

- [ ] **Step 1: Write `packages/db-client/package.json`**

```json
{
  "name": "@bird-watch/db-client",
  "version": "0.0.1",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  },
  "dependencies": {
    "@bird-watch/shared-types": "*",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "@testcontainers/postgresql": "^10.7.0",
    "@types/pg": "^8.11.0",
    "testcontainers": "^10.7.0",
    "vitest": "^1.2.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"],
  "references": [{ "path": "../shared-types" }]
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
```

- [ ] **Step 4: Write the failing test**

`packages/db-client/src/pool.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createPool, closePool } from './pool.js';

let container: StartedPostgreSqlContainer;
let dbUrl: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  dbUrl = container.getConnectionUri();
}, 60_000);

afterAll(async () => {
  await container?.stop();
});

describe('createPool', () => {
  it('connects to Postgres and returns a usable pool', async () => {
    const pool = createPool({ databaseUrl: dbUrl });
    const result = await pool.query('SELECT 1 AS n');
    expect(result.rows[0].n).toBe(1);
    await closePool(pool);
  });

  it('returns the same pool when called twice with the same key', () => {
    const a = createPool({ databaseUrl: dbUrl, key: 'shared' });
    const b = createPool({ databaseUrl: dbUrl, key: 'shared' });
    expect(a).toBe(b);
    closePool(a);
  });
});
```

- [ ] **Step 5: Run the test to confirm it fails**

```bash
npm install
npm test --workspace @bird-watch/db-client
```

Expected: FAIL — `Cannot find module './pool.js'`.

- [ ] **Step 6: Write the implementation**

`packages/db-client/src/pool.ts`:
```typescript
import pg from 'pg';

export interface PoolOptions {
  databaseUrl: string;
  key?: string;          // when set, pool is memoized by key
  max?: number;
  idleTimeoutMillis?: number;
}

const POOLS = new Map<string, pg.Pool>();

export function createPool(opts: PoolOptions): pg.Pool {
  if (opts.key && POOLS.has(opts.key)) {
    return POOLS.get(opts.key)!;
  }
  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 5,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
  });
  if (opts.key) POOLS.set(opts.key, pool);
  return pool;
}

export async function closePool(pool: pg.Pool): Promise<void> {
  for (const [key, p] of POOLS.entries()) {
    if (p === pool) POOLS.delete(key);
  }
  await pool.end();
}

export type Pool = pg.Pool;
```

- [ ] **Step 7: Write `packages/db-client/src/index.ts` (re-exports)**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
```

- [ ] **Step 8: Write `packages/db-client/src/test-helpers.ts`**

```typescript
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

export interface TestDb {
  pool: pg.Pool;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Spin up an ephemeral PostGIS container, apply all repository SQL migrations
 * in numeric order, and return a ready-to-use pool. Use in beforeAll().
 */
export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgis/postgis:16-3.4'
  ).start();
  const url = container.getConnectionUri();
  const pool = new pg.Pool({ connectionString: url, max: 4 });

  const migrationsDir = resolve(process.cwd(), '../../migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf-8');
    // node-pg-migrate uses "-- Up Migration" / "-- Down Migration" markers.
    const upPart = sql.split(/-- Down Migration/i)[0]
      .replace(/-- Up Migration/i, '');
    if (upPart.trim()) {
      await pool.query(upPart);
    }
  }

  return {
    pool,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}
```

- [ ] **Step 9: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client
```

Expected: 2 tests pass (Testcontainers may take 30–60 s to pull the image on first run).

- [ ] **Step 10: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): connection pool with memoization + test helpers"
```

---

### Task 16: db-client — `getRegions`

**Files:**
- Create: `packages/db-client/src/regions.ts`
- Create: `packages/db-client/src/regions.test.ts`
- Modify: `packages/db-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db-client/src/regions.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getRegions } from './regions.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getRegions', () => {
  it('returns all 9 seeded ecoregions with the expected shape', async () => {
    const rows = await getRegions(db.pool);
    expect(rows).toHaveLength(9);
    const first = rows[0]!;
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('displayColor');
    expect(first).toHaveProperty('svgPath');
  });

  it('includes the Sky Islands sub-regions', async () => {
    const rows = await getRegions(db.pool);
    const ids = rows.map(r => r.id);
    expect(ids).toContain('sky-islands-santa-ritas');
    expect(ids).toContain('sky-islands-huachucas');
    expect(ids).toContain('sky-islands-chiricahuas');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/db-client -- regions
```

Expected: FAIL — `Cannot find module './regions.js'`.

- [ ] **Step 3: Write the implementation**

`packages/db-client/src/regions.ts`:
```typescript
import type { Pool } from './pool.js';
import type { Region } from '@bird-watch/shared-types';

export async function getRegions(pool: Pool): Promise<Region[]> {
  const { rows } = await pool.query<{
    id: string;
    name: string;
    parent_id: string | null;
    display_color: string;
    svg_path: string;
  }>(
    `SELECT id, name, parent_id, display_color, svg_path
     FROM regions
     ORDER BY id`
  );
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    parentId: r.parent_id,
    displayColor: r.display_color,
    svgPath: r.svg_path,
  }));
}
```

- [ ] **Step 4: Update `packages/db-client/src/index.ts`**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getRegions } from './regions.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client -- regions
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): add getRegions"
```

---

### Task 17: db-client — `getHotspots`

**Files:**
- Create: `packages/db-client/src/hotspots.ts`
- Create: `packages/db-client/src/hotspots.test.ts`
- Modify: `packages/db-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db-client/src/hotspots.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getHotspots, upsertHotspots } from './hotspots.js';

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  await upsertHotspots(db.pool, [
    { locId: 'L207118', locName: 'Sweetwater Wetlands', lat: 32.30, lng: -110.99, numSpeciesAlltime: 280, latestObsDt: '2026-04-15T12:00:00Z' },
    { locId: 'L101234', locName: 'Madera Canyon', lat: 31.72, lng: -110.88, numSpeciesAlltime: 410, latestObsDt: '2026-04-16T08:30:00Z' },
  ]);
}, 90_000);
afterAll(async () => { await db?.stop(); });

describe('getHotspots', () => {
  it('returns all hotspots with region_id stamped', async () => {
    const rows = await getHotspots(db.pool);
    expect(rows).toHaveLength(2);
    const sweetwater = rows.find(h => h.locId === 'L207118');
    expect(sweetwater?.regionId).toBe('sonoran-tucson');
    const madera = rows.find(h => h.locId === 'L101234');
    expect(madera?.regionId).toBe('sky-islands-santa-ritas');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/db-client -- hotspots
```

Expected: FAIL — `Cannot find module './hotspots.js'`.

- [ ] **Step 3: Write the implementation**

`packages/db-client/src/hotspots.ts`:
```typescript
import type { Pool } from './pool.js';
import type { Hotspot } from '@bird-watch/shared-types';

export interface HotspotInput {
  locId: string;
  locName: string;
  lat: number;
  lng: number;
  numSpeciesAlltime: number | null;
  latestObsDt: string | null;
}

export async function getHotspots(pool: Pool): Promise<Hotspot[]> {
  const { rows } = await pool.query<{
    loc_id: string;
    loc_name: string;
    lat: number;
    lng: number;
    region_id: string | null;
    num_species_alltime: number | null;
    latest_obs_dt: Date | null;
  }>(
    `SELECT loc_id, loc_name, lat, lng, region_id, num_species_alltime, latest_obs_dt
     FROM hotspots`
  );
  return rows.map(r => ({
    locId: r.loc_id,
    locName: r.loc_name,
    lat: r.lat,
    lng: r.lng,
    regionId: r.region_id,
    numSpeciesAlltime: r.num_species_alltime,
    latestObsDt: r.latest_obs_dt ? r.latest_obs_dt.toISOString() : null,
  }));
}

export async function upsertHotspots(pool: Pool, inputs: HotspotInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((h, i) => {
    const o = i * 6;
    placeholders.push(`($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`);
    values.push(h.locId, h.locName, h.lat, h.lng, h.numSpeciesAlltime, h.latestObsDt);
  });

  const sql = `
    INSERT INTO hotspots (loc_id, loc_name, lat, lng, num_species_alltime, latest_obs_dt)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (loc_id) DO UPDATE SET
      loc_name            = EXCLUDED.loc_name,
      lat                 = EXCLUDED.lat,
      lng                 = EXCLUDED.lng,
      num_species_alltime = EXCLUDED.num_species_alltime,
      latest_obs_dt       = EXCLUDED.latest_obs_dt;

    UPDATE hotspots h
    SET region_id = (
      SELECT r.id FROM regions r
      WHERE ST_Contains(r.geom, h.geom)
      ORDER BY ST_Area(r.geom) ASC
      LIMIT 1
    )
    WHERE region_id IS NULL OR region_id <> (
      SELECT r.id FROM regions r
      WHERE ST_Contains(r.geom, h.geom)
      ORDER BY ST_Area(r.geom) ASC
      LIMIT 1
    );
  `;

  const result = await pool.query(sql, values);
  return inputs.length;
}
```

Note: `ORDER BY ST_Area ASC LIMIT 1` picks the smallest containing region — important because `grand-canyon` is nested inside `colorado-plateau`, and we want the more specific region.

- [ ] **Step 4: Update `packages/db-client/src/index.ts`**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getRegions } from './regions.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client -- hotspots
```

Expected: 1 test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): add getHotspots + upsertHotspots with PostGIS region stamping"
```

---

### Task 18: db-client — `upsertObservations` with region + silhouette stamping

**Files:**
- Create: `packages/db-client/src/observations.ts`
- Create: `packages/db-client/src/observations.test.ts`
- Modify: `packages/db-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db-client/src/observations.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { upsertObservations, getObservations, type ObservationInput } from './observations.js';

let db: TestDb;
beforeAll(async () => {
  db = await startTestDb();
  // Seed a species so silhouette mapping has something to JOIN against.
  await db.pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name)
     VALUES
       ('vermfly', 'Vermilion Flycatcher', 'Pyrocephalus rubinus', 'tyrannidae', 'Tyrant Flycatchers'),
       ('annhum', 'Anna''s Hummingbird', 'Calypte anna', 'trochilidae', 'Hummingbirds')`
  );
}, 90_000);

beforeEach(async () => {
  await db.pool.query('TRUNCATE observations');
});

afterAll(async () => { await db?.stop(); });

describe('upsertObservations', () => {
  const sample: ObservationInput[] = [
    {
      subId: 'S100', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
      lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
      locId: 'L101234', locName: 'Madera Canyon', howMany: 2, isNotable: false,
    },
    {
      subId: 'S101', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
      lat: 32.30, lng: -110.99, obsDt: '2026-04-15T09:00:00Z',
      locId: 'L207118', locName: 'Sweetwater Wetlands', howMany: 1, isNotable: true,
    },
  ];

  it('inserts new observations and stamps region_id + silhouette_id', async () => {
    const count = await upsertObservations(db.pool, sample);
    expect(count).toBe(2);

    const all = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
    const verm = all.find(o => o.subId === 'S100')!;
    expect(verm.regionId).toBe('sky-islands-santa-ritas');
    expect(verm.silhouetteId).toBe('tyrannidae');
    const anna = all.find(o => o.subId === 'S101')!;
    expect(anna.regionId).toBe('sonoran-tucson');
    expect(anna.silhouetteId).toBe('trochilidae');
    expect(anna.isNotable).toBe(true);
  });

  it('is idempotent — re-running with the same input does not duplicate', async () => {
    await upsertObservations(db.pool, sample);
    await upsertObservations(db.pool, sample);
    const all = await getObservations(db.pool, {});
    expect(all).toHaveLength(2);
  });

  it('updates is_notable on conflict when value changes', async () => {
    await upsertObservations(db.pool, sample);
    const updated: ObservationInput[] = [{ ...sample[0]!, isNotable: true }];
    await upsertObservations(db.pool, updated);
    const all = await getObservations(db.pool, {});
    const verm = all.find(o => o.subId === 'S100')!;
    expect(verm.isNotable).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/db-client -- observations
```

Expected: FAIL — `Cannot find module './observations.js'`.

- [ ] **Step 3: Write the implementation**

`packages/db-client/src/observations.ts`:
```typescript
import type { Pool } from './pool.js';
import type { Observation, ObservationFilters } from '@bird-watch/shared-types';

export interface ObservationInput {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
}

export async function upsertObservations(
  pool: Pool,
  inputs: ObservationInput[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((o, i) => {
    const off = i * 9;
    placeholders.push(
      `($${off + 1}, $${off + 2}, $${off + 3}, $${off + 4}, $${off + 5}, ` +
      `$${off + 6}, $${off + 7}, $${off + 8}, $${off + 9})`
    );
    values.push(
      o.subId, o.speciesCode, o.lat, o.lng, o.obsDt,
      o.locId, o.locName, o.howMany, o.isNotable
    );
  });

  const sql = `
    INSERT INTO observations
      (sub_id, species_code, lat, lng, obs_dt, loc_id, loc_name, how_many, is_notable)
    VALUES ${placeholders.join(',')}
    ON CONFLICT (sub_id, species_code) DO UPDATE SET
      lat        = EXCLUDED.lat,
      lng        = EXCLUDED.lng,
      obs_dt     = EXCLUDED.obs_dt,
      loc_id     = EXCLUDED.loc_id,
      loc_name   = EXCLUDED.loc_name,
      how_many   = EXCLUDED.how_many,
      is_notable = EXCLUDED.is_notable,
      ingested_at = now();

    -- Stamp region_id and silhouette_id for any rows that need them.
    UPDATE observations o
    SET
      region_id = (
        SELECT r.id FROM regions r
        WHERE ST_Contains(r.geom, o.geom)
        ORDER BY ST_Area(r.geom) ASC
        LIMIT 1
      ),
      silhouette_id = (
        SELECT fs.id
        FROM species_meta sm
        JOIN family_silhouettes fs ON fs.family_code = sm.family_code
        WHERE sm.species_code = o.species_code
        LIMIT 1
      )
    WHERE o.region_id IS NULL OR o.silhouette_id IS NULL;
  `;

  await pool.query(sql, values);
  return inputs.length;
}

export async function getObservations(
  pool: Pool,
  f: ObservationFilters
): Promise<Observation[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (f.since) {
    const days = parseInt(f.since.replace('d', ''), 10);
    conditions.push(`obs_dt >= now() - ($${params.length + 1}::int * interval '1 day')`);
    params.push(days);
  }
  if (f.notable === true) {
    conditions.push('is_notable = true');
  }
  if (f.speciesCode) {
    conditions.push(`species_code = $${params.length + 1}`);
    params.push(f.speciesCode);
  }
  if (f.familyCode) {
    conditions.push(
      `species_code IN (SELECT species_code FROM species_meta WHERE family_code = $${params.length + 1})`
    );
    params.push(f.familyCode);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT
      o.sub_id, o.species_code, sm.com_name,
      o.lat, o.lng, o.obs_dt, o.loc_id, o.loc_name, o.how_many,
      o.is_notable, o.region_id, o.silhouette_id
    FROM observations o
    LEFT JOIN species_meta sm ON sm.species_code = o.species_code
    ${where}
    ORDER BY o.obs_dt DESC
  `;

  const { rows } = await pool.query<{
    sub_id: string;
    species_code: string;
    com_name: string | null;
    lat: number;
    lng: number;
    obs_dt: Date;
    loc_id: string;
    loc_name: string | null;
    how_many: number | null;
    is_notable: boolean;
    region_id: string | null;
    silhouette_id: string | null;
  }>(sql, params);

  return rows.map(r => ({
    subId: r.sub_id,
    speciesCode: r.species_code,
    comName: r.com_name ?? r.species_code,
    lat: r.lat,
    lng: r.lng,
    obsDt: r.obs_dt.toISOString(),
    locId: r.loc_id,
    locName: r.loc_name,
    howMany: r.how_many,
    isNotable: r.is_notable,
    regionId: r.region_id,
    silhouetteId: r.silhouette_id,
  }));
}
```

- [ ] **Step 4: Update `packages/db-client/src/index.ts`**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getRegions } from './regions.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
export {
  getObservations, upsertObservations, type ObservationInput,
} from './observations.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client -- observations
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): upsertObservations with PostGIS region + silhouette stamping"
```

---

### Task 19: db-client — `getObservations` filter coverage tests

**Files:**
- Modify: `packages/db-client/src/observations.test.ts`

- [ ] **Step 1: Append filter tests**

Add to `packages/db-client/src/observations.test.ts`:
```typescript
describe('getObservations filters', () => {
  beforeEach(async () => {
    await db.pool.query('TRUNCATE observations');
    await upsertObservations(db.pool, [
      { subId: 'S200', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 31.72, lng: -110.88, obsDt: '2026-04-15T08:00:00Z',
        locId: 'L1', locName: 'X', howMany: 1, isNotable: false },
      { subId: 'S201', speciesCode: 'annhum', comName: 'Anna\'s Hummingbird',
        lat: 32.30, lng: -110.99, obsDt: '2026-04-10T08:00:00Z',
        locId: 'L2', locName: 'Y', howMany: 1, isNotable: true },
      { subId: 'S202', speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        lat: 32.30, lng: -110.99, obsDt: '2026-03-01T08:00:00Z',
        locId: 'L3', locName: 'Z', howMany: 3, isNotable: false },
    ]);
  });

  it('filters by since=14d', async () => {
    // Note: tests assume the DB clock is "now" — these dates are illustrative.
    // We reset obs_dt to relative to now() to make the test stable:
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '5 days' WHERE sub_id='S200'`);
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '20 days' WHERE sub_id='S201'`);
    await db.pool.query(`UPDATE observations SET obs_dt = now() - interval '40 days' WHERE sub_id='S202'`);
    const rows = await getObservations(db.pool, { since: '14d' });
    expect(rows.map(r => r.subId)).toEqual(['S200']);
  });

  it('filters by notable=true', async () => {
    const rows = await getObservations(db.pool, { notable: true });
    expect(rows.map(r => r.subId).sort()).toEqual(['S201']);
  });

  it('filters by species code', async () => {
    const rows = await getObservations(db.pool, { speciesCode: 'vermfly' });
    expect(rows.map(r => r.subId).sort()).toEqual(['S200', 'S202']);
  });

  it('filters by family code', async () => {
    const rows = await getObservations(db.pool, { familyCode: 'trochilidae' });
    expect(rows.map(r => r.subId)).toEqual(['S201']);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test --workspace @bird-watch/db-client -- observations
```

Expected: 7 tests pass total.

- [ ] **Step 3: Commit**

```bash
git add packages/db-client/src/observations.test.ts
git commit -m "test(db-client): cover getObservations filters"
```

---

### Task 20: db-client — `getSpeciesMeta` and `upsertSpeciesMeta`

**Files:**
- Create: `packages/db-client/src/species.ts`
- Create: `packages/db-client/src/species.test.ts`
- Modify: `packages/db-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db-client/src/species.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import { getSpeciesMeta, upsertSpeciesMeta } from './species.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
beforeEach(async () => { await db.pool.query('TRUNCATE species_meta CASCADE'); });
afterAll(async () => { await db?.stop(); });

describe('species meta', () => {
  it('upserts and returns by species code', async () => {
    await upsertSpeciesMeta(db.pool, [
      { speciesCode: 'vermfly', comName: 'Vermilion Flycatcher',
        sciName: 'Pyrocephalus rubinus', familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers', taxonOrder: 30501 },
    ]);
    const row = await getSpeciesMeta(db.pool, 'vermfly');
    expect(row?.comName).toBe('Vermilion Flycatcher');
    expect(row?.familyCode).toBe('tyrannidae');
  });

  it('returns null for unknown species', async () => {
    const row = await getSpeciesMeta(db.pool, 'doesnotexist');
    expect(row).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/db-client -- species
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/db-client/src/species.ts`:
```typescript
import type { Pool } from './pool.js';
import type { SpeciesMeta } from '@bird-watch/shared-types';

export async function getSpeciesMeta(
  pool: Pool,
  speciesCode: string
): Promise<SpeciesMeta | null> {
  const { rows } = await pool.query<{
    species_code: string;
    com_name: string;
    sci_name: string;
    family_code: string;
    family_name: string;
    taxon_order: number | null;
  }>(
    `SELECT species_code, com_name, sci_name, family_code, family_name, taxon_order
     FROM species_meta WHERE species_code = $1`,
    [speciesCode]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    speciesCode: r.species_code,
    comName: r.com_name,
    sciName: r.sci_name,
    familyCode: r.family_code,
    familyName: r.family_name,
    taxonOrder: r.taxon_order,
  };
}

export async function upsertSpeciesMeta(
  pool: Pool,
  inputs: SpeciesMeta[]
): Promise<number> {
  if (inputs.length === 0) return 0;

  const values: unknown[] = [];
  const placeholders: string[] = [];

  inputs.forEach((s, i) => {
    const o = i * 6;
    placeholders.push(
      `($${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5}, $${o + 6})`
    );
    values.push(s.speciesCode, s.comName, s.sciName, s.familyCode, s.familyName, s.taxonOrder);
  });

  await pool.query(
    `INSERT INTO species_meta (species_code, com_name, sci_name, family_code, family_name, taxon_order)
     VALUES ${placeholders.join(',')}
     ON CONFLICT (species_code) DO UPDATE SET
       com_name = EXCLUDED.com_name,
       sci_name = EXCLUDED.sci_name,
       family_code = EXCLUDED.family_code,
       family_name = EXCLUDED.family_name,
       taxon_order = EXCLUDED.taxon_order`,
    values
  );
  return inputs.length;
}
```

- [ ] **Step 4: Update `packages/db-client/src/index.ts`**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getRegions } from './regions.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
export {
  getObservations, upsertObservations, type ObservationInput,
} from './observations.js';
export { getSpeciesMeta, upsertSpeciesMeta } from './species.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client -- species
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): add species meta queries"
```

---

### Task 21: db-client — `recordIngestRun`

**Files:**
- Create: `packages/db-client/src/ingest-runs.ts`
- Create: `packages/db-client/src/ingest-runs.test.ts`
- Modify: `packages/db-client/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/db-client/src/ingest-runs.test.ts`:
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './test-helpers.js';
import {
  startIngestRun, finishIngestRun, getRecentIngestRuns,
} from './ingest-runs.js';

let db: TestDb;
beforeAll(async () => { db = await startTestDb(); }, 90_000);
beforeEach(async () => { await db.pool.query('TRUNCATE ingest_runs RESTART IDENTITY'); });
afterAll(async () => { await db?.stop(); });

describe('ingest runs', () => {
  it('records a successful run from start to finish', async () => {
    const id = await startIngestRun(db.pool, 'recent');
    expect(id).toBeGreaterThan(0);
    await finishIngestRun(db.pool, id, {
      status: 'success', obsFetched: 100, obsUpserted: 100,
    });
    const rows = await getRecentIngestRuns(db.pool, 5);
    expect(rows[0]).toMatchObject({
      kind: 'recent', status: 'success', obsFetched: 100, obsUpserted: 100,
    });
    expect(rows[0]?.finishedAt).not.toBeNull();
  });

  it('records a failed run with error message', async () => {
    const id = await startIngestRun(db.pool, 'recent');
    await finishIngestRun(db.pool, id, {
      status: 'failure', errorMessage: 'eBird timeout',
    });
    const rows = await getRecentIngestRuns(db.pool, 5);
    expect(rows[0]?.status).toBe('failure');
    expect(rows[0]?.errorMessage).toBe('eBird timeout');
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test --workspace @bird-watch/db-client -- ingest-runs
```

Expected: FAIL.

- [ ] **Step 3: Write the implementation**

`packages/db-client/src/ingest-runs.ts`:
```typescript
import type { Pool } from './pool.js';
import type { IngestRun } from '@bird-watch/shared-types';

export type IngestKind = IngestRun['kind'];
export type IngestStatus = IngestRun['status'];

export async function startIngestRun(pool: Pool, kind: IngestKind): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO ingest_runs (kind, started_at, status)
     VALUES ($1, now(), 'success') RETURNING id`,
    [kind]
  );
  return rows[0]!.id;
}

export interface FinishOptions {
  status: IngestStatus;
  obsFetched?: number;
  obsUpserted?: number;
  errorMessage?: string;
}

export async function finishIngestRun(
  pool: Pool,
  id: number,
  opts: FinishOptions
): Promise<void> {
  await pool.query(
    `UPDATE ingest_runs
     SET finished_at = now(),
         status = $2,
         obs_fetched = $3,
         obs_upserted = $4,
         error_message = $5
     WHERE id = $1`,
    [
      id, opts.status,
      opts.obsFetched ?? null,
      opts.obsUpserted ?? null,
      opts.errorMessage ?? null,
    ]
  );
}

export async function getRecentIngestRuns(pool: Pool, limit: number): Promise<IngestRun[]> {
  const { rows } = await pool.query<{
    id: number;
    kind: string;
    started_at: Date;
    finished_at: Date | null;
    obs_fetched: number | null;
    obs_upserted: number | null;
    status: string;
    error_message: string | null;
  }>(
    `SELECT id, kind, started_at, finished_at, obs_fetched, obs_upserted, status, error_message
     FROM ingest_runs
     ORDER BY started_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(r => ({
    id: r.id,
    kind: r.kind as IngestKind,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    obsFetched: r.obs_fetched,
    obsUpserted: r.obs_upserted,
    status: r.status as IngestStatus,
    errorMessage: r.error_message,
  }));
}
```

- [ ] **Step 4: Update `packages/db-client/src/index.ts`**

```typescript
export { createPool, closePool } from './pool.js';
export type { Pool, PoolOptions } from './pool.js';
export { getRegions } from './regions.js';
export { getHotspots, upsertHotspots, type HotspotInput } from './hotspots.js';
export {
  getObservations, upsertObservations, type ObservationInput,
} from './observations.js';
export { getSpeciesMeta, upsertSpeciesMeta } from './species.js';
export {
  startIngestRun, finishIngestRun, getRecentIngestRuns,
  type IngestKind, type IngestStatus, type FinishOptions,
} from './ingest-runs.js';
```

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npm test --workspace @bird-watch/db-client -- ingest-runs
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/db-client
git commit -m "feat(db-client): record ingest runs (start/finish/list)"
```

---

### Task 22: Cross-package type build verification

**Files:** none (verification step)

- [ ] **Step 1: Build everything**

```bash
npm run build
```

Expected: every package builds with no TypeScript errors. `dist/` directories exist for `shared-types`, `family-mapping`, `db-client`.

- [ ] **Step 2: Run all tests one more time**

```bash
npm test
```

Expected: every test in every package passes.

- [ ] **Step 3: Commit (only if any auto-format changes)**

```bash
git status   # if anything changed
git add -A && git commit -m "chore: final build/test sweep for plan 1" || echo "nothing to commit"
```

---

## Self-review checklist (run before declaring Plan 1 done)

- [ ] All 7 schema migrations apply without error from a fresh DB
- [ ] All 2 seed migrations leave the DB with 9 regions and 15 silhouettes
- [ ] Vitest passes for `family-mapping` (4 tests) and `db-client` (≥14 tests)
- [ ] `npm run build` produces `dist/` for all three packages
- [ ] `git log --oneline` shows ~20 commits (one per task)
- [ ] No `TODO` / `TBD` / `placeholder` strings in the code (only in seed `source`/`license` columns where intentional)

When all checked: Plan 1 is done. Move on to Plan 2.
