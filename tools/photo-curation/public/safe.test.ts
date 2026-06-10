import { describe, it, expect } from 'vitest';
// safe.js is plain ESM with named exports, served verbatim to the browser by the
// review server's express.static AND importable here in node.
import { esc, safeImg } from './safe.js';

const PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

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

describe('safeImg', () => {
  it('returns an allowlisted https photo-host URL unchanged', () => {
    const url = 'https://photos.bird-maps.com/x.webp';
    expect(safeImg(url)).toBe(url);
  });

  it('accepts every allowlisted host', () => {
    for (const host of [
      'photos.bird-maps.com',
      'static.inaturalist.org',
      'inaturalist-open-data.s3.amazonaws.com',
      'upload.wikimedia.org',
    ]) {
      const url = `https://${host}/photo.jpg`;
      expect(safeImg(url)).toBe(url);
    }
  });

  it('rejects a javascript: URL → placeholder', () => {
    expect(safeImg('javascript:alert(1)')).toBe(PLACEHOLDER);
  });

  it('rejects a non-https (http:) URL → placeholder', () => {
    expect(safeImg('http://evil/x.jpg')).toBe(PLACEHOLDER);
  });

  it('rejects an https URL on a non-allowlisted host → placeholder', () => {
    expect(safeImg('https://evil.example.com/x.jpg')).toBe(PLACEHOLDER);
  });

  it('rejects an unparseable / empty value → placeholder', () => {
    expect(safeImg('not a url')).toBe(PLACEHOLDER);
    expect(safeImg('')).toBe(PLACEHOLDER);
    expect(safeImg(undefined)).toBe(PLACEHOLDER);
  });
});
