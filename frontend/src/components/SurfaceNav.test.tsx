import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SurfaceNav } from './SurfaceNav.js';

describe('SurfaceNav', () => {
  it('renders three tabs with the active one marked aria-selected="true"', () => {
    render(<SurfaceNav activeView="feed" onSelectView={() => {}} />);

    const tablist = screen.getByRole('tablist', { name: 'Surface' });
    expect(tablist).toBeInTheDocument();

    const feedTab = screen.getByRole('tab', { name: 'Feed' });
    const speciesTab = screen.getByRole('tab', { name: 'Species' });
    const hotspotsTab = screen.getByRole('tab', { name: 'Hotspots' });

    expect(feedTab).toHaveAttribute('aria-selected', 'true');
    expect(speciesTab).toHaveAttribute('aria-selected', 'false');
    expect(hotspotsTab).toHaveAttribute('aria-selected', 'false');
  });

  it('tracks aria-selected as activeView changes', () => {
    const { rerender } = render(
      <SurfaceNav activeView="feed" onSelectView={() => {}} />
    );
    expect(screen.getByRole('tab', { name: 'Species' })).toHaveAttribute(
      'aria-selected',
      'false'
    );

    rerender(<SurfaceNav activeView="species" onSelectView={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Feed' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.getByRole('tab', { name: 'Species' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Hotspots' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('associates each tab with the main surface via aria-controls', () => {
    render(<SurfaceNav activeView="feed" onSelectView={() => {}} />);
    for (const name of ['Feed', 'Species', 'Hotspots']) {
      const tab = screen.getByRole('tab', { name });
      expect(tab).toHaveAttribute('aria-controls', 'main-surface');
    }
  });

  it('fires onSelectView when a non-active tab is clicked', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="feed" onSelectView={onSelectView} />);
    await user.click(screen.getByRole('tab', { name: 'Species' }));
    expect(onSelectView).toHaveBeenCalledWith('species');
  });

  it('does not fire onSelectView when the active tab is clicked', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);
    await user.click(screen.getByRole('tab', { name: 'Species' }));
    expect(onSelectView).not.toHaveBeenCalled();
  });

  it('active tab has tabindex=0; inactive tabs have tabindex=-1 (roving tabindex)', () => {
    render(<SurfaceNav activeView="species" onSelectView={() => {}} />);
    expect(screen.getByRole('tab', { name: 'Feed' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('tab', { name: 'Species' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Hotspots' })).toHaveAttribute('tabindex', '-1');
  });

  it('ArrowRight on the active tab moves focus AND fires onSelectView with the next value', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="feed" onSelectView={onSelectView} />);

    const feedTab = screen.getByRole('tab', { name: 'Feed' });
    feedTab.focus();
    expect(feedTab).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('species');
    expect(screen.getByRole('tab', { name: 'Species' })).toHaveFocus();
  });

  it('ArrowLeft on the active tab moves focus AND fires onSelectView with the previous value', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="species" onSelectView={onSelectView} />);

    const speciesTab = screen.getByRole('tab', { name: 'Species' });
    speciesTab.focus();

    await user.keyboard('{ArrowLeft}');
    expect(onSelectView).toHaveBeenCalledWith('feed');
    expect(screen.getByRole('tab', { name: 'Feed' })).toHaveFocus();
  });

  it('ArrowRight wraps from the last tab to the first', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="hotspots" onSelectView={onSelectView} />);

    const hotspotsTab = screen.getByRole('tab', { name: 'Hotspots' });
    hotspotsTab.focus();

    await user.keyboard('{ArrowRight}');
    expect(onSelectView).toHaveBeenCalledWith('feed');
    expect(screen.getByRole('tab', { name: 'Feed' })).toHaveFocus();
  });

  it('ArrowLeft wraps from the first tab to the last', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="feed" onSelectView={onSelectView} />);

    const feedTab = screen.getByRole('tab', { name: 'Feed' });
    feedTab.focus();

    await user.keyboard('{ArrowLeft}');
    expect(onSelectView).toHaveBeenCalledWith('hotspots');
    expect(screen.getByRole('tab', { name: 'Hotspots' })).toHaveFocus();
  });

  it('Enter on a focused tab activates it', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="feed" onSelectView={onSelectView} />);

    const hotspotsTab = screen.getByRole('tab', { name: 'Hotspots' });
    hotspotsTab.focus();
    await user.keyboard('{Enter}');
    expect(onSelectView).toHaveBeenCalledWith('hotspots');
  });

  it('Space on a focused tab activates it', async () => {
    const onSelectView = vi.fn();
    const user = userEvent.setup();
    render(<SurfaceNav activeView="feed" onSelectView={onSelectView} />);

    const speciesTab = screen.getByRole('tab', { name: 'Species' });
    speciesTab.focus();
    await user.keyboard(' ');
    expect(onSelectView).toHaveBeenCalledWith('species');
  });
});
