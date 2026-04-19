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

  it('does not render a visible species name when expanded is false (default)', () => {
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge x={50} y={50} count={1} silhouettePath="M0 0" color="#000" comName="Vermilion Flycatcher" />
      </svg>
    );
    // The aria-label on the parent <g> carries the name, but no visible label.
    expect(container.querySelector('.badge-label')).toBeNull();
  });

  it('renders a visible species name under the circle when expanded is true', () => {
    // Short name (<=14 chars) to avoid overlap with truncation behaviour;
    // a separate test below asserts the truncation rule.
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge
          x={50}
          y={50}
          count={1}
          silhouettePath="M0 0"
          color="#000"
          comName="Pygmy Owl"
          expanded={true}
        />
      </svg>
    );
    const label = container.querySelector('.badge-label');
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe('Pygmy Owl');
  });

  it('marks the visible label aria-hidden="true" to avoid screen-reader double-announcement', () => {
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge
          x={50}
          y={50}
          count={1}
          silhouettePath="M0 0"
          color="#000"
          comName="Vermilion Flycatcher"
          expanded={true}
        />
      </svg>
    );
    const label = container.querySelector('.badge-label');
    expect(label?.getAttribute('aria-hidden')).toBe('true');
    // Parent <g> still carries aria-label with the full common name.
    const parentG = container.querySelector('g.badge');
    expect(parentG?.getAttribute('aria-label')).toBe('Vermilion Flycatcher');
  });

  it('truncates long common names in the visible label but keeps the full name in aria-label', () => {
    const longName = 'Yellow-crowned Night-Heron'; // 26 chars
    const { container } = render(
      <svg viewBox="0 0 100 100">
        <Badge
          x={50}
          y={50}
          count={1}
          silhouettePath="M0 0"
          color="#000"
          comName={longName}
          expanded={true}
        />
      </svg>
    );
    const label = container.querySelector('.badge-label');
    expect(label).not.toBeNull();
    const visible = label!.textContent ?? '';
    // Visible text is truncated (ends with ellipsis) and shorter than the full name.
    expect(visible.endsWith('…')).toBe(true);
    expect(visible.length).toBeLessThan(longName.length);
    // Parent <g> still carries the complete name for screen readers.
    const parentG = container.querySelector('g.badge');
    expect(parentG?.getAttribute('aria-label')).toBe(longName);
  });
});
