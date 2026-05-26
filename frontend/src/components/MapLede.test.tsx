import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLede } from './MapLede.js';

describe('<MapLede>', () => {
  it('Template 1: zero results — returns the no-match string', () => {
    render(
      <MapLede
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No sightings match your current filters.',
    );
  });

  // Issue #716: during the cold-load window (initial fetch unresolved),
  // useBirdData seeds observations to [] so MapSurface derives
  // observationCount=0 + speciesCount=0. Without the loading guard, Template 1
  // ("No sightings match your current filters.") fires, which is misleading
  // — the user hasn't applied filters yet. The lede must suppress entirely
  // during loading so the context strip collapses to nothing (matches
  // FeedSurface.tsx:353-358 and the always-empty freshness label).
  it('loading=true with zero counts: renders nothing (issue #716)', () => {
    const { container } = render(
      <MapLede
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="empty"
        loading={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  // Regression guard: once the fetch resolves, a genuinely empty result set
  // must still surface Template 1 (legitimate empty-state — see the second
  // screenshot in #716, e.g. ?since=1d&notable=true&familyCode=trogonidae).
  it('loading=false with zero counts: still renders Template 1', () => {
    render(
      <MapLede
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No sightings match your current filters.',
    );
  });

  // Loading should NOT suppress the lede when counts are non-zero. (Re-fetches
  // keep stale observations rendered per use-bird-data.ts:87-101, so the lede
  // should keep narrating the prior result during a refetch.)
  it('loading=true with non-zero counts: still renders the real template', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={true}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona in the last 14 days.',
    );
  });

  it('Template 2: single species — count + common name + region + period', () => {
    render(
      <MapLede
        speciesCount={1}
        observationCount={47}
        speciesCommonName="Vermilion Flycatcher"
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '47 sightings of Vermilion Flycatcher in Arizona in the last 14 days.',
    );
  });

  it('Template 3: family filter active — N species of family in region in period', () => {
    render(
      <MapLede
        speciesCount={9}
        observationCount={120}
        speciesCommonName={null}
        familyName="woodpeckers"
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '9 species of woodpeckers seen across Arizona in the last 14 days.',
    );
  });

  it('Template 4: default — N species across region in period', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona in the last 14 days.',
    );
  });

  it('drops the period clause under freshness="stale"', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="stale"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona.',
    );
    expect(screen.queryByText(/in the last/)).toBeNull();
  });

  it('uses REGION_LABEL constant — text contains "Arizona" exactly', () => {
    render(
      <MapLede
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        period="14 days"
        freshness="fresh"
        loading={false}
      />,
    );
    // Asserts the substitution worked — REGION_LABEL is the source of truth
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /across Arizona/,
    );
  });
});
