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
