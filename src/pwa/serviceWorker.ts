/**
 * Service-worker registration.
 *
 * The worker itself lives at `public/sw.js` and owns Trainer's offline cache.
 * It is registered from the production bundle only, so it never fights Vite's
 * HMR during development.
 */

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    void navigator.serviceWorker.ready.then((ready) => {
      ready.active?.postMessage({ type: 'cache-media' });
    });
    return registration;
  } catch {
    return null;
  }
}
