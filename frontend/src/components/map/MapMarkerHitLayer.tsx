import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Per-marker hit-target overlay rendered above the map canvas.
 *
 * Why HTML overlay (not native MapLibre clickable layer):
 *   - Native circle layers are click-only via `map.on('click', layerId, ...)`
 *     which yields no a11y affordance — screen readers see nothing, focus
 *     can't land on a marker, no keyboard activation.
 *   - An absolutely-positioned `<button>` per visible marker is the only
 *     way to give each point an `aria-label`, keyboard focus, and a 40×40
 *     (48×48 coarse-pointer) hit target.
 *
 * The hit layer is intentionally NOT in the global Tab order. Per the
 * issue body Gotchas — a 344-marker tab sequence is hostile to keyboard
 * users. The skip-link in MapSurface routes Tab traffic to the FeedSurface
 * list landmark (which is properly navigable).
 *
 * Position updates: we re-project on every `move` event. The `move` event
 * fires continuously during pan/zoom, so positions stay glued to the map.
 * `idle` is registered as a backstop in case `move` is throttled.
 */

export interface HitTargetMarker {
  subId: string;
  comName: string;
  familyCode: string | null;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
  lngLat: [number, number];
}

/** Minimal map shape we depend on — keeps the component testable. */
export interface HitLayerMap {
  project(lngLat: [number, number]): { x: number; y: number };
  on(event: string, listener: () => void): void;
  off(event: string, listener: () => void): void;
}

export interface MapMarkerHitLayerProps {
  map: HitLayerMap;
  markers: HitTargetMarker[];
  onSelect: (subId: string) => void;
  /**
   * When true, hit targets are 48×48 (mobile / coarse-pointer). When
   * false/undefined, 40×40 (desktop default). Caller wires this via
   * `useMediaQuery('(pointer: coarse)')`.
   */
  isCoarsePointer?: boolean;
}

/* Hit target dimensions per issue spec: 40×40 desktop, 48×48 coarse pointer. */
const HIT_SIZE_DESKTOP = 40;
const HIT_SIZE_COARSE = 48;

/**
 * Build the per-marker `aria-label`. Format:
 *   "{comName}, {family}, {location}, {date}[, notable]"
 *
 * Family fallback: "unknown family" when familyCode is null. Location
 * fallback: "unknown location" when locName is null. Notable suffix appears
 * only when isNotable is true. Date is locale-formatted to a short form.
 */
function formatAriaLabel(m: HitTargetMarker): string {
  const family = m.familyCode ?? 'unknown family';
  const location = m.locName ?? 'unknown location';
  let dateStr = m.obsDt;
  try {
    dateStr = new Date(m.obsDt).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    /* fall back to raw ISO string */
  }
  const notable = m.isNotable ? ', notable' : '';
  return `${m.comName}, ${family}, ${location}, ${dateStr}${notable}`;
}

export function MapMarkerHitLayer(props: MapMarkerHitLayerProps) {
  const { map, markers, onSelect, isCoarsePointer = false } = props;
  const size = isCoarsePointer ? HIT_SIZE_COARSE : HIT_SIZE_DESKTOP;
  const half = size / 2;

  // Position state: one screen point per marker, keyed by subId. Recomputed
  // on every `move`/`idle` event so buttons stay glued to map content.
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(
    () => projectAll(map, markers),
  );

  // Re-project whenever markers change. (`map` is stable for a given
  // MapCanvas mount; the project closure inside reprojection captures
  // the latest map ref.)
  const reproject = useCallback(() => {
    setPositions(projectAll(map, markers));
  }, [map, markers]);

  // Register move/idle listeners for live re-projection during pan/zoom.
  useEffect(() => {
    map.on('move', reproject);
    map.on('idle', reproject);
    // Initial reproject (covers the marker-list-changed and isCoarsePointer-
    // changed cases — useState initialiser only runs once on mount).
    reproject();
    return () => {
      map.off('move', reproject);
      map.off('idle', reproject);
    };
  }, [map, reproject]);

  // useRefs to satisfy `react-hooks/exhaustive-deps` without re-binding
  // listeners on every prop change. (Currently unused but kept as the
  // reference pattern if the hit-layer grows additional listener sets.)
  const sizeRef = useRef(size);
  sizeRef.current = size;

  if (markers.length === 0) return null;

  return (
    <div
      className="map-marker-hit-layer"
      style={{
        position: 'absolute',
        inset: 0,
        // pointer-events: none lets the parent map receive pan/zoom; each
        // child <button> re-enables pointer events (see button style below).
        pointerEvents: 'none',
      }}
    >
      {markers.map((m) => {
        const pos = positions[m.subId];
        if (!pos) return null;
        return (
          <button
            key={m.subId}
            type="button"
            data-sub-id={m.subId}
            aria-label={formatAriaLabel(m)}
            onClick={() => onSelect(m.subId)}
            style={{
              position: 'absolute',
              left: `${pos.x - half}px`,
              top: `${pos.y - half}px`,
              width: `${size}px`,
              height: `${size}px`,
              padding: 0,
              margin: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          />
        );
      })}
    </div>
  );
}

function projectAll(
  map: HitLayerMap,
  markers: HitTargetMarker[],
): Record<string, { x: number; y: number }> {
  const result: Record<string, { x: number; y: number }> = Object.create(null);
  for (const m of markers) {
    result[m.subId] = map.project(m.lngLat);
  }
  return result;
}
