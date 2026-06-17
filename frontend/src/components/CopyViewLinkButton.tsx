/**
 * CopyViewLinkButton — C2 (#1240, epic #1238).
 *
 * A "Copy link to this view" icon-pill in the top-right controls cluster. On
 * click it reads the LIVE camera (via the `getCamera` prop — App threads a live
 * getter down from MapCanvas, NOT a settled snapshot, so a mid-pan click copies
 * what the user sees), builds a `…<search>#map=…&v=…` link through the C1 codec
 * (`encodeViewbox`), writes it to the clipboard, and confirms with a
 * transitions-dev success animation + an sr-only `role="status"` announcement.
 *
 * Clipboard ONLY — this control never mutates the app's own URL bar. The hash
 * round-trips the camera + capture viewport; the query (scope/filters/theme)
 * already rides on `location.search`. URL-bar restore is Part 2 (C3/C4).
 *
 * Four-corner contract: this pill lives in the TOP-RIGHT controls cluster as
 * the 4th child (Filters · ⓘ Credits · 🔗 Copy link · Theme). No toast, no new
 * band — the confirmation stays inside this one affordance (icon swap + label
 * swap), and on clipboard failure the link is surfaced in-place as a selectable
 * field rather than a transient notification (which would violate the contract).
 *
 * Motion: transitions-dev recipes, pasted verbatim into styles.css —
 *   - 09-icon-swap (link ⇄ check) wrapping 10-success-check (the check draws on),
 *     all breakpoints;
 *   - 04-text-states-swap ("Copy link" → "Copied!"), label only, `wide` only.
 * Each recipe keeps its own `@media (prefers-reduced-motion: reduce)` block (the
 * sanctioned exception — recipe 10 needs the check to land DRAWN, not invisible).
 *
 * a11y: <button type="button">, aria-label="Copy link to this view" (flips to
 * "Link copied" while confirming), matching title, data-testid. It is a momentary
 * action — NOT a disclosure/dialog/toggle — so it carries NO aria-haspopup /
 * aria-expanded / aria-pressed. The confirmation is announced by a visually-
 * hidden `role="status" aria-live="polite"` SIBLING span, never by aria-live on
 * the button itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { encodeViewbox, type ViewboxCamera } from '@/state/viewbox-link.js';

export interface CopyViewLinkButtonProps {
  /**
   * Live camera reader. App threads this down from MapCanvas (via MapSurface):
   * it returns the CURRENT `{ zoom, lat, lng, bearing?, pitch? }` at call time
   * — read at CLICK time, not continuously — or `null` when the map isn't ready
   * yet (cold mount before the first style.load). A `null` return makes the
   * click a clean no-op (nothing to copy), never a crash.
   */
  getCamera: () => ViewboxCamera | null;
  /**
   * Whether to render the text label ("Copy link" / "Copied!"). App gates this
   * on the SAME `bp === 'wide'` flag the Filters trigger uses, so the control is
   * icon-only below `wide` (matching the rest of the controls pill).
   */
  labeled: boolean;
}

// State machine: idle → copying → copied →(COPIED_MS)→ idle; on clipboard
// failure copying → error →(ERROR_MS)→ idle. One reset timer, cleared on
// re-click + unmount.
type CopyState = 'idle' | 'copying' | 'copied' | 'error';

// Dwell windows (ms). `copied` is short and celebratory; `error` dwells longer
// so the user can read the "Press ⌘C/Ctrl+C" instruction and select the link.
const COPIED_MS = 1600;
const ERROR_MS = 2600;

// The check glyph is `M20 6 9 17l-5-5`. `path.getTotalLength()` ≈ 21.9 for it;
// rounding up by 1 → 23 absorbs sub-pixel float jitter (recipe 10 calibration).
// styles.css hardcodes `stroke-dasharray: 23` to match; we ALSO set it inline on
// mount from the measured length so the draw stays clean even if the path edits.
const CHECK_DASH_FALLBACK = 23;

/**
 * Platform-detected manual-copy hint. macOS/iOS use ⌘C; everything else Ctrl+C.
 * Used in the wide label + the live-region failure instruction so the fallback
 * copy keystroke is correct per platform.
 */
function copyKeyHint(): { label: string; spoken: string } {
  const platform =
    typeof navigator !== 'undefined'
      ? `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`
      : '';
  const isApple = /Mac|iPhone|iPad|iPod/i.test(platform);
  return isApple
    ? { label: 'Press ⌘C', spoken: 'press Command C' }
    : { label: 'Press Ctrl+C', spoken: 'press Control C' };
}

/**
 * Build the shareable link for the current camera. Query (scope/filters/theme)
 * rides on `location.search`; the camera + capture viewport ride in the hash.
 * Reads `innerWidth/innerHeight/devicePixelRatio` directly for the `&v=` tag
 * (globals — fine; only zoom/center/bearing/pitch must come from the map).
 */
function buildLink(cam: ViewboxCamera): string {
  const fragment = encodeViewbox(cam, {
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
  });
  return (
    window.location.origin +
    window.location.pathname +
    window.location.search +
    '#' +
    fragment
  );
}

/**
 * Copy `text` to the clipboard. Returns `'copied'` on success, `'fallback'`
 * when the async + execCommand paths both fail (caller surfaces the selectable
 * field). NEVER swallows silently — the error UX is the caller's `error` state.
 *
 *   1. `navigator.clipboard.writeText` (the modern path; absent in insecure
 *      contexts, rejects when the document isn't focused / permission denied).
 *   2. `document.execCommand('copy')` over a transient hidden <textarea> — the
 *      legacy fallback for (1)'s absence/rejection.
 *   3. Neither worked → `'fallback'` (the caller renders + selects a prefilled
 *      field so the user's manual ⌘C/Ctrl+C copies the already-built link).
 *
 * Mirrors the try/catch + explanatory-comment shape of the localStorage access
 * guard in `utils/boot-theme.ts` (storage/clipboard both throw in sandboxed /
 * private contexts).
 */
async function copyToClipboard(text: string): Promise<'copied' | 'fallback'> {
  // Path 1: the async Clipboard API. Guarded — `navigator.clipboard` is
  // undefined in insecure contexts (non-HTTPS, some embeds) and `writeText`
  // rejects when the page lacks focus or clipboard-write permission.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      // Denied / not-focused / unavailable — fall through to execCommand. NOT
      // swallowed: a failure here is recovered by the synchronous path below,
      // and an ultimate failure is surfaced as the caller's `error` UX.
    }
  }

  // Path 2: the legacy execCommand fallback over a transient off-screen
  // <textarea>. Must be SELECTED + in the DOM for the copy command to read it.
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    // Off-screen but focusable/selectable (display:none would make it
    // unselectable and break execCommand).
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return 'copied';
  } catch {
    // execCommand throws in some locked-down environments — fall through to the
    // last-resort selectable field rather than swallowing.
  }

  return 'fallback';
}

export function CopyViewLinkButton({ getCamera, labeled }: CopyViewLinkButtonProps) {
  const [copyState, setCopyState] = useState<CopyState>('idle');
  // The live-region announcement text (success or the failure instruction).
  const [status, setStatus] = useState('');
  // The built link, surfaced as a selectable prefilled field on the failure
  // last-resort path so the user's manual ⌘C/Ctrl+C copies the right thing.
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);

  // ONE reset timer (idle return), cleared on re-click + unmount.
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The success-check SVG wrapper — drives the recipe-10 reflow-to-replay so a
  // re-click re-draws the check instead of freezing on the already-drawn state.
  const checkRef = useRef<HTMLSpanElement>(null);
  // The selectable fallback field, `.select()`-ed when the failure path renders.
  const fallbackRef = useRef<HTMLInputElement>(null);
  // The swap-able label span (recipe 04). Its textContent is managed
  // IMPERATIVELY during the three-phase swap; React seeds the initial text only.
  // Typed `| null` so the ref-callback assignment yields a MutableRefObject.
  const labelRef = useRef<HTMLSpanElement | null>(null);
  // Tracks the label text the recipe-04 swap last settled on, so the effect
  // below only animates a swap on an ACTUAL change (not on every re-render).
  const labelTextRef = useRef('Copy link');

  // Clear the reset timer on unmount (no setState-after-unmount).
  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  // Calibrate the success-check dash to the REAL path length on mount (recipe
  // 10), so the draw is clean even if the check path is ever edited. Falls back
  // to the styles.css-hardcoded 23 if measurement is unavailable (jsdom has no
  // getTotalLength).
  useEffect(() => {
    const path = checkRef.current?.querySelector('path');
    if (!path) return;
    let len = CHECK_DASH_FALLBACK;
    try {
      const measured = path.getTotalLength();
      if (Number.isFinite(measured) && measured > 0) len = Math.ceil(measured);
    } catch {
      // jsdom / non-SVG-rendering environments — keep the CSS fallback.
    }
    path.style.strokeDasharray = String(len);
    path.style.strokeDashoffset = String(len);
  }, []);

  // Recipe-10 replay: reset to "out", force a reflow, flip to "in" so the
  // keyframes (incl. the stroke draw) restart from offset 0 on every entry into
  // `copied` — a re-click re-draws rather than freezing.
  const replayCheck = useCallback(() => {
    const el = checkRef.current;
    if (!el) return;
    el.setAttribute('data-state', 'out');
    void el.offsetWidth; // force reflow so the keyframes restart
    el.setAttribute('data-state', 'in');
  }, []);

  // Recipe-04 (text-states-swap) orchestration, pasted from the catalog: old
  // text exits up + blurs, then the new text is set + jumps below, then a reflow
  // releases it to animate back to rest. `--text-swap-dur` is read via
  // getComputedStyle so the JS timer stays in sync with the CSS transition (the
  // global motion.css guard zeroes the duration under reduced motion; the
  // recipe's own kept guard zeroes the transition, so the swap is an instant
  // hard-cut then — still correct). One pending timer, cleared on re-entry.
  const labelSwapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swapLabel = useCallback((next: string) => {
    const el = labelRef.current;
    if (!el) {
      labelTextRef.current = next;
      return;
    }
    if (labelTextRef.current === next) return;
    labelTextRef.current = next;
    const dur =
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--text-swap-dur'),
      ) || 150;
    if (labelSwapTimerRef.current !== null) clearTimeout(labelSwapTimerRef.current);
    el.classList.add('is-exit');
    labelSwapTimerRef.current = setTimeout(() => {
      el.textContent = next;
      el.classList.remove('is-exit');
      el.classList.add('is-enter-start');
      void el.offsetHeight; // force reflow so the next change transitions
      el.classList.remove('is-enter-start');
    }, dur);
  }, []);

  // Clear the label-swap timer on unmount.
  useEffect(
    () => () => {
      if (labelSwapTimerRef.current !== null) clearTimeout(labelSwapTimerRef.current);
    },
    [],
  );

  const handleClick = useCallback(async () => {
    // Clear any in-flight reset so a rapid re-click restarts the cycle cleanly.
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setFallbackLink(null);

    const cam = getCamera();
    // Map not ready (cold mount) — clean no-op, nothing to copy.
    if (!cam) return;

    const link = buildLink(cam);
    setCopyState('copying');

    const result = await copyToClipboard(link);

    if (result === 'copied') {
      setCopyState('copied');
      setStatus('Link copied to clipboard');
      // Replay AFTER the DOM has the check mounted (it is always mounted; the
      // reflow restarts its draw). rAF lets React commit the data-state flip
      // below first, then we restart the keyframes.
      requestAnimationFrame(replayCheck);
      resetTimerRef.current = setTimeout(() => {
        setCopyState('idle');
        setStatus('');
      }, COPIED_MS);
    } else {
      // Last resort: surface the link as a selectable, prefilled field and
      // announce the manual-copy instruction. NOT a swallowed failure.
      const { spoken } = copyKeyHint();
      setCopyState('error');
      setFallbackLink(link);
      setStatus(`Copy failed. Link is selected — ${spoken} to copy.`);
      resetTimerRef.current = setTimeout(() => {
        setCopyState('idle');
        setStatus('');
        setFallbackLink(null);
      }, ERROR_MS);
    }
  }, [getCamera, replayCheck]);

  // Select the fallback field once it renders so the user's manual ⌘C/Ctrl+C
  // copies the built link without an extra click.
  useEffect(() => {
    if (fallbackLink && fallbackRef.current) {
      fallbackRef.current.focus();
      fallbackRef.current.select();
    }
  }, [fallbackLink]);

  const copied = copyState === 'copied';
  const errored = copyState === 'error';
  const keyHint = copyKeyHint();

  // The label text follows the state machine; the icon swaps link⇄check via the
  // 09-icon-swap recipe (`data-state` on the wrapper). On error the icon STAYS
  // the link glyph (no check) — failure must not read as success.
  const labelText = copied ? 'Copied!' : errored ? keyHint.label : 'Copy link';

  // Drive the recipe-04 label swap whenever the desired label changes AND the
  // label is mounted (wide only). swapLabel no-ops when the text is unchanged,
  // so this fires exactly on real transitions (Copy link → Copied! → Copy link).
  useEffect(() => {
    if (labeled) swapLabel(labelText);
  }, [labelText, labeled, swapLabel]);

  return (
    <>
      <button
        type="button"
        className="app-header-copy-link"
        onClick={handleClick}
        // Flips idle→copied for re-focus correctness (a screen reader landing
        // back on the button after the copy hears the new state). NOT aria-live.
        aria-label={copied ? 'Link copied' : 'Copy link to this view'}
        title={copied ? 'Link copied' : 'Copy link to this view'}
        data-testid="copy-view-link"
        data-state={copyState}
      >
        {/* 09-icon-swap: link ⇄ check, cross-fade in one inline-grid cell.
            data-state 'a' = link (resting / copying / error), 'b' = check
            (copied only). The check wrapper is the 10-success-check surface. */}
        <span
          className="app-header-copy-icon t-icon-swap"
          data-state={copied ? 'b' : 'a'}
          aria-hidden="true"
        >
          {/* link-2 glyph (two rounded hooks + a horizontal bar — no thin 45°
              hairline that aliases at 20px). 20px, currentColor, stroke-2. */}
          <span className="t-icon app-header-btn-icon" data-icon="a">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </span>
          {/* 10-success-check: the check draws on when shown. The wrapper drives
              fade + rotate + blur + Y-bob; the <path> gets the stroke-draw. */}
          <span
            ref={checkRef}
            className="t-icon t-success-check app-header-btn-icon"
            data-icon="b"
            data-state="out"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M20 6 9 17l-5-5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </span>

        {/* 04-text-states-swap label — `wide` only. Its textContent is managed
            IMPERATIVELY by swapLabel (recipe 04 three-phase orchestration), so it
            renders with NO React child; a mount effect seeds the current text and
            the driving effect above animates subsequent changes. suppressHydration
            keeps React from warning about the imperatively-owned text node. */}
        {labeled && (
          <span
            ref={(el) => {
              labelRef.current = el;
              // Seed the label text on mount (and re-mount when toggling to
              // `wide`) so it shows the current state's text immediately. The
              // swap effect handles all subsequent transitions.
              if (el && el.textContent !== labelTextRef.current) {
                el.textContent = labelTextRef.current;
              }
            }}
            className="app-header-btn-label t-text-swap"
            suppressHydrationWarning
          />
        )}
      </button>

      {/* Confirmation live region — a visually-hidden role="status" SIBLING
          span (NOT aria-live on the button). Announces success / the failure
          instruction. Matches the AppHeader scope-change announcer pattern. */}
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>

      {/* Clipboard-failure last resort — a selectable, read-only field prefilled
          with the built link, .select()-ed so the user's manual ⌘C/Ctrl+C copies
          it. Rendered ONLY on the error path; no toast, no new band. */}
      {fallbackLink && (
        <input
          ref={fallbackRef}
          className="app-header-copy-fallback"
          type="text"
          readOnly
          value={fallbackLink}
          data-testid="copy-view-link-fallback"
          aria-label="Link to this view — copy manually"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </>
  );
}
