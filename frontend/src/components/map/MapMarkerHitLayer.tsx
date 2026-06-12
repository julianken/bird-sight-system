import { useEffect, useRef, useState, useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { prettyFamily } from '../../derived.js';

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
 * Roving tabindex (#1030, WCAG 2.1.1): the hit layer keeps a SINGLE Tab stop
 * (preserving #558's intent — a 344-marker tab sequence is hostile) but is now
 * keyboard-OPERABLE. Exactly one button carries `tabIndex={0}` (the "active"
 * marker, list order); the rest carry `tabIndex={-1}`. Arrow keys move the
 * active marker (wrapping at the ends) and focus follows; Enter/Space opens the
 * ObservationPopover via `onSelect`. The live "Explore map markers" skip-link in
 * App routes Tab traffic to the active button (the hit-layer fallback when no
 * grid cells exist). When the marker set changes — including the zoom-gate
 * unmount where `buildHitMarkers` returns `[]` below `CLUSTER_MAX_ZOOM` — the
 * active index is clamped to the new length (reset to 0 when no longer valid).
 *
 * Position updates: we re-project on every `move` event. The `move` event
 * fires continuously during pan/zoom, so positions stay glued to the map.
 * `idle` is registered as a backstop in case `move` is throttled.
 */

export interface HitTargetMarker {
  subId: string;
  comName: string;
  familyCode: string | null;
  /**
   * #921: the resolved colloquial family name (e.g. `Tyrant Flycatchers`),
   * resolved UPSTREAM in MapCanvas's `hitMarkers` memo where the silhouette
   * catalogue is in scope. Optional so legacy/test callers passing only a code
   * still type-check; `formatAriaLabel` falls back to `prettyFamily(familyCode)`
   * when absent (cold catalogue) — never the raw lowercase code that used to
   * leak into the screen-reader label.
   *
   * The value type includes `undefined` (not just the `?` presence flag) so the
   * `hitMarkers` memo can assign a `string | undefined` from the resolver
   * directly under `exactOptionalPropertyTypes: true` without coalescing first.
   */
  familyName?: string | null | undefined;
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
 * Family resolution (#921): the colloquial `familyName` (resolved upstream from
 * the silhouette catalogue) when present; else `prettyFamily(familyCode)` (a
 * CAPITALIZED scientific code on a cold catalogue — never the raw lowercase
 * code that used to leak); else "unknown family" when familyCode is null too.
 * Location fallback: "unknown location" when locName is null. Notable suffix
 * appears only when isNotable is true. Date is locale-formatted to a short form.
 */
function formatAriaLabel(m: HitTargetMarker): string {
  const family =
    m.familyName ?? (m.familyCode ? prettyFamily(m.familyCode) : null) ?? 'unknown family';
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

  // Roving tabindex (#1030): index of the single Tab-stop / arrow-navigable
  // "active" marker, in `markers` list order. Initialised to 0 (the first
  // marker). Clamped below whenever the marker set changes length.
  const [activeIndex, setActiveIndex] = useState(0);

  // Clamp the active index to the current marker set. Covers the zoom-gate
  // empty case (`markers.length === 0` → reset to 0 so a later repopulation
  // lands on the first marker) and any shrink (e.g. deconflict / filter change
  // dropping markers) that would leave `activeIndex` past the end. Done in an
  // effect so the render below always reads an in-range index.
  useEffect(() => {
    setActiveIndex((prev) => {
      if (markers.length === 0) return 0;
      return prev >= markers.length ? 0 : prev;
    });
  }, [markers.length]);

  // Per-marker button refs (list order) so an arrow-key move can imperatively
  // focus the newly-active button. Kept length-synced with `markers` each render.
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  buttonRefs.current.length = markers.length;

  // When the active index moves via the KEYBOARD (not a plain Tab/focus event),
  // focus must follow to the newly-active button. A pointer-focus or Tab-in
  // sets `activeIndex` through `onFocus` and must NOT re-steal focus. This ref
  // is the "the next active change came from a key press, move focus to it"
  // flag, consumed in the commit-phase effect below.
  const focusOnNextActiveRef = useRef(false);

  // Move focus to the active button AFTER React commits the tabIndex flip, so
  // the element is programmatically focusable in its final state. Guarded by the
  // keyboard-intent flag so a Tab-in / pointer focus doesn't bounce focus.
  useEffect(() => {
    if (!focusOnNextActiveRef.current) return;
    focusOnNextActiveRef.current = false;
    buttonRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const moveActiveTo = useCallback(
    (resolver: (prev: number, n: number) => number) => {
      const n = markers.length;
      if (n === 0) return;
      focusOnNextActiveRef.current = true;
      setActiveIndex((prev) => resolver(prev, n));
    },
    [markers.length],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          moveActiveTo((prev, n) => (prev + 1) % n); // wrap at the end
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          moveActiveTo((prev, n) => (prev - 1 + n) % n); // wrap at the start
          break;
        case 'Home':
          e.preventDefault();
          moveActiveTo(() => 0);
          break;
        case 'End':
          e.preventDefault();
          moveActiveTo((_prev, n) => n - 1);
          break;
        case 'Enter':
        case ' ':
          // Enter/Space activate the focused marker (open its popover). The
          // native <button> already fires onClick for these, but markers are
          // commonly reached via the skip-link + arrow keys where the browser's
          // default activation still applies — handling here keeps the contract
          // explicit and testable (fireEvent.keyDown in RTL does not synthesize
          // the click). preventDefault stops Space from scrolling the page.
          e.preventDefault();
          onSelect(markers[index].subId);
          break;
        default:
          break;
      }
    },
    [moveActiveTo, markers, onSelect],
  );

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
      {markers.map((m, i) => {
        const pos = positions[m.subId];
        if (!pos) return null;
        const isActive = i === activeIndex;
        return (
          <button
            key={m.subId}
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            // Roving tabindex (#1030): exactly one button (the active one) is in
            // the Tab order; arrow keys move which one that is. This keeps #558's
            // single-tab-stop while making every marker reachable by keyboard.
            tabIndex={isActive ? 0 : -1}
            data-sub-id={m.subId}
            aria-label={formatAriaLabel(m)}
            onClick={() => onSelect(m.subId)}
            onFocus={() => setActiveIndex(i)}
            onKeyDown={(e) => onKeyDown(e, i)}
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
