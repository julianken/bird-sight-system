import { describe, it, expect } from 'vitest';
import { assessDeterministic } from './deterministic.js';
import { defaultRubricConfig } from './rubric.config.js';
import { flatPng, checkerboardJpeg, clippedWhitePng } from './fixtures.js';

const det = defaultRubricConfig.deterministic;

describe('assessDeterministic', () => {
  it('reports dimensions, megapixels and aspect ratio', async () => {
    const img = await checkerboardJpeg(1000, 800);
    const r = await assessDeterministic(img, det);
    expect(r.width).toBe(1000);
    expect(r.height).toBe(800);
    expect(r.megapixels).toBeCloseTo(0.8, 2);
    expect(r.aspectRatio).toBeCloseTo(1.25, 2);
  });

  it('scores a sharp checkerboard high and a flat image near zero', async () => {
    const sharpImg = await assessDeterministic(await checkerboardJpeg(600, 600), det);
    const flatImg = await assessDeterministic(await flatPng(600, 600), det);
    expect(sharpImg.sharpness).toBeGreaterThan(flatImg.sharpness);
    expect(flatImg.sharpness).toBeLessThan(0.05);
  });

  it('penalizes exposure on a clipped (all-white) image', async () => {
    const clipped = await assessDeterministic(await clippedWhitePng(600, 600), det);
    const mid = await assessDeterministic(await checkerboardJpeg(600, 600), det);
    expect(clipped.exposure).toBeLessThan(mid.exposure);
    expect(clipped.exposure).toBeLessThan(0.6);
  });

  it('fails the gate below minMegapixels and records a reason', async () => {
    const tiny = await assessDeterministic(await checkerboardJpeg(200, 200), det); // 0.04 MP
    expect(tiny.passedGate).toBe(false);
    expect(tiny.failReasons).toContain('below-min-megapixels');
  });

  it('fails the gate on an out-of-range aspect ratio', async () => {
    const pano = await assessDeterministic(await checkerboardJpeg(2000, 300), det); // 6.67:1
    expect(pano.passedGate).toBe(false);
    expect(pano.failReasons).toContain('aspect-out-of-range');
  });

  it('fails the gate below minSharpness and records a reason', async () => {
    const flat = await assessDeterministic(await flatPng(1200, 1000), det); // big but flat
    expect(flat.passedGate).toBe(false);
    expect(flat.failReasons).toContain('below-min-sharpness');
  });

  it('passes the gate for a large, sharp, in-range image', async () => {
    const good = await assessDeterministic(await checkerboardJpeg(1200, 1000), det);
    expect(good.passedGate).toBe(true);
    expect(good.failReasons).toEqual([]);
  });
});
