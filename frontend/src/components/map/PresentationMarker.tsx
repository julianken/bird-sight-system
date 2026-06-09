import React, { useEffect, useRef } from 'react';
import { Marker } from 'react-map-gl/maplibre';

/**
 * PresentationMarker — a <Marker> wrapper that removes `role="button"` from
 * the maplibre-gl marker container div after mount.
 *
 * Why this is needed (WCAG 4.1.2 / #459 W4-C):
 *   maplibre-gl's Marker.addTo() calls `setAttribute('role', 'button')` on
 *   its container element unless a role is already present. When the Marker
 *   children are themselves interactive elements (<button>: AdaptiveGridMarker,
 *   ClusterPill), the result is a `<div role="button">`
 *   wrapping a `<button>` — a nested-interactive WCAG 4.1.2 violation that
 *   axe-core flags on every visible marker (47 violations in the 2026-05-11
 *   audit).
 *
 * Fix: react-map-gl's Marker component exposes the MapLibre MarkerInstance
 * via forwardRef. After mount we set role="presentation" on the wrapper
 * element. This overrides maplibre's role="button" and removes the
 * interactive semantics from the container; the child <button> remains the
 * canonical interactive element with full keyboard + AT support.
 *
 * We do NOT use aria-hidden="true" — that propagates to children and hides
 * the inner <button> from assistive technologies (silent AT regression).
 */
interface PresentationMarkerProps {
  longitude: number;
  latitude: number;
  anchor?: 'center' | 'top' | 'bottom' | 'left' | 'right' |
    'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  children: React.ReactNode;
}

export function PresentationMarker({ longitude, latitude, anchor, children }: PresentationMarkerProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);

  useEffect(() => {
    const mk = markerRef.current;
    if (mk && typeof mk.getElement === 'function') {
      mk.getElement().setAttribute('role', 'presentation');
    }
  }, []);

  return (
    <Marker ref={markerRef} longitude={longitude} latitude={latitude} anchor={anchor}>
      {children}
    </Marker>
  );
}
