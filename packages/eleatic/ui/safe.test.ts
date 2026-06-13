import { describe, it, expect, beforeEach } from 'vitest';
// safe.js is plain ESM with named exports, served verbatim to the browser by the
// eleatic server's express.static AND importable here in node. Unlike the
// photo-curation port it reads its image-host allowlist from /config.js at
// runtime (default: any https), so the test drives that configurator directly.
import { esc, safeImg, setImageHostAllowlist, PLACEHOLDER } from './safe.js';

describe('esc', () => {
  it('neutralizes an injected <img onerror> payload — no raw < > "', () => {
    const out = esc('"><img src=x onerror=alert(1)>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('"');
    // The dangerous characters survive only in their escaped form.
    expect(out).toContain('&lt;');
    expect(out).toContain('&gt;');
    expect(out).toContain('&quot;');
  });

  it('escapes & < > " and single quote', () => {
    expect(esc('Tom & Jerry')).toBe('Tom &amp; Jerry');
    expect(esc("O'Brien")).toBe('O&#39;Brien');
  });

  it('leaves benign text untouched and coerces non-strings', () => {
    expect(esc('© Jane Photographer')).toBe('© Jane Photographer');
    expect(esc(42)).toBe('42');
    expect(esc(null)).toBe('null');
  });
});

describe('safeImg — default (any-https) allowlist', () => {
  beforeEach(() => {
    // The config default the server emits when no allowlist is configured.
    setImageHostAllowlist(['https://*']);
  });

  it('accepts ANY https host under the any-https sentinel (not a hard-coded host set)', () => {
    for (const url of [
      'https://photos.bird-maps.com/x.webp',
      'https://example.com/photo.jpg',
      'https://cdn.some-other-eval.io/img.png',
    ]) {
      expect(safeImg(url)).toBe(url);
    }
  });

  it('rejects a javascript: URL → placeholder, even under any-https', () => {
    expect(safeImg('javascript:alert(1)')).toBe(PLACEHOLDER);
  });

  it('rejects a non-https (http:) URL → placeholder, even under any-https', () => {
    expect(safeImg('http://example.com/x.jpg')).toBe(PLACEHOLDER);
  });

  it('rejects an unparseable / empty / undefined value → placeholder', () => {
    expect(safeImg('not a url')).toBe(PLACEHOLDER);
    expect(safeImg('')).toBe(PLACEHOLDER);
    expect(safeImg(undefined)).toBe(PLACEHOLDER);
  });
});

describe('safeImg — explicit host allowlist (from config)', () => {
  beforeEach(() => {
    setImageHostAllowlist(['photos.bird-maps.com', 'upload.wikimedia.org']);
  });

  it('returns an allowlisted https host unchanged', () => {
    const url = 'https://photos.bird-maps.com/x.webp';
    expect(safeImg(url)).toBe(url);
  });

  it('accepts every configured host (case-insensitive)', () => {
    expect(safeImg('https://UPLOAD.WIKIMEDIA.ORG/photo.jpg')).toBe(
      'https://UPLOAD.WIKIMEDIA.ORG/photo.jpg',
    );
  });

  it('rejects an https URL on a non-allowlisted host → placeholder', () => {
    expect(safeImg('https://evil.example.com/x.jpg')).toBe(PLACEHOLDER);
  });

  it('still rejects non-https even when the host is allowlisted', () => {
    expect(safeImg('http://photos.bird-maps.com/x.jpg')).toBe(PLACEHOLDER);
  });
});

describe('safeImg — before any config is applied', () => {
  beforeEach(() => {
    // An empty allowlist (no setImageHostAllowlist call equivalent) is fail-closed:
    // nothing matches, so every URL falls back to the placeholder.
    setImageHostAllowlist([]);
  });

  it('an empty allowlist matches nothing → placeholder', () => {
    expect(safeImg('https://photos.bird-maps.com/x.webp')).toBe(PLACEHOLDER);
  });
});
