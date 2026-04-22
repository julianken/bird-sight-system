import React from 'react';
import MapCanvas from './MapCanvas';
import observations from '../fixtures/observations.json';
import 'maplibre-gl/dist/maplibre-gl.css';

export default function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <MapCanvas observations={observations} />
    </div>
  );
}
