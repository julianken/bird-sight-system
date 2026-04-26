/**
 * Generic placeholder SVG path used when a family has no Phylopic silhouette.
 * A near-perfect circle (tiny offset avoids degenerate arc) keeps the marker
 * legible at any zoom level without needing a real bird outline. The 0.0001
 * offset prevents SVG renderers from collapsing the arc to a zero-length line.
 */
export const FALLBACK_SILHOUETTE_PATH = 'M12 4 a8 8 0 1 0 0.0001 0 z';
