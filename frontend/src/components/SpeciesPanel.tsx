import { useEffect, useId } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useMediaQuery } from '../hooks/use-media-query.js';
import { useScrollRestore } from '../hooks/use-scroll-restore.js';

export interface SpeciesPanelProps {
  speciesCode: string | null;
  onDismiss: () => void;
  apiClient: ApiClient;
}

/**
 * Species detail panel. Opens when `speciesCode` is non-null and fetches
 * `/api/species/:code` via `useSpeciesDetail`.
 *
 * Responsive layout (issue #115):
 *
 *   - Mobile (<768px): full-width drawer with a tap-outside overlay that
 *     dismisses. Scroll position is captured on open and restored on close
 *     unless the user has scrolled materially while the panel was open.
 *   - Desktop (>=768px): 320px right-docked sidebar (legacy behaviour
 *     preserved). Outside clicks do NOT dismiss — this asymmetry is
 *     intentional. On desktop the panel is a peer to the page content, not
 *     a modal; casual mouse movement should not yank the panel closed.
 *
 * The `data-layout` attribute exposes the current mode to CSS and to e2e
 * tests; the overlay sibling is conditional on drawer mode only.
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
  const isMobile = useMediaQuery('(max-width: 767px)');
  // Scroll bookkeeping is driven by the active boolean. The hook no-ops
  // on sidebar mode too (no visual harm — we capture, we restore, but the
  // desktop sidebar does not push the body) and this keeps behaviour
  // symmetric in tests that flip viewports mid-test.
  useScrollRestore(speciesCode !== null);

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

  const layout = isMobile ? 'drawer' : 'sidebar';

  return (
    <>
      {isMobile && (
        // Overlay is the drawer's tap-outside target. It sits BEHIND the
        // aside in the DOM so pointer events on the panel body don't
        // bubble here and accidentally dismiss. Intentional role-less
        // presentational element; it is decoration for the sighted user
        // only. Screen-reader users get ESC + the close button.
        <div
          className="species-panel-overlay"
          aria-hidden="true"
          onClick={onDismiss}
        />
      )}
      <aside
        className="species-panel"
        role="complementary"
        aria-labelledby={headingId}
        data-layout={layout}
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
    </>
  );
}
