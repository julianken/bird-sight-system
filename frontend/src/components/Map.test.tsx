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
});

describe('Map paint-order comparator', () => {
  const baseRegion = (id: string, parentId: string | null): Region => ({
    id,
    name: id,
    parentId,
    displayColor: '#000',
    svgPath: 'M 0 0 L 10 0 L 10 10 L 0 10 Z',
  });

  it('paints parents before their children', () => {
    const paintOrderRegions: Region[] = [
      baseRegion('sky-islands-santa-ritas', 'sonoran-tucson'),
      baseRegion('sonoran-tucson', null),
      baseRegion('sky-islands-chiricahuas', 'sonoran-tucson'),
    ];
    const { container } = render(
      <Map
        regions={paintOrderRegions}
        observations={[]}
        hotspots={[]}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />,
    );
    const ids = Array.from(
      container.querySelectorAll('[data-region-id]'),
      el => el.getAttribute('data-region-id'),
    );
    expect(ids).toEqual([
      'sonoran-tucson',
      'sky-islands-chiricahuas',
      'sky-islands-santa-ritas',
    ]);
  });

  it('paints the selected region LAST regardless of parent/child', () => {
    const paintOrderRegions: Region[] = [
      baseRegion('sonoran-tucson', null),
      baseRegion('sky-islands-chiricahuas', 'sonoran-tucson'),
      baseRegion('sky-islands-huachucas', 'sonoran-tucson'),
      baseRegion('sky-islands-santa-ritas', 'sonoran-tucson'),
    ];
    const { container } = render(
      <Map
        regions={paintOrderRegions}
        observations={[]}
        hotspots={[]}
        expandedRegionId="sky-islands-chiricahuas"
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />,
    );
    const ids = Array.from(
      container.querySelectorAll('[data-region-id]'),
      el => el.getAttribute('data-region-id'),
    );
    expect(ids[ids.length - 1]).toBe('sky-islands-chiricahuas');
  });

  it('treats a region referenced as parentId as a parent even when its own parentId is null (defensive against DB drift)', () => {
    // sonoran-tucson has parentId=null AND is referenced as a parent of the
    // sky-islands. Both properties matter: parent classification must come
    // from the data, not from "is my own parentId null".
    const paintOrderRegions: Region[] = [
      baseRegion('lower-colorado', null), // root, has NO children in this set
      baseRegion('sonoran-tucson', null), // root, HAS children in this set
      baseRegion('sky-islands-santa-ritas', 'sonoran-tucson'),
    ];
    const { container } = render(
      <Map
        regions={paintOrderRegions}
        observations={[]}
        hotspots={[]}
        expandedRegionId={null}
        selectedSpeciesCode={null}
        onSelectRegion={() => {}}
        silhouetteFor={() => 'M0 0'}
        colorFor={() => '#000'}
      />,
    );
    const ids = Array.from(
      container.querySelectorAll('[data-region-id]'),
      el => el.getAttribute('data-region-id'),
    );
    // Both roots (lower-colorado, sonoran-tucson) come before the child.
    // Stable alphabetical tiebreak within the same tier orders lower-colorado
    // before sonoran-tucson.
    expect(ids).toEqual([
      'lower-colorado',
      'sonoran-tucson',
      'sky-islands-santa-ritas',
    ]);
  });
});
