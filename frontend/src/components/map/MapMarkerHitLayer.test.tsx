import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MapMarkerHitLayer, type HitTargetMarker } from './MapMarkerHitLayer.js';

/* ── Helpers ──────────────────────────────────────────────────────────── */

function makeMarker(partial: Partial<HitTargetMarker> = {}): HitTargetMarker {
  // Use `in partial` checks for nullable fields so an explicit `null` from
  // the caller is preserved (rather than overwritten by `??` defaults).
  return {
    subId: partial.subId ?? 'S001',
    comName: partial.comName ?? 'House Finch',
    familyCode: 'familyCode' in partial ? partial.familyCode! : 'fringillidae',
    locName: 'locName' in partial ? partial.locName! : 'Sabino Canyon',
    obsDt: partial.obsDt ?? '2026-04-15T10:00:00Z',
    isNotable: partial.isNotable ?? false,
    lngLat: partial.lngLat ?? [-110.9, 32.2],
  };
}

interface FakeMap {
  project: (lngLat: [number, number]) => { x: number; y: number };
  on: (event: string, listener: () => void) => void;
  off: (event: string, listener: () => void) => void;
}

function makeFakeMap(): FakeMap & {
  fireMove: () => void;
} {
  const listeners: Record<string, Set<() => void>> = {};
  return {
    // Project a leaf at lng=−110, lat=32 to (200, 300); other lngs offset.
    project: (lngLat: [number, number]) => ({
      x: 200 + (lngLat[0] + 110) * 100,
      y: 300 - (lngLat[1] - 32) * 100,
    }),
    on: (event: string, listener: () => void) => {
      (listeners[event] ??= new Set()).add(listener);
    },
    off: (event: string, listener: () => void) => {
      listeners[event]?.delete(listener);
    },
    fireMove: () => {
      // Drive both 'move' and 'idle' so the hit layer's listener registry
      // is exercised whether the impl uses one or the other.
      listeners['move']?.forEach((l) => l());
      listeners['idle']?.forEach((l) => l());
    },
  };
}

describe('MapMarkerHitLayer', () => {
  it('renders one button per marker', () => {
    const markers = [makeMarker({ subId: 'A' }), makeMarker({ subId: 'B' })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btns = screen.getAllByRole('button');
    expect(btns).toHaveLength(2);
  });

  it('places each button at the projected screen position', () => {
    const markers = [makeMarker({ lngLat: [-110, 32] })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    // Project [−110, 32] → (200, 300). The button is centered on that point,
    // so left = 200 − 20 = 180, top = 300 − 20 = 280.
    expect(btn.style.position).toBe('absolute');
    expect(btn.style.left).toBe('180px');
    expect(btn.style.top).toBe('280px');
    expect(btn.style.width).toBe('40px');
    expect(btn.style.height).toBe('40px');
  });

  it('emits a full aria-label including comName, family, location, date, notable flag', () => {
    const markers = [
      makeMarker({
        comName: 'Vermilion Flycatcher',
        familyCode: 'tyrannidae',
        locName: 'Sweetwater Wetlands',
        obsDt: '2026-04-15T10:00:00Z',
        isNotable: true,
      }),
    ];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toContain('Vermilion Flycatcher');
    expect(label).toContain('tyrannidae');
    expect(label).toContain('Sweetwater Wetlands');
    expect(label).toContain('notable');
  });

  it('falls back to "unknown location" when locName is null', () => {
    const markers = [makeMarker({ locName: null })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).toContain('unknown location');
  });

  it('omits "notable" from the label when isNotable is false', () => {
    const markers = [makeMarker({ isNotable: false })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label).not.toContain('notable');
  });

  it('calls onSelect with the marker subId when the button is clicked', () => {
    const onSelect = vi.fn();
    const markers = [makeMarker({ subId: 'XYZ' })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('XYZ');
  });

  it('re-projects positions when the map fires a move event', () => {
    let projectXOffset = 0;
    const map: FakeMap & { fireMove: () => void } = {
      ...makeFakeMap(),
      project: (lngLat: [number, number]) => ({
        x: 200 + projectXOffset + (lngLat[0] + 110) * 100,
        y: 300 - (lngLat[1] - 32) * 100,
      }),
    };
    // Re-bind listeners on this overridden map.
    const listeners: Record<string, Set<() => void>> = {};
    map.on = (event: string, listener: () => void) => {
      (listeners[event] ??= new Set()).add(listener);
    };
    map.off = (event: string, listener: () => void) => {
      listeners[event]?.delete(listener);
    };
    map.fireMove = () => {
      listeners['move']?.forEach((l) => l());
      listeners['idle']?.forEach((l) => l());
    };

    const markers = [makeMarker({ lngLat: [-110, 32] })];
    render(<MapMarkerHitLayer map={map} markers={markers} onSelect={vi.fn()} />);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.style.left).toBe('180px');

    // Pan the map: re-projection now offsets by 50px.
    projectXOffset = 50;
    act(() => map.fireMove());
    expect(btn.style.left).toBe('230px');
  });

  it('uses 48x48 hit-targets when isCoarsePointer is true', () => {
    const markers = [makeMarker({ lngLat: [-110, 32] })];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
        isCoarsePointer
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.style.width).toBe('48px');
    expect(btn.style.height).toBe('48px');
    // Centered on (200, 300) → left = 200 - 24 = 176, top = 300 - 24 = 276.
    expect(btn.style.left).toBe('176px');
    expect(btn.style.top).toBe('276px');
  });

  it('returns null (no DOM) when markers is empty', () => {
    const { container } = render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={[]}
        onSelect={vi.fn()}
      />,
    );
    // Empty render — no buttons.
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});
