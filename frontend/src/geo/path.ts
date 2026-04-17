export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Parse a flat M/L/Z SVG path (no curves) and return its bounding box.
 * The seed paths in the DB are all of this form.
 */
export function boundingBoxOfPath(d: string): BoundingBox {
  const tokens = d.split(/[\s,]+/).filter(Boolean);
  let i = 0;
  const xs: number[] = [];
  const ys: number[] = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === 'M' || t === 'L') {
      const x = parseFloat(tokens[i + 1] ?? '0');
      const y = parseFloat(tokens[i + 2] ?? '0');
      xs.push(x); ys.push(y);
      i += 3;
    } else if (t === 'Z' || t === 'z') {
      i += 1;
    } else {
      i += 1;
    }
  }
  if (xs.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
