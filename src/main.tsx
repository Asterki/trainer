import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registerServiceWorker } from './pwa/serviceWorker';
import { TrainerProvider } from './state/store';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found.');

createRoot(container).render(
  <StrictMode>
    <TrainerProvider>
      <App />
    </TrainerProvider>
  </StrictMode>,
);

// The service worker powers offline use. It is only registered in production
// builds so it never fights Vite's HMR.
if (import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void registerServiceWorker();
  });
}
