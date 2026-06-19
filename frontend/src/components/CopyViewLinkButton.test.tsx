import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CopyViewLinkButton } from './CopyViewLinkButton.js';
import type { ViewboxCamera } from '@/state/viewbox-link.js';

// CopyViewLinkButton — C2 (#1240, epic #1238). Reads the live camera (via the
// `getCamera` prop), builds a `…<search>#map=…&v=…` link through the C1 codec,
// and writes it to the clipboard with an accessible `role="status"` confirmation.
//
// These tests pin the load-bearing contract from the issue's Test expectations:
//   - correct label / testid, NO aria-haspopup (it is not a disclosure);
//   - click calls the codec + navigator.clipboard.writeText with a string of the
//     link shape (regex, not an exact value — the camera floats);
//   - the clipboard-failure path falls back and writes the failure text to the
//     live region (no silently-swallowed error).

const AZ_CAMERA: ViewboxCamera = { zoom: 12.5, lat: 34.0489, lng: -111.0937 };

// A getCamera that returns a fixed AZ camera — the unit tests don't drive a real
// map; they assert the button reads whatever getCamera yields and threads it
// through encodeViewbox.
function fixedCamera(): ViewboxCamera {
  return AZ_CAMERA;
}

// The codec emits `map=<z>/<lat>/<lng>[/…]&v=<W>x<H>@<dpr>`; with the leading
// '#' the built link contains `#map=12.500/34.04890/-111.09370…`. The regex
// matches the SHAPE (zoom/lat/lng, lat & lng signed) without pinning the float.
const LINK_SHAPE = /#map=[\d.]+\/-?[\d.]+\/-?[\d.]+/;

describe('<CopyViewLinkButton>', () => {
  beforeEach(() => {
    // jsdom provides window.location; pin a deterministic origin/path/search so
    // the asserted link prefix is stable. jsdom defaults to http://localhost/.
    window.history.replaceState({}, '', '/?scope=us&since=7d');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Scrub any clipboard stub we installed onto the navigator.
    // (Each test installs its own; restoreAllMocks handles vi.fn spies.)
  });

  it('renders an icon button with the correct label + testid and NO aria-haspopup/expanded/pressed', () => {
    render(<CopyViewLinkButton getCamera={fixedCamera} labeled={false} />);
    const button = screen.getByTestId('copy-view-link');
    expect(button.tagName).toBe('BUTTON');
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAccessibleName('Copy link to this view');
    // It is a momentary action, NOT a disclosure/dialog/toggle — these ARIA
    // attributes must be absent (issue a11y contract).
    expect(button).not.toHaveAttribute('aria-haspopup');
    expect(button).not.toHaveAttribute('aria-expanded');
    expect(button).not.toHaveAttribute('aria-pressed');
    // The button itself must NOT carry aria-live (the confirmation is a sibling).
    expect(button).not.toHaveAttribute('aria-live');
  });

  it('exposes a sibling role=status live region for the confirmation announcement', () => {
    render(<CopyViewLinkButton getCamera={fixedCamera} labeled={false} />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    // The status region is a SIBLING of the button, not the button itself.
    expect(status.tagName).toBe('SPAN');
  });

  it('renders the "Copy link" label only when labeled (wide breakpoint)', () => {
    const { rerender } = render(
      <CopyViewLinkButton getCamera={fixedCamera} labeled={false} />,
    );
    expect(screen.queryByText('Copy link')).not.toBeInTheDocument();
    rerender(<CopyViewLinkButton getCamera={fixedCamera} labeled />);
    expect(screen.getByText('Copy link')).toBeInTheDocument();
  });

  it('on click, calls navigator.clipboard.writeText with a link of the codec shape', async () => {
    // userEvent.setup() installs its OWN clipboard stub on navigator.clipboard
    // (v14 behavior), so our spy MUST be defined AFTER setup() to win.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const getCamera = vi.fn(fixedCamera);
    render(<CopyViewLinkButton getCamera={getCamera} labeled={false} />);

    await user.click(screen.getByTestId('copy-view-link'));

    expect(getCamera).toHaveBeenCalled();
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const written = writeText.mock.calls[0][0] as string;
    expect(written).toMatch(LINK_SHAPE);
    // The query (scope/filters) rides on location.search; the camera rides in
    // the hash — both present, hash AFTER search.
    expect(written).toContain('?scope=us&since=7d');
    expect(written.indexOf('?scope=us')).toBeLessThan(written.indexOf('#map='));
    // And the encoded camera reflects the AZ camera getCamera returned.
    expect(written).toContain('#map=12.500/34.04890/-111.09370');
  });

  it('announces success in the live region after a successful copy', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<CopyViewLinkButton getCamera={fixedCamera} labeled={false} />);
    await user.click(screen.getByTestId('copy-view-link'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/copied/i),
    );
  });

  it('falls back when clipboard.writeText rejects, and writes the failure text to the live region', async () => {
    const user = userEvent.setup();
    // clipboard present but rejecting (permission denied / not focused).
    // Defined AFTER setup() so it wins over user-event's own clipboard stub.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    // execCommand fallback present but returns false (also fails) so the LAST
    // resort (selectable field + instruction) fires.
    const execCommand = vi.fn().mockReturnValue(false);
    // jsdom has no execCommand by default; define it.
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    render(<CopyViewLinkButton getCamera={fixedCamera} labeled />);

    await user.click(screen.getByTestId('copy-view-link'));

    // The failure instruction is announced in the live region (NOT silently
    // swallowed) and the link is surfaced as a selectable, prefilled field.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/copy failed/i),
    );
    await waitFor(() => {
      const field = screen.getByTestId('copy-view-link-fallback') as HTMLInputElement;
      expect(field.value).toMatch(LINK_SHAPE);
    });
  });

  it('falls back to execCommand when navigator.clipboard is unavailable', async () => {
    const user = userEvent.setup();
    // No clipboard API at all (older / insecure-context browsers). Defined
    // AFTER setup() so it overrides user-event's installed clipboard stub.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });
    render(<CopyViewLinkButton getCamera={fixedCamera} labeled={false} />);

    await user.click(screen.getByTestId('copy-view-link'));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith('copy'));
    // A successful execCommand copy still announces success.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/copied/i),
    );
  });

  it('is a no-op (no throw, no clipboard write) when getCamera returns null', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const user = userEvent.setup();
    render(<CopyViewLinkButton getCamera={() => null} labeled={false} />);

    await user.click(screen.getByTestId('copy-view-link'));

    // No camera → nothing to copy; the control must not throw or write garbage.
    expect(writeText).not.toHaveBeenCalled();
  });

  it('resets the success-check to "out" after the copied dwell so it does not stick over the link', async () => {
    // Regression: the recipe-10 success check runs `t-check-fade … forwards`,
    // which pins it at opacity:1 with FILL-MODE forwards. On the idle reset the
    // OUTER icon-swap flips back to 'a' (static opacity:0 for the now-hidden
    // check), but a forwards animation value overrides that static opacity — so
    // without ALSO resetting the inner wrapper's `data-state` from "in" → "out",
    // the drawn check stays stuck on top of the link glyph. This pins both the
    // entry (→ "in" during `copied`) and the exit (→ "out" after COPIED_MS).
    // Fake timers so we advance past COPIED_MS without a wall-clock sleep.
    // requestAnimationFrame is NOT faked by vitest's default `toFake` list, so
    // we list it (and cancelAnimationFrame) explicitly — otherwise the
    // component's `requestAnimationFrame(replayCheck)` runs on jsdom's real
    // ~16ms clock and never fires under our fake-clock advances, leaving the
    // check stuck at "out" and the "in" assertion hanging. We dispatch the
    // click with fireEvent (synchronous — user-event schedules its own timers
    // and deadlocks under fake timers) and advance the clock deterministically
    // instead of using waitFor (whose internal poll never ticks the fake clock).
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    try {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      render(<CopyViewLinkButton getCamera={fixedCamera} labeled={false} />);

      const button = screen.getByTestId('copy-view-link');
      // Query the recipe-10 wrapper by class (it carries no own testid). Always
      // mounted inside the button; `data-state` starts "out".
      const check = button.querySelector('.t-success-check') as HTMLElement;
      expect(check).not.toBeNull();
      expect(check).toHaveAttribute('data-state', 'out');

      fireEvent.click(button);
      // Flush the click handler's async clipboard write (a resolved microtask)
      // then fire the queued requestAnimationFrame that calls replayCheck (which
      // sets data-state → "in"). Advancing by a small amount fires the rAF
      // without reaching the COPIED_MS reset; the act() wraps the React updates.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20);
      });

      // During `copied`, the check has entered: data-state flipped to "in".
      expect(check).toHaveAttribute('data-state', 'in');
      expect(button).toHaveAttribute('data-state', 'copied');

      // Advance past the dwell — the idle reset must drop the check back to
      // "out" (the fix) so the static opacity:0 wins and the check disappears.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(COPIED_MS + 1);
      });

      expect(check).toHaveAttribute('data-state', 'out');
      expect(button).toHaveAttribute('data-state', 'idle');
    } finally {
      vi.useRealTimers();
    }
  });
});

// COPIED_MS dwell window from CopyViewLinkButton (kept in sync; the component
// does not export it). The regression test advances fake timers past this.
const COPIED_MS = 1600;
