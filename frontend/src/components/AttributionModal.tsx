import { useCallback, useEffect, useRef, useState } from 'react';
import type { FamilySilhouette } from '@bird-watch/shared-types';

/**
 * AttributionModal — credits surface for eBird, Phylopic, and OSM/OpenFreeMap.
 *
 * Compliance citations:
 *   - eBird API ToU §3: "You agree to attribute eBird.org as the source of
 *     the data accessed via the API wherever it is used or displayed…
 *     please accompany this with a link back to eBird.org."
 *   - CC BY 3.0 / CC BY-SA 3.0 §4(b/c): per-work creator attribution +
 *     license URI; reasonable means of attribution must be prominent enough
 *     to be reachable from every surface that displays the work. The trigger
 *     lives in App.tsx's persistent `<footer role="contentinfo">` so the
 *     prominence requirement is met on every view (`view=map|feed|species|
 *     detail`) without abusing SurfaceNav's `role="tablist"` semantics.
 *   - OSM/OpenFreeMap ODbL §4.3: source attribution + license URL.
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
 *      The codebase's other ebird/OSM credits use `rel="noopener"` (see
 *      MapCanvas customAttribution); the modal intentionally diverges to
 *      `noopener noreferrer` because (a) the modal is the most prominent
 *      attribution surface and (b) the W3C Tag finding on referrer
 *      privacy mandates noreferrer for "credit" links to third parties.
 *      Future modals should match this convention.
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
   * Optional open-state callback. App.tsx can wire telemetry / focus
   * instrumentation through this without forcing a refactor. The callback
   * fires once per state change with the new `open` boolean.
   */
  onOpenChange?: (open: boolean) => void;
}

export function AttributionModal({
  silhouettes,
  loading = false,
  error = null,
  onOpenChange,
}: AttributionModalProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Stash the previously-focused element when the modal opens so we can
  // return focus on close. Storing on a ref avoids a re-render between
  // open and close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<boolean>(false);

  const onOpen = useCallback(() => {
    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? triggerRef.current;
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
    // observable: after onOpen returns, the close button IS the active
    // element. Wrap in queueMicrotask so React's render commit completes
    // before we touch the DOM ref.
    queueMicrotask(() => {
      const close = dialog.querySelector<HTMLButtonElement>('.attribution-modal-close');
      close?.focus();
    });
    setOpen(true);
    onOpenChange?.(true);
  }, [onOpenChange]);

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
      setOpen(false);
      onOpenChange?.(false);
      // Restore focus after the React commit cycle so the trigger button
      // (which may have re-rendered) actually exists in the DOM.
      const previous = previouslyFocusedRef.current ?? triggerRef.current;
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

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="attribution-trigger"
        onClick={onOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Credits
      </button>
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
          <section className="attribution-modal-section">
            <h3>Map Tiles</h3>
            <p>
              Base map data{' '}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noopener noreferrer"
              >
                &copy; OpenStreetMap
              </a>{' '}
              contributors, tile hosting by{' '}
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
        </div>
      </dialog>
    </>
  );
}
