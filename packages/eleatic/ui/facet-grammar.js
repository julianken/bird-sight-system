// The `f=` facet URL-grammar (de)serializer for the eleatic facet page.
//
// Grammar (one `f=` query param per clause):
//   f=<axis>.<key>:<op>[:<value>]
//   axis  ∈ {scores, metadata}   (carried as part of `path`, never split off —
//                                 the path IS `"scores.<key>"` / `"metadata.<key>"`,
//                                 exactly E2's FacetFilter.path)
//   op    ∈ eq | ne | lt | lte | gt | gte | in | contains | exists  (E2 #1145)
//   value present for every op EXCEPT `exists`; `in` is a comma list.
//
// Each parsed clause is an E2 `FacetFilter` — `{ path, op, value? }` — and the
// facets controller assembles the set into an E2 `FacetQuery`
// (`{ filters?, sort?, limit?, offset? }`). This module owns ONLY the wire
// (de)serialization; the SERVER (src/server/app.ts#parseFacet) re-parses + the
// query layer validates the path. Mirrors that server parser's value coercion so
// `scores.x:gte:0.9` and `metadata.flagged:eq:true` round-trip to the same
// scalars the server produces.
//
// Defensive: a malformed clause (no colon, unknown op, value-requiring op with
// no value, empty path) is SKIPPED, never thrown — a hand-edited URL must not
// crash the page (it just renders fewer filters).
//
// Plain ESM with named exports so it is importable by the browser (express.static)
// and by vitest in node — the safe.js / format.js precedent.

// The canonical FacetFilter op set (E2 #1145, queries.ts FacetFilter['op']).
const OPS = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'contains', 'exists']);

/**
 * Coerce a raw string facet value to a JSON scalar: `'true'`/`'false'` →
 * boolean, a finite numeric string → number, else the string verbatim. Matches
 * src/server/app.ts#coerceScalar so client- and server-side parses agree.
 */
function coerceScalar(raw) {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw !== '' && !Number.isNaN(Number(raw))) return Number(raw);
  return raw;
}

/** Parse one `path:op[:value]` token into a FacetFilter, or null if malformed. */
function parseFacet(token) {
  const firstColon = token.indexOf(':');
  if (firstColon === -1) return null;
  const path = token.slice(0, firstColon);
  if (path === '') return null;

  const rest = token.slice(firstColon + 1);
  const secondColon = rest.indexOf(':');
  const op = secondColon === -1 ? rest : rest.slice(0, secondColon);
  if (!OPS.has(op)) return null;

  if (op === 'exists') return { path, op };
  if (secondColon === -1) return null; // value-requiring op with no value
  const valueRaw = rest.slice(secondColon + 1);
  if (op === 'in') {
    return { path, op, value: valueRaw.split(',').map(coerceScalar) };
  }
  return { path, op, value: coerceScalar(valueRaw) };
}

/**
 * Read every `f=` clause off a URLSearchParams into an array of FacetFilters.
 * Zero clauses → `[]`; malformed clauses are dropped (never throw).
 */
export function parseFacets(searchParams) {
  const out = [];
  for (const token of searchParams.getAll('f')) {
    const filter = parseFacet(token);
    if (filter !== null) out.push(filter);
  }
  return out;
}

/** Serialize one scalar back to its wire string (the inverse of coerceScalar). */
function scalarToWire(value) {
  return String(value);
}

/**
 * Serialize FacetFilters back to a `f=…&f=…` query string (no leading `?`).
 * The inverse of `parseFacets`: `parseFacets(new URLSearchParams(serializeFacets(c)))`
 * round-trips. Zero clauses → `''`.
 */
export function serializeFacets(filters) {
  const params = new URLSearchParams();
  for (const f of filters) {
    if (f.op === 'exists') {
      params.append('f', `${f.path}:exists`);
    } else if (f.op === 'in') {
      const list = Array.isArray(f.value) ? f.value : [];
      params.append('f', `${f.path}:in:${list.map(scalarToWire).join(',')}`);
    } else {
      params.append('f', `${f.path}:${f.op}:${scalarToWire(f.value)}`);
    }
  }
  return params.toString();
}
