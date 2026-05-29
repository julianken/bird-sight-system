/**
 * Region configuration.
 *
 * `REGION_CODE` is the build-time ingest/seed region (the env var
 * `VITE_REGION_CODE`, default `US-AZ`). It identifies which region the data
 * pipeline ingests; it is NOT the user-facing label.
 *
 * The user-facing region label is RUNTIME, derived per active scope (#735)
 * via `regionLabelFor(scope, states)`:
 *   - unscoped (bare URL → chooser) → `null` (no region claim — the chooser
 *     is shown, so there is nothing to name a region for yet).
 *   - `?scope=us` (whole-US escape hatch) → "USA".
 *   - state (`?state=US-XX`) → the resolved `StateSummary.name` (e.g.
 *     "Arizona"), falling back to the bare `stateCode` when the state table
 *     hasn't loaded or is missing the row (mirrors the C0 prototype's
 *     `stateByCode(stateCode)?.name ?? stateCode`).
 *
 * State names are sourced at runtime from `GET /api/states`
 * (`StateSummary[]`, #732) — NOT a hard-coded map here. The build-time
 * `REGION_LABEL` constant was removed in #738/C5; its five consumers
 * (AppHeader, MapLede, SurfaceTitleSync, FeedSurface, App.tsx) now thread the
 * runtime value.
 *
 * Spec: docs/design/01-spec/architecture.md §Cross-cutting structures;
 * plan tasks C5 + C7 in docs/plans/2026-05-28-state-scope-selector.md.
 */
import type { StateSummary } from '@bird-watch/shared-types';
import type { Scope } from '../state/url-state.js';

export const REGION_CODE: string =
  (import.meta.env.VITE_REGION_CODE as string | undefined) ?? 'US-AZ';

/**
 * The runtime region label for the active scope, or `null` when there is no
 * region to claim (the unscoped/chooser landing). Consumers MUST treat `null`
 * as "render no region fragment" — never render a bare separator or the word
 * "region".
 *
 * @param scope  the active scope discriminant from `UrlState` (#735).
 * @param states the `/api/states` name table (#732); defaults to empty so a
 *   caller that hasn't loaded it yet degrades to the bare `stateCode`.
 */
export function regionLabelFor(
  scope: Scope,
  states: readonly StateSummary[] = [],
): string | null {
  switch (scope.kind) {
    case 'unscoped':
      return null;
    case 'us':
      return 'USA';
    case 'state':
      return (
        states.find(s => s.stateCode === scope.stateCode)?.name ??
        scope.stateCode
      );
  }
}
