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
    });
  });

  it('parses values from the URL', () => {
    window.history.replaceState({}, '', '/?region=sky-islands-santa-ritas&since=7d&notable=true&species=vermfly');
    const { result } = renderHook(() => useUrlState());
    expect(result.current.state.regionId).toBe('sky-islands-santa-ritas');
    expect(result.current.state.since).toBe('7d');
    expect(result.current.state.notable).toBe(true);
    expect(result.current.state.speciesCode).toBe('vermfly');
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
});
