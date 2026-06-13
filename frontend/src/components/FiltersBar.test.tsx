import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FiltersBar } from './FiltersBar.js';

describe('FiltersBar', () => {
  it('shows current values', () => {
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={() => {}}
      />
    );
    const sinceSelect = screen.getByLabelText('Time window') as HTMLSelectElement;
    expect(sinceSelect.value).toBe('14d');
  });

  it('calls onChange when time window changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={onChange}
      />
    );
    await user.selectOptions(screen.getByLabelText('Time window'), '7d');
    expect(onChange).toHaveBeenCalledWith({ since: '7d' });
  });

  it('calls onChange when notable toggle changes', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole('checkbox', { name: /Notable/ }));
    expect(onChange).toHaveBeenCalledWith({ notable: true });
  });

  it('species draft survives a speciesIndex identity change', async () => {
    const user = userEvent.setup();
    const idx1 = [{ code: 'amerob', comName: 'American Robin' }];
    // Identical content but new array identity — simulates re-derive from
    // fresh observation data.
    const idx2 = [{ code: 'amerob', comName: 'American Robin' }];
    const { rerender } = render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx1}
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, 'Amer');
    expect(input.value).toBe('Amer');

    // Re-render with a new speciesIndex array reference but same speciesCode=null
    rerender(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx2}
        onChange={() => {}}
      />
    );
    // Draft should NOT be clobbered
    expect(input.value).toBe('Amer');
  });

  // D2 (#1050) C78: committing unmatched text must NOT silently no-op. It
  // renders a role="status" hint, KEEPS the typed value, and does not change
  // speciesCode (no onChange to a different code; a null commit only fires if
  // a code was previously set — see the "clears" case below).
  it('no-match commit renders a status hint, keeps the value, and does not change speciesCode', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const idx = [{ code: 'amerob', comName: 'American Robin' }];
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.type(input, 'Zzzzz not a bird');
    await user.keyboard('{Enter}');

    // Value KEPT (never a silent clear of the field).
    expect(input.value).toBe('Zzzzz not a bird');
    // Visible inline status hint, scoped to the (national) dictionary index —
    // NOT "in the current view".
    const hint = screen.getByRole('status');
    expect(hint).toHaveTextContent('No species matching "Zzzzz not a bird"');
    // speciesCode was already null; a no-match must not push a (redundant) null
    // commit that would round-trip the URL. onChange is not called for species.
    expect(onChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ speciesCode: expect.anything() })
    );
  });

  // D2 (#1050) C78: a dictionary-backed index (aggregated/low-zoom mode) still
  // resolves a valid common name → an exact-match commit fires onChange.
  it('commits a valid common name from a dictionary-backed index (aggregated mode)', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    // Dictionary-derived index — present even though observations are empty.
    const idx = [{ code: 'vermfly', comName: 'Vermilion Flycatcher' }];
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.type(input, 'Vermilion Flycatcher');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalledWith({ speciesCode: 'vermfly' });
    // No false no-match hint on a clean match.
    expect(screen.queryByRole('status')).toBeNull();
  });

  // D2 (#1050): while the dictionary is still loading, a commit must NOT render
  // a no-match hint — a no-match verdict during that window is a false hint (a
  // new silent-failure class the contract explicitly guards against).
  it('renders NO no-match hint while the dictionary is loading', async () => {
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        speciesIndexLoading
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.type(input, 'Vermilion Flycatcher');
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Value kept — still never silent in the destructive sense.
    expect(input.value).toBe('Vermilion Flycatcher');
  });

  // D2 (#1050): on dictionary error, a commit renders ZipInput's fetchError-style
  // outcome (role="alert").
  it('renders a role=alert outcome when the dictionary failed to load', async () => {
    const user = userEvent.setup();
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={[]}
        speciesIndexError
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.type(input, 'Vermilion Flycatcher');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });

  // D2 (#1050): typing again after a no-match hint clears the stale hint (no
  // lingering false feedback while the user edits toward a match).
  it('clears the no-match hint when the user edits the field again', async () => {
    const user = userEvent.setup();
    const idx = [{ code: 'amerob', comName: 'American Robin' }];
    render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx}
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    await user.type(input, 'Zzz');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.type(input, 'a');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('clears species draft when speciesCode goes null (popstate)', () => {
    const idx = [{ code: 'amerob', comName: 'American Robin' }];
    const { rerender } = render(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode="amerob"
        familyCode={null}
        families={[]}
        speciesIndex={idx}
        onChange={() => {}}
      />
    );
    const input = screen.getByLabelText('Species') as HTMLInputElement;
    expect(input.value).toBe('American Robin');

    // Simulate popstate clearing the speciesCode
    rerender(
      <FiltersBar
        since="14d"
        notable={false}
        speciesCode={null}
        familyCode={null}
        families={[]}
        speciesIndex={idx}
        onChange={() => {}}
      />
    );
    expect(input.value).toBe('');
  });
});
