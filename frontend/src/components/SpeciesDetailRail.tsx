import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client.js';
import { SpeciesDetailSurface } from './SpeciesDetailSurface.js';
import type { SightingsContext } from './sightings-context.js';
import type { Since } from '../state/url-state.js';

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
   * trigger is no longer in the document. Defaults to `#main-surface`
   * — the real focusable `<main tabIndex={0}>` (App.tsx). The in-place
   * rail coexists with the Map, so on close the user is still on the map
   * surface and the main landmark is the right place to land focus.
   *
   * (#911: the prior default `#surface-tab-map` was deleted in the
   * map-first re-architecture, so focus-restore was a silent no-op that
   * dropped focus onto <body> — a WCAG 2.4.3 regression. Restored here.)
   */
  fallbackFocusSelector?: string;
  /**
   * Sightings-Log context (epic #1299, F2 #1301) — threaded verbatim into the
   * shared <SpeciesDetailSurface> so the in-panel log knows which sightings to
   * show. App owns it (set on the marker click that opened the rail).
   */
  sightingsContext?: SightingsContext;
  /** Active since-window (url-state), forwarded to the surface for the F3 cell fetch. */
  since?: Since;
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
    fallbackFocusSelector = '#main-surface',
    sightingsContext,
    since,
  } = props;
  const asideRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  // recipe #07 (panel-reveal) + recipe #18 (texts-reveal): start in the
  // resting OFF-state, then flip ON in a post-paint mount effect so the
  // entrance plays. The rail remounts per species (key={state.detail} in
  // App.tsx), so this single flag drives BOTH the aside slide-in (data-open)
  // AND the identity stagger (passed down as `revealed`) on open + species
  // switch — no reflow-replay machinery needed. The close tween is skipped
  // by design: the rail unmounts via React conditional render, so there is
  // no exit frame to animate (animating close would need an unmount-defer
  // state machine — out of scope; the entrance is the win).
  const [revealed, setRevealed] = useState(false);

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

  // Post-paint reveal: flip ON after the browser has painted the resting
  // OFF-state at least once so the CSS transition actually runs (a same-frame
  // flip would jump straight to the end-state with no tween). A double rAF is
  // the portable way to land on the frame after first paint. Mount-only.
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
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
      className="species-detail-rail t-panel-slide"
      data-open={revealed ? 'true' : 'false'}
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
        revealed={revealed}
        {...(sightingsContext ? { sightingsContext } : {})}
        {...(since !== undefined ? { since } : {})}
      />
    </aside>
  );
}
