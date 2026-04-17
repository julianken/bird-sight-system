import { useCallback, useEffect, useState } from 'react';

export type Since = '1d' | '7d' | '14d' | '30d';

export interface UrlState {
  regionId: string | null;
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
}

const DEFAULTS: UrlState = {
  regionId: null,
  speciesCode: null,
  familyCode: null,
  since: '14d',
  notable: false,
};

const VALID_SINCE: ReadonlySet<string> = new Set(['1d', '7d', '14d', '30d']);

function readUrl(): UrlState {
  const p = new URLSearchParams(window.location.search);
  const since = p.get('since');
  return {
    regionId: p.get('region'),
    speciesCode: p.get('species'),
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
  };
}

function writeUrl(state: UrlState): void {
  const p = new URLSearchParams();
  if (state.regionId) p.set('region', state.regionId);
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
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
