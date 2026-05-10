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
 *   role="img" + aria-label="{count} sightings" collapses the pill to one
 *   SR announcement. Tier (color, padding, font-size step) is decorative.
 *   WCAG 1.4.1 satisfied by the count text, not by color.
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
 * Keyboard: the pill renders as a focusable div with tabIndex=0 and
 * onKeyDown handler for Enter/Space to match native button semantics.
 * A <button> would be more semantic, but MapLibre Marker overlays in
 * Phase 3 need to suppress native button styling — div + keyboard handler
 * is consistent with the existing cluster trigger pattern in the codebase.
 *
 * Spec: docs/design/01-spec/components.md#clusterpill
 *       docs/design/01-spec/accessibility.md (cluster pill ARIA)
 */
import type { ReactNode, KeyboardEvent } from 'react';
import { clusterTier } from '../../config/cluster.js';

export interface ClusterPillProps {
  count: number;
  onClick: () => void;
}

export function ClusterPill({ count, onClick }: ClusterPillProps): ReactNode {
  const tier = clusterTier(count);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`cluster-pill cluster-pill--${tier}`}
      role="img"
      aria-label={`${count} sightings`}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      {count}
    </div>
  );
}
