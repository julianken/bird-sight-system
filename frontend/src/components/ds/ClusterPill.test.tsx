import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClusterPill, pillDimensions } from './ClusterPill.js';

describe('<ClusterPill>', () => {
  // --- Element shape and ARIA ---

  it('renders as <button type="button"> (matches MosaicMarker activation pattern)', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    const pill = screen.getByRole('button', { name: '42 sightings' });
    expect(pill).toBeInTheDocument();
    expect(pill.tagName).toBe('BUTTON');
    expect(pill).toHaveAttribute('type', 'button');
  });

  it('aria-label is "{count} sightings"', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '42 sightings');
  });

  it('aria-label uses thousands separator for count ≥1000 (C1 #1045)', () => {
    render(<ClusterPill count={16626} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '16,626 sightings');
  });

  it('aria-label updates when count changes', () => {
    const { rerender } = render(<ClusterPill count={10} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '10 sightings');
    rerender(<ClusterPill count={200} onClick={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', '200 sightings');
  });

  it('does not carry a redundant tabIndex attribute (UA button gets focus natively)', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    const pill = screen.getByRole('button');
    // tabIndex should not be explicitly set — UA manages focus order for <button>
    expect(pill).not.toHaveAttribute('tabindex');
  });

  // --- Tier class assignment ---

  it('applies sky tier class for count < 100', () => {
    render(<ClusterPill count={99} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sky')).toBeInTheDocument();
  });

  it('applies sand tier class for count = 100 (boundary)', () => {
    render(<ClusterPill count={100} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sand')).toBeInTheDocument();
  });

  it('applies sand tier class for count = 749', () => {
    render(<ClusterPill count={749} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--sand')).toBeInTheDocument();
  });

  it('applies ember tier class for count = 750 (boundary)', () => {
    render(<ClusterPill count={750} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--ember')).toBeInTheDocument();
  });

  it('applies ember tier class for count > 750', () => {
    render(<ClusterPill count={1200} onClick={vi.fn()} />);
    expect(document.querySelector('.cluster-pill--ember')).toBeInTheDocument();
  });

  // --- Count display ---

  it('displays the count as visible text inside the pill', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    // The count text is visible (canonical information carrier)
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('displays thousands-separated count for count ≥1000 (C1 #1045)', () => {
    render(<ClusterPill count={16626} onClick={vi.fn()} />);
    expect(screen.getByText('16,626')).toBeInTheDocument();
  });

  // --- Interaction ---

  it('calls onClick when the pill is clicked', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    await userEvent.click(screen.getByRole('button', { name: '5 sightings' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pill is keyboard-activatable (Enter key) via native button semantics', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    const pill = screen.getByRole('button', { name: '5 sightings' });
    pill.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pill is keyboard-activatable (Space key) via native button semantics', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    const pill = screen.getByRole('button', { name: '5 sightings' });
    pill.focus();
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('pillDimensions', () => {
  // Formula after C1 retune: width = max(minW, digits * digitPx + commas * (digitPx/2) + padding).
  // digitPx: sky=8, sand=9, ember=10. Commas = floor((digits-1)/3). Padding: sky=20, sand=26, ember=32.

  it('sky tier (count < 100) → min-width respected for short counts', () => {
    // "30": 2 digits, 0 commas → 2*8+0+20=36
    expect(pillDimensions(30)).toEqual({ w: 36, h: 24 });
  });
  it('sky tier 3-digit count uses formula', () => {
    // "99": 2 digits, 0 commas → 2*8+0+20=36
    expect(pillDimensions(99)).toEqual({ w: 36, h: 24 });
  });
  it('sand tier (100 ≤ count < 750) → 3-digit width', () => {
    // "214": 3 digits, 0 commas → 3*9+0+26=53
    expect(pillDimensions(214)).toEqual({ w: 53, h: 27 });
  });
  it('ember tier (count ≥ 750) → 4-digit width with separator (C1 #1045 retune)', () => {
    // "1,648": 4 digits, 1 comma → 4*10 + 1*5 + 32 = 77
    expect(pillDimensions(1648)).toEqual({ w: 77, h: 33 });
  });
  it('sand tier boundary (count = 100)', () => {
    // "100": 3 digits, 0 commas → 3*9+0+26=53
    expect(pillDimensions(100)).toEqual({ w: 53, h: 27 });
  });
  it('ember tier boundary (count = 750)', () => {
    // "750": 3 digits, 0 commas → 3*10+0+32=62
    expect(pillDimensions(750)).toEqual({ w: 62, h: 33 });
  });
  it('ember tier 5-digit count (16626) accounts for separator glyph (C1 #1045)', () => {
    // "16,626": 5 digits, 1 comma → 5*10 + 1*5 + 32 = 87
    expect(pillDimensions(16626)).toEqual({ w: 87, h: 33 });
  });
});
