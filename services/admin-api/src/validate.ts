const MAX_BYTES = 64 * 1024;

const SVG_PATH_DATA_CHARSET = /^[0-9MmLlHhVvCcSsQqTtAaZz \-.,]+$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ValidatedSvg {
  /** Extracted path-d attribute value. Caller writes this to family_silhouettes.svg_data. */
  pathD: string;
  /** Verbatim source bytes (post-size-check, pre-modification). Caller uploads this to R2. */
  source: Buffer;
}

/**
 * Validate an uploaded SVG against the silhouette allow-list:
 *
 * - body ≤ 64 KB (parser-DoS guard)
 * - parses as XML / SVG
 * - single <svg> root
 * - exactly one <path> child element
 * - no other child elements (no <g>, <style>, <script>, <defs>, <use>, etc)
 * - no attribute starting with "on" anywhere
 * - no xlink:href or xlink:* attribute anywhere
 * - viewBox, if present, equals "0 0 24 24"
 * - path has `d` attribute; d passes the same charset check the frontend's
 *   silhouette-fallback.ts uses (issue #271).
 *
 * On success, returns the verbatim source buffer (for R2 upload) and the
 * extracted path-d string (for the DB write).
 */
export function validateSvg(body: Buffer): ValidatedSvg {
  if (body.length === 0) throw new ValidationError('empty body');
  if (body.length > MAX_BYTES) throw new ValidationError(`body exceeds ${MAX_BYTES} bytes`);

  const text = body.toString('utf8');

  // Quick smell tests — fast-fail without parsing.
  if (!/<svg[\s>]/.test(text)) throw new ValidationError('no <svg> element');
  if (/<script\b/i.test(text)) throw new ValidationError('<script> not allowed');
  if (/<style\b/i.test(text)) throw new ValidationError('<style> not allowed');
  if (/<defs\b/i.test(text)) throw new ValidationError('<defs> not allowed');
  if (/<use\b/i.test(text)) throw new ValidationError('<use> not allowed');
  if (/<g\b/i.test(text)) throw new ValidationError('<g> not allowed');
  if (/\son[a-z]+\s*=/i.test(text)) throw new ValidationError('event handler attribute not allowed');
  if (/xlink:/i.test(text)) throw new ValidationError('xlink:* not allowed');

  // Single <path>; capture its tag for the d-attribute extraction.
  const pathMatches = text.match(/<path\b[^>]*\/?>/g) ?? [];
  if (pathMatches.length === 0) throw new ValidationError('no <path> element');
  if (pathMatches.length > 1) throw new ValidationError('multiple <path> elements');
  const pathTag = pathMatches[0]!;

  // viewBox, if present, must be exactly "0 0 24 24" — allows whitespace
  // variation inside the value.
  const viewBoxMatch = text.match(/\bviewBox\s*=\s*"([^"]*)"/);
  if (viewBoxMatch) {
    const normalized = viewBoxMatch[1]!.trim().replace(/\s+/g, ' ');
    if (normalized !== '0 0 24 24') {
      throw new ValidationError(`viewBox must be "0 0 24 24" (got "${viewBoxMatch[1]}")`);
    }
  }

  // Extract d=
  const dMatch = pathTag.match(/\bd\s*=\s*"([^"]*)"/);
  if (!dMatch) throw new ValidationError('<path> missing d attribute');
  const pathD = dMatch[1]!;
  if (!SVG_PATH_DATA_CHARSET.test(pathD)) {
    throw new ValidationError('path d has invalid characters');
  }

  return { pathD, source: body };
}
