/**
 * <SortLabel>
 *
 * Thin sibling of <FilterSentence>. Renders the sort-prefix string on
 * the feed surface ("Sorted by recency"). Separate component per the
 * design spec: <FilterSentence> does not gain a view prop for sort.
 *
 * Returns null when label is empty or undefined.
 *
 * Spec: docs/design/01-spec/components.md (<SortLabel> sibling note)
 */
import type { ReactNode } from 'react';

export interface SortLabelProps {
  label?: string;
}

export function SortLabel({ label }: SortLabelProps): ReactNode {
  if (!label) return null;
  return <p className="sort-label">{label}</p>;
}
