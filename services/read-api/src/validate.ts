// Centralized query-param validators for /api/observations.
//
// Issue #667 — tighten filter allowlist + anti-scrape hardening.
//
// Each validator returns a discriminated-union result:
//   { ok: true, value: T }                  — accept, possibly coerced
//   { ok: false, error: string,             — reject; caller emits a structured
//     log: ValidationLog,                     400-telemetry log line and returns
//     status?: 400 }                          c.json({error}, 400) to the client
//
// Logging contract (Addendum #7): on every rejection emit a single line of
// JSON to stdout with the shape:
//
//   {severity: 'INFO', message: 'validation_400', param, received_hash, reason}
//
// Where `received_hash` is the first 8 hex chars of sha256(rawValue). Never
// log the raw value — scrapers and credential-leak probes both push payloads
// we don't want to retain in plaintext logs.

import { createHash } from 'node:crypto';

export type Since = '1d' | '7d' | '14d';

export interface ValidationLog {
  severity: 'INFO';
  message: 'validation_400';
  param: string;
  received_hash: string;
  reason:
    | 'regex_mismatch'
    | 'not_in_allowlist'
    | 'too_large'
    | 'missing_required'
    | 'out_of_range'
    | 'malformed';
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; log: ValidationLog };

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 8);
}

/**
 * Parses `?since=` with a soft-deprecation window for `30d`.
 *
 * Accepted: `'1d' | '7d' | '14d'` pass through; `'30d'` is accepted but
 * coerced to `'14d'` and the response should set Deprecation/Sunset/Warning
 * headers. The caller distinguishes the coerced case by checking `deprecated`.
 *
 * Returns `{ok:false}` only for values outside that set.
 */
export function parseSince(
  raw: string | undefined,
): Result<Since | undefined> & { deprecated?: boolean } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === '1d' || raw === '7d' || raw === '14d') {
    return { ok: true, value: raw };
  }
  if (raw === '30d') {
    // Soft-deprecation: coerce to 14d, signal upstream to emit headers + NOTICE log.
    return { ok: true, value: '14d', deprecated: true };
  }
  return {
    ok: false,
    error: 'invalid since',
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'since',
      received_hash: hash(raw),
      reason: 'not_in_allowlist',
    },
  };
}

/**
 * Parses `?notable=`. Must be exactly `'true'` or `'false'` (or absent).
 * `?notable=banana` returns 400. `?notable=` (empty) returns 400.
 */
export function parseNotable(
  raw: string | undefined,
): Result<boolean | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === 'true') return { ok: true, value: true };
  if (raw === 'false') return { ok: true, value: false };
  return {
    ok: false,
    error: 'invalid notable',
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'notable',
      received_hash: hash(raw),
      reason: 'not_in_allowlist',
    },
  };
}

// eBird species code shape. Real codes routinely end in disambiguator digits
// (`accipi1`, `tyrann1`) and unidentified-codes start with `x` + digits
// (`x00013`). Regex must accept those. 3-10 chars, starts with a letter,
// lowercase alphanumeric thereafter.
const SPECIES_RE = /^[a-z][a-z0-9]{2,9}$/;

export function parseSpecies(
  raw: string | undefined,
): Result<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (SPECIES_RE.test(raw)) return { ok: true, value: raw };
  return {
    ok: false,
    error: 'invalid species',
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'species',
      received_hash: hash(raw),
      reason: 'regex_mismatch',
    },
  };
}

// Family-code shape mirrors species: lowercase alphanumeric, slightly longer
// (4-12 chars). Real values look like `tyrannidae`, `trochilidae`, etc.
const FAMILY_RE = /^[a-z][a-z0-9]{3,11}$/;

export function parseFamily(
  raw: string | undefined,
): Result<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined };
  if (FAMILY_RE.test(raw)) return { ok: true, value: raw };
  return {
    ok: false,
    error: 'invalid family',
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'family',
      received_hash: hash(raw),
      reason: 'regex_mismatch',
    },
  };
}

/**
 * Per-axis bbox cap, applied only when `zoom >= 6` (per-observation mode).
 * At lower zooms the server uses aggregated mode so unbounded bboxes are fine.
 *
 * Caps: `maxLng - minLng <= 15` AND `maxLat - minLat <= 10`.
 *
 * Reject body is descriptive so the frontend can render an affordance:
 *   { error: 'bbox too large', maxLngSpan: 15, maxLatSpan: 10,
 *     hint: 'zoom out for aggregated view' }
 */
export interface BboxTooLargeBody {
  error: 'bbox too large';
  maxLngSpan: 15;
  maxLatSpan: 10;
  hint: 'zoom out for aggregated view';
}

export function assertBboxAreaCap(
  bbox: [number, number, number, number],
  zoom: number | undefined,
):
  | { ok: true }
  | { ok: false; body: BboxTooLargeBody; log: ValidationLog } {
  if (zoom === undefined || zoom < 6) return { ok: true };
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const lngSpan = maxLng - minLng;
  const latSpan = maxLat - minLat;
  if (lngSpan <= 15 && latSpan <= 10) return { ok: true };
  return {
    ok: false,
    body: {
      error: 'bbox too large',
      maxLngSpan: 15,
      maxLatSpan: 10,
      hint: 'zoom out for aggregated view',
    },
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'bbox_too_large',
      received_hash: hash(`${lngSpan.toFixed(2)},${latSpan.toFixed(2)}`),
      reason: 'too_large',
    },
  };
}

/**
 * Per-observation requests must specify EITHER a bbox OR a species code.
 * Family-only (no bbox, no species) is the scrape vector for "all of family X
 * nationally" — reject with 400.
 *
 * This guard applies only when the request will hit the per-observation path:
 * aggregated mode (bbox present + zoom < 6) is already cheap.
 */
export function assertBboxOrSpecies(args: {
  bbox: [number, number, number, number] | undefined;
  speciesCode: string | undefined;
}):
  | { ok: true }
  | { ok: false; error: string; log: ValidationLog } {
  if (args.bbox !== undefined || args.speciesCode !== undefined) return { ok: true };
  return {
    ok: false,
    error: 'specify bbox or species',
    log: {
      severity: 'INFO',
      message: 'validation_400',
      param: 'bbox_required',
      received_hash: hash(''),
      reason: 'missing_required',
    },
  };
}
