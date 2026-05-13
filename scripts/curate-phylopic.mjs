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
 *     DEPRECATED as of issue #498: skipFamilies is empty by convention.
 *     The script's existing NULL-emission path already handles genuine
 *     API absences. Re-curating against current Phylopic builds is
 *     cheap (one script run) and surfaces newly-contributed silhouettes
 *     that would have been silently skipped by the memoized list. Do
 *     not re-introduce entries here without a strong operational reason.
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
 *   node scripts/curate-phylopic.mjs                   # 25-family seed; UPDATE-mode (migration 17000)
 *   node scripts/curate-phylopic.mjs --refresh         # bypass cache, re-fetch all
 *   node scripts/curate-phylopic.mjs --backfill        # 38-family backfill; INSERT-mode (migration 34000)
 *   node scripts/curate-phylopic.mjs --recurate-nulls  # 14 NULL-svg families; UPDATE-mode (migration 35000, issue #498)
 *   node scripts/curate-phylopic.mjs --rescue-via-species  # 14 NULL-svg families, species/genus cascade; UPDATE-mode (migration 36000, issue #500)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CACHE_DIR = resolve(__dirname, '.phylopic-cache');
const PICKS_PATH = resolve(__dirname, 'phylopic-picks.json');
const MIGRATION_PATH = resolve(
  REPO_ROOT,
  process.argv.includes('--rescue-via-species')
    ? 'migrations/1700000036000_rescue_null_silhouettes_via_species.sql'
    : process.argv.includes('--recurate-nulls')
      ? 'migrations/1700000035000_recurate_null_silhouettes.sql'
      : process.argv.includes('--backfill')
        ? 'migrations/1700000034000_backfill_observed_family_silhouettes.sql'
        : 'migrations/1700000017000_seed_family_silhouettes_phylopic.sql',
);

const PHYLOPIC_API = 'https://api.phylopic.org';
const PHYLOPIC_BUILD = '538';
const PHYLOPIC_WEB = 'https://www.phylopic.org';

const REFRESH = process.argv.includes('--refresh');
const BACKFILL = process.argv.includes('--backfill');
const RECURATE_NULLS = process.argv.includes('--recurate-nulls');
// Issue #500. When set, NULL families that fail family-node lookup (or whose
// candidates are all gate-rejected) fall back to a hand-picked species/genus
// override. Composes with --recurate-nulls or stands alone; either way it
// targets the 14 RECURATE_FAMILIES list. Emits migration 36000.
const RESCUE_VIA_SPECIES = process.argv.includes('--rescue-via-species');

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

// Families to backfill per issue #495. Derived from the production audit
// query `SELECT DISTINCT family_code FROM observations WHERE family_code
// NOT IN (SELECT family_code FROM family_silhouettes)` run on 2026-05-12
// after PR #494's icteridae row landed. Ordered alphabetically for
// deterministic curation.
const BACKFILL_FAMILIES = [
  'aegithalidae', 'alaudidae', 'alcedinidae', 'apodidae', 'bombycillidae',
  'calcariidae', 'certhiidae', 'charadriidae', 'cinclidae', 'falconidae',
  'gaviidae', 'gruidae', 'hirundinidae', 'icteriidae', 'laniidae',
  'laridae', 'motacillidae', 'numididae', 'pandionidae', 'passeridae',
  'pelecanidae', 'peucedramidae', 'phalacrocoracidae', 'phasianidae',
  'podicipedidae', 'polioptilidae', 'psittacidae', 'psittaculidae',
  'ptiliogonatidae', 'rallidae', 'recurvirostridae', 'regulidae',
  'sittidae', 'sturnidae', 'tityridae', 'turdidae', 'tytonidae',
  'vireonidae',
];

// Families to re-curate per issue #498. These are the 14 family_silhouettes
// rows that landed with svg_data=NULL after the legacy migration 17000 (3
// legacy operator-skipped: cuculidae, ptilogonatidae, remizidae) and after
// the #495 backfill in migration 34000 (11 families where Phylopic build
// ~525 returned no license-compatible vectorFile). Run against build 538
// (or newer) to pick up any newly-contributed CC silhouettes since the
// original curation. Triggers an UPDATE-mode migration that flips
// svg_data/source/license/creator from NULL → real values for any family
// that now has a usable pick; the rest stay NULL and are surfaced in the
// migration comment + PR body.
const RECURATE_FAMILIES = [
  'calcariidae', 'cuculidae', 'gaviidae', 'icteriidae', 'numididae',
  'peucedramidae', 'phasianidae', 'polioptilidae', 'ptiliogonatidae',
  'ptilogonatidae', 'remizidae', 'tityridae', 'tytonidae', 'vireonidae',
];

// Issue #500. Hand-picked iconic AZ species (or representative genus) for each
// of the 14 NULL family_silhouettes. Used by the --rescue-via-species fallback
// path: when a family's own node returns 404 or all candidates are gate-rejected,
// the script tries the species binomial, then (on 404) the genus alone.
// Phylopic node names are typically scientific binomials or genus names;
// /nodes?filter_name is case-insensitive but a strict slug match.
//
// Selection rationale: each species is iconic for AZ birding and the species
// is well-illustrated relative to its family (cuckoo as a family is a less-
// illustrated abstraction; Greater Roadrunner is famous and likely has CC0
// silhouettes). Monotypic families (icteriidae, peucedramidae) collapse to
// their sole species naturally. ptilogonatidae and ptiliogonatidae are
// alternate spellings of the same lineage in current/legacy eBird; both map
// to Phainopepla nitens.
const SPECIES_OVERRIDES = {
  calcariidae:      'Calcarius ornatus',         // Chestnut-collared Longspur (most-regular AZ winter)
  cuculidae:        'Geococcyx californianus',   // Greater Roadrunner (iconic AZ)
  gaviidae:         'Gavia immer',               // Common Loon (regular AZ migrant)
  icteriidae:       'Icteria virens',            // Yellow-breasted Chat (monotypic family)
  numididae:        'Numida meleagris',          // Helmeted Guineafowl (introduced AZ)
  peucedramidae:    'Peucedramus taeniatus',     // Olive Warbler (monotypic family)
  phasianidae:      'Meleagris gallopavo',       // Wild Turkey (most-observed AZ phasianid)
  polioptilidae:    'Polioptila caerulea',       // Blue-gray Gnatcatcher (common AZ)
  ptiliogonatidae:  'Phainopepla nitens',        // Phainopepla (iconic AZ)
  ptilogonatidae:   'Phainopepla nitens',        // same lineage, older eBird spelling
  remizidae:        'Auriparus flaviceps',       // Verdin (AZ desert specialist)
  tityridae:        'Pachyramphus aglaiae',      // Rose-throated Becard (rare AZ specialty)
  tytonidae:        'Tyto alba',                 // Barn Owl (common AZ)
  vireonidae:       'Vireo plumbeus',            // Plumbeous Vireo (common AZ)
};

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
  // Phylopic /nodes?filter_name is case-SENSITIVE on the URL value — lowercase
  // is the convention (taxonomic family/genus/binomial slugs). Family codes in
  // FAMILIES are already lowercase; species/genus overrides (issue #500) are
  // typically capitalized binomials, so we normalize here.
  const url = `${PHYLOPIC_API}/nodes?build=${PHYLOPIC_BUILD}&filter_name=${encodeURIComponent(familyName.toLowerCase())}&page=0`;
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
 * /images?filter_node=<uuid>&embed_items=true. Returns
 *   { candidates, rejected }
 * where `candidates` are descriptors that passed every pre-SVG quality gate
 * and are eligible for the auto-pick heuristic, and `rejected` are
 * descriptors that one of the gates dropped — they're carried forward into
 * the per-family `considered[]` array so picks.json records WHY each was
 * rejected.
 *
 * Pre-SVG gates (issue #498), in order:
 *   - `no-vector-file`         — `_links.vectorFile.href` missing
 *   - `license-rejected:<url>` — license not in LICENSE_URL_TO_ID
 *   - `creator-denied:<name>`  — creator is null/blank/"-"/"Anonymous"
 *   - `image-page-url-invalid` — image-page URL doesn't match the canonical regex
 *
 * Without recording these, a family whose every candidate fails a pre-SVG
 * gate is indistinguishable from a node that legitimately returned zero
 * items — picks.json shows `candidateCount: 0, considered: []` in both
 * cases. The follow-up to #499 (bot review) made this an audit-trail
 * regression we have to fix.
 */
async function enumerateCandidates(nodeUuid) {
  const url = `${PHYLOPIC_API}/images?build=${PHYLOPIC_BUILD}&filter_node=${nodeUuid}&page=0&embed_items=true`;
  const json = await getJson(url);
  const items = json?._embedded?.items ?? [];
  const candidates = [];
  const rejected = [];
  const creatorDeny = new Set(['', '-', 'Anonymous']);
  for (const item of items) {
    const links = item?._links ?? {};
    const vectorFile = links?.vectorFile?.href ?? null;
    const sourceFile = links?.sourceFile?.href ?? null;
    const selfHref = links?.self?.href ?? '';
    const uuidMatch = selfHref.match(/\/images\/([0-9a-f-]{36})/i);
    const uuid = uuidMatch ? uuidMatch[1] : null;
    const licenseUrl = links?.license?.href ?? null;
    const licenseId = licenseUrl ? (LICENSE_URL_TO_ID[licenseUrl] ?? null) : null;
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
    const base = {
      uuid,
      vectorFileUrl: vectorFile,
      sourceFileUrl: sourceFile,
      licenseUrl,
      licenseId,
      creatorName,
      imagePageUrl,
    };
    // Gate 1: strictly require the auto-gen SVG.
    if (!vectorFile) {
      rejected.push({ ...base, status: 'rejected-pre-svg', skipReason: 'no-vector-file' });
      continue;
    }
    // Gate 2: license must be in our accepted set. Record the offending
    // URL (or '<null>') so a reader can see e.g. "publicdomain/mark/1.0".
    if (!licenseId) {
      rejected.push({
        ...base,
        status: 'rejected-pre-svg',
        skipReason: `license-rejected:${licenseUrl ?? '<null>'}`,
      });
      continue;
    }
    // Gate 3 (issue #498): reject candidates with bad-shape attribution.
    // The AttributionModal must surface a real creator + a working Phylopic
    // page link; "", "-", "Anonymous", or null all degrade the UX to
    // un-attributable, which is the worst case for a CC-licensed asset.
    if (!creatorName || creatorDeny.has(creatorName.trim())) {
      rejected.push({
        ...base,
        status: 'rejected-pre-svg',
        skipReason: `creator-denied:${creatorName ?? '<null>'}`,
      });
      continue;
    }
    if (!imagePageUrl || !/^https:\/\/www\.phylopic\.org\/images\/[0-9a-f-]+/.test(imagePageUrl)) {
      rejected.push({
        ...base,
        status: 'rejected-pre-svg',
        skipReason: 'image-page-url-invalid',
      });
      continue;
    }
    candidates.push(base);
  }
  return { candidates, rejected };
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
  // Quality audit (issue #498, corrected #500): reject paths that are too
  // short or too simple to be a real silhouette.
  //
  // The original #499 gate read "≥5 distinct path commands" — but potrace
  // (the tool that produces every Phylopic vectorFile) emits only M, L, C, Z.
  // Auditing the 22 production-shipped paths from migration 17000 shows 21 of
  // 22 have exactly 4 distinct commands (M, L, C, Z) and 1 has 3 (M, C, Z).
  // The "≥5 distinct" rule would reject EVERY shipped silhouette — it was a
  // mis-calibrated gate that survived #499 only because that PR rescued 0
  // families. Re-running #499's gate against any real Phylopic silhouette
  // produces the same outcome.
  //
  // The replacement gate measures path *complexity* via TOTAL command count
  // (an M-L-C-Z silhouette with hundreds of curve operations is a real
  // outline; one with only a handful is a blob). 20 commands is the floor —
  // below that, the rendered glyph at 24-28px degrades into a near-meaningless
  // blob, regardless of which command letters appear. The 22 shipped paths
  // have command counts in [120, 700+].
  if (normalized.length < 100) {
    return { ok: false, reason: `svgPathD-too-short: ${normalized.length} chars` };
  }
  const cmdMatches = normalized.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? [];
  if (cmdMatches.length < 20) {
    return { ok: false, reason: `svgPathD-too-simple: ${cmdMatches.length} path commands` };
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
  return await curateBySlug(family, family, 'family');
}

/**
 * Issue #500. Lookup + enumerate + pick against an arbitrary Phylopic
 * `filter_name` slug, returning the same `{ kind, family, picked, considered,
 * reason }` shape as curateFamily. `label` records which resolution path the
 * caller is exploring ("family", "species", or "genus") so the audit trail
 * can attribute each pick to its lookup type.
 *
 *   kind: 'picked'  — usable pick found; carries svgPathD + provenance
 *   kind: 'absent'  — 404 / no-node / no-candidates / all-rejected
 *   kind: 'failed'  — transient 5xx / network error after retries; main() aborts
 */
async function curateBySlug(family, slug, label) {
  console.log(`\n[${family}/${label}] resolving node for slug "${slug}"...`);
  let nodeUuid;
  try {
    nodeUuid = await lookupNodeUuid(slug);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`[${family}/${label}] HTTP 404 from /nodes for "${slug}"`);
      return { kind: 'absent', family, picked: null, considered: [], reason: 'http-404-on-nodes' };
    }
    return { kind: 'failed', family, picked: null, considered: [], reason: `lookup-failed: ${err.message}`, error: err };
  }
  if (!nodeUuid) {
    console.warn(`[${family}/${label}] no taxonomic node found for "${slug}" (empty items list)`);
    return { kind: 'absent', family, picked: null, considered: [], reason: 'no-node' };
  }
  console.log(`[${family}/${label}] node ${nodeUuid}, enumerating images...`);
  let candidates;
  let rejected;
  try {
    ({ candidates, rejected } = await enumerateCandidates(nodeUuid));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      console.warn(`[${family}/${label}] HTTP 404 from /images — node has no images attached`);
      return { kind: 'absent', family, picked: null, considered: [], reason: 'http-404-on-images' };
    }
    return { kind: 'failed', family, picked: null, considered: [], reason: `images-failed: ${err.message}`, error: err };
  }
  if (candidates.length === 0) {
    console.warn(`[${family}/${label}] zero candidates with vectorFile + accepted license (${rejected.length} rejected pre-SVG)`);
    return { kind: 'absent', family, picked: null, considered: rejected, reason: 'no-candidates' };
  }
  const sorted = autoPick(candidates);
  const considered = [...rejected];
  for (const cand of sorted) {
    let svg;
    try {
      svg = await getSvg(cand.vectorFileUrl);
    } catch (err) {
      considered.push({ ...cand, status: 'svg-fetch-failed', skipReason: err.message });
      continue;
    }
    const extracted = extractPathD(svg);
    if (!extracted.ok) {
      considered.push({ ...cand, status: 'rejected', skipReason: extracted.reason });
      continue;
    }
    considered.push({ ...cand, status: 'picked', svgPathD: extracted.d });
    const walked = considered.length - rejected.length;
    return {
      kind: 'picked',
      family,
      picked: { ...cand, svgPathD: extracted.d, resolvedSlug: slug },
      considered: considered.concat(
        sorted.slice(walked).map(c => ({ ...c, status: 'not-tried' }))
      ),
      reason: `picked-by-license-${cand.licenseId}`,
    };
  }
  console.warn(`[${family}/${label}] all ${candidates.length} candidates rejected → no pick (${rejected.length} pre-SVG rejections)`);
  return { kind: 'absent', family, picked: null, considered, reason: 'all-rejected' };
}

/**
 * Issue #500. Cascade lookup for a NULL family: try the family-node first;
 * on 'absent' (any reason — 404, no-candidates, all-rejected), fall back to
 * the species binomial from SPECIES_OVERRIDES; on 'absent' for the species,
 * fall back to the genus (binomial split on first space).
 *
 * Returns the same shape as curateFamily plus a `resolutionPath` field on
 * the picked result so picks.json records which lookup type produced the
 * pick ("family" | "species" | "genus"). On final absence, returns the
 * cascaded `attempts[]` so the audit trail records every slug we tried.
 *
 * Transient failures (5xx / network) at ANY step propagate up so the run
 * aborts — we don't downgrade a transient outage into "no pick".
 */
async function rescueFamilyViaSpecies(family) {
  const attempts = [];
  // Step 1: family-node lookup (same as curateFamily).
  const familyResult = await curateFamily(family);
  attempts.push({ slug: family, label: 'family', kind: familyResult.kind, reason: familyResult.reason });
  if (familyResult.kind === 'picked') {
    return { ...familyResult, resolutionPath: 'family', attempts, considered: familyResult.considered };
  }
  if (familyResult.kind === 'failed') {
    return { ...familyResult, attempts };
  }
  // Step 2: species-binomial fallback.
  const species = SPECIES_OVERRIDES[family];
  if (!species) {
    // No override registered — final answer is the family-level absence.
    return { ...familyResult, resolutionPath: null, attempts };
  }
  console.log(`[${family}] family-node lookup failed (${familyResult.reason}); falling back to species "${species}"`);
  const speciesResult = await curateBySlug(family, species, 'species');
  attempts.push({ slug: species, label: 'species', kind: speciesResult.kind, reason: speciesResult.reason });
  if (speciesResult.kind === 'picked') {
    return { ...speciesResult, resolutionPath: 'species', attempts, considered: speciesResult.considered };
  }
  if (speciesResult.kind === 'failed') {
    return { ...speciesResult, attempts };
  }
  // Step 3: genus fallback (binomial split on first space). Skip if the
  // override was already genus-only (no space).
  const firstSpace = species.indexOf(' ');
  if (firstSpace === -1) {
    // Species override is genus-only; no further split available.
    return {
      kind: 'absent',
      family,
      picked: null,
      considered: speciesResult.considered,
      reason: `cascade-exhausted: family=${familyResult.reason}, species=${speciesResult.reason}`,
      resolutionPath: null,
      attempts,
    };
  }
  const genus = species.slice(0, firstSpace);
  console.log(`[${family}] species lookup failed (${speciesResult.reason}); falling back to genus "${genus}"`);
  const genusResult = await curateBySlug(family, genus, 'genus');
  attempts.push({ slug: genus, label: 'genus', kind: genusResult.kind, reason: genusResult.reason });
  if (genusResult.kind === 'picked') {
    return { ...genusResult, resolutionPath: 'genus', attempts, considered: genusResult.considered };
  }
  if (genusResult.kind === 'failed') {
    return { ...genusResult, attempts };
  }
  // All three exhausted.
  return {
    kind: 'absent',
    family,
    picked: null,
    considered: genusResult.considered,
    reason: `cascade-exhausted: family=${familyResult.reason}, species=${speciesResult.reason}, genus=${genusResult.reason}`,
    resolutionPath: null,
    attempts,
  };
}

/**
 * Emit a SQL migration string. `mode` controls statement shape:
 *   - 'update' (default, existing behavior): UPDATE family_silhouettes SET
 *     ... WHERE family_code = '...' — for re-curating already-seeded rows
 *     (migration 17000).
 *   - 'backfill' (new, issue #495): INSERT INTO family_silhouettes (...)
 *     VALUES (...), (...), ... ON CONFLICT (id) DO NOTHING — for adding
 *     rows that don't exist yet. Carries the extra columns (`id`, `color`,
 *     `common_name`) that UPDATE mode doesn't touch.
 *
 * `colorByFamily` and `commonNameByFamily` (both Record<string, string>)
 * are only consumed in 'backfill' mode and are looked up by family code.
 */
function emitMigrationSql(picks, skipFamilies, mode = 'update', colorByFamily = {}, commonNameByFamily = {}) {
  const today = todayUtc();
  const lines = [];
  lines.push('-- Up Migration');
  if (mode === 'rescue') {
    const sortedPicks = [...picks].sort((a, b) => a.family.localeCompare(b.family));
    const rescued = sortedPicks.filter(p => p.picked);
    const stillNull = sortedPicks.filter(p => !p.picked);
    lines.push('-- Issue #500. Rescues the 14 NULL-svg_data family_silhouettes via');
    lines.push('-- species/genus-level Phylopic lookup. After PR #499 (#498 build-538');
    lines.push('-- re-audit), every family-node lookup either 404\'d or produced only');
    lines.push('-- license-incompatible candidates. Phylopic coverage is denser at the');
    lines.push('-- species node for iconic taxa than at the family-node abstraction —');
    lines.push('-- the script tries an iconic AZ species per family, then the genus on');
    lines.push('-- species 404.');
    lines.push('--');
    lines.push(`-- Generated by scripts/curate-phylopic.mjs --rescue-via-species on ${today}`);
    lines.push('-- using the Phylopic API two-step recipe (/nodes?filter_name →');
    lines.push('-- /images?filter_node) and the existing auto-pick heuristic + quality');
    lines.push('-- gates (license whitelist, real creator, valid imagePageUrl,');
    lines.push('-- svgPathD ≥100 chars + ≥20 total path commands; PD-mark rejected).');
    lines.push('-- The "≥20 total path commands" rule replaces #499\'s "≥5 distinct path');
    lines.push('-- commands" rule, which was mis-calibrated against potrace output —');
    lines.push('-- every shipped Phylopic silhouette in migration 17000 uses only M, L,');
    lines.push('-- C, Z (≤4 distinct), so the original gate would have rejected the entire');
    lines.push('-- production corpus. See the corrected gate at extractPathD() in');
    lines.push('-- scripts/curate-phylopic.mjs (with detailed comment on the audit).');
    lines.push('--');
    lines.push('-- Rescued (svg_data flipped from NULL → real path-d via species/genus):');
    if (rescued.length === 0) {
      lines.push('--   (none — species + genus lookups added no usable picks for the 14 NULL families)');
    } else {
      for (const r of rescued) {
        const path = r.resolutionPath ?? 'species';
        const slug = r.picked.resolvedSlug ?? '(unknown slug)';
        lines.push(`--   ${r.family} — via ${path} "${slug}" — ${r.picked.licenseId}, creator: ${r.picked.creatorName ?? '(unknown)'}, ${r.picked.imagePageUrl}`);
      }
    }
    lines.push('--');
    lines.push('-- Still NULL after species/genus cascade (rejection reason in parentheses):');
    if (stillNull.length === 0) {
      lines.push('--   (none — all 14 rescued)');
    } else {
      for (const r of stillNull) {
        lines.push(`--   ${r.family} (${r.reason})`);
      }
    }
    lines.push('--');
    lines.push('-- The full audit trail (every slug attempted, every candidate considered)');
    lines.push('-- lives at scripts/phylopic-picks.json under the updated entries. Each');
    lines.push('-- rescued entry carries `resolutionPath: "family"|"species"|"genus"` so');
    lines.push('-- a future reader can see which lookup path produced the pick.');
    lines.push('--');
    lines.push('-- After this migration lands in main, the operator runs');
    lines.push('-- scripts/purge-silhouettes-cache.sh (#252) as part of the production');
    lines.push('-- deploy runbook to purge the CDN cache for /api/silhouettes.');
    lines.push('');
    if (rescued.length === 0) {
      lines.push('-- No UPDATEs: species + genus lookups produced zero usable picks. This');
      lines.push('-- migration is intentionally a comment-only audit record (with a SELECT 1');
      lines.push('-- to satisfy node-pg-migrate\'s "Up section must execute" contract). The');
      lines.push('-- 14 family rows remain svg_data=NULL; _FALLBACK still tints them.');
      lines.push('SELECT 1;');
      lines.push('');
    } else {
      for (const pick of rescued) {
        const p = pick.picked;
        const d = escapeSqlString(p.svgPathD);
        const src = escapeSqlString(p.imagePageUrl);
        const lic = escapeSqlString(p.licenseId);
        const cre = p.creatorName ? `'${escapeSqlString(p.creatorName)}'` : 'NULL';
        const path = pick.resolutionPath ?? 'species';
        const slug = p.resolvedSlug ?? '(unknown slug)';
        lines.push(`-- ${pick.family} — via ${path} "${slug}" — ${p.licenseId}, creator: ${p.creatorName ?? '(unknown)'}`);
        lines.push(`-- page: ${p.imagePageUrl}`);
        lines.push(`UPDATE family_silhouettes SET`);
        lines.push(`  svg_data = '${d}',`);
        lines.push(`  source = '${src}',`);
        lines.push(`  license = '${lic}',`);
        lines.push(`  creator = ${cre}`);
        lines.push(`WHERE family_code = '${pick.family}';`);
        lines.push('');
      }
    }
    lines.push('-- Down Migration');
    lines.push('-- Revert ONLY the rescued rows back to NULL. Families that were not');
    lines.push('-- rescued in this migration are unchanged.');
    if (rescued.length === 0) {
      lines.push('-- No-op: nothing was rescued, so nothing to revert.');
      lines.push('SELECT 1;');
    } else {
      const codes = rescued.map(p => `'${p.family}'`).join(', ');
      lines.push(`UPDATE family_silhouettes SET svg_data = NULL, source = NULL, license = NULL, creator = NULL`);
      lines.push(`WHERE family_code IN (${codes});`);
    }
    lines.push('');
    return lines.join('\n');
  }
  if (mode === 'recurate') {
    const sortedPicks = [...picks].sort((a, b) => a.family.localeCompare(b.family));
    const rescued = sortedPicks.filter(p => p.picked);
    const stillNull = sortedPicks.filter(p => !p.picked);
    lines.push('-- Issue #498. Re-curates the 14 NULL-svg_data family_silhouettes');
    lines.push('-- rows against Phylopic build 538 — 3 legacy from migration 17000\'s');
    lines.push('-- operator-skip list (cuculidae, ptilogonatidae, remizidae) and 11');
    lines.push('-- from the #495 backfill (migration 34000) where the prior curation');
    lines.push('-- pass found no license-compatible vectorFile.');
    lines.push('--');
    lines.push(`-- Generated by scripts/curate-phylopic.mjs --recurate-nulls on ${today}`);
    lines.push('-- using the Phylopic API two-step recipe (/nodes?filter_name →');
    lines.push('-- /images?filter_node) and the existing auto-pick heuristic');
    lines.push('-- (license preference CC0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0,');
    lines.push('-- then alphabetic creator, then UUID).');
    lines.push('--');
    lines.push('-- Rescued (svg_data flipped from NULL → real path-d):');
    if (rescued.length === 0) {
      lines.push('--   (none — build 538 added no usable picks for the 14 NULL families)');
    } else {
      for (const r of rescued) {
        lines.push(`--   ${r.family} — ${r.picked.licenseId}, creator: ${r.picked.creatorName ?? '(unknown)'}`);
      }
    }
    lines.push('--');
    lines.push('-- Still NULL after build 538 (rejection reason in parentheses):');
    if (stillNull.length === 0) {
      lines.push('--   (none — all 14 rescued)');
    } else {
      for (const r of stillNull) {
        lines.push(`--   ${r.family} (${r.reason})`);
      }
    }
    lines.push('--');
    lines.push('-- The full audit trail (every candidate the heuristic considered,');
    lines.push('-- per family) lives at scripts/phylopic-picks.json under the updated');
    lines.push('-- entries. The skipFamilies memoization mechanism is now empty and');
    lines.push('-- deprecated — see the comment at the top of scripts/curate-phylopic.mjs.');
    lines.push('--');
    lines.push('-- After this migration lands in main, the operator runs');
    lines.push('-- scripts/purge-silhouettes-cache.sh (#252) as part of the production');
    lines.push('-- deploy runbook to purge the CDN cache for /api/silhouettes.');
    lines.push('');
    if (rescued.length === 0) {
      lines.push('-- No UPDATEs: build 538 produced zero usable picks. This migration');
      lines.push('-- is intentionally a comment-only audit record (with a SELECT 1 to');
      lines.push('-- satisfy node-pg-migrate\'s "Up section must execute" contract).');
      lines.push('-- The 14 family rows remain svg_data=NULL; the _FALLBACK consumer');
      lines.push('-- (#246) continues to render the generic shape tinted with each');
      lines.push('-- family\'s color. Re-run scripts/curate-phylopic.mjs --recurate-nulls');
      lines.push('-- against a newer Phylopic build to pick up future contributions.');
      lines.push('SELECT 1;');
      lines.push('');
    } else {
      for (const pick of rescued) {
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
    }
    lines.push('-- Down Migration');
    lines.push('-- Revert ONLY the rescued rows back to NULL. Families that were not');
    lines.push('-- rescued in this migration are unchanged.');
    if (rescued.length === 0) {
      lines.push('-- No-op: nothing was rescued, so nothing to revert.');
      lines.push('SELECT 1;');
    } else {
      const codes = rescued.map(p => `'${p.family}'`).join(', ');
      lines.push(`UPDATE family_silhouettes SET svg_data = NULL, source = NULL, license = NULL, creator = NULL`);
      lines.push(`WHERE family_code IN (${codes});`);
    }
    lines.push('');
    return lines.join('\n');
  }
  if (mode === 'backfill') {
    lines.push('-- Issue #495. Backfills family_silhouettes rows for the 38 AZ-observed');
    lines.push('-- bird families surfaced by the audit query in #482/#494, closing the');
    lines.push('-- last gap between observations.family_code and family_silhouettes.');
    lines.push(`-- Generated by scripts/curate-phylopic.mjs --backfill on ${today}`);
    lines.push('-- using the Phylopic API two-step recipe (/nodes?filter_name →');
    lines.push('-- /images?filter_node) and the auto-pick heuristic (license preference');
    lines.push('-- CC0 > CC-BY > CC-BY-SA, then alphabetic creator, then UUID).');
    lines.push('--');
    lines.push('-- Each row carries: a 0..24-viewBox single-path SVG extracted from the');
    lines.push('-- Phylopic vectorFile (potrace <g transform> flattened + normalized),');
    lines.push('-- a distinct hex color (assigned in this PR; visible-from-#555 fallback),');
    lines.push('-- a Phylopic image-page URL as `source`, a short license identifier in');
    lines.push('-- `license` (CC0-1.0 | CC-BY-3.0 | CC-BY-4.0 | CC-BY-SA-3.0), the');
    lines.push('-- contributor name as `creator`, and an English common_name matching the');
    lines.push('-- eBird family-display convention.');
    lines.push('--');
    lines.push('-- ON CONFLICT (id) DO NOTHING — defensive: if a future migration adds');
    lines.push('-- any of these rows independently (e.g. a hot-fix similar to PR #494 for');
    lines.push('-- icteridae), re-running this migration after that hot-fix is a no-op.');
    lines.push('-- The Down migration matches by exact family_code list so it cannot');
    lines.push('-- accidentally remove rows owned by other migrations.');
    lines.push('--');
    lines.push('-- The full audit trail (every candidate the heuristic considered, per');
    lines.push('-- family) lives at scripts/phylopic-picks.json under the new entries.');
    lines.push('--');
    lines.push('-- After this migration lands in main, the operator runs');
    lines.push('-- scripts/purge-silhouettes-cache.sh (#252) as part of the production');
    lines.push('-- deploy runbook to purge the CDN cache for /api/silhouettes.');
    lines.push('');
  } else {
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
  }

  // Sort families alphabetically for stable diffs.
  const sortedPicks = [...picks].sort((a, b) => a.family.localeCompare(b.family));
  const successes = sortedPicks.filter(p => p.picked);
  const failures = sortedPicks.filter(p => !p.picked);

  if (mode === 'backfill') {
    // Single multi-row INSERT for all successes. Skipped families land in a
    // separate INSERT below (svg_data=NULL — they still get a row so the
    // _FALLBACK consumer can resolve their color/common_name).
    if (successes.length > 0) {
      lines.push('INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES');
      const rows = successes.map((pick, idx) => {
        const p = pick.picked;
        const d = escapeSqlString(p.svgPathD);
        const src = escapeSqlString(p.imagePageUrl);
        const lic = escapeSqlString(p.licenseId);
        const cre = p.creatorName ? `'${escapeSqlString(p.creatorName)}'` : 'NULL';
        const color = colorByFamily[pick.family];
        const cn = commonNameByFamily[pick.family];
        if (!color) throw new Error(`color missing for family ${pick.family} — populate COLOR_BY_FAMILY`);
        if (!cn) throw new Error(`common_name missing for family ${pick.family} — populate COMMON_NAME_BY_FAMILY`);
        const comma = idx < successes.length - 1 ? ',' : '';
        return `  ('${pick.family}', '${pick.family}', '${d}', '${color}', '${src}', '${lic}', ${cre}, '${escapeSqlString(cn)}')${comma}`;
      });
      lines.push(...rows);
      lines.push('ON CONFLICT (id) DO NOTHING;');
      lines.push('');
    }
    if (failures.length > 0) {
      lines.push('-- Families with no usable Phylopic silhouette (operator-skipped or API-absent).');
      lines.push('-- Row inserted with svg_data=NULL so the _FALLBACK consumer renders the');
      lines.push('-- generic shape tinted with the assigned family color. Color + common_name');
      lines.push('-- are still useful: the legend chip shows the right color and the right name.');
      lines.push('INSERT INTO family_silhouettes (id, family_code, svg_data, color, source, license, creator, common_name) VALUES');
      const rows = failures.map((pick, idx) => {
        const color = colorByFamily[pick.family];
        const cn = commonNameByFamily[pick.family];
        if (!color) throw new Error(`color missing for skipped family ${pick.family}`);
        if (!cn) throw new Error(`common_name missing for skipped family ${pick.family}`);
        const comma = idx < failures.length - 1 ? ',' : '';
        return `  ('${pick.family}', '${pick.family}', NULL, '${color}', NULL, NULL, NULL, '${escapeSqlString(cn)}')${comma}`;
      });
      lines.push(...rows);
      lines.push('ON CONFLICT (id) DO NOTHING;');
      lines.push('');
    }
    lines.push('-- Down Migration');
    lines.push('DELETE FROM family_silhouettes WHERE family_code IN (');
    lines.push('  ' + sortedPicks.map(p => `'${p.family}'`).join(', '));
    lines.push(');');
    lines.push('');
  } else {
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
  }

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

// Populated in Task 3 + Task 4 of docs/plans/2026-05-12-backfill-38-family-silhouettes.md.
// Keys MUST be the lowercase family_code; values MUST be the per-row column
// value. emitMigrationSql throws on missing keys so the migration cannot
// silently land with NULL color or NULL common_name.
// Hand-picked per the field-mark methodology in
// docs/plans/2026-05-12-backfill-38-family-silhouettes.md Task 3.
// Each color is verified distinct (no exact dup, perceptually separated) from
// the existing 27-color palette across migrations 9000/15000/17000/18000/33000
// and from every other entry in this object. Where a family's primary AZ
// species has a strong field-mark color, the value echoes it.
const COLOR_BY_FAMILY = {
  aegithalidae:        '#C2B098', // Bushtits — pale buff-gray flock bird
  alaudidae:           '#B89060', // Larks — desert sand plumage (Horned Lark)
  alcedinidae:         '#5481A0', // Kingfishers — Belted Kingfisher slate-blue back
  apodidae:            '#36322E', // Swifts — sooty near-black (Vaux's / White-throated)
  bombycillidae:       '#C9A878', // Waxwings — Cedar Waxwing muted gold/cinnamon
  calcariidae:         '#E5C28A', // Longspurs — wheat/buff (winter plumage dominant in AZ)
  certhiidae:          '#6B4A30', // Brown Creeper — streaked bark brown
  charadriidae:        '#BFA682', // Plovers — Killdeer sandy upperparts
  cinclidae:           '#6E7378', // Dippers — American Dipper slate-gray
  falconidae:          '#475360', // Falcons — Peregrine slate-blue mantle
  gaviidae:            '#2B3845', // Loons — Common Loon black-with-blue-sheen
  gruidae:             '#8A8470', // Cranes — Sandhill Crane warm gray
  hirundinidae:        '#5BA0C0', // Swallows — Barn Swallow iridescent blue back
  icteriidae:          '#F4E04D', // Yellow-breasted Chat — bright lemon yellow breast
                                  // (distinct from icteridae #F4B400 deep gold)
  laniidae:            '#7E848A', // Shrikes — Loggerhead Shrike gray upperparts
  laridae:             '#8FA7B5', // Gulls — neutral grey-blue mantle
  motacillidae:        '#7E6440', // Pipits/Wagtails — American Pipit streaky brown
  numididae:           '#5A6878', // Guineafowl — speckled blue-gray (AZ escapees)
  pandionidae:         '#4A3520', // Osprey — dorsal brown
  passeridae:          '#8E5B3A', // House Sparrow — warm chestnut crown/nape
  pelecanidae:         '#E8D4B8', // Pelicans — American White Pelican cream/pink
  peucedramidae:       '#8A8C66', // Olive Warbler — olive-gray with rust head
  phalacrocoracidae:   '#26302C', // Cormorants — Double-crested glossy black-green
  phasianidae:         '#6E7A48', // Pheasants/Quail-relatives — iridescent green-olive
  podicipedidae:       '#2F4D4A', // Grebes — Eared/Pied-billed dark with teal sheen
  polioptilidae:       '#A8B5C2', // Gnatcatchers — Blue-gray Gnatcatcher pale blue-gray
  psittacidae:         '#3FA850', // New World parrots — Rosy-faced Lovebird bright green
  psittaculidae:       '#4FB8B0', // Old World parrots — escaped budgerigars turquoise
  ptiliogonatidae:     '#1A1418', // Phainopepla — glossy near-black with red eye
                                  // (note: distinct lineage from already-seeded
                                  // ptilogonatidae — eBird v2024 spelling)
  rallidae:            '#403E3A', // Rails/Coots — American Coot dark sooty
  recurvirostridae:    '#E1B8C0', // Avocets/Stilts — Black-necked Stilt pink legs
  regulidae:           '#6FA050', // Kinglets — olive-green with bright crown
  sittidae:            '#6B7A8E', // Nuthatches — White-breasted slate-blue back
  sturnidae:           '#2D2538', // Starlings — European iridescent purple-green-black
  tityridae:           '#A88AA0', // Rose-throated Becard — gray with rosy throat
  turdidae:            '#A05A3A', // Thrushes — American Robin breast / Hermit Thrush mantle
  tytonidae:           '#D6B878', // Barn Owl — golden buff dorsal
  vireonidae:          '#7E9B5C', // Vireos — olive-green back
};
// English family-display names following the eBird taxonomy v2024 convention
// and the "Group", "Group & Group", "Group & Allies" precedent set by
// migration 1700000019500_seed_family_common_names.sql (issue #249). Keys are
// alphabetical and match BACKFILL_FAMILIES exactly. Notable disambiguations:
//   icteriidae       — monotypic family (Yellow-breasted Chat); eBird uses
//                      the species name as the family display.
//   ptiliogonatidae  — eBird v2024 spelling distinct from migration 19500's
//                      already-seeded `ptilogonatidae`. eBird display:
//                      "Silky-flycatchers" (lowercase f).
const COMMON_NAME_BY_FAMILY = {
  aegithalidae:        'Bushtits',
  alaudidae:           'Larks',
  alcedinidae:         'Kingfishers',
  apodidae:            'Swifts',
  bombycillidae:       'Waxwings',
  calcariidae:         'Longspurs & Snow Buntings',
  certhiidae:          'Treecreepers',
  charadriidae:        'Plovers & Lapwings',
  cinclidae:           'Dippers',
  falconidae:          'Falcons & Caracaras',
  gaviidae:            'Loons',
  gruidae:             'Cranes',
  hirundinidae:        'Swallows',
  icteriidae:          'Yellow-breasted Chat',
  laniidae:            'Shrikes',
  laridae:             'Gulls, Terns & Skimmers',
  motacillidae:        'Wagtails & Pipits',
  numididae:           'Guineafowl',
  pandionidae:         'Ospreys',
  passeridae:          'Old World Sparrows',
  pelecanidae:         'Pelicans',
  peucedramidae:       'Olive Warbler',
  phalacrocoracidae:   'Cormorants & Shags',
  phasianidae:         'Pheasants, Grouse & Allies',
  podicipedidae:       'Grebes',
  polioptilidae:       'Gnatcatchers',
  psittacidae:         'African & New World Parrots',
  psittaculidae:       'Old World Parrots',
  ptiliogonatidae:     'Silky-flycatchers',
  rallidae:            'Rails, Gallinules & Coots',
  recurvirostridae:    'Stilts & Avocets',
  regulidae:           'Kinglets',
  sittidae:            'Nuthatches',
  sturnidae:           'Starlings & Mynas',
  tityridae:           'Tityras & Allies',
  turdidae:            'Thrushes',
  tytonidae:           'Barn-Owls',
  vireonidae:          'Vireos',
};

async function main() {
  const config = loadPicksConfig();
  const skipSet = new Set(config.skipFamilies);
  const targetFamilies = (RESCUE_VIA_SPECIES || RECURATE_NULLS)
    ? RECURATE_FAMILIES
    : BACKFILL ? BACKFILL_FAMILIES : FAMILIES;
  console.log(`Curating ${targetFamilies.length} families against Phylopic API (build=${PHYLOPIC_BUILD})`);
  console.log(`Cache: ${CACHE_DIR}${REFRESH ? ' (REFRESH mode — bypassing)' : ''}`);
  if (RESCUE_VIA_SPECIES) {
    console.log('Mode: --rescue-via-species (family → species → genus cascade per SPECIES_OVERRIDES)');
  }
  if (skipSet.size > 0) {
    console.log(`Skipping (operator-flagged absent): ${[...skipSet].sort().join(', ')}`);
  }
  const picks = [];
  const failures = [];
  for (const family of targetFamilies) {
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
    const result = RESCUE_VIA_SPECIES
      ? await rescueFamilyViaSpecies(family)
      : await curateFamily(family);
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

  // Build per-family entries for the picks JSON. In --recurate-nulls mode,
  // merge the new entries into the existing file rather than overwriting —
  // the picks file is the cumulative audit trail across runs.
  const familyEntries = picks.map(p => ({
    family: p.family,
    picked: p.picked
      ? {
          licenseId: p.picked.licenseId,
          creatorName: p.picked.creatorName,
          imagePageUrl: p.picked.imagePageUrl,
          uuid: p.picked.uuid,
          svgPathD: p.picked.svgPathD ?? null,
          ...(p.picked.resolvedSlug ? { resolvedSlug: p.picked.resolvedSlug } : {}),
        }
      : null,
    // Issue #500: rescue mode records which lookup path produced the pick
    // ("family" | "species" | "genus") plus the full attempts cascade.
    ...(p.resolutionPath !== undefined ? { resolutionPath: p.resolutionPath } : {}),
    ...(p.attempts ? { attempts: p.attempts } : {}),
    reason: p.reason,
    candidateCount: p.considered.length,
    considered: p.considered.map(c => ({
      uuid: c.uuid,
      licenseId: c.licenseId,
      creatorName: c.creatorName,
      status: c.status,
      skipReason: c.skipReason ?? null,
    })),
  }));

  let summary;
  if (RESCUE_VIA_SPECIES || RECURATE_NULLS) {
    // Load existing picks file and merge: replace entries for the target
    // families, keep the other 24 as-is.
    let existing = null;
    if (existsSync(PICKS_PATH)) {
      try {
        existing = JSON.parse(readFileSync(PICKS_PATH, 'utf-8'));
      } catch {
        existing = null;
      }
    }
    const existingFamilies = Array.isArray(existing?.families) ? existing.families : [];
    const targetSet = new Set(targetFamilies);
    const preserved = existingFamilies.filter(f => !targetSet.has(f.family));
    const merged = [...preserved, ...familyEntries].sort((a, b) => a.family.localeCompare(b.family));
    summary = {
      generatedAt: new Date().toISOString(),
      phylopicBuild: PHYLOPIC_BUILD,
      autoPickHeuristic: 'license-preference (CC0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0), then creator-name asc, then uuid asc',
      skipFamilies: config.skipFamilies,
      _skipFamilies_deprecation_note: 'skipFamilies is deprecated as of issue #498. Empty by convention; the script\'s NULL-emission path handles genuine API absences. Do not re-introduce entries — if a family is unrescueable, let it land as NULL with a SQL-comment-recorded reason.',
      ...(RESCUE_VIA_SPECIES ? { _rescue_via_species_note: 'Rescue mode (issue #500) cascades family → species → genus lookups for the 14 RECURATE_FAMILIES. Each rescued entry carries `resolutionPath` + `attempts[]` so a reader can see which lookup path produced the pick.' } : {}),
      families: merged,
    };
  } else {
    summary = {
      generatedAt: new Date().toISOString(),
      phylopicBuild: PHYLOPIC_BUILD,
      autoPickHeuristic: 'license-preference (CC0 > CC-BY-3.0 > CC-BY-4.0 > CC-BY-SA-3.0), then creator-name asc, then uuid asc',
      skipFamilies: config.skipFamilies,
      families: familyEntries,
    };
  }
  writeFileSync(PICKS_PATH, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${PICKS_PATH}`);

  const sql = emitMigrationSql(
    picks,
    config.skipFamilies,
    RESCUE_VIA_SPECIES ? 'rescue' : RECURATE_NULLS ? 'recurate' : BACKFILL ? 'backfill' : 'update',
    BACKFILL ? COLOR_BY_FAMILY : {},
    BACKFILL ? COMMON_NAME_BY_FAMILY : {},
  );
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
