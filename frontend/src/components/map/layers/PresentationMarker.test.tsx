import { forwardRef, useImperativeHandle } from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PresentationMarker } from './PresentationMarker.js';

/* ── Purpose-built react-map-gl/maplibre Marker mock ─────────────────────────
   The PresentationMarker post-mount effect is guarded by
   `if (mk && typeof mk.getElement === 'function')` — so to exercise the
   #459 role-strip set-path (rather than the no-op short-circuit), the mock
   MUST forwardRef and expose a real `getElement()` DOM node via
   useImperativeHandle. (The plain non-ref `<div>` Marker mock in
   MapCanvas.test.tsx can only ever assert the no-op branch — do not copy it.)

   `markerEl` is created fresh per Marker mount inside the forwardRef body, so
   assertion #2 ("re-fires per remount") proves a genuinely fresh element
   carries the role, not a hand-reset shared node. A module-level registry
   records each mount's element keyed by `data-key` so the test can target the
   freshly-mounted marker. */
const mounts: Record<string, HTMLDivElement> = {};

vi.mock('react-map-gl/maplibre', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Marker: forwardRef(function Marker({ children, anchor }: any, ref: any) {
    const markerEl = document.createElement('div'); // fresh real DOM node per mount
    useImperativeHandle(ref, () => ({ getElement: () => markerEl }), []);
    const key = typeof anchor === 'string' ? anchor : '__default__';
    mounts[key] = markerEl;
    return <div data-testid="mock-marker">{children}</div>;
  }),
}));

describe('PresentationMarker', () => {
  beforeEach(() => {
    for (const k of Object.keys(mounts)) delete mounts[k];
  });

  it('sets role="presentation" on the marker container element after mount (#459)', () => {
    render(
      <PresentationMarker longitude={-111} latitude={34}>
        <button>child</button>
      </PresentationMarker>,
    );

    expect(mounts['__default__'].getAttribute('role')).toBe('presentation');
  });

  it('re-fires the role-strip effect on each fresh remount (keyed by g.key)', () => {
    // Render markers inside a parent map() keyed so changing the keyed item
    // unmounts the old marker and mounts a brand-new one. The effect has `[]`
    // deps, so only a new MOUNT (not a re-render) re-runs it.
    function Parent({ groups }: { groups: { key: string; anchor: 'top' | 'bottom' }[] }) {
      return (
        <>
          {groups.map((g) => (
            <PresentationMarker key={g.key} longitude={-111} latitude={34} anchor={g.anchor}>
              <button>{g.key}</button>
            </PresentationMarker>
          ))}
        </>
      );
    }

    const { rerender } = render(<Parent groups={[{ key: 'a', anchor: 'top' }]} />);
    expect(mounts['top'].getAttribute('role')).toBe('presentation');

    // Swap the keyed item: React unmounts marker 'a' and mounts a fresh 'b'.
    rerender(<Parent groups={[{ key: 'b', anchor: 'bottom' }]} />);
    // The freshly-mounted marker carries the role — a genuinely new element
    // (created inside the forwardRef body), not a residue from the prior mount.
    expect(mounts['bottom'].getAttribute('role')).toBe('presentation');
  });
});
