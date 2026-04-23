import type { StyleSpecification } from 'maplibre-gl';

/**
 * Minimal basemap style pointing at the S2 tile endpoint.
 *
 * Until S2 (tile infrastructure) merges, the URL will 404 — that's expected
 * for unwired S3. MapLibre renders an empty canvas with the background colour
 * and logs a fetch error; cluster/point layers still render correctly against
 * the transparent background, which is all the unit tests need.
 */
export const basemapStyle: StyleSpecification = {
  version: 8,
  name: 'bird-maps-basemap',
  sources: {
    'bird-maps-tiles': {
      type: 'vector',
      tiles: ['https://tiles.bird-maps.com/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
    },
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#f4f1ea', // matches --color-bg-page
      },
    },
  ],
};
