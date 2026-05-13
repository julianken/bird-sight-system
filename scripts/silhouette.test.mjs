import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runCli } from './silhouette.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('silhouette CLI', () => {
  beforeEach(() => {
    process.env.ADMIN_API_URL = 'https://admin.example';
    process.env.ADMIN_API_TOKEN = 'tok';
  });
  afterEach(() => vi.restoreAllMocks());

  it('set <family> <file> PUTs the file with the bearer token', async () => {
    const path = join(tmpdir(), 'cuculidae.svg');
    writeFileSync(path, '<svg><path d="M1 1"/></svg>', 'utf8');
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ url: 'https://x', pathD: 'M1 1' }), { status: 200 }),
    );
    const code = await runCli(['set', 'cuculidae', path]);
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://admin.example/admin/silhouettes/family/cuculidae');
    expect(init.method).toBe('PUT');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.body).toBeInstanceOf(FormData);
    unlinkSync(path);
  });

  it('unset <family> DELETEs', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0][1].method).toBe('DELETE');
  });

  it('returns non-zero exit code on non-200', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('boom', { status: 400 }));
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(1);
  });

  it('errors when ADMIN_API_URL is missing', async () => {
    delete process.env.ADMIN_API_URL;
    const code = await runCli(['unset', 'cuculidae']);
    expect(code).toBe(2);
  });

  it('prints usage when given no subcommand', async () => {
    const code = await runCli([]);
    expect(code).toBe(2);
  });
});
