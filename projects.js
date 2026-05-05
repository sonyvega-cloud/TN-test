/*! TN Projects — client-side API for the Cloudflare Worker.
 *
 *  Talks to the Worker which fronts a single GitHub Gist. All projects share
 *  the same gist, so anyone in the team sees everyone else's work — that's
 *  what we want for a presentation/demo deployment.
 *
 *  Configure WORKER_URL once. The rest is automatic.
 *
 *  Public API:
 *    TNProjects.list()                     → Promise<[indexEntry, ...]>
 *    TNProjects.load(id)                   → Promise<projectFull>
 *    TNProjects.save(project)              → Promise<projectFull> (upsert)
 *    TNProjects.delete(id)                 → Promise<void>
 *    TNProjects.autoSave(getStateFn, opts) → returns trigger() and dispose()
 *
 *  An index entry looks like:
 *    { id, name, owner, template, show, fps, duration, createdAt, updatedAt }
 *
 *  A full project looks like:
 *    { id, name, owner, template, show, fps, duration, createdAt, updatedAt,
 *      state: { ...whatever the template snapshot is... } }
 */
(function (window) {
  'use strict';

  // === CONFIG ===========================================================
  // Replace this URL after deploying the Worker. Keep the trailing slash off.
  const WORKER_URL = 'https://tn-projects-worker.sony-vega.workers.dev';

  // Optimistic local cache so list() and load() don't need to hit the network
  // every time. Cache survives across page navigations.
  const CACHE_KEY = 'tn_projects_cache_v1';

  // Auto-save debounce window. The user can change a slider 60×/sec; we don't
  // want to PATCH the gist 60×/sec. 2 seconds gives them time to settle.
  const AUTOSAVE_DEBOUNCE_MS = 2000;

  // =====================================================================

  function uuid() {
    // RFC4122-ish v4. Browser's crypto.randomUUID would be cleaner but Safari
    // didn't ship it until 15.4 — and we want max compatibility for demos.
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ window.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16)
    );
  }

  // === HTTP helpers =====================================================
  async function api(path, opts) {
    opts = opts || {};
    const r = await fetch(WORKER_URL + path, {
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); if (j.error) msg += ` — ${j.error}`; } catch (_) {}
      throw new Error(msg);
    }
    if (r.status === 204) return null;
    return await r.json();
  }

  // === Cache (localStorage, soft) =======================================
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
    catch (_) { return {}; }
  }
  function writeCache(obj) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  // === Public methods ===================================================
  async function list() {
    try {
      const idx = await api('/index');
      const projects = (idx && idx.projects) || [];
      // Update cache opportunistically
      const cache = readCache();
      cache.index = projects;
      cache.indexAt = Date.now();
      writeCache(cache);
      return projects;
    } catch (err) {
      console.warn('[projects] list failed, using cache:', err.message);
      const cache = readCache();
      return cache.index || [];
    }
  }

  async function load(id) {
    if (!id) throw new Error('load: id required');
    return await api('/project/' + encodeURIComponent(id));
  }

  async function save(project) {
    if (!project) throw new Error('save: project required');
    if (!project.id) project.id = uuid();
    if (!project.createdAt) project.createdAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    const r = await api('/project/' + encodeURIComponent(project.id), {
      method: 'PUT',
      body: project,
    });
    return r.project || project;
  }

  async function del(id) {
    if (!id) throw new Error('delete: id required');
    await api('/project/' + encodeURIComponent(id), { method: 'DELETE' });
  }

  // === Debounced auto-save ==============================================
  // `getStateFn` returns the current full project object on demand. We don't
  // capture state at autoSave() time — we capture it at trigger() time so we
  // always save the latest. If the trigger fires while a previous save is
  // still in flight, we queue exactly one more save (no chains, no flood).
  function autoSave(getStateFn, opts) {
    opts = opts || {};
    const debounce = opts.debounceMs || AUTOSAVE_DEBOUNCE_MS;
    const onSave   = opts.onSave;        // called after success: (project) => void
    const onError  = opts.onError;       // called on failure: (err) => void
    const onStart  = opts.onStart;       // called when save begins

    let timer = null;
    let inFlight = false;
    let queued = false;
    let disposed = false;

    async function actuallySave() {
      if (disposed) return;
      const proj = getStateFn();
      if (!proj) return;
      inFlight = true;
      if (onStart) try { onStart(proj); } catch (_) {}
      try {
        const saved = await save(proj);
        if (onSave) try { onSave(saved); } catch (_) {}
      } catch (err) {
        console.warn('[projects] autoSave failed:', err.message);
        if (onError) try { onError(err); } catch (_) {}
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          // Coalesce: schedule another debounced save instead of immediate
          schedule();
        }
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (inFlight) {
          // A save is already running — mark that we want one more after.
          queued = true;
        } else {
          actuallySave();
        }
      }, debounce);
    }

    return {
      // Call this on every state change.
      trigger: schedule,
      // Force-save now (e.g. on Save button click) without debounce.
      flush: async () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (inFlight) { queued = true; return; }
        await actuallySave();
      },
      dispose: () => {
        disposed = true;
        if (timer) clearTimeout(timer);
      },
    };
  }

  // === Expose ==========================================================
  window.TNProjects = {
    list,
    load,
    save,
    delete: del,
    autoSave,
    uuid,
    // For debugging:
    _config: { WORKER_URL, AUTOSAVE_DEBOUNCE_MS, CACHE_KEY },
  };
})(window);
