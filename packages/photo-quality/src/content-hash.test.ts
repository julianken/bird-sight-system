import { describe, it, expect } from 'vitest';
import { contentHash, scoreCacheKey } from './content-hash.js';

describe('contentHash', () => {
  it('is the first 8 hex chars of sha256 of the bytes', () => {
    const h = contentHash(Buffer.from('hello'));
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(h).toBe('2cf24dba');
  });

  it('is stable and identical for identical bytes', () => {
    const a = contentHash(Buffer.from([1, 2, 3, 4]));
    const b = contentHash(Buffer.from([1, 2, 3, 4]));
    expect(a).toBe(b);
  });

  it('differs for different bytes', () => {
    expect(contentHash(Buffer.from('a'))).not.toBe(contentHash(Buffer.from('b')));
  });
});

describe('scoreCacheKey', () => {
  it('binds the hash to the rubric version so a tune invalidates the cache', () => {
    expect(scoreCacheKey('2cf24dba', '0.1.0')).toBe('2cf24dba@0.1.0');
    expect(scoreCacheKey('2cf24dba', '0.2.0')).not.toBe(scoreCacheKey('2cf24dba', '0.1.0'));
  });
});
