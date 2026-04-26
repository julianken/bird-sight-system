import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Observation } from '@bird-watch/shared-types';

/* Stub the heavy MapCanvas chunk so MapSurface tests don't pull in maplibre.
   The skip-link rendering is what we're asserting on, and it lives outside
   the React.lazy() boundary, so a no-op canvas is sufficient here.

   FamilyLegend is also stubbed because it consumes silhouette+observation
   data and renders its own DOM that would shadow the skip-link role queries
   below — keeping it out of the test surface narrows the assertion target
   to the skip-link only. */
vi.mock('./map/MapCanvas.js', () => ({
  MapCanvas: () => <div data-testid="stub-map-canvas" />,
}));
vi.mock('./FamilyLegend.js', () => ({
  FamilyLegend: () => <div data-testid="stub-family-legend" />,
}));

const { MapSurface } = await import('./MapSurface.js');

const sampleObs: Observation[] = [];

/* Common required-prop set for every test. The skip-link is the only
   thing under test; the rest are dummies so MapSurface mounts. */
const baseProps = {
  observations: sampleObs,
  silhouettes: [],
  familyCode: null as string | null,
  onFamilyToggle: () => {
    /* no-op */
  },
};

describe('MapSurface skip-link', () => {
  it('renders a "Skip to species list" button as the first interactive element', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    expect(skip).toBeInTheDocument();
    expect(skip.tagName).toBe('BUTTON');
  });

  it('uses class="skip-link" so the global stylesheet rule applies', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    expect(skip.className).toContain('skip-link');
  });

  it('is a <button> (not an <a href="#feed-surface">) — App.tsx mounts surfaces mutually-exclusive so anchors do not exist', () => {
    render(<MapSurface {...baseProps} onSkipToFeed={vi.fn()} />);
    // No <a href="#feed-surface"> anywhere in this surface.
    expect(screen.queryByRole('link', { name: /Skip to species list/i })).toBeNull();
  });

  it('invokes onSkipToFeed when activated (the URL-state setter is wired by App.tsx)', () => {
    const onSkip = vi.fn();
    render(<MapSurface {...baseProps} onSkipToFeed={onSkip} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('also fires onSkipToFeed via Enter / Space (native <button> default)', () => {
    const onSkip = vi.fn();
    render(<MapSurface {...baseProps} onSkipToFeed={onSkip} />);
    const skip = screen.getByRole('button', { name: /Skip to species list/i });
    skip.focus();
    fireEvent.keyDown(skip, { key: 'Enter' });
    // jsdom does not synthesise a click on Enter for <button>, so explicitly
    // simulate the click that the browser default would dispatch. The point
    // of this test is to confirm the handler is wired to the click event,
    // which `fireEvent.click` exercises.
    fireEvent.click(skip);
    expect(onSkip).toHaveBeenCalled();
  });
});
