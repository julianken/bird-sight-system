import { createHash } from 'node:crypto';

/**
 * Canonical content hash for an image: the first 8 hex chars of sha256 of the
 * raw bytes. Matches the `sha8` convention the admin-api uses for R2 keys
 * (species/<code>.<sha8>.<ext>), so the curation tool, the admin endpoint, and
 * the score cache all derive the same identity from the same bytes.
 */
export function contentHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 8);
}

/**
 * Cache key for a scoring report: the content hash bound to the rubric version.
 * Bumping rubric.version therefore invalidates every cached score without
 * re-hashing the images — a re-tune re-scores, an unchanged image+rubric is a
 * cache hit (the cost-control invariant from spec §5.1).
 */
export function scoreCacheKey(hash: string, rubricVersion: string): string {
  return `${hash}@${rubricVersion}`;
}
