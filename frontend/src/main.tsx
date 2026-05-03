import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.js';
// Importing for the side effect: `analytics.ts` reads `VITE_POSTHOG_KEY`
// and (when present) calls `posthog.init` once at app startup. When the
// key is empty, the import is a strict no-op — posthog.init is never
// called and no console warnings are emitted (issue #357 task 2).
import './analytics.js';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
