/*! coi-serviceworker v0.1.7 — based on https://github.com/gzuidhof/coi-serviceworker
 *  MIT-licensed. Fakes COOP/COEP headers in the browser so pages can use
 *  SharedArrayBuffer (ffmpeg.wasm 0.12+) on hosts that don't send the headers
 *  themselves (e.g. GitHub Pages).
 *
 *  How it works:
 *    1. Page loads this script. If page is already cross-origin isolated
 *       (window.crossOriginIsolated === true), do nothing.
 *    2. Otherwise, register a service worker that intercepts every fetch
 *       and rewrites response headers to include COOP=same-origin +
 *       COEP=credentialless.
 *    3. Reload the page once so the SW handles all subsequent requests —
 *       browser then exposes SharedArrayBuffer.
 *
 *  Use: <script src="coi-serviceworker.js"></script> as the FIRST script in <head>.
 *  No-op when COOP/COEP are already present (e.g. localhost via serve.py).
 */
(() => {
  const isInsideServiceWorker = typeof window === 'undefined';

  if (isInsideServiceWorker) {
    // ===== Inside the service worker =====
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'deregister') {
        self.registration.unregister()
          .then(() => self.clients.matchAll())
          .then((clients) => clients.forEach((client) => client.navigate(client.url)));
      } else if (event.data.type === 'coepCredentialless') {
        coepCredentialless = true;
      }
    });

    let coepCredentialless = true;

    self.addEventListener('fetch', (event) => {
      const r = event.request;
      // Skip cache-only-if-cached cross-origin requests (browser quirk)
      if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

      const request = coepCredentialless && r.mode === 'no-cors'
        ? new Request(r, { credentials: 'omit', cache: r.cache, redirect: r.redirect })
        : r;

      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.status === 0) return response;
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Embedder-Policy',
              coepCredentialless ? 'credentialless' : 'require-corp');
            if (!coepCredentialless) {
              newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');
            }
            newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
            return new Response(response.body, {
              status: response.status,
              statusText: response.statusText,
              headers: newHeaders,
            });
          })
          .catch((e) => console.error('[coi-sw] fetch error', e))
      );
    });
  } else {
    // ===== Inside a regular page =====
    const isCrossOriginIsolated = window.crossOriginIsolated;
    // Don't register if already isolated — server already sends the headers.
    if (isCrossOriginIsolated) {
      console.log('[coi-sw] page is already cross-origin isolated; SW not needed');
      return;
    }
    if (!('serviceWorker' in navigator)) {
      console.warn('[coi-sw] service workers not supported — SharedArrayBuffer unavailable');
      return;
    }

    // Same-origin only — SW intercepts every same-origin request
    const swUrl = new URL(document.currentScript ? document.currentScript.src : 'coi-serviceworker.js',
                          location.href).pathname;

    navigator.serviceWorker.register(swUrl, { scope: '/' }).then((registration) => {
      console.log('[coi-sw] service worker registered with scope', registration.scope);
      registration.addEventListener('updatefound', () => console.log('[coi-sw] update found'));

      // After SW is ready, if page isn't isolated yet, reload once.
      // Without this the first navigation after install still runs without SW.
      if (registration.active && !navigator.serviceWorker.controller) {
        console.log('[coi-sw] reloading to take control');
        window.location.reload();
      }
    }).catch((err) => {
      console.error('[coi-sw] service worker registration failed:', err);
    });

    // If already controlled but still not isolated, the SW is up but page
    // was loaded before it took over — reload now.
    if (navigator.serviceWorker.controller && !isCrossOriginIsolated) {
      console.log('[coi-sw] controlled but not isolated — reloading');
      window.location.reload();
    }
  }
})();
