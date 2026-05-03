import { useEffect, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client.js';

export interface PhenologyChartProps {
  speciesCode: string;
  apiClient: ApiClient;
}

interface PhenologyState {
  loading: boolean;
  error: boolean;
  data: Array<{ month: number; count: number }> | null;
}

const MONTH_LABELS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const VIEWBOX_WIDTH = 216; // 12 months × 18px slot width
const VIEWBOX_HEIGHT = 80;
const SLOT_WIDTH = 18;
const BAR_PADDING = 2; // each side; bar width = SLOT_WIDTH - 2*BAR_PADDING
const PLACEHOLDER_HEIGHT = Math.round(VIEWBOX_HEIGHT * 0.1); // 10% → 8

/**
 * Zero-fills a server's sparse phenology response (only months with non-zero
 * counts) to exactly 12 entries. Always returns months 1..12 in order.
 */
function zeroFill(
  rows: Array<{ month: number; count: number }>,
): Array<{ month: number; count: number }> {
  const byMonth = new Map<number, number>();
  for (const row of rows) {
    byMonth.set(row.month, row.count);
  }
  const filled: Array<{ month: number; count: number }> = [];
  for (let m = 1; m <= 12; m++) {
    filled.push({ month: m, count: byMonth.get(m) ?? 0 });
  }
  return filled;
}

/**
 * Per-species phenology chart — 12 monthly observation-count bars rendered
 * as inline SVG (no chart library). Mounted inside SpeciesDetailSurface's
 * `data && (...)` block.
 *
 * Rendering branches:
 *   - loading: <p role="status">Loading phenology…</p>
 *   - error:   returns null (the surrounding surface stays usable)
 *   - empty:   12 muted placeholder bars at 10% viewport height — gives the
 *              user a visible "no data" affordance without a textual stub
 *   - data:    12 <rect>s with heights scaled to max(count) in the dataset
 *
 * Bar heights scale to `max(count)` per dataset (not a global cap), so the
 * shape of the seasonality curve is what the eye reads — not the absolute
 * volume across species.
 */
export function PhenologyChart(props: PhenologyChartProps): JSX.Element | null {
  const { speciesCode, apiClient } = props;
  const [state, setState] = useState<PhenologyState>({
    loading: true,
    error: false,
    data: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: false, data: null });
    apiClient
      .getPhenology(speciesCode)
      .then((rows) => {
        if (cancelled) return;
        setState({ loading: false, error: false, data: rows });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ loading: false, error: true, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [apiClient, speciesCode]);

  const filled = useMemo(
    () => (state.data ? zeroFill(state.data) : null),
    [state.data],
  );

  if (state.loading) {
    return (
      <p className="phenology-chart-loading" role="status" aria-live="polite">
        Loading phenology…
      </p>
    );
  }

  if (state.error || !filled) {
    return null;
  }

  const max = Math.max(0, ...filled.map((d) => d.count));
  const isEmpty = max === 0;

  return (
    <svg
      className="phenology-chart"
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      role="img"
      aria-label="Monthly phenology — observations per month"
      focusable="false"
    >
      {filled.map((d, i) => {
        const x = i * SLOT_WIDTH + BAR_PADDING;
        const barWidth = SLOT_WIDTH - 2 * BAR_PADDING;
        let height: number;
        let className: string;
        if (isEmpty) {
          height = PLACEHOLDER_HEIGHT;
          className = 'phenology-bar phenology-bar-empty';
        } else {
          // Scale bar height to dataset max. count=0 months render at height=0
          // (no bar drawn), which is the desired "this month had zero
          // observations" affordance against the active months.
          height = max === 0 ? 0 : Math.round((d.count / max) * VIEWBOX_HEIGHT);
          className = 'phenology-bar';
        }
        const y = VIEWBOX_HEIGHT - height;
        return (
          <rect
            key={d.month}
            className={className}
            x={x}
            y={y}
            width={barWidth}
            height={height}
          >
            <title>
              {`${MONTH_LABELS[i]}: ${d.count} observation${d.count === 1 ? '' : 's'}`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}
