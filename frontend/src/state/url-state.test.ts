import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlState } from './url-state.js';

describe('useUrlState', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('returns defaults when URL is empty', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).toEqual({
      since: '14d', notable: false,
      speciesCode: null, familyCode: null,
      view: 'feed',
      detail: null,
    });
  });

  it('parses values from the URL (region ignored in state)', () => {
    window.history.replaceState({}, '', '/?region=sky-islands-santa-ritas&since=7d&notable=true&species=vermfly&view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state).not.toHaveProperty('regionId');
    expect(result.current.state.since).toBe('7d');
    expect(result.current.state.notable).toBe(true);
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(result.current.state.view).toBe('feed');
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

  it('parses ?view=species from the URL', () => {
    window.history.replaceState({}, '', '/?view=species');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('species');
  });

  it('parses ?view=map from the URL', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('falls back to default view when ?view= is invalid', () => {
    window.history.replaceState({}, '', '/?view=nonsense');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
  });

  it('sniffs view=species when ?species= is set without an explicit ?view=', () => {
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('species');
  });

  it('preserves explicit ?view=feed even when ?species= is set', () => {
    window.history.replaceState({}, '', '/?species=vermfly&view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
  });

  it('preserves explicit ?view=map even when ?species= is set', () => {
    window.history.replaceState({}, '', '/?species=vermfly&view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('writes ?view= to URL when view is non-default', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'map' }));
    expect(window.location.search).toContain('view=map');
  });

  it('never serialises the default view to the URL', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'feed' }));
    expect(window.location.search).not.toContain('view=');
  });

  it('round-trips all three view values', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'species' }));
    expect(result.current.state.view).toBe('species');
    expect(window.location.search).toContain('view=species');

    act(() => result.current.set({ view: 'map' }));
    expect(result.current.state.view).toBe('map');
    expect(window.location.search).toContain('view=map');

    act(() => result.current.set({ view: 'feed' }));
    expect(result.current.state.view).toBe('feed');
    expect(window.location.search).not.toContain('view=');
  });

  it('keeps ?view=feed in URL when ?species= is also set', () => {
    // Without this, readUrl's species-sniff silently reverts the user's
    // explicit feed choice back to 'species' on the next popstate/reload.
    window.history.replaceState({}, '', '/?species=vermfly&view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');

    act(() => result.current.set({ since: '1d' }));
    expect(window.location.search).toContain('view=feed');
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

  it('default state has view: feed and no regionId property', () => {
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
    expect(result.current.state).not.toHaveProperty('regionId');
  });

  it('parses ?view=map', () => {
    window.history.replaceState({}, '', '/?view=map');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('map');
  });

  it('?species=X with no ?view= sniffs view to species and no regionId', () => {
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('species');
    expect(result.current.state).not.toHaveProperty('regionId');
  });

  it('?region=X&view=feed → view=feed and no regionId in state', () => {
    window.history.replaceState({}, '', '/?region=sky-islands&view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('feed');
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

  it('?species=X without ?detail= still sniffs to species view (bookmark compat)', () => {
    window.history.replaceState({}, '', '/?species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('species');
    expect(result.current.state.detail).toBeNull();
  });
});
