import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import type { FamilySilhouette, SpeciesMeta } from '@bird-watch/shared-types';
import { analytics } from '../analytics.js';
import { PhenologyChart } from './PhenologyChart.js';
import { SpeciesDescription } from './SpeciesDescription.js';

/**
 * Local widening of `SpeciesMeta` to surface the optional description
 * projection fields that ship with #372 (the db-client + shared-types PR
 * landing in parallel with this one). Once #372 lands and the fields
 * become first-class on `SpeciesMeta`, this alias becomes redundant — the
 * narrowing-via-truthy-check pattern is identical either way. Keeping the
 * alias here avoids a hard ordering coupling between the two PRs in the
 * Mergify queue: this PR builds clean against either type shape.
 *
 * Ordering: the wire payload from `/api/species/:code` carries these
 * fields when the read-api projection is updated (also in #372). When
 * the projection is absent, the fields deserialize as `undefined` and
 * the SpeciesDescription mount silently no-ops. A CDN-stale response
 * predating the projection has the same shape — the same render path
 * handles both.
 */
type SpeciesMetaWithDescription = SpeciesMeta & {
  descriptionBody?: string;
  descriptionLicense?: string;
  descriptionAttributionUrl?: string;
};

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  apiClient: ApiClient;
}

/**
 * Renders the per-species visual: the iNaturalist photo when SpeciesMeta
 * carries a non-null `photoUrl`, falling back to the family Phylopic
 * silhouette otherwise (and on photo-load failure via `onError`). The
 * silhouette payload comes from `useSilhouettes` (cached at module level
 * across the app, so this is essentially free to mount alongside the
 * App-level mount); the lookup keys on `data.familyCode`.
 *
 * Two rendering branches:
 *   - `<img src={photoUrl}>` — issue #327 task-10 happy path
 *   - SVG silhouette — fallback. Mirrors FamilyLegend's SilhouetteGlyph
 *     (svgData → <path>; null svgData → <circle>) so the visual language
 *     stays consistent across the app.
 *
 * Edge cases:
 *   - silhouettes still loading → render nothing (caller's "loading
 *     species details…" copy is already showing for the data fetch).
 *   - silhouette absent from the response (uncurated family) → render the
 *     null-svgData circle fallback in a neutral muted color.
 */
function SpeciesDetailVisual({
  comName,
  familyCode,
  photoUrl,
  silhouettes,
}: {
  comName: string;
  familyCode: string;
  photoUrl: string | undefined;
  silhouettes: FamilySilhouette[];
}) {
  // Reset photo-error state when speciesCode changes (the consumer remounts
  // this subtree implicitly via the parent's `data` prop change, but the
  // state-reset is explicit here so a future refactor that reuses the
  // component across species codes doesn't silently leak the prior species'
  // error state).
  const [photoErrored, setPhotoErrored] = useState<boolean>(false);
  useEffect(() => {
    setPhotoErrored(false);
  }, [photoUrl]);

  const silhouette = useMemo(
    () => silhouettes.find(s => s.familyCode === familyCode),
    [silhouettes, familyCode],
  );

  const showPhoto = !!photoUrl && !photoErrored;

  if (showPhoto && photoUrl) {
    return (
      <img
        className="species-detail-photo"
        src={photoUrl}
        alt={`${comName} photo`}
        onError={() => setPhotoErrored(true)}
      />
    );
  }

  // Silhouette fallback — render an SVG matching FamilyLegend's
  // SilhouetteGlyph. Use a fixed 96px box so the detail panel reads at
  // a usable size (vs the 28px legend glyph). When svgData is null the
  // fallback is a colored circle; when the family isn't in the silhouettes
  // payload at all (uncurated row), render a muted neutral circle so the
  // surface never holds an empty visual hole.
  const size = 96;
  if (silhouette?.svgData) {
    return (
      <svg
        data-testid="species-detail-silhouette"
        className="species-detail-silhouette"
        viewBox="0 0 24 24"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        <path d={silhouette.svgData} fill={silhouette.color} />
      </svg>
    );
  }
  return (
    <svg
      data-testid="species-detail-silhouette"
      className="species-detail-silhouette"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx={12} cy={12} r={6} fill={silhouette?.color ?? 'var(--color-text-muted)'} />
    </svg>
  );
}

/**
 * Dedicated species detail surface (`?detail=<code>&view=detail`).
 * Renders in-flow inside `<main>`, NOT as a `position: fixed` overlay.
 * Replaces the old SpeciesPanel sidebar/drawer.
 *
 * Shows: common name, scientific name, and family name fetched via
 * `useSpeciesDetail`. No ESC dismiss, no overlay, no close button —
 * the user navigates away via the browser back button or SurfaceNav.
 *
 * Photo (issue #327 task-10): when SpeciesMeta carries `photoUrl`, render
 * the photo as the surface's primary visual. Falls back to the family
 * Phylopic silhouette via `<SpeciesDetailVisual>` on photoUrl absence OR
 * on `<img onError>`. Silhouette payload comes from `useSilhouettes`
 * (module-level cache shared with the App-mounted hook in App.tsx — no
 * second network round-trip).
 */
export function SpeciesDetailSurface(props: SpeciesDetailSurfaceProps) {
  const { speciesCode, apiClient } = props;
  const detail = useSpeciesDetail(apiClient, speciesCode);
  const { loading, error } = detail;
  // Widen the resolved meta to the description-aware variant (see file-level
  // type alias). Read access is via the local `data` binding everywhere
  // below, so the cast is contained to one site.
  const data = detail.data as SpeciesMetaWithDescription | null;
  const { silhouettes } = useSilhouettes(apiClient);

  // Analytics instrumentation (issue #357 task 3): fire `panel_opened`
  // when a species resolves and `panel_dwell_ms` on unmount or species
  // change.  Hooks must live at the top level of the component body —
  // they CANNOT be inside the `data && (...)` JSX branch below per
  // React's rules of hooks.  Guard inside the effect so the events only
  // fire once `data?.speciesCode` is non-null (i.e. after the loading
  // state resolves), which keeps the dwell-ms timer from including the
  // initial fetch latency.
  useEffect(() => {
    if (!data?.speciesCode) return;
    const t0 = Date.now();
    const code = data.speciesCode;
    // Issue #373 task 6: tag `panel_opened` with `has_description` so the
    // panel-thinness dwell analysis can stratify post-hoc by whether a
    // species had a Wikipedia summary at the time of view. The dwell event
    // shape is intentionally unchanged — the analyst groups on the
    // `has_description` property of the open event at PostHog query time.
    analytics.capture('panel_opened', {
      species_code: code,
      has_description: !!data.descriptionBody,
    });
    return () => {
      analytics.capture('panel_dwell_ms', {
        species_code: code,
        dwell_ms: Date.now() - t0,
      });
    };
  }, [data?.speciesCode, data?.descriptionBody]);

  // Bottom-sentinel ref + IntersectionObserver effect (task 4).  Binary-
  // only signal: fire `panel_scrolled_to_bottom` once on first intersection
  // and disconnect.  At 390x844 the panel body stacks to ~320px inside a
  // ~750px usable viewport; sub-thresholds (25/50/75) would be noise.  The
  // sentinel is `aria-hidden` because there is no semantic content for SR
  // users at the end of the panel.
  //
  // The `firedRef` guards against any spurious re-invocation of the
  // observer callback between intersection-fired and disconnect-resolved,
  // and also resets per species (the effect dependency on
  // `speciesCodeForObserver` means a new observer + new `firedRef.current
  // = false` happens when the user navigates between species).
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const firedRef = useRef<boolean>(false);
  const speciesCodeForObserver = data?.speciesCode;
  useEffect(() => {
    if (!speciesCodeForObserver) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === 'undefined') return;
    firedRef.current = false;
    const observer = new IntersectionObserver(entries => {
      const intersected = entries.some(entry => entry.isIntersecting);
      if (intersected && !firedRef.current) {
        firedRef.current = true;
        analytics.capture('panel_scrolled_to_bottom', {
          species_code: speciesCodeForObserver,
        });
        observer.disconnect();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [speciesCodeForObserver]);

  return (
    <div className="species-detail-surface">
      {loading && (
        <p className="species-detail-loading" role="status" aria-live="polite">
          Loading species details…
        </p>
      )}

      {error && (
        <div className="species-detail-error" role="alert">
          Could not load species details
        </div>
      )}

      {data && (
        <div className="species-detail-body">
          <SpeciesDetailVisual
            comName={data.comName}
            familyCode={data.familyCode}
            photoUrl={data.photoUrl}
            silhouettes={silhouettes}
          />
          <h2 className="species-detail-common-name">{data.comName}</h2>
          <p className="species-detail-sci-name"><em>{data.sciName}</em></p>
          <p className="species-detail-family">{data.familyName}</p>
          <PhenologyChart speciesCode={speciesCode} apiClient={apiClient} />
          {/*
            SpeciesDescription mount (issue #373 / epic #368). Renders
            sanitized Wikipedia summary HTML when SpeciesMeta carries a
            non-null `descriptionBody`; returns `null` (silent no-op)
            when absent so CDN-stale responses degrade gracefully.
            Sits between PhenologyChart and the bottom sentinel — the
            sentinel must remain the LAST child of `.species-detail-body`
            (see comment below).
          */}
          <SpeciesDescription
            descriptionBody={data.descriptionBody}
            descriptionAttributionUrl={data.descriptionAttributionUrl}
          />
          {/*
            Bottom sentinel for the IntersectionObserver-driven
            `panel_scrolled_to_bottom` event (issue #357 task 4).
            `aria-hidden` because there is no semantic content here —
            it exists only to anchor the observer.  Must remain the LAST
            child of `.species-detail-body` so it only intersects after
            the user has scrolled past PhenologyChart, SpeciesDescription
            (when present), and the rest of the panel content.
          */}
          <div
            ref={sentinelRef}
            data-testid="phenology-bottom-sentinel"
            aria-hidden="true"
          />
        </div>
      )}
    </div>
  );
}
