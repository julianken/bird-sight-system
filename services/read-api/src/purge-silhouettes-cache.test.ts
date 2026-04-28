import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// scripts/purge-silhouettes-cache.sh wraps the Cloudflare cache-purge curl.
// We can't safely test the live POST, but the --dry-run flag is the contract
// CI relies on to keep the script from rotting. This spec asserts:
//   1. The script file exists and is executable.
//   2. Required env-vars are enforced (the unset-env case errors out).
//   3. --dry-run with both env-vars set exits 0 and prints the expected lines.
// Resolve from the workspace dir up to the repo root so the test stays
// portable whether vitest is invoked from the workspace or the root.
const SCRIPT = resolve(__dirname, '../../../scripts/purge-silhouettes-cache.sh');

describe('scripts/purge-silhouettes-cache.sh', () => {
  it('exists and is executable', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    // 0o111 = any execute bit (owner|group|other). Stricter than checking
    // the user-execute bit alone — the script must run for CI's runner UID,
    // which is not necessarily the file owner.
    const mode = statSync(SCRIPT).mode;
    expect((mode & 0o111) !== 0).toBe(true);
  });

  it('errors when CLOUDFLARE_ZONE_ID is missing', () => {
    const r = spawnSync(SCRIPT, ['--dry-run'], {
      // Strip the two required vars from the inherited env.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([k]) => k !== 'CLOUDFLARE_ZONE_ID' && k !== 'CLOUDFLARE_API_TOKEN',
        ),
      ) as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/CLOUDFLARE_ZONE_ID/);
  });

  it('--dry-run prints the would-be POST and exits 0 without calling the API', () => {
    const r = spawnSync(SCRIPT, ['--dry-run'], {
      env: {
        ...process.env,
        CLOUDFLARE_ZONE_ID: 'test_zone',
        CLOUDFLARE_API_TOKEN: 'test_token',
      } as NodeJS.ProcessEnv,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('DRY RUN');
    expect(r.stdout).toContain(
      'https://api.cloudflare.com/client/v4/zones/test_zone/purge_cache',
    );
    expect(r.stdout).toContain('https://api.bird-maps.com/api/silhouettes');
  });
});
