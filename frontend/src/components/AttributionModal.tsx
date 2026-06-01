import { useCallback, useEffect, useRef } from 'react';
import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * AttributionModal — credits surface for eBird, Phylopic, and
 * OSM/OpenMapTiles/OpenFreeMap. As of #830 this is the SINGLE full-credit
 * surface for the map: the bottom-right MapLibre AttributionControl bar was
 * removed, and the always-visible eBird credit now lives (as a link) in the
 * identity-card freshness line — the modal carries the complete credits.
 *
 * Compliance citations:
 *   - eBird API ToU §3: "You agree to attribute eBird.org as the source of
 *     the data accessed via the API wherever it is used or displayed…
 *     please accompany this with a link back to eBird.org." The always-visible
 *     anchor is the identity-card freshness-line eBird link (#830); the modal
 *     carries the full credit.
 *   - CC BY 3.0 / CC BY-SA 3.0 §4(b/c): per-work creator attribution +
 *     license URI; reasonable means of attribution must be prominent enough
 *     to be reachable from every surface that displays the work. The trigger
 *     is the persistent ⓘ button in <AppHeader> (controlled-open, #830 item D),
 *     so the prominence requirement is met on every view (view=map|detail).
 *   - OSM ODbL §4.3 / OSMF Attribution Guidelines: a labeled ⓘ → modal with
 *     "© OpenStreetMap" + link is explicitly sanctioned ("an '(i)' button in
 *     the corner of the map"); "any corner of the map is acceptable" (#830).
 *     OpenFreeMap/OpenMapTiles: required "OpenFreeMap © OpenMapTiles Data from
 *     OpenStreetMap" — all three linked in the Map Tiles section (#830 item C).
 *
 * Top layer & the CSS z-index scale (#761 O6, issue #782):
 *   `dialog.showModal()` (below, in the open effect) promotes this dialog into
 *   the browser **top layer** — a paint surface that sits ABOVE the entire CSS
 *   z-index stacking context REGARDLESS of any `z-index` value. It CANNOT be
 *   ordered by the named `--z-*` scale (`--z-overlay` … `--z-skip`, styles.css
 *   :root): no `--z-*` token governs this dialog, and none should be ADDED
 *   expecting to. A future author adding e.g. a `--z-modal`-based rule to "put
 *   Credits above X" would be wrong — `showModal()` already wins unconditionally,
 *   and `z-index` on a top-layer element is inert. The corollary is that
 *   `showModal()` also auto-`inert`s the rest of the document (the backdrop's
 *   sibling tree becomes non-interactive and AT-invisible) while the dialog is
 *   open, so no manual scrim/`inert` plumbing is required for THIS surface.
 *
 *   Focus-trap reconciliation with a future chooser scrim (gap 2, #782):
 *   The scope-chooser scrim conversion (epic-relative S1) will give the
 *   `.scope-chooser-scrim` its own JS focus trap. When THIS dialog is open it
 *   already top-layers + `inert`s the whole document, which MOOTS any scrim
 *   focus trap underneath it (the scrim's subtree is `inert`, so its trap has
 *   nothing focusable to cycle). Therefore the two must NOT both run JS focus
 *   traps simultaneously: when AttributionModal is open, the scrim's trap is a
 *   no-op by construction and must not fight the native `inert` (e.g. by
 *   re-focusing into the inert subtree on a focusout). The scrim work (S1)
 *   inherits this contract; O6 writes no scrim code.
 *
 * Modal idioms (this is the codebase's first modal — document the pattern):
 *   1. Native `<dialog>` element. `dialog.showModal()` opens with the
 *      browser-managed top-layer + backdrop; `dialog.close()` closes.
 *      Escape closes natively (no JS keydown handler needed).
 *   2. Manual focus management: store `document.activeElement` before
 *      `showModal()`, restore on `close`. The browser's default focus-on-
 *      first-tabbable behaviour is overridden by `autofocus` on the close
 *      button so SR users land on a clear "Close" affordance immediately.
 *   3. Backdrop-click-closes: `dialog.addEventListener('click', e =>
 *      e.target === dialog && dialog.close())`. The dialog's own bounding
 *      box hosts the backdrop in the top layer, so a click whose target IS
 *      the dialog element (not a descendant) is a backdrop click.
 *   4. External links use `rel="noopener noreferrer"` and `target="_blank"`.
 *      This is the canonical convention for every credit link in the app: the
 *      W3C Tag finding on referrer privacy mandates noreferrer for "credit"
 *      links to third parties. The old MapCanvas customAttribution (which used
 *      `noopener`-only) was removed in #830, so this is the single convention;
 *      the freshness-line eBird link (#830 item B) also uses noopener noreferrer.
 *   5. Controlled-open (#830 item D): the dialog has no internal trigger button.
 *      App.tsx owns `open` state, the AppHeader ⓘ button flips it, and the
 *      `open`-prop effect runs the shared open/close path. The native `close`
 *      event still drives onOpenChange(false) + focus-return.
 */

/**
 * Mapping of license short identifiers (from `family_silhouettes.license`)
 * to the canonical Creative Commons URL. If a row's license isn't in the
 * map, the modal renders the short identifier as plain text — fail-soft
 * on a curation script adding a license the modal hasn't been taught.
 */
const LICENSE_URLS: Record<string, string> = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-SA-3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
};

/**
 * Mapping for iNaturalist photo license codes (issue #327 task-11).
 *
 * Two shapes co-exist in the data path:
 *   - iNat-native lowercase codes from the photos ingest: `cc-by`,
 *     `cc-by-sa`, `cc0`, etc. (services/ingestor/src/inat/types.ts).
 *   - Legacy CC formal labels (`CC-BY-4.0`, `CC-BY-NC`) some test
 *     fixtures + handcurated rows carry. Normalize via lowercase lookup
 *     so the same modal serves both.
 *
 * `name` is the human-readable label the modal renders inline ("CC BY 4.0");
 * `url` is the deed page on creativecommons.org. The lookup is
 * case-insensitive — see `lookupPhotoLicense` below.
 */
const PHOTO_LICENSE_INFO: Record<string, { name: string; url: string }> = {
  'cc0': {
    name: 'CC0 1.0',
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  'cc-by': {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'cc-by-sa': {
    name: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  'cc-by-nc': {
    name: 'CC BY-NC 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
  'cc-by-nd': {
    name: 'CC BY-ND 4.0',
    url: 'https://creativecommons.org/licenses/by-nd/4.0/',
  },
  'cc-by-nc-sa': {
    name: 'CC BY-NC-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
  },
  'cc-by-nc-nd': {
    name: 'CC BY-NC-ND 4.0',
    url: 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
  },
  // Legacy CC formal codes (some seeded test rows + ingestor variants
  // store these). Mapped to the same deed pages.
  'cc-by-4.0': {
    name: 'CC BY 4.0',
    url: 'https://creativecommons.org/licenses/by/4.0/',
  },
  'cc-by-sa-4.0': {
    name: 'CC BY-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-sa/4.0/',
  },
  'cc-by-nc-4.0': {
    name: 'CC BY-NC 4.0',
    url: 'https://creativecommons.org/licenses/by-nc/4.0/',
  },
};

/**
 * Resolves an iNaturalist license code to a `{ name, url }` pair, or
 * returns `null` when the code isn't in the map. The component falls
 * back to rendering the raw code as plain text on `null` (mirrors the
 * Phylopic `LICENSE_URLS` fail-soft behavior).
 */
function lookupPhotoLicense(code: string): { name: string; url: string } | null {
  return PHOTO_LICENSE_INFO[code.toLowerCase()] ?? null;
}

export interface AttributionModalProps {
  /**
   * Phylopic per-silhouette credits sourced from `useSilhouettes()` in
   * App.tsx. The modal renders one row per silhouette with attributable
   * content (non-null `source` OR non-null `creator`); rows with both
   * null are the migration-1700000018000 fallback rows (seeded color
   * only) and are filtered out. When all rows filter out AND `loading`
   * / `error` are both falsy, the Phylopic section renders a
   * "No silhouette attributions available" message while the eBird and
   * OSM sections render unconditionally.
   */
  silhouettes: FamilySilhouette[];
  /**
   * Loading flag from `useSilhouettes()`. When `true`, the Phylopic
   * section renders an aria-live status message in lieu of an empty list,
   * so SR users opening Credits during a slow `/api/silhouettes` response
   * hear "Loading silhouette attributions…" instead of just the section
   * heading. Defaults to `false` for callers (e.g. tests) that don't
   * thread the hook state.
   */
  loading?: boolean;
  /**
   * Error from `useSilhouettes()`. When set, the Phylopic section renders
   * a user-facing fallback ("Couldn't load silhouette attributions…")
   * instead of the empty list. The raw error message is intentionally NOT
   * surfaced — credits are not the place to expose `pool exhausted`-style
   * backend strings. Defaults to `null`.
   */
  error?: Error | null;
  /**
   * Controlled open state (#830 item D). App.tsx owns this via
   * `const [attributionOpen, setAttributionOpen] = useState(false)` and the
   * AppHeader ⓘ trigger drives it. When it flips true the dialog `showModal()`s
   * (and initial focus + SR state behave identically to the old click-open
   * path); when it flips false the dialog `close()`s. Defaults to `false` for
   * callers (e.g. unit tests) that drive the dialog through a wrapper.
   */
  open?: boolean;
  /**
   * Optional open-state callback. App.tsx wires this to its `setAttributionOpen`
   * so the native `close` event (Escape / backdrop / close button) flips the
   * controlled state back to false. The callback fires once per state change
   * with the new `open` boolean.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * iNaturalist photographer attribution string for the currently-active
   * SpeciesDetailSurface photo (issue #327 task-11). Sourced from
   * `SpeciesMeta.photoAttribution`. Threaded by App.tsx from the active
   * detail-view species and `undefined` when `view !== 'detail'` or no
   * species is selected. The Photos credit section renders only when
   * BOTH `photoAttribution` AND `photoLicense` are present; either-
   * absent / both-absent collapses the section entirely.
   *
   * The explicit `| undefined` is required under
   * `exactOptionalPropertyTypes: true` so call sites can pass
   * `activeSpeciesMeta?.photoAttribution` (which may be `undefined`)
   * directly without TypeScript complaining. Mirrors `SpeciesDetailVisual`'s
   * `photoUrl` convention.
   */
  photoAttribution?: string | undefined;
  /**
   * iNaturalist license code for the active species photo (issue #327
   * task-11). iNat-native lowercase codes (`cc-by`, `cc-by-sa`, `cc0`)
   * and legacy CC formal codes (`CC-BY-4.0`) are both accepted via
   * case-insensitive lookup. Unknown codes render as plain text.
   */
  photoLicense?: string | undefined;
}

export function AttributionModal({
  silhouettes,
  loading = false,
  error = null,
  open = false,
  onOpenChange,
  photoAttribution,
  photoLicense,
}: AttributionModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Stash the previously-focused element when the modal opens so we can
  // return focus on close. With the controlled-open prop (#830 item D) the
  // restore target is the AppHeader ⓘ button (the element that had focus when
  // `open` flipped true); we capture document.activeElement at open time.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // The shared open path (#830 item D): both the controlled `open` effect below
  // and any future programmatic opener run THIS, so initial focus + SR state are
  // identical regardless of how the dialog was opened. Extracted from the old
  // click-handler body verbatim (minus the deleted internal trigger state).
  const openDialog = useCallback(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    // Some browsers throw if showModal() is called twice without an
    // intervening close; guard.
    if (!dialog.open) {
      dialog.showModal();
    }
    // Explicit focus on the close button. The `autofocus` attribute
    // (rendered via React's `autoFocus`) is honored by Chrome's
    // `showModal()` focus-delegation, but headless Chromium under
    // Playwright doesn't always run the delegation step before the
    // test's assertion races in. Setting focus here makes the contract
    // observable: after this returns, the close button IS the active
    // element. Wrap in queueMicrotask so React's render commit completes
    // before we touch the DOM ref.
    queueMicrotask(() => {
      const close = dialog.querySelector<HTMLButtonElement>('.attribution-modal-close');
      close?.focus();
    });
    onOpenChange?.(true);
  }, [onOpenChange]);

  // Controlled-open effect (#830 item D). Mirror the `open` prop into the
  // native dialog: open via the shared `openDialog` path, close via close().
  // Deps are [open] ONLY — onOpenChange is intentionally excluded so a parent
  // passing an unstable callback can't re-fire showModal()/close() on every
  // render (the open/close guards below also make re-runs idempotent). The
  // native `close` listener (below) is the single source of truth for
  // onOpenChange(false); this effect must not also call it on the close path.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      openDialog();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onClose = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (dialog.open) {
      dialog.close();
    }
  }, []);

  // The native `close` event fires in three paths: (1) manual close()
  // invocation, (2) Escape keypress, (3) backdrop click → close(). All
  // three converge here so focus-return is single-source-of-truth.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      onOpenChange?.(false);
      // Restore focus after the React commit cycle to the element that had
      // focus when the dialog opened (the AppHeader ⓘ button under the
      // controlled-open prop, #830 item D).
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
    const handleClick = (event: MouseEvent) => {
      // Backdrop click: the dialog element is the event target only when
      // the user clicks the backdrop area outside the modal content. Any
      // descendant click bubbles through with a different target.
      if (event.target === dialog) {
        dialog.close();
      }
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onOpenChange]);

  // Filter Phylopic rows to those with attributable content — either a
  // non-null source (Phylopic image-page URL → linkable row) OR a
  // non-null creator (CC-BY/CC-BY-SA still requires creator credit even
  // when the source URL was lost during curation; see migration
  // 1700000017000 NULL UPDATEs). Rows with BOTH null are the
  // Phylopic-less fallback rows from migration 1700000018000 — seeded
  // color only, nothing to attribute, drop.
  const phylopicRows = silhouettes.filter(s => s.source !== null || s.creator !== null);

  // #830 item D: the internal `.attribution-trigger` button is gone — the
  // dialog is controlled via the `open` prop, opened by the AppHeader ⓘ button.
  // Only the <dialog> renders here (no fragment wrapper needed).
  return (
      <dialog
        ref={dialogRef}
        className="attribution-modal"
        aria-labelledby="attribution-modal-title"
      >
        <div className="attribution-modal-content">
          <header className="attribution-modal-header">
            <h2 id="attribution-modal-title">Credits</h2>
            <button
              type="button"
              className="attribution-modal-close"
              onClick={onClose}
              autoFocus
              aria-label="Close credits"
            >
              Close
            </button>
          </header>
          <section className="attribution-modal-section">
            <h3>Bird Sightings Data</h3>
            <p>
              Bird sightings provided by{' '}
              <a
                href="https://ebird.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                eBird
              </a>{' '}
              (Cornell Lab of Ornithology).
            </p>
          </section>
          <section className="attribution-modal-section">
            <h3>Family Silhouettes</h3>
            {/*
              Render order matters: error wins over loading wins over
              "fetch succeeded but nothing attributable". The
              `useSilhouettes` hook can be (loading=true, silhouettes=[])
              or (error=Error, silhouettes=[]); checking error first keeps
              the failure path from getting stuck on "Loading…" forever
              after the fetch rejects. The fourth branch (no error, not
              loading, but `phylopicRows` is empty) covers the case where
              the API returned 200 but every row was filtered out — either
              an empty silhouettes table or a deploy where only
              migration-1700000018000 fallback rows (source=null,
              creator=null) survived curation. Render an explicit
              "no attributions" message rather than a bare heading.
            */}
            {error ? (
              <p className="attribution-modal-error" role="status" aria-live="polite">
                Couldn't load silhouette attributions — try again later.
              </p>
            ) : loading ? (
              <p className="attribution-modal-loading" role="status" aria-live="polite">
                Loading silhouette attributions…
              </p>
            ) : phylopicRows.length === 0 ? (
              <p className="attribution-modal-empty" role="status" aria-live="polite">
                No silhouette attributions available.
              </p>
            ) : (
              <>
                <p className="attribution-modal-section-intro">
                  Family silhouettes from{' '}
                  <a
                    href="https://www.phylopic.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    PhyloPic
                  </a>
                  . Per-silhouette credits:
                </p>
                <ul className="attribution-modal-phylopic-list">
                  {phylopicRows.map(row => {
                    const labelName = row.commonName ?? row.familyCode;
                    const licenseUrl = row.license ? LICENSE_URLS[row.license] : undefined;
                    return (
                      <li
                        key={row.familyCode}
                        className="attribution-modal-phylopic-row"
                        data-testid="attribution-phylopic-row"
                      >
                        {/*
                          Source-present branch: the labelName links to
                          the Phylopic image-page URL. Source-absent
                          branch (issue #274): render the labelName as
                          plain text — the previous `<a href="#">`
                          fallback looked like a working link but
                          navigated to the top of the page on click,
                          which is worse than no link at all. The row
                          still carries a creator credit below.
                        */}
                        {row.source !== null ? (
                          <a
                            href={row.source}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {labelName}
                          </a>
                        ) : (
                          <span className="attribution-modal-label">{labelName}</span>
                        )}
                        {row.creator && (
                          <>
                            {' '}by{' '}
                            <span className="attribution-modal-creator">{row.creator}</span>
                          </>
                        )}
                        {row.license && (
                          <>
                            {' — '}
                            {licenseUrl ? (
                              <a
                                href={licenseUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {row.license}
                              </a>
                            ) : (
                              <span className="attribution-modal-license-text">{row.license}</span>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          {/*
            iNat photo credit (issue #327 task-11). Renders only when
            BOTH `photoAttribution` and `photoLicense` are present —
            no "Photos" heading appears for species with a Phylopic-only
            visual. Section sits between Family Silhouettes and Map Tiles
            so the credit ordering follows the visual hierarchy on the
            detail surface (photo → silhouette fallback → map context).
          */}
          {photoAttribution && photoLicense && (() => {
            const licenseInfo = lookupPhotoLicense(photoLicense);
            return (
              <section
                className="attribution-modal-section"
                data-testid="attribution-photos-section"
              >
                <h3>Photos</h3>
                <p>
                  Species photos by{' '}
                  <span className="attribution-modal-photographer">
                    {photoAttribution}
                  </span>
                  {' — '}
                  {licenseInfo ? (
                    <a
                      href={licenseInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {licenseInfo.name}
                    </a>
                  ) : (
                    <span className="attribution-modal-license-text">
                      {photoLicense}
                    </span>
                  )}
                  {'. Photos sourced from '}
                  <a
                    href="https://www.inaturalist.org"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    iNaturalist
                  </a>
                  .
                </p>
              </section>
            );
          })()}
          {/*
            Species descriptions credit (issue #373 / epic #368). The
            section renders unconditionally — descriptions exist for >85%
            of species per the ingestor's Wikipedia coverage probe, and
            the catch-all credit covers the small minority that don't.
            Per-article attribution lives inline on SpeciesDetailSurface
            (the SpeciesDescription component renders "From Wikipedia,
            CC BY-SA" with a link to the source article); this modal
            section satisfies the prominence-of-attribution requirement
            without forcing a per-species credit row in the modal itself
            (which would scale to 344+ rows).
          */}
          <section
            className="attribution-modal-section"
            data-testid="attribution-descriptions-section"
          >
            <h3>Species descriptions</h3>
            <p>
              Species descriptions adapted from{' '}
              <a
                href="https://www.wikipedia.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                Wikipedia
              </a>
              {' '}under{' '}
              <a
                href="https://creativecommons.org/licenses/by-sa/3.0/"
                target="_blank"
                rel="noopener noreferrer"
              >
                CC BY-SA
              </a>
              . See each species panel for a per-article link.
            </p>
          </section>
          <section className="attribution-modal-section">
            <h3>Map Tiles</h3>
            {/*
              OpenFreeMap's required attribution is the full chain
              "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" — all three
              of OpenStreetMap, OpenMapTiles, and OpenFreeMap must be credited
              and linked (#830 item C; previously OpenMapTiles was omitted, a
              compliance gap). Order/connective words are free; the three
              linked names are the contractual minimum.
            */}
            <p>
              Base map data{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
              >
                &copy; OpenStreetMap
              </a>{' '}
              contributors, tiles by{' '}
              <a
                href="https://openmaptiles.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenMapTiles
              </a>
              , hosting by{' '}
              <a
                href="https://openfreemap.org"
                target="_blank"
                rel="noopener noreferrer"
              >
                OpenFreeMap
              </a>
              .
            </p>
          </section>
          {/*
            Privacy disclosure (issue #357 task 7; updated 2026-05-20 when
            Microsoft Clarity replaced PostHog).  Clarity collects session
            recordings, heatmaps, and custom event tags (`panel_opened`,
            `panel_dwell_ms`, `panel_scrolled_to_bottom`) so we can evaluate
            the panel-thinness hypothesis after >=14 days of data.  Clarity
            defaults to masking text content and form fields; first-party
            cookies are `_clck` and `_clsk` (see clarity.ts).  We don't claim
            DNT support — the Clarity SDK doesn't expose that knob.  Privacy
            is the final section after Map Tiles.
          */}
          <section className="attribution-modal-section">
            <h3>Privacy</h3>
            <p>Usage analytics via Microsoft Clarity, including session replay and heatmaps. Sensitive content (form fields, text) is masked by default.</p>
          </section>
        </div>
      </dialog>
  );
}
