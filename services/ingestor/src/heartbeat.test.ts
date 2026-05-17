import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pingHeartbeat } from './heartbeat.js';

describe('pingHeartbeat', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('is a no-op when url is undefined', async () => {
    const fetcher = vi.fn();
    await pingHeartbeat(undefined, 'recent', fetcher as unknown as typeof fetch);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('POSTs to the configured url on success', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    await pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch);
    expect(fetcher).toHaveBeenCalledWith('https://hc.io/abc', { method: 'POST' });
  });

  it('swallows 5xx without throwing', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 502 } as Response);
    await expect(
      pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('swallows network errors without throwing', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(
      pingHeartbeat('https://hc.io/abc', 'recent', fetcher as unknown as typeof fetch),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});
