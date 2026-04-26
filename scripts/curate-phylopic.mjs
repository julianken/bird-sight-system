#!/usr/bin/env node
/**
 * scripts/curate-phylopic.mjs — Issue #245 (epic #251), retry hardening #267.
 *
 * Curates real CC-licensed Phylopic silhouettes for every AZ bird family
 * seeded in `family_silhouettes` and emits a SQL UPDATE migration that swaps
 * the placeholder geometric SVGs (from #244 + the original 9000 seed) for
 * real path data with full provenance (source URL, license, creator).
 *
 * Two-step Phylopic API recipe (per https://www.phylopic.org/articles/api-recipes):
 *   A. GET https://api.phylopic.org/nodes?build=537&filter_name=<lowercase>&page=0
 *      → resolves the taxonomic node UUID for the family.
 *   B. GET https://api.phylopic.org/images?build=537&filter_node=<uuid>&page=0&embed_items=true
 *      → enumerates images attached to that node, with embedded license
 *        and contributor metadata.
 *   C. For each candidate, GET `_links.vectorFile.href` to download the
 *      auto-generated SVG, then extract the single `<path d="...">`.
 *
 * Auto-pick heuristic (substituted for the issue body's human picker so this
 * subagent can ship without a UI loop):
 *   1. License preference: CC0-1.0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0.
 *   2. Tie-break on image-page popularity if the API surfaces it (it does
 *      not in `/images?embed_items=true`, so this rarely fires); fall back
 *      to alphabetical creator name for determinism.
 *   3. Reject candidates whose SVG either lacks a `<path d="...">` or wraps
 *      the path in a `<g transform=...>` we can't safely flatten — log the
 *      skip and try the next candidate.
 *
 * Error handling (issue #267 follow-up):
 *   - HTTP 404 on `/nodes?filter_name=<family>`: classified as GENUINELY
 *     ABSENT (family not in Phylopic's taxonomic tree, or the slug we
 *     submitted does not match Phylopic's spelling). NOT retried. Logged
 *     explicitly and the family is treated as "no Phylopic entry" (NULL row).
 *   - HTTP 5xx OR network error on any endpoint: retried up to 3 times with
 *     exponential backoff (1s → 2s → 4s sleeps). On exhausted retries the
 *     entire run ABORTS with a non-zero exit listing every failed family —
 *     so a transient API outage never silently produces a NULL UPDATE that
 *     looks like a permanent absence. Operator can re-run later.
 *   - HTTP 429 is handled separately by `rateLimitedFetch` (per-request
 *     backoff up to 60s, no abort) since it is rate-limit pressure, not
 *     genuine failure.
 *   - `phylopic-picks.json` carries a top-level `skipFamilies: string[]`
 *     field. Families listed there are NOT queried — the script logs
 *     "skipping (operator-flagged absent)" and emits a NULL UPDATE with a
 *     migration comment naming each skipped family. This separates "API
 *     failed" from "operator confirmed no usable Phylopic exists" so the
 *     resulting migration is honest about which case applies.
 *
 * Outputs (committed, both reproducible from the same Phylopic API state):
 *   - `scripts/phylopic-picks.json` — full candidate list per family + the
 *     chosen one + the heuristic that picked it. Audit trail for the
 *     human verifier (post-deploy review). Top-level `skipFamilies` lets
 *     operators flag families with no usable Phylopic entry.
 *   - `migrations/1700000017000_seed_family_silhouettes_phylopic.sql`
 *     — UPDATE per family with the chosen path d, source URL, license short
 *     identifier, creator name. Families with zero usable candidates get an
 *     UPDATE that NULLs svg_data/source/license/creator together so the
 *     _FALLBACK consumer (from #246) renders gracefully.
 *
 * Cache: writes API responses + downloaded SVGs to `scripts/.phylopic-cache/`
 * (gitignored) so re-runs are deterministic and don't re-hit Phylopic's API.
 * Rate-limit: 1 req/sec with exponential backoff on 429 (Phylopic's CDN is
 * fronted by CloudFront with `max-age=300, stale-while-revalidate=86400`).
 *
 * Usage:
 *   node scripts/curate-phylopic.mjs           # use cache if present
 *   node scripts/curate-phylopic.mjs --refresh # bypass cache, re-fetch all
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.phylopic-cache');
const PICKS_PATH = resolve(__dirname, 'phylopic-picks.json');
const MIGRATION_PATH = resolve(REPO_ROOT, 'migrations/1700000017000_seed_family_silhouettes_phylopic.sql');

const PHYLOPIC_API = 'https://api.phylopic.org';
const PHYLOPIC_BUILD = '537';
const PHYLOPIC_WEB = 'https://www.phylopic.org';

const REFRESH = process.argv.includes('--refresh');

// All 25 families seeded across migrations 9000 + 15000. Preserve exact
// family_code casing from the seed migrations — Phylopic's filter_name is
// case-insensitive but we use the lowercase form since that matches the
// taxonomic convention.
const FAMILIES = [
  // migration 9000 (#55 option-(a))
  'accipitridae', 'anatidae', 'ardeidae', 'cathartidae', 'corvidae',
  'cuculidae', 'odontophoridae', 'passerellidae', 'picidae', 'scolopacidae',
  'strigidae', 'trochilidae', 'troglodytidae', 'trogonidae', 'tyrannidae',
  // migration 15000 (issue #244 expansion)
  'cardinalidae', 'mimidae', 'columbidae', 'parulidae', 'ptilogonatidae',
  'paridae', 'fringillidae', 'caprimulgidae', 'remizidae', 'threskiornithidae',
];

// Short identifier mapping per the Phylopic license URL convention. Phylopic
// surfaces `_links.license.href` like `https://creativecommons.org/publicdomain/zero/1.0/`
// or `https://creativecommons.org/licenses/by/3.0/`. We normalize to the
// short identifiers the AttributionModal (#250) maps to display strings.
const LICENSE_URL_TO_ID = {
  'https://creativecommons.org/publicdomain/zero/1.0/': 'CC0-1.0',
  'https://creativecommons.org/licenses/by/3.0/':       'CC-BY-3.0',
  'https://creativecommons.org/licenses/by/4.0/':       'CC-BY-4.0',
  'https://creativecommons.org/licenses/by-sa/3.0/':    'CC-BY-SA-3.0',
};
// Lower number = more preferred. Anything outside the table is rejected.
const LICENSE_PREFERENCE = {
  'CC0-1.0':     0,
  'CC-BY-3.0':   1,
  'CC-BY-4.0':   2,
  'CC-BY-SA-3.0': 3,
};

mkdirSync(CACHE_DIR, { recursive: true });

// --- Retry policy (issue #267) ------------------------------------------------
// 5xx + network errors get 3 retries with 1s/2s/4s sleeps. 404s do NOT retry —
// they signal a genuine taxonomic absence, not a transient failure.
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = [1000, 2000, 4000];

class HttpError extends Error {
  constructor(url, status) {
    super(`GET ${url} → ${status}`);
    this.name = 'HttpError';
    this.url = url;
    this.status = status;
  }
}

class NetworkError extends Error {
  constructor(url, cause) {
    super(`GET ${url} → network error: ${cause?.message ?? cause}`);
    this.name = 'NetworkError';
    this.url = url;
    this.cause = cause;
  }
}

let lastFetchAt = 0;
async function rateLimitedFetch(url, init) {
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < 1000) {
    await new Promise(r => setTimeout(r, 1000 - elapsed));
  }
  lastFetchAt = Date.now();
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.status === 429) {
      attempt++;
      const wait = Math.min(60_000, 1000 * 2 ** attempt);
      console.warn(`[rate-limit] ${url} got 429, sleeping ${wait}ms (attempt ${attempt})`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    return res;
  }
}

/**
 * Wrap a fetch attempt with retry policy. 404 short-circuits as HttpError;
 * 5xx and network errors retry with 1s/2s/4s backoff and surface as
 * HttpError / NetworkError after the third failure. Caller decides what to
 * do — `getJson` lets HttpError(404) propagate so per-family logic can log
 * "genuine absence" while letting 5xx / NetworkError abort the whole run.
 */
async function fetchWithRetry(url, init) {
  let lastErr = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await rateLimitedFetch(url, init);
      if (res.ok) return res;
      // 404 is an expected per-family signal; do not retry.
      if (res.status === 404) {
        throw new HttpError(url, 404);
      }
      // 5xx → retry. 4xx other than 404 → also retry once (some Phylopic
      // 4xx responses are transient WAF rejections), but cap at MAX_RETRIES.
      lastErr = new HttpError(url, res.status);
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_MS[attempt];
        console.warn(`[retry] ${url} → ${res.status}, sleeping ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw lastErr;
    } catch (err) {
      // 404 already thrown above — re-throw without retry.
      if (err instanceof HttpError && err.status === 404) throw err;
      // HttpError with retried-and-exhausted status: re-throw on the final
      // iteration so the caller sees the real status code.
      if (err instanceof HttpError && attempt >= MAX_RETRIES) throw err;
      if (err instanceof HttpError) {
        // Already counted toward attempt; loop will sleep + retry above. We
        // shouldn't reach here because the inline retry block already slept,
        // but guard anyway.
        continue;
      }
      // Network error (DNS, connect refused, socket hangup, etc).
      lastErr = new NetworkError(url, err);
      if (attempt < MAX_RETRIES) {
        const wait = RETRY_BACKOFF_MS[attempt];
        console.warn(`[retry] ${url} → network error (${err?.message ?? err}), sleeping ${wait}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw lastErr;
    }
  }
  // Unreachable, but keep TypeScript-style exhaustiveness honest.
  throw lastErr ?? new Error(`fetchWithRetry exhausted with no error for ${url}`);
}

function cachePathFor(url) {
  // Stable, filename-safe key from the URL.
  const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 200);
  return resolve(CACHE_DIR, `${safe}.json`);
}

function svgCachePathFor(url) {
  const safe = url.replace(/[^a-z0-9]+/gi, '_').slice(0, 200);
  return resolve(CACHE_DIR, `${safe}.svg`);
}

async function getJson(url) {
  const cachePath = cachePathFor(url);
  if (!REFRESH && existsSync(cachePath)) {
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }
  const res = await fetchWithRetry(url, { headers: { Accept: 'application/vnd.phylopic.v2+json' } });
  const json = await res.json();
  writeFileSync(cachePath, JSON.stringify(json, null, 2));
  return json;
}

async function getSvg(url) {
  const cachePath = svgCachePathFor(url);
  if (!REFRESH && existsSync(cachePath)) {
    return readFileSync(cachePath, 'utf-8');
  }
  const res = await fetchWithRetry(url);
  const text = await res.text();
  writeFileSync(cachePath, text);
  return text;
}

/**
 * Find the taxonomic node UUID for a family name via /nodes?filter_name=...
 * Returns the UUID string or null if no exact match.
 *
 * Throws HttpError(404) when Phylopic returns 404 (genuine absence — caller
 * logs and continues with NULL row). Throws HttpError(5xx) / NetworkError
 * after 3 retries — caller aborts the run.
 */
async function lookupNodeUuid(familyName) {
  const url = `${PHYLOPIC_API}/nodes?build=${PHYLOPIC_BUILD}&filter_name=${encodeURIComponent(familyName)}&page=0`;
  const json = await getJson(url);
  // The API returns a paged list at _embedded.items where each item has a
  // _links.self.href like /nodes/<uuid>. Pick the first item whose
  // names[0].juvenile is the family name (case-insensitive). If absent,
  // accept the first item — Phylopic's filter_name is already a name match.
  const items = json?._links?.items ?? json?._embedded?.items ?? [];
  if (items.length === 0) return null;
  // Items in /nodes?filter_name response are link summaries with .href; we
  // need to follow into each to verify, but for performance we accept the
  // first one — Phylopic's filter_name is a strict name match.
  const first = items[0];
  const href = first?.href ?? first?._links?.self?.href ?? '';
  const match = href.match(/\/nodes\/([0-9a-f-]{36})/i);
  return match ? match[1] : null;
}

/**
 * Enumerate Phylopic image candidates attached to a node via
 * /images?filter_node=<uuid>&embed_items=true. Returns an array of
 * normalized candidate descriptors:
 *   { uuid, vectorFileUrl, sourceFileUrl, licenseUrl, licenseId, creatorName,
 *     imagePageUrl, slug }
 */
async function enumerateCandidates(nodeUuid) {
  const url = `${PHYLOPIC_API}/images?build=${PHYLOPIC_BUILD}&filter_node=${nodeUuid}&page=0&embed_items=true`;
  const json = await getJson(url);
  const items = json?._embedded?.items ?? [];
  const candidates = [];
  for (const item of items) {
    const links = item?._links ?? {};
    const vectorFile = links?.vectorFile?.href ?? null;
    const sourceFile = links?.sourceFile?.href ?? null;
    if (!vectorFile) continue; // strictly require the auto-gen SVG
    const selfHref = links?.self?.href ?? '';
    const uuidMatch = selfHref.match(/\/images\/([0-9a-f-]{36})/i);
    const uuid = uuidMatch ? uuidMatch[1] : null;
    const licenseUrl = links?.license?.href ?? null;
    const licenseId = licenseUrl ? (LICENSE_URL_TO_ID[licenseUrl] ?? null) : null;
    if (!licenseId) continue; // license outside our accepted set → reject
    // Contributor name — embedded under _embedded.contributor.name when
    // embed_items=true, or contributorName at the item root.
    const creatorName =
      item?._embedded?.contributor?.name ??
      item?.attribution ??
      null;
    // The user-facing image page URL pattern is /images/<uuid>/<slug>.
    // Slug isn't surfaced reliably via the API; fall back to <uuid> alone
    // (the Phylopic web app accepts /images/<uuid> and 301s to the slug).
    const imagePageUrl = uuid ? `${PHYLOPIC_WEB}/images/${uuid}` : null;
    candidates.push({
      uuid,
      vectorFileUrl: vectorFile,
      sourceFileUrl: sourceFile,
      licenseUrl,
      licenseId,
      creatorName,
      imagePageUrl,
    });
  }
  return candidates;
}

/**
 * Parse the SVG `viewBox` attribute → [minX, minY, w, h] or null.
 */
function parseViewBox(svgText) {
  const m = svgText.match(/viewBox="([^"]+)"/);
  if (!m) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  return parts;
}

/**
 * Parse the standard Phylopic potrace `<g transform="translate(tx,ty) scale(sx,sy)">`
 * → { tx, ty, sx, sy } or null when no g-transform is present (some Phylopic
 * vectors are already in the small viewBox space — those just need
 * normalization).
 */
function parseGTransform(svgText) {
  // Match <g ... transform="translate(tx, ty) scale(sx, sy)">
  const m = svgText.match(/<g[^>]*\stransform="translate\(\s*([-0-9.eE]+)\s*,?\s*([-0-9.eE]+)\s*\)\s*scale\(\s*([-0-9.eE]+)\s*,?\s*([-0-9.eE]+)\s*\)"/);
  if (!m) return null;
  return { tx: +m[1], ty: +m[2], sx: +m[3], sy: +m[4] };
}

/**
 * Walk an SVG path-d string, applying a translate+scale transform to bake it
 * into absolute coords, then optionally normalize the result to a target
 * viewBox. Handles M/m L/l H/h V/v C/c S/s Q/q T/t A/a Z/z commands.
 *
 * Coord-pair mapping (transform = T_translate * T_scale):
 *   absolute (X, Y) → (X*sx + tx, Y*sy + ty)
 *   relative (dx, dy) → (dx*sx, dy*sy) — translation does not apply to deltas
 *
 * The arc 'A' command's rx, ry, x-axis-rotation, large-arc, sweep require
 * special handling: rx/ry scale by |sx|/|sy| respectively, sweep flag flips
 * if sx*sy < 0, x-axis-rotation flips sign. Since Phylopic potrace SVGs do
 * not emit arcs (potrace produces M, L, C, Z only), arcs are handled
 * defensively but we expect to never see them.
 */
function transformPathD(d, tf) {
  if (!tf) return d;
  const { tx, ty, sx, sy } = tf;

  // Tokenize: split on command letters keeping them; collect numbers.
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ kind: 'cmd', v: m[1] });
    else tokens.push({ kind: 'num', v: parseFloat(m[2]) });
  }

  // Walk tokens with current command + nums queue.
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].kind !== 'cmd') {
      throw new Error(`expected command at token ${i}: ${JSON.stringify(tokens[i])}`);
    }
    const cmd = tokens[i].v;
    i++;
    const isAbs = cmd === cmd.toUpperCase();
    const upper = cmd.toUpperCase();
    out.push(cmd);
    // Determine arity per command.
    const arity = ({
      M: 2, L: 2, H: 1, V: 1,
      C: 6, S: 4, Q: 4, T: 2,
      A: 7, Z: 0,
    })[upper];
    if (arity === undefined) throw new Error(`unsupported command: ${cmd}`);
    // Special: M followed by extra coord pairs are implicit L (or l for relative).
    let firstRun = true;
    do {
      // Read `arity` numbers.
      const nums = [];
      for (let k = 0; k < arity; k++) {
        if (i >= tokens.length || tokens[i].kind !== 'num') {
          throw new Error(`expected number after ${cmd}`);
        }
        nums.push(tokens[i].v);
        i++;
      }
      // Apply transform per command.
      const mapXY = (x, y) => isAbs ? [x * sx + tx, y * sy + ty] : [x * sx, y * sy];
      let mapped;
      switch (upper) {
        case 'M':
        case 'L':
        case 'T': {
          const [x, y] = mapXY(nums[0], nums[1]);
          mapped = [x, y];
          break;
        }
        case 'H': {
          // Horizontal line: x only. For absolute, apply sx * x + tx;
          // for relative, sx * dx.
          const x = isAbs ? nums[0] * sx + tx : nums[0] * sx;
          mapped = [x];
          break;
        }
        case 'V': {
          const y = isAbs ? nums[0] * sy + ty : nums[0] * sy;
          mapped = [y];
          break;
        }
        case 'C': {
          const [x1, y1] = mapXY(nums[0], nums[1]);
          const [x2, y2] = mapXY(nums[2], nums[3]);
          const [x, y]   = mapXY(nums[4], nums[5]);
          mapped = [x1, y1, x2, y2, x, y];
          break;
        }
        case 'S':
        case 'Q': {
          const [x1, y1] = mapXY(nums[0], nums[1]);
          const [x, y]   = mapXY(nums[2], nums[3]);
          mapped = [x1, y1, x, y];
          break;
        }
        case 'A': {
          // rx, ry, x-rot, large-arc, sweep, x, y
          const rx = nums[0] * Math.abs(sx);
          const ry = nums[1] * Math.abs(sy);
          const rot = nums[2] * (sx * sy < 0 ? -1 : 1);
          const large = nums[3];
          const sweep = sx * sy < 0 ? (nums[4] === 0 ? 1 : 0) : nums[4];
          const [x, y] = mapXY(nums[5], nums[6]);
          mapped = [rx, ry, rot, large, sweep, x, y];
          break;
        }
        case 'Z':
          mapped = [];
          break;
        default:
          throw new Error(`unhandled command: ${cmd}`);
      }
      out.push(mapped.map(n => +n.toFixed(3)).join(' '));
      firstRun = false;
      // Continue absorbing implicit-repeat numbers for this command.
    } while (
      arity > 0
      && i < tokens.length
      && tokens[i].kind === 'num'
    );
    void firstRun;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Walk a path-d (already in a known coordinate system) and return its bbox
 * for normalization. Naive: for each coord pair we just track min/max,
 * including curve control points (close enough for our 0..24 normalization).
 */
function pathBBox(d) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let curX = 0, curY = 0, startX = 0, startY = 0;
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.\d+|\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ kind: 'cmd', v: m[1] });
    else tokens.push({ kind: 'num', v: parseFloat(m[2]) });
  }
  let i = 0;
  while (i < tokens.length) {
    const cmd = tokens[i].v;
    i++;
    const isAbs = cmd === cmd.toUpperCase();
    const upper = cmd.toUpperCase();
    const arity = ({ M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 })[upper];
    do {
      const nums = [];
      for (let k = 0; k < arity; k++) {
        if (i >= tokens.length || tokens[i].kind !== 'num') break;
        nums.push(tokens[i].v);
        i++;
      }
      if (nums.length !== arity) break;
      let pts = [];
      switch (upper) {
        case 'M':
          curX = isAbs ? nums[0] : curX + nums[0];
          curY = isAbs ? nums[1] : curY + nums[1];
          startX = curX; startY = curY;
          pts = [[curX, curY]];
          break;
        case 'L':
        case 'T':
          curX = isAbs ? nums[0] : curX + nums[0];
          curY = isAbs ? nums[1] : curY + nums[1];
          pts = [[curX, curY]];
          break;
        case 'H':
          curX = isAbs ? nums[0] : curX + nums[0];
          pts = [[curX, curY]];
          break;
        case 'V':
          curY = isAbs ? nums[0] : curY + nums[0];
          pts = [[curX, curY]];
          break;
        case 'C': {
          const x1 = isAbs ? nums[0] : curX + nums[0];
          const y1 = isAbs ? nums[1] : curY + nums[1];
          const x2 = isAbs ? nums[2] : curX + nums[2];
          const y2 = isAbs ? nums[3] : curY + nums[3];
          const x  = isAbs ? nums[4] : curX + nums[4];
          const y  = isAbs ? nums[5] : curY + nums[5];
          pts = [[x1, y1], [x2, y2], [x, y]];
          curX = x; curY = y;
          break;
        }
        case 'S':
        case 'Q': {
          const x1 = isAbs ? nums[0] : curX + nums[0];
          const y1 = isAbs ? nums[1] : curY + nums[1];
          const x  = isAbs ? nums[2] : curX + nums[2];
          const y  = isAbs ? nums[3] : curY + nums[3];
          pts = [[x1, y1], [x, y]];
          curX = x; curY = y;
          break;
        }
        case 'A': {
          const x = isAbs ? nums[5] : curX + nums[5];
          const y = isAbs ? nums[6] : curY + nums[6];
          pts = [[x, y]];
          curX = x; curY = y;
          break;
        }
        case 'Z':
          curX = startX; curY = startY;
          pts = [];
          break;
      }
      for (const [px, py] of pts) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    } while (arity > 0 && i < tokens.length && tokens[i].kind === 'num');
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Normalize a path-d's coordinate system into a target viewBox `0..target`
 * square, preserving aspect ratio (centers in the dimension with extra room).
 */
function normalizePath(d, target) {
  const bb = pathBBox(d);
  if (!isFinite(bb.minX)) return d; // empty path; bail
  const w = bb.maxX - bb.minX;
  const h = bb.maxY - bb.minY;
  const scale = Math.min(target / w, target / h);
  // Center the bbox after scaling.
  const offsetX = (target - w * scale) / 2 - bb.minX * scale;
  const offsetY = (target - h * scale) / 2 - bb.minY * scale;
  return transformPathD(d, { tx: offsetX, ty: offsetY, sx: scale, sy: scale });
}

/**
 * Extract a single path-d string from a Phylopic SVG, applying the standard
 * potrace `<g transform="translate(0,H) scale(0.1,-0.1)">` flattening, then
 * normalizing the result into a 0..24 viewBox so that the consumer
 * (FamilyLegend `viewBox="0 0 24 24"`) renders the silhouette at full tile
 * size with `preserveAspectRatio="xMidYMid meet"` correctness.
 *
 *  - Reject when there's no `<path d="...">`.
 *  - When no `<g transform>` is present, the path is assumed already in
 *    the source viewBox space and only normalization is applied.
 *  - When a `<g transform>` is present but is not the standard
 *    translate-then-scale shape, reject (we don't bake arbitrary transforms).
 */
function extractPathD(svgText) {
  // Find the path element. Phylopic SVGs typically have a single path; if
  // there are multiple, we take the first (potrace usually emits one).
  const pathMatch = svgText.match(/<path[^>]*\sd="([^"]+)"/);
  if (!pathMatch) return { ok: false, reason: 'no-path-d' };
  const rawD = pathMatch[1];

  const hasGTransform = /<g[^>]*\stransform=/i.test(svgText);
  const tf = hasGTransform ? parseGTransform(svgText) : null;
  if (hasGTransform && !tf) {
    return { ok: false, reason: 'g-transform-non-standard' };
  }
  let flattened;
  try {
    flattened = transformPathD(rawD, tf);
  } catch (err) {
    return { ok: false, reason: `path-parse-error: ${err.message}` };
  }
  let normalized;
  try {
    normalized = normalizePath(flattened, 24);
  } catch (err) {
    return { ok: false, reason: `normalize-error: ${err.message}` };
  }
  return { ok: true, d: normalized };
}

/**
 * Apply the auto-pick heuristic over a candidate list. Returns
 * { chosen, reason, considered } where `considered` lists each candidate's
 * (license, creator, vectorFileUrl, status, [skipReason]).
 */
function autoPick(candidates) {
  // Sort by: license preference asc, then creator name asc (case-insensitive),
  // then UUID asc for total determinism.
  const sorted = [...candidates].sort((a, b) => {
    const ap = LICENSE_PREFERENCE[a.licenseId] ?? 99;
    const bp = LICENSE_PREFERENCE[b.licenseId] ?? 99;
    if (ap !== bp) return ap - bp;
    const ac = (a.creatorName ?? 'zzz').toLowerCase();
    const bc = (b.creatorName ?? 'zzz').toLowerCase();
    if (ac !== bc) return ac < bc ? -1 : 1;
    return (a.uuid ?? '').localeCompare(b.uuid ?? '');
  });
  return sorted;
}

function escapeSqlString(s) {
  return s.replace(/'/g, "''");
}

/**
 * Today's UTC date as YYYY-MM-DD for the migration comment header.
 */
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Per-family curation. Returns one of:
 *   { kind: 'picked', family, picked, considered, reason }
 *   { kind: 'absent', family, reason }              — 404 or no candidates
 *   { kind: 'failed', family, reason, error }       — retries exhausted; main()
 *                                                     aggregates these and aborts
 *
 * Note: previously this function caught all errors and emitted a NULL UPDATE
 * regardless of cause, conflating "Phylopic doesn't have it" with "API was
 * down". Issue #267 fixed that — only HTTP 404 (genuine absence) collapses
 * silently into the NULL row; HTTP 5xx and network errors now bubble up so
 * main() can refuse to write a misleading migration.
 */
async function curateFamily(family) {
  console.log(`\n[${family}] resolving node...`);
  let nodeUuid;
  try {
    nodeUuid = await lookupNodeUuid(family);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`[${family}] HTTP 404 from Phylopic /nodes — family genuinely absent (or wrong slug); emitting NULL row`);
      return { kind: 'absent', family, picked: null, considered: [], reason: 'http-404-on-nodes' };
    }
    // 5xx or network error after 3 retries — surface to main() for abort.
    return { kind: 'failed', family, picked: null, considered: [], reason: `lookup-failed: ${err.message}`, error: err };
  }
  if (!nodeUuid) {
    console.warn(`[${family}] no taxonomic node found (empty items list) → NULL row`);
    return { kind: 'absent', family, picked: null, considered: [], reason: 'no-node' };
  }
  console.log(`[${family}] node ${nodeUuid}, enumerating images...`);
  let candidates;
  try {
    candidates = await enumerateCandidates(nodeUuid);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`[${family}] HTTP 404 from Phylopic /images — node has no images attached; emitting NULL row`);
      return { kind: 'absent', family, picked: null, considered: [], reason: 'http-404-on-images' };
    }
    return { kind: 'failed', family, picked: null, considered: [], reason: `images-failed: ${err.message}`, error: err };
  }
  if (candidates.length === 0) {
    console.warn(`[${family}] zero candidates with vectorFile + accepted license → NULL row`);
    return { kind: 'absent', family, picked: null, considered: [], reason: 'no-candidates' };
  }
  const sorted = autoPick(candidates);
  // Walk the sorted list, attempting SVG extraction until one succeeds.
  const considered = [];
  for (const cand of sorted) {
    let svg;
    try {
      svg = await getSvg(cand.vectorFileUrl);
    } catch (err) {
      // SVG fetch failures are per-candidate, not per-family — only abort
      // the run if every candidate failed AND the failures were transient.
      // For simplicity, treat any HttpError/NetworkError on a single SVG as
      // a candidate skip (log it and try the next). If all SVGs fail this
      // way the family falls into the all-rejected NULL row branch.
      considered.push({ ...cand, status: 'svg-fetch-failed', skipReason: err.message });
      continue;
    }
    const extracted = extractPathD(svg);
    if (!extracted.ok) {
      considered.push({ ...cand, status: 'rejected', skipReason: extracted.reason });
      continue;
    }
    considered.push({ ...cand, status: 'picked', svgPathD: extracted.d });
    return {
      kind: 'picked',
      family,
      picked: { ...cand, svgPathD: extracted.d },
      considered: considered.concat(
        sorted.slice(considered.length).map(c => ({ ...c, status: 'not-tried' }))
      ),
      reason: `picked-by-license-${cand.licenseId}`,
    };
  }
  console.warn(`[${family}] all ${candidates.length} candidates rejected → NULL row`);
  return { kind: 'absent', family, picked: null, considered, reason: 'all-rejected' };
}

function emitMigrationSql(picks, skipFamilies) {
  const today = todayUtc();
  const lines = [];
  lines.push('-- Up Migration');
  lines.push('-- Issue #245 (epic #251). Replaces the placeholder geometric SVGs from');
  lines.push(`-- migrations 9000 + 15000 with real CC-licensed Phylopic silhouettes for`);
  lines.push('-- every seeded AZ bird family. Generated by scripts/curate-phylopic.mjs');
  lines.push(`-- on ${today} (curator run date) using the Phylopic API two-step recipe`);
  lines.push('-- (/nodes?filter_name → /images?filter_node) and an auto-pick heuristic');
  lines.push('-- (license preference CC0 > CC-BY > CC-BY-SA, then alphabetic creator).');
  lines.push('--');
  lines.push('-- The SVG path data is stored unmodified — per CC BY-SA 3.0 §1, serving');
  lines.push('-- the exact SVG bytes through the API does NOT trigger share-alike on the');
  lines.push('-- rest of the codebase (Adaptation vs Collection distinction). Per-row');
  lines.push('-- attribution (creator + license URL) is rendered by the AttributionModal');
  lines.push('-- (#250). The full audit trail (every candidate the heuristic considered,');
  lines.push('-- per family) lives at scripts/phylopic-picks.json.');
  lines.push('--');
  lines.push('-- Picks were auto-selected by heuristic, NOT human-curated. The picker');
  lines.push('-- HTML at scripts/curate-phylopic-review.html supports a manual visual');
  lines.push('-- pass at 24-28px (FamilyLegend / MapCanvas symbol layer scales) before');
  lines.push('-- the version-one → main release.');
  lines.push('--');
  lines.push('-- Slot ordering: this seed migration depends on schema migration');
  lines.push('-- 1700000016000_add_creator_to_family_silhouettes.sql (lexically smaller');
  lines.push('-- → applied first by node-pg-migrate). Without that column the UPDATE');
  lines.push(`-- below errors with column "creator" does not exist.`);
  lines.push('--');
  lines.push('-- After version-one → main merge that includes this migration, the');
  lines.push('-- operator runs scripts/purge-silhouettes-cache.sh (introduced in #252)');
  lines.push('-- as part of the production deploy runbook to purge the CDN cache for');
  lines.push('-- /api/silhouettes so users see the real silhouettes immediately instead');
  lines.push('-- of waiting for max-age=604800 to expire on stale browser caches.');
  lines.push('');

  // Sort families alphabetically for stable diffs.
  const sortedPicks = [...picks].sort((a, b) => a.family.localeCompare(b.family));
  const successes = sortedPicks.filter(p => p.picked);
  const failures = sortedPicks.filter(p => !p.picked);

  for (const pick of successes) {
    const p = pick.picked;
    const d = escapeSqlString(p.svgPathD);
    const src = escapeSqlString(p.imagePageUrl);
    const lic = escapeSqlString(p.licenseId);
    const cre = p.creatorName ? `'${escapeSqlString(p.creatorName)}'` : 'NULL';
    lines.push(`-- ${pick.family} — ${p.licenseId}, creator: ${p.creatorName ?? '(unknown)'}`);
    lines.push(`UPDATE family_silhouettes SET`);
    lines.push(`  svg_data = '${d}',`);
    lines.push(`  source = '${src}',`);
    lines.push(`  license = '${lic}',`);
    lines.push(`  creator = ${cre}`);
    lines.push(`WHERE family_code = '${pick.family}';`);
    lines.push('');
  }

  if (failures.length > 0) {
    lines.push('-- Phylopic-less families: explicit NULL signals "no usable silhouette";');
    lines.push('-- the _FALLBACK consumer (#246) renders the generic shape using the');
    lines.push('-- preserved family color. Families fall into this bucket either because');
    lines.push('-- (a) the operator listed them in scripts/phylopic-picks.json#skipFamilies');
    lines.push('-- after confirming no usable Phylopic entry exists, or (b) the live API');
    lines.push('-- returned 404 (genuine taxonomic absence). Transient API failures (5xx,');
    lines.push('-- network) abort the run instead — see scripts/curate-phylopic.mjs #267.');
    if (skipFamilies && skipFamilies.length > 0) {
      const operatorSkipped = failures
        .filter(f => skipFamilies.includes(f.family))
        .map(f => f.family);
      const apiAbsent = failures
        .filter(f => !skipFamilies.includes(f.family))
        .map(f => f.family);
      if (operatorSkipped.length > 0) {
        lines.push(`-- Operator-flagged absent (skipFamilies): ${operatorSkipped.join(', ')}.`);
      }
      if (apiAbsent.length > 0) {
        lines.push(`-- API-absent (404 from Phylopic): ${apiAbsent.join(', ')}.`);
      }
    }
    const codes = failures.map(f => `'${f.family}'`).join(', ');
    lines.push(`UPDATE family_silhouettes SET svg_data = NULL, source = NULL, license = NULL, creator = NULL`);
    lines.push(`WHERE family_code IN (${codes});`);
    lines.push('');
  }

  lines.push('-- Down Migration');
  lines.push('-- Restore placeholders is impractical (we would need to know which seed');
  lines.push('-- migration owned each row). Roll back instead by reverting this migration');
  lines.push('-- file alongside the schema migration 16000.');
  lines.push(`UPDATE family_silhouettes SET svg_data = NULL, source = NULL, license = NULL, creator = NULL`);
  const allCodes = sortedPicks.map(p => `'${p.family}'`).join(', ');
  lines.push(`WHERE family_code IN (${allCodes});`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Read `phylopic-picks.json` and pull out the operator-managed config.
 * Returns `{ skipFamilies: string[] }`. Missing file or missing field → empty
 * skip list. Unknown families in the list are tolerated (logged) — operators
 * may leave entries from earlier runs after the FAMILIES list shrinks.
 */
function loadPicksConfig() {
  if (!existsSync(PICKS_PATH)) {
    return { skipFamilies: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(PICKS_PATH, 'utf-8'));
  } catch (err) {
    console.warn(`[config] failed to parse ${PICKS_PATH}: ${err.message} — assuming empty skipFamilies`);
    return { skipFamilies: [] };
  }
  const skipFamilies = Array.isArray(parsed?.skipFamilies) ? parsed.skipFamilies.filter(s => typeof s === 'string') : [];
  return { skipFamilies };
}

async function main() {
  const config = loadPicksConfig();
  const skipSet = new Set(config.skipFamilies);
  console.log(`Curating ${FAMILIES.length} families against Phylopic API (build=${PHYLOPIC_BUILD})`);
  console.log(`Cache: ${CACHE_DIR}${REFRESH ? ' (REFRESH mode — bypassing)' : ''}`);
  if (skipSet.size > 0) {
    console.log(`Skipping (operator-flagged absent): ${[...skipSet].sort().join(', ')}`);
  }
  const picks = [];
  const failures = [];
  for (const family of FAMILIES) {
    if (skipSet.has(family)) {
      console.log(`\n[${family}] skipping (operator-flagged absent in phylopic-picks.json#skipFamilies)`);
      picks.push({
        kind: 'skipped',
        family,
        picked: null,
        considered: [],
        reason: 'operator-skipped',
      });
      continue;
    }
    const result = await curateFamily(family);
    picks.push(result);
    if (result.kind === 'failed') {
      failures.push(result);
    }
  }

  // ABORT if any family had a transient failure (5xx / network) after retries.
  // Don't write a misleading migration that conflates "API failed" with
  // "family genuinely absent".
  if (failures.length > 0) {
    console.error('\n');
    console.error('================================================================');
    console.error('ABORT: Phylopic API failed for these families after 3 retries:');
    for (const f of failures) {
      console.error(`  - ${f.family}: ${f.reason}`);
    }
    console.error('');
    console.error('Not writing migration or picks file — this looks like a transient');
    console.error('API outage, not a real curation result. Re-run when Phylopic API');
    console.error('is healthy. If a family is genuinely absent and you want to skip');
    console.error('it permanently, add it to scripts/phylopic-picks.json#skipFamilies.');
    console.error('================================================================');
    process.exit(2);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    phylopicBuild: PHYLOPIC_BUILD,
    autoPickHeuristic: 'license-preference (CC0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0), then creator-name asc, then uuid asc',
    skipFamilies: config.skipFamilies,
    families: picks.map(p => ({
      family: p.family,
      picked: p.picked
        ? {
            licenseId: p.picked.licenseId,
            creatorName: p.picked.creatorName,
            imagePageUrl: p.picked.imagePageUrl,
            uuid: p.picked.uuid,
          }
        : null,
      reason: p.reason,
      candidateCount: p.considered.length,
      considered: p.considered.map(c => ({
        uuid: c.uuid,
        licenseId: c.licenseId,
        creatorName: c.creatorName,
        status: c.status,
        skipReason: c.skipReason ?? null,
      })),
    })),
  };
  writeFileSync(PICKS_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${PICKS_PATH}`);

  const sql = emitMigrationSql(picks, config.skipFamilies);
  writeFileSync(MIGRATION_PATH, sql);
  console.log(`Wrote ${MIGRATION_PATH}`);

  const ok = picks.filter(p => p.picked).length;
  const skipped = picks.length - ok;
  console.log(`\nSummary: ${ok} picked, ${skipped} NULL (${skipped > 0 ? picks.filter(p => !p.picked).map(p => p.family).join(', ') : 'none'})`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
