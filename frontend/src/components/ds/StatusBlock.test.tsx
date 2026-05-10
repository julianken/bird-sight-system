import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatusBlock } from './StatusBlock.js';

describe('<StatusBlock>', () => {
  // --- State: loading ---

  it('renders role="status" aria-live="polite" container in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('renders title text in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    expect(screen.getByText('Loading observations…')).toBeInTheDocument();
  });

  it('renders an indeterminate <progress> in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    const progress = document.querySelector('progress');
    expect(progress).toBeInTheDocument();
    // Indeterminate: no value attribute
    expect(progress).not.toHaveAttribute('value');
  });

  it('renders a skeleton rect in loading state', () => {
    render(<StatusBlock state="loading" title="Loading observations…" />);
    expect(document.querySelector('.status-block__skeleton')).toBeInTheDocument();
  });

  // --- State: empty ---

  it('renders title and optional body in empty state', () => {
    render(
      <StatusBlock
        state="empty"
        title="No sightings match your filters."
        body="Try widening the time window or turning off Notable only."
      />
    );
    expect(screen.getByText('No sightings match your filters.')).toBeInTheDocument();
    expect(
      screen.getByText('Try widening the time window or turning off Notable only.')
    ).toBeInTheDocument();
  });

  it('renders optional action button in empty state', async () => {
    const onClick = vi.fn();
    render(
      <StatusBlock
        state="empty"
        title="No results."
        action={{ label: 'Clear filters', onClick }}
      />
    );
    const button = screen.getByRole('button', { name: 'Clear filters' });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('does NOT render an action button when action prop is absent', () => {
    render(<StatusBlock state="empty" title="No results." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // --- State: error ---

  it('renders error state with alert tone by default', () => {
    render(
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body="The data service is temporarily unavailable. Try again in a moment."
      />
    );
    const container = document.querySelector('.status-block');
    expect(container).toHaveClass('status-block--tone-alert');
  });

  it('does NOT render raw error.message in error state', () => {
    // The contract: StatusBlock never passes raw error.message. This test
    // asserts the component renders provided title+body, not something injected.
    render(
      <StatusBlock
        state="error"
        title="Couldn't load bird data"
        body="The data service is temporarily unavailable."
      />
    );
    // Only the declared title and body appear; nothing injected
    expect(screen.getByText("Couldn't load bird data")).toBeInTheDocument();
    expect(
      screen.getByText('The data service is temporarily unavailable.')
    ).toBeInTheDocument();
    // No raw JS error strings should appear
    expect(screen.queryByText(/TypeError|Error:|at \w/)).not.toBeInTheDocument();
  });

  // --- Surface variants ---

  it('applies surface modifier class for "page" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="page" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-page');
  });

  it('applies surface modifier class for "panel" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="panel" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-panel');
  });

  it('applies surface modifier class for "modal" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="modal" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-modal');
  });

  it('applies surface modifier class for "list" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="list" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-list');
  });

  it('applies surface modifier class for "overlay" surface', () => {
    render(<StatusBlock state="loading" title="Loading…" surface="overlay" />);
    expect(document.querySelector('.status-block')).toHaveClass('status-block--surface-overlay');
  });

  // --- Tone override ---

  it('applies subtle tone class when tone="subtle" is explicit on error state', () => {
    render(
      <StatusBlock state="error" title="Error" tone="subtle" />
    );
    expect(document.querySelector('.status-block')).toHaveClass('status-block--tone-subtle');
  });
});
