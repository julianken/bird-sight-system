import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import {
  silhouettePathToSvg,
  registerSilhouetteSprite,
  type SpriteMap,
} from './silhouette-sprite.js';

/* ── jsdom shims ──────────────────────────────────────────────────────────
   jsdom ships `Blob` natively but NOT `URL.createObjectURL`/`revokeObjectURL`
   nor a usable `HTMLImageElement.prototype.decode`. `registerSilhouetteSprite`
   exercises all three, so stub them once for the suite. Mirrors the FakeImage /
   createObjectURL block in MapCanvas.test.tsx so the two suites agree on the
   environment contract (no real decode, deterministic blob: URL). */
class FakeImage {
  src = '';
  width = 64;
  height = 64;
  decode(): Promise<void> {
    return Promise.resolve();
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Image = FakeImage;
  if (typeof URL.createObjectURL === 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).createObjectURL = vi.fn(() => 'blob:fake-url');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (URL as any).revokeObjectURL = vi.fn();
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── silhouettePathToSvg — pure data transform ───────────────────────────── */

describe('silhouettePathToSvg', () => {
  it('wraps a valid path-d string in a 24-viewBox black-fill SVG document', () => {
    const svg = silhouettePathToSvg('M12 4 L20 20 Z', 'tyrannidae');
    expect(svg).not.toBeNull();
    // viewBox is the 24-unit coordinate space the migration ships.
    expect(svg).toContain('viewBox="0 0 24 24"');
    // fill="black" is load-bearing: it produces the single-channel alpha mask
    // the SDF tinter recolors via the symbol layer's icon-color paint property.
    expect(svg).toContain('fill="black"');
    // The path-d is interpolated verbatim into the <path> element.
    expect(svg).toContain('<path d="M12 4 L20 20 Z" fill="black"/>');
    expect(svg).toMatch(/^<svg /);
    expect(svg).toMatch(/<\/svg>$/);
  });

  it('returns null when svgData fails the #271 charset guard (XSS-shaped input)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A literal `"` + `<script>` would corrupt the surrounding SVG document and,
    // worse, open an XSS surface if ever rendered through innerHTML (#271).
    const svg = silhouettePathToSvg('M12 4 "<script>alert(1)</script>', 'badfam');
    expect(svg).toBeNull();
    // The caller relies on a warn naming the family code for diagnosis.
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain('badfam');
  });
});

/* ── registerSilhouetteSprite — imperative map-sync helper ────────────────── */

/**
 * A spy `SpriteMap` backed by an in-memory image registry. Mirrors the minimal
 * structural surface `registerSilhouetteSprite` consumes (addImage / hasImage)
 * — never maplibre's full Map, so the helper unit-tests with no WebGL.
 */
function makeSpriteMap(preregistered: string[] = []) {
  const registered = new Set<string>(preregistered);
  const addImage = vi.fn(
    (id: string, _img: HTMLImageElement, _opts?: { sdf?: boolean }) => {
      registered.add(id);
    },
  );
  const hasImage = vi.fn((id: string) => registered.has(id));
  const map: SpriteMap = { addImage, hasImage };
  return { map, addImage, hasImage };
}

describe('registerSilhouetteSprite', () => {
  it('registers the sprite via addImage with { sdf: true }', async () => {
    const { map, addImage, hasImage } = makeSpriteMap();
    await registerSilhouetteSprite(map, 'tyrannidae', 'M12 4 L20 20 Z');
    expect(hasImage).toHaveBeenCalledWith('tyrannidae');
    expect(addImage).toHaveBeenCalledOnce();
    const [id, img, opts] = addImage.mock.calls[0];
    expect(id).toBe('tyrannidae');
    expect(img).toBeInstanceOf(FakeImage);
    // sdf:true is the whole point — the sprite is a colorless alpha mask the
    // layer tints later. Registration must never bake in a color.
    expect(opts).toEqual({ sdf: true });
  });

  it('short-circuits (no addImage) when the sprite id is already registered', async () => {
    const { map, addImage, hasImage } = makeSpriteMap(['tyrannidae']);
    await registerSilhouetteSprite(map, 'tyrannidae', 'M12 4 L20 20 Z');
    expect(hasImage).toHaveBeenCalledWith('tyrannidae');
    expect(addImage).not.toHaveBeenCalled();
  });

  it('is a no-op (no addImage) when svgData fails the charset guard', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { map, addImage, hasImage } = makeSpriteMap();
    await registerSilhouetteSprite(map, 'badfam', 'M12 4 "<script>');
    // silhouettePathToSvg returns null → we never touch the map at all.
    expect(addImage).not.toHaveBeenCalled();
    expect(hasImage).not.toHaveBeenCalled();
  });
});
