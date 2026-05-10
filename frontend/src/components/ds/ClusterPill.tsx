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
