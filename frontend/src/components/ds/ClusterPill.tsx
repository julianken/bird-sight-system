/**
 * <ClusterPill>
 *
 * Apple Maps–style cluster indicator replacing solid filled MapLibre
 * cluster circles. Tier (sky / sand / ember) encodes observation density
 * as decorative visual weight via CSS class. The canonical information
 * carrier is always the count text (WCAG 1.4.1 — tier color is not
 * the sole discriminator).
 *
 * A11y contract:
 *   <button type="button"> with aria-label="{count} sightings" collapses
 *   the pill to one SR announcement and gives AT users the same activation
 *   affordance as sighted keyboard users — matching the established
 *   <MosaicMarker> pattern (MosaicMarker.tsx lines 13–14). Tier (color,
 *   padding, font-size step) is decorative. WCAG 1.4.1 satisfied by the
 *   count text inside the pill, not by color.
 *
 * Tier is computed internally from clusterTier() (cluster.ts).
 * The MapLibre cluster layer config (Phase 3) will import the same
 * CLUSTER_TIER_BOUNDARIES constants — single source of truth.
 *
 * Inline contrast reference (against --color-bg-surface white/dark):
 *   Sky   → 8.2:1  (dark stroke on white fill)
 *   Sand  → 10.4:1 (dark stroke on white fill)
 *   Ember → 5.1:1  (dark stroke on white fill)
 *
 * Styling note: UA button reset (border, padding, background) is deferred
 * to the primitive CSS pass (filed as follow-up). The button is unstyled
 * here intentionally — CSS ships separately per the Phase 2 scope.
 *
 * Spec: docs/design/01-spec/components.md#clusterpill
 *       docs/design/01-spec/accessibility.md (cluster pill ARIA)
 */
import type { ReactNode } from 'react';
import { clusterTier } from '../../config/cluster.js';

export interface ClusterPillProps {
  count: number;
  onClick: () => void;
}

export function ClusterPill({ count, onClick }: ClusterPillProps): ReactNode {
  const tier = clusterTier(count);

  return (
    <button
      type="button"
      className={`cluster-pill cluster-pill--${tier}`}
      aria-label={`${count} sightings`}
      onClick={onClick}
    >
      {count}
    </button>
  );
}

/**
 * Predicted rendered bounding box for a ClusterPill at a given count.
 * Used by the deconflict module (issue #554) to compute the AABB without
 * a DOM round-trip.
 *
 * Values are derived from `ds-primitives.css:421-451` per-tier rules
 * (padding + font-size + min-width) and validated against live measurement
 * on 2026-05-15 (sky 36×24, sand 55×27, ember 73×33 at typical counts).
 *
 * The width formula assumes a tabular-digit width of ~8px (sky), ~9px
 * (sand), ~10px (ember). If the design system rebases on a different
 * font, this function needs to be retuned — there's a unit test in
 * ClusterPill.test.tsx that asserts measured dimensions stay within
 * ±4px of predicted.
 */
export function pillDimensions(count: number): { w: number; h: number } {
  const tier = clusterTier(count);
  const digits = String(count).length;
  if (tier === 'sky') {
    return { w: Math.max(28, digits * 8 + 20), h: 24 };
  }
  if (tier === 'sand') {
    return { w: Math.max(34, digits * 9 + 26), h: 27 };
  }
  return { w: Math.max(40, digits * 10 + 32), h: 33 };
}
