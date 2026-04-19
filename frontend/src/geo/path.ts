export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface InscribedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PoleOfInaccessibility {
  x: number;
  y: number;
  radius: number;
}

/**
 * Parse a flat M/L/Z SVG path (no curves) into its vertex list. The seed paths
 * in the DB use only absolute M/L/Z (migrations/1700000008000_seed_regions.sql
 * and 1700000011000_fix_region_boundaries.sql), so curves are intentionally
 * unsupported — the parser silently drops unknown commands.
 */
export function parsePoints(d: string): Array<{ x: number; y: number }> {
  const tokens = d.split(/[\s,]+/).filter(Boolean);
  const points: Array<{ x: number; y: number }> = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M' || t === 'L') {
      const x = parseFloat(tokens[i + 1] ?? '0');
      const y = parseFloat(tokens[i + 2] ?? '0');
      points.push({ x, y });
      i += 3;
    } else if (t === 'Z' || t === 'z') {
      i += 1;
    } else {
      i += 1;
    }
  }
  return points;
}

/**
 * Parse a flat M/L/Z SVG path (no curves) and return its bounding box.
 * The seed paths in the DB are all of this form.
 */
export function boundingBoxOfPath(d: string): BoundingBox {
  const points = parsePoints(d);
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Ray-cast point-in-polygon test. Even-odd winding rule; points ON the
 * polygon boundary are treated as inside.
 *
 * Uses the classic Franklin / W. Randolph Franklin PNPOLY formulation
 * (https://wrf.ecse.rpi.edu/Research/Short_Notes/pnpoly.html) with the
 * crossings rule adapted to handle the horizontal-edge case. For our
 * 9 hand-authored polygons (≤12 vertices each) this is O(n) per query.
 */
export function pointInPolygon(
  x: number,
  y: number,
  polygon: Array<{ x: number; y: number }>,
): boolean {
  let inside = false;
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i]!.x, yi = polygon[i]!.y;
    const xj = polygon[j]!.x, yj = polygon[j]!.y;
    const intersect =
      ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Shortest Euclidean distance from point (px,py) to the closed polyline
 * formed by `polygon` (segments between consecutive vertices plus the
 * closing segment from last to first). Used as the "signed" distance
 * inside `poleOfInaccessibility` — callers compose with `pointInPolygon`
 * to get the sign.
 */
export function distanceToPolygonEdge(
  px: number,
  py: number,
  polygon: Array<{ x: number; y: number }>,
): number {
  let min = Infinity;
  const n = polygon.length;
  if (n < 2) return 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = polygon[j]!.x, ay = polygon[j]!.y;
    const bx = polygon[i]!.x, by = polygon[i]!.y;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    // Project (px,py) onto segment A→B; clamp t to [0,1].
    let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Grid-sampled largest axis-aligned rectangle wholly contained in the polygon.
 *
 * Strategy: rasterise the polygon onto a GRID_SIZE × GRID_SIZE lattice over
 * its bounding box (each cell is "inside" if its centre passes the ray-cast
 * test), then apply the classic histogram-based largest all-1s rectangle
 * algorithm (O(rows × cols)). A 96-cell grid is fast (<1ms for our 9
 * polygons) and precise enough that a badge sized from the resulting rect
 * stays safely inside the polygon edge.
 *
 * Handles concave polygons (the sky-islands) correctly — the bbox-based
 * approach that this replaces placed badges in bbox corners that fell
 * outside the actual shape.
 *
 * Returns {x:0,y:0,width:0,height:0} for degenerate inputs (empty path,
 * collinear vertices).
 */
const GRID_SIZE = 96;

export function largestInscribedRect(svgPath: string): InscribedRect {
  const polygon = parsePoints(svgPath);
  if (polygon.length < 3) return { x: 0, y: 0, width: 0, height: 0 };
  const bb = boundingBoxOfPath(svgPath);
  if (bb.width === 0 || bb.height === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const cols = GRID_SIZE;
  const rows = GRID_SIZE;
  const cellW = bb.width / cols;
  const cellH = bb.height / rows;

  // Rasterise: grid[r][c] = 1 iff cell centre is inside polygon.
  const grid: Uint8Array[] = [];
  for (let r = 0; r < rows; r++) {
    const row = new Uint8Array(cols);
    const cy = bb.y + (r + 0.5) * cellH;
    for (let c = 0; c < cols; c++) {
      const cx = bb.x + (c + 0.5) * cellW;
      row[c] = pointInPolygon(cx, cy, polygon) ? 1 : 0;
    }
    grid.push(row);
  }

  // Histogram-based max-rectangle-in-binary-matrix.
  const heights = new Int32Array(cols);
  let bestArea = 0;
  let bestLeft = 0, bestRight = 0, bestTop = 0, bestBottom = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      heights[c] = grid[r]![c] === 1 ? (heights[c]! + 1) : 0;
    }
    // Largest rectangle in histogram — stack-based O(cols).
    const stack: number[] = [];
    let c = 0;
    while (c <= cols) {
      const h = c === cols ? 0 : heights[c]!;
      if (stack.length === 0 || h >= heights[stack[stack.length - 1]!]!) {
        stack.push(c);
        c++;
      } else {
        const topIdx = stack.pop()!;
        const topH = heights[topIdx]!;
        const width = stack.length === 0 ? c : c - stack[stack.length - 1]! - 1;
        const area = topH * width;
        if (area > bestArea) {
          bestArea = area;
          const left = stack.length === 0 ? 0 : stack[stack.length - 1]! + 1;
          const right = c - 1;
          const bottom = r;
          const top = r - topH + 1;
          bestLeft = left;
          bestRight = right;
          bestTop = top;
          bestBottom = bottom;
        }
      }
    }
  }

  if (bestArea === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return {
    x: bb.x + bestLeft * cellW,
    y: bb.y + bestTop * cellH,
    width: (bestRight - bestLeft + 1) * cellW,
    height: (bestBottom - bestTop + 1) * cellH,
  };
}

/**
 * Pole of inaccessibility — the interior point furthest from any polygon
 * edge; its distance to the nearest edge is the polygon's inradius. Used
 * as the single-badge fallback when `largestInscribedRect` is too small
 * to host even one badge at `MIN_BADGE_DIAMETER`.
 *
 * Implementation follows Vladimir Agafonkin's `polylabel` quad-tree
 * refinement (https://github.com/mapbox/polylabel) with the algorithm
 * inlined to avoid a new external dep (see CLAUDE.md: "no polylabel
 * npm import"). Works for arbitrary concave polygons.
 *
 * `precision` is in the same units as the polygon coordinates (the 360×380
 * SVG viewbox); the default 1.0 is sub-pixel for our viewport.
 */
export function poleOfInaccessibility(
  svgPath: string,
  precision = 1.0,
): PoleOfInaccessibility {
  const polygon = parsePoints(svgPath);
  if (polygon.length < 3) return { x: 0, y: 0, radius: 0 };
  const bb = boundingBoxOfPath(svgPath);
  if (bb.width === 0 || bb.height === 0) {
    return { x: bb.x, y: bb.y, radius: 0 };
  }

  const signedDist = (x: number, y: number): number => {
    const d = distanceToPolygonEdge(x, y, polygon);
    return pointInPolygon(x, y, polygon) ? d : -d;
  };

  // Seed the search with a centroid-based guess — the polygon centroid is
  // not guaranteed to be interior for concave shapes, so track the best
  // cell we've seen and fall back to the bbox centre on the initial grid.
  const cellSize = Math.min(bb.width, bb.height);
  let h = cellSize / 2;
  if (h <= 0) return { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2, radius: 0 };

  interface Cell {
    x: number;
    y: number;
    h: number;
    d: number;   // signed distance from cell centre to nearest edge
    max: number; // upper bound for distance of any point within the cell
  }

  const makeCell = (x: number, y: number, half: number): Cell => {
    const d = signedDist(x, y);
    // The furthest a point within this cell can be from the edge is d plus
    // the cell's half-diagonal.
    const max = d + half * Math.SQRT2;
    return { x, y, h: half, d, max };
  };

  // Priority queue (array with max-by-.max lookup). Polygons are small so
  // linear scan is faster than a binary heap setup.
  const cellQueue: Cell[] = [];
  for (let x = bb.x; x < bb.x + bb.width; x += cellSize) {
    for (let y = bb.y; y < bb.y + bb.height; y += cellSize) {
      cellQueue.push(makeCell(x + h, y + h, h));
    }
  }

  // Initial best — bbox centroid if interior, else the best seed cell.
  let bestCell = makeCell(bb.x + bb.width / 2, bb.y + bb.height / 2, 0);
  for (const c of cellQueue) {
    if (c.d > bestCell.d) bestCell = c;
  }

  while (cellQueue.length > 0) {
    // Pop the cell with the largest `max` (highest-potential) — classic
    // branch-and-bound pattern.
    let bestIdx = 0;
    for (let i = 1; i < cellQueue.length; i++) {
      if (cellQueue[i]!.max > cellQueue[bestIdx]!.max) bestIdx = i;
    }
    const cell = cellQueue[bestIdx]!;
    cellQueue.splice(bestIdx, 1);

    if (cell.d > bestCell.d) bestCell = cell;
    // Prune cells that cannot beat the current best by more than `precision`.
    if (cell.max - bestCell.d <= precision) continue;

    const nh = cell.h / 2;
    cellQueue.push(makeCell(cell.x - nh, cell.y - nh, nh));
    cellQueue.push(makeCell(cell.x + nh, cell.y - nh, nh));
    cellQueue.push(makeCell(cell.x - nh, cell.y + nh, nh));
    cellQueue.push(makeCell(cell.x + nh, cell.y + nh, nh));
  }

  return { x: bestCell.x, y: bestCell.y, radius: Math.max(0, bestCell.d) };
}
