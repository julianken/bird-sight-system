import { useEffect } from 'react';
import type { View } from '../state/url-state.js';
import { REGION_LABEL } from '../config/region.js';

interface SurfaceTitleSyncProps {
  view: View;
  speciesCommonName: string | null;
}

const SITE_SUFFIX = `Bird Maps · ${REGION_LABEL}`;

function buildTitle(view: View, speciesCommonName: string | null): string {
  switch (view) {
    case 'feed':
      return `Feed — ${SITE_SUFFIX}`;
    case 'detail':
      return speciesCommonName ? `${speciesCommonName} — ${SITE_SUFFIX}` : SITE_SUFFIX;
    case 'map':
    default:
      return SITE_SUFFIX;
  }
}

/**
 * SurfaceTitleSync — renderless component that keeps <title> in sync with the
 * current surface and, on the detail surface, the selected species common name.
 *
 * Uses React 18 first-class <title> rendering (hoisted to <head> by React's
 * document metadata API). No third-party head-management library.
 *
 * Mounted once in App.tsx, just inside the top-level return. Receives view
 * from useUrlState() and speciesCommonName from the detail surface's loaded
 * species data (null when detail is loading or no species is selected).
 */
export function SurfaceTitleSync({ view, speciesCommonName }: SurfaceTitleSyncProps) {
  const title = buildTitle(view, speciesCommonName);

  // useEffect sets document.title imperatively — works in both jsdom (tests)
  // and the browser. React 18's declarative <title> rendering hoists to <head>
  // in browser builds, but jsdom does not observe it for document.title reads.
  // The imperative set is the reliable cross-environment approach.
  useEffect(() => {
    document.title = title;
  }, [title]);

  // Return null — this component has no DOM output of its own.
  return null;
}
