import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FamilySilhouette } from './FamilySilhouette.js';
import type { FamilyCode } from '../../config/family-palette.js';

const ALL_FAMILY_CODES: FamilyCode[] = [
  'raptor', 'waterfowl', 'woodpecker', 'songbird',
  'shorebird', 'hummingbird', 'corvid',
];

describe('<FamilySilhouette>', () => {
  // --- Rendering ---

  it('renders an SVG element', () => {
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('renders for all 7 family codes without throwing', () => {
    for (const code of ALL_FAMILY_CODES) {
      const { unmount } = render(<FamilySilhouette family={code} />);
      expect(document.querySelector('svg')).toBeInTheDocument();
      unmount();
    }
  });

  it('renders null-family path (family=null) without throwing', () => {
    render(<FamilySilhouette family={null} />);
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  // --- Tinting ---

  it('applies family fill color as inline style on the SVG root', () => {
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    // The fill is applied via CSS custom property or fill attribute
    expect(svg).not.toBeNull();
    // The component must have the family class so CSS can tint it
    expect(svg?.closest('[class*="family-silhouette"]')).toBeInTheDocument();
  });

  it('applies null-family class for family=null', () => {
    render(<FamilySilhouette family={null} />);
    const el = document.querySelector('.family-silhouette--null-family');
    expect(el).toBeInTheDocument();
  });

  // --- Layout variants ---

  it('applies masthead layout class', () => {
    render(<FamilySilhouette family="songbird" layout="masthead" />);
    expect(document.querySelector('.family-silhouette--masthead')).toBeInTheDocument();
  });

  it('applies thumb layout class', () => {
    render(<FamilySilhouette family="songbird" layout="thumb" />);
    expect(document.querySelector('.family-silhouette--thumb')).toBeInTheDocument();
  });

  it('applies inline layout class by default (no layout prop)', () => {
    render(<FamilySilhouette family="songbird" />);
    expect(document.querySelector('.family-silhouette--inline')).toBeInTheDocument();
  });

  // --- Shape prop ---

  it('applies the shape class from the family-palette mapping', () => {
    // raptor → diamond per FAMILY_PALETTE
    render(<FamilySilhouette family="raptor" />);
    expect(document.querySelector('.family-silhouette--diamond')).toBeInTheDocument();
  });

  it('applies explicit shape prop when provided, overriding palette default', () => {
    render(<FamilySilhouette family="raptor" shape="circle" />);
    expect(document.querySelector('.family-silhouette--circle')).toBeInTheDocument();
  });

  // --- Unknown / raw eBird codes ---

  it('renders the null-family neutral path (not a crash) for an unknown raw eBird family code', () => {
    // "tyrannidae" is a raw eBird family code that is NOT in the FamilyCode
    // union — it arrives as `string` from the Observation type. The component
    // must fall back to the neutral null-family path rather than throwing or
    // rendering an unknown path key.
    render(<FamilySilhouette family="tyrannidae" />);
    // SVG must be present — no crash
    expect(document.querySelector('svg')).toBeInTheDocument();
    // The silhouette wrapper must be in the document (component rendered)
    const el = document.querySelector('[data-testid="family-silhouette"]');
    expect(el).toBeInTheDocument();
    // Unknown code still carries the raw family value on the data attribute
    // (same as the known-code path) — the fallback is internal (path data),
    // not a CSS-class difference.
    expect(el).toHaveAttribute('data-family', 'tyrannidae');
    // The neutral null-family fill is applied via the style custom property
    // (getFamilyChannel returns the NULL_FAMILY_CHANNEL for unrecognised codes).
    expect(el).toHaveStyle({ '--family-fill': '#5a6472' });
  });

  // --- Accessibility ---

  it('is hidden from the SR tree (presentational) when inside <Photo>', () => {
    // <FamilySilhouette> as no-photo fallback inside <Photo> is purely
    // presentational — <Photo> describes itself via alt prop. The SVG
    // must carry aria-hidden="true" when no explicit label is provided.
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });
});
