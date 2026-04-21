import { useCallback, useEffect, useState } from 'react';

export type Since = '1d' | '7d' | '14d' | '30d';
export type View = 'feed' | 'species' | 'hotspots';

export interface UrlState {
  speciesCode: string | null;
  familyCode: string | null;
  since: Since;
  notable: boolean;
  view: View;
}

const DEFAULTS: UrlState = {
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
  // Side-channel read: detect ?region= for migration banner.
  // The value is NOT stored in UrlState — use readMigrationFlag() instead.
  p.get('region');

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
    speciesCode,
    familyCode: p.get('family'),
    since: since && VALID_SINCE.has(since) ? (since as Since) : DEFAULTS.since,
    notable: p.get('notable') === 'true',
    view,
  };
}

function writeUrl(state: UrlState): void {
  const p = new URLSearchParams();
  // Never write ?region= — region selection is gone in Release 2.
  if (state.speciesCode) p.set('species', state.speciesCode);
  if (state.familyCode) p.set('family', state.familyCode);
  if (state.since !== DEFAULTS.since) p.set('since', state.since);
  if (state.notable) p.set('notable', 'true');
  // Emit ?view= when non-default, OR when ?species= is set and view is 'feed'
  // — otherwise the species sniff in readUrl silently reverts the user's
  // explicit 'feed' choice back to 'species' on reload/popstate.
  if (state.view !== DEFAULTS.view || state.speciesCode) {
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
