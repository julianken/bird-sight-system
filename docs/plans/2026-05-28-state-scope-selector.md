# State / ZIP Map Scope Selector — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible map Scope control — Whole US (today's CONUS map) · a single CONUS state · a ZIP inside its state — that renders **only** the selected scope's observation data.

**Architecture:** `?state=US-XX` is a **hard server-side data boundary** (a PostGIS `ST_Intersects` clip against a new `state_boundaries` polygon table); `bbox`+`zoom` keep their existing roles as the viewport / level-of-detail *within* that boundary; **Whole US = absence of `?state=`** = byte-for-byte today's behavior. One set of ~49 simplified Census state MULTIPOLYGONs does triple duty: the data clip, ZIP→state point-in-polygon resolution, and the bounding-envelope that drives camera `fitBounds` + `MAX_BOUNDS`.

**Tech Stack:** PostgreSQL 16 + PostGIS (Cloud SQL), `node-pg-migrate` plain-SQL migrations, `@testcontainers/postgresql` integration tests, Hono read-api, React 18 + `react-map-gl`/`maplibre-gl` 5.x, Vite, `@playwright/test` e2e. Data: US Census cartographic boundary shapefiles + 2020 ZCTA Gazetteer (both public domain).

**Provenance:** Two investigation/decomposition workflow passes on 2026-05-28 (codebase feasibility audit → strict-polygon/ZIP-in-v1/CONUS-only decisions → 4-stream decomposition + adversarial critique). Sibling epic: **#601 `epic: going national`** — this is a navigation/IA layer *on top of* the national data #601 already shipped (recent-lane ingest is `regionCode:'US'`; DB is Cloud SQL; the observations table is a flat lat/lng point cloud with no region column).

---

## Locked decisions (do not relitigate)

1. **Strict state-polygon clipping** via `ST_Intersects` (NOT a bounding box, NOT `ST_Contains`). `ST_Intersects` is the inclusive idiom the existing bbox filter uses; `ST_Contains` would *drop* an observation sitting exactly on a simplified shared border (it would vanish from both states). A border-point test asserts an obs lands in exactly one clip, not zero.
2. **ZIP entry ships in v1** (not deferred).
3. **CONUS only — 48 states + DC (49 codes).** No Alaska/Hawaii/territories: no antimeridian math, no data expansion. AK/HI are also outside the map's current `MAX_BOUNDS`.
4. **Request model:** `?state=US-XX` = hard data boundary; `bbox`+`zoom` = viewport within it; they `AND` together in SQL. Whole-US = absence of `?state=`.
5. **`?zip=` is NOT persisted in the URL in v1.** A ZIP resolves to a scope (`?state=`) + a camera move; `?state=` is the shareable unit.
6. **One source of truth per artifact:** the 49-code allowlist lives once in `@bird-watch/shared-types`; the state polygons live once in `state_boundaries` (server) with a committed `data/us-state-polygons.geojson` that the ZIP ETL consumes — the clip and the ZIP→state precompute must never diverge.
7. **`/api/states`** (not a bundled JSON) is the frontend's source for state name+bbox — single source of truth with the clip, ~4 KB, CDN-cached. The polygon `geom` never leaves the server.

## Architecture seams (frozen contracts)

| Contract | Owner | Consumers | Shape |
|---|---|---|---|
| `state_boundaries` table | A | B (clip), D (ZIP precompute) | `state_code TEXT PK ('US-XX')`, `name TEXT`, `geom geometry(MultiPolygon,4326)`, `min_lng/min_lat/max_lng/max_lat DOUBLE PRECISION`, GIST index on `geom` |
| `data/us-state-polygons.geojson` | A | D (PIP precompute) | canonical simplified CONUS shapes; A's seed AND D's ETL read this exact file |
| `CONUS_STATE_CODES` + `StateCode` + `StateSummary` | shared-types | A, B, C, D | the 49-code allowlist + `{stateCode,name,bbox:[w,s,e,n]}` |
| `ObservationFilters.stateCode?` + `meta.truncated?` | B (shared-types) | C (client.ts maps `?state=`), C (affordance) | optional fields |
| `ScopeResolution {stateCode, center:[lng,lat], zoom}` + `ZIP_FLYTO_ZOOM=10` | D | C (camera + scope) | pure data handoff, no React |
| `GET /api/states` → `StateSummary[]` | A | C (selector + camera bbox) | name-sorted, no `geom` |

## File structure

| File | Responsibility | Stream |
|---|---|---|
| `scripts/generate-state-boundaries.mjs` + `data/us-state-polygons.geojson` | offline polygon source → WKT seed + canonical GeoJSON | A |
| `migrations/1700000050000_state_boundaries.sql` | table + GIST index + 49-row seed | A |
| `packages/db-client/src/state-boundaries.ts` | `resolveStateForPoint`, `listStatesWithBbox` | A |
| `packages/shared-types/src/index.ts` | `CONUS_STATE_CODES`, `StateCode`, `StateSummary`, `stateCode?`, `meta.truncated?` | A/B |
| `services/read-api/src/validate.ts` | `parseState` + `assertBboxOrSpecies` state-aware | B |
| `packages/db-client/src/observations.ts` | `ST_Intersects` clip in both query paths + `LIMIT 10000` brake | B |
| `services/read-api/src/app.ts` | `?state=` wiring + `GET /api/states` | A/B |
| `scripts/zip-etl/*` + `frontend/public/zip-index.json` | ZCTA → `{zip,lat,lng,state}` columnar index | D |
| `frontend/src/data/zip-lookup.ts` | lazy-fetch + in-memory cache | D |
| `frontend/src/state/scope-types.ts` | `ScopeResolution` contract | D |
| `frontend/src/components/ZipInput.tsx` | ZIP input + "not recognized" UX | D |
| `frontend/src/state/url-state.ts` | `?state=` URL state (+ precedence) | C |
| `frontend/src/components/map/MapCanvas.tsx` | controllable camera: `fitBounds` + dynamic `MAX_BOUNDS` | C |
| `frontend/src/components/ScopeControl.tsx` | on-map StateSelector + Whole-US + ZIP | C |
| `frontend/src/config/region.ts` (+ 5 consumers) | runtime `regionLabelFor(scope)` | C |
| `frontend/src/components/MapLede.tsx`, `ds/FilterSentence.tsx` | sparse/empty-region narration | C |
| `frontend/e2e/{zip-scope,state-scope}.spec.ts` + POM | e2e + screenshots + design review | C/D |

## Quantified plan literals (implementer checklist)

Before opening a PR for any task, check off each item it touches or cite a deferral doc with a lexically-matching subject (per R13 T7, issue #461):

- [ ] Seed **49** `state_boundaries` rows (48 CONUS states + DC); A2 asserts `count = 49`
- [ ] `parseState` allowlist = exactly **49** codes; reject AK/HI/territories (US-AK, US-HI, PR)
- [ ] General per-obs **`LIMIT 10000`** brake + species **`LIMIT 5000`** cap, surfaced as `meta.truncated`
- [ ] ZIP index keeps **~32.8k** CONUS ZCTAs of **~33,791**; **0** AK/HI/territory entries remain
- [ ] ZIP centroids rounded to **5** decimals (~1.1 m)
- [ ] **`ZIP_FLYTO_ZOOM = 10`** as a single shared constant
- [ ] Prototype renders **≥344** rows at **390×844** and **1440×900** with **zero** console errors AND **zero** warnings
- [ ] `regionLabelFor` threaded through all **5** REGION_LABEL consumers (AppHeader, MapLede, SurfaceTitleSync, FeedSurface, App.tsx)
- [ ] **5** canonical viewports × **2** themes = **≥10** screenshots + a `ui-design:ui-designer` PASS before queue
- [ ] **Every** new `className` has a matching CSS rule (orphan-classname check clean); knip clean

## Orchestration map (agentic execution, not a calendar)

Effort is measured in concurrent agent passes, gates, and verification rounds — not days. Peak parallel width ≈ 4. The whole epic gates on exactly two serialization points: **A2** (migration green) and **C0** (the render prototype).

| Phase | Concurrent agent passes | Gate | Verification |
|---|---|---|---|
| **P0 — contracts + prototype** | shared-types allowlist · **C0 prototype** · C1 maplibre-ctx7 · A1 generator+GeoJSON+knip-ignore | learnings note committed; allowlist + A1 CI-green | C0 zero console warnings @ 2 viewports; A1 emits 49 valid WKT; `tsc` green |
| **P1 — backend substrate** | A2 migration · B1 types · B2 parseState · D1 ZCTA vendor | **A2 green before any clip/PIP** | A2 `count=49` + GIST + clean Down; B2 rejects AK/HI/PR |
| **P2 — accessors · clip · ETL** | A3→A4 · B3→B6→B4→B5→B7 · D2→D3→D4 | A3+GeoJSON before D2; B3 before B5/B6 | B3 in-AZ non-empty + border point in exactly one state; B6 10001→10000 truncated; D2 border-ZIP matches A3 |
| **P3 — frontend core + ZIP** | C2+C5 · C3+C4+C7 · C6 · D5 | C6 needs C2–C5 + D5; C7 before D6 | fitBounds spy duration 0 under reduced-motion; one refetch per scope change; scoped-empty shows *data* copy not *filter* copy |
| **P4 — CSS · e2e · review** | C8→C9 · D6 | ≥10 attachments + ui-design PASS before queue | orphan-classname + knip green; ui-design PASS 5×2; bot APPROVE → `@Mergifyio queue` |

---

# Stream A — Polygon Foundation

The geometry substrate every other stream rides on. **Blocks B (clip) and D (ZIP precompute).** Output is a frozen contract: table/column names, accessor signatures, the `/api/states` shape, and the committed `data/us-state-polygons.geojson`.

### Task A1: Source + simplify CONUS state polygons (generator + canonical GeoJSON)

**Files:**
- Create: `scripts/generate-state-boundaries.mjs`, `scripts/README-state-boundaries.md`, `data/us-state-polygons.geojson`
- Modify: `knip.ts`

- [ ] **Step 1: Write the generator.** One-shot Node script consuming the public-domain Census file `cb_2023_us_state_500k` (`https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip`; 1:500,000 is already cartographically generalized — the right base resolution for a national zoom map). Pipeline: (a) `ogr2ogr`/`mapshaper` → GeoJSON in EPSG:4326; (b) **filter to CONUS** — drop `STATEFP` 02 (AK), 15 (HI), 60/66/69/72/78 (territories), leaving exactly **48 states + DC(11) = 49** features; (c) `mapshaper -simplify 5% keep-shapes visvalingam` (start tolerance; `keep-shapes` prevents DC collapsing); (d) for each feature emit `state_code='US-'||STUSPS`, `name=NAME`, geometry as a WKT MULTIPOLYGON (wrap single Polygons), and the envelope `[min_lng,min_lat,max_lng,max_lat]`. Emit **two** artifacts: the ready-to-paste SQL `INSERT` block (for A2) **and** `data/us-state-polygons.geojson` (the canonical shape D2 consumes — locked decision #6).
- [ ] **Step 2: Record provenance.** In `scripts/README-state-boundaries.md` pin the source URL + vintage + date, the exact `mapshaper` command, the final tolerance, the total vertex count, and the resulting seed byte size (auditable, mirroring the knip-ignore convention).
- [ ] **Step 3: Add the knip ignore rule** for `scripts/generate-state-boundaries.mjs` (run-once, statically-unreferenced tooling) with a dated comment: *silences the run-once boundary generator; risks missing genuine dead code if the seed is regenerated differently; re-audit verifies the seed migration still cites this script as provenance.* (knip is a required Mergify check.)

**Acceptance:** emits exactly 49 INSERT tuples (no AK/HI/territories); every geometry is valid WKT MULTIPOLYGON usable in `ST_GeomFromText(...,4326)`; `data/us-state-polygons.geojson` exists with 49 features; README records tolerance + vertex count + byte size; knip green.

**Tests:** Manual generator run (network/data-file gated, not CI). The knip-ignore keeps the queue unblocked.

### Task A2: `state_boundaries` table + GIST index + seed migration

**Files:**
- Create: `migrations/1700000050000_state_boundaries.sql`, `packages/db-client/src/state-boundaries-migration.test.ts`

- [ ] **Step 1: Write the migration.** Use `-- Up Migration` / `-- Down Migration` markers exactly as `migrations/1700000008000_seed_regions.sql` (the test harness at `packages/db-client/src/test-helpers.ts:31` splits on `/-- Down Migration/i` and runs only the Up part — both markers mandatory, Up self-contained). Up:
  ```sql
  CREATE TABLE state_boundaries (
    state_code TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    geom       geometry(MultiPolygon,4326) NOT NULL,
    min_lng DOUBLE PRECISION NOT NULL, min_lat DOUBLE PRECISION NOT NULL,
    max_lng DOUBLE PRECISION NOT NULL, max_lat DOUBLE PRECISION NOT NULL
  );
  CREATE INDEX state_boundaries_geom_idx ON state_boundaries USING GIST (geom);
  INSERT INTO state_boundaries (state_code,name,geom,min_lng,min_lat,max_lng,max_lat) VALUES
    ('US-AL','Alabama', ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((...)))'),4326), ...),
    ... -- 49 rows pasted from A1
  ;
  ```
  Down: `DROP TABLE IF EXISTS state_boundaries;`. Store the bbox as four precomputed columns (not query-time `ST_Envelope`) so `listStatesWithBbox` is a pure column read. Numeric prefix `1700000050000` is the next free slot after `1700000049000`.
- [ ] **Step 2: Write the migration test** (`state-boundaries-migration.test.ts`, model on `migrations-down-chain.test.ts`): `beforeAll startTestDb()`; assert `count=49`, `count(*) WHERE NOT ST_IsValid(geom) = 0`, every row `geometrytype='MULTIPOLYGON'` + `ST_SRID=4326`, `min<max` on both axes and bbox ≈ `ST_Envelope`, and `state_boundaries_geom_idx` present via `pg_indexes`. Roll Down → `to_regclass('state_boundaries') IS NULL` → re-apply Up clean. **Also confirm `migrations-down-chain.test.ts` still passes** (it hard-codes post-rollback counts; the new migration must sort after the current max).
- [ ] **Step 3: Run** `npm test --workspace @bird-watch/db-client` → all green. Commit.

**Acceptance:** 49 valid MultiPolygon/4326 rows; GIST index present; clean Down/Up round-trip; down-chain test still green. If any `ST_IsValid` fails, run geometries through `ST_MakeValid` in A1 before emitting (or lower tolerance).

### Task A3: db-client accessors `resolveStateForPoint` + `listStatesWithBbox`

**Files:**
- Create: `packages/db-client/src/state-boundaries.ts`, `packages/db-client/src/state-boundaries.test.ts`
- Modify: `packages/db-client/src/index.ts`, `packages/shared-types/src/index.ts`

- [ ] **Step 1:** Add to shared-types: `export interface StateSummary { stateCode: string; name: string; bbox: [number, number, number, number]; }` (tuple order `[west,south,east,north]`, matching `ObservationFilters.bbox`).
- [ ] **Step 2:** New module `state-boundaries.ts` (follows the `getHotspots` accessor shape):
  ```ts
  export async function resolveStateForPoint(pool: Pool, lng: number, lat: number): Promise<string | null> {
    const { rows } = await pool.query<{ state_code: string }>(
      `SELECT state_code FROM state_boundaries
       WHERE ST_Intersects(geom, ST_SetSRID(ST_MakePoint($1,$2),4326))
       ORDER BY state_code ASC LIMIT 1`, [lng, lat]);
    return rows[0]?.state_code ?? null;
  }
  export async function listStatesWithBbox(pool: Pool): Promise<StateSummary[]> {
    const { rows } = await pool.query(
      `SELECT state_code, name, min_lng, min_lat, max_lng, max_lat
       FROM state_boundaries ORDER BY name ASC`);
    return rows.map(r => ({ stateCode: r.state_code, name: r.name,
      bbox: [r.min_lng, r.min_lat, r.max_lng, r.max_lat] }));
  }
  ```
  `ST_Intersects` (not `ST_Contains`) per locked decision #1 — a border-shared point resolves deterministically (`state_code ASC`) rather than vanishing. `listStatesWithBbox` **must not** select `geom`. Export both + `StateSummary` from `index.ts`.
- [ ] **Step 3: Test** (`state-boundaries.test.ts`, testcontainers, no mocks): `resolveStateForPoint(-110.97,32.22)==='US-AZ'` (Tucson); `(-106.0,34.5)==='US-NM'` and not AZ; `(-160,40)===null` (Pacific); a **near-border control point** a few km inside AZ near the NM line resolves `US-AZ` (over-simplification guard); `listStatesWithBbox` → 49 name-sorted rows, 4-tuple bbox, no `geom` key. Run → green. Commit.

### Task A4: `GET /api/states` endpoint

**Files:**
- Modify: `services/read-api/src/app.ts`, `services/read-api/src/cache-headers.ts`, `services/read-api/src/app.test.ts`, `services/read-api/src/cache-headers.test.ts`

- [ ] **Step 1:** Add a `'states'` key to `cache-headers.ts` `TABLE`: `'public, max-age=604800, s-maxage=604800, immutable'` (build-time-stable; a seed change ships as a new deploy that busts the edge). Add the `Endpoint` union member `'states'`.
- [ ] **Step 2:** Add the handler near `/api/silhouettes` (`app.ts:287`):
  ```ts
  app.get('/api/states', async (c) => {
    const rows = await listStatesWithBbox(deps.pool);
    c.header('Cache-Control', cacheControlFor('states'));
    return c.json(rows); // StateSummary[]; geom never leaves the server (A3 excludes it)
  });
  ```
  Comment the endpoint-over-bundled-JSON decision + drift rationale so Stream C inherits the contract.
- [ ] **Step 3: Test** (`app.test.ts`, real testcontainer pool — `state_boundaries` comes from migrations `startTestDb` applies): `GET /api/states` → 200, body length 49, name-sorted, bbox tuple, **no `geom` key**, exact Cache-Control string. Add a `cache-headers.test.ts` case for `'states'`. Run → green. Commit.

---

# Stream B — API State Clip

Makes `?state=US-XX` a hard server-side boundary. Whole-US (`?state` absent) stays byte-for-byte identical, so every task is independently mergeable. **Depends on A2** (`state_boundaries` table). Confirm the literal DDL identifiers with Stream A before B3.

### Task B1: shared-types — `stateCode` + `meta.truncated`

**Files:** Modify `packages/shared-types/src/index.ts`

- [ ] **Step 1:** Add `CONUS_STATE_CODES` (frozen `readonly` array of the 49 `US-XX` codes) + `export type StateCode = typeof CONUS_STATE_CODES[number]` — the single source the validator (B2), the ZIP contract (D4), and the selector (C) all import (locked decision #6).
- [ ] **Step 2:** In `ObservationFilters` (`:143-162`) add `stateCode?: string;` adjacent to `bbox`/`zoom`, doc-commented as the hard data boundary (`?state=US-XX`, AND-s with bbox/filters, whole-US = absence).
- [ ] **Step 3:** Extend **both** `ObservationsResponse` union members' `meta` from `{ freshestObservationAt }` to `{ freshestObservationAt; truncated?: boolean }`. **Optional** (stale CDN bodies deserialize cleanly; aggregated mode omits it).
- [ ] **Step 4:** `tsc`/`npm run build` green across all workspaces (the new fields are optional → no consumer breaks). Commit. *(Type-only; runtime exercised by B3/B5/B6.)*

### Task B2: `parseState` validator

**Files:** Modify `services/read-api/src/validate.ts`, `services/read-api/src/validate.test.ts`

- [ ] **Step 1:** Mirror `parseFamily` (`validate.ts:130-146`). Import `CONUS_STATE_CODES` from shared-types (build the `Set` from it — do not re-list). Accept bare `'AZ'` OR eBird `'US-AZ'`, normalize to `'US-XX'`:
  ```ts
  export function parseState(raw: string | undefined): Result<string | undefined> {
    if (raw === undefined) return { ok: true, value: undefined };
    const code = raw.toUpperCase().replace(/^US-/, '');
    const full = `US-${code}`;
    if (CONUS_CODE_SET.has(full)) return { ok: true, value: full };
    return { ok: false, error: 'invalid state',
      log: { severity: 'INFO', message: 'validation_400', param: 'state',
             received_hash: hash(raw), reason: 'not_in_allowlist' } };
  }
  ```
  Reuse the module `hash()` + `ValidationLog` (`'not_in_allowlist'` already in the union — no type change).
- [ ] **Step 2: Test** (mirror the `parseFamily` describe + `it.each` rejection table): accepts `'AZ'→'US-AZ'`, `'US-CA'→'US-CA'`, lowercase `'az'→'US-AZ'`; **rejects** `'AK'`,`'HI'`,`'PR'`,`'XX'`,`''`,`'%'`,`"' OR 1=1 --"`,`'US-'`,`'ARIZONA'`,`'1'` with `param:'state'`, `reason:'not_in_allowlist'`, `received_hash` matching `/^[a-f0-9]{8}$/`; undefined → ok+undefined; **assert allowlist size === 49**. Run → green. Commit.

### Task B3: `ST_Intersects` state clip in both query paths

**Files:** Modify `packages/db-client/src/observations.ts`, `packages/db-client/src/observations.test.ts`

- [ ] **Step 1:** Add an identical clip block to **both** `getObservations` (after the bbox block, `:166`, before `const where`) and `getObservationsAggregated` (after its bbox block, `:276`):
  ```ts
  if (f.stateCode) {
    const si = params.length + 1;
    conditions.push(`o.geom && (SELECT geom FROM state_boundaries WHERE state_code = $${si})`);
    conditions.push(`ST_Intersects((SELECT geom FROM state_boundaries WHERE state_code = $${si}), o.geom)`);
    params.push(f.stateCode);
  }
  ```
  Single `params.push` backs two `$${si}` references (mirrors the bbox `i1..i4` pattern). The `&&` envelope-overlap uses the `obs_geom_idx` GIST index to prune to the state's bbox; `ST_Intersects` then does the exact polygon test. Appending to `conditions[]` AND-s it with since/notable/species/family/bbox automatically. **Arg order: polygon first.** `ST_Intersects` (inclusive) per locked decision #1.
- [ ] **Step 2: Test** (testcontainers; the existing AZ fixtures S200/S201/S202 + a new FL-coords row `(27.8,-81.7)`; `state_boundaries` is seeded by A2's migration): (a) `{stateCode:'US-AZ'}` → all 3 AZ rows **and assert the set is non-empty** (catches an inverted predicate); (b) the FL row is excluded by `US-AZ`, included by `US-FL`; (c) a row on the exact AZ/NM border resolves into **exactly one** state (not zero — the `ST_Contains` regression guard); (d) `{stateCode:'US-AZ', bbox:[-111,31.5,-110.85,31.9]}` AND-narrows to S200; (e) `{stateCode:'US-AZ', speciesCode:'vermfly'}` composes; (f) aggregated path applies the same clip; (g) absent `stateCode` leaves existing tests green. Run → green. Commit.

### Task B4: `assertBboxOrSpecies` accepts state as a bounded scope

**Files:** Modify `services/read-api/src/validate.ts`, `services/read-api/src/validate.test.ts`

- [ ] **Step 1:** A `?state=` request is bounded by the polygon. Widen the guard (`:216-234`) signature to `{bbox, speciesCode, stateCode}` (all optional) and the accept condition to `if (args.bbox !== undefined || args.speciesCode !== undefined || args.stateCode !== undefined)`. **Keep the error string `'specify bbox or species'` UNCHANGED** (`app.test.ts:285` string-matches it). Add a doc line on `assertBboxAreaCap` recording that the state-only path never reaches it (no bbox → `app.ts` skips the call); **no code change** to the area cap.
- [ ] **Step 2: Test:** passes for state-only (bbox+species undefined); passes for state+bbox; still rejects all-three-absent with the unchanged string + `{param:'bbox_required', reason:'missing_required'}`. Run → green. Commit.

### Task B5: thread `?state=` through `app.ts`

**Files:** Modify `services/read-api/src/app.ts`, `services/read-api/src/app.test.ts`

- [ ] **Step 1:** Import `parseState`. After the family block (`:140-145`) add the parse + 400-on-reject (mirror `parseSpecies`). Set `filters.stateCode` **before** the aggregated-mode branch (`:200`) so the clip applies in **both** aggregated and per-obs modes. Update the guard call to `assertBboxOrSpecies({ bbox, speciesCode, stateCode })`.
- [ ] **Step 2: Test** (testcontainers; seed is AZ-only): (a) `?state=US-AZ` (no bbox) → 200 `mode:'observations'` + AZ rows (proves the guard accepts state); (b) `?state=US-FL` → 200 **empty** (mandatory empty-state path); (c) `?state=banana` and `?state=US-AK` → 400 `'invalid state'`; (d) `?state=US-AZ&bbox=...` → AND-narrowed; (e) `?state=US-AZ&zoom=4&bbox=...` → `mode:'aggregated'` (clip applies in aggregated mode); (f) `?state=` request preserves `s-maxage=300`. Run → green. Commit.

### Task B6: ship the deferred `LIMIT 10000` brake + `meta.truncated`

> Sequenced **immediately after B3** and shipped as **one atomic PR** — it changes `getObservations`'s return shape, which ripples to `app.ts` and every `observations.test.ts` destructure. CI must never be red mid-change.

**Files:** Modify `packages/db-client/src/observations.ts`, `observations.test.ts`, `services/read-api/src/app.ts`, `app.test.ts`

- [ ] **Step 1:** In `getObservations`: `const cap = f.speciesCode ? 5000 : 10000;` and always `LIMIT ${cap + 1}`. After the query: `const truncated = rows.length > cap; const data = truncated ? rows.slice(0, cap) : rows;` map `data`. Change the return type to `Promise<{ data: Observation[]; truncated: boolean }>`. Update the deferred-language comment (`:170-176`) to reflect the shipped brake.
- [ ] **Step 2:** Update the sole caller `app.ts:253` → destructure `obsResult.data`; set `meta: { freshestObservationAt, ...(obsResult.truncated ? { truncated: true } : {}) }` (omit when false). Aggregated branch unaffected.
- [ ] **Step 3:** Migrate **all** `observations.test.ts` reads of the old array shape to `.data` (the species cap test now asserts `data.length===5000` + `truncated===true`; the prior 5500-no-cap test asserts `data.length===5500` + `truncated===false`; **add** a 10001-row test → `data.length===10000` + `truncated===true`). `getObservationsAggregated` still returns a bare array — leave its callers. `app.test.ts`: a truncated response surfaces `meta.truncated===true`; a normal one omits it. Run all suites → green. Commit.

> **Open decision to confirm before locking 10000:** a dense state (CA/TX) over 14d at high per-obs zoom could approach the cap. Quick prod-data sanity check; aggregated mode covers the low-zoom dense case, so per-obs truncation only bites at high zoom (small bbox) where it's harmless. Raise the per-state cap only if real counts warrant.

### Task B7: confirm zero cache-headers change

**Files:** Modify `services/read-api/src/app.test.ts` (verification only)

- [ ] **Step 1:** `?state=` rides the full-URL cache key exactly like `?bbox=` (`app.ts:147-151` documents this) — **no `cache-headers.ts` diff.** Assert (via B5 case (f)) a `?state=` observations request returns `'public, s-maxage=300, stale-while-revalidate=600'`; confirm `git diff cache-headers.ts` is empty; no new `Endpoint` value, no `Vary` change. Record the decision in a one-line comment. Commit.

---

# Stream D — ZIP Resolution

A user types a 5-digit ZIP → the map clips to the ZIP's CONUS state (via `?state=`) and flies to the ZIP centroid at metro zoom. Precomputed, offline-built, lazily-fetched `{zip,lat,lng,state}` index (state precomputed by PIP against A's polygons — no runtime ZIP→state lookup). **Depends on A1's `data/us-state-polygons.geojson`.**

### Task D1: vendor the 2020 ZCTA Gazetteer

**Files:** Create `scripts/zip-etl/fetch-zcta-gazetteer.sh`, `scripts/zip-etl/README.md`, `scripts/zip-etl/.gitignore`

- [ ] Idempotent fetch of public-domain `2020_Gaz_zcta_national.zip` (`https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip`), **pinned sha256** (mismatch exits non-zero), unzip to `.cache/` (gitignored — only the script + hash committed). ~33,791 rows (GEOID/ZCTA5, INTPTLAT, INTPTLONG). README: source URL + 17 U.S.C. §105 public-domain + column semantics. **Only task that touches the network**; D2 runs offline on the cached file so CI never fetches.

**Acceptance:** script produces `.cache/2020_Gaz_zcta_national.txt` (~33,791 rows); sha256 verified; `.cache/` gitignored.

### Task D2: offline ETL → columnar `zip-index.json`

**Files:** Create `scripts/zip-etl/build-zip-index.ts`, `build-zip-index.test.ts`, `scripts/zip-etl/state-polygons.ts`, `frontend/public/zip-index.json`, `scripts/zip-etl/SIZE-REPORT.md`

- [ ] **Step 1:** `tsx` script reads the cached gazetteer. For each row: parse `INTPTLAT/INTPTLONG`, run **point-in-polygon against `data/us-state-polygons.geojson`** (A1's canonical artifact — locked decision #6; use `@turf/boolean-point-in-polygon` as a **devDependency** if not already present) → resolve `US-XX`. **Drop** any centroid in no CONUS state (AK/HI/PR/ocean) to `dropped.log`.
- [ ] **Step 2:** Emit `frontend/public/zip-index.json` in a **columnar** encoding (not array-of-objects): `{ v:1, states:['US-AL',...], zips:{ '01001':[lat,lng,stateIdx], ... } }`, coords rounded to **5 decimals**. Record in `SIZE-REPORT.md`: measured raw + gzip bytes, ZCTAs in / CONUS kept / non-CONUS dropped, and the **ZIP≠ZCTA caveat** (~41k USPS ZIPs vs ~33k ZCTAs; PO-box/military/point ZIPs absent → a minority of valid ZIPs MISS → D5 handles it explicitly).
- [ ] **Step 3: Test** (`build-zip-index.test.ts`, no network): a 10-row fixture (CONUS + 1 HI + 1 ocean-centroid) → CONUS kept with correct `US-XX`, non-CONUS dropped, columnar shape, 5-decimal rounding; 5 border ZIPs PIP-correct. Spot: `85701→US-AZ`, `10001→US-NY`, `96813 (Honolulu)→dropped`. Run → green. Commit.

### Task D3: lazy-fetch + in-memory-cache lookup module

**Files:** Create `frontend/src/data/zip-lookup.ts`, `zip-lookup.test.ts`, `docs/decisions/zip-delivery.md`

- [ ] **Step 1:** Record the static-asset-over-proxy decision in `docs/decisions/zip-delivery.md` (CDN-cached flat file vs a read-api proxy that adds a route + Cloud SQL round-trip + rate-limit surface for zero benefit — rejected). **Vite does NOT content-hash `public/` files** → append `?v=<datasetVersion>` to the fetch URL to bust the edge/browser cache on regeneration.
- [ ] **Step 2:** `loadZipIndex()` returns a **memoized** `Promise<ZipIndex>` (concurrent callers share one fetch; on rejection **clear the memo** so a later focus retries). `lookupZip(zip5)`: normalize (trim, strip `-####`, must match `/^\d{5}$/` else return `null` **without fetching**), await the index, return `{ zip, center:[lng,lat], stateCode }` or `null`.
- [ ] **Step 3: Test** (stubbed `fetch`): single-flight memo (2 concurrent calls → 1 fetch); retry-after-failure; `'85701'`→AZ resolution; `'abc'|'123'|''`→null with **no fetch**; `'85701-1234'`→strips +4; plus a build-output assertion that `zip-index` is **not** inlined in the Vite entry chunk. Run → green. Commit.

### Task D4: `ScopeResolution` contract

**Files:** Create `frontend/src/state/scope-types.ts`, `scope-types.test.ts`

- [ ] Pure types, **no React**: import `StateCode`/`CONUS_STATE_CODES` from shared-types (single source — locked decision #6). `interface ScopeResolution { stateCode: StateCode; center: [number, number]; zoom: number }` (center is `[lng,lat]`, MapLibre order); `interface ZipResolution { zip: string; center: [number, number]; stateCode: StateCode }`; `export const ZIP_FLYTO_ZOOM = 10` (metro framing, inside `MAX_BOUNDS`, ≥6); `zipResolutionToScope(z)` → `{stateCode, center, zoom: ZIP_FLYTO_ZOOM}`. Test: mapper sets zoom=10 + center passthrough. Run → green. Commit.

### Task D5: `ZipInput` component + "not recognized" UX

**Files:** Create `frontend/src/components/ZipInput.tsx`, `ZipInput.test.tsx`; Modify `frontend/src/styles.css`

- [ ] **Step 1: TSX.** Controlled native `<input>` (repo pattern — no combobox lib): `inputMode='numeric'`, `pattern='[0-9]{5}'`, `maxLength=5`, `aria-label='ZIP code'`. **On focus** → `loadZipIndex()` (warms the dataset; this is the lazy-load trigger that keeps it out of the entry bundle). On Enter/Search → `lookupZip` → states: resolved → `props.onResolve(zipResolutionToScope(res))`; **notRecognized** (well-formed 5-digit, lookup null) → visible `role='status' aria-live='polite'` "ZIP not recognized — try a nearby ZIP or pick a state", **keep the input value** (never silent no-op); malformed → inline "Enter a 5-digit ZIP" (no fetch); fetch error → `role='alert'` "Could not load ZIP data — pick a state instead".
- [ ] **Step 2: Write CSS rules for ZipInput.** In `frontend/src/styles.css`, add rules for every className introduced: `.zip-input`, `.zip-input__field`, `.zip-input__status`, `.zip-input__error`. Verify:
  ```
  grep -cE '^\.(zip-input|zip-input__field|zip-input__status|zip-input__error)' frontend/src/styles.css
  ```
  Expected: non-zero for every class (orphan-classname check + knip block the queue otherwise).
- [ ] **Step 3: Test** (RTL, stub `zip-lookup`): valid→`onResolve` payload (stateCode+center+zoom=10); unknown→status message + `onResolve` NOT called; malformed→inline message + no lookup; fetch-error→alert; `loadZipIndex` fires **on focus not mount**. Run → green. Commit.

### Task D6: e2e — ZIP round-trip + empty-state

**Files:** Create `frontend/e2e/zip-scope.spec.ts`; Modify `frontend/e2e/pages/app-page.ts`, `frontend/e2e/fixtures.ts`

> Depends on **C7** (the sparse/empty-region copy) — the non-AZ case asserts that copy.

- [ ] POM accessors for the ZIP input + status/alert regions. `fixtures.ts` `page.route` stub serving a **small canned** `zip-index.json` for `/zip-index.json*` (incl. `?v=`) — never the real 1 MB index in e2e. Cases: (1) `85701` → URL gains `?state=US-AZ`, camera moved (assert via bbox/zoom URL change or the camera-handle data-attr agreed with C), data clips to AZ; (2) `10001` (US-NY, **empty** on the AZ-only seed) → the **distinct** sparse/empty-scope copy (NOT "No sightings match your filters") — mandatory; (3) unknown well-formed ZIP → "ZIP not recognized" visible, scope/URL unchanged; (4) malformed → inline validation, **zero** `/zip-index.json` requests. Navigation contract: `page.goto` first; wait for map load on data cases, skip on the empty case. No DB writes (the no-write grep stays clean). Run → green. Commit. **Pair with the 5×2 screenshot capture + `ui-design:ui-designer` design review** (frontend UI change).

---

# Stream C — Frontend Scope Core ⚠️ GATED on the C0 prototype

**Prototype gate (CLAUDE.md):** No Stream-C plan body (tasks C2–C9: task lists, acceptance criteria) may be finalized until the C0 render prototype is built and `prototype-learnings.md` is committed. C0 and C1 are authored in full below; **C2–C9 are task shells** — their detailed steps/AC are authored in a plan amendment committed *alongside* the learnings note. This is a deliberate gate, not a placeholder omission.

### Task C0: PROTOTYPE GATE — scoped-state render at production volume

**Files:** Create `frontend/prototypes/scope-prototype/{index.html,main.tsx,canned-az-scoped.json}`, `docs/plans/2026-05-28-state-scope-selector/prototype-learnings.md`

- [ ] **Step 1:** Local Vite entry rendering `MapCanvas` + a proposed `StateSelector` + a `fitBounds`-on-scope-change effect, against **≥344** canned AZ-clipped observations (full production `Observation` shape). Mock camera handle calls `map.fitBounds(stateBbox,{padding:48,duration:600})` on scope change and sets `maxBounds` to the state bbox.
- [ ] **Step 2:** Drive via Playwright MCP at **390×844** and **1440×900**. Exercise: select state (reframe + clip), reset to Whole US (camera + `maxBounds` back to CONUS `[[-130,20],[-65,52]]`), ZIP→point-inside-state. `browser_console_messages` must be **zero errors AND zero warnings**.
- [ ] **Step 3:** Commit `prototype-learnings.md` (5 findings): (a) does react-map-gl 5.x honor a changing `maxBounds` prop without remount? (b) does `fitBounds` conflict with `initialViewState` in the uncontrolled-camera lifecycle? (c) padding that keeps a state framed at both viewports; (d) does the bbox-debounce refetch loop fight the `fitBounds` animation? (e) any sprite/SDF console noise at 344 rows. **This note must land before the C2–C9 amendment.**

### Task C1: context7 — maplibre-gl/react-map-gl 5.x camera

**Files:** Create `docs/plans/2026-05-28-state-scope-selector/context7-maplibre-5x-notes.md`

- [ ] Per CLAUDE.md's context7 rule (maplibre-gl is drift-flagged, 5.x since PR #199), query context7 for: (1) is `maxBounds` reactive on `<Map>` post-mount or does it need imperative `map.setMaxBounds()` in a `useEffect`? (2) `MapRef.getMap().fitBounds(bounds, options)` signature in 5.x — padding object vs number, and whether `essential:true` is needed to bypass reduced-motion auto-cancellation; (3) `initialViewState` (uncontrolled) vs post-mount imperative `fitBounds` interaction. Feeds C3. Runs parallel to C0.

### Tasks C2–C9 (shells — bodies authored post-C0)

Each is one PR. **Mandatory per project writing-plans skill:** every task touching `frontend/src/components/**` carries an explicit CSS sub-task (exhaustive className list + the `grep -cE` verification), and C9 carries the 5-viewport × 2-theme design-review dispatch.

| Task | Title | Files | Deps | Gates |
|---|---|---|---|---|
| **C2** | `state`+`zip` in `UrlState`/`DEFAULTS`/`readUrl`/`writeUrl` + validation + precedence (deep-link `?state`+`?zip` disagree → state wins, zip dropped; whole-US = absence of `?state`) | `url-state.ts`, `url-state.test.ts`, `api/client.ts` (`?state=` mapping) | — | — |
| **C3** | Controllable `MapCanvas` camera: scope-change `fitBounds` + dynamic `MAX_BOUNDS` (CONUS when whole-US) | `MapCanvas.tsx`, test | C0, C1 | reduced-motion `duration:0` |
| **C4** | On-map `ScopeControl`: native `<select>` StateSelector + Whole-US + `<ZipInput>` (D5) | `ScopeControl.tsx`, `styles.css`, test | C2 | **CSS sub-task**; a11y |
| **C5** | Runtime `regionLabelFor(scope)` replacing build-time `REGION_LABEL` across **5** consumers (AppHeader, MapLede, SurfaceTitleSync, FeedSurface, App.tsx); update `region.test.ts` | `region.ts` + 5 consumers | C2 | — |
| **C6** | Wire scope end-to-end in `App.tsx`: `?state`→clip filter, `scopeBounds`→camera, ZIP `onResolve`→scope+flyTo | `App.tsx` | C2,C3,C4,C5,D5 | one refetch per change |
| **C7** | Distinct sparse/empty-region `MapLede` template + `FilterSentence` scope narration (data-availability ≠ filter-narrowing; "no filters" must include `since===DEFAULT_SINCE`) | `MapLede.tsx`, `ds/FilterSentence.tsx`, tests | C5 | **CSS sub-task** if new classes |
| **C8** | CSS for `ScopeControl` + scope surfaces; orphan-classname + knip clean | `styles.css`, `ds-primitives.css` | C4,C7 | orphan-classname |
| **C9** | e2e (state-select, whole-US reset, empty-state) + POM + **5×2 screenshots + `ui-design:ui-designer` design review** | `state-scope.spec.ts`, POM | C6,C8 | ≥10 attachments + ui-design PASS |

---

## Out of scope (explicit)

- **AK / HI / territories** — no data, outside `MAX_BOUNDS`, antimeridian math deferred (matches #601 §5.1 non-goal).
- **National hotspots** — the hotspots lane is still `US-AZ` (`cli.ts:241`); if the scope UI ever shows hotspot markers, Step B of #601 ships first (out of scope here).
- **Deeper per-state history** — only the rolling 14-day national window exists; the 50-state historic backfill stays paused. Sparse states reading "thin" is a known intermediate state, handled by C7's copy, not by ingest work here.
- **`?zip=` URL persistence** — v1 resolves ZIP→scope+camera; `?state=` is the shareable unit.
- **Strict polygon at sub-state granularity / county scope** — state is the finest clip.

## Cross-tier review discipline

Per NYU (Jan 2026) cross-tier discipline: the implementer tier and the `julianken-bot` reviewer tier must differ. Pin the reviewer tier explicitly when dispatching the bot per PR (`model: "sonnet"` if the implementer ran Opus, `"opus"` if Sonnet). The C9 design-review dispatches `ui-design:ui-designer` at `model:"opus"` per CLAUDE.md.

## Self-review (author checklist — completed)

- **Spec coverage:** every locked decision maps to a task (strict polygon → A/B3; ZIP v1 → D; CONUS-only → A1 filter + B2 allowlist; request model → B3/B5; triple-duty polygons → A1 GeoJSON consumed by A2+D2; `/api/states` → A4; one-allowlist → B1). ✓
- **Placeholder scan:** no vague TODOs. C2–C9 are explicitly gated shells (the prototype gate forbids authoring their bodies now), not lazy omissions — this is the documented exception. ✓
- **Type consistency:** `state_boundaries(state_code, geom)` identical across A2/A3/B3/D2; `StateSummary` bbox tuple `[w,s,e,n]` matches `ObservationFilters.bbox`; `ScopeResolution.center` is `[lng,lat]` everywhere; `getObservations` new return shape `{data,truncated}` updated at its sole caller + all tests in B6. ✓
- **CSS gate self-grep:** the only fully-authored component task is D5 (`ZipInput`), which carries its CSS sub-task. C4/C7/C8 CSS sub-tasks are flagged in the shells and become mandatory steps in the post-C0 amendment. ✓
