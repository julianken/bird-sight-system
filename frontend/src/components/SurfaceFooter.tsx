/**
 * Per-surface attribution footer for the FeedSurface, SpeciesSearchSurface,
 * and SpeciesDetailSurface non-map surfaces.
 *
 * Why one shared component (not three copy-pasted footers): the AttributionModal
 * lands in #250 and retires this surface-level footer. Keeping the markup in
 * one place means the migration is a single import/element removal per
 * consuming surface, not a file-by-file refactor.
 *
 * Why the map surface intentionally does NOT render this: the map's eBird
 * credit is rendered inside the maplibre `AttributionControl` alongside OSM
 * and OpenFreeMap (see `MapCanvas.tsx`). Adding a second surface-level footer
 * on top of the map would be redundant and visually noisy.
 *
 * Why `rel="noopener"` and not `rel="noopener noreferrer"`: matches the
 * existing OSM and OpenFreeMap entries in `MapCanvas.tsx`'s
 * `customAttribution` array (lines 168-169). One convention across all
 * eBird/OSM/OpenFreeMap credits in the app — the AttributionModal in #250
 * inherits the same convention so the rel attribute does not diverge between
 * surface footer and modal during the transition window.
 *
 * Compliance citation: eBird API Terms of Use §3 — "You agree to attribute
 * eBird.org as the source of the data accessed via the API wherever it is used
 * or displayed… please accompany this with a link back to eBird.org."
 */
export function SurfaceFooter() {
  return (
    <footer className="surface-footer">
      Bird data:{' '}
      <a href="https://ebird.org" target="_blank" rel="noopener">
        eBird
      </a>{' '}
      (Cornell Lab of Ornithology)
    </footer>
  );
}
