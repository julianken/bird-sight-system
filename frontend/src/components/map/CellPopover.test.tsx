import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('renders rows with role="link" when speciesCode !== null', () => {
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
    expect(screen.getByRole('link', { name: /Anna's Hummingbird/i })).toBeInTheDocument();
  });

  it('renders rows as <span> with NO link role when speciesCode === null (spuh/slash)', () => {
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
    fireEvent.click(screen.getByRole('link', { name: /Anna's Hummingbird/i }));
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
    expect(onSelectSpecies).toHaveBeenCalledTimes(1);
  });

  it('triggers onSelectSpecies on Enter key when a clickable row is focused', () => {
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
    const row = screen.getByRole('link', { name: /Anna's Hummingbird/i });
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelectSpecies).toHaveBeenCalledWith('annhum');
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

  it('renders rows as <span> with NO link role when speciesCode is synthetic (#715 — agg-*)', () => {
    const anchor = makeAnchor();
    render(
      <CellPopover
        familyCode="anatidae"
        familyCount={53}
        species={[species('anatidae', 53, 'agg-3-anatidae-2')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={vi.fn()}
      />
    );
    expect(screen.getByText(/53x anatidae/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /anatidae/ })).toBeNull();
  });

  it('does NOT call onSelectSpecies when a synthetic-code row is clicked (#715)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="anatidae"
        familyCount={53}
        species={[species('anatidae', 53, 'agg-3-anatidae-2')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    fireEvent.click(screen.getByText(/53x anatidae/));
    expect(onSelectSpecies).not.toHaveBeenCalled();
  });

  it('does NOT call onSelectSpecies on Enter for a synthetic-code row (#715)', () => {
    const anchor = makeAnchor();
    const onSelectSpecies = vi.fn();
    render(
      <CellPopover
        familyCode="anatidae"
        familyCount={53}
        species={[species('anatidae', 53, 'agg-3-anatidae-2')]}
        anchorEl={anchor}
        onDismiss={vi.fn()}
        onSelectSpecies={onSelectSpecies}
      />
    );
    // Synthetic rows render as <span> not <a>; there is nothing keyboard-
    // focusable to receive Enter, and an Enter on the static span is a no-op.
    const row = screen.getByText(/53x anatidae/);
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelectSpecies).not.toHaveBeenCalled();
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
});
