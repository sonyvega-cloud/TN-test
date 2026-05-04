/*! coi-serviceworker — based on https://github.com/gzuidhof/coi-serviceworker (MIT)
 *
 *  WHAT IT DOES
 *  Fakes COOP/COEP response headers in the browser so pages can use
 *  SharedArrayBuffer (ffmpeg.wasm 0.12+, etc.) on hosts that don't send the
 *  headers themselves (e.g. GitHub Pages).
 *
 *  HOW IT WORKS
 *    1. Page loads this script. If page is already cross-origin isolated
 *       (window.crossOriginIsolated === true), do nothing.
 *    2. Otherwise, register a service worker that intercepts every fetch
 *       and rewrites response headers to include COOP=same-origin +
 *       COEP=credentialless.
 *    3. Reload the page once so the SW handles all subsequent requests —
 *       browser then exposes SharedArrayBuffer.
 *
 *  ROBUSTNESS
 *    • Scope = same directory as the SW file (works on GitHub Pages subpaths
 *      like /TN-test/, NOT scope:'/' which subpaths cannot use).
 *    • Reload loop guard via sessionStorage — gives up after 2 attempts so
 *      the page never reloads forever on a misconfigured host.
 *    • Bail-out: when SW can't deliver isolation, page still loads. ffmpeg
 *      will fail loudly with a clear error instead of a hang.
 *
 *  Use: <script src="coi-serviceworker.js"></script> as the FIRST script in <head>.
 *  No-op when COOP/COEP are already present (e.g. localhost via serve.py).
 */
(() => {
  const isInsideServiceWorker = typeof window === 'undefined';

  if (isInsideServiceWorker) {
    // ============================================================
    // INSIDE THE SERVICE WORKER
    // ============================================================
    self.addEventListener('install', () => self.skipWaiting());
    self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

    self.addEventListener('message', (event) => {
      if (!event.data) return;
      if (event.data.type === 'deregister') {
        self.registration.unregister()
          .then(() => self.clients.matchAll())
          .then((clients) => clients.forEach((client) => client.navigate(client.url)));
      }
    });

    self.addEventListener('fetch', (event) => {
      const r = event.request;
      // Skip cache-only-if-cached cross-origin requests (Chrome quirk)
      if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

      // For no-cors requests, omit credentials so browsers won't reject the
      // response under the credentialless COEP policy.
      const request = (r.mode === 'no-cors')
        ? new Request(r, { credentials: 'omit', cache: r.cache, redirect: r.redirect })
        : r;

      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.status === 0) return response;
            const newHeaders = new Headers(response.headers);
            newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless');
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
    // ============================================================
    // INSIDE A REGULAR PAGE
    // ============================================================

    // ---- Bail-out 1: already isolated → server sends headers, SW unneeded
    if (window.crossOriginIsolated) {
      console.log('[coi-sw] page is already cross-origin isolated; SW not needed');
      // Clear any stale reload counter from prior pageloads
      try { sessionStorage.removeItem('coi-reloads'); } catch (_) {}
      return;
    }

    // ---- Bail-out 2: no SW support
    if (!('serviceWorker' in navigator)) {
      console.warn('[coi-sw] service workers not supported — SharedArrayBuffer unavailable');
      return;
    }

    // ---- Bail-out 3: reload loop detected → give up gracefully
    const RELOAD_KEY = 'coi-reloads';
    let reloads = 0;
    try { reloads = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0; } catch (_) {}
    if (reloads >= 2) {
      console.error('[coi-sw] reload loop detected after ' + reloads + ' attempts — giving up. ' +
        'SharedArrayBuffer will be unavailable. Try Application → Service Workers → Unregister, ' +
        'then Clear site data, then reload.');
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
      return;
    }

    // ---- Resolve absolute URL of THIS script (used for SW URL + scope)
    const scriptEl = document.currentScript;
    const scriptUrl = scriptEl ? new URL(scriptEl.src, location.href) : new URL('coi-serviceworker.js', location.href);
    const scriptPath = scriptUrl.pathname;
    // Scope = directory containing the SW file. On GitHub Pages this is e.g.
    // "/TN-test/" not "/", which is the only scope GHP allows.
    const scopePath = scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1);

    console.log('[coi-sw] registering · sw=' + scriptPath + ' · scope=' + scopePath + ' · attempt=' + (reloads + 1));

    navigator.serviceWorker.register(scriptPath, { scope: scopePath })
      .then((registration) => {
        console.log('[coi-sw] SW registered with scope', registration.scope);

        // Decide whether to reload to bring page under SW control.
        // Two cases require a reload:
        //   (a) SW was just installed and the page isn't yet controlled
        //   (b) page is controlled but still not isolated (rare — usually
        //       means a sub-resource is breaking isolation)
        const needsReload =
          (registration.active && !navigator.serviceWorker.controller) ||
          (navigator.serviceWorker.controller && !window.crossOriginIsolated);

        if (needsReload) {
          try { sessionStorage.setItem(RELOAD_KEY, String(reloads + 1)); } catch (_) {}
          console.log('[coi-sw] reloading once to take control (attempt ' + (reloads + 1) + '/2)');
          window.location.reload();
        }
        // If page IS already controlled and isolated check failed earlier,
        // the bail-out at top will have returned. Otherwise just wait — next
        // navigation/refresh will be controlled.
      })
      .catch((err) => {
        console.error('[coi-sw] registration failed:', err);
      });
  }
})();
