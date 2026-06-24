// frontend/scripts/map-consistency/sampler.ts
import type { GeoPoint } from './types.js';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SeedPoint { lng: number; lat: number; }

/** 80% density-weighted (by count) + 20% uniform-in-extent seeded sampling from
 *  the scope's low-zoom bucket centroids — most samples land where birds are,
 *  a few land anywhere (catches "empty area shows phantom count"). */
export function sampleSeedPoints(points: GeoPoint[], n: number, seed: number, uniformFrac = 0.2): SeedPoint[] {
  const rnd = mulberry32(seed);
  if (points.length === 0) return [];
  const total = points.reduce((s, p) => s + p.count, 0);
  const lngs = points.map((p) => p.lng); const lats = points.map((p) => p.lat);
  const ext = { minLng: Math.min(...lngs), maxLng: Math.max(...lngs), minLat: Math.min(...lats), maxLat: Math.max(...lats) };
  const nUniform = Math.round(n * uniformFrac);
  const out: SeedPoint[] = [];
  for (let i = 0; i < n; i++) {
    if (i < nUniform) {
      out.push({ lng: ext.minLng + rnd() * (ext.maxLng - ext.minLng), lat: ext.minLat + rnd() * (ext.maxLat - ext.minLat) });
    } else {
      let r = rnd() * total; let pick = points[points.length - 1]!;
      for (const p of points) { r -= p.count; if (r <= 0) { pick = p; break; } }
      out.push({ lng: pick.lng, lat: pick.lat });
    }
  }
  return out;
}
