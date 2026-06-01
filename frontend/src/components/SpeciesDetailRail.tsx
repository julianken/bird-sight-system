import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { ApiClient } from '../api/client.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';

export interface SpeciesDetailRailProps {
  speciesCode: string;
  apiClient: ApiClient;
  onClose: () => void;
  /**
   * The element that opened the rail. Focus restores to it on close
   * IF the element is still attached to the document at close time.
   * Otherwise focus falls back to `fallbackFocusSelector`.
   */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * CSS selector for the stable focus target to use when the original
   * trigger is no longer in the document. Defaults to `#surface-tab-map`
   * — the in-place rail coexists with the Map, so on close the user is
   * still on the map surface and the Map tab is the right landmark.
   */
  fallbackFocusSelector?: string;
}

/**
 * Desktop in-place species detail rail (#663). Renders as
 * `<aside role="complementary">` on the right side of the viewport,
 * coexisting with a still-mounted MapSurface to the left.
 *
 * Why NOT `<dialog>.showModal()` anymore (#663 Addendum A):
 *
 *   `<dialog>.showModal()` puts the element in the top layer and creates
 *   an inert backdrop that blocks pointer events on every other DOM node
 *   — including the Map. The whole point of this change is that the user
 *   can keep panning / zooming the Map while the rail is open. An inert
 *   backdrop defeats that, so we drop modal semantics entirely and use
 *   an `<aside>` with manual ESC/focus management:
 *
 *     - ESC → onClose() via a document-level keydown listener
 *     - Focus on mount → the close button (so screen-reader users land
 *       somewhere meaningful immediately, and Tab order is predictable)
 *     - Focus return on close → the previously-focused element if still
 *       attached, else fallbackFocusSelector (#surface-tab-map by default)
 *     - No focus trap → by design. Users SHOULD be able to Tab back to
 *       Map controls. The rail coexists; it does not occlude.
 */
export function SpeciesDetailRail(props: SpeciesDetailRailProps) {
  const {
    speciesCode,
    apiClient,
    onClose,
    triggerRef,
    fallbackFocusSelector = '#surface-tab-map',
  } = props;
  const asideRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  const doClose = useCallback(() => {
    // Focus return discipline: restore to the original trigger if it's
    // still in the document, otherwise fall back to the stable map-tab
    // landmark. Calling .focus() on a detached node is a silent no-op
    // that drops focus onto <body>, so the fallback is load-bearing for
    // keyboard users.
    const previous = previouslyFocusedRef.current;
    const isAttached =
      previous !== null &&
      typeof previous.focus === 'function' &&
      document.contains(previous);
    if (isAttached) {
      previous!.focus();
    } else {
      const fallback = document.querySelector<HTMLElement>(fallbackFocusSelector);
      fallback?.focus();
    }
    onClose();
  }, [onClose, fallbackFocusSelector]);

  // Mount: capture previously-focused element and focus the close button.
  useEffect(() => {
    previouslyFocusedRef.current =
      (triggerRef?.current as HTMLElement | null) ??
      (document.activeElement as HTMLElement | null);
    // Defer focus to next microtask so the close button has definitely
    // mounted and is focusable when we call .focus().
    queueMicrotask(() => {
      closeBtnRef.current?.focus();
    });
    // Mount-only effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ESC handler — document-level so it catches the key regardless of
  // current focus location (focus may have moved into the Map by the
  // time the user presses ESC).
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        doClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [doClose]);

  return (
    <aside
      ref={asideRef}
      className="species-detail-rail"
      role="complementary"
      aria-labelledby="detail-title"
    >
      <button
        ref={closeBtnRef}
        type="button"
        className="species-detail-rail-close"
        aria-label="Close species detail"
        onClick={doClose}
      >
        ×
      </button>
      <SpeciesDetailSurface
        speciesCode={speciesCode}
        apiClient={apiClient}
      />
    </aside>
  );
}
