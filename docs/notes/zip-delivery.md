# Decision: ZIP index delivery — static asset, not a read-api proxy

**Date:** 2026-05-28
**Plan:** `docs/plans/2026-05-28-state-scope-selector.md`, Stream D (tasks D2–D5)
**Issue:** #739

## Context

The ZIP scope feature resolves a user-typed 5-digit ZIP to a CONUS state
(`?state=US-XX`) plus a camera centroid. The state is precomputed offline by
point-in-polygon against the canonical state polygons (`data/us-state-polygons.geojson`),
so the frontend never does a runtime ZIP→state lookup. The result is a
columnar index — `{ v, states, zips: { '85701': [lat, lng, stateIdx] } }` —
of ~32.5k CONUS ZCTAs, ~1 MB raw.

The question: how does that index reach the browser?

## Options

1. **Static asset in `public/`** (CHOSEN). The ETL writes `frontend/public/zip-index.json`;
   Vite copies it verbatim into the build; Cloudflare Pages serves it CDN-cached;
   the frontend fetches it at runtime on first ZIP-input focus.
2. **Read-api proxy** — a `GET /api/zip/:zip` (or `/api/zip-index`) route backed
   by Cloud SQL or the bundled file.

## Decision

**Static asset (option 1).**

A read-api proxy would add a route, a Cloud SQL round-trip (or an in-process
file read replicated per container), and a new rate-limit surface — for zero
benefit. The index is build-time-stable: it changes ONLY when the offline ETL
re-runs against a new Census ZCTA vintage, which ships as a normal deploy. A
flat file on the CDN is the cheapest, most cacheable delivery for
build-time-stable data, and it keeps the ZIP path entirely client-side (no
backend dependency for ZIP resolution).

## Consequences / mechanics

- **Lazy load.** The asset is fetched at runtime via `fetch()`, never
  `import`ed — so Vite never inlines the ~1 MB dataset into the entry chunk.
  `frontend/src/data/zip-lookup.ts` warms it on the first `ZipInput` focus, and
  memoizes single-flight (concurrent callers share one fetch; a rejection
  clears the memo so a later focus retries). A unit test asserts the module
  contains no static `import` of `zip-index.json`.

- **Cache-busting.** Vite does NOT content-hash files under `public/`, so the
  edge/browser would serve a stale index after the ETL regenerates it. The
  fetch URL appends `?v=<datasetVersion>`. The version is **hardcoded to `1`**
  to match the `v: 1` field the ETL emits into the index (D2 schema).
  **Increment both in lock-step** (`ZIP_INDEX_VERSION` in `zip-lookup.ts` and
  the ETL's `v` field) whenever `zip-index.json` is regenerated — otherwise
  clients keep the old file until their cache naturally expires.

- **ZIP ≠ ZCTA.** ~41k USPS ZIPs vs ~33k Census ZCTAs: PO-box / military /
  point ZIPs have no ZCTA, so a minority of otherwise-valid ZIPs will MISS the
  index. That is handled explicitly in `ZipInput` — a well-formed-but-unknown
  ZIP shows a visible "ZIP not recognized" status (never a silent no-op) and
  steers the user to the state selector.
