import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClusterPill } from './ClusterPill.js';

describe('<ClusterPill>', () => {
  // --- ARIA ---

  it('renders with role="img"', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    const pill = screen.getByRole('img');
    expect(pill).toBeInTheDocument();
  });

  it('aria-label is "{count} sightings"', () => {
    render(<ClusterPill count={42} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '42 sightings');
  });

  it('aria-label updates when count changes', () => {
    const { rerender } = render(<ClusterPill count={10} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '10 sightings');
    rerender(<ClusterPill count={200} onClick={vi.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', '200 sightings');
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
    await userEvent.click(screen.getByRole('img'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('pill is keyboard-activatable (Enter key)', async () => {
    const onClick = vi.fn();
    render(<ClusterPill count={5} onClick={onClick} />);
    const pill = screen.getByRole('img');
    pill.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });
});
