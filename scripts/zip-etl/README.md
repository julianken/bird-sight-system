# ZIP ETL — ZCTA Gazetteer → `zip-index.json`

Offline pipeline that turns the public-domain 2020 Census ZCTA Gazetteer into
`frontend/public/zip-index.json`: a lazily-loadable `ZIP → {lat, lng, state}`
index with the state **precomputed** by point-in-polygon (no runtime ZIP→state
lookup ships to the client).

This is Stream D, tasks D1 + D2 of plan
`docs/plans/2026-05-28-state-scope-selector.md` (epic #726, issue #730).

## Files

| File | Role |
| --- | --- |
| `fetch-zcta-gazetteer.sh` | **D1** — network fetch + sha256 verify + unzip into `.cache/` |
| `build-zip-index.ts` | **D2** — offline ETL: parse → PIP → columnar emit |
| `state-polygons.ts` | shared PIP helper (`resolveStateForPoint`), turf-backed |
| `build-zip-index.test.ts` | vitest on a 10-row fixture (no network — CI-safe) |
| `SIZE-REPORT.md` | measured bytes, in/kept/dropped counts, ZIP≠ZCTA caveat |
| `.gitignore` | ignores `.cache/` (vendored source) and `dropped.log` (run output) |

Committed: the four scripts + test + this README + `SIZE-REPORT.md` +
`frontend/public/zip-index.json`. **Not** committed: `.cache/` (the vendored
gazetteer) or `dropped.log` (the per-run drop diagnostic).

## Source

| Field | Value |
| --- | --- |
| Dataset | US Census 2020 ZIP Code Tabulation Area (ZCTA) Gazetteer, national |
| File | `2020_Gaz_zcta_national.zip` → `2020_Gaz_zcta_national.txt` |
| URL | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip |
| sha256 (zip) | `335402fb16b41303a3760f8956d2af005bbd6919b8dc6f4a96048af0005957a6` |
| License | Public domain (17 U.S.C. §105 — US Government work, no copyright) |
| Rows | 33,144 ZCTAs (tab-separated) |

### Column semantics (`.txt`, tab-separated, trailing-whitespace-padded)

`GEOID  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG`

The ETL reads only `GEOID` (the 5-digit ZCTA), `INTPTLAT`, and `INTPTLONG`
(the population-weighted internal point). The area columns are ignored.

## How it works

1. **Fetch** (`fetch-zcta-gazetteer.sh`) — the only step that touches the
   network. Downloads the zip, hard-fails on a sha256 mismatch, unzips into the
   gitignored `.cache/`. Idempotent (re-runs skip the download if the cached
   zip already matches the pin).
2. **PIP precompute** (`build-zip-index.ts`) — for each centroid, runs
   point-in-polygon against `data/us-state-polygons.geojson` (the SAME polygons
   the server clip seeds from — locked decision #6). Resolves `US-XX`, or
   **drops** centroids in no CONUS state (AK/HI/territories/ocean) to
   `dropped.log`.
3. **Columnar emit** — `{ v, states[], zips{ zip:[lat,lng,stateIdx] } }`, coords
   to 5 decimals. See `SIZE-REPORT.md`.

> **Gotcha (why one polygon artifact):** if this ETL used a different polygon
> source than the server clip, a ZIP could resolve to a state whose
> `ST_Intersects` clip then returns empty rows — a ZIP that "works" but shows an
> empty map. Sharing `data/us-state-polygons.geojson` is what guarantees a kept
> ZIP's state is always a non-empty clip target.

## Run

```sh
bash scripts/zip-etl/fetch-zcta-gazetteer.sh        # network (operator only)
npx tsx scripts/zip-etl/build-zip-index.ts          # offline → zip-index.json
npx vitest run scripts/zip-etl/build-zip-index.test.ts   # CI-safe, no network
```

CI runs only the third command's logic implicitly via the operator-run vitest
convention (mirrors `scripts/curation/silhouette.test.mjs`); it never fetches the source.
