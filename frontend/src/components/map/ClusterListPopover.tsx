import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';
import { prettyFamily } from '../../derived.js';
import { isSyntheticCode } from '../../data/use-bird-data.js';

/**
 * `<ClusterListPopover>` — mobile / coarse-pointer sheet-style popover for
 * the full cluster (epic #556 Phase 2, issue #559, spec
 * `docs/specs/2026-05-15-cell-species-popover-design.md` §4.4, §5.3).
 *
 * Non-modal `role="dialog"`. Collapsible family sections — initially the top
 * 2 families (highest count) are expanded; the rest are collapsed. Each
 * expanded family shows the top 8 species + "…and N more species" footer
 * when that family has more. Spuh/slash/hybrid taxa with `speciesCode ===
 * null` render as static `<span>` (no link); otherwise as `<a role="link">`.
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
  /** Species lookup keyed by familyCode. */
  speciesByFamily: ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>>;
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
}

const POPOVER_CAP_PER_FAMILY = 8;
const INITIAL_EXPANDED_FAMILIES = 2;

export function ClusterListPopover(props: ClusterListPopoverProps) {
  const {
    families,
    speciesByFamily,
    totalCount,
    uniqueFamilies,
    anchorEl,
    onDismiss,
    onSelectSpecies,
  } = props;
  const headingId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  // Collapse-state: top 2 families expanded, rest collapsed. Per the spec's
  // §10 plan-body open question: state resets each time the popover opens
  // (no persistence). Component-local useState achieves this — when the
  // marker unmounts/re-mounts the popover, fresh defaults apply.
  const initialExpanded = useMemo<ReadonlySet<string>>(() => {
    const top = families.slice(0, INITIAL_EXPANDED_FAMILIES).map((f) => f.familyCode);
    return new Set(top);
  }, [families]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(initialExpanded));

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

  return (
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
          Cluster: {totalCount} observations, {uniqueFamilies} families
        </h2>
      </header>
      <div>
        {families.map((fam) => {
          const allSpecies = speciesByFamily.get(fam.familyCode) ?? [];
          const visibleSpecies = allSpecies.slice(0, POPOVER_CAP_PER_FAMILY);
          const overflow = allSpecies.length - POPOVER_CAP_PER_FAMILY;
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
                {prettyFamily(fam.familyCode)} ({fam.count})
              </button>
              {isExpanded && (
                <ul className="cluster-list-popover__rows">
                  {visibleSpecies.map((s) => {
                    // #715: synthetic `agg-*` codes (aggregated z<6 buckets)
                    // are non-resolvable by /api/species/:code and must render
                    // as static spans — second of two entry points to the
                    // same broken chain that CellPopover guards.
                    const clickable = s.speciesCode !== null && !isSyntheticCode(s.speciesCode);
                    const code = s.speciesCode;
                    if (clickable && code !== null) {
                      return (
                        <li
                          key={s.comName}
                          className="cluster-list-popover__row"
                          data-testid="cluster-list-popover-row"
                        >
                          <a
                            role="link"
                            tabIndex={0}
                            onClick={(e) => {
                              e.preventDefault();
                              onSpeciesRowClick(code);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onSpeciesRowClick(code);
                              }
                            }}
                          >
                            {s.count}x {s.comName}
                          </a>
                        </li>
                      );
                    }
                    return (
                      <li
                        key={s.comName}
                        className="cluster-list-popover__row"
                        data-testid="cluster-list-popover-row"
                      >
                        <span>{s.count}x {s.comName}</span>
                      </li>
                    );
                  })}
                  {overflow > 0 && (
                    <li className="cluster-list-popover__row">
                      <span>…and {overflow} more species</span>
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
}
