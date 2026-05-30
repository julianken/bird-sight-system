/**
 * <SortLabel>
 *
 * Thin sibling of <FilterSentence>. Renders the sort-prefix string
 * ("Sorted by recency"). Separate component per the design spec:
 * <FilterSentence> does not gain a view prop for sort.
 *
 * Accepts either:
 *   - `label` prop (string): rendered as-is.
 *   - `mode` prop ('recent' | 'taxonomic'): mapped to a human-readable label.
 *
 * Returns null when label is empty or undefined.
 *
 * Spec: docs/design/01-spec/components.md (<SortLabel> sibling note)
 */
import type { ReactNode } from 'react';

export type SortMode = 'recent' | 'taxonomic';

const MODE_LABELS: Record<SortMode, string> = {
  recent: 'Sorted by recency',
  taxonomic: 'Sorted taxonomically',
};

export interface SortLabelProps {
  label?: string;
  mode?: SortMode;
}

export function SortLabel({ label, mode }: SortLabelProps): ReactNode {
  const resolved = label ?? (mode ? MODE_LABELS[mode] : undefined);
  if (!resolved) return null;
  return <p className="sort-label">{resolved}</p>;
}
