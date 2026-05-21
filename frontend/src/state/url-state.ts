import { useCallback, useEffect, useState } from 'react';
import { analytics } from '../analytics.js';

// #667 — `'30d'` removed from Since. The server still soft-accepts it for one
// release window (coerced to 14d + Deprecation header), but the frontend no
// longer emits it. Bookmarked `?since=30d` URLs fall back to default `'14d'`
// via the existing `VALID_SINCE.has(...)` check below.
export type Since = '1d' | '7d' | '14d';
export type View = 'feed' | 'map' | 'detail';
export type BBox = readonly [number, number, number, number];

export interface UrlState {
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
  view: View;
  detail: string | null;
  bbox: BBox | null;
}

const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'map',
  detail: null,
  bbox: null, // Phase 3 (#560) — Cluster→SpeciesDetailSurface bbox filter
};

const VALID_SINCE: ReadonlySet<string> = new Set(['1d', '7d', '14d']);
const VALID_VIEW: ReadonlySet<string> = new Set(['feed', 'map', 'detail']);

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const since = p.get('since');
  const rawView = p.get('view');
  const speciesCode = p.get('species');
  const detail = p.get('detail');

  // View resolution:
  //  - explicit, valid ?view= wins — EXCEPT the #511 guard below.
  //  - absent ?view= AND ?detail= set → sniff to 'detail'.
  //  - absent ?view= AND ?species= set (without ?detail=) → default 'map'
  //    with the species filter active. (Pre-#688 sniffed to 'species'; the
  //    Species tab is gone — bookmarked ?species= URLs now land on the map
  //    surface with the FiltersBar species combobox carrying the value.)
  //  - otherwise default (DEFAULTS.view — currently 'map').
  //
  // #511 guard: if ?detail= is set and the resolved view is the default
  // ('map'), sniff to 'detail' regardless of the explicit ?view=map.
  // Rationale: ?detail=X&view=map is a corrupted URL that can be produced
  // by a race between a view-reset write and the browser history. Honouring
  // ?view=map in that case silently drops the deep-link intent and lands the
  // user on the map surface. Sniffing to 'detail' is safe because there is
  // no valid user-authored URL where ?detail= is set but the intended surface
  // is map (detail always implies the detail surface; users navigating from
  // detail→map via the tab strip will have ?detail= cleared by onCloseDetail
  // or their URL entry won't carry ?detail= at all).
  let view: View;
  if (rawView === 'hotspots' || rawView === 'species') {
    // Compatibility shim: old bookmarks with ?view=hotspots OR the legacy
    // ?view= species value silently redirect to ?view=map. The URL bar
    // updates so future shares carry the new value; any sibling
    // ?species=<code> is preserved so the FiltersBar species combobox
    // stays active. The Species surface was removed in #688 — its filter
    // UX folds into the FiltersBar combobox, and the navigation UX folds
    // into clicking a feed row / map marker.
    view = 'map';
    const redirect = new URLSearchParams(window.location.search);
    redirect.set('view', 'map');
    const q = redirect.toString();
    const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  } else if (rawView && VALID_VIEW.has(rawView)) {
    view = rawView as View;
    // #511 guard: ?detail=X&view=map → sniff to detail AND canonicalize
    // the URL bar so future popstate reads reflect the corrected view.
    // Mirrors the ?view=hotspots shim above: update internal state AND
    // call replaceState so the address bar agrees with readUrl's output.
    // Without replaceState the address bar retains ?view=map which causes
    // e2e URL assertions that poll window.location.search to time out.
    if (view === DEFAULTS.view && detail) {
      view = 'detail';
      // Capture the corrupted URL BEFORE replaceState rewrites it so the
      // instrumentation payload carries the original form.
      const corruptedUrl = window.location.pathname + window.location.search;
      const canonical = new URLSearchParams(window.location.search);
      canonical.set('view', 'detail');
      const cq = canonical.toString();
      const canonicalUrl = cq
        ? `${window.location.pathname}?${cq}`
        : window.location.pathname;
      window.history.replaceState({}, '', canonicalUrl);
      // Instrumentation: log + Clarity event so the real emitter can be
      // identified in production. Root cause is unidentified — see #511
      // and PR #517. Follow-up issue: #518.
      console.warn('[#511 guard] Corrupted URL detected and recovered:', corruptedUrl);
      analytics.capture('url_corruption_recovered_511', {
        corrupted_url: corruptedUrl,
        detail_code: detail,
      });
    }
  } else if (!rawView && detail) {
    view = 'detail';
  } else {
    // Pre-#688: ?species= without ?view= sniffed to view='species'. With the
    // Species surface gone, the species filter is part of FiltersBar which
    // narrows whatever surface the user is on — fall through to DEFAULTS.view
    // ('map') so bookmarked ?species= URLs cold-load to the map with the
    // filter active.
    view = DEFAULTS.view;
  }

  // Phase 3 (#560) — bbox URL state for cluster→SpeciesDetailSurface filter.
  // Format: ?bbox=lngMin,latMin,lngMax,latMax (4 comma-separated, 6 decimals).
  // Defensive parsing: reject any malformed input as null so a corrupted
  // shared URL doesn't break rendering. Range checks: lng ∈ [-180, 180],
  // lat ∈ [-90, 90]. NaN/Infinity are rejected.
  let bbox: BBox | null = null;
  const rawBbox = p.get('bbox');
  if (rawBbox !== null) {
    const parts = rawBbox.split(',').map(Number);
    if (parts.length === 4) {
      const [p0, p1, p2, p3] = parts as [number, number, number, number];
      if (
        Number.isFinite(p0) && Number.isFinite(p1) &&
        Number.isFinite(p2) && Number.isFinite(p3) &&
        p0 >= -180 && p0 <= 180 &&
        p2 >= -180 && p2 <= 180 &&
        p1 >= -90 && p1 <= 90 &&
        p3 >= -90 && p3 <= 90
      ) {
        // Round each to 6 decimals on read so downstream comparisons are stable.
        bbox = [round6(p0), round6(p1), round6(p2), round6(p3)] as const;
      }
    }
  }

  return {
    speciesCode,
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
    view,
    detail,
    bbox,
  };
}

function writeUrl(state: UrlState, push: boolean = false): void {
  const p = new URLSearchParams();
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  if (state.detail) p.set('detail', state.detail);
  // Emit ?view= only when non-default. The Species surface was removed in
  // #688, so the historical "emit ?view= when ?species= set on default view"
  // branch is no longer needed — there is no sniff in readUrl that could
  // silently flip ?view= to a non-default value based on ?species= alone.
  //
  // We deliberately DO NOT emit ?view=map when only ?detail= is set: the
  // in-place detail rail keeps view=map as the underlying surface, and the
  // readUrl sniff already promotes ?detail=X (no ?view=) to view='detail' for
  // backward compat with shared deep-links. Emitting view=map here would also
  // bypass the #511 guard on every fresh ?detail= write.
  if (state.view !== DEFAULTS.view) {
    p.set('view', state.view);
  }
  if (state.bbox !== null) {
    const lngMin = round6(state.bbox[0]);
    const latMin = round6(state.bbox[1]);
    const lngMax = round6(state.bbox[2]);
    const latMax = round6(state.bbox[3]);
    p.set('bbox', `${lngMin},${latMin},${lngMax},${latMax}`);
  } else {
    p.delete('bbox');
  }
  const q = p.toString();
  const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    if (push) {
      // Detail-surface entry: push so browser-back returns to the prior
      // surface. All other navigations replace (filter changes, tab switches,
      // leaving detail).
      window.history.pushState({}, '', newUrl);
    } else {
      window.history.replaceState({}, '', newUrl);
    }
  }
}

export function useUrlState(): {
  state: UrlState;
  set: (partial: Partial<UrlState>) => void;
} {
  const [state, setState] = useState<UrlState>(readUrl);

  useEffect(() => {
    const onPop = () => setState(readUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const set = useCallback((partial: Partial<UrlState>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      // Push (vs replace) when the user is navigating INTO the detail
      // surface, OR navigating between two different species details.
      // Both cases are user-meaningful "I clicked into a thing" moves
      // that the browser back button should undo. Filter changes and
      // surface switches (feed/map) keep replaceState so the history
      // stack doesn't grow on every chip toggle.
      const push =
        // Entering detail from a non-detail surface
        (next.view === 'detail' && prev.view !== 'detail') ||
        // Switching between two species on the detail surface
        (next.view === 'detail' && prev.view === 'detail' && next.detail !== prev.detail);
      writeUrl(next, push);
      return next;
    });
  }, []);

  return { state, set };
}
