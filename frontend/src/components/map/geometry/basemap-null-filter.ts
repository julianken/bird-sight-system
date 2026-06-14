/**
 * Basemap null-numeric-comparison filter sanitizer (#1027 · [O8]).
 *
 * The stock OpenFreeMap basemap styles ship filter expressions that compare a
 * numeric DATA property with a `<`/`<=`/`>`/`>=` operator. When the property is
 * absent on a feature (e.g. a road segment with no `ref` carries no
 * `ref_length`), the comparison's left operand evaluates to `null` and MapLibre
 * logs once per layer per evaluation:
 *
 *   "Expected value to be of type number, but found null instead."
 *
 * At z14 the positron (light) style has exactly four such layers active —
 * `highway-shield-non-us`, `highway-shield-us-interstate`, `road_shield_us`
 * (`["<=", ["get","ref_length"], 6]`) and `boundary_3`
 * (`[">=", ["get","admin_level"], 3]` / `["<=", …, 6]`) — which is the 4×
 * warning observed during a dblclick-zoom to z14 at the US-191 Morenci
 * switchbacks. The warnings are UPSTREAM style content (they fire on the
 * national map too, not just the state-artboard `within`-isolation path), and
 * they are benign: a null operand resolves the comparison to `false`, so the
 * feature simply renders no shield / no boundary — which is the correct visual
 * outcome. But the repo holds the console to a zero-warning bar, so we patch the
 * expression at `style.load` rather than accept the noise. This is NOT silent
 * suppression — the rewrite is documented, tested, and behaviour-preserving.
 *
 * The transform is STRUCTURAL and FAILS OPEN — no hardcoded layer-id list (the
 * two basemaps use different id conventions: underscore ids on dark,
 * hyphenated/`label_*` on light). Every filter sub-expression of shape
 * `[<numeric-op>, ["get", <prop>], <num>]` is rewritten to
 * `["all", ["has", <prop>], <original-comparison>]`:
 *
 *   - When the feature LACKS `<prop>`, `["has", <prop>]` is `false` and the
 *     `all` short-circuits — the original null comparison is NEVER evaluated, so
 *     no warning fires. The whole expression is `false`, exactly matching the
 *     pre-fix outcome (null → false → no render).
 *   - When the feature HAS `<prop>`, the original comparison runs unchanged.
 *
 * So the rendered map is pixel-identical to today; only the console warning is
 * removed. A future basemap release that adds a new null-prone comparison is
 * sanitized automatically (structural match); a release that removes one is a
 * no-op (nothing to rewrite). Equality / membership ops (`==`, `!=`, `match`,
 * `in`) tolerate null without warning and are deliberately left untouched.
 *
 * Wired from MapCanvas's `style.load` listener (and the initial `load`), so the
 * `[data-theme]` `setStyle` swap re-applies it on every theme flip — same
 * re-apply contract as `applyLabelIsolation` (see use-state-artboard.ts).
 */

/** Numeric comparison operators that throw the null-number warning. */
const NULL_PRONE_OPS = new Set(['<', '<=', '>', '>=']);

/**
 * True iff `expr` is a numeric comparison whose LEFT operand is a bare
 * `["get", <prop>]` — i.e. it reads a (nullable) feature property and will warn
 * when that property is absent. An already-guarded operand (`coalesce`, etc.)
 * or a non-property operand (`["zoom"]`) is NOT flagged.
 */
export function isNullProneComparison(expr: unknown): boolean {
  if (!Array.isArray(expr) || expr.length < 3) return false;
  const [op, lhs] = expr;
  if (typeof op !== 'string' || !NULL_PRONE_OPS.has(op)) return false;
  return (
    Array.isArray(lhs) &&
    lhs[0] === 'get' &&
    typeof lhs[1] === 'string'
  );
}

/** The property name a null-prone comparison reads (caller pre-checks shape). */
function comparisonProp(expr: unknown[]): string {
  return (expr[1] as ['get', string])[1];
}

/**
 * True iff `expr` is ALREADY the null-safe guard this module produces —
 * `["all", ["has", <prop>], <null-prone-cmp-on-prop>]`. Recognizing it keeps the
 * rewrite idempotent: a `style.load` re-apply (or a future pass) must NOT re-wrap
 * a comparison we already guarded, which would nest `all`s without bound.
 */
function isAlreadyGuarded(expr: unknown): boolean {
  if (!Array.isArray(expr) || expr.length !== 3 || expr[0] !== 'all') {
    return false;
  }
  const [, hasExpr, cmp] = expr;
  if (
    !Array.isArray(hasExpr) ||
    hasExpr[0] !== 'has' ||
    typeof hasExpr[1] !== 'string'
  ) {
    return false;
  }
  return isNullProneComparison(cmp) && comparisonProp(cmp as unknown[]) === hasExpr[1];
}

/**
 * Recursively rewrite a filter expression, wrapping every null-prone numeric
 * comparison in `["all", ["has", prop], <original>]`. Returns the rewritten
 * filter, or `null` when nothing changed (so the caller can skip `setFilter` —
 * keeping the pass idempotent and avoiding needless repaints).
 */
export function nullSafeFilter(filter: unknown): unknown {
  if (filter == null) return null;

  // Already guarded by a prior pass — nothing to do (idempotency).
  if (isAlreadyGuarded(filter)) return null;

  // A bare null-prone comparison at the top level.
  if (isNullProneComparison(filter)) {
    const prop = comparisonProp(filter as unknown[]);
    return ['all', ['has', prop], filter];
  }

  if (!Array.isArray(filter)) return null;

  // Recurse into compound expressions (all/any/none/case/…). Rewrite each
  // element; if any child changed, rebuild the array with the new children.
  let changed = false;
  const next = filter.map((child) => {
    if (isAlreadyGuarded(child)) return child; // leave a prior guard intact
    if (isNullProneComparison(child)) {
      changed = true;
      const prop = comparisonProp(child as unknown[]);
      return ['all', ['has', prop], child];
    }
    if (Array.isArray(child)) {
      const rewritten = nullSafeFilter(child);
      if (rewritten !== null) {
        changed = true;
        return rewritten;
      }
    }
    return child;
  });

  return changed ? next : null;
}

/**
 * The minimal maplibre-map surface this pass needs. Structurally compatible with
 * the real `map` from `mapRef.current.getMap()` and trivially mockable.
 */
export interface NullFilterMap {
  getStyle: () => { layers?: Array<{ id: string }> } | undefined;
  getFilter: (layerId: string) => unknown;
  setFilter: (layerId: string, filter: unknown) => void;
}

/**
 * Walk every layer in the current style, and for any whose filter contains a
 * null-prone numeric comparison, replace it with the null-safe rewrite. Skips
 * unaffected layers entirely (no `setFilter`), so it is idempotent — a second
 * pass over an already-sanitized style is a no-op.
 *
 * **Fails OPEN.** Wrapped in try/catch (style churn after a `setStyle` swap can
 * make `getStyle`/`getFilter`/`setFilter` throw); the worst case is the
 * pre-fix console warning, never a thrown error or a blanked map.
 */
export function sanitizeNullNumericFilters(map: NullFilterMap): void {
  try {
    const layers = map.getStyle()?.layers ?? [];
    for (const layer of layers) {
      const original = map.getFilter(layer.id);
      const rewritten = nullSafeFilter(original);
      if (rewritten !== null) {
        map.setFilter(layer.id, rewritten);
      }
    }
  } catch {
    /* defensive — style churn after a swap; QA detects any residual warning */
  }
}
