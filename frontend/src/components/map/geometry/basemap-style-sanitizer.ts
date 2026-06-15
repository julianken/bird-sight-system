/**
 * Basemap style sanitizer — null-numeric-comparison guard (#1027 [O8] · #1230 [C8]).
 *
 * The stock OpenFreeMap basemap styles ship filter / paint / layout expressions
 * that compare a numeric DATA property with a `<`/`<=`/`>`/`>=` operator. When
 * the property is absent on a feature (e.g. a road segment with no `ref` carries
 * no `ref_length`; a POI with no `rank`), the comparison's left operand
 * evaluates to `null` and MapLibre's WORKER logs once per expression while
 * compiling the style:
 *
 *   "Expected value to be of type number, but found null instead."
 *
 * At z14 the positron (light) style has four such layers active —
 * `highway-shield-non-us`, `highway-shield-us-interstate`, `road_shield_us`
 * (`["<=", ["get","ref_length"], 6]`) and `boundary_3`
 * (`[">=", ["get","admin_level"], 3]` / `["<=", …, 6]`). The new `bright` /
 * `liberty` / `fiord` styles add POI rank filters (`["<", ["get","rank"], 20]`,
 * `[">=", ["get","rank"], 1]`, … on `poi_r1`/`poi_r7`/`poi_r20`) that the worker
 * trips on the moment `bright` becomes the default basemap. The warnings are
 * UPSTREAM style content and benign: a null operand resolves the comparison to
 * `false`, so the feature simply renders no shield / no boundary / no POI — the
 * correct visual outcome. But the repo holds the console to a zero-warning bar,
 * so we rewrite the expression. This is NOT silent suppression — the rewrite is
 * documented, tested, and behaviour-preserving.
 *
 * The transform is STRUCTURAL and FAILS OPEN — no hardcoded layer-id list (the
 * styles use different id conventions: underscore ids on dark, hyphenated /
 * `label_*` / `poi_*` on light). Every expression sub-tree of shape
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
 * ── Single chokepoint (#1230 [C8]) ────────────────────────────────────────────
 * A basemap style reaches MapLibre through exactly THREE entry points, and the
 * pure `sanitizeStyleNullNumeric` below is the single source of truth applied at
 * each via the right MapLibre mechanism:
 *
 *   1. INITIAL paint — the `<Map mapStyle={…}>` CONSTRUCTOR has no `transformStyle`
 *      hook (it is a `setStyle`-only option), so the first paint cannot guard a
 *      raw URL. `loadSanitizedStyle(url)` fetches the style JSON, runs the pure
 *      sanitizer, and hands MapCanvas a pre-sanitized STYLE OBJECT. The worker
 *      never sees a raw null-prone expression, so the first `warnOnce` never
 *      fires. Memoized per url so a swap-back never refetches.
 *   2. THEME SWAP — `setBasemapStyle(map, url)` → `map.setStyle(url, {
 *      transformStyle: transformStyleSanitizeNull })`. MapLibre runs
 *      `transformStyle` on the fetched style "before it is committed to the map
 *      state", so again the worker never sees the raw expression.
 *   3. RETRY — same `setBasemapStyle` helper, same `transformStyle` hook.
 *
 * The old main-thread `style.load` pass (a live-map `getFilter`/`setFilter`
 * sweep) is GONE: it ran AFTER the worker had already parsed + warned, so it
 * could never prevent the first warning — a redundant band-aid once the style is
 * guarded BEFORE it reaches the worker at every entry point above.
 */

import type { StyleSpecification } from 'maplibre-gl';

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
 * rewrite idempotent: a re-apply (or a future pass) must NOT re-wrap a comparison
 * we already guarded, which would nest `all`s without bound.
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
 * Recursively rewrite a filter / paint / layout expression, wrapping every
 * null-prone numeric comparison in `["all", ["has", prop], <original>]`. Returns
 * the rewritten expression, or `null` when nothing changed (so the caller can
 * detect a no-op — keeping the pass idempotent and avoiding needless work).
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

/* ────────────────────────────────────────────────────────────────────────────
   PRE-WORKER style-JSON sanitizer (#1230 · C8).

   `sanitizeStyleNullNumeric` rewrites the style JSON BEFORE it reaches the
   worker — for the constructor as a pre-sanitized OBJECT (`loadSanitizedStyle`)
   and for `setStyle` via MapLibre's `transformStyle` hook
   (`transformStyleSanitizeNull`). Either way the worker never sees the raw
   null-prone expression and `warnOnce` never fires.

   This sanitizer is STYLE-AGNOSTIC: it walks EVERY layer's `filter`, `paint`,
   AND `layout` (a null-prone numeric `get` can sit in any of the three — e.g. a
   `["step", ["get","rank"], …]` in `layout`, not just a `filter`), reuses the
   same structural `nullSafeFilter` rewrite, and is a pure no-op for any
   already-safe expression. So it covers bright/liberty/fiord today and any
   future style without a per-style id list. Behaviour-preserving: the guard only
   short-circuits the comparison to `false` when the property is ABSENT — exactly
   the pre-fix outcome (null → false) — and is byte-identical for positron/dark
   whose comparisons it rewrites with no visual change.
   ──────────────────────────────────────────────────────────────────────────── */

/** The minimal layer shape the style sanitizer touches. */
interface SanitizableLayer {
  filter?: unknown;
  paint?: Record<string, unknown> | undefined;
  layout?: Record<string, unknown> | undefined;
  [k: string]: unknown;
}

/** The minimal style shape the sanitizer touches — just a `layers` array. */
interface SanitizableStyle {
  layers?: SanitizableLayer[];
  [k: string]: unknown;
}

/**
 * Rewrite every property value in a `paint`/`layout` bag whose expression holds
 * a null-prone numeric comparison. Returns a NEW bag when anything changed, or
 * the original reference when nothing did (so the caller can detect a no-op and
 * keep the pass idempotent). Each value is run through `nullSafeFilter`, which
 * recurses generically over any expression array — a paint/layout expression
 * (`["step", ["get",X], …]`, `["case", ["<", ["get",X], n], …]`) is the same
 * array shape a filter is, so the same structural guard applies.
 */
function sanitizeExpressionBag(
  bag: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (bag == null) return bag;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bag)) {
    const rewritten = nullSafeFilter(value);
    if (rewritten !== null) {
      changed = true;
      next[key] = rewritten;
    } else {
      next[key] = value;
    }
  }
  return changed ? next : bag;
}

/**
 * Pure style-JSON sanitizer. Returns a style whose every layer `filter`,
 * `paint`, and `layout` has had its null-prone numeric comparisons wrapped in
 * `["all", ["has", prop], <original>]` (or the SAME style reference unchanged
 * when nothing was null-prone — idempotent, so a re-run is a no-op).
 *
 * Shallow-copies only the layers that actually changed (and the `layers` array
 * + top-level object when ANY did); untouched layers keep their original
 * reference. Never mutates the input. Fails OPEN — a malformed style (no
 * `layers` array) is returned as-is.
 */
export function sanitizeStyleNullNumeric<T extends SanitizableStyle>(style: T): T {
  if (style == null || !Array.isArray(style.layers)) return style;
  let anyChanged = false;
  const nextLayers = style.layers.map((layer) => {
    const filter = nullSafeFilter(layer.filter);
    const paint = sanitizeExpressionBag(layer.paint);
    const layout = sanitizeExpressionBag(layer.layout);
    const filterChanged = filter !== null;
    const paintChanged = paint !== layer.paint;
    const layoutChanged = layout !== layer.layout;
    if (!filterChanged && !paintChanged && !layoutChanged) return layer;
    anyChanged = true;
    const nextLayer: SanitizableLayer = { ...layer };
    if (filterChanged) nextLayer.filter = filter;
    if (paintChanged) nextLayer.paint = paint;
    if (layoutChanged) nextLayer.layout = layout;
    return nextLayer;
  });
  if (!anyChanged) return style;
  return { ...style, layers: nextLayers };
}

/**
 * MapLibre `TransformStyleFunction`-shaped adapter: `(previous, next) => next'`.
 * Pass as `map.setStyle(url, { transformStyle: transformStyleSanitizeNull })` so
 * the fetched style is null-guarded BEFORE it is committed to the worker. The
 * `previous` style is ignored (we only sanitize the incoming one). Fails OPEN —
 * if `next` is unexpectedly nullish it is returned untouched.
 */
export function transformStyleSanitizeNull(
  _previous: unknown,
  next: unknown,
): unknown {
  if (next == null) return next;
  return sanitizeStyleNullNumeric(next as SanitizableStyle);
}

/* ────────────────────────────────────────────────────────────────────────────
   INITIAL-paint loader (#1230 · C8).

   The `<Map mapStyle={…}>` CONSTRUCTOR accepts a STYLE OBJECT but has no
   `transformStyle` hook (that is a `setStyle`-only option), so it can't guard a
   raw URL. `loadSanitizedStyle(url)` closes the gap: fetch → json → sanitize →
   return the pre-guarded `StyleSpecification`, which MapCanvas feeds straight to
   the constructor. The worker therefore parses an already-guarded style and the
   first `warnOnce` never fires.

   Memoized by url in a module-level `Map<string, Promise<StyleSpecification>>`:
   we cache the PROMISE (not the resolved value) so concurrent requests for the
   same url share one in-flight fetch, and a later swap BACK to a theme re-uses
   the resolved style instead of refetching. Fails OPEN per-call: a fetch / parse
   error rejects so the caller can fall back (and is NOT cached, so a transient
   failure can be retried), never swallowed.
   ──────────────────────────────────────────────────────────────────────────── */

const sanitizedStyleCache = new Map<string, Promise<StyleSpecification>>();

/**
 * Fetch a basemap style URL, null-guard it with `sanitizeStyleNullNumeric`, and
 * resolve the pre-sanitized `StyleSpecification`. Memoized per url so a repeat /
 * concurrent request shares one fetch and a swap-back never refetches. Rejects
 * (and forgets the cache entry) on a fetch/parse error — fail-open for the
 * caller, retryable.
 */
export function loadSanitizedStyle(url: string): Promise<StyleSpecification> {
  const cached = sanitizedStyleCache.get(url);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`basemap style fetch failed: ${res.status} ${url}`);
    }
    const json = (await res.json()) as StyleSpecification;
    return sanitizeStyleNullNumeric(json);
  })().catch((err: unknown) => {
    // Forget the failed promise so a later call can retry the fetch.
    sanitizedStyleCache.delete(url);
    throw err;
  });
  sanitizedStyleCache.set(url, promise);
  return promise;
}
