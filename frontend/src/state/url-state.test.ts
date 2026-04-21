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
      regionId: null, speciesCode: null, familyCode: null,
      view: 'feed',
    });
  });

  it('parses values from the URL', () => {
    window.history.replaceState({}, '', '/?region=sky-islands-santa-ritas&since=7d&notable=true&species=vermfly&view=feed');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.regionId).toBe('sky-islands-santa-ritas');
    expect(result.current.state.since).toBe('7d');
    expect(result.current.state.notable).toBe(true);
    expect(result.current.state.speciesCode).toBe('vermfly');
    expect(result.current.state.view).toBe('feed');
  });

  it('updates URL when set is called', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ regionId: 'sonoran-tucson', since: '1d' }));
    expect(window.location.search).toContain('region=sonoran-tucson');
    expect(window.location.search).toContain('since=1d');
    expect(result.current.state.regionId).toBe('sonoran-tucson');
  });

  it('removes a key when set to null', () => {
    window.history.replaceState({}, '', '/?region=sonoran-tucson');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ regionId: null }));
    expect(window.location.search).not.toContain('region=');
  });

  // --- ?view= parameter ---

  it('parses ?view=species from the URL', () => {
    window.history.replaceState({}, '', '/?view=species');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('species');
  });

  it('parses ?view=hotspots from the URL', () => {
    window.history.replaceState({}, '', '/?view=hotspots');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('hotspots');
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

  it('preserves explicit ?view=hotspots even when ?species= is set', () => {
    window.history.replaceState({}, '', '/?species=vermfly&view=hotspots');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.view).toBe('hotspots');
  });

  it('writes ?view= to URL when view is non-default', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'hotspots' }));
    expect(window.location.search).toContain('view=hotspots');
  });

  it('never serialises the default view to the URL', () => {
    window.history.replaceState({}, '', '/?view=hotspots');
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'feed' }));
    expect(window.location.search).not.toContain('view=');
  });

  it('round-trips all three view values', () => {
    const { result } = renderHook(() => useUrlState());
    act(() => result.current.set({ view: 'species' }));
    expect(result.current.state.view).toBe('species');
    expect(window.location.search).toContain('view=species');

    act(() => result.current.set({ view: 'hotspots' }));
    expect(result.current.state.view).toBe('hotspots');
    expect(window.location.search).toContain('view=hotspots');

    act(() => result.current.set({ view: 'feed' }));
    expect(result.current.state.view).toBe('feed');
    expect(window.location.search).not.toContain('view=');
  });
});
