import React, { useCallback, useMemo, useRef, useState } from 'react';
import Map, { Source, Layer, Popup, NavigationControl } from 'react-map-gl/maplibre';
import type { MapRef, MapLayerMouseEvent } from 'react-map-gl/maplibre';
import type { GeoJSON } from 'geojson';

interface Observation {
  subId: string;
  speciesCode: string;
  comName: string;
  lat: number;
  lng: number;
  obsDt: string;
  locId: string;
  locName: string | null;
  howMany: number | null;
  isNotable: boolean;
  regionId: string | null;
  silhouetteId: string | null;
}

interface PopupInfo {
  lng: number;
  lat: number;
  comName: string;
  locName: string | null;
  obsDt: string;
  isNotable: boolean;
  howMany: number | null;
}

const CLUSTER_LAYER_ID = 'clusters';
const UNCLUSTERED_LAYER_ID = 'unclustered-point';

// OpenFreeMap style URL (no token needed)
// NOTE: 'liberty' style emits a MapLibre warning ("Expected value to be of type
// number, but found null") — upstream style bug.  'positron' is clean.
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export default function MapCanvas({ observations }: { observations: Observation[] }) {
  const mapRef = useRef<MapRef>(null);
  const [popupInfo, setPopupInfo] = useState<PopupInfo | null>(null);

  const geojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: observations.map((obs) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [obs.lng, obs.lat],
      },
      properties: {
        subId: obs.subId,
        comName: obs.comName,
        locName: obs.locName ?? '',
        obsDt: obs.obsDt,
        isNotable: obs.isNotable ? 1 : 0,
        howMany: obs.howMany ?? 0,
      },
    })),
  }), [observations]);

  const onClick = useCallback((e: MapLayerMouseEvent) => {
    const mapWrapper = mapRef.current;
    if (!mapWrapper) return;
    const map = mapWrapper.getMap();

    const point: [number, number] = [e.point.x, e.point.y];

    // Cluster click -> zoom in
    try {
      const clusterFeatures = map.queryRenderedFeatures(point, {
        layers: [CLUSTER_LAYER_ID],
      });
      if (clusterFeatures.length > 0) {
        const feature = clusterFeatures[0];
        const src = map.getSource('observations');
        if (src && 'getClusterExpansionZoom' in src) {
          const clusterId = feature.properties?.cluster_id as number;
          (src as any).getClusterExpansionZoom(clusterId).then((zoom: number) => {
            const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
            map.easeTo({ center: [lng, lat], zoom });
          });
        }
        return;
      }
    } catch {
      // Layer might not exist yet during initial render
    }

    // Individual point click -> show popup
    try {
      const pointFeatures = map.queryRenderedFeatures(point, {
        layers: [UNCLUSTERED_LAYER_ID],
      });
      if (pointFeatures.length > 0) {
        const feature = pointFeatures[0];
        const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
        setPopupInfo({
          lng,
          lat,
          comName: feature.properties?.comName ?? 'Unknown',
          locName: feature.properties?.locName || null,
          obsDt: feature.properties?.obsDt ?? '',
          isNotable: feature.properties?.isNotable === 1,
          howMany: feature.properties?.howMany ?? null,
        });
        return;
      }
    } catch {
      // Layer might not exist yet during initial render
    }

    // Click on empty area — close any open popup
    setPopupInfo(null);
  }, []);

  return (
    <Map
      ref={mapRef}
      initialViewState={{
        longitude: -111.5,
        latitude: 33.0,
        zoom: 6,
      }}
      style={{ width: '100%', height: '100%' }}
      mapStyle={MAP_STYLE}
      onClick={onClick}
      interactiveLayerIds={[CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID]}
    >
      <NavigationControl position="top-right" />

      <Source
        id="observations"
        type="geojson"
        data={geojson}
        cluster={true}
        clusterMaxZoom={14}
        clusterRadius={50}
      >
        {/* Cluster circles — sized and colored by point_count */}
        <Layer
          id={CLUSTER_LAYER_ID}
          type="circle"
          filter={['has', 'point_count']}
          paint={{
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#51bbd6',   // 0-9: light blue
              10, '#f1f075', // 10-24: yellow
              25, '#f28cb1', // 25+: pink
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              18,          // 0-9: 18px
              10, 24,      // 10-24: 24px
              25, 32,      // 25+: 32px
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          }}
        />

        {/* Cluster count labels */}
        <Layer
          id="cluster-count"
          type="symbol"
          filter={['has', 'point_count']}
          layout={{
            'text-field': ['get', 'point_count_abbreviated'],
            'text-font': ['Noto Sans Regular'],
            'text-size': 13,
            'text-allow-overlap': true,
          }}
          paint={{
            'text-color': '#333',
          }}
        />

        {/* Unclustered individual points — colored by isNotable */}
        <Layer
          id={UNCLUSTERED_LAYER_ID}
          type="circle"
          filter={['!', ['has', 'point_count']]}
          paint={{
            'circle-color': [
              'case',
              ['==', ['get', 'isNotable'], 1],
              '#e74c3c',  // red for notable
              '#3498db',  // blue for regular
            ],
            'circle-radius': 7,
            'circle-stroke-width': 1.5,
            'circle-stroke-color': '#fff',
          }}
        />
      </Source>

      {popupInfo && (
        <Popup
          longitude={popupInfo.lng}
          latitude={popupInfo.lat}
          anchor="bottom"
          onClose={() => setPopupInfo(null)}
          closeOnClick={false}
          style={{ zIndex: 10 }}
        >
          <div style={{ fontFamily: 'system-ui, sans-serif', fontSize: 14, lineHeight: 1.4 }}>
            <strong>{popupInfo.comName}</strong>
            {popupInfo.isNotable && (
              <span style={{
                marginLeft: 6,
                background: '#e74c3c',
                color: '#fff',
                borderRadius: 4,
                padding: '1px 5px',
                fontSize: 11,
                fontWeight: 600,
              }}>
                Notable
              </span>
            )}
            {popupInfo.locName && <div style={{ color: '#666', marginTop: 2 }}>{popupInfo.locName}</div>}
            <div style={{ color: '#888', marginTop: 2 }}>{popupInfo.obsDt}</div>
            {popupInfo.howMany != null && (
              <div style={{ color: '#888' }}>Count: {popupInfo.howMany}</div>
            )}
          </div>
        </Popup>
      )}
    </Map>
  );
}
