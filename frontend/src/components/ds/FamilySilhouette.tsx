/**
 * <FamilySilhouette>
 *
 * Synchronously renderable SVG silhouette tinted with family-channel fill.
 * Used by:
 *   - <Photo> as the no-photo fallback (src=null or onError)
 *   - Feed rows as family thumbnails (Phase 3)
 *   - <FamilyLegend> as the swatch marker (Phase 3)
 *
 * Phase 2 note: Path data is a per-family placeholder pending Phase 3
 * integration with /api/silhouettes. The placeholder paths are distinct
 * per family so the shape encoding (WCAG 1.4.1) is exercisable in tests.
 *
 * The null-family path renders a generic bird silhouette with neutral
 * grey fill (--color-bg-tint analogue). This covers the ~2 species in
 * the 14d window with no familyCode (G4 audit).
 *
 * A11y: aria-hidden="true" by default (presentational inside <Photo>).
 * Consumers that render the silhouette as standalone content must pass
 * aria-label or wrap with an accessible label.
 *
 * Spec: docs/design/01-spec/components.md#familysilhouette
 *       docs/design/01-spec/accessibility.md (WCAG 1.4.1 shape encoding)
 */
import type { ReactNode } from 'react';
import { getFamilyChannel } from '../../config/family-palette.js';
import type { FamilyCode, ShapeVariant } from '../../config/family-palette.js';

export type SilhouetteLayout = 'inline' | 'masthead' | 'thumb';

export interface FamilySilhouetteProps {
  family: FamilyCode | null;
  layout?: SilhouetteLayout;
  /** Overrides the palette's default shape if provided. */
  shape?: ShapeVariant;
  /** aria-label for standalone use. Omit when inside <Photo> (aria-hidden). */
  ariaLabel?: string;
}

/**
 * Generic bird-silhouette path used as placeholder until Phase 3 wires
 * in the API-fetched family_silhouettes data. Each family gets a slight
 * variation so the shape encoding remains testable.
 *
 * Coordinate space: 100×100 viewBox. Paths are simplified outlines,
 * not anatomically precise — the goal is recognizable "bird shape" at
 * hero scale to satisfy the G4 audit requirement that the silhouette
 * fallback be designed at the same fidelity as the photo path.
 */
const FAMILY_PATHS: Record<FamilyCode | '__null__', string> = {
  // Raptor — broad wings spread, hooked beak
  raptor: 'M50 20 C30 15 10 35 5 50 C15 45 25 48 35 55 L30 80 L50 70 L70 80 L65 55 C75 48 85 45 95 50 C90 35 70 15 50 20Z',
  // Waterfowl — low body, flat bill, neck curve
  waterfowl: 'M20 55 C20 40 30 30 45 28 C50 20 60 22 65 30 L80 28 C85 30 82 38 75 38 L70 55 C65 70 35 70 20 55Z',
  // Woodpecker — upright, long bill, crest
  woodpecker: 'M45 10 L55 10 L60 20 C68 15 70 25 62 28 L65 60 C65 75 55 80 50 80 C45 80 35 75 35 60 L38 28 C30 25 32 15 40 20Z',
  // Songbird — compact, round body, short bill
  songbird: 'M50 25 C40 20 30 30 30 40 C30 55 40 65 50 65 C60 65 70 55 70 40 C70 30 60 20 50 25Z M50 25 L42 18 M50 25 L58 18',
  // Shorebird — long legs, long bill, slender body
  shorebird: 'M40 35 L60 35 C65 35 70 40 70 45 L65 55 L60 75 L55 75 L58 55 L42 55 L45 75 L40 75 L35 55 C30 40 35 35 40 35Z M55 35 L70 28',
  // Hummingbird — tiny, long narrow bill, hovering posture
  hummingbird: 'M50 35 C43 30 38 35 38 42 C38 50 43 55 50 55 C57 55 62 50 62 42 C62 35 57 30 50 35Z M50 35 L75 30 M42 42 L35 50 M58 42 L65 50',
  // Corvid — large, squared tail, stout bill
  corvid: 'M30 45 C30 30 38 20 50 20 C62 20 70 30 70 45 L72 60 C72 68 65 72 58 70 L50 72 L42 70 C35 72 28 68 28 60Z M50 20 L55 12 L50 15 L45 12Z',
  // Null-family — generic bird shape, neutral tint
  __null__: 'M50 22 C38 18 28 28 28 40 C28 55 38 65 50 65 C62 65 72 55 72 40 C72 28 62 18 50 22Z M50 22 C45 14 42 12 45 18 M50 22 C55 14 58 12 55 18',
};

export function FamilySilhouette({
  family,
  layout = 'inline',
  shape: shapeProp,
  ariaLabel,
}: FamilySilhouetteProps): ReactNode {
  const channel = getFamilyChannel(family);
  const resolvedShape: ShapeVariant = shapeProp ?? channel.shape;
  const pathKey = family ?? '__null__';
  const path = FAMILY_PATHS[pathKey];

  const classes = [
    'family-silhouette',
    `family-silhouette--${layout}`,
    `family-silhouette--${resolvedShape}`,
    family === null ? 'family-silhouette--null-family' : `family-silhouette--${family}`,
  ].join(' ');

  return (
    <span className={classes} style={{ '--family-fill': channel.fill } as React.CSSProperties}>
      <svg
        viewBox="0 0 100 100"
        xmlns="http://www.w3.org/2000/svg"
        fill={channel.fill}
        aria-hidden={ariaLabel ? undefined : 'true'}
        aria-label={ariaLabel}
        role={ariaLabel ? 'img' : undefined}
      >
        <path d={path} />
      </svg>
    </span>
  );
}
