import sharp from 'sharp';
import type { ImageInput } from './types.js';

/**
 * Build a flat-color raw image and encode it. A flat color has ~zero
 * variance-of-Laplacian → near-zero sharpness, exercising the low-sharpness
 * gate branch deterministically.
 */
export async function flatPng(
  width: number,
  height: number,
  rgb: [number, number, number] = [120, 120, 120],
): Promise<ImageInput> {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: rgb[0], g: rgb[1], b: rgb[2] },
    },
  })
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png' };
}

/**
 * Build a high-frequency checkerboard → high variance-of-Laplacian → high
 * sharpness, exercising the gate's pass branch and a sharp-image score.
 */
export async function checkerboardJpeg(
  width: number,
  height: number,
  cell = 4,
): Promise<ImageInput> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = on ? 255 : 0;
      const i = (y * width + x) * channels;
      raw[i] = v;
      raw[i + 1] = v;
      raw[i + 2] = v;
    }
  }
  const buffer = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return { buffer, mime: 'image/jpeg' };
}

/**
 * Build a near-fully-white image → heavy highlight clipping → low exposure
 * score, exercising the exposure-penalty branch.
 */
export async function clippedWhitePng(
  width: number,
  height: number,
): Promise<ImageInput> {
  return flatPng(width, height, [255, 255, 255]);
}

/**
 * Build a per-pixel random-noise JPEG → very high variance-of-Laplacian →
 * high sharpness. Models a real photo's high-frequency content (the live
 * 500px catalog), as opposed to the synthetic regular checkerboard, so the
 * deterministic gate's pass branch is exercised at the actual served
 * resolution. `seed` makes the noise deterministic across runs.
 */
export async function noiseJpeg(
  width: number,
  height: number,
  seed = 1,
): Promise<ImageInput> {
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  // Tiny deterministic LCG — enough entropy for a high-frequency field.
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state >>> 24; // top 8 bits → 0–255
  };
  for (let i = 0; i < raw.length; i++) raw[i] = next();
  const buffer = await sharp(raw, { raw: { width, height, channels } })
    .jpeg({ quality: 95 })
    .toBuffer();
  return { buffer, mime: 'image/jpeg' };
}
