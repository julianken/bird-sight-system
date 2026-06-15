/**
 * ThemeSelector — the user-facing control for all 5 basemap themes (C8 · #1220,
 * epic #1221). Supersedes the old binary <ThemeToggle> (light↔dark): it exposes
 * Positron · Bright · Liberty · Dark · Fiord as one `role="radiogroup"`.
 *
 * Selecting a theme calls C7's `applyTheme(id)` (writes `[data-theme]` from the
 * descriptor's kind + persists the id under localStorage['theme']) AND the
 * `onSelect(id)` prop, which drives the id-keyed basemap swap (C1.5 · #1213) —
 * including SAME-KIND switches (positron→bright→liberty, dark→fiord), which the
 * `[data-theme]`-only path can never reach because the attribute doesn't change.
 *
 * Four-corner anchor contract (CLAUDE.md / floating-UI spec §4.3): this control's
 * resting trigger lives in the TOP-RIGHT controls pill; its expanded form is a
 * TRANSIENT-LAYER surface (a popover anchored under the trigger) — NOT a new band.
 *
 * Interaction (C8 rework — single icon→popover on ALL viewports):
 *   A single THEME ICON button is the only resting form at every breakpoint.
 *   Clicking it EXPANDS the selector open as a popover listing the 5 options.
 *   Selecting a theme applies it AND CLOSES the popover. Esc and an outside
 *   click also close it. (The earlier desktop "always-inline segmented strip"
 *   form is removed — there is one form now, the icon-triggered popover.)
 *
 * Open-state is CONTROLLED by the parent (AppHeader) via `open` + `onOpenChange`,
 * so AppHeader can enforce the single-header-popover invariant: opening the theme
 * popover closes the scope "Change region" disclosure and the Filters panel, and
 * opening either of those closes this popover — only ONE header popover open at a
 * time, never overlapping.
 *
 * Open/close animation — transitions-dev MENU-DROPDOWN recipe (styles.css
 * `.t-dropdown`): the popover surface carries `.t-dropdown` + `data-origin=
 * "top-right"`. Open adds `.is-open`; close swaps to `.is-closing` and unmounts
 * after `--dropdown-close-dur` (read from getComputedStyle so the JS timer stays
 * in sync with the CSS var). The recipe's per-element prefers-reduced-motion
 * guard is preserved in CSS (alongside the global motion.css guard).
 *
 * ARIA: the icon trigger is a disclosure button — `aria-haspopup`,
 * `aria-expanded`, `aria-controls` (a valid IDREF; the radiogroup is mounted
 * through the close animation), `aria-label="Map theme: <active>"`. The popover
 * holds a single `role="radiogroup"` (`aria-label="Map theme"`) with `role=
 * "radio"` + `aria-checked` children. Roving tabindex (only the active radio is
 * tabbable); Left/Right AND Up/Down arrows move + select (selection-follows-
 * focus); Home/End jump to first/last. Focus moves into the open popover (the
 * active radio) and returns to the trigger on close. A visually-hidden
 * `aria-live` region announces the new theme.
 *
 * Spec: docs/design/standalone/2026-05-30-floating-ui-design-spec.md §4.3
 */

import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { applyTheme } from '../utils/boot-theme.js';
import {
  THEME_REGISTRY,
  THEME_LABELS,
  type ThemeId,
} from '@/components/map/geometry/basemap-style.js';

/** The 5 ids in registry render order (Positron · Bright · Liberty · Dark · Fiord). */
const THEME_IDS = Object.keys(THEME_REGISTRY) as ThemeId[];

/** Fallback close duration (ms) if the CSS var can't be read (jsdom). Matches
 *  `--dropdown-close-dur` in tokens.css; the live value is read at close time so
 *  the JS unmount timer stays in sync with the CSS transition. */
const CLOSE_DUR_FALLBACK_MS = 150;

/** Read `--dropdown-close-dur` (e.g. "150ms") off :root and parse to ms. */
function readCloseDurationMs(el: HTMLElement | null): number {
  if (!el || typeof getComputedStyle !== 'function') return CLOSE_DUR_FALLBACK_MS;
  const raw = getComputedStyle(el).getPropertyValue('--dropdown-close-dur').trim();
  if (!raw) return CLOSE_DUR_FALLBACK_MS;
  const ms = raw.endsWith('ms')
    ? parseFloat(raw)
    : raw.endsWith('s')
      ? parseFloat(raw) * 1000
      : parseFloat(raw);
  return Number.isFinite(ms) ? ms : CLOSE_DUR_FALLBACK_MS;
}

export interface ThemeSelectorProps {
  /** The active theme id (App-level source of truth; `useActiveThemeId`). */
  activeThemeId: ThemeId;
  /**
   * Drive the id-keyed basemap swap (C1.5). Called with the chosen id AFTER
   * `applyTheme` has written `[data-theme]` + persisted; same-kind switches reach
   * the swap only through this setter (the attribute is unchanged). Typically the
   * `setThemeId` returned by `useActiveThemeId` in App.tsx.
   */
  onSelect: (id: ThemeId) => void;
  /**
   * Whether the popover is open — CONTROLLED by AppHeader so it can enforce the
   * single-header-popover invariant (opening theme closes scope + filters, and
   * vice versa).
   */
  open: boolean;
  /** Request an open-state change. AppHeader closes the other header popovers on
   *  the `true` edge and lets the popover open. */
  onOpenChange: (next: boolean) => void;
}

export function ThemeSelector({
  activeThemeId,
  onSelect,
  open,
  onOpenChange,
}: ThemeSelectorProps) {
  const groupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLSpanElement | null>(null);
  // Refs to each radio so roving-tabindex focus + arrow nav can move focus
  // imperatively (selection-follows-focus). Keyed by id.
  const radioRefs = useRef<Partial<Record<ThemeId, HTMLButtonElement | null>>>({});

  // ── Menu-dropdown enter/exit orchestration ──────────────────────────────────
  // `mounted` keeps the popover in the DOM through the close animation; `closing`
  // drives the `.is-closing` exit class. Open: mount + (next frame) flip to open.
  // Close: swap to closing, then unmount after `--dropdown-close-dur`.
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  const [entered, setEntered] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open) {
      // Cancel any in-flight close, mount, then add `.is-open` on the next frame
      // so the `.t-dropdown` enter transition (scale + opacity) actually plays.
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setClosing(false);
      setMounted(true);
      setEntered(false);
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    // Closing: if nothing is mounted there is nothing to animate out.
    if (!mounted) return;
    setEntered(false);
    setClosing(true);
    const dur = readCloseDurationMs(popoverRef.current ?? triggerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setMounted(false);
      setClosing(false);
      closeTimerRef.current = null;
    }, dur);
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
    // `mounted` intentionally omitted — this effect is keyed off the `open` edge;
    // including `mounted` would re-fire the close branch when we set it false.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** Apply a theme: write [data-theme] + persist (applyTheme), then drive the
   *  id-keyed swap (onSelect), announce it to AT, and CLOSE the popover. */
  const select = useCallback(
    (id: ThemeId) => {
      applyTheme(id);
      onSelect(id);
      if (liveRef.current) {
        liveRef.current.textContent = `${THEME_LABELS[id]} theme`;
      }
      // Selecting a theme closes the popover and returns focus to the trigger.
      onOpenChange(false);
      triggerRef.current?.focus();
    },
    [onSelect, onOpenChange],
  );

  // When the popover opens, move focus to the active radio (spec §7 — the
  // disclosure focuses its active control on open). Keyed off `mounted && open`
  // rather than `open` alone: the radios mount ONE render after `open` flips
  // (the mount effect sets `mounted` true on the next commit), so focusing on
  // the `open` edge would run before the radios exist and silently no-op. A
  // per-open guard ref ensures we focus exactly once per open (not on every
  // re-render while open).
  const focusedOnOpenRef = useRef(false);
  useEffect(() => {
    if (open && mounted) {
      if (!focusedOnOpenRef.current) {
        focusedOnOpenRef.current = true;
        radioRefs.current[activeThemeId]?.focus();
      }
    } else if (!open) {
      focusedOnOpenRef.current = false;
    }
    // activeThemeId intentionally omitted — focus only on the open edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  // Outside-click closes the popover (spec §7 transient-surface dismissal).
  // Listens only while open; a mousedown outside both the trigger and the
  // popover collapses it. The trigger's own onClick toggles, so we exclude it
  // here to avoid a double-toggle race.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))
      ) {
        return;
      }
      onOpenChange(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onOpenChange]);

  /** Roving-tabindex keyboard nav within the radiogroup. Left/Up → prev,
   *  Right/Down → next (wrapping), Home → first, End → last; selection follows
   *  focus. Space/Enter re-select the focused radio (which also closes). */
  const onRadioKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: ThemeId) => {
      const idx = THEME_IDS.indexOf(id);
      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIdx = (idx + 1) % THEME_IDS.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIdx = (idx - 1 + THEME_IDS.length) % THEME_IDS.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = THEME_IDS.length - 1;
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          select(id);
          return;
        default:
          return;
      }
      e.preventDefault();
      const nextId = THEME_IDS[nextIdx]!;
      // Arrow nav moves focus + previews selection but does NOT close (the
      // popover stays open so the user can keep arrowing). Apply via applyTheme +
      // onSelect WITHOUT the close that `select` performs.
      applyTheme(nextId);
      onSelect(nextId);
      if (liveRef.current) {
        liveRef.current.textContent = `${THEME_LABELS[nextId]} theme`;
      }
      radioRefs.current[nextId]?.focus();
    },
    [select, onSelect],
  );

  // Esc anywhere in the selector collapses the popover + restores focus to the
  // trigger (spec §7). Bound on the `.theme-selector` WRAPPER, not just the
  // radiogroup, so Escape works regardless of where focus sits in the
  // disclosure — including the trigger button, which is a SIBLING of the popover
  // (a radiogroup-only handler never sees a trigger-focused Escape, e.g. after a
  // shift-tab back to the trigger while open). The `&& open` guard makes it a
  // no-op when closed, so a closed-state Escape still bubbles normally.
  const onSelectorKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        onOpenChange(false);
        triggerRef.current?.focus();
      }
    },
    [open, onOpenChange],
  );

  // The radiogroup — stacked column of 5 options inside the popover.
  const radiogroup = (
    <div
      id={groupId}
      className="theme-selector-group"
      role="radiogroup"
      aria-label="Map theme"
      data-form="popover"
    >
      {THEME_IDS.map((id) => {
        const checked = id === activeThemeId;
        return (
          <button
            key={id}
            ref={(el) => {
              radioRefs.current[id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tabindex: only the checked radio is in the tab order; arrow
            // keys move focus to the others.
            tabIndex={checked ? 0 : -1}
            className="theme-selector-option"
            data-theme-id={id}
            onClick={() => select(id)}
            onKeyDown={(e) => onRadioKeyDown(e, id)}
          >
            {/* Leading checkmark column — reserved on EVERY row (its glyph is
                visible only when checked) so selected and unselected rows share
                ONE left edge for the label. aria-hidden + zero text content so
                the radio's accessible name stays EXACTLY the theme label:
                the e2e POM and unit tests both look options up by
                `name: label, exact: true` / assert `textContent === label`, so
                a glyph that contributed text would break them. The selected
                state is carried by the full-row tint background + this glyph —
                NOT by a border ring, which is now reserved for :focus-visible. */}
            <svg
              className="theme-selector-option-check"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
            <span className="theme-selector-option-label">{THEME_LABELS[id]}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="theme-selector" onKeyDown={onSelectorKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="theme-selector-trigger"
        onClick={() => onOpenChange(!open)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={groupId}
        aria-label={`Map theme: ${THEME_LABELS[activeThemeId]}`}
      >
        <svg
          className="app-header-btn-icon"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {/* Stacked-layers glyph — signals "map appearance / basemap style"
              (this opens a 5-BASEMAP-STYLE menu), not a binary light/dark
              brightness toggle. The accessible name (`Map theme: <active>`)
              still names the active theme for AT. */}
          <path d="M12 2 2 7l10 5 10-5-10-5Z" />
          <path d="m2 12 10 5 10-5" />
          <path d="m2 17 10 5 10-5" />
        </svg>
      </button>
      {mounted && (
        // Menu-dropdown recipe surface (.t-dropdown). `.is-open` while open (and
        // after the enter frame so the scale/opacity transition plays);
        // `.is-closing` during the exit (the React component unmounts after
        // --dropdown-close-dur). The template-literal ternary form keeps all three
        // state classes statically extractable for the orphan-classname gate.
        <div
          ref={popoverRef}
          className={`theme-selector-popover t-dropdown${entered && open ? ' is-open' : ''}${closing ? ' is-closing' : ''}`}
          data-origin="top-right"
          data-testid="theme-selector-popover"
        >
          {radiogroup}
        </div>
      )}
      {/* Visually-hidden live region — a SIBLING of the controls, not a child of
          any radio (AT ignores live regions nested in interactive elements). */}
      <span
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        style={{
          position: 'absolute',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
          clip: 'rect(0,0,0,0)',
          whiteSpace: 'nowrap',
        }}
      />
    </div>
  );
}
