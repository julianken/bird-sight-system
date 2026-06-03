import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('initially expands the top 2 families and collapses the rest', () => {
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
    // Top 2 expanded: species rows visible.
    expect(screen.getByText(/Black Phoebe/)).toBeInTheDocument();
    expect(screen.getByText(/Anna's Hummingbird/)).toBeInTheDocument();
    // Bottom 2 collapsed: species rows NOT in DOM.
    expect(screen.queryByText(/Sandpiper sp\./)).toBeNull();
    expect(screen.queryByText(/Cooper's Hawk/)).toBeNull();
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
    fireEvent.click(screen.getByRole('link', { name: /Anna's Hummingbird/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sandpiper sp\./ })).toBeNull();
    fireEvent.click(screen.getByText(/Sandpiper sp\./));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('species row with synthetic agg-* speciesCode renders as <span> (no link, no callback) — #715', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('anatidae', 53)]}
        speciesByFamily={speciesByFamily([
          ['anatidae', [species('anatidae', 53, 'agg-3-anatidae-2')]],
        ])}
        totalCount={53}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    expect(screen.getByText(/53x anatidae/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /anatidae/ })).toBeNull();
    fireEvent.click(screen.getByText(/53x anatidae/));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('synthetic-code rows ignore Enter / Space activation (#715)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <ClusterListPopover
        families={[family('anatidae', 53)]}
        speciesByFamily={speciesByFamily([
          ['anatidae', [species('anatidae', 53, 'agg-3-anatidae-2')]],
        ])}
        totalCount={53}
        uniqueFamilies={1}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const row = screen.getByText(/53x anatidae/);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    expect(onSelectSpecies).not.toHaveBeenCalled();
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

  // #859 — low-zoom (aggregated) drill-in. When `cellSpecies` is supplied the
  // popover renders the cell's REAL species as a flat list (loading / error /
  // empty / success), never the synthetic per-family breakdown.
  describe('cellSpecies (low-zoom drill-in #859)', () => {
    const synthFamilies = [family('accipitridae', 5)];
    const synthSpecies = speciesByFamily([
      ['accipitridae', [species('accipitridae', 5, 'agg-0-accipitridae-0')]],
    ]);

    function renderWith(cellSpecies: Parameters<typeof ClusterListPopover>[0]['cellSpecies'], onSelect = vi.fn()) {
      const anchor = makeAnchor();
      render(
        <ClusterListPopover
          families={synthFamilies}
          speciesByFamily={synthSpecies}
          totalCount={5}
          uniqueFamilies={1}
          anchorEl={anchor}
          onDismiss={vi.fn()}
          onSelectSpecies={onSelect}
          cellSpecies={cellSpecies}
        />
      );
      return onSelect;
    }

    it('renders a loading StatusBlock and no synthetic rows', () => {
      renderWith({ loading: true, error: null, species: null });
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(document.body.innerHTML).not.toMatch(/agg-/);
      expect(screen.queryByTestId('cluster-list-popover-row')).not.toBeInTheDocument();
    });

    it('renders an error StatusBlock when the cell fetch failed', () => {
      renderWith({ loading: false, error: new Error('boom'), species: null });
      expect(screen.getByRole('status').className).toMatch(/status-block--state-error/);
    });

    it('renders an empty StatusBlock when the cell has no observations', () => {
      renderWith({ loading: false, error: null, species: [] });
      expect(screen.getByRole('status').className).toMatch(/status-block--state-empty/);
    });

    it('renders real species rows with working onSelectSpecies links — no agg- strings', () => {
      const onSelect = renderWith({
        loading: false,
        error: null,
        species: [
          { speciesCode: 'corhaw', comName: "Cooper's Hawk", count: 3 },
          { speciesCode: null, comName: 'hawk sp.', count: 1 },
        ],
      });
      expect(screen.getByText(/Cooper's Hawk/)).toBeInTheDocument();
      expect(document.body.innerHTML).not.toMatch(/agg-/);
      const link = screen.getByText(/Cooper's Hawk/).closest('[role="link"]')!;
      fireEvent.click(link);
      expect(onSelect).toHaveBeenCalledWith('corhaw');
      expect(screen.getByText(/hawk sp\./).closest('[role="link"]')).toBeNull();
    });
  });
});
