/**
 * Offline ETL: 2020 Census ZCTA Gazetteer → frontend/public/zip-index.json.
 *
 * Reads the cached, sha256-pinned gazetteer (fetched by fetch-zcta-gazetteer.sh)
 * and the canonical state polygons (data/us-state-polygons.geojson — the SAME
 * artifact the server clip seeds from, locked decision #6). For each ZCTA
 * centroid it runs point-in-polygon against the polygons to precompute the
 * `US-XX` state, drops any centroid in no CONUS state (AK/HI/territories/ocean),
 * and emits a COLUMNAR index: a deduped `states[]` palette + `zips` map of
 * `zip → [lat, lng, stateIdx]`, coords rounded to 5 decimals (~1.1 m).
 *
 * No runtime ZIP→state lookup ships to the client — the state is baked in here.
 *
 * Run (after fetch-zcta-gazetteer.sh): `npx tsx scripts/zip-etl/build-zip-index.ts`
 * The pure functions below are unit-tested by build-zip-index.test.ts on a
 * 10-row fixture — no network, no fs, so CI never fetches.
 */
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  resolveStateForPoint,
  assertStateCodeSorted,
  type StatePolygonCollection,
} from './state-polygons.ts';

/** Current on-disk schema version. Bump on any encoding change. */
export const ZIP_INDEX_VERSION = 1;

/** Coordinates round to 5 decimals (~1.1 m), matching the polygon precision. */
const COORD_DECIMALS = 5;

/** A single parsed gazetteer row: ZIP + centroid. */
export interface GazetteerRow {
  zip: string;
  lat: number;
  lng: number;
}

/** Columnar ZIP index — the shape written to frontend/public/zip-index.json. */
export interface ZipIndex {
  v: number;
  /** Deduped palette of `US-XX` codes; `zips[*][2]` indexes into this. */
  states: string[];
  /** `zip → [lat, lng, stateIdx]`. */
  zips: Record<string, [number, number, number]>;
}

export interface BuildResult {
  index: ZipIndex;
  /** ZIPs that resolved to no CONUS state, with their centroids. */
  dropped: Array<{ zip: string; lat: number; lng: number }>;
  /** Rows read from the source (excludes the header). */
  inputCount: number;
}

/** Round to COORD_DECIMALS, avoiding `-0` and trailing-zero noise. */
function round5(n: number): number {
  return Number(n.toFixed(COORD_DECIMALS)) + 0;
}

/**
 * Parse one tab-separated gazetteer line into a `GazetteerRow`, or `null` if it
 * is the header, blank, or malformed. The gazetteer pads fields with trailing
 * whitespace, so every field is trimmed. Columns:
 * `GEOID  ALAND  AWATER  ALAND_SQMI  AWATER_SQMI  INTPTLAT  INTPTLONG`.
 */
export function parseGazetteerLine(line: string): GazetteerRow | null {
  const cols = line.split('\t').map((c) => c.trim());
  if (cols.length < 7) return null;
  const zip = cols[0];
  if (!/^\d{5}$/.test(zip)) return null; // skips the "GEOID" header + junk
  const lat = Number(cols[5]);
  const lng = Number(cols[6]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { zip, lat, lng };
}

/**
 * Core transform: parsed rows + polygons → columnar index + dropped log.
 * Pure (no fs/network) so it is directly unit-testable.
 */
export function buildZipIndex(
  rows: GazetteerRow[],
  collection: StatePolygonCollection,
): BuildResult {
  const states: string[] = [];
  const stateIdx = new Map<string, number>();
  const zips: Record<string, [number, number, number]> = {};
  const dropped: BuildResult['dropped'] = [];

  for (const { zip, lat, lng } of rows) {
    const code = resolveStateForPoint(lng, lat, collection);
    if (code === null) {
      dropped.push({ zip, lat, lng });
      continue;
    }
    let idx = stateIdx.get(code);
    if (idx === undefined) {
      idx = states.length;
      states.push(code);
      stateIdx.set(code, idx);
    }
    zips[zip] = [round5(lat), round5(lng), idx];
  }

  return {
    index: { v: ZIP_INDEX_VERSION, states, zips },
    dropped,
    inputCount: rows.length,
  };
}

/** Parse a full gazetteer file body into rows (skips header/malformed lines). */
export function parseGazetteer(text: string): GazetteerRow[] {
  const rows: GazetteerRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const row = parseGazetteerLine(line);
    if (row !== null) rows.push(row);
  }
  return rows;
}

/** fs-touching entry point. Skipped under the test import (no top-level run). */
function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolvePath(here, '..', '..');
  const gazPath = resolvePath(here, '.cache', '2020_Gaz_zcta_national.txt');
  const polyPath = resolvePath(repoRoot, 'data', 'us-state-polygons.geojson');
  const outPath = resolvePath(repoRoot, 'frontend', 'public', 'zip-index.json');
  const dropLogPath = resolvePath(here, 'dropped.log');

  const gazText = readFileSync(gazPath, 'utf8');
  const collection = JSON.parse(
    readFileSync(polyPath, 'utf8'),
  ) as StatePolygonCollection;

  // Guard the load-bearing invariant: resolveStateForPoint's first-match border
  // tie-break only mirrors the server's ORDER BY state_code ASC while features
  // stay sorted. Fail the build loudly if #728's generator ever re-orders them.
  assertStateCodeSorted(collection);

  const rows = parseGazetteer(gazText);
  const { index, dropped, inputCount } = buildZipIndex(rows, collection);

  // Deterministic (git-diff-stable) key order. NOTE: we cannot guarantee a
  // lexicographically-sorted *serialized* object — JSON.stringify follows the
  // ECMAScript own-property order, which emits canonical integer-index keys
  // ("10001") in ascending NUMERIC order ahead of any leading-zero key
  // ("08904"), regardless of insertion order. So a plain `.sort()` here would
  // be a no-op for the all-numeric ZIP keys. Insertion order below is
  // numeric-ascending purely so the build is reproducible; the artifact's
  // serialized order is the V8 integer-key order, not a flat ascending run.
  // This is harmless for the D3 keyed lookup (`zips[zip]`) — order never
  // matters to a hash-map read — and the order is fully deterministic, so the
  // committed file is git-diff stable across rebuilds.
  const sortedZips: Record<string, [number, number, number]> = {};
  for (const zip of Object.keys(index.zips).sort((a, b) => Number(a) - Number(b))) {
    sortedZips[zip] = index.zips[zip];
  }
  const sortedIndex: ZipIndex = { ...index, zips: sortedZips };

  writeFileSync(outPath, JSON.stringify(sortedIndex));

  writeFileSync(dropLogPath, '# zip\tlat\tlng — centroids in no CONUS state\n');
  for (const d of dropped) {
    appendFileSync(dropLogPath, `${d.zip}\t${d.lat}\t${d.lng}\n`);
  }

  const kept = Object.keys(sortedIndex.zips).length;
  process.stdout.write(
    `ZCTAs in: ${inputCount}  CONUS kept: ${kept}  dropped: ${dropped.length}\n` +
      `states: ${sortedIndex.states.length}  → ${outPath}\n`,
  );
}

// Run only when invoked directly (tsx), never when imported by the test.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
