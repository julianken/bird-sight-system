import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Photo } from './Photo.js';
import type { FamilyCode } from '../../config/family-palette.js';

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor', 'waterfowl', 'woodpecker', 'songbird',
  'shorebird', 'hummingbird', 'corvid',
];

describe('<Photo>', () => {
  // --- State: src = null (no photo) ---

  it('renders <FamilySilhouette> when src is null', () => {
    render(
      <Photo src={null} alt="Gila Woodpecker" family="woodpecker" />
    );
    // FamilySilhouette renders an SVG
    expect(document.querySelector('svg')).toBeInTheDocument();
    // No <img> tag
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders <FamilySilhouette> for all 7 family codes when src=null', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { unmount } = render(
        <Photo src={null} alt="Test bird" family={code} />
      );
      expect(document.querySelector('svg')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders null-family silhouette when src=null and family=null', () => {
    render(<Photo src={null} alt="Unknown bird" family={null} />);
    expect(document.querySelector('.family-silhouette--null-family')).toBeInTheDocument();
  });

  // --- State: src !== null, not yet loaded (loading skeleton) ---

  it('renders a skeleton rect before image loads', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    // Before onLoad fires, skeleton must be present
    expect(document.querySelector('.photo__skeleton')).toBeInTheDocument();
  });

  it('renders the img element in the DOM (hidden via CSS until loaded) before load', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    // img is in DOM so the browser can start fetching; CSS hides it until loaded
    expect(screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true })).toBeInTheDocument();
  });

  // --- State: src !== null, loaded ---

  it('removes skeleton and reveals img after onLoad fires', async () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
      />
    );
    const img = screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true });
    fireEvent.load(img);

    await waitFor(() => {
      expect(document.querySelector('.photo--loaded')).toBeInTheDocument();
    });
    expect(document.querySelector('.photo__skeleton')).not.toBeInTheDocument();
  });

  it('renders attribution overlay when loaded and attribution prop is present', async () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Curve-billed Thrasher"
        family="songbird"
        attribution={{ text: '© iNaturalist user', href: 'https://inaturalist.org/photos/1' }}
      />
    );
    const img = screen.getByRole('img', { name: 'Curve-billed Thrasher', hidden: true });
    fireEvent.load(img);

    await waitFor(() => {
      const link = screen.getByRole('link', { name: /iNaturalist user/i });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://inaturalist.org/photos/1');
    });
  });

  // --- State: src !== null, errored ---

  it('renders <FamilySilhouette> when image triggers onError', async () => {
    render(
      <Photo
        src="https://example.com/broken.jpg"
        alt="Broken bird photo"
        family="raptor"
      />
    );
    const img = screen.getByRole('img', { name: 'Broken bird photo', hidden: true });
    fireEvent.error(img);

    await waitFor(() => {
      expect(document.querySelector('svg')).toBeInTheDocument();
      expect(document.querySelector('img')).not.toBeInTheDocument();
    });
  });

  it('renders null-family silhouette on error when family=null', async () => {
    render(
      <Photo
        src="https://example.com/broken.jpg"
        alt="Unknown bird"
        family={null}
      />
    );
    const img = screen.getByRole('img', { name: 'Unknown bird', hidden: true });
    fireEvent.error(img);

    await waitFor(() => {
      expect(document.querySelector('.family-silhouette--null-family')).toBeInTheDocument();
    });
  });

  // --- Priority prop ---

  it('sets loading="eager" and fetchpriority="high" when priority=true', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="LCP bird"
        family="woodpecker"
        priority={true}
      />
    );
    const img = screen.getByRole('img', { name: 'LCP bird', hidden: true });
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
  });

  it('sets loading="lazy" by default (priority=false)', () => {
    render(
      <Photo
        src="https://example.com/bird.jpg"
        alt="Non-LCP bird"
        family="songbird"
      />
    );
    const img = screen.getByRole('img', { name: 'Non-LCP bird', hidden: true });
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  // --- Layout variants ---

  it('applies masthead layout class', () => {
    render(<Photo src={null} alt="Bird" family="raptor" layout="masthead" />);
    expect(document.querySelector('.photo--masthead')).toBeInTheDocument();
  });

  it('applies thumb layout class', () => {
    render(<Photo src={null} alt="Bird" family="raptor" layout="thumb" />);
    expect(document.querySelector('.photo--thumb')).toBeInTheDocument();
  });

  it('applies inline layout class by default', () => {
    render(<Photo src={null} alt="Bird" family="raptor" />);
    expect(document.querySelector('.photo--inline')).toBeInTheDocument();
  });
});
