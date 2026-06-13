/**
 * JSON <-> SQLite-column boundary helpers.
 *
 * better-sqlite3 rejects a bound value of `undefined` (it only accepts
 * number/string/bigint/Buffer/null). Under `exactOptionalPropertyTypes` an
 * omitted optional record field is genuinely absent, so the store layer reads
 * `record.field` as `undefined` — these helpers coerce that to SQL NULL on the
 * way in and re-inflate NULL to `undefined` (never `null`) on the way out, so a
 * round-tripped record matches the optional-field shape it was written with.
 *
 * An EXPLICIT `null` is preserved as a real value (it JSON-serializes to the
 * string "null"); only `undefined` collapses to a column NULL. That keeps an
 * omitted blob distinct from an empty `{}` and from an explicit null.
 */

/** Serialize a value to JSON text, or NULL when the value is omitted (`undefined`). */
export function toJsonOrNull(v: unknown): string | null {
  return v === undefined ? null : JSON.stringify(v);
}

/** Pass a string through, mapping an omitted (`undefined`) value to NULL. */
export function toTextOrNull(v: string | undefined): string | null {
  return v ?? null;
}

/** Parse JSON text back to `T`, mapping a column NULL to `undefined`. */
export function parseJson<T>(text: string | null): T | undefined {
  return text === null ? undefined : (JSON.parse(text) as T);
}

/** Re-inflate a nullable INTEGER column to `number | undefined` (NULL -> undefined). */
export function nullableNumber(v: number | null): number | undefined {
  return v === null ? undefined : v;
}
