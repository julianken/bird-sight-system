import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StateSummary } from '@bird-watch/shared-types';
import { ZIP_FLYTO_ZOOM } from '../state/scope-types.js';

// ScopeControl composes the real <ZipInput> (#739). Mock only ZipInput's data
// layer (`zip-lookup.js`) so the resolution path is deterministic — we assert
// that the resolved ScopeResolution is FORWARDED through ScopeControl to its
// caller. The "ZIP not recognized" / malformed / fetch-error UX is owned and
// tested by ZipInput.test.tsx; we do NOT duplicate it here.
const { mockLoadZipIndex, mockLookupZip } = vi.hoisted(() => ({
  mockLoadZipIndex: vi.fn(),
  mockLookupZip: vi.fn(),
}));

vi.mock('../data/zip-lookup.js', () => ({
  loadZipIndex: mockLoadZipIndex,
  lookupZip: mockLookupZip,
}));

// Imported AFTER the mock is registered.
import { ScopeControl } from './ScopeControl.js';

const STATES: StateSummary[] = [
  { stateCode: 'US-AZ', name: 'Arizona', bbox: [-114.8, 31.3, -109.0, 37.0] },
  { stateCode: 'US-CA', name: 'California', bbox: [-124.4, 32.5, -114.1, 42.0] },
  { stateCode: 'US-NY', name: 'New York', bbox: [-79.8, 40.5, -71.8, 45.0] },
];

function renderControl(
  overrides: Partial<React.ComponentProps<typeof ScopeControl>> = {},
) {
  const props = {
    states: STATES,
    scope: { kind: 'state' as const, stateCode: 'US-AZ' },
    onPickState: vi.fn(),
    onPickWholeUs: vi.fn(),
    onExit: vi.fn(),
    onResolve: vi.fn(),
    ...overrides,
  };
  render(<ScopeControl {...props} />);
  return props;
}

/**
 * The state-row "Go" commit button. Both the embedded <ZipInput> and the state
 * row expose a "Go" submit (#1035), so scope to the form that contains the
 * "Switch state" <select> — mirrors the POM's chooser-Go disambiguation.
 */
function getStateGo(): HTMLElement {
  const select = screen.getByRole('combobox', { name: /switch state/i });
  const form = select.closest('form');
  if (!form) throw new Error('state <select> must be inside a <form> for Enter/Go commit');
  return within(form).getByRole('button', { name: /^go$/i });
}

describe('<ScopeControl>', () => {
  beforeEach(() => {
    mockLoadZipIndex.mockReset().mockResolvedValue(undefined);
    mockLookupZip.mockReset();
  });

  it('renders a labelled region exposing the state select, ZIP input, and exit affordances', () => {
    renderControl();
    // The control is a labelled landmark so screen-reader users can jump to it.
    const region = screen.getByRole('region', { name: /scope|change.*where|map scope/i });
    expect(region).toBeInTheDocument();
    // State <select>.
    expect(within(region).getByRole('combobox', { name: /switch state/i })).toBeInTheDocument();
    // ZIP path (the real ZipInput).
    expect(within(region).getByRole('textbox', { name: /ZIP code/i })).toBeInTheDocument();
    // Exit affordance.
    expect(within(region).getByRole('button', { name: /change scope/i })).toBeInTheDocument();
  });

  it('populates the state <select> from props.states (value=stateCode, text=name) plus a placeholder', () => {
    renderControl();
    const select = screen.getByRole('combobox', { name: /switch state/i });
    const options = within(select).getAllByRole('option');
    // 3 states + 1 placeholder.
    expect(options).toHaveLength(STATES.length + 1);
    expect(options[0]).toHaveValue('');
    expect(options[0]).toHaveTextContent(/switch state/i);
    expect(options[1]).toHaveValue('US-AZ');
    expect(options[1]).toHaveTextContent('Arizona');
    expect(options[2]).toHaveValue('US-CA');
    expect(options[3]).toHaveValue('US-NY');
  });

  it('in a state view, the current scope state is the selected option', () => {
    renderControl({ scope: { kind: 'state', stateCode: 'US-CA' } });
    const select = screen.getByRole('combobox', {
      name: /switch state/i,
    }) as HTMLSelectElement;
    expect(select.value).toBe('US-CA');
  });

  // WCAG 3.2.2 (On Input, #1035): changing the <select> must NOT navigate by
  // itself — only an explicit Go/Enter commit emits the scope. Mirrors the
  // landing chooser's transient-value-then-Go pattern.
  it('changing the select does NOT call onPickState (WCAG 3.2.2 — change never navigates)', async () => {
    const { onPickState } = renderControl();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /switch state/i }),
      'US-NY',
    );
    // Selection is staged locally; no navigation fires on change for any input
    // modality (keyboard arrow-browse or pointer pick).
    expect(onPickState).not.toHaveBeenCalled();
  });

  it('select + Go commits: emits onPickState once with the chosen US-XX code', async () => {
    const { onPickState } = renderControl();
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /switch state/i }),
      'US-NY',
    );
    await userEvent.click(getStateGo());
    expect(onPickState).toHaveBeenCalledTimes(1);
    expect(onPickState).toHaveBeenCalledWith('US-NY');
  });

  it('Enter on the focused Go (form submit) commits: emits onPickState once with the chosen US-XX code', async () => {
    const { onPickState } = renderControl();
    const select = screen.getByRole('combobox', { name: /switch state/i });
    await userEvent.selectOptions(select, 'US-CA');
    // Enter on the focused submit button fires the enclosing form's onSubmit →
    // commit. (Native selects swallow Enter rather than submit, so the keyboard
    // commit path is the submit button — same form-submit handler as Go-click.)
    const go = getStateGo();
    go.focus();
    await userEvent.keyboard('{Enter}');
    expect(onPickState).toHaveBeenCalledTimes(1);
    expect(onPickState).toHaveBeenCalledWith('US-CA');
  });

  it('Go is disabled while the placeholder is selected, and committing it is a no-op', async () => {
    const { onPickState } = renderControl({ scope: { kind: 'us' } });
    const select = screen.getByRole('combobox', {
      name: /switch state/i,
    }) as HTMLSelectElement;
    // Whole-US view starts on the neutral placeholder (no pending state).
    expect(select.value).toBe('');
    const go = getStateGo();
    expect(go).toBeDisabled();
    // Even a programmatic click cannot commit while the placeholder is selected.
    await userEvent.click(go);
    expect(onPickState).not.toHaveBeenCalled();
  });

  it('in a ?scope=us view the select shows the neutral placeholder, and select + Go calls onPickState', async () => {
    const { onPickState } = renderControl({ scope: { kind: 'us' } });
    const select = screen.getByRole('combobox', {
      name: /switch state/i,
    }) as HTMLSelectElement;
    // Neutral placeholder selected (no state is active in whole-US).
    expect(select.value).toBe('');
    expect(within(select).getAllByRole('option')[0]).toHaveTextContent(/switch state/i);

    await userEvent.selectOptions(select, 'US-AZ');
    await userEvent.click(getStateGo());
    expect(onPickState).toHaveBeenCalledTimes(1);
    expect(onPickState).toHaveBeenCalledWith('US-AZ');
  });

  it('the exit affordance ("Change scope") calls onExit once', async () => {
    const { onExit } = renderControl();
    await userEvent.click(screen.getByRole('button', { name: /change scope/i }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('in a state view, the de-emphasized "Whole US" affordance calls onPickWholeUs once', async () => {
    const { onPickWholeUs } = renderControl({ scope: { kind: 'state', stateCode: 'US-AZ' } });
    await userEvent.click(screen.getByRole('button', { name: /whole us/i }));
    expect(onPickWholeUs).toHaveBeenCalledTimes(1);
  });

  it('does NOT render the "Whole US" affordance when already in a ?scope=us view (no-op self-link)', () => {
    renderControl({ scope: { kind: 'us' } });
    expect(screen.queryByRole('button', { name: /whole us/i })).not.toBeInTheDocument();
    // Exit is always present.
    expect(screen.getByRole('button', { name: /change scope/i })).toBeInTheDocument();
  });

  it('a ZIP resolution from the embedded ZipInput bubbles up via props.onResolve with the ScopeResolution payload', async () => {
    mockLookupZip.mockResolvedValue({
      zip: '85701',
      center: [-110.971, 32.21696],
      stateCode: 'US-AZ',
    });
    const { onResolve } = renderControl();

    const input = screen.getByRole('textbox', { name: /ZIP code/i });
    await userEvent.type(input, '85701{Enter}');

    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith({
      stateCode: 'US-AZ',
      center: [-110.971, 32.21696],
      zoom: ZIP_FLYTO_ZOOM,
    });
  });

  it('ScopeControl triggers no data fetch and no ZIP-index warm on mount (C6 owns refetch; ZipInput warms on focus)', () => {
    renderControl();
    // Lazy ZIP index is only warmed on input focus, never on mount.
    expect(mockLoadZipIndex).not.toHaveBeenCalled();
  });

  it('a11y: select + buttons are reachable by accessible name and keyboard-operable in order', async () => {
    renderControl();
    const select = screen.getByRole('combobox', { name: /switch state/i });
    const go = getStateGo();
    const zip = screen.getByRole('textbox', { name: /ZIP code/i });
    const exit = screen.getByRole('button', { name: /change scope/i });
    expect(select).toBeInTheDocument();
    expect(go).toBeInTheDocument();
    expect(zip).toBeInTheDocument();
    expect(exit).toBeInTheDocument();

    // Tab order: state select → Go (commit) → ZIP input → (whole-US) → exit. No
    // trap — every control is reachable from the select via forward tabbing.
    select.focus();
    expect(select).toHaveFocus();
    await userEvent.tab();
    expect(go).toHaveFocus();
    await userEvent.tab();
    expect(zip).toHaveFocus();
  });

  // #837: a forwarded ref attaches to the FIRST field (the state <select>), so
  // AppHeader's open-the-disclosure effect can focus it directly rather than via
  // a fragile `querySelector('select')` DOM-order lookup. This is the mechanism
  // that keeps focus-on-open robust to future field-order changes.
  it('forwards a ref to the first field (the state <select>) for robust focus-on-open', () => {
    const ref = createRef<HTMLSelectElement>();
    renderControl({ ref } as Partial<React.ComponentProps<typeof ScopeControl>>);
    const select = screen.getByRole('combobox', { name: /switch state/i });
    // The forwarded ref resolves to the select element itself (not the wrapper,
    // not the ZIP field) — focusing ref.current focuses the first field.
    expect(ref.current).toBe(select);
    ref.current?.focus();
    expect(select).toHaveFocus();
  });
});
