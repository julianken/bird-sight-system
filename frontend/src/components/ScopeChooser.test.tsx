import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StateSummary } from '@bird-watch/shared-types';
import { ZIP_FLYTO_ZOOM } from '../state/scope-types.js';

// ScopeChooser composes the real <ZipInput> (#739). Mock only ZipInput's
// data layer (`zip-lookup.js`) so the resolution path is deterministic — we
// assert that the resolved ScopeResolution is FORWARDED through ScopeChooser
// to its caller. The "ZIP not recognized" / malformed / fetch-error UX is
// owned and tested by ZipInput.test.tsx; we do NOT duplicate it here.
const { mockLoadZipIndex, mockLookupZip } = vi.hoisted(() => ({
  mockLoadZipIndex: vi.fn(),
  mockLookupZip: vi.fn(),
}));

vi.mock('../data/zip-lookup.js', () => ({
  loadZipIndex: mockLoadZipIndex,
  lookupZip: mockLookupZip,
}));

// Imported AFTER the mock is registered.
import { ScopeChooser } from './ScopeChooser.js';

const STATES: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.8, 31.3, -109.0, 37.0] },
  { stateCode: 'US-CA', name: 'California', bbox: [-124.4, 32.5, -114.1, 42.0] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.8, 40.5, -71.8, 45.0] },
];

function renderChooser(overrides: Partial<React.ComponentProps<typeof ScopeChooser>> = {}) {
  const props = {
    states: STATES,
    onPickState: vi.fn(),
    onPickWholeUs: vi.fn(),
    onResolve: vi.fn(),
    ...overrides,
  };
  render(<ScopeChooser {...props} />);
  return props;
}

/**
 * The State-path "Go" submit button. #827 added a second "Go" (the ZipInput
 * submit), so a bare `getByRole('button', { name: /go/i })` is now ambiguous.
 * The State "Go" is the submit button inside the State `<select>`'s own
 * `<form>` — scope to that form to select it unambiguously. (The ZIP "Go" lives
 * in the sibling `role="search"` form and is always enabled.)
 */
function getStateGo(): HTMLElement {
  const stateSelect = screen.getByRole('combobox', { name: /state/i });
  const stateForm = stateSelect.closest('form');
  if (!stateForm) throw new Error('State <select> is not inside a <form>');
  return within(stateForm).getByRole('button', { name: /go/i });
}

describe('<ScopeChooser>', () => {
  beforeEach(() => {
    mockLoadZipIndex.mockReset().mockResolvedValue(undefined);
    mockLookupZip.mockReset();
  });

  it('renders a labelled region with all three scope paths', () => {
    renderChooser();
    const region = screen.getByRole('region', { name: /scope|where|look/i });
    expect(region).toBeInTheDocument();

    // ZIP path (the real ZipInput).
    expect(within(region).getByRole('textbox', { name: /ZIP code/i })).toBeInTheDocument();
    // State path.
    expect(within(region).getByRole('combobox', { name: /state/i })).toBeInTheDocument();
    // Whole-US escape hatch.
    expect(
      within(region).getByRole('button', { name: /whole us map/i }),
    ).toBeInTheDocument();
  });

  it('populates the state <select> options from props.states (value=stateCode, text=name) plus a placeholder', () => {
    renderChooser();
    const select = screen.getByRole('combobox', { name: /state/i });
    const options = within(select).getAllByRole('option');
    // 3 states + 1 placeholder.
    expect(options).toHaveLength(STATES.length + 1);
    // Placeholder is value="" and selected by default.
    expect(options[0]).toHaveValue('');
    expect((options[0] as HTMLOptionElement).selected).toBe(true);
    // Each state maps value=stateCode, text=name.
    expect(options[1]).toHaveValue('US-AZ');
    expect(options[1]).toHaveTextContent('Arizona');
    expect(options[2]).toHaveValue('US-CA');
    expect(options[3]).toHaveValue('US-NY');
  });

  it('state "Go" is disabled until a state is selected, then emits onPickState once with the chosen code', async () => {
    const { onPickState } = renderChooser();
    const goButton = getStateGo();
    expect(goButton).toBeDisabled();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /state/i }),
      'US-CA',
    );
    expect(goButton).toBeEnabled();

    await userEvent.click(goButton);
    expect(onPickState).toHaveBeenCalledTimes(1);
    expect(onPickState).toHaveBeenCalledWith('US-CA');
  });

  it('the ZIP path has its own always-enabled "Go" (#827) — matches the State row, never disabled', () => {
    renderChooser();
    // Two distinct "Go" buttons now: the State submit (getStateGo) and the ZIP
    // submit (inside the role="search" ZipInput form). The ZIP one is always
    // enabled — submitting a malformed value still surfaces the inline hint.
    const search = screen.getByRole('search');
    const zipGo = within(search).getByRole('button', { name: /^go$/i });
    expect(zipGo).toBeEnabled();
    expect(zipGo).toHaveAttribute('type', 'submit');
    // Sanity: it is NOT the State Go (which starts disabled).
    expect(zipGo).not.toBe(getStateGo());
  });

  it('forwards a resolved ZIP via the ZIP "Go" button click (#827 — pointer path)', async () => {
    mockLookupZip.mockResolvedValue({
      zip: '85701',
      center: [-110.971, 32.21696],
      stateCode: 'US-AZ',
    });
    const { onResolve } = renderChooser();

    await userEvent.type(screen.getByRole('textbox', { name: /ZIP code/i }), '85701');
    const search = screen.getByRole('search');
    await userEvent.click(within(search).getByRole('button', { name: /^go$/i }));

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      stateCode: 'US-AZ',
      center: [-110.971, 32.21696],
      zoom: ZIP_FLYTO_ZOOM,
    });
  });

  it('does not emit onPickState for the empty placeholder selection', async () => {
    const { onPickState } = renderChooser();
    const goButton = getStateGo();
    // Button stays disabled — clicking a disabled button is inert.
    await userEvent.click(goButton);
    expect(onPickState).not.toHaveBeenCalled();
  });

  it('whole-US button emits onPickWholeUs once', async () => {
    const { onPickWholeUs } = renderChooser();
    await userEvent.click(screen.getByRole('button', { name: /whole us map/i }));
    expect(onPickWholeUs).toHaveBeenCalledTimes(1);
  });

  it('forwards a resolved ZIP (ScopeResolution) straight up via onResolve', async () => {
    mockLookupZip.mockResolvedValue({
      zip: '85701',
      center: [-110.971, 32.21696],
      stateCode: 'US-AZ',
    });
    const { onResolve } = renderChooser();

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '85701{Enter}');

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      stateCode: 'US-AZ',
      center: [-110.971, 32.21696],
      zoom: ZIP_FLYTO_ZOOM,
    });
  });

  it('statesLoading → state <select> disabled with a loading placeholder, ZIP path still interactive', async () => {
    renderChooser({ statesLoading: true });
    const select = screen.getByRole('combobox', { name: /state/i });
    expect(select).toBeDisabled();
    // The placeholder option conveys the loading state (descriptive, not silently inert).
    const placeholder = within(select).getAllByRole('option')[0];
    expect(placeholder).toHaveValue('');
    expect(placeholder).toHaveTextContent(/loading/i);
    // State Go is disabled while loading too.
    expect(getStateGo()).toBeDisabled();

    // ZIP path stays fully usable: focusing warms the index (independent path).
    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    expect(input).toBeEnabled();
    await userEvent.click(input);
    expect(mockLoadZipIndex).toHaveBeenCalledTimes(1);
  });

  it('empty states (no statesLoading flag) → state <select> still disabled, ZIP path usable', () => {
    renderChooser({ states: [] });
    expect(screen.getByRole('combobox', { name: /state/i })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: /ZIP code/i })).toBeEnabled();
  });

  it('statesError (terminal /api/states outage) → placeholder reads "Couldn\'t load states", NOT "Loading states", and ZIP path stays usable', async () => {
    // Reproduces the SUGGESTION on PR #758: on a terminal outage statesLoading
    // is false but states is [] and error is non-null. Without the error prop
    // the placeholder showed "Loading states…" forever — a copy that lies.
    renderChooser({ states: [], statesLoading: false, statesError: new Error('Failed to fetch') });
    const select = screen.getByRole('combobox', { name: /state/i });
    expect(select).toBeDisabled();
    const placeholder = within(select).getAllByRole('option')[0];
    // Honest copy: not the "Loading…" lie.
    expect(placeholder).toHaveTextContent(/couldn.t load states/i);
    expect(placeholder).not.toHaveTextContent(/loading/i);
    // The user is told the ZIP path still works.
    const region = screen.getByRole('region', { name: /scope|where|look/i });
    expect(within(region).getByText(/use a zip code/i)).toBeInTheDocument();
    // ZIP path stays fully usable.
    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    expect(input).toBeEnabled();
    await userEvent.click(input);
    expect(mockLoadZipIndex).toHaveBeenCalledTimes(1);
  });

  it('a11y: region, ZIP input, and state select are reachable by accessible name', () => {
    renderChooser();
    expect(screen.getByRole('region', { name: /scope|where|look/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /ZIP code/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /state/i })).toBeInTheDocument();
  });
});
