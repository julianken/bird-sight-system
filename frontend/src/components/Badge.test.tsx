import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, DEFAULT_BADGE_RADIUS } from './Badge.js';
import { GENERIC_SILHOUETTE } from '../App.js';
import { MIN_BADGE_DIAMETER } from './BadgeStack.js';

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

describe('GENERIC_SILHOUETTE (ticket #92)', () => {
  it('GENERIC_SILHOUETTE.path has bbox 12x10 (x:5->17, y:6->16) and size=12', () => {
    // Extract every numeric token from the path; they come in alternating
    // x, y pairs for this subset (M + C endpoints + L endpoints + control
    // points are all pair-shaped for this specific silhouette).
    const nums = GENERIC_SILHOUETTE.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      xs.push(nums[i]!);
      ys.push(nums[i + 1]!);
    }
    expect(Math.min(...xs)).toBe(5);
    expect(Math.max(...xs)).toBe(17);
    expect(Math.min(...ys)).toBe(6);
    expect(Math.max(...ys)).toBe(16);
    expect(GENERIC_SILHOUETTE.size).toBe(12);
  });
});

describe('Badge/BadgeStack size-constants pin (ticket #92)', () => {
  it('pins constants at their documented literals (radius vs diameter semantics intentional)', () => {
    // These share the literal 14 by coincidence. DEFAULT_BADGE_RADIUS is a
    // RADIUS (Badge-local default), MIN_BADGE_DIAMETER is a DIAMETER (the
    // lower bound of BadgeStack's shrink-to-fit loop). Renaming to make
    // the radius/diameter split visible in the name is the whole point of
    // the ticket; this pin catches accidental drift.
    expect(DEFAULT_BADGE_RADIUS).toBe(14);
    expect(MIN_BADGE_DIAMETER).toBe(14);
  });
});
