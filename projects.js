/*! TN Projects — localStorage-only edition (single source of truth).
 *
 *  All projects live under ONE localStorage key. Migrates legacy keys from
 *  earlier versions on first read (v1, v2 — single-template stores) into
 *  the unified store.
 *
 *  Same public API as the cloud version, so callers don't need to change:
 *    TNProjects.list()                     → Promise<[indexEntry, ...]>
 *    TNProjects.load(id)                   → Promise<projectFull>
 *    TNProjects.save(project)              → Promise<projectFull>
 *    TNProjects.delete(id)                 → Promise<void>
 *    TNProjects.autoSave(getStateFn, opts) → { trigger, flush, dispose }
 */
(function (window) {
  'use strict';

  const STORAGE_KEY = 'tn_projects_local_v2';
  const AUTOSAVE_DEBOUNCE_MS = 2000;

  // Legacy stores that we one-time merge into the unified store. Each one
  // contained an array of projects for a single template. We tag them with a
  // template id during migration so the unified store works for everyone.
  const LEGACY_KEYS = [
    'tn_graphics_engine_projects_v2',  // multi-template registry from index.html
    'tn_graphics_engine_projects_v1',  // even older, all bar-chart
  ];

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
    const merged = {};

    // 1) Read the unified store (preferred / canonical)
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object') Object.assign(merged, obj);
      }
    } catch (_) {}

    // 2) Live-merge legacy stores. Templates in this codebase still write
    // to legacy keys (Array of {id, name, state, createdAt, updatedAt}), so
    // we must read them every time, not just at first migration. Last write
    // wins — newer updatedAt overrides.
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        for (const p of arr) {
          if (!p || !p.id) continue;
          const template = (p.state && p.state.template) || 'bar-chart';
          const entry = {
            id: p.id,
            name: p.name || 'Untitled',
            owner: p.owner || (window.TNLogin && TNLogin.getNick && TNLogin.getNick()) || 'XXX',
            template,
            show: p.state && p.state.show,
            fps: p.state && p.state.fps,
            duration: p.state && p.state.duration,
            createdAt: typeof p.createdAt === 'number'
              ? new Date(p.createdAt).toISOString()
              : (p.createdAt || new Date().toISOString()),
            updatedAt: typeof p.updatedAt === 'number'
              ? new Date(p.updatedAt).toISOString()
              : (p.updatedAt || new Date().toISOString()),
            state: p.state || {},
          };
          // Last-write-wins by updatedAt
          const existing = merged[entry.id];
          if (!existing || (entry.updatedAt > existing.updatedAt)) {
            merged[entry.id] = entry;
          }
        }
      } catch (_) {}
    }
    return merged;
  }
  function writeStore(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  // (Legacy migration is now done live in readStore() via merge — no
  // one-shot migration needed; templates can keep writing to legacy keys.)


  // === Public methods ===================================================
  async function list() {
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
    // Remove from unified store
    const store = readStore();
    delete store[id];
    writeStore(store);
    // Also remove from any legacy arrays so it doesn't reappear via merge
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) continue;
        const filtered = arr.filter(p => p && p.id !== id);
        if (filtered.length !== arr.length) {
          localStorage.setItem(key, JSON.stringify(filtered));
        }
      } catch (_) {}
    }
  }

  // === Debounced auto-save ==============================================
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
    _config: { STORAGE_KEY, AUTOSAVE_DEBOUNCE_MS, mode: 'localStorage', LEGACY_KEYS },
  };
})(window);
