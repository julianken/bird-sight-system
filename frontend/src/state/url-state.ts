import { useCallback, useEffect, useState } from 'react';

export type Since = '1d' | '7d' | '14d' | '30d';
export type View = 'feed' | 'species' | 'map' | 'detail';

export interface UrlState {
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
  view: View;
  detail: string | null;
}

const DEFAULTS: UrlState = {
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'feed',
  detail: null,
};

const VALID_SINCE: ReadonlySet<string> = new Set(['1d', '7d', '14d', '30d']);
const VALID_VIEW: ReadonlySet<string> = new Set(['feed', 'species', 'map', 'detail']);

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const since = p.get('since');
  const rawView = p.get('view');
  const speciesCode = p.get('species');
  const detail = p.get('detail');
  // Side-channel read: detect ?region= for migration banner.
  // The value is NOT stored in UrlState — use readMigrationFlag() instead.
  p.get('region');

  // View resolution:
  //  - explicit, valid ?view= wins.
  //  - absent ?view= AND ?species= set (without ?detail=) → sniff to
  //    'species' so bookmarked species-filter URLs land on the search
  //    surface with the filter active, NOT the detail surface.
  //  - absent ?view= AND ?detail= set → sniff to 'detail'.
  //  - otherwise default ('feed').
  let view: View;
  if (rawView === 'hotspots') {
    // Compatibility shim: old bookmarks with ?view=hotspots silently redirect
    // to ?view=map. The URL bar updates so future shares carry the new value.
    view = 'map';
    const redirect = new URLSearchParams(window.location.search);
    redirect.set('view', 'map');
    const q = redirect.toString();
    const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
  } else if (rawView && VALID_VIEW.has(rawView)) {
    view = rawView as View;
  } else if (!rawView && detail) {
    view = 'detail';
  } else if (!rawView && speciesCode) {
    view = 'species';
  } else {
    view = DEFAULTS.view;
  }

  return {
    speciesCode,
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
    view,
    detail,
  };
}

function writeUrl(state: UrlState): void {
  const p = new URLSearchParams();
  // Never write ?region= — region selection is gone in Release 2.
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  if (state.detail) p.set('detail', state.detail);
  // Emit ?view= when non-default, OR when ?species= or ?detail= is set and
  // view is 'feed' — otherwise the sniff in readUrl silently reverts the
  // user's explicit 'feed' choice back to 'species'/'detail' on reload/popstate.
  if (state.view !== DEFAULTS.view || state.speciesCode || state.detail) {
    p.set('view', state.view);
  }
  const q = p.toString();
  const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    window.history.replaceState({}, '', newUrl);
  }
}

/**
 * Returns true when the current URL contains a ?region= parameter.
 * Used to show the MigrationBanner for users with bookmarked region URLs.
 * Release 2: remove this function and `readMigrationFlag` after `?region=` traffic ages out.
 */
export function readMigrationFlag(): boolean {
  return new URLSearchParams(window.location.search).has('region');
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
      writeUrl(next);
      return next;
    });
  }, []);

  return { state, set };
}
