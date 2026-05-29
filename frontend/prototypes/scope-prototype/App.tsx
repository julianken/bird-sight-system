import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Observation, ObservationsResponse } from './data-types';
import { ScopeChooser } from './ScopeChooser';
import { ScopedMap } from './ScopedMap';
import {
  CONUS_BOUNDS,
  STATES,
  bboxToBounds,
  lookupZip,
  stateByCode,
  ZIP_FLYTO_ZOOM,
} from './states';

/**
 * Chooser-first scope prototype (C0 gate).
 *
 * Three landing states, driven by the URL the way Stream C's url-state.ts will:
 *   - bare URL (no scope)      → the ScopeChooser is shown; the map render AND
 *                                the canned-data "fetch" are SUPPRESSED.
 *   - `?scope=us`              → whole-US CONUS map (de-emphasized escape hatch).
 *   - `?state=US-XX`           → fenced state view (fitBounds + maxBounds clamp).
 *
 * A ZIP resolves to a `?state=US-XX` + a camera flyTo at metro zoom — `?zip=`
 * is never persisted (matches locked decision #5). The canned fetch is gated
 * behind scope selection: this is the production cold-load-suppression contract
 * (C6/#740) the prototype must prove doesn't cause a flash of the national map.
 */

type Scope =
  | { kind: 'unscoped' }
  | { kind: 'us' }
  | { kind: 'state'; stateCode: string };

function readScopeFromUrl(): Scope {
  const params = new URLSearchParams(window.location.search);
  const state = params.get('state');
  if (state && stateByCode(state)) return { kind: 'state', stateCode: state };
  if (params.get('scope') === 'us') return { kind: 'us' };
  // Deep-link precedence: ?state wins over ?scope; an unknown state falls
  // through to the chooser rather than rendering a blank map.
  return { kind: 'unscoped' };
}

function writeScopeToUrl(scope: Scope): void {
  const params = new URLSearchParams(window.location.search);
  params.delete('state');
  params.delete('scope');
  if (scope.kind === 'state') params.set('state', scope.stateCode);
  else if (scope.kind === 'us') params.set('scope', 'us');
  const qs = params.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, '', url);
}

export function App() {
  const [scope, setScope] = useState<Scope>(() => readScopeFromUrl());
  const [zipError, setZipError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<
    { center: [number, number]; zoom: number; key: string } | undefined
  >(undefined);

  // Canned-data store. `null` = not fetched yet (the gated cold load). We only
  // populate it once a scope is chosen — proving the fetch is suppressed on the
  // bare-URL chooser landing.
  const [allObs, setAllObs] = useState<Observation[] | null>(null);
  const [fetchedScopeOnce, setFetchedScopeOnce] = useState(false);

  // Keep the URL in sync with scope (replaceState — no history spam).
  useEffect(() => {
    writeScopeToUrl(scope);
  }, [scope]);

  // GATED FETCH: only load the canned data once a scope exists. On the
  // unscoped chooser landing this never runs — the network panel stays empty,
  // mirroring the production cold-load suppression.
  useEffect(() => {
    if (scope.kind === 'unscoped') return;
    if (fetchedScopeOnce) return;
    let cancelled = false;
    void (async () => {
      const res = await fetch(`canned-az-scoped.json?scope=${scope.kind}`);
      const body = (await res.json()) as ObservationsResponse;
      if (cancelled) return;
      setAllObs(body.data);
      setFetchedScopeOnce(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, fetchedScopeOnce]);

  // Data clip. In production `?state=US-XX` is a hard server-side ST_Intersects
  // clip; here we simulate it with the state bbox so the state view renders
  // only its own rows. Whole-US shows everything.
  const observations = useMemo<Observation[]>(() => {
    if (!allObs) return [];
    if (scope.kind === 'us') return allObs;
    if (scope.kind === 'state') {
      const s = stateByCode(scope.stateCode);
      if (!s) return [];
      const [w, so, e, n] = s.bbox;
      return allObs.filter(
        (o) => o.lng >= w && o.lng <= e && o.lat >= so && o.lat <= n,
      );
    }
    return [];
  }, [allObs, scope]);

  const { bounds, boundsKey } = useMemo<{
    bounds: [[number, number], [number, number]];
    boundsKey: string;
  }>(() => {
    if (scope.kind === 'state') {
      const s = stateByCode(scope.stateCode);
      if (s) return { bounds: bboxToBounds(s.bbox), boundsKey: scope.stateCode };
    }
    return { bounds: CONUS_BOUNDS, boundsKey: 'us' };
  }, [scope]);

  const pickState = useCallback((stateCode: string) => {
    setZipError(null);
    setFlyTo(undefined);
    setScope({ kind: 'state', stateCode });
  }, []);

  const pickZip = useCallback((raw: string) => {
    const res = lookupZip(raw);
    if (!res) {
      setZipError(
        /^\d{5}$/.test(raw.trim().replace(/-\d{4}$/, ''))
          ? 'ZIP not recognized — try a nearby ZIP or pick a state'
          : 'Enter a 5-digit ZIP',
      );
      return;
    }
    setZipError(null);
    // ZIP resolves to a state scope + a camera flyTo at metro zoom.
    setScope({ kind: 'state', stateCode: res.stateCode });
    setFlyTo({ center: res.center, zoom: ZIP_FLYTO_ZOOM, key: `${res.zip}-${Date.now()}` });
  }, []);

  const pickWholeUs = useCallback(() => {
    setZipError(null);
    setFlyTo(undefined);
    setScope({ kind: 'us' });
  }, []);

  const backToChooser = useCallback(() => {
    setFlyTo(undefined);
    setScope({ kind: 'unscoped' });
  }, []);

  if (scope.kind === 'unscoped') {
    return (
      <ScopeChooser
        onPickState={pickState}
        onPickZip={pickZip}
        onPickWholeUs={pickWholeUs}
        zipError={zipError}
      />
    );
  }

  const regionLabel =
    scope.kind === 'us' ? 'USA' : stateByCode(scope.stateCode)?.name ?? scope.stateCode;

  return (
    <div className="scope-app">
      <header className="scope-app__bar">
        <span className="scope-app__region" data-testid="region-label">
          {regionLabel}
        </span>
        <span className="scope-app__count" data-testid="obs-count">
          {observations.length} sightings
        </span>
        {/* In-state on-map StateSelector (the C4 ScopeControl surface). Lives
            here so switching state changes the `bounds`/`maxBounds` props WHILE
            THE MAP STAYS MOUNTED — the direct validation of finding (a):
            react-map-gl re-applies the changed maxBounds prop with no remount. */}
        <select
          className="scope-app__switch"
          aria-label="Switch state"
          data-testid="state-switch"
          value={scope.kind === 'state' ? scope.stateCode : ''}
          onChange={(e) => e.target.value && pickState(e.target.value)}
        >
          <option value="">Switch state…</option>
          {STATES.map((s) => (
            <option key={s.stateCode} value={s.stateCode}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" className="scope-app__exit" onClick={backToChooser}>
          Change scope
        </button>
      </header>
      <div className="scope-app__map">
        <ScopedMap
          observations={observations}
          bounds={bounds}
          boundsKey={boundsKey}
          flyTo={flyTo}
        />
      </div>
    </div>
  );
}
