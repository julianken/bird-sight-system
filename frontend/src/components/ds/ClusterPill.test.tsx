import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClusterPill } from './ClusterPill.js';
import { pillDimensions } from './ClusterPill.js';

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
  it('sky tier (count < 100) → min-width respected for short counts', () => {
    expect(pillDimensions(30)).toEqual({ w: 36, h: 24 });
  });
  it('sky tier 3-digit count uses formula', () => {
    expect(pillDimensions(99)).toEqual({ w: 36, h: 24 });
  });
  it('sand tier (100 ≤ count < 750) → 3-digit width', () => {
    expect(pillDimensions(214)).toEqual({ w: 53, h: 27 });
  });
  it('ember tier (count ≥ 750) → 4-digit width', () => {
    expect(pillDimensions(1648)).toEqual({ w: 72, h: 33 });
  });
});
