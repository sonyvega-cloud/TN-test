/*! coi-serviceworker v2 — based on https://github.com/gzuidhof/coi-serviceworker (MIT)
 *
 *  Fakes COOP/COEP response headers in the browser so pages can use
 *  SharedArrayBuffer (ffmpeg.wasm 0.12+) on hosts that don't send the
 *  headers themselves (e.g. GitHub Pages).
 *
 *  CRITICAL FIX vs v1: scope is computed dynamically from the SW path, NOT
 *  hardcoded to '/'. On GitHub Pages with subpath /TN-test/, scope:'/' is
 *  rejected by the browser (SecurityError). v2 uses the SW's own directory.
 *
 *  Also cleans up any STALE SW registrations from older broken versions
 *  before registering anew.
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
          .then((clients) => clients.forEach((c) => c.navigate(c.url)));
      }
    });

    self.addEventListener('fetch', (event) => {
      const r = event.request;
      if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;

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
    return;
  }

  // ============================================================
  // INSIDE A REGULAR PAGE
  // ============================================================

  // ---- Bail-out 1: already isolated → server sends headers, SW unneeded
  if (window.crossOriginIsolated) {
    console.log('[coi-sw v2] already cross-origin isolated; SW not needed');
    try { sessionStorage.removeItem('coi-reloads'); } catch (_) {}
    return;
  }

  // ---- Bail-out 2: no SW support
  if (!('serviceWorker' in navigator)) {
    console.warn('[coi-sw v2] service workers not supported — SharedArrayBuffer unavailable');
    return;
  }

  // ---- Reload loop guard
  const RELOAD_KEY = 'coi-reloads';
  let reloads = 0;
  try { reloads = parseInt(sessionStorage.getItem(RELOAD_KEY) || '0', 10) || 0; } catch (_) {}
  if (reloads >= 3) {
    console.error('[coi-sw v2] reload loop detected after ' + reloads + ' attempts — giving up. ' +
      'SharedArrayBuffer will be unavailable. Try Application → Service Workers → Unregister all, ' +
      'then Application → Storage → Clear site data, then reload.');
    try { sessionStorage.removeItem(RELOAD_KEY); } catch (_) {}
    return;
  }

  // ---- Resolve absolute URL of THIS script + correct scope
  const scriptEl = document.currentScript;
  const scriptUrl = scriptEl
    ? new URL(scriptEl.src, location.href)
    : new URL('coi-serviceworker.js', location.href);
  const scriptPath = scriptUrl.pathname;
  // Scope = directory containing the SW file. On GitHub Pages this is e.g.
  // "/TN-test/" not "/", which is the only scope GHP allows.
  const scopePath = scriptPath.substring(0, scriptPath.lastIndexOf('/') + 1);
  const wantedScopeUrl = new URL(scopePath, location.origin).href;

  // ---- Cleanup STALE SW registrations + register correctly
  (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      let cleaned = 0;
      for (const reg of regs) {
        const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (swUrl.endsWith('/coi-serviceworker.js')) {
          // Unregister anything that doesn't match our wanted scope (= old broken v1 with scope:/)
          if (reg.scope !== wantedScopeUrl) {
            console.log('[coi-sw v2] removing stale SW registration · scope=' + reg.scope);
            await reg.unregister();
            cleaned++;
          }
        }
      }
      if (cleaned > 0) {
        try { sessionStorage.setItem(RELOAD_KEY, String(reloads + 1)); } catch (_) {}
        console.log('[coi-sw v2] cleaned ' + cleaned + ' stale registration(s); reloading');
        window.location.reload();
        return;
      }
    } catch (err) {
      console.warn('[coi-sw v2] cleanup error (non-fatal):', err);
    }

    // ---- Register the SW with the correct scope
    console.log('[coi-sw v2] registering · sw=' + scriptPath + ' · scope=' + scopePath +
                ' · attempt=' + (reloads + 1) + '/3');

    try {
      const registration = await navigator.serviceWorker.register(scriptPath, { scope: scopePath });
      console.log('[coi-sw v2] SW registered · scope=' + registration.scope);

      const needsReload =
        (registration.active && !navigator.serviceWorker.controller) ||
        (navigator.serviceWorker.controller && !window.crossOriginIsolated);

      if (needsReload) {
        try { sessionStorage.setItem(RELOAD_KEY, String(reloads + 1)); } catch (_) {}
        console.log('[coi-sw v2] reloading to take control (attempt ' + (reloads + 1) + '/3)');
        window.location.reload();
      }
    } catch (err) {
      console.error('[coi-sw v2] registration failed:', err);
    }
  })();
})();
