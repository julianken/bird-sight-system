// @ts-expect-error — parquetjs-lite ships without types; the API surface
// we use (ParquetSchema, ParquetWriter, ParquetReader) is stable.
import parquet from 'parquetjs-lite';
// @ts-expect-error — internal types module, untyped but stable; we patch
// the TIMESTAMP_MILLIS `fromPrimitive` to handle Node 22+ BigInt values.
import parquetTypes from 'parquetjs-lite/lib/types.js';
import type { ArchivableRow } from './select-archivable.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

// parquetjs-lite 0.8.x ships a `fromPrimitive_TIMESTAMP_MILLIS` that does
// `new Date(+value)`. Under Node 22+ the underlying INT64 column reads as
// a BigInt and `+bigint` throws TypeError. The library is effectively
// unmaintained (last release 2021) so we monkey-patch the type table at
// import time. Production never reads from the archive — this only affects
// the test roundtrip — but writing through the same code path means the
// patch is applied uniformly. The fix matches what an upstream PR would
// do: route through `Number(value)` which coerces BigInt → number.
//
// If parquetjs-lite ever ships a fix or we swap to apache-arrow, delete
// the next four lines.
const PT = parquetTypes.PARQUET_LOGICAL_TYPES;
if (PT?.TIMESTAMP_MILLIS) {
  PT.TIMESTAMP_MILLIS.fromPrimitive = (v: bigint | number | string): Date =>
    new Date(typeof v === 'bigint' ? Number(v) : +v);
}

/**
 * Schema for the observations archive. Column order matches the SELECT
 * in select-archivable.ts and the table in the plan §2. UTF8 strings,
 * DOUBLE for lng/lat, INT64 milliseconds for timestamps (TIMESTAMPTZ on
 * the source side; UTC milliseconds in Parquet). Nullable on every
 * column the upstream JOIN can leave NULL.
 *
 * Compression: gzip. Snappy is also supported but adds an optional
 * native dep — gzip via Node's zlib is fine for the row counts we ship.
 *
 * `statistics: false` on the TIMESTAMP_MILLIS columns: parquetjs-lite's
 * `decodeStatisticsValue` path calls `+value` on the BigInt min/max it
 * stored, which throws under Node 22+ (`Cannot convert a BigInt value
 * to a number`). Disabling per-page stats on the two timestamp columns
 * sidesteps the library bug without changing the on-disk schema or
 * downstream reader behavior — BigQuery, DuckDB, and Polars all read
 * the data column directly and don't depend on Parquet's optional
 * min/max statistics.
 */
const schema = new parquet.ParquetSchema({
  sub_id:       { type: 'UTF8' },
  species_code: { type: 'UTF8' },
  obs_dt:       { type: 'TIMESTAMP_MILLIS', statistics: false },
  lng:          { type: 'DOUBLE' },
  lat:          { type: 'DOUBLE' },
  obs_count:    { type: 'INT32', optional: true },
  is_notable:   { type: 'BOOLEAN' },
  loc_id:       { type: 'UTF8' },
  loc_name:     { type: 'UTF8', optional: true },
  common_name:  { type: 'UTF8', optional: true },
  sci_name:     { type: 'UTF8', optional: true },
  family_code:  { type: 'UTF8', optional: true },
  family_name:  { type: 'UTF8', optional: true },
  ingested_at:  { type: 'TIMESTAMP_MILLIS', statistics: false },
});

/**
 * Write a batch of ArchivableRow to a Parquet buffer. Returns the gzip-
 * compressed Parquet bytes ready for GCS upload. Uses a temp file under
 * the writer because parquetjs-lite's streaming API targets file paths;
 * we read the bytes back and unlink the temp file before returning.
 */
export async function writeArchiveParquet(rows: ArchivableRow[]): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'birdwatch-archive-'));
  const path = join(dir, 'archive.parquet');
  try {
    const writer = await parquet.ParquetWriter.openFile(schema, path, {
      compression: 'GZIP',
    });
    for (const row of rows) {
      // Nullable columns: parquetjs-lite's optional fields treat `undefined`
      // (not `null`) as "absent" — explicit translation here keeps the
      // ArchivableRow API uniform (null for absent) and matches the
      // roundtrip test (`expect(round[1]?.common_name).toBeNull()`).
      await writer.appendRow({
        ...row,
        obs_count: row.obs_count ?? undefined,
        loc_name: row.loc_name ?? undefined,
        common_name: row.common_name ?? undefined,
        sci_name: row.sci_name ?? undefined,
        family_code: row.family_code ?? undefined,
        family_name: row.family_name ?? undefined,
      });
    }
    await writer.close();
    return await readFile(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Read a Parquet buffer back into ArchivableRow shape. Test helper only —
 * production never reads from the archive (that path is BigQuery /
 * DuckDB / Polars in §7).
 */
export async function readArchiveParquet(buf: Buffer): Promise<ArchivableRow[]> {
  const dir = await mkdtemp(join(tmpdir(), 'birdwatch-archive-read-'));
  const path = join(dir, 'archive.parquet');
  await writeFile(path, buf);
  try {
    const reader = await parquet.ParquetReader.openFile(path);
    const cursor = reader.getCursor();
    const out: ArchivableRow[] = [];
    let r: unknown;
    while ((r = await cursor.next()) !== null) {
      const row = r as Record<string, unknown>;
      out.push({
        sub_id: row.sub_id as string,
        species_code: row.species_code as string,
        obs_dt: new Date(Number(row.obs_dt)),
        lng: row.lng as number,
        lat: row.lat as number,
        obs_count: (row.obs_count ?? null) as number | null,
        is_notable: row.is_notable as boolean,
        loc_id: row.loc_id as string,
        loc_name: (row.loc_name ?? null) as string | null,
        common_name: (row.common_name ?? null) as string | null,
        sci_name: (row.sci_name ?? null) as string | null,
        family_code: (row.family_code ?? null) as string | null,
        family_name: (row.family_name ?? null) as string | null,
        ingested_at: new Date(Number(row.ingested_at)),
      });
    }
    await reader.close();
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
