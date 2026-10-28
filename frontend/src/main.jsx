import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import { IS_PHONE } from './phone.js';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { applyTheme, resolveIsDark } from './theme.js';

applyTheme(resolveIsDark({ themeMode: 'auto' }));
// Phone: a plain page at real size (src/phone.js). It loads the phone app lazily, so the kiosk bundle is unchanged.
const PhoneApp = IS_PHONE ? React.lazy(() => import('./PhoneApp.jsx')) : null;
if (IS_PHONE) {
  document.documentElement.dataset.phone = '';
  document.documentElement.dataset.orientation = 'landscape';
} else {
  // Size the canvas for the last-used orientation before React (and settings) load.
  try { document.documentElement.dataset.orientation = localStorage.getItem('orientation') || 'landscape'; } catch { /* private mode */ }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {IS_PHONE ? <Suspense fallback={null}><PhoneApp /></Suspense> : <App />}
    </ErrorBoundary>
  </React.StrictMode>
);

// Register service worker for offline PWA support (production only)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        console.log('[SW] Registered, scope:', reg.scope);
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
      });
  });
}
