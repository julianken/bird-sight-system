import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadZipIndex, lookupZip, __resetZipIndexCache, ZIP_INDEX_URL } from './zip-lookup.js';

/**
 * A minimal columnar index matching the production `zip-index.json` shape
 * ({ v, states, zips }) with entries encoded `[lat, lng, stateIdx]`.
 * 85701 (Tucson, AZ) and 10001 (Manhattan, NY) are real centroids.
 */
const FIXTURE_INDEX = {
  v: 1,
  states: ['US-NY', 'US-AZ'],
  zips: {
    '85701': [32.21696, -110.971, 1],
    '10001': [40.75064, -73.99718, 0],
  },
};

function stubFetchOk(body: unknown): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
  } as Response);
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('zip-lookup', () => {
  beforeEach(() => {
    __resetZipIndexCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('loadZipIndex — lazy single-flight memo', () => {
    it('two concurrent callers share a single fetch (single-flight)', async () => {
      const fetchMock = stubFetchOk(FIXTURE_INDEX);

      const [a, b] = await Promise.all([loadZipIndex(), loadZipIndex()]);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(a).toBe(b); // same resolved object
    });

    it('memoizes across sequential calls — second call does not refetch', async () => {
      const fetchMock = stubFetchOk(FIXTURE_INDEX);

      await loadZipIndex();
      await loadZipIndex();

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('clears the memo on failure so a later call retries (and can succeed)', async () => {
      const failing = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FIXTURE_INDEX) } as Response);
      vi.stubGlobal('fetch', failing);

      await expect(loadZipIndex()).rejects.toThrow(/network down/);
      // Memo cleared → retry fires a fresh fetch and resolves.
      const index = await loadZipIndex();
      expect(index.v).toBe(1);
      expect(failing).toHaveBeenCalledTimes(2);
    });

    it('treats a non-ok HTTP response as a failure and clears the memo', async () => {
      const failing = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 503, json: () => Promise.resolve({}) } as Response)
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(FIXTURE_INDEX) } as Response);
      vi.stubGlobal('fetch', failing);

      await expect(loadZipIndex()).rejects.toThrow();
      const index = await loadZipIndex();
      expect(index.v).toBe(1);
      expect(failing).toHaveBeenCalledTimes(2);
    });

    it('fetches the public asset with a ?v= cache-bust param (Vite does not hash public/)', async () => {
      const fetchMock = stubFetchOk(FIXTURE_INDEX);

      await loadZipIndex();

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toBe(ZIP_INDEX_URL);
      expect(url).toContain('zip-index.json');
      expect(url).toContain('?v=1');
    });
  });

  describe('lookupZip', () => {
    it('resolves a known 5-digit ZIP to { zip, center:[lng,lat], stateCode }', async () => {
      stubFetchOk(FIXTURE_INDEX);

      const res = await lookupZip('85701');

      expect(res).not.toBeNull();
      expect(res?.zip).toBe('85701');
      expect(res?.stateCode).toBe('US-AZ');
      // center must be [lng, lat] — the index stores [lat, lng], so indices are swapped.
      expect(res?.center).toEqual([-110.971, 32.21696]);
      // Longitude (first) is negative for CONUS — guards against a missing swap.
      expect(res?.center[0]).toBeLessThan(0);
    });

    it('strips a ZIP+4 suffix (-####) before lookup', async () => {
      stubFetchOk(FIXTURE_INDEX);

      const res = await lookupZip('85701-1234');

      expect(res?.zip).toBe('85701');
      expect(res?.stateCode).toBe('US-AZ');
    });

    it('trims surrounding whitespace', async () => {
      stubFetchOk(FIXTURE_INDEX);

      const res = await lookupZip('  10001  ');

      expect(res?.zip).toBe('10001');
      expect(res?.stateCode).toBe('US-NY');
    });

    it('returns null for a well-formed but unknown ZIP (after fetching)', async () => {
      const fetchMock = stubFetchOk(FIXTURE_INDEX);

      const res = await lookupZip('99999');

      expect(res).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1); // it DID consult the index
    });

    it.each(['abc', '123', '', '1234', '123456', 'az'])(
      'regex-rejects non-5-digit input %j and returns null WITHOUT fetching',
      async (raw) => {
        const fetchMock = stubFetchOk(FIXTURE_INDEX);

        const res = await lookupZip(raw);

        expect(res).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );
  });

  describe('bundle hygiene', () => {
    it('loads the index via runtime fetch — never a static import that Vite would inline into the entry chunk', () => {
      const src = readFileSync(path.resolve(__dirname, 'zip-lookup.ts'), 'utf8');
      // A static `import ... from '....zip-index.json'` (or a top-level
      // `import('....zip-index.json')`) would let Vite bundle the ~1 MB
      // dataset into JS. The asset must stay in public/ and be fetched.
      // Match only on-line import statements that pull a zip-index.json
      // module specifier (single- or double-quoted) — not prose comments.
      expect(src).not.toMatch(/import[^\n]*['"][^'"\n]*zip-index\.json['"]/);
      expect(src).toMatch(/fetch\(/);
    });
  });
});
