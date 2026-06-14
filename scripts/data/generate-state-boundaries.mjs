#!/usr/bin/env node
/**
 * generate-state-boundaries.mjs — run-once offline generator (Task A1, #728;
 * mask emit #760/#762).
 *
 * Source → simplify → emit THREE frozen artifacts in one run:
 *   1. `migrations/1700000050000_state_boundaries.sql` INSERT block (pasted into A2)
 *   2. `data/us-state-polygons.geojson` — the canonical simplified CONUS shapes
 *      that the ZIP ETL (Stream D, point-in-polygon precompute) also reads.
 *      The clip and the ZIP→state precompute must never diverge (locked
 *      decision #6) — they share this one file.
 *   3. `frontend/public/state-polygons.json` — a `code → MultiPolygon geometry`
 *      map the client lazy-fetches to build the state-artboard inverse mask
 *      (#760/#762). Emitted from the SAME canonicalFeatures as (1)/(2), so the
 *      client mask edge matches the server's ST_Intersects data-clip edge
 *      (locked-decision-#7 cosmetic revision). NEVER regenerate it independently.
 *
 * Input: US Census cartographic boundary file `cb_2023_us_state_500k`
 *   https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip
 *   (public domain, 17 U.S.C. §105; 1:500,000 is already cartographically
 *   generalized — the right base resolution for a national zoom map).
 *
 * Pipeline:
 *   (a) mapshaper reads the shapefile (CRS +proj=longlat +datum=NAD83, which
 *       we treat as EPSG:4326 — the Census cb files are geographic lng/lat and
 *       the NAD83↔WGS84 datum shift is sub-meter, far below our 5% tolerance).
 *   (b) filter to CONUS — drop STATEFP 02 (AK), 15 (HI), and territories
 *       60/66/69/72/78, leaving exactly 48 states + DC (11) = 49 features.
 *   (c) `-simplify 5% keep-shapes visvalingam` — `keep-shapes` stops DC (a tiny
 *       polygon) from collapsing to nothing.
 *   (d) for each feature emit state_code='US-'||STUSPS, name=NAME, geometry as
 *       a WKT MULTIPOLYGON (single Polygons are wrapped), and the bounding
 *       envelope [min_lng,min_lat,max_lng,max_lat].
 *
 * Idempotent: re-running regenerates both artifacts byte-for-byte (modulo the
 * timestamp comment in the SQL header) from the cached shapefile.
 *
 * Usage:
 *   node scripts/data/generate-state-boundaries.mjs
 * Env overrides (optional):
 *   CENSUS_SHP   path to the unzipped .shp (default: .cache-census/cb_2023_us_state_500k.shp)
 *   SIMPLIFY_PCT mapshaper -simplify percentage (default: 5%)
 *
 * Knip: this file is intentionally unreferenced (run-once tooling); see knip.ts.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const SHP =
  process.env.CENSUS_SHP ??
  resolve(repoRoot, '.cache-census/cb_2023_us_state_500k.shp');
const SIMPLIFY_PCT = process.env.SIMPLIFY_PCT ?? '5%';

// CONUS filter: drop non-CONUS STATEFP codes.
//   02 = Alaska, 15 = Hawaii (outside MAX_BOUNDS, antimeridian math deferred)
//   60 = American Samoa, 66 = Guam, 69 = Northern Mariana Islands,
//   72 = Puerto Rico, 78 = U.S. Virgin Islands (territories)
// Leaves 48 contiguous states + DC (STATEFP 11) = 49 features.
const NON_CONUS_STATEFP = new Set(['02', '15', '60', '66', '69', '72', '78']);
const EXPECTED_COUNT = 49;

function fail(msg) {
  console.error(`\n[generate-state-boundaries] ERROR: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(SHP)) {
  fail(
    `Census shapefile not found at ${SHP}.\n` +
      `Download + unzip it first:\n` +
      `  mkdir -p .cache-census && cd .cache-census\n` +
      `  curl -sSLO https://www2.census.gov/geo/tiger/GENZ2023/shp/cb_2023_us_state_500k.zip\n` +
      `  unzip -o cb_2023_us_state_500k.zip\n` +
      `Or set CENSUS_SHP to its path.`
  );
}

// --- Step (a)–(c): mapshaper filter + simplify → intermediate GeoJSON --------
const work = mkdtempSync(join(tmpdir(), 'state-boundaries-'));
const intermediate = join(work, 'conus.geojson');

// Build the CONUS filter expression for mapshaper's -filter.
const dropList = [...NON_CONUS_STATEFP].map((c) => `'${c}'`).join(',');
const filterExpr = `![${dropList}].includes(STATEFP)`;

// mapshaper command (recorded verbatim in scripts/data/README-state-boundaries.md).
const mapshaperArgs = [
  'mapshaper',
  SHP,
  '-filter',
  filterExpr,
  '-simplify',
  `${SIMPLIFY_PCT}`,
  'keep-shapes',
  'visvalingam',
  '-clean', // remove sliver artifacts simplification can introduce
  '-o',
  intermediate,
  'precision=0.00001', // ~1.1 m; matches the ZIP-centroid 5-decimal rounding
  'format=geojson',
];

console.error(`[generate-state-boundaries] running: npx ${mapshaperArgs.join(' ')}`);
execFileSync('npx', ['--no-install', ...mapshaperArgs], {
  cwd: repoRoot,
  stdio: ['ignore', 'inherit', 'inherit'],
});

// --- Step (d): post-process GeoJSON → SQL + canonical GeoJSON ----------------
const fc = JSON.parse(readFileSync(intermediate, 'utf-8'));
if (fc.type !== 'FeatureCollection' || !Array.isArray(fc.features)) {
  fail('mapshaper did not emit a FeatureCollection');
}
if (fc.features.length !== EXPECTED_COUNT) {
  fail(
    `expected ${EXPECTED_COUNT} CONUS features, got ${fc.features.length}. ` +
      `Check the STATEFP drop list.`
  );
}

/** Round a coordinate to 5 decimals (~1.1 m); avoids -0 and float noise in WKT. */
function r5(n) {
  const v = Math.round(n * 1e5) / 1e5;
  return Object.is(v, -0) ? 0 : v;
}

/** A linear ring → "lng lat, lng lat, ..." (rounded, closed). */
function ringToWkt(ring) {
  return ring.map(([lng, lat]) => `${r5(lng)} ${r5(lat)}`).join(', ');
}

/** A single Polygon's coordinate array (rings) → "((ring),(hole),...))" tuple body. */
function polygonToWkt(polyCoords) {
  return '(' + polyCoords.map((ring) => `(${ringToWkt(ring)})`).join(', ') + ')';
}

/**
 * Normalize any GeoJSON Polygon/MultiPolygon geometry into a WKT MULTIPOLYGON
 * string and track the lng/lat envelope. Single Polygons are wrapped so the
 * geom column type `geometry(MultiPolygon,4326)` accepts every row.
 */
function geometryToMultiPolygonWkt(geom) {
  let polygons; // array of polygon-coordinate arrays
  if (geom.type === 'Polygon') {
    polygons = [geom.coordinates];
  } else if (geom.type === 'MultiPolygon') {
    polygons = geom.coordinates;
  } else {
    throw new Error(`unsupported geometry type ${geom.type}`);
  }

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const poly of polygons) {
    for (const ring of poly) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lat < minLat) minLat = lat;
        if (lng > maxLng) maxLng = lng;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }

  const body = polygons.map((poly) => polygonToWkt(poly)).join(', ');
  return {
    wkt: `MULTIPOLYGON(${body})`,
    bbox: [r5(minLng), r5(minLat), r5(maxLng), r5(maxLat)],
  };
}

/** Escape a single-quoted SQL string literal. */
function sqlStr(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

const rows = [];
const canonicalFeatures = [];
let vertexCount = 0;

for (const f of fc.features) {
  const { STUSPS, NAME } = f.properties;
  if (!STUSPS || !NAME) fail(`feature missing STUSPS/NAME: ${JSON.stringify(f.properties)}`);
  const stateCode = `US-${STUSPS}`;
  const { wkt, bbox } = geometryToMultiPolygonWkt(f.geometry);

  // Count vertices (auditable in the README).
  const polys =
    f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) for (const ring of poly) vertexCount += ring.length;

  if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
    fail(`${stateCode} produced a degenerate bbox ${JSON.stringify(bbox)}`);
  }

  rows.push({ stateCode, name: NAME, wkt, bbox });

  // Canonical GeoJSON feature: trimmed, rounded geometry the ZIP ETL reads.
  canonicalFeatures.push({
    type: 'Feature',
    properties: { state_code: stateCode, name: NAME, bbox },
    geometry:
      f.geometry.type === 'Polygon'
        ? { type: 'MultiPolygon', coordinates: [roundPolygon(f.geometry.coordinates)] }
        : { type: 'MultiPolygon', coordinates: f.geometry.coordinates.map(roundPolygon) },
  });
}

function roundPolygon(polyCoords) {
  return polyCoords.map((ring) => ring.map(([lng, lat]) => [r5(lng), r5(lat)]));
}

// Sort by state_code for deterministic output (matches resolveStateForPoint's
// ORDER BY state_code ASC tiebreak and keeps diffs stable on regeneration).
rows.sort((a, b) => a.stateCode.localeCompare(b.stateCode));
canonicalFeatures.sort((a, b) =>
  a.properties.state_code.localeCompare(b.properties.state_code)
);

// --- Emit the SQL INSERT block -----------------------------------------------
const valueLines = rows.map((r, i) => {
  const tail = i === rows.length - 1 ? '' : ',';
  return (
    `  (${sqlStr(r.stateCode)}, ${sqlStr(r.name)}, ` +
    `ST_SetSRID(ST_GeomFromText('${r.wkt}'),4326), ` +
    `${r.bbox[0]}, ${r.bbox[1]}, ${r.bbox[2]}, ${r.bbox[3]})${tail}`
  );
});

const insertSql =
  `INSERT INTO state_boundaries (state_code, name, geom, min_lng, min_lat, max_lng, max_lat) VALUES\n` +
  valueLines.join('\n') +
  `\n;\n`;

// --- Write artifacts ---------------------------------------------------------
const dataDir = resolve(repoRoot, 'data');
mkdirSync(dataDir, { recursive: true });

const geojson = { type: 'FeatureCollection', features: canonicalFeatures };
const geojsonStr = JSON.stringify(geojson) + '\n';
const geojsonPath = join(dataDir, 'us-state-polygons.geojson');
writeFileSync(geojsonPath, geojsonStr);

// --- Emit the client state-mask polygons asset (#760/#762) -------------------
// frontend/public/state-polygons.json — a `code → MultiPolygon geometry` map the
// client lazy-fetches once (frontend/src/data/state-polygons.ts) to build the
// state-artboard inverse mask (frontend/src/components/map/geometry/mask.ts). The
// FeatureCollection wrapper and every property are dropped — only the geometry
// ships, keyed by state_code. Built from the SAME `canonicalFeatures` (already
// sorted by state_code above) that produced the SQL INSERT and the GeoJSON, so
// the gray mask edge cannot drift from the server's ST_Intersects data-clip edge
// (the locked-decision-#7 cosmetic revision). One generator run emits all three
// artifacts; they must never be regenerated independently.
const maskByCode = {};
let maskVertexCount = 0;
for (const f of canonicalFeatures) {
  const code = f.properties.state_code;
  const geom = f.geometry; // always MultiPolygon (single Polygons wrapped above)
  if (maskByCode[code]) fail(`duplicate state_code ${code} in mask emit`);
  maskByCode[code] = { type: geom.type, coordinates: geom.coordinates };
  for (const poly of geom.coordinates) for (const ring of poly) maskVertexCount += ring.length;
}
const maskOut = JSON.stringify(maskByCode) + '\n';
const maskPath = resolve(repoRoot, 'frontend/public/state-polygons.json');
writeFileSync(maskPath, maskOut);
const maskBytes = Buffer.byteLength(maskOut, 'utf-8');

// Emit the ready-to-paste SQL INSERT to stdout AND a sidecar file in the work
// dir for convenience; the operator pastes it into the A2 migration.
const sqlOutPath = join(work, 'state_boundaries_insert.sql');
writeFileSync(sqlOutPath, insertSql);
process.stdout.write(insertSql);

// --- Provenance summary (stderr; figures pinned in the README) ---------------
const seedBytes = Buffer.byteLength(insertSql, 'utf-8');
const geojsonBytes = Buffer.byteLength(geojsonStr, 'utf-8');
console.error('\n[generate-state-boundaries] DONE');
console.error(`  features:        ${rows.length} (expected ${EXPECTED_COUNT})`);
console.error(`  total vertices:  ${vertexCount}`);
console.error(`  simplify:        ${SIMPLIFY_PCT} keep-shapes visvalingam`);
console.error(`  INSERT bytes:    ${seedBytes}`);
console.error(`  GeoJSON bytes:   ${geojsonBytes}  -> ${geojsonPath}`);
console.error(`  mask states:     ${Object.keys(maskByCode).length}`);
console.error(`  mask vertices:   ${maskVertexCount}`);
console.error(`  mask bytes:      ${maskBytes}  -> ${maskPath}`);
console.error(`  SQL written to:  ${sqlOutPath}`);
console.error('\nPaste the INSERT block above into migrations/1700000050000_state_boundaries.sql');
