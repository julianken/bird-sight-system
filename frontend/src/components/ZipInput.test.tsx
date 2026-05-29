import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ZIP_FLYTO_ZOOM } from '../state/scope-types.js';

const { mockLoadZipIndex, mockLookupZip } = vi.hoisted(() => ({
  mockLoadZipIndex: vi.fn(),
  mockLookupZip: vi.fn(),
}));

vi.mock('../data/zip-lookup.js', () => ({
  loadZipIndex: mockLoadZipIndex,
  lookupZip: mockLookupZip,
}));

// Imported AFTER the mock is registered.
import { ZipInput } from './ZipInput.js';

describe('<ZipInput>', () => {
  beforeEach(() => {
    mockLoadZipIndex.mockReset().mockResolvedValue(undefined);
    mockLookupZip.mockReset();
  });

  it('renders a native numeric text input labelled "ZIP code"', () => {
    render(<ZipInput onResolve={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('inputMode', 'numeric');
    expect(input).toHaveAttribute('maxLength', '5');
  });

  it('does NOT call loadZipIndex on mount — only on focus (lazy trigger)', async () => {
    render(<ZipInput onResolve={vi.fn()} />);
    expect(mockLoadZipIndex).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('textbox', { name: /ZIP code/i }));
    expect(mockLoadZipIndex).toHaveBeenCalledTimes(1);
  });

  it('resolved ZIP → calls onResolve with the ScopeResolution (stateCode + center + zoom=10)', async () => {
    mockLookupZip.mockResolvedValue({
      zip: '85701',
      center: [-110.971, 32.21696],
      stateCode: 'US-AZ',
    });
    const onResolve = vi.fn();
    render(<ZipInput onResolve={onResolve} />);

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '85701{Enter}');

    expect(mockLookupZip).toHaveBeenCalledWith('85701');
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      stateCode: 'US-AZ',
      center: [-110.971, 32.21696],
      zoom: ZIP_FLYTO_ZOOM,
    });
  });

  it('well-formed but unknown ZIP → visible role=status "not recognized", value kept, onResolve NOT called (never silent)', async () => {
    mockLookupZip.mockResolvedValue(null);
    const onResolve = vi.fn();
    render(<ZipInput onResolve={onResolve} />);

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '99999{Enter}');

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/not recognized/i);
    expect(onResolve).not.toHaveBeenCalled();
    // Value is kept — never a silent no-op clearing the field.
    expect(input).toHaveValue('99999');
  });

  it('malformed input → inline message, no lookup attempted', async () => {
    const onResolve = vi.fn();
    render(<ZipInput onResolve={onResolve} />);

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '123{Enter}');

    expect(screen.getByText(/5-digit ZIP/i)).toBeInTheDocument();
    expect(mockLookupZip).not.toHaveBeenCalled();
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('fetch error during lookup → role=alert fallback-to-selector message', async () => {
    mockLookupZip.mockRejectedValue(new Error('zip-index fetch failed: 503'));
    const onResolve = vi.fn();
    render(<ZipInput onResolve={onResolve} />);

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '85701{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/pick a state/i);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it('a prior "not recognized" status clears once a malformed value is submitted', async () => {
    mockLookupZip.mockResolvedValueOnce(null);
    render(<ZipInput onResolve={vi.fn()} />);

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '99999{Enter}');
    expect(await screen.findByRole('status')).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, '12{Enter}');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText(/5-digit ZIP/i)).toBeInTheDocument();
  });
});
