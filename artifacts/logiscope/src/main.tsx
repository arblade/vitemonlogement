import { createRoot } from 'react-dom/client';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import { reloadOnStaleBuild } from '@/lib/stale-build';

import './index.css';

// Onglet resté ouvert pendant un déploiement : un fichier chargé à la demande n'existe plus, on recharge la page.
window.addEventListener('vite:preloadError', event => { reloadOnStaleBuild(event); });

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
