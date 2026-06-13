import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';
import { formatCount } from '../../lib/format-count.js';

/**
 * `<ClusterListPopover>` — mobile / coarse-pointer sheet-style popover for
 * the full cluster (epic #556 Phase 2, issue #559, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §5.3).
 *
 * Non-modal `role="dialog"`. Collapsible family sections — EVERY family
 * starts COLLAPSED (#859 refinement): a national mega-cluster carries ~56
 * families, and an all-expanded list runs off the bottom of the viewport.
 * Each family renders as a header row `{prettyFamily(code)} ({count})` and
 * expands to its top 8 species + per-family "+N more" drill-in (or the legacy
 * "…and N more species" footer) ONLY when the user clicks/activates its
 * header. Spuh/slash/hybrid taxa with `speciesCode === null` render as static
 * `<span>` (no link); otherwise as a native `<button>` (#1031 C54 — was
 * `<a role="link">`).
 *
 * Dismiss surfaces: "Done" button at bottom, ESC, click-outside. Each
 * returns focus to the supplied `anchorEl` (the outer marker `<button>`).
 *
 * Focus trap: Tab/Shift+Tab cycles within the popover while open. The
 * heading is `tabIndex={-1}` (programmatic focus only); interactive members
 * are the family toggle buttons, species link rows, and the Done button.
 *
 * Phase 2 signature: `onSelectSpecies(speciesCode)`. Phase 3 (#560) will
 * widen to `(speciesCode, bbox)`.
 */
export interface ClusterListPopoverProps {
  /** All families in the cluster, descending count order (from `aggregateClusterFamilies`). */
  families: ReadonlyArray<FamilyAggregate>;
  /**
   * #920: per-family resolved colloquial display name, keyed by familyCode
   * (`resolveFamilyName(familyCode, { commonName })`). The family-toggle header
   * reads it; a missing entry falls back to `prettyFamily(familyCode)`, so a
   * caller that omits the map (or a family absent from it) still renders the
   * capitalized scientific label.
   */
  familyNames?: ReadonlyMap<string, string>;
  /** Species lookup keyed by familyCode. */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
  /**
   * #859: per-family count of distinct species BEYOND the capped `speciesByFamily`
   * rows, keyed by familyCode. Drives the active `+N more` drill-in for that
   * family. Absent / zero ⇒ the static "…and N more species" footer (legacy).
   */
  overflowByFamily?: ReadonlyMap<string, number>;
  /** Total point_count for the cluster header. */
  totalCount: number;
  /** Total unique families for the cluster header. */
  uniqueFamilies: number;
  /** Anchor element for focus return. */
  anchorEl: HTMLElement;
  /** Invoked when user dismisses (ESC, click-outside, Done). */
  onDismiss: () => void;
  /** Invoked when user clicks a species row with non-null speciesCode. */
  onSelectSpecies: (speciesCode: string) => void;
  /**
   * #859: invoked with a family code when the user activates that family's
   * `+N more` drill-in — the caller escalates the camera into the cell so the
   * full species list resolves at higher zoom. Absent ⇒ no active drill-in.
   */
  onDrillIn?: (familyCode: string) => void;
}

const POPOVER_CAP_PER_FAMILY = 8;

export function ClusterListPopover(props: ClusterListPopoverProps) {
  const {
    families,
    familyNames,
    speciesByFamily,
    overflowByFamily,
    totalCount,
    uniqueFamilies,
    anchorEl,
    onDismiss,
    onSelectSpecies,
    onDrillIn,
  } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  // Collapse-state: EVERY family starts collapsed (#859 refinement — a
  // national mega-cluster has ~56 families, so an all-expanded list overflows
  // the viewport). The user expands one family at a time by activating its
  // header. State resets each time the popover opens (no persistence): the
  // empty-Set default applies fresh every time the marker mounts the popover.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  function toggleFamily(familyCode: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(familyCode)) {
        next.delete(familyCode);
      } else {
        next.add(familyCode);
      }
      return next;
    });
  }

  // Focus the heading on mount (programmatic landing). Tab subsequently
  // moves into the first interactive (family toggle button).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // ESC dismiss + focus return.
  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        onDismiss();
        anchorEl.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onDismiss, anchorEl]);

  // Click-outside dismiss.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        onDismiss();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onDismiss]);

  // Focus trap. Tab from the last focusable (Done) wraps to the first
  // (the first family toggle); Shift+Tab from the first wraps to Done.
  function onContainerKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const focusables = rootRef.current?.querySelectorAll<HTMLElement>(
      'button, [role="link"], a[href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables || focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function onDone() {
    onDismiss();
    anchorEl.focus();
  }

  function onSpeciesRowClick(code: string) {
    onSelectSpecies(code);
  }

  const content = (
    <div
      ref={rootRef}
      role="dialog"
      aria-labelledby={headingId}
      className="cluster-list-popover"
      data-testid="cluster-list-popover"
      onKeyDown={onContainerKeyDown}
    >
      <header className="cluster-list-popover__header">
        <h2
          ref={headingRef}
          id={headingId}
          className="cluster-list-popover__heading"
          tabIndex={-1}
          data-testid="cluster-list-popover-heading"
        >
          Cluster: {formatCount(totalCount)} observations, {formatCount(uniqueFamilies)} families
        </h2>
      </header>
      <div>
        {families.map((fam) => {
          const allSpecies = speciesByFamily.get(fam.familyCode) ?? [];
          const visibleSpecies = allSpecies.slice(0, POPOVER_CAP_PER_FAMILY);
          // #859: prefer the caller-supplied EXACT distinct-species overflow
          // (true speciesCount minus the shown rows) over the rendered-row
          // remainder, so the "+N more" reflects reality at low zoom.
          const overflow =
            overflowByFamily?.get(fam.familyCode) ?? allSpecies.length - POPOVER_CAP_PER_FAMILY;
          const drillInActive = overflow > 0 && typeof onDrillIn === 'function';
          const isExpanded = expanded.has(fam.familyCode);
          return (
            <div
              key={fam.familyCode}
              className={
                isExpanded
                  ? 'cluster-list-popover__family cluster-list-popover__family--expanded'
                  : 'cluster-list-popover__family'
              }
              data-testid={`cluster-list-popover-family-${fam.familyCode}`}
            >
              <button
                type="button"
                className="cluster-list-popover__family-toggle"
                aria-expanded={isExpanded ? 'true' : 'false'}
                onClick={() => toggleFamily(fam.familyCode)}
              >
                {/* #950: the caret is a single ▶ CSS ::before glyph that rotates
                    90° (transform) to point down when the `--expanded` modifier
                    is set on the parent `.cluster-list-popover__family`
                    (ds-primitives.css) — a smooth rotate, not a ▶/▼ content swap. */}
                {familyNames?.get(fam.familyCode) ?? prettyFamily(fam.familyCode)} ({formatCount(fam.count)})
              </button>
              {isExpanded && (
                <ul className="cluster-list-popover__rows">
                  {visibleSpecies.map((s) => {
                    // #859: rows carry REAL eBird codes (resolved via the
                    // species dictionary) — every non-null code links to a
                    // working detail. Only spuh/slash/hybrid taxa (null code)
                    // render as static spans.
                    const code = s.speciesCode;
                    if (code !== null) {
                      return (
                        <li
                          key={s.comName}
                          className="cluster-list-popover__row"
                          data-testid="cluster-list-popover-row"
                        >
                          {/* #1031 (C54): native <button> rather than
                              `<a role="link" tabIndex={0}>` with hand-rolled
                              Enter+Space — the row drives an in-page URL-state
                              switch (onSelectSpecies), not a real navigation.
                              A button announces correctly and activates on
                              Enter/Space for free. */}
                          <button
                            type="button"
                            className="cluster-list-popover__row-button"
                            onClick={() => onSpeciesRowClick(code)}
                          >
                            {formatCount(s.count)}x {s.comName}
                          </button>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.comName}
                        className="cluster-list-popover__row"
                        data-testid="cluster-list-popover-row"
                      >
                        <span>{formatCount(s.count)}x {s.comName}</span>
                      </li>
                    );
                  })}
                  {overflow > 0 && (
                    <li className="cluster-list-popover__row">
                      {drillInActive ? (
                        <button
                          type="button"
                          className="cell-popover__more"
                          data-testid={`cluster-list-popover-more-${fam.familyCode}`}
                          onClick={() => onDrillIn?.(fam.familyCode)}
                        >
                          +{overflow} more
                        </button>
                      ) : (
                        <span>…and {overflow} more species</span>
                      )}
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <footer className="cluster-list-popover__footer">
        <button
          ref={doneRef}
          type="button"
          className="cluster-list-popover__done"
          onClick={onDone}
        >
          Done
        </button>
      </footer>
    </div>
  );

  // #859 E: portal to <body> so the maplibre marker <div>'s transform (a
  // stacking context) can't let cluster pills paint over the popover. The
  // structural parent changes; flip/shift/clamp positioning is unaffected.
  if (typeof document !== 'undefined') {
    return createPortal(content, document.body);
  }
  return content;
}
