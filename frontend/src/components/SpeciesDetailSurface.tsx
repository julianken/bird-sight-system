import { useEffect, useMemo, useRef } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import { buildFamilyColorResolver, buildFamilyPathResolver } from '../data/family-color.js';
import { analytics } from '../analytics.js';
import { PhenologyChart } from './PhenologyChart.js';
import { SpeciesDescription } from './SpeciesDescription.js';
import { Photo } from './ds/Photo.js';
import { StatusBlock } from './ds/StatusBlock.js';
import type { FamilyCode } from '../config/family-palette.js';

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  apiClient: ApiClient;
}

/**
 * Presentational body of the detail surface (Phase 4). Composed inside
 * <SpeciesDetailModal> (desktop) and <SpeciesDetailSheet> (mobile);
 * never rendered directly in <main> after Phase 4 ships. The component
 * does not own scroll, dismiss, or focus-capture — those belong to its
 * wrappers.
 *
 * Heading contract (accessibility.md §New contract — detail dialog
 * heading + focus order):
 *   <h1 id="detail-title" tabIndex={-1}> is the dialog's accessible name
 *   target. Wrappers carry aria-labelledby="detail-title" and call
 *   dialog.querySelector('#detail-title').focus() after open.
 *
 * Photo contract (components.md §<Photo>):
 *   <Photo priority={true}> on the masthead → loading="eager"
 *   fetchpriority="high" so LCP stays <2.5s on mobile and <1s on dev
 *   hardware (Lighthouse).
 *
 * Analytics + IntersectionObserver are preserved unchanged from the
 * pre-Phase-4 implementation; panel_scrolled_to_bottom now fires
 * inside the wrapper's scroll container (modal or sheet), not <main>.
 */
export function SpeciesDetailSurface(props: SpeciesDetailSurfaceProps) {
  const { speciesCode, apiClient } = props;
  const detail = useSpeciesDetail(apiClient, speciesCode);
  const { loading, error, data } = detail;
  // useSilhouettes provides the family-color payload. The data is cached at
  // module level so there is no second network call when other consumers
  // (App.tsx, AttributionModal) have already called the hook.
  const { silhouettes } = useSilhouettes(apiClient);

  // Build the familyCode → color resolver once per silhouettes identity change.
  // Mirrors the FeedSurface pattern so the masthead silhouette renders in the
  // family's DB color when photoUrl is null (bot finding on #480).
  const resolveColor = useMemo(
    () => buildFamilyColorResolver(silhouettes),
    [silhouettes],
  );

  // Build the familyCode → svgData (path) resolver once per silhouettes identity
  // change. Mirrors the color resolver — ensures the masthead fallback silhouette
  // renders the real DB shape (not the generic apple glyph).
  const resolvePath = useMemo(
    () => buildFamilyPathResolver(silhouettes),
    [silhouettes],
  );

  // Analytics: panel_opened / panel_dwell_ms (preserved from pre-Phase-4).
  useEffect(() => {
    if (!data?.speciesCode) return;
    const t0 = Date.now();
    const code = data.speciesCode;
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
  }, [data?.speciesCode]);

  // Bottom sentinel: panel_scrolled_to_bottom. Re-roots automatically
  // onto whichever ancestor scroll container hosts this body — the modal
  // <div> on desktop or the sheet <div> on mobile. IntersectionObserver
  // walks up to the nearest scrolling ancestor by default.
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

  if (loading) {
    return (
      <StatusBlock
        state="loading"
        title="Loading species details…"
        surface="panel"
      />
    );
  }

  if (error) {
    return (
      <StatusBlock
        state="error"
        title="Could not load species details"
        surface="panel"
      />
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="species-detail-body">
      <Photo
        src={data.photoUrl ?? null}
        alt={`${data.comName} photo`}
        family={data.familyCode as FamilyCode | null}
        color={resolveColor(data.familyCode)}
        pathD={resolvePath(data.familyCode)}
        priority={true}
        layout="masthead"
      />
      <h1 id="detail-title" tabIndex={-1} className="detail-name">
        {data.comName}
      </h1>
      <p className="species-detail-sci-name"><em>{data.sciName}</em></p>
      <p className="species-detail-family">{data.familyName}</p>
      <PhenologyChart speciesCode={speciesCode} apiClient={apiClient} />
      <SpeciesDescription
        descriptionBody={data.descriptionBody}
        descriptionAttributionUrl={data.descriptionAttributionUrl}
      />
      <div
        ref={sentinelRef}
        data-testid="phenology-bottom-sentinel"
        aria-hidden="true"
      />
    </div>
  );
}
