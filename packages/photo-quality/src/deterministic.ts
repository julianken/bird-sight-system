import sharp from 'sharp';
import type { DeterministicReport, ImageInput, RubricConfig } from './types.js';

/** Edge of the grayscale downscale used for the Laplacian sharpness metric. */
const SHARPNESS_GRID = 256;
/** Fraction of pixels in the top/bottom histogram bins above which exposure clips. */
const CLIP_BIN = 8;

/**
 * Stage-1 deterministic analysis. Decodes with sharp, computes geometry,
 * normalized variance-of-Laplacian sharpness, an exposure-clipping penalty,
 * and hard-gates against the config minimums. A gate failure short-circuits
 * scoreImage — the image never reaches the LLM (the hybrid cost saving).
 */
export async function assessDeterministic(
  img: ImageInput,
  det: RubricConfig['deterministic'],
): Promise<DeterministicReport> {
  const pipeline = sharp(img.buffer, { failOn: 'error' });
  const meta = await pipeline.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const megapixels = (width * height) / 1_000_000;
  const aspectRatio = height === 0 ? 0 : width / height;

  // Grayscale, downscaled, raw bytes for both sharpness and exposure.
  const { data, info } = await sharp(img.buffer)
    .grayscale()
    .resize(SHARPNESS_GRID, SHARPNESS_GRID, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const sharpness = laplacianVariance(data, info.width, info.height);
  const exposure = exposureScore(data);

  const failReasons: string[] = [];
  if (megapixels < det.minMegapixels) failReasons.push('below-min-megapixels');
  if (sharpness < det.minSharpness) failReasons.push('below-min-sharpness');
  const [lo, hi] = det.allowedAspect;
  if (aspectRatio < lo || aspectRatio > hi) failReasons.push('aspect-out-of-range');

  return {
    width,
    height,
    megapixels,
    sharpness,
    exposure,
    aspectRatio,
    passedGate: failReasons.length === 0,
    failReasons,
  };
}

/**
 * Variance of the 3×3 Laplacian over a single-channel buffer, normalized to
 * roughly 0–1 by the maximum possible response (4·255). Higher = sharper.
 */
function laplacianVariance(gray: Buffer, w: number, h: number): number {
  const lap: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v =
        4 * gray[i]! -
        gray[i - 1]! -
        gray[i + 1]! -
        gray[i - w]! -
        gray[i + w]!;
      lap.push(v);
    }
  }
  if (lap.length === 0) return 0;
  const mean = lap.reduce((a, b) => a + b, 0) / lap.length;
  const variance =
    lap.reduce((a, b) => a + (b - mean) * (b - mean), 0) / lap.length;
  // 4*255 = 1020 is the max single-pixel Laplacian magnitude; square for
  // variance units, then clamp to [0,1].
  const normalized = variance / (1020 * 1020);
  return Math.min(1, normalized);
}

/**
 * Exposure score 0–1: 1 means no clipping, lower means a large fraction of
 * pixels are pinned at pure black (<CLIP_BIN) or pure white (>255-CLIP_BIN).
 * Penalty is the clipped fraction; score = 1 - clipped.
 */
function exposureScore(gray: Buffer): number {
  let clipped = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    if (v < CLIP_BIN || v > 255 - CLIP_BIN) clipped++;
  }
  const fraction = gray.length === 0 ? 0 : clipped / gray.length;
  return Math.max(0, 1 - fraction);
}
