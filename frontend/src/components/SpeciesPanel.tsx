import { useEffect, useId } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';

export interface SpeciesPanelProps {
  speciesCode: string | null;
  onDismiss: () => void;
  apiClient: ApiClient;
}

/**
 * Right-hand species detail sidebar. Opens when `speciesCode` is non-null
 * and fetches `/api/species/:code` via `useSpeciesDetail`.
 *
 * ESC handling — deliberately scoped to when the panel is open rather than
 * mounted globally at the App level. The spec called for this explicitly:
 *   - `frontend/e2e/region-collapse.spec.ts:47-63` is still `test.fail()`
 *     and no App-level keydown listener exists today. Adding a shared
 *     listener would tangle species-close and region-collapse semantics
 *     into a single merge-conflict-prone surface.
 *   - A scoped listener only runs while the panel is mounted (i.e. while
 *     `speciesCode !== null`), so it can never swallow ESC for any other
 *     future feature. When region-collapse ESC lands in a later PR, both
 *     listeners coexist: the species panel takes priority when open (it
 *     mounts after the region is opened, or independently), and the
 *     region-collapse listener handles the case where no species is
 *     selected.
 */
export function SpeciesPanel(props: SpeciesPanelProps) {
  const { speciesCode, onDismiss, apiClient } = props;
  const { loading, error, data } = useSpeciesDetail(apiClient, speciesCode);
  const headingId = useId();

  // Scoped ESC handler — see component JSDoc for why this lives here and
  // not in App.tsx. The effect only registers while the panel is mounted.
  useEffect(() => {
    if (speciesCode === null) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [speciesCode, onDismiss]);

  if (speciesCode === null) return null;

  return (
    <aside
      className="species-panel"
      role="complementary"
      aria-labelledby={headingId}
    >
      <button
        type="button"
        className="species-panel-close"
        aria-label="Close species details"
        onClick={onDismiss}
      >
        {/* Visual X; aria-label above is the accessible name. */}
        <span aria-hidden="true">×</span>
      </button>

      {loading && (
        <p className="species-panel-loading" aria-live="polite">Loading species details…</p>
      )}

      {error && (
        <div className="species-panel-error" role="alert">
          Could not load species details
        </div>
      )}

      {data && (
        <div className="species-panel-body">
          <h2 id={headingId} className="species-panel-common-name">{data.comName}</h2>
          <p className="species-panel-sci-name"><em>{data.sciName}</em></p>
          <p className="species-panel-family">{data.familyName}</p>
        </div>
      )}

      {/* When the panel is open but has neither data nor error yet (initial
          fetch in flight), we still need a labelled heading for the aria-
          labelledby contract. Render an invisible (sr-only) placeholder
          tied to the same id so screen readers announce the region with a
          name even while the body is loading. */}
      {!data && (
        <h2 id={headingId} className="species-panel-sr-heading">Species details</h2>
      )}
    </aside>
  );
}
