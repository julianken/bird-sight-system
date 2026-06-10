import { describe, it, expect, vi } from 'vitest';
import { assertSafePhotoSource, SsrfError, PHOTO_HOST_ALLOWLIST } from './ssrf-guard.js';

// A stub `dns.lookup({ all: true })` that always resolves to one public IPv4.
// Tests that exercise the host/protocol checks never reach DNS, but the helper
// requires *some* lookup; this keeps them deterministic with zero real DNS.
function lookupPublic() {
  return vi.fn(async () => [{ address: '151.101.0.1', family: 4 }]);
}

function lookupFor(addresses: { address: string; family: number }[]) {
  return vi.fn(async () => addresses);
}

describe('assertSafePhotoSource', () => {
  it('accepts an https allowlisted host that resolves to a public IP', async () => {
    const lookup = lookupPublic();
    await expect(
      assertSafePhotoSource('https://static.inaturalist.org/photos/1/medium.jpg', { lookup }),
    ).resolves.toBeUndefined();
    expect(lookup).toHaveBeenCalledOnce();
  });

  it.each([...PHOTO_HOST_ALLOWLIST])('accepts allowlisted host %s', async (host) => {
    const lookup = lookupPublic();
    await expect(
      assertSafePhotoSource(`https://${host}/x.jpg`, { lookup }),
    ).resolves.toBeUndefined();
  });

  it('rejects an http:// (non-https) URL before any DNS lookup', async () => {
    const lookup = lookupPublic();
    await expect(
      assertSafePhotoSource('http://static.inaturalist.org/x.jpg', { lookup }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each(['file:///etc/passwd', 'data:text/html,<x>', 'ftp://static.inaturalist.org/x'])(
    'rejects non-https scheme %s',
    async (url) => {
      await expect(assertSafePhotoSource(url, { lookup: lookupPublic() })).rejects.toBeInstanceOf(
        SsrfError,
      );
    },
  );

  it('rejects an unparseable URL', async () => {
    await expect(assertSafePhotoSource('not a url', { lookup: lookupPublic() })).rejects.toBeInstanceOf(
      SsrfError,
    );
  });

  it('rejects a non-allowlisted host before any DNS lookup', async () => {
    const lookup = lookupPublic();
    await expect(
      assertSafePhotoSource('https://evil.example.com/x.jpg', { lookup }),
    ).rejects.toBeInstanceOf(SsrfError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects the IMDS host (169.254.169.254 is not allowlisted; also link-local)', async () => {
    await expect(
      assertSafePhotoSource('http://169.254.169.254/latest/meta-data/', {
        lookup: lookupPublic(),
      }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('matches the host case-insensitively and strips a trailing dot', async () => {
    const lookup = lookupPublic();
    await expect(
      assertSafePhotoSource('https://STATIC.INaturalist.org./photos/1/medium.jpg', { lookup }),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback v6', '::1'],
    ['private 10.x', '10.0.0.5'],
    ['private 172.16', '172.16.0.1'],
    ['private 192.168', '192.168.1.1'],
    ['link-local', '169.254.169.254'],
    ['unique-local v6', 'fd00::1'],
    ['unspecified', '0.0.0.0'],
  ])('rejects an allowlisted host that resolves to a %s address (%s)', async (_label, ip) => {
    const lookup = lookupFor([{ address: ip, family: ip.includes(':') ? 6 : 4 }]);
    await expect(
      assertSafePhotoSource('https://static.inaturalist.org/x.jpg', { lookup }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects when ANY of several resolved addresses is private (DNS round-robin)', async () => {
    const lookup = lookupFor([
      { address: '151.101.0.1', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);
    await expect(
      assertSafePhotoSource('https://static.inaturalist.org/x.jpg', { lookup }),
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects when DNS resolves to zero addresses', async () => {
    const lookup = lookupFor([]);
    await expect(
      assertSafePhotoSource('https://static.inaturalist.org/x.jpg', { lookup }),
    ).rejects.toBeInstanceOf(SsrfError);
  });
});
