import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock module boundaries BEFORE importing handler. The handler's job is to
// dispatch ScheduledKind → the right runner; the runners themselves are
// covered by their own test suites. Stubbing at the module level lets us
// assert that the dispatch routes the kind correctly and forwards env-derived
// args (apiKey, regionCode, pool) to the chosen runner.
const POOL_SENTINEL = Symbol('pool') as unknown as import('@bird-watch/db-client').Pool;

const createPoolMock = vi.fn();
const closePoolMock = vi.fn();
const runIngestMock = vi.fn();
const runHotspotIngestMock = vi.fn();
const runBackfillMock = vi.fn();
const runTaxonomyMock = vi.fn();
const runPhotosMock = vi.fn();

vi.mock('@bird-watch/db-client', () => ({
  createPool: (...args: unknown[]) => createPoolMock(...args),
  closePool: (...args: unknown[]) => closePoolMock(...args),
}));

vi.mock('./run-ingest.js', () => ({
  runIngest: (...args: unknown[]) => runIngestMock(...args),
}));

vi.mock('./run-hotspots.js', () => ({
  runHotspotIngest: (...args: unknown[]) => runHotspotIngestMock(...args),
}));

vi.mock('./run-backfill.js', () => ({
  runBackfill: (...args: unknown[]) => runBackfillMock(...args),
}));

vi.mock('./run-taxonomy.js', () => ({
  runTaxonomy: (...args: unknown[]) => runTaxonomyMock(...args),
}));

vi.mock('./run-photos.js', () => ({
  runPhotos: (...args: unknown[]) => runPhotosMock(...args),
}));

import { handleScheduled, type HandlerEnv } from './handler.js';

const ENV: HandlerEnv = {
  DATABASE_URL: 'postgres://test',
  EBIRD_API_KEY: 'test-key',
};

describe('handleScheduled', () => {
  beforeEach(() => {
    createPoolMock.mockReset().mockReturnValue(POOL_SENTINEL);
    closePoolMock.mockReset().mockResolvedValue(undefined);
    runIngestMock.mockReset();
    runHotspotIngestMock.mockReset();
    runBackfillMock.mockReset();
    runTaxonomyMock.mockReset();
    runPhotosMock.mockReset();
  });

  it("dispatches to runIngest when kind is 'recent'", async () => {
    const summary = { status: 'success', fetched: 1, upserted: 1 };
    runIngestMock.mockResolvedValue(summary);

    const result = await handleScheduled('recent', ENV);

    expect(runIngestMock).toHaveBeenCalledWith({
      pool: POOL_SENTINEL,
      apiKey: 'test-key',
      regionCode: 'US-AZ',
    });
    expect(result).toBe(summary);
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("dispatches to runHotspotIngest when kind is 'hotspots'", async () => {
    const summary = { status: 'success', fetched: 5, upserted: 5 };
    runHotspotIngestMock.mockResolvedValue(summary);

    const result = await handleScheduled('hotspots', ENV);

    expect(runHotspotIngestMock).toHaveBeenCalledWith({
      pool: POOL_SENTINEL,
      apiKey: 'test-key',
      regionCode: 'US-AZ',
    });
    expect(result).toBe(summary);
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("dispatches to runBackfill when kind is 'backfill'", async () => {
    const summary = { status: 'success', daysProcessed: 30 };
    runBackfillMock.mockResolvedValue(summary);

    const result = await handleScheduled('backfill', ENV);

    expect(runBackfillMock).toHaveBeenCalledWith({
      pool: POOL_SENTINEL,
      apiKey: 'test-key',
      regionCode: 'US-AZ',
      days: 30,
    });
    expect(result).toBe(summary);
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("dispatches to runTaxonomy when kind is 'taxonomy'", async () => {
    const summary = { status: 'success', totalFetched: 0, speciesInserted: 0, nonSpeciesFiltered: 0, reconciled: 0 };
    runTaxonomyMock.mockResolvedValue(summary);

    const result = await handleScheduled('taxonomy', ENV);

    expect(runTaxonomyMock).toHaveBeenCalledWith({
      pool: POOL_SENTINEL,
      apiKey: 'test-key',
    });
    expect(result).toBe(summary);
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it("dispatches to runPhotos when kind is 'photos'", async () => {
    const summary = {
      speciesCount: 0,
      photosFetched: 0,
      photosSkipped: 0,
      photosFailed: 0,
      errors: [],
    };
    runPhotosMock.mockResolvedValue(summary);

    const result = await handleScheduled('photos', ENV);

    // runPhotos's only required arg is `pool`; it must NOT be called with
    // EBIRD_API_KEY (iNat is its upstream, not eBird).
    expect(runPhotosMock).toHaveBeenCalledTimes(1);
    const call = runPhotosMock.mock.calls[0]?.[0];
    expect(call).toMatchObject({ pool: POOL_SENTINEL });
    expect(call).not.toHaveProperty('apiKey');
    expect(result).toBe(summary);
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });

  it('closes the pool even when the runner throws', async () => {
    runTaxonomyMock.mockRejectedValue(new Error('boom'));

    await expect(handleScheduled('taxonomy', ENV)).rejects.toThrow('boom');
    expect(closePoolMock).toHaveBeenCalledWith(POOL_SENTINEL);
  });
});
