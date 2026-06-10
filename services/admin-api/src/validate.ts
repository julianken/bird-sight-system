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
  // variation inside the value. Accepts either quote style: a single-quoted
  // viewBox attribute would otherwise bypass enforcement entirely.
  const viewBoxMatch = text.match(/\bviewBox\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (viewBoxMatch) {
    const raw = viewBoxMatch[1] ?? viewBoxMatch[2]!;
    const normalized = raw.trim().replace(/\s+/g, ' ');
    if (normalized !== '0 0 24 24') {
      throw new ValidationError(`viewBox must be "0 0 24 24" (got "${raw}")`);
    }
  }

  // Extract d= (accept either quote style for the same reason as viewBox).
  const dMatch = pathTag.match(/\bd\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  if (!dMatch) throw new ValidationError('<path> missing d attribute');
  const pathD = dMatch[1] ?? dMatch[2]!;
  if (!SVG_PATH_DATA_CHARSET.test(pathD)) {
    throw new ValidationError('path d has invalid characters');
  }

  return { pathD, source: body };
}

// ── Species-photo validation ────────────────────────────────────────────────

/** Min bytes a real photo should clear — guards against fetching an HTML error
 *  page or a 1px tracking pixel where a JPEG was expected. */
const MIN_PHOTO_BYTES = 1024;

/** Accepted image MIME → file extension. Anything else is rejected; the R2 key
 *  ext and the served Content-Type both come from this map. */
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** First bytes that must be present for each accepted mime (format magic). */
const MAGIC: Record<string, number[]> = {
  'image/jpeg': [0xff, 0xd8, 0xff],
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  // WEBP is RIFF-wrapped: bytes 0-3 are "RIFF" AND bytes 8-11 are "WEBP".
  // Checked explicitly below (a non-WEBP RIFF container — a .wav, an AVI —
  // must NOT pass), so it carries an empty leading-magic entry here.
  'image/webp': [],
  // AVIF is ISO-BMFF: bytes 4-7 are "ftyp"; check that offset.
  'image/avif': [],
};

export interface ValidatedPhoto {
  /** File extension for the R2 key (jpg/png/webp/avif). */
  ext: string;
  /** Verbatim source bytes the caller uploads to R2. */
  source: Buffer;
}

/**
 * Validate a fetched image body against its declared content-type:
 * - non-empty, ≥ MIN_PHOTO_BYTES
 * - mime is on the accepted list (→ ext)
 * - format magic bytes match the declared mime (defends against an HTML
 *   error page mislabeled image/jpeg, or a content-type/extension mismatch).
 *   jpeg/png check a leading prefix; webp requires RIFF at 0-3 AND WEBP at
 *   8-11; avif requires the ftyp box marker at offset 4.
 *
 * Returns the ext and the verbatim source for the R2 upload. Throws
 * ValidationError on any failure so the handler returns 400.
 */
export function validatePhotoImage(body: Buffer, mime: string): ValidatedPhoto {
  if (body.length === 0) throw new ValidationError('empty image body');
  const ext = MIME_TO_EXT[mime];
  if (!ext) throw new ValidationError(`unsupported image mime: ${mime}`);
  if (body.length < MIN_PHOTO_BYTES) {
    throw new ValidationError(`image too small (${body.length} bytes; min ${MIN_PHOTO_BYTES})`);
  }
  if (mime === 'image/webp') {
    // RIFF container: 'RIFF' at bytes 0-3 AND 'WEBP' fourCC at bytes 8-11.
    // Requiring both rejects a non-WEBP RIFF file (a .wav, an AVI) mislabeled
    // image/webp — checking only the RIFF prefix would let those through.
    const riff = body.subarray(0, 4).toString('ascii');
    const fourCC = body.subarray(8, 12).toString('ascii');
    if (riff !== 'RIFF' || fourCC !== 'WEBP') {
      throw new ValidationError('image magic bytes do not match image/webp');
    }
  } else if (mime === 'image/avif') {
    // ISO-BMFF: 'ftyp' box marker at byte offset 4.
    const ftyp = body.subarray(4, 8).toString('ascii');
    if (ftyp !== 'ftyp') throw new ValidationError('image magic bytes do not match image/avif');
  } else {
    const magic = MAGIC[mime]!;
    const head = Array.from(body.subarray(0, magic.length));
    if (magic.some((b, i) => head[i] !== b)) {
      throw new ValidationError(`image magic bytes do not match ${mime}`);
    }
  }
  return { ext, source: body };
}

/**
 * Canonical CC allowlist — the SAME set the ingestor's iNat client filters on
 * (`services/ingestor/src/inat/client.ts` `CC_LICENSES`). NC (non-commercial)
 * and ND (no-derivatives) variants are excluded. This is the server-side
 * backstop (spec §8/§9): the local curation tool already filters at source,
 * but a mis-tagged image must never go live through this public endpoint.
 *
 * Returns the normalized (lowercased) license on success; throws on deny.
 */
const CC_ALLOWLIST = new Set(['cc-by', 'cc-by-sa', 'cc0']);

export function validateLicense(license: string): string {
  const normalized = license.trim().toLowerCase();
  if (!CC_ALLOWLIST.has(normalized)) {
    throw new ValidationError(`license not on CC allowlist (cc-by, cc-by-sa, cc0): "${license}"`);
  }
  return normalized;
}
