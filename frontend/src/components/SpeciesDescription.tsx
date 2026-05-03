/**
 * SpeciesDescription — renders the per-species Wikipedia summary HTML
 * surfaced by `/api/species/:code` and credits Wikipedia inline.
 *
 * SECURITY INVARIANT
 * ──────────────────
 * - Sanitization is performed at INGEST time
 *   (`services/ingestor/src/wikipedia/sanitize.ts` via DOMPurify with a
 *   narrow tag/attr allowlist) and pinned at the database layer via
 *   CHECK constraints on `species_descriptions.body`. The writer-side
 *   allowlist + DB constraints constitute the trust boundary. Never
 *   render description body without going through the writer-side
 *   sanitizer.
 * - This is the FIRST USE of React's HTML-injection escape hatch in
 *   the codebase. Defense-in-depth runtime DOMPurify is intentionally
 *   deferred to v2 (the trust boundary above is sufficient for v1).
 *   See epic #368 for the audit trail.
 *
 * Render contract
 * ───────────────
 * - `descriptionBody` absent / empty → returns `null` (no shell, no
 *   credit anchor, no visual gap on CDN-stale responses predating the
 *   field).
 * - `descriptionBody` present → injects the HTML via the escape hatch
 *   and surfaces the inline "From Wikipedia, CC BY-SA" credit. The
 *   credit's anchor uses `target="_blank"` + `rel="noopener noreferrer"`
 *   matching the convention shared with AttributionModal's external
 *   links (the modal hosts the catch-all "Species descriptions" credit
 *   section; this inline credit covers the per-article requirement).
 */

export interface SpeciesDescriptionProps {
  /**
   * Sanitized HTML body sourced from `species_descriptions.body`. Optional
   * on the wire — older / cache-stale `/api/species/:code` responses omit
   * the field, in which case the component renders nothing. Empty string
   * is treated identically to undefined so a writer race can never produce
   * an empty `<section>` shell on the surface.
   */
  descriptionBody?: string;
  /**
   * Absolute URL to the source Wikipedia article. When the body is
   * present this URL backs the inline credit anchor's `href`. Defensive:
   * a CDN-stale response carrying body without URL renders the credit
   * text without an href rather than crashing.
   */
  descriptionAttributionUrl?: string;
}

export function SpeciesDescription({
  descriptionBody,
  descriptionAttributionUrl,
}: SpeciesDescriptionProps) {
  if (!descriptionBody) return null;
  return (
    <section className="species-detail-description">
      {/*
        SECURITY INVARIANT (see file-header doc): description body is
        DOMPurify-sanitized at ingest (services/ingestor/src/wikipedia/
        sanitize.ts). Never render description body without going
        through the writer-side sanitizer. First use of this escape
        hatch in the codebase — see epic #368 for the audit trail.
      */}
      <div dangerouslySetInnerHTML={{ __html: descriptionBody }} />
      <p className="species-detail-description-credit">
        From{' '}
        <a
          href={descriptionAttributionUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Wikipedia
        </a>
        , CC BY-SA
      </p>
    </section>
  );
}
