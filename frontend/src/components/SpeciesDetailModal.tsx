import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ApiClient } from '../api/client.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';

export interface SpeciesDetailModalProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /**
   * The element that opened the modal. Focus restores to it on close.
   * If absent, focus restores to whichever element was focused at the
   * moment of open (mirrors AttributionModal's previouslyFocusedRef).
   */
  triggerRef?: RefObject<HTMLElement | null>;
}

/**
 * Desktop detail modal (Sky Atlas Phase 4). Native <dialog> wrapper around
 * <SpeciesDetailSurface>. Reuses AttributionModal.tsx:182–261's focus
 * capture / ESC / backdrop / close-event single-source-of-truth pattern
 * verbatim, with two differences:
 *
 *   1. aria-labelledby="detail-title" (vs AttributionModal's aria-label)
 *   2. Initial focus targets #detail-title (the species heading), NOT
 *      the close button — accessibility.md §New contract — detail dialog
 *      heading + focus order.
 *
 * Open/close is controlled by the consumer: the modal calls
 * showModal() once on mount, and onClose() exactly once when any of
 * (manual close, ESC, backdrop click) fires. The consumer typically
 * unmounts the modal after onClose runs (App.tsx flips view away from
 * 'detail' via useUrlState.set).
 */
export function SpeciesDetailModal(props: SpeciesDetailModalProps) {
  const { speciesCode, apiClient, onClose, triggerRef } = props;
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Open on mount. Mirror AttributionModal.tsx:198–221 — guard double
  // showModal() throws. Focus defers via MutationObserver so it fires
  // after SpeciesDetailSurface's data resolves and the heading mounts,
  // regardless of whether the data was already in cache (sync) or still
  // loading (async). The observer self-disconnects after first focus.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    previouslyFocusedRef.current =
      (triggerRef?.current as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);
    if (!dialog.open) {
      dialog.showModal();
    }

    // Try immediate first (cache hit), then observe for async data load.
    const tryFocus = () => {
      const heading = dialog.querySelector<HTMLElement>('#detail-title');
      if (heading) {
        heading.focus();
        return true;
      }
      return false;
    };

    if (!tryFocus()) {
      const observer = new MutationObserver(() => {
        if (tryFocus()) {
          observer.disconnect();
        }
      });
      observer.observe(dialog, { childList: true, subtree: true });
      return () => observer.disconnect();
    }
    // Mount-only effect: the dialog stays mounted until the consumer
    // unmounts it. Re-running on speciesCode change is unnecessary
    // because the body component remounts internally and the heading
    // re-focus is implicit on data-arrival via the surface's own focus
    // discipline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // close-event single-source-of-truth: ESC, manual close(), backdrop
  // click → close() all converge on the 'close' event. Mirrors
  // AttributionModal:234–261. Additionally listen for ESC keydown on the
  // dialog directly — JSDOM does not fire the native close event on ESC,
  // so this handler makes both JSDOM unit tests and real browsers work.
  // In real browsers the native ESC calls dialog.close() first, which
  // fires the 'close' event; the duplicate keydown handler's close() call
  // on an already-closed dialog is a no-op (dialog.open is false).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      const previous = previouslyFocusedRef.current;
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
      onClose();
    };
    const handleClick = (event: MouseEvent) => {
      // Backdrop click: target is the dialog itself only when the click
      // landed outside the content. Descendant clicks bubble with a
      // different target.
      if (event.target === dialog) {
        dialog.close();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      // ESC explicit handler — fires dialog.close() which triggers the
      // 'close' event handler above. Idempotent in real browsers because
      // native dialog closes first; required in JSDOM which doesn't
      // natively fire 'close' on ESC.
      if (event.key === 'Escape') {
        dialog.close();
      }
    };
    dialog.addEventListener('close', handleClose);
    dialog.addEventListener('click', handleClick);
    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClick);
      dialog.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const onCloseClick = useCallback(() => {
    dialogRef.current?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="species-detail-modal"
      aria-labelledby="detail-title"
    >
      <button
        type="button"
        className="species-detail-modal-close"
        aria-label="Close species detail"
        onClick={onCloseClick}
      >
        ×
      </button>
      <SpeciesDetailSurface speciesCode={speciesCode} apiClient={apiClient} />
    </dialog>
  );
}
