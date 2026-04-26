import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SurfaceFooter } from './SurfaceFooter.js';

describe('SurfaceFooter', () => {
  it('renders a <footer> element with the surface-footer class', () => {
    const { container } = render(<SurfaceFooter />);
    const footer = container.querySelector('footer');
    expect(footer).not.toBeNull();
    expect(footer?.classList.contains('surface-footer')).toBe(true);
  });

  it('renders an eBird credit link to https://ebird.org', () => {
    render(<SurfaceFooter />);
    // Per ToU §3, the credit must accompany the data wherever displayed and
    // link back to eBird.org. The accessible name surfaces "eBird" so screen-
    // reader users see the same attribution as sighted users.
    const link = screen.getByRole('link', { name: /eBird/i });
    expect(link).toHaveAttribute('href', 'https://ebird.org');
  });

  it('uses rel="noopener" on the eBird link, matching the AttributionControl convention', () => {
    // The MapCanvas customAttribution array uses rel="noopener" (NOT
    // rel="noopener noreferrer"). Keep one convention across the surfaces
    // so the eventual AttributionModal (#250) can adopt it verbatim.
    render(<SurfaceFooter />);
    const link = screen.getByRole('link', { name: /eBird/i });
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('credits the Cornell Lab of Ornithology in the visible text', () => {
    render(<SurfaceFooter />);
    // The data steward (Cornell Lab) is named alongside eBird per ToU §3
    // so the credit reads as "Bird data: eBird (Cornell Lab of Ornithology)".
    expect(screen.getByText(/Cornell Lab of Ornithology/i)).toBeInTheDocument();
    expect(screen.getByText(/Bird data/i)).toBeInTheDocument();
  });
});
