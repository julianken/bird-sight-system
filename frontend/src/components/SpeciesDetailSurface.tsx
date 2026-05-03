import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import type { FamilySilhouette } from '@bird-watch/shared-types';
import { PhenologyChart } from './PhenologyChart.js';

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
  const { loading, error, data } = useSpeciesDetail(apiClient, speciesCode);
  const { silhouettes } = useSilhouettes(apiClient);

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
        </div>
      )}
    </div>
  );
}
