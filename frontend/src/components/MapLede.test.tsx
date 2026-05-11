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
      />,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'No sightings match your current filters.',
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
      />,
    );
    // Asserts the substitution worked — REGION_LABEL is the source of truth
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(
      /across Arizona/,
    );
  });
});
