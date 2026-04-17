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
});
