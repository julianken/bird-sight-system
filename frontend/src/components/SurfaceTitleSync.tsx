import { useEffect } from 'react';
import type { View } from '../state/url-state.js';

interface SurfaceTitleSyncProps {
  view: View;
  speciesCommonName: string | null;
  /**
   * #738/C5: runtime region label for the active scope (from `regionLabelFor`).
   * `null` ⟺ the unscoped/chooser landing — the site suffix falls back to
   * "Bird Maps" (no ` · {region}`) so document.title never reads "Bird Maps · ".
   */
  region: string | null;
}

// #738/C5: SITE_SUFFIX is now runtime — when unscoped (region=null) it is just
// "Bird Maps", never a trailing " · " with no region after it.
function buildTitle(
  view: View,
  speciesCommonName: string | null,
  region: string | null,
): string {
  const siteSuffix = region ? `Bird Maps · ${region}` : 'Bird Maps';
  switch (view) {
    case 'detail':
      return speciesCommonName ? `${speciesCommonName} — ${siteSuffix}` : siteSuffix;
    case 'map':
    default:
      return siteSuffix;
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
export function SurfaceTitleSync({ view, speciesCommonName, region }: SurfaceTitleSyncProps) {
  const title = buildTitle(view, speciesCommonName, region);

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
