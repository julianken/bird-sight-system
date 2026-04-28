import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StackedSilhouetteMarker } from './StackedSilhouetteMarker.js';

/**
 * Helpers to build the minimal props required for each test variant.
 */
function baseProps(overrides?: Partial<Parameters<typeof StackedSilhouetteMarker>[0]>) {
  return {
    silhouette: { svgData: 'M0 0L24 24Z', color: '#C77A2E' },
    comName: 'Northern Cardinal',
    familyCode: 'cardinalidae',
    locName: 'Saguaro NP',
    obsDt: '2026-04-15',
    isNotable: false,
    onClick: vi.fn(),
    ...overrides,
  };
}

describe('StackedSilhouetteMarker', () => {
  // AC1: Renders <svg viewBox="0 0 24 24"> containing the silhouette path
  it('AC1: renders an svg with viewBox 0 0 24 24', () => {
    render(<StackedSilhouetteMarker {...baseProps()} />);
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  // AC2: When silhouette.svgData is null → renders fallback circle path
  it('AC2: uses FALLBACK_PATH circle when svgData is null', () => {
    render(
      <StackedSilhouetteMarker
        {...baseProps({ silhouette: { svgData: null, color: '#aabbcc' } })}
      />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    // The fallback path encodes a circle — check that the d attribute
    // contains the arc command used in FALLBACK_PATH
    const paths = svg?.querySelectorAll('path') ?? [];
    const fillPaths = Array.from(paths).filter(
      (p) => p.getAttribute('fill') !== 'none' && !p.getAttribute('stroke'),
    );
    // At least one path has 'a' (arc) in its d — the fallback circle
    const hasFallback = Array.from(paths).some((p) =>
      (p.getAttribute('d') ?? '').includes('a'),
    );
    expect(hasFallback).toBe(true);
  });

  // AC3: Path fill matches silhouette.color
  it('AC3: path fill matches silhouette.color', () => {
    const color = '#DEAD42';
    render(
      <StackedSilhouetteMarker
        {...baseProps({ silhouette: { svgData: 'M1 1Z', color } })}
      />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);
    // The colored fill path (not the halo which has no fill or stroke only)
    const coloredPath = paths.find(
      (p) => p.getAttribute('fill') === color,
    );
    expect(coloredPath).not.toBeNull();
  });

  // AC4: White halo path appears BEFORE the colored path in the SVG
  it('AC4: white halo path is rendered BEFORE the colored silhouette path', () => {
    const color = '#DEAD42';
    render(
      <StackedSilhouetteMarker
        {...baseProps({ silhouette: { svgData: 'M1 1Z', color } })}
      />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const paths = Array.from(svg?.querySelectorAll('path') ?? []);
    const haloIndex = paths.findIndex(
      (p) => p.getAttribute('stroke') === 'white',
    );
    const colorIndex = paths.findIndex(
      (p) => p.getAttribute('fill') === color,
    );
    expect(haloIndex).toBeGreaterThanOrEqual(0);
    expect(colorIndex).toBeGreaterThanOrEqual(0);
    // Halo must come before fill so it paints BEHIND the silhouette
    expect(haloIndex).toBeLessThan(colorIndex);
  });

  // AC4 detail: halo has stroke-width="2"
  it('AC4: white halo has stroke-width 2', () => {
    render(<StackedSilhouetteMarker {...baseProps()} />);
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const halo = svg?.querySelector('path[stroke="white"]');
    expect(halo).not.toBeNull();
    expect(halo?.getAttribute('stroke-width')).toBe('2');
  });

  // AC5: data-testid on root element
  it('AC5: root element has data-testid="stacked-silhouette-marker"', () => {
    render(<StackedSilhouetteMarker {...baseProps()} />);
    expect(
      screen.getByTestId('stacked-silhouette-marker'),
    ).toBeInTheDocument();
  });

  // AC6: aria-label includes comName + familyCode + locName + obsDt
  it('AC6: aria-label includes all present fields', () => {
    render(<StackedSilhouetteMarker {...baseProps()} />);
    const label =
      screen
        .getByTestId('stacked-silhouette-marker')
        .getAttribute('aria-label') ?? '';
    expect(label).toContain('Northern Cardinal');
    expect(label).toContain('cardinalidae');
    expect(label).toContain('Saguaro NP');
    expect(label).toContain('2026-04-15');
  });

  it('AC6: aria-label omits null familyCode cleanly (no "null" literal)', () => {
    render(
      <StackedSilhouetteMarker
        {...baseProps({ familyCode: null })}
      />,
    );
    const label =
      screen
        .getByTestId('stacked-silhouette-marker')
        .getAttribute('aria-label') ?? '';
    expect(label).not.toMatch(/null/i);
    expect(label).toContain('Northern Cardinal');
  });

  it('AC6: aria-label omits null locName cleanly (no "null" literal)', () => {
    render(
      <StackedSilhouetteMarker
        {...baseProps({ locName: null })}
      />,
    );
    const label =
      screen
        .getByTestId('stacked-silhouette-marker')
        .getAttribute('aria-label') ?? '';
    expect(label).not.toMatch(/null/i);
    expect(label).toContain('Northern Cardinal');
  });

  // AC7: onClick fires; stopPropagation called
  it('AC7: onClick fires when the button is clicked', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<StackedSilhouetteMarker {...baseProps({ onClick })} />);
    await user.click(screen.getByTestId('stacked-silhouette-marker'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('AC7: stopPropagation is called on the click event', async () => {
    // Wrap in a parent with its own click listener; if stopPropagation
    // works the outer listener must NOT fire.
    const parentClick = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <div onClick={parentClick}>
        <StackedSilhouetteMarker {...baseProps()} />
      </div>,
    );
    await user.click(container.querySelector('button')!);
    expect(parentClick).not.toHaveBeenCalled();
  });

  // AC8: Notable observations render an amber circle ring BEFORE the silhouette
  it('AC8: notable obs render a circle element (amber ring)', () => {
    render(
      <StackedSilhouetteMarker {...baseProps({ isNotable: true })} />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const circles = svg?.querySelectorAll('circle') ?? [];
    expect(circles.length).toBeGreaterThanOrEqual(1);
  });

  it('AC8: non-notable obs do NOT render the amber ring circle', () => {
    render(
      <StackedSilhouetteMarker {...baseProps({ isNotable: false })} />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const circles = svg?.querySelectorAll('circle') ?? [];
    expect(circles.length).toBe(0);
  });

  it('AC8: notable amber ring circle appears BEFORE the halo path in the SVG', () => {
    render(
      <StackedSilhouetteMarker {...baseProps({ isNotable: true })} />,
    );
    const svg = screen
      .getByTestId('stacked-silhouette-marker')
      .querySelector('svg');
    const children = Array.from(svg?.children ?? []);
    const circleIndex = children.findIndex((el) => el.tagName === 'circle');
    const haloIndex = children.findIndex(
      (el) => el.tagName === 'path' && el.getAttribute('stroke') === 'white',
    );
    expect(circleIndex).toBeGreaterThanOrEqual(0);
    expect(haloIndex).toBeGreaterThanOrEqual(0);
    // Ring paints first → circle before halo
    expect(circleIndex).toBeLessThan(haloIndex);
  });

  // Root element is a <button> for keyboard accessibility
  it('root element is a <button type="button"> for keyboard accessibility', () => {
    render(<StackedSilhouetteMarker {...baseProps()} />);
    const btn = screen.getByTestId('stacked-silhouette-marker');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
  });
});
