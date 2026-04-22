import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Hoist mock fns so they exist before any module-level code runs.
const { mockGetHotspots, mockGetObservations } = vi.hoisted(() => ({
  mockGetHotspots: vi.fn(),
  mockGetObservations: vi.fn(),
}));

// Stub url-state before App imports it.
vi.mock('./state/url-state.js', () => ({
  useUrlState: () => ({
    state: {
      since: '14d',
      notable: false,
      speciesCode: null,
      familyCode: null,
      view: 'feed',
    },
    set: vi.fn(),
  }),
  readMigrationFlag: () => false,
}));

// Stub the ApiClient constructor so useBirdData receives a controllable mock.
vi.mock('./api/client.js', async () => {
  const actual = await vi.importActual<typeof import('./api/client.js')>('./api/client.js');
  return {
    ...actual,
    ApiClient: class {
      getHotspots = mockGetHotspots;
      getObservations = mockGetObservations;
    },
  };
});

import { App } from './App.js';
import { ApiError } from './api/client.js';

describe('App error screen', () => {
  beforeEach(() => {
    // Default: hotspots reject with an ApiError, observations resolve empty
    mockGetHotspots.mockRejectedValue(new ApiError(503, 'pool exhausted'));
    mockGetObservations.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a friendly message, not the raw error body', async () => {
    render(<App />);
    await waitFor(() => {
      expect(screen.getByText('Something went wrong — please try again')).toBeInTheDocument();
    });
    // Raw body must NOT appear in the DOM
    expect(screen.queryByText(/pool exhausted/)).toBeNull();
  });

  it('logs raw error details to console.error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith('API error 503: pool exhausted');
    });
    spy.mockRestore();
  });
});
