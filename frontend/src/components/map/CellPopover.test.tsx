import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CellPopover } from './CellPopover.js';
import type { SpeciesAggregate } from './adaptive-grid.js';

function species(comName: string, count: number, code: string | null = comName.slice(0, 6).toLowerCase()): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

function makeAnchor(): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('data-testid', 'test-anchor');
  document.body.appendChild(btn);
  btn.focus();
  return btn;
}

/**
 * Anchor whose `getBoundingClientRect()` returns a fixed, known rect — lets the
 * positioning tests assert the popover's computed `top`/`left` deterministically
 * (jsdom otherwise reports all-zero rects for every element). The rect is in
 * viewport coordinates, which is exactly what the `position: fixed` math reads.
 */
function makeAnchorAt(rect: {
  left: number; top: number; right: number; bottom: number; width: number; height: number;
}): HTMLElement {
  const btn = makeAnchor();
  btn.getBoundingClientRect = () =>
    ({
      ...rect,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  return btn;
}

describe('<CellPopover>', () => {
  it('renders role="dialog" on the root element', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('is non-modal — does not set aria-modal (or sets it to false)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    const modal = dialog.getAttribute('aria-modal');
    expect(modal === null || modal === 'false').toBe(true);
  });

  it('sets aria-labelledby pointing at the popover heading element id', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
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

  it('renders the family header with "<FamilyName> (N)" format', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/Hummingbirds \(5\)/)).toBeInTheDocument();
  });

  it('caps rows at top 8 species — ignores any beyond the 8th', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <CellPopover
        familyCode="flycatchers"
        familyCount={150}
        species={many}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const rows = screen.getAllByTestId('cell-popover-row');
    expect(rows).toHaveLength(8);
  });

  it('shows "…and 4 more species" footer when species.length === 12', () => {
    const anchor = makeAnchor();
    const many = Array.from({ length: 12 }, (_, i) => species(`Species ${i + 1}`, 20 - i));
    render(
      <CellPopover
        familyCode="flycatchers"
        familyCount={150}
        species={many}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/…and 4 more species/)).toBeInTheDocument();
  });

  it('shows "Click or tap for full list" footer when species.length ≤ 8 (no overflow)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText('Click or tap for full list')).toBeInTheDocument();
  });

  // #1031 (C54): clickable rows are native <button>s (correct AT
  // announcement + free Enter/Space), not `<a role="link">`.
  it('renders clickable rows as <button> when speciesCode !== null', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const row = screen.getByRole('button', { name: /Anna's Hummingbird/i });
    expect(row.tagName).toBe('BUTTON');
    // No leftover 'link' role from the old hand-rolled implementation.
    expect(screen.queryByRole('link', { name: /Anna's Hummingbird/i })).toBeNull();
  });

  it('renders rows as <span> with NO link/button role when speciesCode === null (spuh/slash)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="sandpipers"
        familyCount={3}
        species={[species('Sandpiper sp.', 3, null)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/Sandpiper sp\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Sandpiper sp\./ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Sandpiper sp\./ })).toBeNull();
  });

  it('calls onSelectSpecies(speciesCode) when a clickable row is clicked', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Anna's Hummingbird/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });

  // #1031 (C54): a native <button> activates on Enter AND Space for free —
  // no hand-rolled onKeyDown. Exercise the real keyboard path via userEvent
  // (fireEvent.keyDown can't drive native button activation).
  it('triggers onSelectSpecies on Enter and Space (native button activation)', async () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    const row = screen.getByRole('button', { name: /Anna's Hummingbird/i });
    row.focus();
    expect(document.activeElement).toBe(row);
    await userEvent.keyboard('{Enter}');
    expect(onSelectSpecies).toHaveBeenLastCalledWith('annhum');
    await userEvent.keyboard(' ');
    expect(onSelectSpecies).toHaveBeenLastCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(2);
  });

  it('does NOT call onSelectSpecies when a null-code row is clicked', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="sandpipers"
        familyCount={3}
        species={[species('Sandpiper sp.', 3, null)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByText(/Sandpiper sp\./));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('renders REAL common-name rows as working links — never a Latin family code or agg-* (#859)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="anatidae"
        familyCount={53}
        species={[species('Mallard', 30, 'mallar3'), species('Wood Duck', 23, 'wooduc')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // Real common names render as clickable buttons wired to the REAL code.
    fireEvent.click(screen.getByRole('button', { name: /Mallard/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('mallar3');
    // No Latin family code leaks into a row, and no synthetic agg-* code.
    expect(screen.queryByText(/anatidae/)).toBeNull();
    expect(screen.queryByText(/agg-/)).toBeNull();
  });

  describe('+N more drill-in (#859)', () => {
    function manyResolved() {
      // 8 resolved (capped) rows, but the family has 20 distinct species.
      return Array.from({ length: 8 }, (_, i) => species(`Species ${i + 1}`, 20 - i, `sp${i}`));
    }

    it('renders "+N more" as an ACTIVE button (driven by overflowCount) calling onDrillIn', () => {
      const anchor = makeAnchor();
      const onDrillIn = vi.fn();
      render(
        <CellPopover
          familyCode="flycatchers"
          familyCount={150}
          species={manyResolved()}
          overflowCount={12}
          anchorEl={anchor}
          onDismiss={vi.fn()}
          onSelectSpecies={vi.fn()}
          onDrillIn={onDrillIn}
        />
      );
      const more = screen.getByRole('button', { name: /\+12 more/i });
      fireEvent.click(more);
      expect(onDrillIn).toHaveBeenCalledTimes(1);
    });

    it('does NOT render the drill-in button when overflowCount is 0', () => {
      const anchor = makeAnchor();
      render(
        <CellPopover
          familyCode="hummingbirds"
          familyCount={5}
          species={[species("Anna's Hummingbird", 5, 'annhum')]}
          overflowCount={0}
          anchorEl={anchor}
          onDismiss={vi.fn()}
          onSelectSpecies={vi.fn()}
          onDrillIn={vi.fn()}
        />
      );
      expect(screen.queryByRole('button', { name: /more/i })).toBeNull();
    });
  });

  it('renders into a portal at document.body (escapes the marker transform stacking context, #859 E)', () => {
    const anchor = makeAnchor();
    const { container } = render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5, 'annhum')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    const dialog = screen.getByRole('dialog');
    // The dialog is a child of <body>, NOT of the React render container (which
    // stands in for the maplibre marker <div> whose transform traps z-index).
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('calls onDismiss + returns focus to anchorEl when Escape is pressed', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={onDismiss}
        onSelectSpecies={vi.fn()}
      />
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(anchor);
  });

  it('calls onDismiss when a click happens outside the popover', () => {
    const anchor = makeAnchor();
    const onDismiss = vi.fn();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
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

  it('moves focus to the popover heading on mount', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(document.activeElement?.getAttribute('data-testid')).toBe('cell-popover-heading');
  });

  // #863: the portaled popover (to document.body, #859) MUST compute its own
  // on-screen position from the anchor's rect. Without it, `position: absolute`
  // collapses to the body origin and the card lands in the bottom-left corner.
  // The fix mirrors <CellHoverPreview>: inline `position: fixed` + computed
  // left/top from `anchorEl.getBoundingClientRect()`, with edge flip/clamp.
  describe('positioning (#863)', () => {
    function renderAt(anchor: HTMLElement) {
      render(
        <CellPopover
          familyCode="hummingbirds"
          familyCount={5}
          species={[species("Anna's Hummingbird", 5, 'annhum')]}
          anchorEl={anchor}
          onDismiss={vi.fn()}
          onSelectSpecies={vi.fn()}
        />
      );
      return screen.getByTestId('cell-popover');
    }

    it('anchors next to the clicked cell via position: fixed + computed left/top (not the static/absolute body origin)', () => {
      // A cell comfortably inside the jsdom viewport (1024×768).
      const anchor = makeAnchorAt({ left: 300, top: 200, right: 322, bottom: 222, width: 22, height: 22 });
      const card = renderAt(anchor);

      // The fix sets an INLINE position: fixed (wins over the CSS position:absolute).
      expect(card.style.position).toBe('fixed');

      // left/top are explicit pixel values derived from the anchor rect — NOT
      // empty (which is what the bug produced) and NOT 0 (the body origin).
      expect(card.style.left).not.toBe('');
      expect(card.style.top).not.toBe('');
      const left = parseFloat(card.style.left);
      const top = parseFloat(card.style.top);

      // Anchored adjacent to the cell: horizontally aligned with the cell's left
      // edge (within the card width) and vertically just below the cell.
      expect(left).toBeGreaterThanOrEqual(300 - 1);
      expect(left).toBeLessThan(300 + 320); // within one card-width of the anchor left
      expect(top).toBeGreaterThanOrEqual(222 - 1); // at or below the cell's bottom edge
      expect(top).toBeLessThan(222 + 40);
    });

    it('flips/clamps so a right-edge anchor never overflows the right of the viewport', () => {
      // Cell hugging the right edge of the 1024-wide jsdom viewport.
      const anchor = makeAnchorAt({ left: 1010, top: 200, right: 1024, bottom: 222, width: 14, height: 22 });
      const card = renderAt(anchor);
      expect(card.style.position).toBe('fixed');
      const left = parseFloat(card.style.left);
      // Min card width is 240px; left must leave room for the card inside 1024.
      expect(left).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(1024 - 240);
    });

    it('flips above so a bottom-edge anchor never overflows the bottom of the viewport', () => {
      // Cell near the bottom of the 768-tall jsdom viewport.
      const anchor = makeAnchorAt({ left: 300, top: 750, right: 322, bottom: 766, width: 22, height: 16 });
      const card = renderAt(anchor);
      expect(card.style.position).toBe('fixed');
      const top = parseFloat(card.style.top);
      // Flipped above the anchor: top must sit at or above the anchor's top edge.
      expect(top).toBeLessThanOrEqual(750);
      expect(top).toBeGreaterThanOrEqual(0);
    });
  });
});
