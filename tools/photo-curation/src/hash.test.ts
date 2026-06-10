import { describe, it, expect } from 'vitest';
import { sha256hex, sha8 } from './hash.js';

describe('hash', () => {
  it('sha256hex is deterministic and 64 hex chars', () => {
    const a = sha256hex(Buffer.from('bird'));
    const b = sha256hex(Buffer.from('bird'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sha8 is the first 8 hex chars of sha256', () => {
    const buf = Buffer.from('bird');
    expect(sha8(buf)).toBe(sha256hex(buf).slice(0, 8));
    expect(sha8(buf)).toMatch(/^[0-9a-f]{8}$/);
  });

  it('different bytes hash differently', () => {
    expect(sha8(Buffer.from('a'))).not.toBe(sha8(Buffer.from('b')));
  });
});
