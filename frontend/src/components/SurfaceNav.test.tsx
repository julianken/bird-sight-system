import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurfaceNav } from './SurfaceNav.js';

// Issue #662: Feed removed from SurfaceNav (legacy duplicate of AppHeader's
// TABS). Tests rewritten to cover the 2-tab [Map, Species] order.

describe('SurfaceNav', () => {
  it('renders two tabs with the active one marked aria-selected="true"', () => {
    render(<SurfaceNav activeView="map" onSelectView={() => {}} />);

    const tablist = screen.getByRole('tablist', { name: 'Surface' });
    expect(tablist).toBeInTheDocument();

    const speciesTab = screen.getByRole('tab', { name: 'Species view' });
    const mapTab = screen.getByRole('tab', { name: 'Map view' });

    expect(mapTab).toHaveAttribute('aria-selected', 'true');
    expect(speciesTab).toHaveAttribute('aria-selected', 'false');
  });

  it('does not render a Feed tab (issue #662)', () => {
    render(<SurfaceNav activeView="map" onSelectView={() => {}} />);
    expect(screen.queryByRole('tab', { name: 'Feed view' })).toBeNull();
  });

  it('renders tabs in [Map, Species] order', () => {
    render(<SurfaceNav activeView="map" onSelectView={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.getAttribute('aria-label'))).toEqual([
      'Map view',
      'Species view',
    ]);
  });

  it('tracks aria-selected as activeView changes', () => {
    const { rerender } = render(
      <SurfaceNav activeView="map" onSelectView={() => {}} />
    );
    expect(screen.getByRole('tab', { name: 'Species view' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    rerender(<SurfaceNav activeView="species" onSelectView={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Species view' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Map view' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('associates each tab with the main surface via aria-controls', () => {
    render(<SurfaceNav activeView="map" onSelectView={() => {}} />);
    for (const name of ['Map view', 'Species view']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab).toHaveAttribute('aria-controls', 'main-surface');
    }
  });

  it('fires onSelectView when a non-active tab is clicked', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="map" onSelectView={onSelectView} />);
    await user.click(screen.getByRole('tab', { name: 'Species view' }));
    expect(onSelectView).toHaveBeenCalledWith('species');
  });

  it('does not fire onSelectView when the active tab is clicked', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);
    await user.click(screen.getByRole('tab', { name: 'Species view' }));
    expect(onSelectView).not.toHaveBeenCalled();
  });

  it('active tab has tabindex=0; inactive tabs have tabindex=-1 (roving tabindex)', () => {
    render(<SurfaceNav activeView="species" onSelectView={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Map view' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Species view' })).toHaveAttribute('tabindex', '0');
  });

  it('ArrowRight on the active tab moves focus AND fires onSelectView with the next value', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="map" onSelectView={onSelectView} />);

    const mapTab = screen.getByRole('tab', { name: 'Map view' });
    mapTab.focus();
    expect(mapTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('species');
    expect(screen.getByRole('tab', { name: 'Species view' })).toHaveFocus();
  });

  it('ArrowLeft on the active tab moves focus AND fires onSelectView with the previous value', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);

    const speciesTab = screen.getByRole('tab', { name: 'Species view' });
    speciesTab.focus();

    await user.keyboard('{ArrowLeft}');
    expect(onSelectView).toHaveBeenCalledWith('map');
    expect(screen.getByRole('tab', { name: 'Map view' })).toHaveFocus();
  });

  it('ArrowRight wraps from the last tab to the first', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);

    const speciesTab = screen.getByRole('tab', { name: 'Species view' });
    speciesTab.focus();

    await user.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('map');
    expect(screen.getByRole('tab', { name: 'Map view' })).toHaveFocus();
  });

  it('ArrowLeft wraps from the first tab to the last', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="map" onSelectView={onSelectView} />);

    const mapTab = screen.getByRole('tab', { name: 'Map view' });
    mapTab.focus();

    await user.keyboard('{ArrowLeft}');
    expect(onSelectView).toHaveBeenCalledWith('species');
    expect(screen.getByRole('tab', { name: 'Species view' })).toHaveFocus();
  });

  it('Enter on a focused tab activates it', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);

    const mapTab = screen.getByRole('tab', { name: 'Map view' });
    mapTab.focus();
    await user.keyboard('{Enter}');
    expect(onSelectView).toHaveBeenCalledWith('map');
  });

  it('Space on a focused tab activates it', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="map" onSelectView={onSelectView} />);

    const speciesTab = screen.getByRole('tab', { name: 'Species view' });
    speciesTab.focus();
    await user.keyboard(' ');
    expect(onSelectView).toHaveBeenCalledWith('species');
  });
});
