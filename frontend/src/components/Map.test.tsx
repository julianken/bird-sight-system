import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Map } from './Map.js';
import type { Region, Observation, Hotspot } from '@bird-watch/shared-types';

const regions: Region[] = [
  { id: 'r1', name: 'R1', parentId: null, displayColor: '#FF0808', svgPath: 'M 0 0 L 100 0 L 100 100 L 0 100 Z' },
  { id: 'r2', name: 'R2', parentId: null, displayColor: '#00A6F3', svgPath: 'M 200 0 L 300 0 L 300 100 L 200 100 Z' },
];
const observations: Observation[] = [];
const hotspots: Hotspot[] = [];

describe('Map', () => {
  it('renders one region per region prop', () => {
    render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    expect(screen.getByRole('button', { name: 'R1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'R2' })).toBeInTheDocument();
  });

  it('marks the expanded region with the region-expanded class', () => {
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId="r1"
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const expanded = container.querySelector('[data-region-id="r1"]');
    expect(expanded?.classList.contains('region-expanded')).toBe(true);
    const other = container.querySelector('[data-region-id="r2"]');
    expect(other?.classList.contains('region-expanded')).toBe(false);
  });

  it('calls onSelectRegion when a region is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={onSelect}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    await user.click(screen.getByRole('button', { name: 'R1' }));
    expect(onSelect).toHaveBeenCalledWith('r1');
  });

  it('SVG root uses inline style width/height (beats .bird-map CSS) + preserveAspectRatio', () => {
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const svg = container.querySelector('svg.bird-map') as SVGSVGElement | null;
    // Inline style — required because `.bird-map { width: auto; height: auto }`
    // in styles.css would override a plain width/height attribute.
    expect(svg?.style.width).toBe('100%');
    expect(svg?.style.height).toBe('100%');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  // ---- Ticket #94 two-pass restructure assertions ----

  it('renders three named paint-order layers as direct children of svg.bird-map', () => {
    // Layer ordering in the DOM is the paint order in SVG (no z-index).
    // Shapes first, then badges (so badges always paint over ALL shapes,
    // never just their own region's shape), then hotspots on top.
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const svg = container.querySelector('svg.bird-map') as SVGSVGElement | null;
    expect(svg).not.toBeNull();
    const layerClasses = Array.from(svg!.children).map(g => g.getAttribute('class'));
    expect(layerClasses).toEqual(['shapes-layer', 'badges-layer', 'hotspots-layer']);
  });

  it('has no transform attribute on the shapes-layer region wrapper when collapsed', () => {
    // Ticket AC: `.shapes-layer [data-region-id="r1"]` has no transform
    // when `expandedRegionId={null}`. Mirrors the old Region.test.tsx
    // transform-when-collapsed assertion (the per-region <g> that carries
    // the expand transform now lives in Map).
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const g = container.querySelector('.shapes-layer [data-region-id="r1"]');
    expect(g?.getAttribute('transform')).toBeNull();
  });

  it('applies a non-empty translate+scale transform on the shapes-layer region wrapper when expanded', () => {
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId="r1"
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    const g = container.querySelector('.shapes-layer [data-region-id="r1"]');
    const transform = g?.getAttribute('transform');
    expect(transform).toBeTruthy();
    expect(transform).toContain('translate');
    expect(transform).toContain('scale');
  });

  it('verifies double-<g> collapse — shapes-layer region wrapper has no nested <g> child', () => {
    // Ticket AC: `document.querySelectorAll('.shapes-layer > g > g').length === 0`.
    // Before the refactor, every region was wrapped in two <g>s (outer owning
    // opacity+transition in Map, inner owning transform+className in Region).
    // After the refactor there is exactly one per-region <g> in each layer.
    const { container } = render(
      <Map
        regions={regions}
        observations={observations}
        hotspots={hotspots}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />
    );
    expect(container.querySelectorAll('.shapes-layer > g > g').length).toBe(0);
  });
});
