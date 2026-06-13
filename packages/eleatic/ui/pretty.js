// Recursive JSON pretty-printer for the eleatic drawer.
//
// The drawer shows `output_json` and `expected_json` side by side. These are
// OPAQUE blobs written by whatever eval harness filled the store — eleatic never
// destructures or trusts them, and the server exposes a write route, so an
// attacker-controlled blob like `{ name: '"><img src=x onerror=alert(1)>' }` is
// a real XSS the moment it reaches `innerHTML`. This renderer walks the value and
// pushes EVERY object key and string value through safe.js#esc, so the dangerous
// payload renders as inert text. Numbers / booleans / null are emitted as their
// literal token (no user-controlled characters), but still wrapped in escaped
// markup-free spans.
//
// Output is a nested <div>/<span> tree (styled by app.css's `.json-*` classes),
// not raw text, so the drawer can present the two blobs as readable trees.
//
// Plain ESM with a named export — importable by the browser (express.static) and
// vitest in node, the safe.js / format.js precedent.

import { esc } from './safe.js';

/** Render a scalar leaf (string | number | boolean | null) as an escaped span. */
function leaf(value) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'number') return `<span class="json-num">${esc(value)}</span>`;
  if (typeof value === 'boolean') return `<span class="json-bool">${esc(value)}</span>`;
  // String (and any other primitive coerced via esc's String()) — quote + escape.
  return `<span class="json-str">&quot;${esc(value)}&quot;</span>`;
}

/** Recursively render an arbitrary JSON value into an escaped HTML tree. */
export function prettyJson(value) {
  if (value === null || typeof value !== 'object') return leaf(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="json-empty">[]</span>';
    const items = value
      .map((v) => `<li class="json-item">${prettyJson(v)}</li>`)
      .join('');
    return `<ul class="json-array">${items}</ul>`;
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return '<span class="json-empty">{}</span>';
  const rows = entries
    .map(
      ([k, v]) =>
        `<li class="json-item"><span class="json-key">${esc(k)}</span><span class="json-colon">: </span>${prettyJson(v)}</li>`,
    )
    .join('');
  return `<ul class="json-object">${rows}</ul>`;
}
