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
    familyName: 'familyName' in partial ? partial.familyName! : undefined,
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

  it('emits a full aria-label including comName, colloquial family, location, date, notable flag', () => {
    const markers = [
      makeMarker({
        comName: 'Vermilion Flycatcher',
        familyCode: 'tyrannidae',
        familyName: 'Tyrant Flycatchers',
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
    // #921: the colloquial name is announced, NOT the raw lowercase scientific
    // code that used to leak (worse than the visible popover ever was).
    expect(label).toContain('Tyrant Flycatchers');
    expect(label).not.toContain('tyrannidae');
    expect(label).toContain('Sweetwater Wetlands');
    expect(label).toContain('notable');
  });

  it('falls back to prettyFamily(familyCode) when familyName is absent (#921 cold load)', () => {
    // No resolved familyName yet (silhouette catalogue not loaded) — the label
    // must show the capitalized scientific code, never the raw lowercase code
    // and never blank.
    const markers = [makeMarker({ familyCode: 'tyrannidae' })];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toContain('Tyrannidae');
    expect(label).not.toContain('tyrannidae');
  });

  it('falls back to "unknown family" when both familyName and familyCode are null (#921)', () => {
    const markers = [makeMarker({ familyCode: null })];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    const label = screen.getByRole('button').getAttribute('aria-label') ?? '';
    expect(label).toContain('unknown family');
  });

  it('uses a roving tabindex: exactly one button at tabIndex=0, the rest tabIndex=-1 (#1030 — preserves #558 single-tab-stop while staying keyboard-operable)', () => {
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
      makeMarker({ comName: 'C', subId: 'c' }),
    ];
    render(
      <MapMarkerHitLayer
        map={makeFakeMap()}
        markers={markers}
        onSelect={vi.fn()}
      />,
    );
    const btns = screen.getAllByRole('button');
    const zeros = btns.filter((b) => b.getAttribute('tabindex') === '0');
    const minusOnes = btns.filter((b) => b.getAttribute('tabindex') === '-1');
    expect(zeros).toHaveLength(1);
    expect(minusOnes).toHaveLength(btns.length - 1);
    // List order: the FIRST marker is the initial active button.
    expect(btns[0].getAttribute('tabindex')).toBe('0');
  });

  it('ArrowRight moves the active (tabIndex=0) button to the next marker in list order', () => {
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
      makeMarker({ comName: 'C', subId: 'c' }),
    ];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    const first = screen.getByLabelText(/^A,/);
    expect(first.getAttribute('tabindex')).toBe('0');
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowRight' });
    });
    const second = screen.getByLabelText(/^B,/);
    expect(second.getAttribute('tabindex')).toBe('0');
    expect(first.getAttribute('tabindex')).toBe('-1');
    // The newly-active button receives focus so the user lands on it.
    expect(document.activeElement).toBe(second);
  });

  it('ArrowLeft from the first marker wraps to the last marker', () => {
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
      makeMarker({ comName: 'C', subId: 'c' }),
    ];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    const first = screen.getByLabelText(/^A,/);
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowLeft' });
    });
    const last = screen.getByLabelText(/^C,/);
    expect(last.getAttribute('tabindex')).toBe('0');
    expect(document.activeElement).toBe(last);
  });

  it('ArrowRight from the last marker wraps to the first marker', () => {
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
    ];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    const first = screen.getByLabelText(/^A,/);
    const last = screen.getByLabelText(/^B,/);
    // Move active onto the last marker (A → B), then ArrowRight wraps B → A.
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowRight' }); // active → B
    });
    expect(last.getAttribute('tabindex')).toBe('0');
    act(() => {
      fireEvent.keyDown(last, { key: 'ArrowRight' }); // wrap → A
    });
    expect(first.getAttribute('tabindex')).toBe('0');
  });

  it('Enter on the active button opens the popover (onSelect with its subId)', () => {
    const onSelect = vi.fn();
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
    ];
    render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={onSelect} />,
    );
    const first = screen.getByLabelText(/^A,/);
    act(() => {
      fireEvent.keyDown(first, { key: 'ArrowRight' }); // active → B
    });
    const second = screen.getByLabelText(/^B,/);
    act(() => {
      fireEvent.keyDown(second, { key: 'Enter' });
    });
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('clamps the active index when the marker set shrinks (e.g. zoom-gate empties then repopulates)', () => {
    const three = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
      makeMarker({ comName: 'C', subId: 'c' }),
    ];
    const { rerender } = render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={three} onSelect={vi.fn()} />,
    );
    // Move active to the last (index 2).
    act(() => {
      fireEvent.keyDown(screen.getByLabelText(/^A,/), { key: 'ArrowLeft' });
    });
    expect(screen.getByLabelText(/^C,/).getAttribute('tabindex')).toBe('0');

    // Marker set shrinks to one — index 2 is now out of range → clamp to 0.
    const one = [makeMarker({ comName: 'Z', subId: 'z' })];
    rerender(
      <MapMarkerHitLayer map={makeFakeMap()} markers={one} onSelect={vi.fn()} />,
    );
    const onlyBtn = screen.getByRole('button');
    expect(onlyBtn.getAttribute('tabindex')).toBe('0');
  });

  it('survives the zoom-gate empty marker set (buildHitMarkers returns []) and resets active to 0 on repopulation', () => {
    const markers = [
      makeMarker({ comName: 'A', subId: 'a' }),
      makeMarker({ comName: 'B', subId: 'b' }),
    ];
    const { rerender } = render(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    act(() => {
      fireEvent.keyDown(screen.getByLabelText(/^A,/), { key: 'ArrowRight' }); // active → B (index 1)
    });
    // Zoom out below CLUSTER_MAX_ZOOM → buildHitMarkers returns [] → layer renders null.
    rerender(<MapMarkerHitLayer map={makeFakeMap()} markers={[]} onSelect={vi.fn()} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // Zoom back in → markers repopulate; active index must have clamped to 0.
    rerender(
      <MapMarkerHitLayer map={makeFakeMap()} markers={markers} onSelect={vi.fn()} />,
    );
    expect(screen.getByLabelText(/^A,/).getAttribute('tabindex')).toBe('0');
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
