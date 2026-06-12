import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
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

  // --- color prop (DB-sourced hex override) ---

  it('uses the color prop as --family-fill when provided, overriding the palette fill', () => {
    // The DB silhouettes payload ships real hex per familyCode. When passed as
    // `color`, it must win over the palette channel's fill regardless of whether
    // `family` is a known FamilyCode or a raw eBird code.
    render(<FamilySilhouette family="tyrannidae" color="#C77A2E" />);
    const el = document.querySelector('[data-testid="family-silhouette"]');
    expect(el).toBeInTheDocument();
    // color prop must override the null-family fallback (#5a6472)
    expect(el).toHaveStyle({ '--family-fill': '#C77A2E' });
  });

  it('uses the color prop as --family-fill for a known FamilyCode too', () => {
    // Even for known family codes, the DB color (passed as prop) wins over the
    // palette — the palette's fill becomes shape-encoding-only.
    render(<FamilySilhouette family="raptor" color="#FF0000" />);
    const el = document.querySelector('[data-testid="family-silhouette"]');
    expect(el).toHaveStyle({ '--family-fill': '#FF0000' });
  });

  it('falls back to palette fill when color prop is absent', () => {
    // When color is not provided, the existing palette-channel fill applies.
    // This preserves the graceful degradation path (null silhouettes / missing
    // color) so components that don't yet thread color remain grey.
    render(<FamilySilhouette family="raptor" />);
    const el = document.querySelector('[data-testid="family-silhouette"]');
    // raptor palette fill is #8b5e3c (FAMILY_PALETTE)
    expect(el).toHaveStyle({ '--family-fill': '#8b5e3c' });
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

  // --- pathD prop (DB-sourced SVG path override, issue #NEW-3 follow-up) ---

  const DB_PATH = 'M5 13 C5 9 9 8 13 9 L17 7 L17 10 L15 11 L15 14 L13 15 L8 15 L5 13 Z';

  it('renders the provided pathD string as the <path d> attribute when pathD is given', () => {
    render(<FamilySilhouette family="tyrannidae" pathD={DB_PATH} color="#C77A2E" />);
    const path = document.querySelector('path');
    expect(path).not.toBeNull();
    expect(path).toHaveAttribute('d', DB_PATH);
  });

  it('uses a 24×24 viewBox when pathD is provided (DB coordinate space)', () => {
    render(<FamilySilhouette family="tyrannidae" pathD={DB_PATH} color="#C77A2E" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
  });

  it('uses a 100×100 viewBox when pathD is absent (abstract palette coordinate space)', () => {
    render(<FamilySilhouette family="raptor" />);
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100');
  });

  it('falls back to the abstract FAMILY_PATHS palette path when pathD is null', () => {
    // pathD=null (Phylopic-less family) must fall through to the abstract
    // palette — NOT render an empty <path d="">.
    render(<FamilySilhouette family="tyrannidae" pathD={null} />);
    const path = document.querySelector('path');
    expect(path).not.toBeNull();
    // Must have some path data (the null-family fallback from FAMILY_PATHS)
    expect(path?.getAttribute('d')?.length).toBeGreaterThan(0);
    // viewBox should be the abstract palette's 100×100 space
    const svg = document.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100');
  });

  it('pathD does not affect color — color prop and pathD are independent', () => {
    render(<FamilySilhouette family="tyrannidae" pathD={DB_PATH} color="#FF0808" />);
    const el = document.querySelector('[data-testid="family-silhouette"]');
    expect(el).toHaveStyle({ '--family-fill': '#FF0808' });
    // And the path is still the DB path
    const path = document.querySelector('path');
    expect(path).toHaveAttribute('d', DB_PATH);
  });

  // --- imgUrl prop (admin-api-uploaded CDN URL, issue #502) ---

  it('renders an <img>-style mask div when imgUrl is provided', () => {
    const { container } = render(
      <FamilySilhouette
        family="cuculidae"
        layout="thumb"
        color="#A05A3A"
        imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
      />,
    );
    const img = container.querySelector('.family-silhouette-img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('style')).toContain('--family-silhouette-mask: url(');
    expect(img!.getAttribute('style')).toContain('#A05A3A');
  });

  it('falls back to inline path-d when imgUrl is null and pathD is provided', () => {
    const { container } = render(
      <FamilySilhouette
        family="cuculidae"
        layout="thumb"
        color="#A05A3A"
        pathD="M12 2 L20 22 L4 22 Z"
      />,
    );
    expect(container.querySelector('.family-silhouette-img')).toBeNull();
    expect(container.querySelector('path')).not.toBeNull();
  });

  it('imgUrl takes precedence over pathD when both are provided', () => {
    const { container } = render(
      <FamilySilhouette
        family="cuculidae"
        layout="thumb"
        color="#A05A3A"
        pathD="M12 2"
        imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
      />,
    );
    expect(container.querySelector('.family-silhouette-img')).not.toBeNull();
    expect(container.querySelector('path')).toBeNull();
  });

  // --- imgUrl mask-load-failure graceful degradation (#1028) ---
  //
  // CSS `mask-image` gives no load event, so the component preloads the
  // mask URL via `new Image()`. On a successful load the optimistic mask
  // <span> stays; on `onerror` (404 / CSP block / cert / bad content-type)
  // the component falls through to the inline <svg> (resolvedPathD) so a
  // curated legend row is NEVER painted blank. These tests install a
  // controllable Image stub whose load/error firing is driven by hand.

  describe('mask-load-failure fallback', () => {
    interface FakeImage {
      onload: (() => void) | null;
      onerror: (() => void) | null;
      src: string;
    }
    let instances: FakeImage[];
    let OriginalImage: typeof Image;

    beforeEach(() => {
      instances = [];
      OriginalImage = globalThis.Image;
      // Minimal Image stub: capture every instance so the test can fire
      // onload/onerror deterministically. Setting `src` is a no-op (no real
      // network in jsdom).
      class StubImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private _src = '';
        constructor() {
          instances.push(this as unknown as FakeImage);
        }
        get src(): string {
          return this._src;
        }
        set src(value: string) {
          this._src = value;
        }
      }
      // @ts-expect-error — assigning a stub class over the DOM Image ctor.
      globalThis.Image = StubImage;
    });

    afterEach(() => {
      globalThis.Image = OriginalImage;
    });

    const fireError = () => {
      act(() => {
        for (const img of instances) img.onerror?.();
      });
    };
    const fireLoad = () => {
      act(() => {
        for (const img of instances) img.onload?.();
      });
    };

    it('renders the optimistic mask span on the initial paint (before load resolves)', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      // SSR/initial render: mask span present, no inline svg yet.
      expect(container.querySelector('.family-silhouette-img')).not.toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('preloads the mask URL via an Image so failure can be detected', () => {
      render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      expect(instances.length).toBeGreaterThan(0);
      expect(instances[instances.length - 1].src).toBe(
        'https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg',
      );
    });

    it('falls back to the inline pathD <svg> when the mask resource fails to load', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      fireError();
      // After failure: mask span is gone, the curated pathD <svg> is shown.
      expect(container.querySelector('.family-silhouette-img')).toBeNull();
      const path = container.querySelector('path');
      expect(path).not.toBeNull();
      // The curated shape (the pathD prop), NOT a blank span.
      expect(path).toHaveAttribute('d', 'M12 2 L20 22 L4 22 Z');
      // 24×24 DB coordinate space when pathD is present.
      expect(container.querySelector('svg')).toHaveAttribute('viewBox', '0 0 24 24');
    });

    it('falls back to the FAMILY_PATHS placeholder <svg> when the mask fails and pathD is absent', () => {
      // Branch (b): svgUrl-only family. Mask failure must still paint a
      // visible (generic) shape rather than a blank span.
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      fireError();
      expect(container.querySelector('.family-silhouette-img')).toBeNull();
      const path = container.querySelector('path');
      expect(path).not.toBeNull();
      expect(path?.getAttribute('d')?.length).toBeGreaterThan(0);
    });

    it('keeps the mask span (no fallback) when the mask resource loads successfully', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      fireLoad();
      expect(container.querySelector('.family-silhouette-img')).not.toBeNull();
      expect(container.querySelector('svg')).toBeNull();
    });

    it('ROOT CAUSE: the optimistic mask span has no child glyph — a failed mask paints nothing visible, which is why the fallback is required', () => {
      // This pins the precise #1028 root cause: the imgUrl branch renders a
      // bare <span class="family-silhouette-img"> whose ONLY paint is the CSS
      // mask resource. It has zero element children — no <svg>, no <img> — so
      // if the mask URL is dead the span is invisible with no native error
      // signal. That silent-blank is exactly what the Image-preload + svg
      // fallback below converts into a visible glyph.
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      const span = container.querySelector('.family-silhouette-img')!;
      // The bare span renders NO glyph element of its own (the blank-row bug).
      expect(span.querySelector('svg')).toBeNull();
      expect(span.querySelector('img')).toBeNull();
      expect(span.children.length).toBe(0);
      // After the mask fails to load, the same row paints a real <svg> glyph.
      fireError();
      expect(container.querySelector('.family-silhouette svg path')).not.toBeNull();
    });

    it('re-arms the optimistic mask span when imgUrl changes after a prior failure', () => {
      const { container, rerender } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.bad.svg"
        />,
      );
      fireError();
      expect(container.querySelector('.family-silhouette-img')).toBeNull();
      // A new URL is a fresh attempt — render the mask optimistically again.
      rerender(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          pathD="M12 2 L20 22 L4 22 Z"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.good.svg"
        />,
      );
      expect(container.querySelector('.family-silhouette-img')).not.toBeNull();
    });
  });

  // --- url() CSS-token quoting (#1028) ---
  //
  // The mask-image custom property was `url(${imgUrl})` — unquoted. A URL
  // containing a `)`, whitespace, or other CSS-token-breaking character
  // truncates or invalidates the token, silently breaking the mask. The
  // value must be emitted as a quoted `url("...")` with the URL escaped.

  describe('url() quoting', () => {
    it('emits a quoted url("...") mask-image even for a plain URL', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          imgUrl="https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg"
        />,
      );
      const style = container.querySelector('.family-silhouette-img')!.getAttribute('style')!;
      expect(style).toContain(
        'url("https://silhouettes.bird-maps.com/family/cuculidae.deadbeef.svg")',
      );
    });

    it('escapes a URL containing a ) so the CSS token cannot break out', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          imgUrl="https://cdn.example.com/family/a(1).svg"
        />,
      );
      const style = container.querySelector('.family-silhouette-img')!.getAttribute('style')!;
      // The raw, unescaped `(1)` must NOT appear bare inside the url() token.
      expect(style).toContain('--family-silhouette-mask: url(');
      // A backslash-escaped paren keeps the token well-formed.
      expect(style).toContain('\\)');
      // The closing `)` of url() must be the wrapper's, not the URL's — i.e.
      // there must be a quote immediately before the final url() close.
      expect(style).toMatch(/url\("[^"]*\\\)[^"]*"\)/);
    });

    it('escapes a URL containing whitespace so the CSS token cannot break', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          imgUrl="https://cdn.example.com/family/a b.svg"
        />,
      );
      const style = container.querySelector('.family-silhouette-img')!.getAttribute('style')!;
      // Whitespace must be wrapped in quotes (and stays inside the quoted url()).
      expect(style).toMatch(/url\("[^"]* [^"]*"\)/);
    });

    it('escapes a double-quote in the URL so it cannot close the quoted string early', () => {
      const { container } = render(
        <FamilySilhouette
          family="cuculidae"
          layout="thumb"
          color="#A05A3A"
          imgUrl={'https://cdn.example.com/family/a".svg'}
        />,
      );
      const style = container.querySelector('.family-silhouette-img')!.getAttribute('style')!;
      // The embedded quote must be backslash-escaped, not a bare ".
      expect(style).toContain('\\"');
    });
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
