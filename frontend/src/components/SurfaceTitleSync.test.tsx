import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { SurfaceTitleSync } from './SurfaceTitleSync';

// jsdom allows document.title reads
describe('SurfaceTitleSync', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('sets title to "Bird Maps · Arizona" on map surface', () => {
    render(<SurfaceTitleSync view="map" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('sets title to "Feed — Bird Maps · Arizona" on feed surface', () => {
    render(<SurfaceTitleSync view="feed" speciesCommonName={null} />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('sets title to "Species — Bird Maps · Arizona" on species surface', () => {
    render(<SurfaceTitleSync view="species" speciesCommonName={null} />);
    expect(document.title).toBe('Species — Bird Maps · Arizona');
  });

  it('sets title to "{commonName} — Bird Maps · Arizona" on detail surface with species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" />);
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
  });

  it('falls back to "Bird Maps · Arizona" on detail surface with no species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('updates title when view changes', () => {
    const { rerender } = render(<SurfaceTitleSync view="map" speciesCommonName={null} />);
    expect(document.title).toBe('Bird Maps · Arizona');
    rerender(<SurfaceTitleSync view="feed" speciesCommonName={null} />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('updates title when species changes on detail surface', () => {
    const { rerender } = render(
      <SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" />
    );
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
    rerender(<SurfaceTitleSync view="detail" speciesCommonName="Vermilion Flycatcher" />);
    expect(document.title).toBe('Vermilion Flycatcher — Bird Maps · Arizona');
  });
});
