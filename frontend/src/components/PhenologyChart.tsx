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

const MONTH_ABBRS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const VIEWBOX_WIDTH = 216; // 12 months × 18px slot width
// 80px bar area + 28px label gutter (24px to fit a rotated 3-letter string at
// font-size="9" plus a 4px gap between bar floor and label baseline).
const VIEWBOX_HEIGHT = 108;
const BAR_AREA_HEIGHT = 80; // bars scale within this; gutter sits below
const SLOT_WIDTH = 18;
const BAR_PADDING = 2; // each side; bar width = SLOT_WIDTH - 2*BAR_PADDING
// 10% of viewBox height — the formula keeps the historical "muted bars are
// ~one tenth of the chart" relationship intact even though the absolute
// pixel value moves from 8 → 11 with the gutter addition.
const PLACEHOLDER_HEIGHT = Math.round(VIEWBOX_HEIGHT * 0.1);

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
 *   - empty:   12 muted placeholder bars at 10% viewBox height — gives the
 *              user a visible "no data" affordance without a textual stub.
 *              Month labels still render under the bars for orientation.
 *   - data:    12 <rect>s with heights scaled to max(count) in the dataset,
 *              plus 12 rotated <text> labels (Jan…Dec) below the bar area
 *
 * Bar heights scale to `max(count)` per dataset (not a global cap), so the
 * shape of the seasonality curve is what the eye reads — not the absolute
 * volume across species. Bars occupy the top 80 viewBox units; the bottom
 * 28 are reserved for the month-label gutter.
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
          // Scale bar height to dataset max within the bar area (the top
          // 80px). count=0 months render at height=0 (no bar drawn), which
          // is the desired "this month had zero observations" affordance
          // against the active months. The bottom 28px is reserved for the
          // month-label gutter and is not available to bars.
          height = max === 0 ? 0 : Math.round((d.count / max) * BAR_AREA_HEIGHT);
          className = 'phenology-bar';
        }
        const y = BAR_AREA_HEIGHT - height;
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
              {`${MONTH_ABBRS[i]}: ${d.count} observation${d.count === 1 ? '' : 's'}`}
            </title>
          </rect>
        );
      })}
      {/* Visible month labels — 3-letter abbreviations rotated -45° so they
          fit at 18px slot width without horizontal overlap. aria-hidden so
          axe and screen readers don't double-announce against the SVG's
          aria-label and the per-bar <title> tooltips. */}
      {filled.map((d, i) => {
        const x = i * SLOT_WIDTH + SLOT_WIDTH / 2;
        const y = BAR_AREA_HEIGHT + 2; // 2px gap below bar floor
        return (
          <text
            key={`label-${d.month}`}
            className="phenology-label"
            x={x}
            y={y}
            textAnchor="end"
            fontSize="9"
            transform={`rotate(-45, ${x}, ${y})`}
            aria-hidden="true"
          >
            {MONTH_ABBRS[i]}
          </text>
        );
      })}
    </svg>
  );
}
