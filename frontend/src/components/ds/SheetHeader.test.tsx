import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SheetHeader } from './SheetHeader.js';

describe('<SheetHeader>', () => {
  it('renders the bare × close button with the supplied aria-label', () => {
    render(<SheetHeader closeLabel="Close filters" onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close filters' });
    expect(close).toBeInTheDocument();
    // Bare × glyph — no text label baked in (the accessible name is the
    // aria-label so the shared affordance vocabulary is a single × icon).
    expect(close.textContent).toBe('×');
  });

  it('calls onClose when the × is clicked', async () => {
    const onClose = vi.fn();
    render(<SheetHeader closeLabel="Close species detail" onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Close species detail' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('applies the supplied close-button className (so existing CSS + e2e selectors hold)', () => {
    render(
      <SheetHeader
        closeLabel="Close filters"
        onClose={vi.fn()}
        closeClassName="filters-panel-close"
      />,
    );
    expect(screen.getByRole('button', { name: 'Close filters' })).toHaveClass(
      'filters-panel-close',
    );
  });

  it('renders a grabber slot when `grabber` is provided (detail-sheet drag handle)', () => {
    render(
      <SheetHeader
        closeLabel="Close species detail"
        onClose={vi.fn()}
        grabber={
          <button type="button" data-testid="my-grabber">
            grab
          </button>
        }
      />,
    );
    // The grabber slot is rendered verbatim — the detail sheet hands in its own
    // pointer-wired drag handle so the delicate gesture/inert wiring is untouched.
    expect(screen.getByTestId('my-grabber')).toBeInTheDocument();
    // The × still renders alongside the grabber (grabber + × shared vocabulary).
    expect(
      screen.getByRole('button', { name: 'Close species detail' }),
    ).toBeInTheDocument();
  });

  it('omits the grabber when none is supplied (filters sheet has × only)', () => {
    render(<SheetHeader closeLabel="Close filters" onClose={vi.fn()} />);
    // Only the close button is a button; no grabber slot is rendered.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName('Close filters');
  });
});
