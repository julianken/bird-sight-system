import { useEffect, useMemo, useRef } from 'react';
import type { ApiClient } from '../api/client.js';
import { useSpeciesDetail } from '../data/use-species-detail.js';
import { useSilhouettes } from '../data/use-silhouettes.js';
import { buildFamilyColorResolver, buildFamilyPathResolver, buildFamilyImgUrlResolver } from '../data/family-color.js';
import { analytics } from '../analytics.js';
import { SpeciesDescription } from './SpeciesDescription.js';
import { Photo } from './ds/Photo.js';
import { StatusBlock } from './ds/StatusBlock.js';
import type { FamilyCode } from '../config/family-palette.js';

export interface SpeciesDetailSurfaceProps {
  speciesCode: string;
  apiClient: ApiClient;
  /**
   * Drives the recipe #18 (texts-reveal) entrance on the identity block.
   * The wrapper (SpeciesDetailRail) starts this `false` on mount and flips
   * it `true` in a post-paint effect so the staggered name/sci/family lines
   * play from their resting off-state. Defaults to `true` so any consumer
   * that does NOT orchestrate the reveal (a direct render, a future modal,
   * the unit tests) shows the resting end-state immediately.
   */
  revealed?: boolean;
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
  const { speciesCode, apiClient, revealed = true } = props;
  const detail = useSpeciesDetail(apiClient, speciesCode);
  const { loading, error, data, retry } = detail;
  // useSilhouettes provides the family-color payload. The data is cached at
  // module level so there is no second network call when other consumers
  // (App.tsx, AttributionModal) have already called the hook.
  const { silhouettes } = useSilhouettes(apiClient);

  // Build the familyCode → color resolver once per silhouettes identity change.
  // The masthead silhouette renders in the family's DB color when photoUrl is
  // null (bot finding on #480).
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

  // Build the familyCode → svgUrl resolver (#502). When the admin-api has
  // uploaded an operator-curated SVG for the family, the masthead fallback
  // (and FamilySilhouette internally) prefer the CDN URL over the inline
  // path-d, rendering as a CSS-mask div tinted with the family color.
  const resolveImgUrl = useMemo(
    () => buildFamilyImgUrlResolver(silhouettes),
    [silhouettes],
  );

  // Build the familyCode → colloquial name resolver once per silhouettes
  // identity change (#1046 / C2). Mirrors the server's
  // COALESCE(family_silhouettes.common_name, species_meta.family_name) so
  // the detail surface shows the curated #924 colloquial name ("Hawks,
  // Eagles & Kites") instead of the raw eBird family_name ("Hawks, Eagles,
  // and Kites"). Keys are lowercased to match the server's lowercase
  // family_code — same lowercase-keyed silhouettes convention App.tsx uses for
  // its catalogue-derived Family filter options (#1050 C79).
  const resolveCommonName = useMemo(() => {
    const byCode = new Map<string, string | null>();
    for (const s of silhouettes) byCode.set(s.familyCode.toLowerCase(), s.commonName);
    return (familyCode: string | null | undefined, rawName: string): string => {
      if (!familyCode) return rawName;
      const hit = byCode.get(familyCode.toLowerCase());
      return hit ?? rawName;
    };
  }, [silhouettes]);

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
    // C82 (#1051): give the detail-rail error a recovery path. `retry()`
    // re-runs the fetch in place (no rail close + marker re-click). Mirrors
    // the app-level data-error overlay, which already uses StatusBlock's
    // first-class `action` prop.
    return (
      <StatusBlock
        state="error"
        title="Could not load species details"
        surface="panel"
        action={{ label: 'Try again', onClick: retry }}
      />
    );
  }

  if (!data) {
    return null;
  }

  const famColor = resolveColor(data.familyCode);

  return (
    <div className="species-detail-body">
      {/* A. Masthead photo — full-bleed hero (the .species-detail-body > .photo
          rule cancels the body gutter; .detail-fg-masthead pins the 232px
          height + scrim + object-position). */}
      <div className="detail-fg-masthead">
        <Photo
          src={data.photoUrl ?? null}
          alt={`${data.comName} photo`}
          family={data.familyCode as FamilyCode | null}
          color={famColor}
          pathD={resolvePath(data.familyCode)}
          imgUrl={resolveImgUrl(data.familyCode)}
          priority={true}
          layout="masthead"
        />
      </div>

      {/* B–D. Identity block — recipe #18 (texts-reveal): name=line1, sci=line2,
          family-row=line3. `.is-shown` is added post-paint by the wrapper
          (SpeciesDetailRail) so the stagger plays from the resting off-state on
          mount + per-species remount. */}
      <div className={`detail-fg-identity t-stagger${revealed ? ' is-shown' : ''}`}>
        <h1
          id="detail-title"
          tabIndex={-1}
          className="detail-name detail-fg-name t-stagger-line t-stagger-line--1"
        >
          {data.comName}
        </h1>
        <p className="detail-fg-sci t-stagger-line t-stagger-line--2">
          <em>{data.sciName}</em>
        </p>
        <p className="detail-fg-family t-stagger-line t-stagger-line--3">
          <span
            className="detail-fg-family-dot"
            aria-hidden="true"
            style={{ background: famColor }}
          />
          {resolveCommonName(data.familyCode, data.familyName)}
        </p>
      </div>

      {/* E. Family-accent rule — the strongest field-guide signal. */}
      <div
        className="detail-fg-rule"
        aria-hidden="true"
        style={{ background: famColor }}
      />

      {/* F. Taxonomy — real <dl> so AT ties label→value. Intentionally restates
          Scientific name + Family as formal labeled reference data (matches the
          mobile field-guide entry page); do NOT de-duplicate against B–D. */}
      <dl className="detail-fg-taxonomy">
        <div className="detail-fg-taxrow">
          <dt>Scientific name</dt>
          <dd><em>{data.sciName}</em></dd>
        </div>
        <div className="detail-fg-taxrow">
          <dt>Family</dt>
          <dd>{resolveCommonName(data.familyCode, data.familyName)}</dd>
        </div>
        <div className="detail-fg-taxrow">
          <dt>eBird taxonomic order</dt>
          <dd>{data.taxonOrder != null ? `#${data.taxonOrder}` : '—'}</dd>
        </div>
      </dl>

      {/* G. About — eyebrow + Wikipedia-credited prose. */}
      <div className="detail-fg-about">
        {data.descriptionBody ? (
          <>
            <h2 className="detail-fg-about-eyebrow">About</h2>
            <SpeciesDescription
              descriptionBody={data.descriptionBody}
              descriptionAttributionUrl={data.descriptionAttributionUrl}
            />
          </>
        ) : null}
      </div>

      {/* H. Sentinel — must remain the LAST child for the IntersectionObserver. */}
      <div
        ref={sentinelRef}
        data-testid="detail-bottom-sentinel"
        aria-hidden="true"
      />
    </div>
  );
}
