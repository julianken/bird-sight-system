# `@bird-watch/db-client`

The typed [`pg`](https://node-postgres.com/) query layer shared by all three
Node services — `services/read-api`, `services/ingestor`, and
`services/admin-api`. It owns pool lifecycle and every Postgres + PostGIS query
the services issue; row shapes are the wire/domain types from
[`@bird-watch/shared-types`](../shared-types). It is a workspace-internal
package (not published to npm) — consumed via the root `workspaces` glob
`packages/*`.

Runtime dependencies: `pg` and `@bird-watch/shared-types`. Integration tests run
against a real Postgres + PostGIS via `@testcontainers/postgresql` (no DB mocks
— see the repo `CLAUDE.md` "Conventions" section).

## Exports

Re-exported from `src/index.ts`.

### Pool lifecycle (`pool.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `createPool(opts: PoolOptions)` | fn | Returns a `pg.Pool`. Memoized by `opts.key` when set. Defaults: `max: 5`, `idleTimeoutMillis: 30_000`. |
| `closePool(pool)` | fn | Ends the pool and clears any memoization entry. |
| `Pool` | type | Alias for `pg.Pool`. |
| `PoolOptions` | type | `{ databaseUrl, key?, max?, idleTimeoutMillis? }`. |

### Hotspots (`hotspots.ts`)

| Export | Kind |
| --- | --- |
| `getHotspots` | query |
| `upsertHotspots` | write |
| `HotspotInput` | type |

### Observations (`observations.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `getObservations` | query | Per-observation read; row-capped with a cap+1 truncation probe. |
| `getObservationsAggregated` | query | Coarse-grid bucket aggregation for low-zoom reads. |
| `upsertObservations` | write | Stamps `silhouette_id` per batch on upsert. |
| `runReconcileStamping` | write | Sweeps NULL `silhouette_id` residue. |
| `getFreshestObservationAt` | query | Freshness timestamp. |
| `ObservationInput` | type | |

Both read paths support a `?state=US-XX` clip (PostGIS `ST_Intersects`) and a
bbox filter (`geom && ST_MakeEnvelope`).

### Species: meta, photos, phenology, descriptions (`species.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `getSpeciesMeta` | query | |
| `upsertSpeciesMeta` | write | Taxonomy ingest target. |
| `findMissingSpeciesMeta` | query | Returns species codes with no `species_meta` row (FK invariant guard). |
| `insertSpeciesPhoto` | write | |
| `getSpeciesPhotos` | query | |
| `getSpeciesPhenology` | query | On-read monthly aggregation of observations (UTC). |
| `insertSpeciesDescription` | write | |
| `SpeciesPhoto`, `SpeciesPhotoInput`, `SpeciesDescriptionInput` | type | |

### Silhouettes (`silhouettes.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `getSilhouettes` | query | Reads `family_silhouettes` (family → color + SDF/SVG). |

### State boundaries (`state-boundaries.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `resolveStateForPoint` | query | Point-in-polygon `US-XX` lookup (`ST_Intersects`). |
| `listStatesWithBbox` | query | State list + bbox for camera framing; deliberately omits the polygon `geom`. |

### Ingest-run ledger (`ingest-runs.ts`)

| Export | Kind | Notes |
| --- | --- | --- |
| `startIngestRun` | write | Opens a row in `ingest_runs`. |
| `finishIngestRun` | write | Closes it with status + counts. |
| `getRecentIngestRuns` | query | |
| `IngestKind`, `IngestStatus`, `FinishOptions` | type | |

## Build / test

```sh
npm run build --workspace @bird-watch/db-client
npm run test  --workspace @bird-watch/db-client   # vitest, testcontainers Postgres
```
