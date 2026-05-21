/**
 * <StatusBlock>
 *
 * Page-level status primitive. Collapses ad-hoc CSS classes
 * (.feed-empty, .species-detail-loading, .species-detail-error,
 * .attribution-modal-loading, .attribution-modal-empty,
 * .attribution-modal-error, .error-screen, .map-loading-skeleton) and
 * the distinct copy+class pairs they carried into a single typed API.
 * (Pre-#688 also collapsed .species-search-empty, deleted with the
 * SpeciesSearchSurface in #688.)
 *
 * Does NOT compose with <Photo>. They live at different levels of the
 * component tree. See docs/design/01-spec/components.md for composition rules.
 *
 * A11y:
 *   - loading skeleton renders inside role="status" aria-live="polite"
 *     so SR users hear the title once on entry.
 *   - The 2px progress bar is an indeterminate <progress>; SR identifies
 *     it as "progress, busy."
 *   - Error state defaults to tone="alert" but accepts an explicit override.
 *
 * Spec: docs/design/01-spec/components.md#statusblock
 */
import type { ReactNode } from 'react';

export type StatusBlockState = 'loading' | 'empty' | 'error';
export type StatusBlockSurface = 'page' | 'panel' | 'modal' | 'list' | 'overlay';
export type StatusBlockTone = 'subtle' | 'alert';

export interface StatusBlockProps {
  state: StatusBlockState;
  title: string;
  body?: string;
  surface?: StatusBlockSurface;
  action?: { label: string; onClick: () => void };
  /** Defaults: subtle for loading/empty; alert for error. */
  tone?: StatusBlockTone;
}

export function StatusBlock({
  state,
  title,
  body,
  surface,
  action,
  tone,
}: StatusBlockProps): ReactNode {
  const resolvedTone: StatusBlockTone =
    tone ?? (state === 'error' ? 'alert' : 'subtle');

  const classes = [
    'status-block',
    `status-block--state-${state}`,
    `status-block--tone-${resolvedTone}`,
    surface ? `status-block--surface-${surface}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} role="status" aria-live="polite">
      {state === 'loading' && (
        <progress
          className="status-block__progress"
          aria-label="Loading, please wait"
        />
      )}
      {state === 'loading' && (
        <div className="status-block__skeleton" aria-hidden="true" />
      )}
      <p className="status-block__title">{title}</p>
      {body && <p className="status-block__body">{body}</p>}
      {action && (
        <button
          type="button"
          className="status-block__action"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
