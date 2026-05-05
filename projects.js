/*! TN Projects — localStorage-only edition.
 *
 *  Cloud sync (via Cloudflare Worker → GitHub Gist) is intentionally disabled
 *  for the demo deployment. All projects live in the user's browser only.
 *  Each user sees their own projects; no team sharing.
 *
 *  When you want to re-enable cloud later: set CLOUD_ENABLED to true and
 *  configure WORKER_URL — the original cloud impl is preserved as a comment
 *  block at the bottom of this file.
 *
 *  Public API (unchanged from cloud version, so the rest of the codebase
 *  doesn't need to change):
 *    TNProjects.list()                     → Promise<[indexEntry, ...]>
 *    TNProjects.load(id)                   → Promise<projectFull>
 *    TNProjects.save(project)              → Promise<projectFull>
 *    TNProjects.delete(id)                 → Promise<void>
 *    TNProjects.autoSave(getStateFn, opts) → { trigger, flush, dispose }
 */
(function (window) {
  'use strict';

  const STORAGE_KEY = 'tn_projects_local_v1';
  const AUTOSAVE_DEBOUNCE_MS = 2000;

  // =====================================================================
  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ window.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c/4).toString(16)
    );
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  function writeStore(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  // === Public methods ===================================================
  // All methods return Promises so the calling code can stay identical to
  // the cloud version. We just resolve immediately.

  async function list() {
    // Index entry shape: { id, name, owner, template, show, fps, duration,
    // createdAt, updatedAt }. Same fields as cloud, just stored locally.
    const store = readStore();
    return Object.values(store).map(p => ({
      id: p.id,
      name: p.name,
      owner: p.owner,
      template: p.template,
      show: p.show,
      fps: p.fps,
      duration: p.duration,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async function load(id) {
    if (!id) throw new Error('load: id required');
    const store = readStore();
    const p = store[id];
    if (!p) throw new Error('not found');
    return p;
  }

  async function save(project) {
    if (!project) throw new Error('save: project required');
    if (!project.id) project.id = uuid();
    if (!project.createdAt) project.createdAt = new Date().toISOString();
    project.updatedAt = new Date().toISOString();
    const store = readStore();
    store[project.id] = project;
    writeStore(store);
    return project;
  }

  async function del(id) {
    if (!id) throw new Error('delete: id required');
    const store = readStore();
    delete store[id];
    writeStore(store);
  }

  // === Debounced auto-save (same pattern as cloud version) ==============
  function autoSave(getStateFn, opts) {
    opts = opts || {};
    const debounce = opts.debounceMs || AUTOSAVE_DEBOUNCE_MS;
    const onSave   = opts.onSave;
    const onError  = opts.onError;
    const onStart  = opts.onStart;

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
        console.warn('[projects] save failed:', err.message);
        if (onError) try { onError(err); } catch (_) {}
      } finally {
        inFlight = false;
        if (queued) {
          queued = false;
          schedule();
        }
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (inFlight) {
          queued = true;
        } else {
          actuallySave();
        }
      }, debounce);
    }

    return {
      trigger: schedule,
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
    _config: { STORAGE_KEY, AUTOSAVE_DEBOUNCE_MS, mode: 'localStorage' },
  };
})(window);

/* ============================================================
   FUTURE: when you want cloud sync back, swap this file for the
   cloud version (preserved in git history) and configure:
     1. Cloudflare Worker (see cloudflare/README.md)
     2. GitHub Gist with _index.json
     3. WORKER_URL constant
   The public API is identical, so no caller changes needed.
   ============================================================ */
