import { createHash } from 'node:crypto';

/** Full lowercase hex SHA-256 of the given bytes. */
export function sha256hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * First 8 hex chars of the SHA-256 — the content-hash cache key here and
 * (Slice 7) the R2 object-key suffix `species/<code>.<sha8>.<ext>`. 32 bits;
 * key is always scoped per species, so a global collision is harmless.
 */
export function sha8(bytes: Buffer): string {
  return sha256hex(bytes).slice(0, 8);
}
