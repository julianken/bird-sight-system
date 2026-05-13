import { describe, it, expect } from 'vitest';
import { validateSvg, ValidationError } from './validate.js';

const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 22 L4 22 Z"/></svg>`;

describe('validateSvg', () => {
  it('accepts a minimal single-path 0..24 viewBox SVG', () => {
    const result = validateSvg(Buffer.from(VALID_SVG, 'utf8'));
    expect(result.pathD).toBe('M12 2 L20 22 L4 22 Z');
  });

  it('accepts a single-path SVG without an explicit viewBox', () => {
    const noViewBox = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1 L2 2"/></svg>`;
    const result = validateSvg(Buffer.from(noViewBox, 'utf8'));
    expect(result.pathD).toBe('M1 1 L2 2');
  });

  it('rejects an SVG with <script>', () => {
    const malicious = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(malicious, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with multiple <path> elements', () => {
    const multi = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/><path d="M2 2"/></svg>`;
    expect(() => validateSvg(Buffer.from(multi, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with <g>', () => {
    const grouped = `<svg xmlns="http://www.w3.org/2000/svg"><g><path d="M1 1"/></g></svg>`;
    expect(() => validateSvg(Buffer.from(grouped, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with an onload attribute', () => {
    const evil = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(evil, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with xlink:href', () => {
    const linked = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><path xlink:href="x" d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(linked, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an SVG with a non-{0 0 24 24} viewBox', () => {
    const wide = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(wide, 'utf8'))).toThrow(ValidationError);
  });

  it('accepts a single-quoted viewBox of 0 0 24 24', () => {
    const single = `<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 24 24'><path d="M1 1"/></svg>`;
    const result = validateSvg(Buffer.from(single, 'utf8'));
    expect(result.pathD).toBe('M1 1');
  });

  it('rejects a single-quoted viewBox of 0 0 100 100 (regex must not bypass quote-style)', () => {
    const single = `<svg xmlns="http://www.w3.org/2000/svg" viewBox='0 0 100 100'><path d="M1 1"/></svg>`;
    expect(() => validateSvg(Buffer.from(single, 'utf8'))).toThrow(ValidationError);
  });

  it('accepts a single-quoted d attribute on <path>', () => {
    const single = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d='M3 4 L5 6'/></svg>`;
    const result = validateSvg(Buffer.from(single, 'utf8'));
    expect(result.pathD).toBe('M3 4 L5 6');
  });

  it('rejects an SVG with no <path>', () => {
    const empty = `<svg xmlns="http://www.w3.org/2000/svg"/>`;
    expect(() => validateSvg(Buffer.from(empty, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects a path with an unsafe character in d (charset failure)', () => {
    const bad = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1<script>"/></svg>`;
    expect(() => validateSvg(Buffer.from(bad, 'utf8'))).toThrow(ValidationError);
  });

  it('rejects an oversize body (>64 KB)', () => {
    const big = Buffer.alloc(64 * 1024 + 1, 'x');
    expect(() => validateSvg(big)).toThrow(ValidationError);
  });

  it('rejects non-XML garbage', () => {
    expect(() => validateSvg(Buffer.from('not xml', 'utf8'))).toThrow(ValidationError);
  });
});
