/**
 * Cluster tier thresholds for <ClusterPill> density encoding.
 *
 * Single source of truth. The MapLibre cluster layer config
 * (frontend/src/components/map/observation-layers.ts) will import
 * these same constants in Phase 3 — do not duplicate.
 *
 * Tiers (sky → sand → ember) encode observation density as
 * decorative visual weight. The canonical information carrier is
 * always the count text inside the pill (WCAG 1.4.1).
 */
export const CLUSTER_TIER_BOUNDARIES = { sand: 100, ember: 750 } as const;

export type ClusterTier = 'sky' | 'sand' | 'ember';

export function clusterTier(count: number): ClusterTier {
  if (count >= CLUSTER_TIER_BOUNDARIES.ember) return 'ember';
  if (count >= CLUSTER_TIER_BOUNDARIES.sand) return 'sand';
  return 'sky';
}
