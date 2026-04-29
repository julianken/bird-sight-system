# Investigation: Area 4 — Data / API surface

## Summary

The Read API is a 5-route Hono app (`services/read-api/src/app.ts:11-105`) with four GETs against Postgres+PostGIS. Shared-types (`packages/shared-types/src/index.ts:1-72`) exposes 32 fields across `Region`, `Hotspot`, `Observation`, `SpeciesMeta`. The current frontend reads ~18 of them; 12+ populated fields are dropped — notably the entire time axis on observations (`obsDt`), per-observation coordinates, checklist grouping (`subId`), hotspot freshness (`latestObsDt`), effort (`howMany`), and the row-level `isNotable`. The API already supports a temporal feed, a spatial plot, a hotspot-centric list, a species-detail hub, and a search-driven list without backend changes — the map UI just doesn't read those fields. Notable gaps for a richer frontend: historical trends/aggregates, photos/media, eBird deep-link-enabling data, and checklist-level metadata — none of which are in the MVP spec (`docs/specs/2026-04-16-bird-watch-design.md:320-328`).

## Key Findings

### Finding 1: Endpoint + field inventory

- **Evidence:** `services/read-api/src/app.ts:41-83`, `packages/shared-types/src/index.ts:1-72`, `services/read-api/src/cache-headers.ts:3-8`, spec `:201-224`.
- **Confidence:** high — shared-types is the single source of truth and the DB client maps shape-for-shape (`packages/db-client/src/observations.ts:165-178`, `hotspots.ts:26-34`, `regions.ts:16-22`, `species.ts:22-29`).

| Endpoint | Query params | Response | Cache-Control |
|---|---|---|---|
| `/api/regions` | — | `Region[]` (9 rows; seeded, immutable) | `public, max-age=604800, immutable` |
| `/api/hotspots` | — | `Hotspot[]` | `public, max-age=86400, stale-while-revalidate=3600` |
| `/api/observations` | `since`, `notable`, `species`, `family` (all optional) | `Observation[]` (unpaginated, `ORDER BY obs_dt DESC`) | `public, max-age=1800, stale-while-revalidate=600` |
| `/api/species/:code` | path `:code` | `SpeciesMeta` or `404 {error:'not found'}` | `public, max-age=604800` |
| `/health` | — | `{ok:true}` | — |

Response shapes (from `packages/shared-types/src/index.ts:1-50`):
- **`Region`**: `id`, `name`, `parentId|null`, `displayColor` (hex), `svgPath` (M/L/Z only — see `frontend/src/components/Region.tsx:21-45`).
- **`Hotspot`**: `locId`, `locName`, `lat`, `lng`, `regionId|null`, `numSpeciesAlltime|null`, `latestObsDt|null` (ISO).
- **`Observation`**: `subId`, `speciesCode`, `comName`, `lat`, `lng`, `obsDt` (ISO), `locId`, `locName|null`, `howMany|null`, `isNotable`, `regionId|null`, `silhouetteId|null`.
- **`SpeciesMeta`**: `speciesCode`, `comName`, `sciName`, `familyCode`, `familyName`, `taxonOrder|null`.

### Finding 2: The consumer drops ~12 populated fields

- **Evidence:** `frontend/src/App.tsx:47-52`, `Map.tsx:42-203`, `BadgeStack.tsx:12-28`, `SpeciesPanel.tsx:75-80`, `data/use-bird-data.ts:26-47`, `derived.ts:16-34`, plus targeted greps (see Raw Evidence).
- **Confidence:** high — every field is either referenced or conspicuously absent.
- **Implication:** The data backbone is richer than the UI implies. A temporal feed, a hotspot-sorted list, or a species hub with "recent sightings" is buildable with zero contract changes.

| DTO | Field | Used? | Where / how |
|---|---|---|---|
| Region | `id` | USED | `Map.tsx:146` (key + data attr) |
| Region | `name` | USED | `Region.tsx:124` (aria-label) |
| Region | `parentId` | USED | `Map.tsx:60-87` (paint-order tier) |
| Region | `displayColor` | USED | `Region.tsx:115` (polygon fill) |
| Region | `svgPath` | USED | `Region.tsx:114`, `BadgeStack.tsx:106-107`, `Region.tsx:155` |
| Hotspot | `locId` | USED | `Map.tsx:194` (React key) |
| Hotspot | `locName` | USED | `HotspotDot.tsx:33` (`<title>`) |
| Hotspot | `lat`, `lng` | USED | `Map.tsx:191` (SVG projection) |
| Hotspot | `regionId` | DROPPED | never dereferenced |
| Hotspot | `numSpeciesAlltime` | USED | `HotspotDot.tsx:24` (log-scale radius) |
| Hotspot | `latestObsDt` | DROPPED | no freshness indicator |
| Observation | `subId` | DROPPED | checklist grouping unavailable |
| Observation | `speciesCode` | USED | `BadgeStack.tsx:14-25`, `derived.ts:28` |
| Observation | `comName` | USED | `BadgeStack.tsx:22`, `Badge.tsx:86` |
| Observation | `lat`, `lng` | DROPPED | **never read** — obs is region-aggregated by `regionId` (`Map.tsx:43`); on-map position is pole-of-inaccessibility of the polygon |
| Observation | `obsDt` | DROPPED | **never read** — time axis entirely unused |
| Observation | `locId`, `locName`, `howMany` | DROPPED | no "where/how many seen" UI |
| Observation | `isNotable` | DROPPED at row | only as filter-gate via `?notable=true` in `FiltersBar.tsx:56-62` |
| Observation | `regionId` | USED | `Map.tsx:43` (groupBy → badge stack) |
| Observation | `silhouetteId` | USED as family-proxy | `App.tsx:41-43` → `colorForFamily` (see Finding 7) |
| SpeciesMeta | `comName` | USED | `SpeciesPanel.tsx:77` |
| SpeciesMeta | `sciName` | USED | `SpeciesPanel.tsx:78` |
| SpeciesMeta | `familyCode` | DROPPED | not surfaced in panel |
| SpeciesMeta | `familyName` | USED | `SpeciesPanel.tsx:79` |
| SpeciesMeta | `taxonOrder` | DROPPED | no taxonomic ordering |

**Dropped totals:** `latestObsDt`, `subId`, `lat`(obs), `lng`(obs), `obsDt`, `locId`(obs), `locName`(obs), `howMany`, row-level `isNotable`, hotspot `regionId`, `familyCode`(species), `taxonOrder`. Twelve fields computed and shipped that the UI ignores.

### Finding 3: Filter semantics — AND-combined, with a silent "both species and family" edge case

- **Evidence:** `services/read-api/src/app.ts:55-75`, `packages/db-client/src/observations.ts:111-148`, `frontend/src/state/url-state.ts:21-33`, spec `:233-245`.
- **Confidence:** high — SQL construction is linearly inspectable.

Precise semantics:
- **`?since=`** — accepts only `1d | 7d | 14d | 30d` literals (`app.ts:57-61`; 400 otherwise). `obs_dt ≥ now() - N days` (`observations.ts:119-122`). Default when unset: **no time filter at all** — the frontend always sets it to at least `14d` (`url-state.ts:13-19`, `FiltersBar.tsx:44-54`).
- **`?notable=`** — only literal `true` enables it (`app.ts:68`). Anything else (including `false`, `1`) is silently treated as false. Effect: `AND is_notable = true`.
- **`?species=`** and **`?family=`** — accepted independently, no mutual-exclusion. If both set, the SQL ANDs them: `o.species_code = $X AND o.species_code IN (SELECT … family_code = $Y)` (`observations.ts:126-135`). Species filter honored only when consistent with family — else silently `[]`. Not currently triggerable from `FiltersBar.tsx`, so latent.
- **Unknown query params** pass through as no-ops (permissive, undocumented).

### Finding 4: Cadence — 30-minute freshness ceiling, no pagination

- **Evidence:** `infra/terraform/ingestor.tf:108-187`, `services/ingestor/src/run-ingest.ts:36-42`, `services/ingestor/src/ebird/client.ts:31-66`, `services/read-api/src/cache-headers.ts:3-8`, spec `:82-93`.
- **Confidence:** high.

| Job | Cron (UTC) | What it refreshes | Visible freshness |
|---|---|---|---|
| `ingest_recent` | `*/30 * * * *` | `fetchRecent` + `fetchNotable` for US-AZ, back=14d | ≤ 30 min ingest + `max-age=1800` CDN → up to 60 min stale worst case |
| `ingest_backfill` | `0 4 * * *` | deeper re-fetch | daily |
| `ingest_hotspots` | `0 5 * * 0` | hotspots | weekly (CDN `max-age=86400`) |
| `ingest_taxonomy` | `0 6 1 * *` | species_meta + silhouette reconciliation | monthly |

Volume for `/api/observations?since=14d` (AZ):
- eBird `fetchRecent` capped at `maxResults=10000` (`ebird/client.ts:37`); spec flags the cap may be lower in practice (`:340`).
- **Unpaginated** — `getObservations` streams every matching row with no `LIMIT` (only `LIMIT 1`s are in stamping sub-selects `observations.ts:60,67,97,104`). Full array ships to the browser; no cursor, no offset, no row cap.
- No gzip at the Hono layer; reliance on CDN/Cloud Run.

### Finding 5: UI shapes the current API naturally supports

- **Evidence:** Finding 2 × Finding 1 × Finding 3.
- **Confidence:** high for "feasible without backend change"; medium for performance (row volume is inferred, not measured).

| UI shape | Feasible? | What's available | Missing / perf note |
|---|---|---|---|
| **Temporal feed / timeline** | Yes | `obsDt`, server-side `ORDER BY obs_dt DESC` (`observations.ts:147`) | Nothing — sort is correct. At several-thousand-row volumes, client needs virtualization; no cursor pagination |
| **Spatial plot (lat/lng as pixels)** | Yes | `Observation.lat/lng` (on the wire, currently dropped); `Hotspot.lat/lng`; projection math already exists (`Map.tsx:26-30`) | AZ bbox baked in (`Map.tsx:22-24`); a free-pan map needs a dynamic bbox. Dense-week clustering would be client-side |
| **Hotspot-centric list** | Partial | Hotspot list with `numSpeciesAlltime`; obs have `locId` | `locId` → hotspot join is client-side (no `/api/hotspots/:locId/observations`); tolerable today |
| **Taxonomic browser (family → species → obs)** | Partial | `SpeciesMeta.familyCode/familyName/taxonOrder`, `?family=` filter | No `/api/families` endpoint. Frontend derives families from *currently loaded* observations only (`derived.ts:16-24`) — flip `?since=` and the tree shrinks |
| **Species detail hub** | Partial | `/api/species/:code` + `/api/observations?species=:code` for "recent sightings" | Two calls; dropped obs fields (`obsDt`, `locName`, `lat`, `lng`, `howMany`) are there — panel just has to start reading |
| **Search-driven filtered list** | Yes | Autocomplete (`FiltersBar.tsx:78-97`), `?species`, `?family`, `?since`, `?notable` | Autocomplete scoped to visible observations (`derived.ts:26-34`) — can only search for species currently in-view |
| **Aggregate dashboard (counts/trends)** | No | `howMany` per row but never aggregated; `isNotable` countable client-side | Week-over-week, first-of-season, etc. need a new endpoint or heavy client-side reduction |
| **Per-region narrative** | Partial | `regionId`-derived filter is trivial client-side | **No `?region=:id` filter on the server** (`app.ts:55-75`); client must filter the full array locally |

### Finding 6: Data gaps if the redesign wants more

- **Evidence:** `packages/shared-types/src/index.ts:1-72` + spec `:320-328`.
- **Confidence:** high for "not in the contract"; medium for "upstream data would provide it."

| Wanted | Exposed? | Would require |
|---|---|---|
| Historical counts / trends (species-per-week) | No | New endpoint or server-side aggregation; DB has raw rows |
| Photos / media URLs | No | eBird exposes media IDs; ingest doesn't capture them (`ebird/types.ts`) |
| Checklist metadata (observer, duration, distance, protocol) | `subId` on wire but opaque | eBird `/product/checklist/view/:subId` not wired |
| eBird direct deep-link (`ebird.org/checklist/:subId`, `/species/:code`) | Not as fields, but `subId`/`speciesCode` let client construct them | Client-side only — no backend work |
| Taxonomy beyond family (order, genus, alt names) | No | Re-ingest eBird taxonomy with richer schema |
| Region descriptions / ecoregion copy | No | Regions carry only `name`/`displayColor`/`svgPath` |
| Per-species counts (how many people saw it) | Derivable client-side by speciesCode group | Trivial reduction; dashboards want server aggregate |

### Finding 7: Known coupling debt — `silhouetteId` as `familyCode` proxy

- **Evidence:** `frontend/src/App.tsx:32-43` (`COUPLING NOTE`), `frontend/src/derived.ts:4-24`, `packages/db-client/src/observations.ts:62-68` (the stamping join), issue #57.
- **Confidence:** high — note is verbatim in two files.
- **Implication:** Color-by-family encoding and the family dropdown both read `observation.silhouetteId` and treat it as a family code. Works **only while** `family_silhouettes.id == family_code` (seed invariant per `migrations/1700000009000_seed_family_silhouettes.sql`). If Phylopic assets are re-keyed, grouping silently buckets by silhouette instead of taxonomy and no existing test catches it. Any redesign preserving color-by-family inherits this; any redesign dropping family-colored badges sheds the dependency.

Independent coupling (not flagged by a COUPLING NOTE): the only source of truth for "which families exist in AZ" is whatever came back in the *current* `/api/observations` response (`derived.ts:16-24`). Switch `?since=` from 14d to 1d and the family dropdown shrinks. A stable taxonomic browser needs a fresh "all families" endpoint — not in the current contract.

## Surprises

- **The time axis is a ghost.** `obsDt` is the server's `ORDER BY` key (`observations.ts:147`) but the client never reads it. The UI renders sightings as if they were timeless.
- **Per-observation lat/lng is plumbed but unused.** Hotspot coords drive `HotspotDot` placement; observation coords drive nothing. The map that visually suggests "sightings here" is actually "sightings somewhere in this polygon, shown at the polygon's pole-of-inaccessibility."
- **No pagination anywhere.** `/api/observations` returns the full filtered rowset in one shot. Surprising given the explicit attention to CDN TTLs and `stale-while-revalidate` elsewhere.
- **`?region=:id` is frontend-only.** The URL param exists (`url-state.ts:37`) but the server rejects it (accepts only `since/notable/species/family`). Per-region filtering is entirely client-side.
- **`subId` checklist grouping is never surfaced.** eBird batches multiple species under one checklist `subId`; the backend carries it (unique-keyed in upsert), the frontend ignores it. "A checklist view" is latent.
- **Hotspot `latestObsDt` exists and is ignored.** A "which hotspots are hot right now" signal is sitting on the wire.

## Unknowns & Gaps

- **Actual row volume for `?since=14d`.** Not measured; eBird's `maxResults=10000` is a ceiling but the live AZ number is inferred, not observed.
- **Production response timing / CDN hit rate.** No RUM or server log inspection from this lens.
- **Compression.** Hono doesn't gzip by default; whether the fronting proxy does is unverified.
- **eBird media endpoints.** Contract lacks photos; whether `ebird-client` even has media-route bindings was not checked.
- **E2E coverage of "both species and family set."** Not audited — Area 5 is better placed for that.

## Raw Evidence

Files read:
- `packages/shared-types/src/index.ts`
- `services/read-api/src/{app,cache-headers}.ts`
- `packages/db-client/src/{observations,hotspots,regions,species}.ts`
- `services/ingestor/src/{run-ingest,ebird/client}.ts`
- `infra/terraform/ingestor.tf:108-187`
- `frontend/src/{App.tsx, api/client.ts, data/use-bird-data.ts, data/use-species-detail.ts, derived.ts, state/url-state.ts}`
- `frontend/src/components/{Map,Region,BadgeStack,Badge,HotspotDot,SpeciesPanel,FiltersBar}.tsx`
- `docs/specs/2026-04-16-bird-watch-design.md:82-93,201-245,320-328,340`

Greps (summarized):
- `isNotable|is_notable` in `frontend/src/` — only a test fixture (`BadgeStack.test.tsx:10`); no UI code dereferences it.
- `obsDt|obs_dt|locName|loc_name|taxonOrder|howMany` in `frontend/src/` — only test fixtures and `SpeciesPanel` (sciName/familyName only, never taxonOrder).
- `latestObsDt|latest_obs_dt` in `frontend/` — no matches.
- `numSpeciesAlltime` in `frontend/src/` — only `HotspotDot` radius and `Map.tsx:197`.
- `parentId` usage — `Map.tsx:60-87` (paint-order tier) + test fixtures.
- `o\.lat|o\.lng|observation\.lat|observation\.lng` in `frontend/src/` — **no matches** (observation coordinates are never read anywhere in the frontend).
