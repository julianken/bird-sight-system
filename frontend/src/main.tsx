import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
import { analytics } from './analytics.js';
// Importing for the side effect: `clarity.ts` reads `VITE_CLARITY_PROJECT_ID`
// and (in production builds only) calls `Clarity.init` once at app
// startup. When the env var is empty OR the build is non-production, the
// import is a strict no-op (issue #657).
import './clarity.js';
import './styles/tokens.css';
import './styles.css';
import './styles/motion.css';
import './components/ds/ds-primitives.css';

// Dev/test-only analytics spy hook (T3 #909). Exposes the singleton `analytics`
// object on `window` so e2e specs can wrap `window.analytics.capture` and assert
// events that otherwise have no observable surface in dev (Clarity is never
// init'd outside production builds, so `analytics.capture` is a silent no-op).
// Because components import the SAME `analytics` object, replacing its `capture`
// property via `window.analytics` is observed by every call site. Gated by
// `import.meta.env.DEV` → tree-shaken entirely from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { analytics?: typeof analytics }).analytics = analytics;
}

// Dev-only design-system preview shim. Activated by ?ds-preview=<key>.
// import.meta.env.DEV is false in production builds (tree-shaken entirely).
let root: React.ReactNode = <App />;
if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('ds-preview')) {
  const { DsPreview } = await import('./dev/DsPreview.js');
  root = <DsPreview />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>
);
