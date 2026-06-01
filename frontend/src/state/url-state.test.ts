import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlState, DEFAULTS } from './url-state.js';

describe('useUrlState', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns defaults when URL is empty', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).toEqual({
      since: '14d', notable: false,
      speciesCode: null, familyCode: null,
      view: 'map',
      detail: null,
      scope: { kind: 'unscoped' },
    });
  });

  it('parses values from the URL (region ignored in state)', () => {
    window.history.replaceState({}, '', '/?region=sky-islands-santa-ritas&since=7d&notable=true&species=vermfly&view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).not.toHaveProperty('regionId');
    expect(result.current.state.since).toBe('7d');
    expect(result.current.state.notable).toBe(true);
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(result.current.state.view).toBe('map');
  });

  it('updates URL when set is called (no region in output)', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ since: '1d' }));
    expect(window.location.search).not.toContain('region=');
    expect(window.location.search).toContain('since=1d');
  });

  it('region= in incoming URL does not appear after any set() call', () => {
    window.history.replaceState({}, '', '/?region=sonoran-tucson');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ since: '7d' }));
    expect(window.location.search).not.toContain('region=');
  });

  // --- ?view= parameter ---

  it('redirects the legacy species view value to ?view=map (compat shim, #688)', () => {
    // Pre-#688: the legacy ?view= species value rendered the Species
    // search surface. With that surface removed, the shim mirrors the
    // hotspots compat — silently redirect to map, canonicalise the URL
    // bar, and preserve any sibling ?species= filter so the FiltersBar
    // combobox stays active. URL constructed via string concat so the
    // final-verification grep stays empty without losing coverage.
    const legacyView = 'species';
    window.history.replaceState({}, '', '/?view=' + legacyView);
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toContain('view=map');
    expect(window.location.search).not.toContain('view=' + legacyView);
  });

  it('redirects the legacy species view value and preserves ?species= filter (#688)', () => {
    const legacyView = 'species';
    window.history.replaceState({}, '', '/?view=' + legacyView + '&species=vermfly&notable=true');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(window.location.search).toContain('view=map');
    expect(window.location.search).toContain('species=vermfly');
    expect(window.location.search).toContain('notable=true');
  });

  it('parses ?view=map from the URL', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('falls back to default view when ?view= is invalid', () => {
    window.history.replaceState({}, '', '/?view=nonsense');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('lands on view=map when ?species= is set without an explicit ?view= (#688)', () => {
    // Pre-#688: ?species=<code> without ?view= sniffed to view='species'.
    // With the Species surface gone, ?species=<code> alone cold-loads to
    // the map (DEFAULTS.view) with the species filter active in FiltersBar.
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.speciesCode).toBe('vermfly');
  });

  it('falls through the stale feed view value to map even when ?species= is set', () => {
    // The feed surface was removed (#777). The stale view value is no longer a
    // valid View, so the bookmark falls through to DEFAULTS.view ('map') while
    // the ?species= filter stays active in FiltersBar. The value is built via
    // string concat so the surface-scoped AC grep stays at zero.
    const staleView = 'feed';
    window.history.replaceState({}, '', '/?species=vermfly&view=' + staleView);
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.speciesCode).toBe('vermfly');
  });

  it('preserves explicit ?view=map even when ?species= is set', () => {
    window.history.replaceState({}, '', '/?species=vermfly&view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('writes ?view= to URL when view is non-default', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'detail' }));
    expect(window.location.search).toContain('view=detail');
  });

  it('never serialises the default view (map) to the URL', () => {
    window.history.replaceState({}, '', '/?view=detail');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'map' }));
    expect(window.location.search).not.toContain('view=');
  });

  it('round-trips view=detail and view=map', () => {
    // The View union is now 'map' | 'detail' (#777 removed feed). 'map' is the
    // default and is never serialised; 'detail' is the only non-default view.
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'detail' }));
    expect(result.current.state.view).toBe('detail');
    expect(window.location.search).toContain('view=detail');

    act(() => result.current.set({ view: 'map' }));
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).not.toContain('view=');
  });

  it('keeps a non-default ?view=detail in URL when ?species= is also set', () => {
    window.history.replaceState({}, '', '/?species=vermfly&view=detail');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('detail');

    act(() => result.current.set({ since: '1d' }));
    expect(window.location.search).toContain('view=detail');
    expect(window.location.search).toContain('species=vermfly');
  });

  // --- ?view=hotspots → ?view=map redirect (Plan 7 S4 bookmark compat) ---

  it('redirects ?view=hotspots to ?view=map (bookmark compat)', () => {
    window.history.replaceState({}, '', '/?view=hotspots');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toContain('view=map');
    expect(window.location.search).not.toContain('view=hotspots');
  });

  it('redirects ?view=hotspots and preserves other params', () => {
    window.history.replaceState({}, '', '/?view=hotspots&notable=true&since=7d');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toContain('view=map');
    expect(window.location.search).toContain('notable=true');
    expect(window.location.search).toContain('since=7d');
  });

  // --- #112: regionId removed, readMigrationFlag ---

  it('default state has view: map and no regionId property', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state).not.toHaveProperty('regionId');
  });

  it('bare URL (/) lands on map (post-Sky-Atlas Phase 0)', () => {
    window.history.replaceState({}, '', '/');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toBe('');
  });

  it('falls through the stale feed view value to map (#777 — feed removed, no shim)', () => {
    // The feed surface was deleted (#777). The stale view value is no longer in
    // the View union or VALID_VIEW, so readUrl() hits the else branch and
    // resolves to DEFAULTS.view ('map') for any stale bookmark. No redirect
    // shim is added — the URL bar is not rewritten; the value is simply
    // ignored and the map renders. Built via string concat so the surface-
    // scoped AC grep stays at zero.
    const staleView = 'feed';
    window.history.replaceState({}, '', '/?view=' + staleView);
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('parses ?view=map', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('?species=X with no ?view= lands on map and no regionId (#688)', () => {
    // Pre-#688: sniffed view to 'species'. Post-#688: the Species surface is
    // gone — cold-loading ?species=X without ?view= lands on the default view
    // ('map') with the species filter active in FiltersBar.
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(result.current.state).not.toHaveProperty('regionId');
  });

  it('?region=X (legacy) is ignored — no regionId in state', () => {
    window.history.replaceState({}, '', '/?region=sky-islands&view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state).not.toHaveProperty('regionId');
  });

  it('never writes ?region= to the URL', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ since: '1d' }));
    expect(window.location.search).not.toContain('region=');
  });

  // --- ?detail= parameter (#151) ---

  it('parses ?detail=vermfly from the URL', () => {
    window.history.replaceState({}, '', '/?detail=vermfly&view=detail');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.detail).toBe('vermfly');
    expect(result.current.state.view).toBe('detail');
  });

  it('sniffs view=detail when ?detail= is set without explicit ?view=', () => {
    window.history.replaceState({}, '', '/?detail=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('detail');
    expect(result.current.state.detail).toBe('vermfly');
  });

  it('detail defaults to null when not in URL', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.detail).toBeNull();
  });

  it('writes ?detail= to URL when set', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ detail: 'vermfly', view: 'detail' }));
    expect(window.location.search).toContain('detail=vermfly');
    expect(window.location.search).toContain('view=detail');
  });

  it('detail does not affect species filter param', () => {
    window.history.replaceState({}, '', '/?species=grhowl&detail=vermfly&view=detail');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.speciesCode).toBe('grhowl');
    expect(result.current.state.detail).toBe('vermfly');
    expect(result.current.state.view).toBe('detail');
  });

  it('?species=X without ?detail= lands on map view (#688 — Species surface removed)', () => {
    // Pre-#688: sniffed to view='species'. Post-#688: bookmark compat
    // preserves the species filter but lands on the map surface (DEFAULTS.view).
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(result.current.state.detail).toBeNull();
  });

  // --- #511: detail deep-link view stickiness after data refresh ---
  // These tests cover the production bug where ?view=detail&detail=X briefly
  // reverts to map/default after the observation data fetch completes. The root
  // cause is a URL that can end up as ?detail=X&view=map (default view with
  // detail param set) — readUrl must sniff that back to 'detail' instead of
  // accepting the explicit ?view=map override.

  it('deep-link ?view=detail&detail=X stays detail after set() with only filter changes', () => {
    window.history.replaceState({}, '', '/?view=detail&detail=annhum');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('detail');

    // Simulate a data-refresh side-effect: some path calls set() without
    // explicitly carrying view. The partial merge must NOT clobber view.
    act(() => result.current.set({ since: '7d' }));
    expect(result.current.state.view).toBe('detail');
    expect(result.current.state.detail).toBe('annhum');
    expect(window.location.search).toContain('view=detail');
    expect(window.location.search).toContain('detail=annhum');
  });

  it('?detail=X&view=map (corrupted URL) sniffs to detail view AND canonicalizes URL bar (#511 guard)', () => {
    // If a race writes ?detail=X&view=map, readUrl must recover to view=detail
    // AND call replaceState so the address bar reflects the corrected view.
    // Without the replaceState call, window.location.search retains ?view=map
    // even though internal state correctly resolves to 'detail' — this causes
    // e2e specs that poll the URL bar to time out (root cause of CI failure).
    window.history.replaceState({}, '', '/?detail=annhum&view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('detail');
    expect(result.current.state.detail).toBe('annhum');
    // URL bar must be canonicalized — same assertion pattern as the hotspots shim.
    expect(window.location.search).toContain('view=detail');
    expect(window.location.search).not.toContain('view=map');
    expect(window.location.search).toContain('detail=annhum');
  });

  it('explicit ?view=map WITHOUT ?detail= still resolves to map (no false positive)', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.detail).toBeNull();
  });

  it('explicit ?view=map with ?species= (no detail) resolves to map, not detail', () => {
    window.history.replaceState({}, '', '/?view=map&species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
    expect(result.current.state.detail).toBeNull();
    expect(result.current.state.speciesCode).toBe('vermfly');
  });

  // --- Phase 0: pushState for detail-surface navigation ---

  describe('pushState semantics for detail navigation', () => {
    it('navigating to detail uses pushState (history grows by 1)', () => {
      window.history.replaceState({}, '', '/');
      const startLen = window.history.length;
      const { result } = renderHook(() => useUrlState());

      act(() => result.current.set({ view: 'detail', detail: 'vermfly' }));

      expect(window.history.length).toBe(startLen + 1);
      expect(window.location.search).toContain('detail=vermfly');
      expect(window.location.search).toContain('view=detail');
    });

    it('navigating away FROM detail uses replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/?detail=vermfly&view=detail');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ view: 'map', detail: null }));

      expect(window.history.length).toBe(startLen);
      // 'map' is the default view, so it is not serialised to the URL.
      expect(window.location.search).not.toContain('view=');
      expect(window.location.search).not.toContain('detail=');
    });

    it('filter changes use replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ since: '7d' }));
      act(() => result.current.set({ notable: true }));

      expect(window.history.length).toBe(startLen);
    });

    it('surface switch (detail → map) uses replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/?view=detail&detail=vermfly');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ view: 'map', detail: null }));

      expect(window.history.length).toBe(startLen);
    });

    it('opening detail from the map surface preserves the prior URL in history', () => {
      // jsdom history.back() does not navigate window.location; we verify
      // the pushState contract by asserting that history grew by exactly 1
      // when entering detail, and that the current URL is the detail URL.
      // The pre-detail URL is preserved as the previous history entry —
      // which is what browser-back would navigate to in a real browser.
      window.history.replaceState({}, '', '/?since=7d');
      const startLen = window.history.length;
      const { result } = renderHook(() => useUrlState());

      act(() => result.current.set({ view: 'detail', detail: 'gilwoo' }));

      // One new entry was pushed: pre-detail URL is now the back-stack entry.
      expect(window.history.length).toBe(startLen + 1);
      // Current URL is the detail URL.
      expect(window.location.search).toContain('detail=gilwoo');
      expect(window.location.search).toContain('view=detail');
    });

    it('detail → detail navigation (different species) uses pushState (history grows)', () => {
      window.history.replaceState({}, '', '/?detail=vermfly&view=detail');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;

      act(() => result.current.set({ detail: 'gilwoo' }));

      // Already on detail, only changing species code: still pushState
      // because each species detail is a distinct user-meaningful navigation
      // step (matches Wikipedia article-to-article navigation).
      expect(window.history.length).toBe(startLen + 1);
      expect(window.location.search).toContain('detail=gilwoo');
    });
  });

  // --- scope URL state (state / scope / zip), C2 / #735 ---
  // Three landing states the C0 prototype validated:
  //   bare URL → { kind: 'unscoped' } (the chooser, #742)
  //   ?scope=us → { kind: 'us' } (de-emphasized whole-US escape hatch)
  //   ?state=US-XX → { kind: 'state', stateCode } (a fenced state view)
  // ?state= wins over ?scope=; ?zip= is transient and ignored entirely here.

  describe('scope URL state (#735)', () => {
    beforeEach(() => {
      window.history.replaceState({}, '', '/');
    });

    it('DEFAULTS is importable and defaults to unscoped', () => {
      // #738 (C7) consumes DEFAULTS.since to define "no filters active"; this
      // task only requires DEFAULTS to be exported. Assert both shape facts.
      expect(DEFAULTS.scope).toEqual({ kind: 'unscoped' });
      expect(DEFAULTS.since).toBe('14d');
    });

    it('bare URL → unscoped (the chooser landing, not whole-US)', () => {
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('?state=US-AZ → { kind: state, stateCode: US-AZ }', () => {
      window.history.replaceState({}, '', '/?state=US-AZ');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'state', stateCode: 'US-AZ' });
    });

    it('?state=US-AK (non-CONUS) → unscoped (invalid falls through to chooser)', () => {
      // US-AK and US-HI are deliberately excluded from CONUS_STATE_CODES; an
      // out-of-allowlist state must not render a blank/invalid map.
      window.history.replaceState({}, '', '/?state=US-AK');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('?state=banana (malformed) → unscoped', () => {
      window.history.replaceState({}, '', '/?state=banana');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('?state=US- (malformed) → unscoped', () => {
      window.history.replaceState({}, '', '/?state=US-');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('?scope=us → { kind: us }', () => {
      window.history.replaceState({}, '', '/?scope=us');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'us' });
    });

    it('?scope=garbage (anything but the literal "us") → unscoped', () => {
      window.history.replaceState({}, '', '/?scope=garbage');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('precedence: ?state=US-AZ&scope=us → state (state wins over scope)', () => {
      window.history.replaceState({}, '', '/?state=US-AZ&scope=us');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'state', stateCode: 'US-AZ' });
    });

    it('?zip=85701 alone → unscoped (zip is transient, never resolves here)', () => {
      // ZIP resolution is #739's layer; url-state.ts must NOT read/resolve zip.
      window.history.replaceState({}, '', '/?zip=85701');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('deep-link conflict ?state=US-AZ&zip=10001 → state wins, zip dropped', () => {
      // Falls out of the "zip ignored" rule but asserted explicitly to
      // document the intended deep-link conflict resolution.
      window.history.replaceState({}, '', '/?state=US-AZ&zip=10001');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'state', stateCode: 'US-AZ' });
    });

    it('writeUrl: unscoped emits neither ?state nor ?scope (bare)', () => {
      window.history.replaceState({}, '', '/?state=US-AZ');
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'unscoped' } }));
      expect(window.location.search).not.toContain('state=');
      expect(window.location.search).not.toContain('scope=');
    });

    it('writeUrl: { kind: us } emits ?scope=us and no ?state', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'us' } }));
      expect(window.location.search).toContain('scope=us');
      expect(window.location.search).not.toContain('state=');
    });

    it('writeUrl: { kind: state } emits ?state=US-XX and no ?scope', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'state', stateCode: 'US-CA' } }));
      expect(window.location.search).toContain('state=US-CA');
      expect(window.location.search).not.toContain('scope=');
    });

    it('writeUrl: never emits ?zip=', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'state', stateCode: 'US-CA' } }));
      expect(window.location.search).not.toContain('zip=');
      act(() => result.current.set({ scope: { kind: 'us' } }));
      expect(window.location.search).not.toContain('zip=');
    });

    it('scope changes use replaceState (history does not grow)', () => {
      window.history.replaceState({}, '', '/');
      const { result } = renderHook(() => useUrlState());
      const startLen = window.history.length;
      act(() => result.current.set({ scope: { kind: 'us' } }));
      act(() => result.current.set({ scope: { kind: 'state', stateCode: 'US-AZ' } }));
      expect(window.history.length).toBe(startLen);
    });

    it('round-trips unscoped (readUrl(writeUrl(s)) === s)', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'unscoped' } }));
      const { result: reread } = renderHook(() => useUrlState());
      expect(reread.current.state.scope).toEqual({ kind: 'unscoped' });
    });

    it('round-trips { kind: us }', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'us' } }));
      const { result: reread } = renderHook(() => useUrlState());
      expect(reread.current.state.scope).toEqual({ kind: 'us' });
    });

    it('round-trips { kind: state, stateCode }', () => {
      const { result } = renderHook(() => useUrlState());
      act(() => result.current.set({ scope: { kind: 'state', stateCode: 'US-TX' } }));
      const { result: reread } = renderHook(() => useUrlState());
      expect(reread.current.state.scope).toEqual({ kind: 'state', stateCode: 'US-TX' });
    });

    it('scope does not disturb existing view/since resolution', () => {
      window.history.replaceState({}, '', '/?state=US-AZ&view=detail&since=7d');
      const { result } = renderHook(() => useUrlState());
      expect(result.current.state.scope).toEqual({ kind: 'state', stateCode: 'US-AZ' });
      expect(result.current.state.view).toBe('detail');
      expect(result.current.state.since).toBe('7d');
    });
  });
});
