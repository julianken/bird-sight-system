import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClusterListPopover } from './ClusterListPopover.js';
import type { FamilyAggregate, SpeciesAggregate } from './adaptive-grid.js';

function species(
  comName: string,
  count: number,
  code: string | null = comName.slice(0, 6).toLowerCase(),
): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

function family(familyCode: string, count: number): FamilyAggregate {
  // FamilyAggregate shape per adaptive-grid.ts. Phase 0 exported it.
  return { familyCode, count };
}

function makeAnchor(): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-testid', 'test-anchor');
  document.body.appendChild(btn);
  btn.focus();
  return btn;
}

function speciesByFamily(
  entries: Array<[string, ReadonlyArray<SpeciesAggregate>]>,
): ReadonlyMap<string, ReadonlyArray<SpeciesAggregate>> {
  return new Map(entries);
}

describe('<ClusterListPopover>', () => {
  it('renders role="dialog" on the root element', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('sets aria-labelledby pointing at the popover heading element id', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)).toBeTruthy();
  });

  it('renders the cluster header with total count and unique families', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5), family('flycatchers', 12)]}
        speciesByFamily={speciesByFamily([
          ['hummingbirds', [species("Anna's Hummingbird", 5)]],
          ['flycatchers', [species('Black Phoebe', 12)]],
        ])}
        totalCount={17}
        uniqueFamilies={2}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Heading copy: "Cluster: 17 observations, 2 families".
    expect(screen.getByText(/17 observations/)).toBeInTheDocument();
    expect(screen.getByText(/2 families/)).toBeInTheDocument();
  });

  it('cluster header uses thousands separators for totalCount ≥1000 (C1 #1045)', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5000), family('flycatchers', 7500)]}
        speciesByFamily={speciesByFamily([
          ['hummingbirds', [species("Anna's Hummingbird", 5000)]],
          ['flycatchers', [species('Black Phoebe', 7500)]],
        ])}
        totalCount={12500}
        uniqueFamilies={2}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // totalCount 12500 → "12,500 observations"
    expect(screen.getByText(/12,500 observations/)).toBeInTheDocument();
  });

  it('starts with EVERY family collapsed — no species rows visible until a header is activated (#859)', () => {
    const anchor = makeAnchor();
    const fams = [
      family('flycatchers', 30),
      family('hummingbirds', 20),
      family('sandpipers', 10),
      family('hawks', 5),
    ];
    render(
      <ClusterListPopover
        families={fams}
        speciesByFamily={speciesByFamily([
          ['flycatchers', [species('Black Phoebe', 30)]],
          ['hummingbirds', [species("Anna's Hummingbird", 20)]],
          ['sandpipers', [species('Sandpiper sp.', 10, null)]],
          ['hawks', [species("Cooper's Hawk", 5)]],
        ])}
        totalCount={65}
        uniqueFamilies={4}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // ALL families collapsed by default: zero species rows in the DOM.
    expect(screen.queryByText(/Black Phoebe/)).toBeNull();
    expect(screen.queryByText(/Anna's Hummingbird/)).toBeNull();
    expect(screen.queryByText(/Sandpiper sp\./)).toBeNull();
    expect(screen.queryByText(/Cooper's Hawk/)).toBeNull();
    // Every family still renders its header toggle with aria-expanded=false.
    for (const name of [/Flycatchers/i, /Hummingbirds/i, /Sandpipers/i, /Hawks/i]) {
      const toggle = screen.getByRole('button', { name });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('caps species at top 8 per family and renders "…and N more species" footer when > 8', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <ClusterListPopover
        families={[family('flycatchers', 150)]}
        speciesByFamily={speciesByFamily([['flycatchers', many]])}
        totalCount={150}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // #859: families start collapsed — expand this one before asserting rows.
    fireEvent.click(screen.getByRole('button', { name: /Flycatchers/i }));
    // Eight rows visible; ninth onward suppressed.
    expect(screen.queryByText(/Species 1\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Species 8\b/)).toBeInTheDocument();
    expect(screen.queryByText(/Species 9\b/)).toBeNull();
    expect(screen.queryByText(/Species 12\b/)).toBeNull();
    expect(screen.getByText(/…and 4 more species/)).toBeInTheDocument();
  });

  it('does NOT render the "and N more species" footer when family has ≤ 8 species', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // #859: expand the family first — the footer only renders when expanded.
    fireEvent.click(screen.getByRole('button', { name: /Hummingbirds/i }));
    expect(screen.queryByText(/more species/)).toBeNull();
  });

  it('clicking a collapsed family toggle expands its species rows', () => {
    const anchor = makeAnchor();
    const fams = [
      family('flycatchers', 30),
      family('hummingbirds', 20),
      family('sandpipers', 10),
    ];
    render(
      <ClusterListPopover
        families={fams}
        speciesByFamily={speciesByFamily([
          ['flycatchers', [species('Black Phoebe', 30)]],
          ['hummingbirds', [species("Anna's Hummingbird", 20)]],
          ['sandpipers', [species('Sandpiper sp.', 10, null)]],
        ])}
        totalCount={60}
        uniqueFamilies={3}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // sandpipers initially collapsed (3rd family).
    expect(screen.queryByText(/Sandpiper sp\./)).toBeNull();
    // Find its toggle button — bound to family display name.
    const toggle = screen.getByRole('button', { name: /Sandpipers/i });
    fireEvent.click(toggle);
    // Now expanded.
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
  });

  it('clicking the "Done" button calls onDismiss and returns focus to anchorEl', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('pressing Escape calls onDismiss and returns focus to anchorEl', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('clicking outside the popover calls onDismiss', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5)]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clicking a species row with non-null speciesCode calls onSelectSpecies(code) with single arg', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // #859: expand the family before clicking its (now-revealed) species row.
    fireEvent.click(screen.getByRole('button', { name: /Hummingbirds/i }));
    // #1031 (C54): the species row is a native <button> (not `<a role="link">`).
    const row = screen.getByRole('button', { name: /Anna's Hummingbird/i });
    expect(row.tagName).toBe('BUTTON');
    expect(screen.queryByRole('link', { name: /Anna's Hummingbird/i })).toBeNull();
    fireEvent.click(row);
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });

  // #1031 (C54): a native <button> row activates on Enter AND Space for free.
  it('species row activates on Enter and Space (native button activation)', async () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Hummingbirds/i }));
    const row = screen.getByRole('button', { name: /Anna's Hummingbird/i });
    row.focus();
    expect(document.activeElement).toBe(row);
    await userEvent.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenLastCalledWith('annhum');
    await userEvent.keyboard(' ');
    expect(onSelectSpecies).toHaveBeenLastCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(2);
  });

  it('species row with null speciesCode renders as <span> (no link role; no callback on click)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('sandpipers', 3)]}
        speciesByFamily={speciesByFamily([['sandpipers', [species('Sandpiper sp.', 3, null)]]])}
        totalCount={3}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // #859: expand the family before asserting on its species row.
    fireEvent.click(screen.getByRole('button', { name: /Sandpipers/i }));
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sandpiper sp\./ })).toBeNull();
    // #1031 (C54): null-code taxa stay static <span>s — no button either.
    expect(screen.queryByRole('button', { name: /Sandpiper sp\./ })).toBeNull();
    fireEvent.click(screen.getByText(/Sandpiper sp\./));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('renders REAL common names as working buttons — never a Latin family code or agg-* (#859)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('anatidae', 53)]}
        speciesByFamily={speciesByFamily([
          ['anatidae', [species('Mallard', 30, 'mallar3'), species('Wood Duck', 23, 'wooduc')]],
        ])}
        totalCount={53}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // #859: expand the family before its REAL-named species buttons resolve.
    fireEvent.click(screen.getByRole('button', { name: /Anatidae/i }));
    fireEvent.click(screen.getByRole('button', { name: /Mallard/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('mallar3');
    // No Latin family code and no synthetic agg-* code leaks into any row.
    expect(screen.queryByText(/anatidae/)).toBeNull();
    expect(screen.queryByText(/agg-/)).toBeNull();
  });

  it('renders a per-family "+N more" drill-in button (overflowByFamily) calling onDrillIn(code) — #859', () => {
    const anchor = makeAnchor();
    const onDrillIn = vi.fn();
    const eight = Array.from({ length: 8 }, (_, i) => species(`Species ${i + 1}`, 20 - i, `sp${i}`));
    render(
      <ClusterListPopover
        families={[family('flycatchers', 150)]}
        speciesByFamily={speciesByFamily([['flycatchers', eight]])}
        overflowByFamily={new Map([['flycatchers', 12]])}
        totalCount={150}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
        onDrillIn={onDrillIn}
      />
    );
    // #859: expand the family first — the "+N more" control lives in the
    // expanded body, not the collapsed header.
    fireEvent.click(screen.getByRole('button', { name: /Flycatchers/i }));
    const more = screen.getByRole('button', { name: /\+12 more/i });
    fireEvent.click(more);
    expect(onDrillIn).toHaveBeenCalledWith('flycatchers');
  });

  it('portals to document.body (escapes the marker transform stacking context, #859 E)', () => {
    const anchor = makeAnchor();
    const { container } = render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('focus trap: Tab from last focusable inside popover wraps to first', () => {
    const anchor = makeAnchor();
    render(
      <ClusterListPopover
        families={[family('hummingbirds', 5)]}
        speciesByFamily={speciesByFamily([['hummingbirds', [species("Anna's Hummingbird", 5, 'annhum')]]])}
        totalCount={5}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    // Identify focusable order: heading (tabIndex=-1, programmatic only), family
    // toggle button(s), species link(s), Done button. The trap cycles Tab from
    // Done → first interactive (family toggle); Shift+Tab from first interactive → Done.
    const done = screen.getByRole('button', { name: /Done/i });
    done.focus();
    expect(document.activeElement).toBe(done);
    // Tab forward; container's keydown handler intercepts and wraps focus.
    fireEvent.keyDown(done, { key: 'Tab' });
    // First interactive after wrap: the family toggle button (identified by name).
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Hummingbirds/i }));
    // Reverse: Shift+Tab from family toggle wraps to Done.
    const firstFocusable = document.activeElement as HTMLElement;
    fireEvent.keyDown(firstFocusable, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });
});

// E1 (#1053, absorbs #565) — WCAG 2.5.5 species-row tap target. jsdom has no
// layout engine (every getBoundingClientRect is 0×0 — the exact reason the
// `display:flex; min-height:44px` on the inner <a> was reverted in b1b018e), so
// the 44px floor is verified by reading the committed CSS rule rather than a
// measured bbox. The live measured assertion runs in the `coarse-pointer`
// Playwright project (map-cell-popover.spec.ts). The bot's block recipe
// (`display: block; min-height: 44px; padding: 12px 8px;` on the <li> — block is
// the <li> default, sidestepping the flex-on-<a> bbox bug) is the contract here.
describe('E1/#565 — species-row 44px tap target (CSS contract)', () => {
  const css = readFileSync(
    join(import.meta.dirname, '../ds/ds-primitives.css'),
    'utf8',
  );

  function ruleBody(selector: string): string {
    // Grab the declaration block for an exact selector (escape the regex-special
    // chars in the class selector). Non-greedy up to the first closing brace.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`selector not found in ds-primitives.css: ${selector}`);
    return m[1]!;
  }

  it('.cluster-list-popover__row carries display:block + min-height:44px (bot recipe)', () => {
    const body = ruleBody('.cluster-list-popover__row');
    expect(body).toMatch(/display:\s*block/);
    expect(body).toMatch(/min-height:\s*44px/);
  });

  it('.cell-popover__row enforces a ≥44px effective coarse-pointer tap target', () => {
    // The cell popover's species rows get the same floor under coarse pointer.
    // Implementation may scope it via a coarse-pointer media query; assert the
    // 44px min-height appears in a rule targeting `.cell-popover__row`.
    const m = css.match(/\.cell-popover__row[^{]*\{[^}]*min-height:\s*44px/);
    expect(m, 'expected a .cell-popover__row rule with min-height:44px').not.toBeNull();
  });
});
