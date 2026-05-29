# State boundaries — provenance

`scripts/generate-state-boundaries.mjs` is a **run-once offline generator**. It
turns the US Census state cartographic-boundary shapefile into the two frozen
artifacts the state-scope epic (#728, plan `2026-05-28-state-scope-selector`)
rides on:

1. `migrations/1700000050000_state_boundaries.sql` — the `INSERT` block (49 WKT
   `MULTIPOLYGON` rows) pasted into the seed migration.
2. `data/us-state-polygons.geojson` — the canonical simplified CONUS shapes the
   ZIP→state ETL (Stream D) reads for point-in-polygon precompute.

Both artifacts are emitted from the **same generator run** and must never
diverge (locked decision #6 in the plan). The clip and the ZIP precompute share
one geometry source.

## Source

| Field | Value |
| --- | --- |
| Dataset | US Census Cartographic Boundary — States, 1:500,000 |
| File | `cb_2023_us_state_500k` |
| URL | https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip |
| Vintage | 2023 (TIGER/GENZ2023) |
| Downloaded | 2026-05-28 |
| License | Public domain (17 U.S.C. §105 — US Government work, no copyright) |
| Source CRS | `+proj=longlat +datum=NAD83` — treated as EPSG:4326. The NAD83↔WGS84 datum shift is sub-meter, far below the 5% simplification tolerance, so no reprojection is applied. |
| Records in source | 56 (50 states + DC + 5 territories) |

The 1:500,000 cartographic file is already cartographically generalized — the
right base resolution for a national zoom map (the full TIGER line files are
far too detailed for a clip polygon).

## CONUS filter

Dropped by `STATEFP`: `02` (Alaska), `15` (Hawaii), and territories `60`
(American Samoa), `66` (Guam), `69` (Northern Mariana Islands), `72` (Puerto
Rico), `78` (US Virgin Islands). This leaves **48 contiguous states + DC
(`STATEFP` 11) = 49 features** — matches the `CONUS_STATE_CODES` allowlist in
`@bird-watch/shared-types`. No AK/HI/territories means no antimeridian math and
no data expansion (those are also outside the map's current `MAX_BOUNDS`).

## Exact command

The generator shells out to mapshaper:

```
npx mapshaper .cache-census/cb_2023_us_state_500k.shp \
  -filter "!['02','15','60','66','69','72','78'].includes(STATEFP)" \
  -simplify 5% keep-shapes visvalingam \
  -clean \
  -o /tmp/<workdir>/conus.geojson precision=0.00001 format=geojson
```

- `-simplify 5% keep-shapes visvalingam` — Visvalingam weighted-area
  simplification at 5% retention. `keep-shapes` prevents tiny polygons
  (notably DC) from collapsing to nothing.
- `-clean` — removes sliver / self-intersection artifacts simplification can
  introduce. The migration test asserts `0` rows fail `ST_IsValid` (no
  `ST_MakeValid` fallback was needed at 5%).
- `precision=0.00001` — rounds coordinates to 5 decimals (~1.1 m), matching the
  ZIP-centroid rounding so the two artifacts stay numerically aligned.

The Node post-process then wraps single `Polygon`s as `MultiPolygon`, computes
each feature's `[min_lng, min_lat, max_lng, max_lat]` envelope, sorts rows by
`state_code`, and emits the SQL + GeoJSON.

## Pinned output figures (audit baseline)

Regenerate and compare against these to detect drift:

| Metric | Value |
| --- | --- |
| mapshaper version | 0.7.21 |
| Simplification | 5% `keep-shapes visvalingam` |
| Coordinate precision | 5 decimals (~1.1 m) |
| Features emitted | 49 (48 states + DC) |
| Total vertices | 10,142 |
| `INSERT` block | 209,150 bytes |
| `data/us-state-polygons.geojson` | 221,882 bytes raw / ~78 KB gzip |

## Regenerating

```sh
# 1. Fetch + unzip the source shapefile (only step that touches the network):
mkdir -p .cache-census && cd .cache-census
curl -sSLO https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip
unzip -o cb_2023_us_state_500k.zip && cd ..

# 2. Install mapshaper transiently (NOT a committed dependency — run-once tooling):
npm install --no-save mapshaper@0.7.21

# 3. Generate. Prints the INSERT block to stdout; writes the GeoJSON.
node scripts/generate-state-boundaries.mjs > /tmp/state_boundaries_insert.sql

# 4. Paste the INSERT block into migrations/1700000050000_state_boundaries.sql
#    (between the CREATE INDEX and the "-- Down Migration" marker), then run:
npm test --workspace @bird-watch/db-client
```

`.cache-census/` is gitignored; only the generator, this README, the migration,
and the GeoJSON are committed.

> **Gotcha:** the migration test harness (`packages/db-client/src/test-helpers.ts`)
> splits each migration file on the first `/-- Down Migration/i` match and runs
> only the Up half. **No comment in the Up section may repeat that marker
> string**, or the splitter truncates the Up section and the `CREATE TABLE`
> never runs. The header comment in `1700000050000_state_boundaries.sql` is
> worded to avoid the literal marker for this reason.

> **Tolerance note:** if a future regeneration at a different tolerance produces
> a geometry that fails `ST_IsValid`, either run it through `ST_MakeValid` in
> the generator's post-process before emitting WKT, or lower the simplification
> tolerance. At 5% on the 2023 source, all 49 geometries are valid as-is.
