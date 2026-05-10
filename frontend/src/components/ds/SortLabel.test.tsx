import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SortLabel } from './SortLabel.js';

describe('<SortLabel>', () => {
  it('renders the sort string when provided', () => {
    render(<SortLabel label="Sorted by recency" />);
    expect(screen.getByText('Sorted by recency')).toBeInTheDocument();
  });

  it('renders nothing when label is empty string', () => {
    const { container } = render(<SortLabel label="" />);
    expect(container.querySelector('.sort-label')).not.toBeInTheDocument();
  });

  it('renders nothing when label is undefined', () => {
    const { container } = render(<SortLabel />);
    expect(container.querySelector('.sort-label')).not.toBeInTheDocument();
  });
});
