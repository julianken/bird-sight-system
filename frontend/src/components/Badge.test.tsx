import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge.js';

describe('Badge', () => {
  it('renders the species count', () => {
    render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={3} silhouettePath="M0 0 L 10 10" color="#FF0808" comName="Vermilion Flycatcher" />
      </svg>
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('uses the family color', () => {
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={1} silhouettePath="M0 0" color="#7B2D8E" comName="Anna's Hummingbird" />
      </svg>
    );
    const circle = container.querySelector('circle.badge-circle');
    expect(circle?.getAttribute('fill')).toBe('#7B2D8E');
  });

  it('does not render the count chip when count is 1', () => {
    render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={1} silhouettePath="M0 0" color="#000" comName="X" />
      </svg>
    );
    expect(screen.queryByText('1')).not.toBeInTheDocument();
  });
});
