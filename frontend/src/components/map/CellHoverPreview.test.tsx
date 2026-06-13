import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CellHoverPreview } from './CellHoverPreview.js';
import type { SpeciesAggregate } from './adaptive-grid.js';

function species(comName: string, count: number, code: string | null = comName.slice(0, 6).toLowerCase()): SpeciesAggregate {
  return { comName, count, speciesCode: code };
}

describe('<CellHoverPreview>', () => {
  it('renders role="tooltip" on the root element', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="cell-1-hummingbirds-preview"
      />
    );
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('propagates the id prop onto the tooltip element', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="cell-1-hummingbirds-preview"
      />
    );
    expect(screen.getByRole('tooltip').id).toBe('cell-1-hummingbirds-preview');
  });

  it('renders the family header text in the format "<FamilyName> (N)"', () => {
    // The component resolves familyCode → display name via prettyFamily().
    // "hummingbirds" → "Hummingbirds" per the existing pretty-name table.
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={8}
        species={[species("Anna's Hummingbird", 8)]}
        id="x"
      />
    );
    expect(screen.getByText(/Hummingbirds \(8\)/)).toBeInTheDocument();
  });

  it('caps rows at top 3 species — ignores any beyond the 3rd', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={20}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
          species('Western Wood-Pewee', 1),
          species('Cassin\'s Kingbird', 1),
        ]}
        id="x"
      />
    );
    expect(screen.getByText('Black Phoebe', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Vermilion Flycatcher', { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Say's Phoebe", { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Western Wood-Pewee', { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText("Cassin's Kingbird", { exact: false })).not.toBeInTheDocument();
  });

  it('renders species in descending count order (consumer-supplied order preserved)', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={18}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
        ]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]).toHaveTextContent('Black Phoebe');
    expect(rows[1]).toHaveTextContent('Vermilion Flycatcher');
    expect(rows[2]).toHaveTextContent("Say's Phoebe");
  });

  it('shows the "Click for more" footer when species.length > 3', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={20}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
          species('Western Wood-Pewee', 1),
        ]}
        id="x"
      />
    );
    expect(screen.getByText('Click for more')).toBeInTheDocument();
  });

  it('does NOT show the footer when species.length === 3', () => {
    render(
      <CellHoverPreview
        familyCode="flycatchers"
        familyCount={18}
        species={[
          species('Black Phoebe', 10),
          species('Vermilion Flycatcher', 5),
          species("Say's Phoebe", 3),
        ]}
        id="x"
      />
    );
    expect(screen.queryByText('Click for more')).not.toBeInTheDocument();
  });

  it('does NOT show the footer when species.length === 1', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    expect(screen.queryByText('Click for more')).not.toBeInTheDocument();
  });

  it('renders the count-x-comName template "Nx <comName>" for each row', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={8}
        species={[species("Anna's Hummingbird", 5), species("Costa's Hummingbird", 3)]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]).toHaveTextContent("5x Anna's Hummingbird");
    expect(rows[1]).toHaveTextContent("3x Costa's Hummingbird");
  });

  it('renders no rows when species array is empty (defensive)', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={0}
        species={[]}
        id="x"
      />
    );
    expect(screen.queryAllByTestId('cell-hover-preview-row')).toHaveLength(0);
  });

  it('uses the .cell-hover-preview className on the root for stylesheet wiring', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    expect(screen.getByRole('tooltip').className).toContain('cell-hover-preview');
  });

  it('emits .cell-hover-preview__row className on each row for stylesheet wiring', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
      />
    );
    const rows = screen.getAllByTestId('cell-hover-preview-row');
    expect(rows[0]?.className).toContain('cell-hover-preview__row');
  });

  it('with cursorPos, root element has position:fixed and correct left/top offset (+16/+12)', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
        cursorPos={{ x: 100, y: 200 }}
      />
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.position).toBe('fixed');
    expect(tooltip.style.left).toBe('116px');
    expect(tooltip.style.top).toBe('212px');
    // #761 O6 (#782): the cursor-following path no longer carries an inline
    // zIndex — stacking comes from the `.cell-hover-preview` class's --z-modal
    // token. (`screen.getByRole` queries document.body by default, which reaches
    // the portaled node for the cursor branch — do NOT scope to a local
    // container or this lookup fails.)
    expect(tooltip.style.zIndex).toBe('');
  });

  it('with cursorPos=null, root element has no inline position (falls back to CSS)', () => {
    render(
      <CellHoverPreview
        familyCode="hummingbirds"
        familyCount={5}
        species={[species("Anna's Hummingbird", 5)]}
        id="x"
        cursorPos={null}
      />
    );
    const tooltip = screen.getByRole('tooltip');
    expect(tooltip.style.position).toBe('');
    // #761 O6 (#782): the keyboard-focus path never had an inline zIndex; lock
    // that both render paths now defer stacking entirely to the class token.
    expect(tooltip.style.zIndex).toBe('');
  });

  // C1 #1045 (Reviewer addendum): CellHoverPreview is the addendum sink at
  // AdaptiveGridMarker.tsx:420 — same layout as CellPopover but mounted as a
  // tooltip. Both familyCount and s.count must use formatCount.
  describe('C1 #1045: thousands separators (Reviewer addendum)', () => {
    it('renders familyCount ≥1000 with separator in header', () => {
      render(
        <CellHoverPreview
          familyCode="hummingbirds"
          familyCount={1500}
          species={[species("Anna's Hummingbird", 500)]}
          id="x"
        />
      );
      // Header must read "Hummingbirds (1,500)" not "Hummingbirds (1500)".
      expect(screen.getByText(/Hummingbirds \(1,500\)/)).toBeInTheDocument();
    });

    it('renders species count ≥1000 with separator in row text', () => {
      render(
        <CellHoverPreview
          familyCode="hummingbirds"
          familyCount={1234}
          species={[species("Anna's Hummingbird", 1234)]}
          id="x"
        />
      );
      const rows = screen.getAllByTestId('cell-hover-preview-row');
      // Row must read "1,234x Anna's Hummingbird".
      expect(rows[0]).toHaveTextContent('1,234x');
    });
  });
});
