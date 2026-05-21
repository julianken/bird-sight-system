import { describe, it, expect } from 'vitest';
import { writeArchiveParquet, readArchiveParquet } from './parquet-writer.js';
import type { ArchivableRow } from './select-archivable.js';

const sample: ArchivableRow[] = [
  {
    sub_id: 'S1', species_code: 'vermfly',
    obs_dt: new Date('2026-05-01T12:00:00Z'),
    lng: -110.88, lat: 31.72,
    obs_count: 2, is_notable: false,
    loc_id: 'L1', loc_name: 'A',
    common_name: 'Vermilion Flycatcher', sci_name: 'Pyrocephalus rubinus',
    family_code: 'tyrannidae', family_name: 'Tyrant Flycatchers',
    ingested_at: new Date('2026-05-01T13:00:00Z'),
  },
  {
    sub_id: 'S2', species_code: 'unknownsp',
    obs_dt: new Date('2026-05-01T18:30:00Z'),
    lng: -110.89, lat: 31.73,
    obs_count: null, is_notable: true,
    loc_id: 'L2', loc_name: null,
    common_name: null, sci_name: null,
    family_code: null, family_name: null,
    ingested_at: new Date('2026-05-01T19:00:00Z'),
  },
];

describe('writeArchiveParquet / readArchiveParquet', () => {
  it('roundtrips a non-empty batch with nullable columns intact', async () => {
    const bytes = await writeArchiveParquet(sample);
    const round = await readArchiveParquet(bytes);
    expect(round).toHaveLength(2);
    expect(round[0]?.sub_id).toBe('S1');
    expect(round[0]?.common_name).toBe('Vermilion Flycatcher');
    expect(round[1]?.common_name).toBeNull();
    expect(round[1]?.is_notable).toBe(true);
  });

  it('produces a stable schema: 14 columns', async () => {
    const bytes = await writeArchiveParquet(sample);
    const round = await readArchiveParquet(bytes);
    const keys = Object.keys(round[0] ?? {}).sort();
    expect(keys).toEqual([
      'common_name', 'family_code', 'family_name',
      'ingested_at', 'is_notable', 'lat', 'lng',
      'loc_id', 'loc_name', 'obs_count', 'obs_dt',
      'sci_name', 'species_code', 'sub_id',
    ]);
  });

  it('writes a non-empty buffer for an empty input (header-only Parquet)', async () => {
    const bytes = await writeArchiveParquet([]);
    expect(bytes.length).toBeGreaterThan(0);
    const round = await readArchiveParquet(bytes);
    expect(round).toEqual([]);
  });
});
