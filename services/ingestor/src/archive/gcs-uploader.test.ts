import { describe, it, expect, vi } from 'vitest';
import { archiveAndUpload } from './gcs-uploader.js';
import type { ArchivableRow } from './select-archivable.js';

const fakeRow: ArchivableRow = {
  sub_id: 'S1', species_code: 'vermfly',
  obs_dt: new Date('2026-05-01T12:00:00Z'),
  lng: -110.88, lat: 31.72,
  obs_count: 2, is_notable: false,
  loc_id: 'L1', loc_name: 'A',
  common_name: 'Vermilion Flycatcher', sci_name: 'Pyrocephalus rubinus',
  family_code: 'tyrannidae', family_name: 'Tyrant Flycatchers',
  ingested_at: new Date('2026-05-01T13:00:00Z'),
};

function makeStubBucket() {
  const saved: Array<{ name: string; bytes: number; md5?: string | undefined }> = [];
  const copies: Array<{ from: string; to: string }> = [];
  const deletes: string[] = [];
  const file = (name: string) => ({
    save: vi.fn(async (buf: Buffer, opts?: { metadata?: { md5Hash?: string } }) => {
      saved.push({ name, bytes: buf.length, md5: opts?.metadata?.md5Hash });
    }),
    // Mirror what GCS returns from `tmpFile.getMetadata()` so the
    // post-upload md5 verification passes through the happy path. We
    // echo back the same md5 that was uploaded — the test isn't
    // exercising the md5-mismatch branch (that's the third test below).
    getMetadata: vi.fn(async () => {
      const last = saved[saved.length - 1];
      return [{ md5Hash: last?.md5, size: String(last?.bytes ?? 0) }];
    }),
    delete: vi.fn(async () => { deletes.push(name); }),
    copy: vi.fn(async (destFile: { name?: string }) => {
      copies.push({ from: name, to: destFile?.name ?? '?' });
    }),
    name,
  });
  return { bucket: { file }, saved, copies, deletes };
}

describe('archiveAndUpload', () => {
  it('writes a parquet to a temp key then renames to the partitioned final key', async () => {
    const stub = makeStubBucket();
    const result = await archiveAndUpload({
      bucket: stub.bucket as never,
      bucketName: 'bird-maps-prod-obs-archive',
      utcDate: '2026-05-01',
      rows: [fakeRow],
    });
    expect(result.gcsPath).toBe(
      'gs://bird-maps-prod-obs-archive/observations/year=2026/month=05/day=01/data.parquet'
    );
    // Temp key written before the final partition key
    expect(stub.saved.map(s => s.name)).toEqual([
      expect.stringMatching(/^observations\/_tmp\//),
    ]);
    // Then the temp key was copied into the final partitioned key
    expect(stub.copies).toHaveLength(1);
    expect(stub.copies[0]?.from).toMatch(/^observations\/_tmp\//);
    expect(stub.copies[0]?.to).toBe('observations/year=2026/month=05/day=01/data.parquet');
    // Regression: the final key MUST have `day=DD` as a directory component
    // (with a stable `data.parquet` filename), not `day=DD.parquet` as a
    // filename. BigQuery's Hive AUTO partition detection only treats
    // `key=value` directory segments as partition columns; encoding `day`
    // in the filename hides it from the planner and forces every monthly
    // query to open all ~30 files. See issue #699.
    expect(stub.copies[0]?.to).toMatch(/\/year=\d{4}\/month=\d{2}\/day=\d{2}\/data\.parquet$/);
    expect(result.gcsPath).toMatch(/\/year=\d{4}\/month=\d{2}\/day=\d{2}\/data\.parquet$/);
    // bytes returned matches the saved buffer length
    expect(result.bytes).toBe(stub.saved[0]?.bytes);
    expect(result.md5).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not write the final key if the temp save throws', async () => {
    const finalCopy = vi.fn(async () => { throw new Error('should not reach final key'); });
    const bucket = {
      file: (name: string) => {
        if (name.startsWith('observations/_tmp/')) {
          return {
            save: vi.fn(async () => { throw new Error('GCS down'); }),
            getMetadata: vi.fn(),
            delete: vi.fn(),
            copy: vi.fn(),
            name,
          };
        }
        return {
          save: vi.fn(),
          getMetadata: vi.fn(),
          delete: vi.fn(),
          copy: finalCopy,
          name,
        };
      },
    };
    await expect(archiveAndUpload({
      bucket: bucket as never,
      bucketName: 'bird-maps-prod-obs-archive',
      utcDate: '2026-05-01',
      rows: [fakeRow],
    })).rejects.toThrow('GCS down');
    expect(finalCopy).not.toHaveBeenCalled();
  });

  it('throws and does not copy to the final key if md5 verification fails', async () => {
    const finalCopy = vi.fn(async () => { throw new Error('should not reach final key'); });
    const tempDelete = vi.fn(async () => {});
    const bucket = {
      file: (name: string) => {
        if (name.startsWith('observations/_tmp/')) {
          return {
            save: vi.fn(async () => {}),
            // Return a different md5 than what was uploaded → triggers
            // the mismatch branch and the rename is short-circuited.
            getMetadata: vi.fn(async () => [{ md5Hash: 'deadbeefdeadbeefdeadbeefdeadbeef' }]),
            delete: tempDelete,
            copy: vi.fn(),
            name,
          };
        }
        return {
          save: vi.fn(),
          getMetadata: vi.fn(),
          delete: vi.fn(),
          copy: finalCopy,
          name,
        };
      },
    };
    await expect(archiveAndUpload({
      bucket: bucket as never,
      bucketName: 'bird-maps-prod-obs-archive',
      utcDate: '2026-05-01',
      rows: [fakeRow],
    })).rejects.toThrow(/md5 mismatch/);
    expect(finalCopy).not.toHaveBeenCalled();
    expect(tempDelete).toHaveBeenCalled();
  });
});
