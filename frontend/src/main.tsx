import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
// Importing for the side effect: `analytics.ts` reads `VITE_POSTHOG_KEY`
// and (when present) calls `posthog.init` once at app startup. When the
// key is empty, the import is a strict no-op — posthog.init is never
// called and no console warnings are emitted (issue #357 task 2).
import './analytics.js';
// Importing for the side effect: `clarity.ts` reads `VITE_CLARITY_PROJECT_ID`
// and (in production builds only) calls `Clarity.init` once at app
// startup. When the env var is empty OR the build is non-production, the
// import is a strict no-op (issue #657).
import './clarity.js';
import './styles/tokens.css';
import './styles.css';
import './styles/motion.css';
import './components/ds/ds-primitives.css';

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
