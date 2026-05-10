/**
 * <Photo>
 *
 * Owns its own internal state machine for the photo's loading lifecycle.
 * Replaces the inline <img> + manual aspect-ratio + manual attribution
 * overlay on the species detail surface.
 *
 * Internal state machine (4 states):
 *   null    — src === null → render <FamilySilhouette> at layout scale
 *   loading — src !== null && !loaded && !errored → skeleton rect (aspect-ratio reserved)
 *   loaded  — src !== null && loaded → <img> + attribution overlay
 *   errored — src !== null && onError fired → same as src === null
 *
 * CSS aspect-ratio model (from styles.css:422–437 pattern, generalized):
 *   masthead → 16/10  (hero; detail modal masthead)
 *   inline   → 4/3    (species detail panel; original .species-detail-photo ratio)
 *   thumb    → 1/1    (feed row thumbnail; future use)
 *
 * Priority for LCP: <Photo priority={true}> sets loading="eager"
 * fetchpriority="high". The detail-surface masthead always passes
 * priority={true}. Default is loading="lazy".
 *
 * Does NOT compose with <StatusBlock>. They live at different levels.
 * See docs/design/01-spec/components.md (composition rules).
 *
 * Spec: docs/design/01-spec/components.md#photo
 */
import { useState, type ReactNode } from 'react';
import { FamilySilhouette } from './FamilySilhouette.js';
import type { FamilyCode } from '../../config/family-palette.js';

export type PhotoLayout = 'inline' | 'masthead' | 'thumb';

export interface PhotoProps {
  /** null = no photo for this species; triggers <FamilySilhouette> fallback. */
  src: string | null;
  alt: string;
  /** null = species has no family code (rare; ~2 species in 14d window per G4 audit). */
  family: FamilyCode | null;
  /** true → loading="eager" fetchpriority="high" for LCP masthead. Default false. */
  priority?: boolean;
  attribution?: { text: string; href: string };
  layout?: PhotoLayout;
}

type PhotoInternalState = 'null' | 'loading' | 'loaded' | 'errored';

export function Photo({
  src,
  alt,
  family,
  priority = false,
  attribution,
  layout = 'inline',
}: PhotoProps): ReactNode {
  const [imgState, setImgState] = useState<PhotoInternalState>(
    src === null ? 'null' : 'loading'
  );

  const showSilhouette = src === null || imgState === 'errored';

  const classes = [
    'photo',
    `photo--${layout}`,
    imgState === 'loaded' ? 'photo--loaded' : null,
    imgState === 'loading' ? 'photo--loading' : null,
    showSilhouette ? 'photo--silhouette' : null,
  ]
    .filter(Boolean)
    .join(' ');

  if (showSilhouette) {
    return (
      <span className={classes}>
        <FamilySilhouette family={family} layout={layout} />
      </span>
    );
  }

  return (
    <span className={classes}>
      {imgState === 'loading' && (
        <span className="photo__skeleton" aria-hidden="true" />
      )}
      <img
        src={src!}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className={imgState !== 'loaded' ? 'photo__img photo__img--pending' : 'photo__img'}
        onLoad={() => setImgState('loaded')}
        onError={() => setImgState('errored')}
      />
      {imgState === 'loaded' && attribution && (
        <span className="photo__attribution">
          <a
            href={attribution.href}
            target="_blank"
            rel="noopener noreferrer"
            className="photo__attribution-link"
          >
            {attribution.text}
          </a>
        </span>
      )}
    </span>
  );
}
