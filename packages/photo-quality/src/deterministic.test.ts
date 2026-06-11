import { describe, it, expect } from 'vitest';
import { assessDeterministic } from './deterministic.js';
import { defaultRubricConfig } from './rubric.config.js';
import { flatPng, checkerboardJpeg, clippedWhitePng, noiseJpeg } from './fixtures.js';

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

  // Regression for the #969 follow-up: the deterministic floors were recalibrated
  // (0.3→0.05 MP, 0.005→0.00005 sharpness) after measuring that bird-maps.com
  // serves a uniform 500px-long-edge catalog (0.12–0.22 MP, 0.0002–0.002 sharpness).
  // The old floors rejected 100% of the real catalog before it ever reached the
  // Opus judge; quality (softness/distance/framing) is the judge's job now, so the
  // gate must only reject genuinely BROKEN files.
  it('passes the gate for a real-resolution 500px photo with high-frequency content', async () => {
    // 500×375 = 0.1875 MP, mid of the measured catalog; per-pixel noise gives the
    // high sharpness a real photo has. Under the OLD 0.3 MP / 0.005 floors this
    // fails on both — the production bug. Under the recalibrated floors it passes.
    const photo = await assessDeterministic(await noiseJpeg(500, 375), det);
    expect(photo.passedGate).toBe(true);
    expect(photo.failReasons).not.toContain('below-min-megapixels');
    expect(photo.failReasons).not.toContain('below-min-sharpness');
    expect(photo.failReasons).toEqual([]);
  });

  it('still gates a genuinely tiny image below the recalibrated megapixel floor', async () => {
    // ~200×120 = 0.024 MP, below the new 0.05 floor — a broken/microscopic download.
    const tiny = await assessDeterministic(await noiseJpeg(200, 120), det);
    expect(tiny.passedGate).toBe(false);
    expect(tiny.failReasons).toContain('below-min-megapixels');
  });

  it('still gates a flat solid-color image below the recalibrated sharpness floor', async () => {
    // 500×375 catalog-sized but flat → ~zero variance-of-Laplacian; a blank/solid
    // (corrupt or empty) render must still gate even at real resolution.
    const blank = await assessDeterministic(await flatPng(500, 375), det);
    expect(blank.passedGate).toBe(false);
    expect(blank.failReasons).toContain('below-min-sharpness');
  });
});
