import { writeArchiveParquet } from './parquet-writer.js';
import type { ArchivableRow } from './select-archivable.js';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Minimal shape of the @google-cloud/storage Bucket we use — `bucket.file(name)`
 * returns an object with `save`, `getMetadata`, `copy`, `delete`. Typed here
 * so tests can stub without depending on the full SDK surface. The real GCS
 * SDK returns `[FileMetadata, request]` from `getMetadata` (a 2-tuple) but
 * we only ever read the first element, so the type is widened to
 * `[meta, ...unknown[]]` to remain assignable from the real SDK shape.
 */
export interface BucketLike {
  file(name: string): {
    save(buf: Buffer, opts?: { metadata?: { md5Hash?: string }; resumable?: boolean }): Promise<unknown>;
    getMetadata(): Promise<[{ md5Hash?: string; size?: string | number }, ...unknown[]]>;
    copy(dest: unknown): Promise<unknown>;
    delete(): Promise<unknown>;
  };
}

export interface ArchiveAndUploadOptions {
  bucket: BucketLike;
  /**
   * Bucket name — used to construct the returned `gs://` URI. Required
   * because `BucketLike` only exposes `file(name)` and the GCS SDK's
   * `Bucket.name` is not in our minimal interface (kept narrow so tests
   * don't have to stub the full SDK shape).
   */
  bucketName: string;
  /** UTC date in ISO YYYY-MM-DD form. */
  utcDate: string;
  rows: ArchivableRow[];
}

export interface ArchiveAndUploadResult {
  /** Final `gs://bucket/observations/year=.../month=.../day=...parquet` path. */
  gcsPath: string;
  /** Compressed Parquet size in bytes. */
  bytes: number;
  /** md5 hex digest of the bytes (for tally / verification). */
  md5: string;
}

/**
 * Write Parquet → upload to a temp key → verify md5 matches → copy to the
 * final partitioned key → delete the temp key. The temp-then-rename pattern
 * gives us atomic semantics: a partial upload cannot corrupt the final
 * partition. If anything throws, the final key is never written, runPrune
 * skips the day's DELETE, and the next nightly run retries cleanly.
 *
 * The temp key includes a UUID so two concurrent runs (e.g. an operator
 * triggered a manual run while the scheduled one is mid-flight) cannot
 * collide on the temp key. Orphaned `_tmp/<uuid>` objects from a crashed
 * run are cleaned by a separate lifecycle rule (optional follow-up — the
 * write volume is low enough that orphans don't materially impact cost).
 */
export async function archiveAndUpload(
  o: ArchiveAndUploadOptions
): Promise<ArchiveAndUploadResult> {
  const buf = await writeArchiveParquet(o.rows);
  const md5 = createHash('md5').update(buf).digest('hex');
  const md5Base64 = Buffer.from(md5, 'hex').toString('base64');

  const [year, month, day] = o.utcDate.split('-');
  const finalKey = `observations/year=${year}/month=${month}/day=${day}.parquet`;
  const tmpKey = `observations/_tmp/${randomUUID()}.parquet`;

  const tmpFile = o.bucket.file(tmpKey);
  await tmpFile.save(buf, {
    metadata: { md5Hash: md5Base64 },
    resumable: false,
  });

  // Re-fetch md5 from GCS to confirm the write landed intact. GCS auto-
  // verifies on upload when md5Hash is supplied, but a paranoid second
  // check costs one HEAD and catches the rare path where a proxy
  // rewrites the body.
  const [meta] = await tmpFile.getMetadata();
  if (meta.md5Hash && meta.md5Hash !== md5Base64) {
    await tmpFile.delete().catch(() => {});
    throw new Error(`archive md5 mismatch: expected ${md5Base64}, got ${meta.md5Hash}`);
  }

  // Atomic rename via copy + delete. GCS does not have a server-side
  // move; copy is server-side (no bytes traverse the client) and
  // delete is a single op.
  await tmpFile.copy(o.bucket.file(finalKey));
  await tmpFile.delete().catch(() => {
    // Non-fatal: the final write succeeded; orphan _tmp objects are
    // cleaned by a separate lifecycle rule (optional follow-up).
  });

  return {
    gcsPath: `gs://${o.bucketName}/${finalKey}`,
    bytes: buf.length,
    md5,
  };
}
