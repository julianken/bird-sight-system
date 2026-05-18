# PMTiles / MVT Observation Tile Serving from R2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan assumes zero prior context for this codebase — every task lists exact file paths, expected commands, and a commit-message template.

**Tracking issue:** #628 (umbrella). No sub-issue is filed — #628's body is the authoritative spec; this plan elaborates it.

**Goal:** Replace the JSON-driven primary observation map layer with pre-rendered MVT vector tiles served from a Cloudflare R2 bucket (`bird-maps-observation-tiles`) behind a public Worker at `tiles.bird-maps.com`. A scheduled Cloud Run Job (`bird-tile-builder`) rebuilds the full tileset hourly from the `observations` table. The frontend's MapLibre map switches its observation source from `geojson` (driven by `/api/observations`) to `vector` (driven by the tile URL). `/api/observations` stays alive for species-overlay use cases and as a fallback during cutover but ceases to be the primary low-zoom path.

**Architecture:** Three-tier change. (1) **Build pipeline** — new Cloud Run Job runs `tippecanoe` over a per-run GeoJSON dump of `observations`, writes `{z}/{x}/{y}.pbf` tiles into R2 via the existing S3-client uploader pattern, atomically swaps a `current/` prefix when the build succeeds. (2) **Edge** — new Terraform-managed R2 bucket + Worker (clone of `infra/workers/silhouette-server.js`) at `tiles.bird-maps.com`. CORS allows `https://bird-maps.com` (and `localhost:5173` for dev). (3) **Frontend** — `MapCanvas` switches the observation source to a vector source pointing at the tile URL, and rewires the existing supercluster + adaptive-grid rendering to consume `queryRenderedFeatures` from the new vector layer instead of the `geojson` source's promise-based clustering API.

**Tech Stack:** `tippecanoe` (run inside a Debian-slim Cloud Run Job container; preferred over `ST_AsMVT` — see §1 below) · `@aws-sdk/client-s3` against R2 (mirrors `services/ingestor/src/r2/uploader.ts`) · `pg` streaming COPY for the GeoJSON dump · `node-pg-migrate` for any schema additions (none expected) · MapLibre-GL 5.x `addSource({ type: 'vector', tiles: [...] })` · Cloud Run v2 Job + Cloud Scheduler (mirrors `services/ingestor/`'s `run-photos.ts` / `run-ingest.ts` worker pattern) · Cloudflare Workers + R2 (mirrors `bird-maps-silhouettes`).

**Parent:** Issue #628. Umbrella plan reference: docs/specs/2026-04-16-bird-watch-design.md §5.6 / R4 (bbox + tile-based serving named as the perf-tier sequence). This plan executes the *tile-based serving* half of that sequence; PR #626 shipped the *bbox filtering* half.

**Phase placement:** **Phase 4 v1.1** as the issue specifies. Not a flip blocker. Hotspot-density viability report (`docs/analyses/2026-05-17-hotspot-density-100k-viability/report.md`) plus the zoom-aware aggregation in sibling issue #627 carry the launch window; this plan is the proper scaling answer that lands a few weeks after launch once the in-flight perf work (#626, #627) is settled.

---

## §1 — Tooling choice: `tippecanoe` vs PostGIS `ST_AsMVT`

Two viable engines for turning `observations` rows into `{z}/{x}/{y}.pbf` tiles. The right pick depends on the worker model bird-watch already runs.

### Option A — `tippecanoe` (Mapbox-supported; offline GeoJSON → MVT)

Process model: a Cloud Run Job (Debian-slim image with `tippecanoe` apt-installed) dumps `observations` to GeoJSON via `pg`'s `COPY (SELECT … json_build_object(...))`, runs `tippecanoe -o observations.mbtiles -z 12 -Z 0 ...`, then unpacks the `.mbtiles` SQLite file into `{z}/{x}/{y}.pbf` keys and PUTs them into R2.

| Pro | Con |
|---|---|
| Battle-tested at petabyte scale (Mapbox, Protomaps). | Adds a binary apt dependency (`tippecanoe`). |
| Dedicated clustering / coalescing flags (`--cluster-distance`, `--accumulate-attribute`) — the right knobs for "observation density at zoom 4". | Build time scales with observation count: ~30s for AZ-only (~50k rows), ~5–10 min for national (~5M rows). |
| Output is a single `.mbtiles` SQLite file — easy atomic swap (`current.mbtiles` → new file) before R2 unpack. | Two-stage Dockerfile is larger (~250 MB vs ~120 MB for a pure-Node job). |
| Decouples build cadence from request rate — a tile build runs hourly, tiles serve at edge-cacheable O(1). | Per-build full re-render; no incremental update path without significant extra engineering. |
| Matches bird-watch's existing Cloud Run Job worker model exactly (mirrors `services/ingestor/`). | |

### Option B — PostGIS `ST_AsMVT` (in-DB tile generation at request time)

Process model: `/api/tiles/observations/:z/:x/:y.pbf` route on the read-api runs `SELECT ST_AsMVT(q, 'observations', 4096, 'geom') FROM (SELECT … ST_AsMVTGeom(geom, ST_TileEnvelope(:z, :x, :y), 4096, 64, true) AS geom FROM observations WHERE geom && ST_TileEnvelope(:z, :x, :y)) q`. Hono streams the bytes; Cloudflare caches by tile URL.

| Pro | Con |
|---|---|
| No extra binary dependency; PostGIS already in the schema. | **Defeats the cost argument.** Every cold tile is a Postgres query — adds load to the same Neon free-tier instance that the rest of the stack runs on. |
| Tiles are always current (no rebuild lag). | Needs aggressive Cloudflare cache TTL to amortize; cold tile-by-tile worst case under cache churn is a per-tile DB hit. |
| Aligns with the read-api's existing `Hono` shape — one new route, one new SQL helper. | Re-couples observation density to request rate; the umbrella plan §5.6 / R4's motivation was specifically to decouple them. |
| | At national scale, the `geom &&` query at zoom 4–6 returns ~hundreds of thousands of rows per tile; query times dominate. |
| | Loses access to tippecanoe's clustering / coalescing knobs — would need to reimplement them as SQL aggregations per zoom. |

### Recommendation: `tippecanoe`

Reasons in order of weight:

1. **Worker-model match.** Bird-watch already runs scheduled Cloud Run Jobs for ingest, photos, hotspots, descriptions, taxonomy, prune (`services/ingestor/src/run-*.ts`). A tile-builder job slots into the existing CI/CD, secrets, monitoring, and budget infrastructure with zero new operational surface. `ST_AsMVT` would put map-rendering load on the read-api and the database — the wrong tier.
2. **Cost argument intact.** The whole point of moving to tiles is to decouple observation density from request rate and let Cloudflare absorb the load with free R2 egress. `ST_AsMVT` reintroduces request-time cost.
3. **Clustering knobs.** `tippecanoe --cluster-distance=10 --accumulate-attribute=count:sum --maximum-zoom=12 --base-zoom=8` gives the right shape for "show density at low zoom, individual points at high zoom" with one CLI invocation. PostGIS would need a per-zoom CTE per-tile.
4. **Hourly cadence is fine.** Observations refresh every hour via the existing ingest job (`services/ingestor/src/run-ingest.ts`). A 1-hour tile rebuild lag rounds to zero on top of a 1-hour data lag. Freshness story (§6) discusses the user-visible impact.

If `tippecanoe` ever becomes operationally painful (binary CVEs, apt-mirror availability, build-time scaling), Option B is the documented fallback. The frontend tile-source URL is the same shape either way (only the URL template host changes), so a swap is a pure infra-side change.

---

## §2 — R2 bucket layout

### Bucket: `bird-maps-observation-tiles`

Mirrors `bird-maps-silhouettes` exactly (`infra/terraform/silhouettes.tf`). Location `WNAM` (Western North America — closest to AZ users). `prevent_destroy = false` — the bucket is fully re-runnable from the build job; a destroy costs one hourly tick of rebuild work, not data loss.

### Key structure

```
current/{z}/{x}/{y}.pbf       — the live tileset (served at edge)
build-<ISO8601>/{z}/{x}/{y}.pbf — staging area for an in-flight build
metadata.json                  — build manifest (timestamp, observation count, tile count, tippecanoe args)
```

**Atomic swap.** The build job writes all tiles under `build-<ts>/`. When the build completes successfully, it writes a new `metadata.json` pointing at the just-completed `build-<ts>/` prefix, then issues an R2 `CopyObject` loop (or a parallel batch) to mirror `build-<ts>/*` → `current/*`. The Worker always serves from `current/`. A failed build leaves `current/` untouched; the build job logs the partial `build-<ts>/` prefix and aborts. A nightly cleanup task (folded into the build job's startup phase) deletes `build-<ts>/` prefixes older than 24h.

**Alternative considered: partitioned-by-region** (`current/{region}/{z}/{x}/{y}.pbf`). Rejected for v1.1 — the AZ scope makes partitioning unnecessary, and at national scale the per-tile size dominates over per-prefix overhead. If a future iteration adds per-region build pipelines (e.g. AZ rebuilt every 30min, CA every 60min), introduce the partition then.

### CORS

R2 bucket CORS allows `GET` from:
- `https://bird-maps.com`
- `https://*.bird-maps.com` (preview deployments)
- `http://localhost:5173` (Vite dev server)

Mirrors `bird-maps-silhouettes` CORS. The Worker also sets `Access-Control-Allow-Origin: *` on tile responses (tile bytes are public; the bucket is fronted by a public Worker, not signed URLs).

### Public read setup

Same pattern as `silhouettes`: R2 bucket stays private; a Cloudflare Worker at `tiles.bird-maps.com/*` is the only public ingress. Worker source at `infra/workers/tile-server.js` is a clone of `infra/workers/silhouette-server.js` with `contentTypeFor` returning `application/x-protobuf` for `.pbf` and `Content-Encoding: gzip` honored from the R2 object metadata (tippecanoe outputs gzipped PBFs by default; we preserve the encoding).

Cache headers: `Cache-Control: public, max-age=3600, s-maxage=3600` — matches the 1-hour rebuild cadence. The atomic-swap mechanism rotates the underlying bytes; a stale-while-revalidate window of up to 1h is the documented freshness tradeoff (§6).

---

## §3 — Cloud Run Job spec: `bird-tile-builder`

New job under `services/tile-builder/`. Mirrors `services/ingestor/` two-stage Dockerfile but with `tippecanoe` apt-installed in the runtime stage.

### Image

```dockerfile
# Stage 1 — Node build
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY packages/db-client packages/db-client
COPY packages/shared-types packages/shared-types
COPY services/tile-builder services/tile-builder
RUN npm ci --workspaces --include-workspace-root
RUN npm run build --workspace @bird-watch/tile-builder

# Stage 2 — Runtime with tippecanoe
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    tippecanoe \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/services/tile-builder/dist ./dist
COPY --from=build /app/packages ./packages
ENTRYPOINT ["node", "dist/index.js"]
```

Note: Debian Bookworm has `tippecanoe` in the standard apt repos as of mid-2025. If the Bookworm version lags upstream Mapbox, build tippecanoe from source in stage 1 instead (~30s extra build time) — this is a known fallback documented at the head of `Dockerfile`.

### Schedule

Cloud Scheduler `bird-tile-builder` runs every hour at `:15` past the hour (`15 * * * *` UTC). Sequenced 15 minutes after the ingest job at `:00` to ensure the rebuild reflects the freshest data.

Lock detection: at job start, the runner reads `metadata.json` from R2. If the existing build is <55 minutes old, exit 0 silently (Cloud Scheduler retries on next tick). If a `build-<ts>/` prefix exists with no matching `metadata.json` (i.e. a previous run crashed mid-build), the runner deletes that prefix before starting. Idempotent.

### Sizing

| Scope | Observation count | Job CPU | Job memory | Expected wall time | Tile count |
|---|---|---|---|---|---|
| AZ (current) | ~50k rows | 2 vCPU | 2 GiB | 30–90 s | ~8k tiles (z0–z12) |
| National | ~5M rows | 4 vCPU | 8 GiB | 5–10 min | ~500k–1M tiles |

Cloud Run Job `task_timeout = 1800s` (30 min) — generous headroom for national worst-case. `max_retries = 1` (the Scheduler retries on next tick anyway).

### Worker pattern adopted

The `services/ingestor/src/run-ingest.ts` shape is the template: `startTileBuildRun()` / `finishTileBuildRun()` against a new `tile_builds` table (mirrors `ingest_runs`). The CLI entrypoint at `services/tile-builder/src/cli.ts` accepts `--region=US-AZ` (or `--region=all`), invokes `runTileBuild({ pool, region, r2 })`, exits with the run summary. Tests use `@testcontainers/postgresql` per CLAUDE.md's no-DB-mocks rule; R2 is mocked via `aws-sdk-client-mock`.

A new migration `migrations/<n>_create_tile_builds_table.sql` adds:

```sql
CREATE TABLE tile_builds (
  id BIGSERIAL PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','failure')),
  region TEXT NOT NULL,
  observation_count INTEGER NULL,
  tile_count INTEGER NULL,
  build_prefix TEXT NULL,
  error_message TEXT NULL
);
CREATE INDEX tile_builds_started_at_idx ON tile_builds (started_at DESC);
```

---

## §4 — Frontend MapLibre integration

`MapCanvas.tsx` (`frontend/src/components/map/MapCanvas.tsx`) currently registers the observations source as `type: 'geojson'` and consumes `/api/observations` via the existing `useObservations` hook. The vector-source switch is surgical: same data shape (each feature has `id`, `lat`, `lng`, `species_code`, `notable`, etc.); different transport.

### Source declaration

```ts
map.addSource('observations', {
  type: 'vector',
  tiles: [`${TILE_HOST}/current/{z}/{x}/{y}.pbf`],
  minzoom: 0,
  maxzoom: 12,
  // tippecanoe sets these from --attribution; verify post-build
  attribution: '© eBird observers',
  promoteId: 'id',
});
```

`TILE_HOST` resolves to `https://tiles.bird-maps.com` in production and `http://localhost:5173/tiles-proxy` in dev (Vite middleware proxies to R2 via the public Worker URL to avoid mixed-CORS during local Playwright runs).

### Styling layers

Three layers consume the vector source, named `observations-points`, `observations-clusters`, and `observations-cluster-count`. Tippecanoe's `--cluster-distance=10` pre-computes cluster aggregates at low zooms, so the layer-side logic uses `['get', 'point_count']` rather than supercluster's runtime aggregation:

```ts
// z < 8 — clusters
map.addLayer({
  id: 'observations-clusters',
  type: 'circle',
  source: 'observations',
  'source-layer': 'observations',  // tippecanoe sets this to the input filename
  filter: ['has', 'point_count'],
  paint: { /* mirrors current cluster style */ },
});

// z >= 8 — individual points; rendered by the existing adaptive-grid pill via queryRenderedFeatures
map.addLayer({
  id: 'observations-points',
  type: 'circle',
  source: 'observations',
  'source-layer': 'observations',
  filter: ['!', ['has', 'point_count']],
  paint: { /* mirrors current point style; the adaptive-grid pill renders over the top */ },
});
```

### Cluster compatibility with the adaptive-grid pill

This is the integration's tightest constraint. The existing adaptive-grid renderer (`frontend/src/components/map/AdaptiveGridMarker.tsx`) consumes a `Map<cellId, ObservationFeature[]>` derived from a `geojson` source's clustering API. With a vector source, the equivalent input is `map.queryRenderedFeatures({ layers: ['observations-points'] })` — same shape (an array of features with `properties` populated), but the data comes pre-tiled rather than from a single in-memory GeoJSON FeatureCollection.

Two integration risks (covered in the risk register, §8):

1. `queryRenderedFeatures` deduplicates by feature `id` only within the current viewport. The adaptive-grid renderer's deconflict module (`deconflict.ts`) currently assumes a complete dataset. A pre-tiled vector source loses features outside the viewport. Validation: a prototype task (§10 Task 0) builds a single-page Vite demo that pulls real tiles for AZ at z=8 and runs the existing deconflict logic over `queryRenderedFeatures` output. Acceptance: deconflict still produces the same pill positions ±2px at z=8 and z=10.
2. `tippecanoe` may drop attributes at low zooms by default. The cluster aggregator must explicitly preserve `species_code` lists (or a top-N) so the adaptive-grid pill can render family colors at z<8. The build command will be tuned: `tippecanoe -o observations.mbtiles -z 12 -Z 0 --cluster-distance=10 --accumulate-attribute=species_codes:comma --include=species_code --include=notable --include=family_code observations.geojson`.

---

## §5 — Cutover strategy

### Recommendation: **Option A (parallel-run, then deprecate)**

Both `/api/observations` (JSON) and the tile path are active simultaneously. The frontend tries the vector source first; if the source's `error` event fires (HTTP 4xx/5xx from the tile Worker, or a tile parse error), the map falls back to the existing `geojson` source for that session and logs a Sentry warning.

The fallback path stays alive through the **observation period** — defined as one 14-day observation window post-merge (the same span as the "observations in the last 14 days" product). After 14 days of zero fallback-fires in production telemetry (and zero unresolved tile-related issues), a follow-up PR removes the fallback code and the JSON observation path becomes species-overlay-only.

### Why not Option B (hard cutover)

The risk profile of swapping a load-bearing rendering source — touching the same code paths that the launch flip went through — is asymmetric. Tiles are pre-computed (§6 freshness lag); if a tile build runs at the wrong time and ships a malformed PBF, every user's map breaks until the next hourly rebuild. A 14-day parallel-run window lets that failure mode surface against real usage before the JSON path is removed. Cost of carrying both for 14 days is ~zero (the JSON path is already running for species overlays).

### What stays on `/api/observations` permanently

- **Species-specific overlays** — when the user filters by `species_code`, the map fetches `/api/observations?species_code=xxxx` and renders a thin overlay on top of the tile source. The full-tileset approach would require either per-species tilesets (multiplies storage by N species) or runtime filtering of tile features (does not scale at low zoom). The bbox-filtered JSON path stays the right answer for this case.
- **Detail panels** — opening a cell in the popover still queries `/api/observations?cell=xxx` to enumerate the cell's observations. Tiles carry aggregates, not per-observation rows.

### Migration of the existing zoom-aware aggregation (#627)

Issue #628's body asks: "does this replace [#627] entirely or coexist?"

**Coexistence.** #627's per-request aggregation is the right answer for species-overlay queries (which can't be pre-tiled — see above). The primary low-zoom rendering path moves to tiles, but #627's aggregation logic stays alive for the JSON path that serves overlays. Concretely:

- `/api/observations` (no species filter) — **deprecated for map rendering** after the 14-day parallel-run window; remains available for ad-hoc tooling and analytics.
- `/api/observations?species_code=xxxx` — **stays primary** for species overlays; uses #627's aggregation at low zoom.
- Tile path — **primary** for the unfiltered observation layer at all zooms.

---

## §6 — Freshness story

Tile rebuild cadence: hourly at `:15`. The ingest job runs at `:00`. Worst-case lag between a new observation hitting Postgres and rendering on the map:

| Source of lag | Duration |
|---|---|
| eBird → ingestor (already production lag) | 0–60 min |
| Postgres → tile build (this plan) | 0–60 min |
| Tile build → Cloudflare edge (cache TTL warmup) | <5 min |
| **Total worst case** | **~2 hours** |
| **Median** | **~30 min** |

Compare with current: `/api/observations` has `s-maxage=300` (5 min) on the Cloudflare edge. So tiles are ~25 minutes worse on the median and ~115 minutes worse on the worst case.

### Is this acceptable for "observations in the last 14 days"?

Yes. The product window is 14 days; the median tile lag is ~0.1% of the window. The worst-case 2-hour lag is 0.6% of the window. Users browsing recent observations care about "yesterday's rare sighting at Patagonia Lake" — a 30-minute delay relative to the live feed does not change which markers they see at any zoom level the map is useful at.

The user-visible failure mode this introduces: a brand-new observation made *right now* will not appear on the map until the next hourly tile build completes. Spec-update: `docs/specs/2026-04-16-bird-watch-design.md` §5.6 / R4 gains a note documenting the 1-hour freshness floor.

For users who need realtime, the species-overlay path stays warm (5-min TTL); selecting a species filter falls back to the JSON path which retains the lower lag.

---

## §7 — Cost estimate

### AZ steady-state (current scope)

| Line item | Math | Monthly |
|---|---|---|
| Cloud Run Job (build) | 730 builds/mo × 60s avg × 2 vCPU × $0.000024/vCPU-s + memory | $1.50 |
| Cloud Scheduler | 730 invocations/mo | $0.10 |
| R2 storage | ~50 MB tileset × $0.015/GB-mo | $0.001 |
| R2 PUT (build) | ~8k tiles × 730 builds = 5.8M PUT/mo × $4.50/M | $26.10 ← **dominant cost** |
| R2 egress | unlimited free | $0.00 |
| Worker requests | ~10k req/day × 30 × $0.50/M | $0.15 |
| **AZ total** | | **~$28/mo** |

### National steady-state (future scope)

| Line item | Math | Monthly |
|---|---|---|
| Cloud Run Job | 730 builds/mo × 8 min × 4 vCPU + memory | $25.00 |
| R2 storage | ~5 GB tileset × $0.015 | $0.08 |
| R2 PUT (build) | ~750k tiles × 730 = 547M PUT/mo × $4.50/M | $2,461 ← **prohibitive** |
| R2 egress | unlimited free | $0.00 |
| Worker requests | ~100k req/day × 30 × $0.50/M | $1.50 |
| **National total** | | **~$2,488/mo** |

### The R2 PUT cost is load-bearing

AZ at $28/mo is fine. National at $2,488/mo is the dominant cost in the entire system and would not be acceptable. **Mitigation:** before any national-scope rollout, the build job must adopt incremental writes — only PUT tiles whose content hash differs from the previous build. With a typical hourly delta of <5% changed tiles, this drops the PUT count by ~95% (~$120/mo at national scale), bringing total cost to ~$150/mo. Tippecanoe doesn't expose per-tile hashes natively; the build job computes a `crypto.createHash('sha256')` over each `.pbf` before PUT and compares against `metadata.json`'s previous-build hash table.

For the AZ-only ship targeted by this plan, incremental PUTs are a nice-to-have (drops $28 → ~$3); for any national rollout they are non-negotiable.

### Egress savings vs current

`/api/observations` egress at AZ scale is ~5 GB/mo over Cloudflare Workers (calculated from the recent-traffic report — ~30k requests/day × ~150 KB/req × 30). The tile path replaces ~95% of that with R2-fronted PBFs whose egress is free. Net savings on Worker egress (Workers paid plan, included quotas already met): ~$0.50/mo. Cost savings are not the motivation — the motivation is O(1) request-time work (§umbrella plan §5.6 / R4) and unbounded scale headroom.

---

## §8 — Risk register

| # | Risk | Likelihood | Severity | Mitigation |
|---|---|---|---|---|
| R1 | Tile rebuild lag during a high-ingest period (e.g. weekend after a vagrant report) — users see stale data for >1 build cycle | Medium | Low | The hourly cadence is well below the 14-day product window. Lock detection (§3) prevents overlapping builds; if a build runs long, the next tick skips. A future optimization: trigger an out-of-band rebuild from the ingest job if it processed >N new observations. |
| R2 | MapLibre vector-source compatibility with the existing supercluster + adaptive-grid pill renderer | Medium | **High** | Task 0 (§10) ships a Vite prototype against real AZ tiles before any production code lands. The prototype reproduces the adaptive-grid pill at z=8 and z=10 against `queryRenderedFeatures` output; if pill positions drift >2px from current, the plan blocks and the renderer integration is re-scoped before any infra ships. |
| R3 | Schema evolution: adding a column to `observations` requires a tile rebuild before the client can render it | Low | Medium | The build job runs hourly; a schema change rolls out via the same migration → backfill → next-tile-build sequence as today's frontend changes. Document in CLAUDE.md (the existing "Use context7" table gains a row for `tippecanoe` build-command flags). |
| R4 | Tippecanoe binary CVE or apt repo unavailability blocks builds | Low | Medium | Fallback documented at top of `services/tile-builder/Dockerfile`: build from source in stage 1 (`git clone github.com/felt/tippecanoe && make`). Adds ~30s to image build; runtime unaffected. |
| R5 | Atomic-swap race: the `metadata.json` write races with the `current/*` copy loop, leaving the Worker reading inconsistent tiles | Medium | Medium | Worker serves directly from `current/*` (not via the manifest). The copy loop is the atomic boundary; failures leave the previous `current/*` intact. Worst case during a partial copy: a small window where some tiles are new and others are old — visually a no-op for the user (both versions render correctly, just at different freshness within a 30s window). |
| R6 | R2 PUT cost at national scale ($2,488/mo, §7) | High | **High** (for national rollout only) | Incremental PUTs based on per-tile hash diff. AZ ship blocks no incremental work; national rollout blocks on incremental-PUT implementation. Issue filed at rollout time, not now. |
| R7 | Coexistence with #627's per-request aggregation creates two rendering paths the user can flip between (filtered → JSON+aggregation, unfiltered → tiles) — risk of visual inconsistency at the boundary | Medium | Low | Validation: e2e spec that flips species filter on/off at z=6 and z=10 asserts that pill positions match within ±5px across the transition. If they diverge, the JSON-path aggregation logic is tuned to match tippecanoe's clustering output (or vice versa). |

---

## §9 — Phase placement

**Confirmed: Phase 4 v1.1.** Per the issue body; aligns with the umbrella plan's "post-flip v1.1 perf improvement" framing. Not a launch blocker. Sequencing:

- Issue #626 (bbox filtering) — **merged**.
- Issue #627 (zoom-aware aggregation) — **in flight**; carries the launch window.
- This plan (#628) — lands after #627 is stable in production (~2–4 weeks post-launch).

No re-phasing recommended.

---

## §10 — Task breakdown

Sized for `superpowers:subagent-driven-development`. Each task is a PR-sized chunk; each lands a fully-green CI gate. The order respects the "plan task boundaries must respect CI gates" memory.

### Task 0: Prototype gate — MapLibre vector-source × adaptive-grid

- [ ] Build a minimal Vite app at `docs/plans/2026-05-18-pmtiles-prototype/` (gitignored except for the `learnings.md` note).
- [ ] Manually run `tippecanoe` against a canned dump of ~5k AZ observations (`scripts/dump-observations-prototype.sh` — one-off, doesn't ship).
- [ ] Upload the resulting tiles to a personal R2 bucket; wire MapLibre to consume them.
- [ ] Render the existing adaptive-grid pill over `queryRenderedFeatures` output at z=8 and z=10 in both 390×844 and 1440×900 viewports.
- [ ] Compare pill positions against the current production `/api/observations`-driven map. Acceptance: ±2px drift.
- [ ] Commit `docs/plans/2026-05-18-pmtiles-prototype/learnings.md` documenting what worked, what surprised, and any deconflict-module changes needed.
- [ ] **Gate:** no implementation tasks begin until this note is committed. (Per CLAUDE.md's Prototype Gate.)

**Commit:** `docs(plans): pmtiles prototype learnings note (#628)`

### Task 1: Migration — `tile_builds` run-tracking table

- [ ] Create `migrations/<n>_create_tile_builds_table.sql` with the SQL in §3.
- [ ] Add `packages/db-client/src/tile-builds.ts` with `startTileBuildRun`, `finishTileBuildRun` (mirrors `ingest_runs` helpers in `packages/db-client/src/ingest-runs.ts`).
- [ ] Add unit tests at `packages/db-client/src/tile-builds.test.ts` against testcontainers Postgres.
- [ ] Run: `npm test --workspace @bird-watch/db-client`. Expect green.

**Commit:** `feat(db): tile_builds table + run-tracking helpers (#628)`

### Task 2: Tile-builder service scaffold + cli

- [ ] Create `services/tile-builder/` workspace (`package.json`, `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts`) mirroring `services/ingestor/`.
- [ ] Create `services/tile-builder/src/cli.ts` exposing `--region=US-AZ|all` plus `--dry-run`.
- [ ] Create `services/tile-builder/src/run-build.ts` — stubs the build loop; doesn't shell out to tippecanoe yet.
- [ ] Add `services/tile-builder/src/run-build.test.ts` against testcontainers Postgres + mocked R2 client.
- [ ] Run: `npm run build --workspaces`; `npm test --workspace @bird-watch/tile-builder`. Expect green.

**Commit:** `feat(tile-builder): scaffold service + cli (#628)`

### Task 3: GeoJSON dump + tippecanoe invocation

- [ ] In `services/tile-builder/src/dump-observations.ts`, implement a streaming `pg.COPY` of `observations` to a local NDJSON file, then convert to GeoJSON Feature lines.
- [ ] In `services/tile-builder/src/run-build.ts`, shell out to `tippecanoe` with the args in §4 (`--cluster-distance=10 --accumulate-attribute=species_codes:comma --include=species_code --include=notable --include=family_code -o /tmp/observations.mbtiles -z 12 -Z 0`).
- [ ] Unpack the resulting `.mbtiles` via `better-sqlite3` (read `SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles`) into in-memory PBF buffers.
- [ ] Unit-test the dump → tippecanoe → unpack sequence against a 100-row fixture.
- [ ] Run: `npm test --workspace @bird-watch/tile-builder`. Expect green.

**Commit:** `feat(tile-builder): geojson dump + tippecanoe build step (#628)`

### Task 4: R2 upload + atomic swap

- [ ] Add `services/tile-builder/src/r2/uploader.ts` mirroring `services/ingestor/src/r2/uploader.ts`. Methods: `putTile({z,x,y}, body)`, `copyPrefix(src, dst)`, `deletePrefixOlderThan(prefix, age)`, `writeMetadata(manifest)`.
- [ ] In `run-build.ts`, write all tiles to `build-<ISO8601>/{z}/{x}/{y}.pbf`, then copy → `current/`, then write `metadata.json`.
- [ ] Unit-test the swap sequence; assert order via `aws-sdk-client-mock`.
- [ ] Run: `npm test --workspace @bird-watch/tile-builder`. Expect green.

**Commit:** `feat(tile-builder): r2 atomic-swap upload (#628)`

### Task 5: Dockerfile + .dockerignore

- [ ] Create `services/tile-builder/Dockerfile` (two-stage; §3).
- [ ] Create `services/tile-builder/.dockerignore`.
- [ ] Add `.github/workflows/deploy-tile-builder.yml` cloning `deploy-ingestor.yml`.
- [ ] Run: `docker build -t bird-tile-builder services/tile-builder/`. Expect successful image.

**Commit:** `infra(tile-builder): dockerfile + deploy workflow (#628)`

### Task 6: Terraform — R2 bucket + Worker + DNS

- [ ] Create `infra/terraform/tiles.tf` cloning `infra/terraform/silhouettes.tf`. Resources: `cloudflare_r2_bucket.tiles` (`bird-maps-observation-tiles`, WNAM, `prevent_destroy = false`), `cloudflare_workers_script.tile_server`, `cloudflare_workers_route.tiles` (`tiles.${var.domain}/*`), `cloudflare_record.tiles` (CNAME).
- [ ] Create `infra/workers/tile-server.js` cloning `infra/workers/silhouette-server.js`. Adjust: `contentTypeFor('.pbf')` → `application/x-protobuf`; preserve `Content-Encoding: gzip` from R2 metadata; CORS headers per §2.
- [ ] Create `infra/workers/tile-server.test.js` cloning `infra/workers/silhouette-server.test.js`.
- [ ] Run: `cd infra/terraform && terraform fmt && terraform validate`. Expect green.

**Commit:** `infra(terraform): r2 bucket + worker for tile serving (#628)`

### Task 7: Terraform — Cloud Run Job + Cloud Scheduler

- [ ] Add `google_cloud_run_v2_job.tile_builder` to `infra/terraform/ingestor.tf` (or new `tile-builder.tf` if it grows past ~50 LOC). 4 vCPU / 8 GiB / 1800s timeout (sized for national worst-case; AZ uses a fraction).
- [ ] Add `google_cloud_scheduler_job.tile_builder` at `15 * * * *` UTC.
- [ ] Add `google_service_account.tile_builder` + Secret Manager IAM bindings for `db_url`, `r2_endpoint`, `r2_access_key_id`, `r2_secret_access_key`.
- [ ] Run: `terraform plan`. Expect a clean plan.

**Commit:** `infra(tile-builder): cloud run job + scheduler (#628)`

### Task 8: Frontend — vector source + parallel-run fallback

- [ ] In `frontend/src/components/map/MapCanvas.tsx`, add the `addSource('observations', { type: 'vector', tiles: [...] })` per §4.
- [ ] Wire a feature flag `VITE_USE_VECTOR_TILES` (default `true` in production, configurable per-env) that toggles between the new vector source and the existing geojson source.
- [ ] On vector-source `error` event, log to Sentry and fall back to the geojson source for the rest of the session.
- [ ] Adjust the supercluster + adaptive-grid integration per Task 0's learnings.
- [ ] Update unit tests at `frontend/src/components/map/MapCanvas.test.tsx`.
- [ ] **UI verification protocol applies** (CLAUDE.md `Testing > UI verification`): 5 viewports × 2 themes screenshots via Playwright MCP; design-review subagent dispatch.
- [ ] Run: `npm test --workspace @bird-watch/frontend && npm run build --workspace @bird-watch/frontend && npm run e2e`. Expect green.

**Commit:** `feat(frontend): vector tile source w/ parallel-run fallback (#628)`

### Task 9: Post-merge 14-day soak; remove fallback

- [ ] Wait 14 days from Task 8 merge.
- [ ] Query Sentry for `observations-vector-source-fallback` events. Acceptance: zero events over 14 days.
- [ ] If zero: open follow-up PR removing the `VITE_USE_VECTOR_TILES` flag and the geojson-fallback branch in `MapCanvas.tsx`.
- [ ] If non-zero: triage; do not remove the fallback until root-caused.

**Commit (follow-up PR):** `chore(frontend): remove tile-source geojson fallback after 14-day soak (#628)`

### Task 10: Spec update + drift-detection bookkeeping

- [ ] Update `docs/specs/2026-04-16-bird-watch-design.md` §5.6 / R4 documenting the tile path as the primary low-zoom rendering path and the 1-hour freshness floor.
- [ ] Add `tippecanoe` to CLAUDE.md's "Use context7" table with a note about build-command flag drift.
- [ ] Mark this plan complete in the plan index (if one exists) or note completion in the umbrella tracking issue (#628).

**Commit:** `docs(spec): pmtiles serving path documented; close #628`

---

## Acceptance criteria

- [ ] `bird-tile-builder` Cloud Run Job runs hourly at `:15` UTC; `tile_builds` table receives one success row per hour.
- [ ] `tiles.bird-maps.com/current/{z}/{x}/{y}.pbf` returns valid MVT bytes for every tile in the AZ extent at z=0..12.
- [ ] Frontend map renders identically (±2px pill drift acceptance from Task 0) against the vector source vs the previous geojson source at all 5 canonical viewports × 2 themes.
- [ ] Console clean (zero errors, zero warnings) at all 5 viewports per the UI verification protocol.
- [ ] Sentry `observations-vector-source-fallback` event count is zero over a 14-day post-merge window.
- [ ] R2 storage for AZ tileset is < 100 MB; monthly cost line ≤ $30 (per §7).
- [ ] All 4 Mergify-required CI checks (test, lint, build, e2e) green at HEAD of each task's PR.

---

## Open decisions (require Julian sign-off before execution)

### D1. Per-tile content hashing for incremental PUTs — ship in v1.1 (AZ) or defer to national rollout?

**Recommendation: defer.** AZ-scale PUT cost is $26/mo; the engineering cost of incremental hashing is ~1 task and likely fragile (tippecanoe's deterministic output is a build-flag commitment that has drifted before). The simpler v1.1 ship validates the architecture; national rollout's $2,488/mo PUT cost forces the optimization at the right moment. If Julian prefers shipping incremental hashing now, add a Task 4b after Task 4.

### D2. National-scope rollout — same plan, or a fresh plan?

**Recommendation: fresh plan.** National introduces a partitioned bucket layout (§2), per-region build cadence, incremental PUTs (D1), Cloudflare Argo or smart routing tuning, and possibly a per-region Cloud Run Job (one per state) for parallelism. The architecture differs enough that a clean plan is cheaper than annotating this one.

### D3. Drop `/api/observations` JSON entirely after the 14-day soak, or keep for species-overlays?

**Recommendation: keep for species-overlays.** Per §5. The endpoint stays alive; only the unfiltered-map-rendering use case migrates. If Julian wants a hard deprecation across the board (all overlays move to per-species tilesets), that is a separate ~3-week project (one tile per species × 800 species = a different cost profile) and should be a v1.2 plan.
