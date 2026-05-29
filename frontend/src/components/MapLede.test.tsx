import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MapLede } from './MapLede.js';

// #738/C7 — MapLede is presentational. It receives the runtime region label
// (`region: string | null`, from regionLabelFor — `null` ⟺ unscoped) and a
// caller-computed `noFiltersActive` boolean (App.tsx #740 owns the
// `since === DEFAULTS.since` comparison). The zero-count branch is split into
// a data-availability case (sparse/empty region, no filters) and the existing
// filter-narrowing case.
const base = {
  region: 'Arizona' as string | null,
  noFiltersActive: true,
  period: '14 days',
} as const;

describe('<MapLede>', () => {
  it('unscoped (region=null): renders nothing — the chooser is shown', () => {
    const { container } = render(
      <MapLede
        {...base}
        region={null}
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        freshness="fresh"
        loading={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('zero counts + no filters active: data-availability copy naming the region', () => {
    render(
      <MapLede
        {...base}
        region="New York"
        noFiltersActive={true}
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        freshness="empty"
        loading={false}
      />,
    );
    const h = screen.getByRole('heading', { level: 1 });
    expect(h).toHaveTextContent('No recent sightings in New York yet.');
    // NOT the filter-narrowing copy.
    expect(h.textContent).not.toMatch(/match your current filters/);
  });

  it('zero counts + filters active: keeps the filter-narrowing copy', () => {
    render(
      <MapLede
        {...base}
        region="Arizona"
        noFiltersActive={false}
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        freshness="fresh"
        loading={false}
      />,
    );
    const h = screen.getByRole('heading', { level: 1 });
    expect(h).toHaveTextContent('No sightings match your current filters.');
    expect(h.textContent).not.toMatch(/No recent sightings/);
  });

  // Issue #716/#720: during the cold-load window the lede must suppress even
  // when no filters are active — counts are 0 because the fetch hasn't
  // resolved, not because the region is sparse. The loading guard wins over
  // the data-availability branch.
  it('loading=true with zero counts: renders nothing (issue #716)', () => {
    const { container } = render(
      <MapLede
        {...base}
        region="Arizona"
        noFiltersActive={true}
        speciesCount={0}
        observationCount={0}
        speciesCommonName={null}
        familyName={null}
        freshness="empty"
        loading={true}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

  it('loading=true with non-zero counts: still renders the real template', () => {
    render(
      <MapLede
        {...base}
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
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
        {...base}
        speciesCount={1}
        observationCount={47}
        speciesCommonName="Vermilion Flycatcher"
        familyName={null}
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
        {...base}
        speciesCount={9}
        observationCount={120}
        speciesCommonName={null}
        familyName="woodpeckers"
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
        {...base}
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona in the last 14 days.',
    );
  });

  it('threads the ?scope=us region "USA" into Template 4', () => {
    render(
      <MapLede
        {...base}
        region="USA"
        speciesCount={472}
        observationCount={20_000}
        speciesCommonName={null}
        familyName={null}
        freshness="fresh"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '472 species seen across USA in the last 14 days.',
    );
  });

  it('drops the period clause under freshness="stale"', () => {
    render(
      <MapLede
        {...base}
        speciesCount={344}
        observationCount={11_412}
        speciesCommonName={null}
        familyName={null}
        freshness="stale"
        loading={false}
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      '344 species seen across Arizona.',
    );
    expect(screen.queryByText(/in the last/)).toBeNull();
  });
});
