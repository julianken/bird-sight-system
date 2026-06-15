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
 * TRANSIENT-LAYER surface (segmented strip at `wide`, popover at `roomy`/
 * `compact`) — NOT a new band.
 *
 * Responsive form (the three `useBreakpoint()` bands — matches the AppHeader
 * `filtersLabeled = bp === 'wide'` precedent):
 *   - `wide` (≥1024): an INLINE segmented control of 5 pills inside the pill.
 *   - `roomy` AND `compact` (`bp !== 'wide'`): a single "Theme" trigger button
 *     that opens a TRANSIENT popover listing the 5 options, anchored under the
 *     trigger — guarantees the pill never overflows at 768/1024 viewports and
 *     can't collide with the 360px identity card.
 *
 * ARIA — ONE role model in BOTH forms (the issue's load-bearing rule): a single
 * `role="radiogroup"` (`aria-label="Map theme"`) with `role="radio"` +
 * `aria-checked` children. Roving tabindex (only the active radio is tabbable);
 * Left/Right AND Up/Down arrows move + select (selection-follows-focus); Home/End
 * jump to first/last. The narrow popover wraps that SAME radiogroup in a
 * disclosure (`aria-haspopup`, `aria-expanded`/`aria-controls` on the trigger,
 * Esc closes + returns focus to the trigger — the scope-disclosure precedent in
 * AppHeader.tsx). A visually-hidden `aria-live` region announces the new theme.
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
import type { Breakpoint } from '../hooks/use-breakpoint.js';

/** The 5 ids in registry render order (Positron · Bright · Liberty · Dark · Fiord). */
const THEME_IDS = Object.keys(THEME_REGISTRY) as ThemeId[];

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
  /** Current breakpoint — `wide` ⇒ inline segmented; else ⇒ trigger + popover. */
  bp: Breakpoint;
}

export function ThemeSelector({ activeThemeId, onSelect, bp }: ThemeSelectorProps) {
  const isWide = bp === 'wide';

  // Disclosure state (narrow form only). Mirrors the scope-disclosure pattern in
  // AppHeader: aria-expanded + aria-controls on the trigger, Esc closes + returns
  // focus to the trigger, focus moves into the group on open.
  const [open, setOpen] = useState(false);
  const groupId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLSpanElement | null>(null);
  // Refs to each radio so roving-tabindex focus + arrow nav can move focus
  // imperatively (selection-follows-focus). Keyed by id.
  const radioRefs = useRef<Partial<Record<ThemeId, HTMLButtonElement | null>>>({});

  /** Apply a theme: write [data-theme] + persist (applyTheme), then drive the
   *  id-keyed swap (onSelect), then announce it to AT via the live region. */
  const select = useCallback(
    (id: ThemeId) => {
      applyTheme(id);
      onSelect(id);
      if (liveRef.current) {
        liveRef.current.textContent = `${THEME_LABELS[id]} theme`;
      }
    },
    [onSelect],
  );

  // When the narrow popover opens, move focus to the active radio (spec §7 — the
  // disclosure focuses its first/active control on open). Runs only on the open
  // edge so re-renders while open don't steal focus.
  useEffect(() => {
    if (open && !isWide) {
      radioRefs.current[activeThemeId]?.focus();
    }
    // activeThemeId intentionally omitted — focus only on the open edge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isWide]);

  // If we cross from narrow → wide while the popover is open, collapse it (the
  // segmented form has no disclosure; a stuck-open state would be invisible).
  useEffect(() => {
    if (isWide) setOpen(false);
  }, [isWide]);

  /** Roving-tabindex keyboard nav within the radiogroup. Left/Up → prev,
   *  Right/Down → next (wrapping), Home → first, End → last; selection follows
   *  focus. Space/Enter re-select the focused radio (idempotent). */
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
      select(nextId);
      radioRefs.current[nextId]?.focus();
    },
    [select],
  );

  // Esc on the popover collapses + restores focus to the trigger (spec §7). NO
  // click-outside auto-close needed for a 5-item picker, but Esc is mandatory.
  const onGroupKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    },
    [open],
  );

  // The radiogroup itself — IDENTICAL markup in both forms (the issue's
  // single-role-model rule). `data-form` lets CSS lay it out inline (wide) vs
  // stacked (popover) without changing the a11y tree.
  const radiogroup = (
    <div
      ref={groupRef}
      id={groupId}
      className="theme-selector-group"
      role="radiogroup"
      aria-label="Map theme"
      data-form={isWide ? 'segmented' : 'popover'}
      onKeyDown={onGroupKeyDown}
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
            {THEME_LABELS[id]}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="theme-selector">
      {isWide ? (
        // Wide: the segmented radiogroup sits inline in the controls pill.
        radiogroup
      ) : (
        // Narrow: a single trigger opens the SAME radiogroup as a transient
        // popover anchored under it (disclosure pattern).
        <>
          <button
            ref={triggerRef}
            type="button"
            className="theme-selector-trigger"
            onClick={() => setOpen((o) => !o)}
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
              {/* Palette/swatch glyph — half-filled circle reads as "theme". */}
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
            </svg>
          </button>
          {open && (
            <div className="theme-selector-popover" data-testid="theme-selector-popover">
              {radiogroup}
            </div>
          )}
        </>
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
