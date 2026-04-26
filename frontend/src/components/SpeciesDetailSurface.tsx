import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  apiClient: ApiClient;
}

/**
 * Dedicated species detail surface (`?detail=<code>&view=detail`).
 * Renders in-flow inside `<main>`, NOT as a `position: fixed` overlay.
 * Replaces the old SpeciesPanel sidebar/drawer.
 *
 * Shows: common name, scientific name, and family name fetched via
 * `useSpeciesDetail`. No ESC dismiss, no overlay, no close button —
 * the user navigates away via the browser back button or SurfaceNav.
 */
export function SpeciesDetailSurface(props: SpeciesDetailSurfaceProps) {
  const { speciesCode, apiClient } = props;
  const { loading, error, data } = useSpeciesDetail(apiClient, speciesCode);

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
          <h2 className="species-detail-common-name">{data.comName}</h2>
          <p className="species-detail-sci-name"><em>{data.sciName}</em></p>
          <p className="species-detail-family">{data.familyName}</p>
        </div>
      )}
    </div>
  );
}
