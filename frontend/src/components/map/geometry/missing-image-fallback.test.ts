import { describe, it, expect, vi } from 'vitest';
import {
  registerMissingImageFallback,
  type MissingImageMap,
} from './missing-image-fallback.js';

/* ── structural map spy (no WebGL) ────────────────────────────────────────
   Same idiom as silhouette-sprite.test.ts / artboard-layers.test.ts: a tiny
   object exposing only the surface registerMissingImageFallback consumes
   (on / hasImage / addImage), with a backing Set so hasImage reflects what
   addImage registered. `fireMissing(id)` invokes the captured listener. */
function makeFakeMap(opts: { preregistered?: string[] } = {}) {
  const registered = new Set<string>(opts.preregistered ?? []);
  let captured: ((e: { id: string }) => void) | null = null;

  const addImage = vi.fn(
    (id: string, _img: { width: number; height: number; data: Uint8Array }) => {
      registered.add(id);
    },
  );
  const hasImage = vi.fn((id: string) => registered.has(id));
  const on = vi.fn(
    (_type: 'styleimagemissing', listener: (e: { id: string }) => void) => {
      captured = listener;
    },
  );

  const map: MissingImageMap = { hasImage, addImage, on };
  return {
    map,
    addImage,
    hasImage,
    on,
    fireMissing: (id: string) => {
      if (!captured) throw new Error('listener not registered');
      captured({ id });
    },
  };
}

describe('registerMissingImageFallback (#947)', () => {
  it('subscribes exactly one styleimagemissing listener', () => {
    const fake = makeFakeMap();
    registerMissingImageFallback(fake.map);
    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.on).toHaveBeenCalledWith('styleimagemissing', expect.any(Function));
  });

  it('adds a 1×1 transparent image for a missing id', () => {
    const fake = makeFakeMap();
    registerMissingImageFallback(fake.map);

    fake.fireMissing('circle-11');

    expect(fake.addImage).toHaveBeenCalledTimes(1);
    const [id, image] = fake.addImage.mock.calls[0]!;
    expect(id).toBe('circle-11');
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    // RGBA, all-zero ⇒ alpha 0 ⇒ fully transparent.
    expect(image.data).toBeInstanceOf(Uint8Array);
    expect(image.data).toHaveLength(4);
    expect(Array.from(image.data)).toEqual([0, 0, 0, 0]);
  });

  it('handles ANY missing id (structural, not circle-11-specific)', () => {
    const fake = makeFakeMap();
    registerMissingImageFallback(fake.map);

    fake.fireMissing('some-other-sprite');

    expect(fake.addImage).toHaveBeenCalledTimes(1);
    expect(fake.addImage.mock.calls[0]![0]).toBe('some-other-sprite');
  });

  it('is a no-op when hasImage is already true (no double-add)', () => {
    const fake = makeFakeMap({ preregistered: ['circle-11'] });
    registerMissingImageFallback(fake.map);

    fake.fireMissing('circle-11');

    expect(fake.hasImage).toHaveBeenCalledWith('circle-11');
    expect(fake.addImage).not.toHaveBeenCalled();
  });

  it('does not re-add the same id on a repeat fire (the first add flips hasImage)', () => {
    const fake = makeFakeMap();
    registerMissingImageFallback(fake.map);

    fake.fireMissing('circle-11');
    fake.fireMissing('circle-11');

    expect(fake.addImage).toHaveBeenCalledTimes(1);
  });
});
