import { useCallback, useEffect, useState } from 'react';

export type Since = '1d' | '7d' | '14d' | '30d';
export type View = 'feed' | 'species' | 'hotspots';

export interface UrlState {
  regionId: string | null;
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
  view: View;
}

const DEFAULTS: UrlState = {
  regionId: null,
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
  view: 'feed',
};

const VALID_SINCE: ReadonlySet<string> = new Set(['1d', '7d', '14d', '30d']);
const VALID_VIEW: ReadonlySet<string> = new Set(['feed', 'species', 'hotspots']);

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const since = p.get('since');
  const rawView = p.get('view');
  const speciesCode = p.get('species');

  // View resolution:
  //  - explicit, valid ?view= wins.
  //  - absent ?view= AND ?species= set → sniff to 'species' so bookmarked
  //    species URLs land on the search surface with the panel open.
  //  - otherwise default ('feed').
  let view: View;
  if (rawView && VALID_VIEW.has(rawView)) {
    view = rawView as View;
  } else if (!rawView && speciesCode) {
    view = 'species';
  } else {
    view = DEFAULTS.view;
  }

  return {
    regionId: p.get('region'),
    speciesCode,
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
    view,
  };
}

function writeUrl(state: UrlState): void {
  const p = new URLSearchParams();
  if (state.regionId) p.set('region', state.regionId);
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  if (state.view !== DEFAULTS.view) p.set('view', state.view);
  const q = p.toString();
  const newUrl = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  if (newUrl !== window.location.pathname + window.location.search) {
    window.history.replaceState({}, '', newUrl);
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
      writeUrl(next);
      return next;
    });
  }, []);

  return { state, set };
}
