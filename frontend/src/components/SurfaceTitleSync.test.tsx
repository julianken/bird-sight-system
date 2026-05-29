import { render } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { SurfaceTitleSync } from './SurfaceTitleSync';

// jsdom allows document.title reads. #738/C5: the region is a runtime prop now
// (from regionLabelFor) — `null` ⟺ the unscoped/chooser landing, where the
// site suffix falls back to "Bird Maps" (never "Bird Maps · ").
describe('SurfaceTitleSync', () => {
  beforeEach(() => {
    document.title = '';
  });

  it('sets title to "Bird Maps · Arizona" on map surface', () => {
    render(<SurfaceTitleSync view="map" speciesCommonName={null} region="Arizona" />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('sets title to "Feed — Bird Maps · Arizona" on feed surface', () => {
    render(<SurfaceTitleSync view="feed" speciesCommonName={null} region="Arizona" />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('sets title to "{commonName} — Bird Maps · Arizona" on detail surface with species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" region="Arizona" />);
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
  });

  it('falls back to "Bird Maps · Arizona" on detail surface with no species', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName={null} region="Arizona" />);
    expect(document.title).toBe('Bird Maps · Arizona');
  });

  it('threads the ?scope=us region into the title', () => {
    render(<SurfaceTitleSync view="map" speciesCommonName={null} region="USA" />);
    expect(document.title).toBe('Bird Maps · USA');
  });

  it('unscoped (region=null): title is "Bird Maps" with no trailing " · "', () => {
    render(<SurfaceTitleSync view="map" speciesCommonName={null} region={null} />);
    expect(document.title).toBe('Bird Maps');
    expect(document.title).not.toMatch(/·\s*$/);
  });

  it('unscoped detail surface with species: "{commonName} — Bird Maps"', () => {
    render(<SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" region={null} />);
    expect(document.title).toBe('Gila Woodpecker — Bird Maps');
  });

  it('updates title when view changes', () => {
    const { rerender } = render(
      <SurfaceTitleSync view="map" speciesCommonName={null} region="Arizona" />,
    );
    expect(document.title).toBe('Bird Maps · Arizona');
    rerender(<SurfaceTitleSync view="feed" speciesCommonName={null} region="Arizona" />);
    expect(document.title).toBe('Feed — Bird Maps · Arizona');
  });

  it('updates title when species changes on detail surface', () => {
    const { rerender } = render(
      <SurfaceTitleSync view="detail" speciesCommonName="Gila Woodpecker" region="Arizona" />,
    );
    expect(document.title).toBe('Gila Woodpecker — Bird Maps · Arizona');
    rerender(
      <SurfaceTitleSync view="detail" speciesCommonName="Vermilion Flycatcher" region="Arizona" />,
    );
    expect(document.title).toBe('Vermilion Flycatcher — Bird Maps · Arizona');
  });
});
