/**
 * Generic placeholder SVG path used when a family has no Phylopic silhouette.
 * A near-perfect circle (tiny offset avoids degenerate arc) keeps the marker
 * legible at any zoom level without needing a real bird outline. The 0.0001
 * offset prevents SVG renderers from collapsing the arc to a zero-length line.
 */
export const FALLBACK_SILHOUETTE_PATH = 'M12 4 a8 8 0 1 0 0.0001 0 z';

/**
 * Charset whitelist for the SVG `path` element's `d` attribute. Restricts
 * input to the SVG path-data grammar's terminal characters: command letters
 * (MmLlHhVvCcSsQqTtAaZz), digits, decimal/sign separators (`. , - +`),
 * scientific-notation `eE`, and ASCII space. Anything outside this set —
 * notably `<`, `>`, `"`, `&`, `/`, alphabetic chars beyond the command set,
 * or null bytes — fails the check.
 *
 * The allowlist intentionally excludes whitespace beyond ASCII space (no
 * tabs, newlines, CR). Real Phylopic-derived path-d strings ship as a
 * single-line value, so any embedded newline indicates corruption.
 */
const SVG_PATH_DATA_REGEX = /^[MmLlHhVvCcSsQqTtAaZz0-9 ,.\-+eE]+$/;

/**
 * Validate that a string matches the SVG path-data charset. Used at the
 * blob-construction site in `MapCanvas.silhouettePathToSvg` (issue #271):
 * a malformed `svgData` containing `<`, `>`, or `"` would either silently
 * corrupt the surrounding SVG document — causing `image.decode()` to reject
 * and the family to fall back to `_FALLBACK` with no diagnostic — or in a
 * worse case, open an XSS surface if the SVG ever rendered through an
 * `innerHTML` path (none currently exist, but the validator pre-empts that
 * regression).
 *
 * Returns `true` for valid input (proceed with interpolation), `false` for
 * any character outside the charset (consumer should log a warn naming the
 * family code and substitute `FALLBACK_SILHOUETTE_PATH`).
 *
 * Empty strings are rejected — the SVG path-data grammar requires at least
 * one moveto command.
 */
export function isValidSvgPathData(s: string): boolean {
  return SVG_PATH_DATA_REGEX.test(s);
}
