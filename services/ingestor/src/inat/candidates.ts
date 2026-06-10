import type { InatObservationsResponse } from './types.js';
import { getJsonWithRetry } from './client.js';
import {
  INAT_BASE_URL,
  CC_LICENSES,
  buildTiers,
  toMediumUrl,
  type Tier,
} from './inat-shared.js';

// Client-side backstop for the CC allowlist. iNat filters by photo_license
// server-side, but a malformed/legacy payload occasionally leaks an NC/ND or
// null code; never offer one as a candidate (the admin endpoint re-validates
// too, but filtering here keeps it out of the review UI entirely).
const ALLOWED_LICENSES = new Set(CC_LICENSES.split(','));

/** A single sourced replacement candidate. inatId is the observation id (used
 *  to exclude already-shown candidates on re-source). */
export interface InatCandidate {
  inatId: number;
  photoUrl: string; // ~800px medium JPEG (square→medium substituted)
  attribution: string;
  license: string; // 'cc-by' | 'cc-by-sa' | 'cc0'
}

/** Operator deny feedback that biases re-sourcing. `reason` is free text;
 *  `tags` are the quick-chip values. Recognized tags:
 *  'too-dark','wrong-sex-morph','still-distant','cluttered-background',
 *  'captive-feeder','not-sharp'. Unknown tags are ignored (forward-compatible). */
export interface DenyContext {
  reason: string;
  tags: string[];
}

export interface FetchInatCandidatesOptions {
  /** Max candidates to return (top-N). Drives iNat per_page and the final slice. */
  limit: number;
  /** iNat observation ids to exclude (already shown / denied). */
  excludeIds?: number[];
  /** Deny feedback from a prior round; re-ranks/penalizes the result set. */
  denyContext?: DenyContext;
  baseUrl?: string;
  maxRetries?: number;
  retryBaseMs?: number;
  requestTimeoutMs?: number;
  /** Test-only override of the tier cascade (see client.ts FetchInatPhotoOptions).
   *  Not part of the published contract signature — production callers omit it. */
  tiers?: readonly Tier[];
}

/**
 * Fetches up to `limit` research-grade, CC-licensed (NC/ND denied)
 * iNaturalist candidates for a binomial name, ordered by votes, across the
 * region → US → global geographic cascade. Unlike `fetchInatPhoto` (single
 * top photo), this returns the deep top-N that the curation tool scores and
 * the ingestor gate picks from.
 *
 * `excludeIds` is sent to iNat as `not_id` AND filtered client-side (belt and
 * suspenders — iNat occasionally ignores `not_id` on cascaded place filters).
 * `denyContext` re-ranks the result set (see applyDenyBias).
 *
 * Cascade semantics match fetchInatPhoto: the FIRST tier that returns any
 * candidates wins (we don't merge across tiers — a region hit is more
 * relevant than padding it with global ones). Returns [] when all tiers miss.
 */
export async function fetchInatCandidates(
  sciName: string,
  opts: FetchInatCandidatesOptions
): Promise<InatCandidate[]> {
  const baseUrl = opts.baseUrl ?? INAT_BASE_URL;
  const maxRetries = opts.maxRetries ?? 1;
  const retryBaseMs = opts.retryBaseMs ?? 250;
  const requestTimeoutMs = opts.requestTimeoutMs ?? 30_000;
  const excludeIds = new Set(opts.excludeIds ?? []);
  const tiers = opts.tiers ?? buildTiers();

  for (const tier of tiers) {
    const url = new URL(`${baseUrl}/observations`);
    url.searchParams.set('taxon_name', sciName);
    if (tier.placeId !== null) {
      url.searchParams.set('place_id', tier.placeId);
    }
    url.searchParams.set('quality_grade', 'research');
    url.searchParams.set('photo_license', CC_LICENSES);
    url.searchParams.set('order_by', 'votes'); // best-rated first
    url.searchParams.set('per_page', String(opts.limit));
    url.searchParams.set('photos', 'true');
    if (excludeIds.size > 0) {
      url.searchParams.set('not_id', [...excludeIds].join(','));
    }

    const body = await getJsonWithRetry<InatObservationsResponse>(
      url,
      maxRetries,
      retryBaseMs,
      requestTimeoutMs
    );

    const candidates: InatCandidate[] = [];
    for (const result of body.results) {
      if (excludeIds.has(result.id)) continue; // client-side belt-and-suspenders
      const photo = result.photos[0];
      if (!photo) continue;
      const license = photo.license_code ?? '';
      if (!ALLOWED_LICENSES.has(license)) continue; // backstop: drop NC/ND/ARR/null
      candidates.push({
        inatId: result.id,
        photoUrl: toMediumUrl(photo.url),
        license,
        attribution: photo.attribution,
      });
    }

    if (candidates.length === 0) continue; // cascade to the next tier

    const ranked = applyDenyBias(candidates, opts.denyContext);
    return ranked.slice(0, opts.limit);
  }

  return [];
}

/**
 * Re-ranks candidates by the deny feedback from a prior round. With no
 * denyContext this is identity (preserve iNat's votes order). Each recognized
 * tag carries a penalty heuristic; we can't re-inspect pixels here (that's the
 * scorer's job), so the bias works on the signals available pre-score:
 * attribution/license text and, for variety-seeking tags, de-duplication.
 *
 * This is intentionally a soft re-rank (stable sort by ascending penalty), not
 * a hard filter — the scorer downstream is authoritative; this just surfaces
 * likely-better candidates first so the operator sees them at the top of the
 * alternates strip.
 */
export function applyDenyBias(
  candidates: InatCandidate[],
  denyContext?: DenyContext
): InatCandidate[] {
  if (!denyContext || denyContext.tags.length === 0) return candidates;
  const tags = new Set(denyContext.tags);

  const penalty = (c: InatCandidate): number => {
    let p = 0;
    const attr = c.attribution.toLowerCase();
    // captive/feeder deny → down-rank candidates whose attribution hints at a
    // feeder/captive/zoo/aviary setting (the only pre-score signal we have).
    if (tags.has('captive-feeder') && /feeder|captive|zoo|aviary|rehab/.test(attr)) {
      p += 10;
    }
    // wrong-sex/morph deny → bias toward variety: penalize same-photographer
    // near-duplicates is handled by the de-dup pass below, so this tag mostly
    // relaxes ordering. A small constant nudge keeps the original top from
    // dominating after a wrong-morph deny.
    if (tags.has('wrong-sex-morph')) {
      p += 1;
    }
    return p;
  };

  let ranked = [...candidates]
    .map((c, i) => ({ c, i, p: penalty(c) }))
    // stable sort: ascending penalty, then original (votes) order.
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.c);

  // For variety-seeking denials, drop adjacent same-photographer duplicates so
  // the operator isn't shown five near-identical frames by one contributor.
  if (tags.has('wrong-sex-morph') || tags.has('cluttered-background')) {
    ranked = dedupeByPhotographer(ranked);
  }
  return ranked;
}

/** Keep the first candidate per photographer (parsed from the "(c) Name, ..."
 *  attribution prefix), preserving order. Returns the deduped list followed by
 *  the dropped duplicates appended at the end (so we never shrink below what
 *  the caller's `limit` could fill). */
function dedupeByPhotographer(candidates: InatCandidate[]): InatCandidate[] {
  const seen = new Set<string>();
  const primary: InatCandidate[] = [];
  const dupes: InatCandidate[] = [];
  for (const c of candidates) {
    const m = c.attribution.match(/^\(c\)\s*([^,]+)/i);
    const who = (m?.[1] ?? c.attribution).trim().toLowerCase();
    if (seen.has(who)) {
      dupes.push(c);
    } else {
      seen.add(who);
      primary.push(c);
    }
  }
  return [...primary, ...dupes];
}
