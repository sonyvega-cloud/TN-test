/*! TN Projects Worker — Cloudflare Worker that proxies the GitHub Gist API.
 *
 *  Why a proxy?  GitHub Pages can't hold a server-side secret. We need a
 *  GitHub PAT (gist scope) to write to a shared gist on behalf of the team.
 *  Embedding that PAT in the static site would leak it on push and GitHub's
 *  secret scanner would revoke it within minutes. So this Worker holds the
 *  token in env vars (Cloudflare secrets), validates incoming requests with
 *  CORS + a shared origin allowlist, and forwards them to GitHub.
 *
 *  Required Worker secrets/vars:
 *    GITHUB_TOKEN   — fine-grained PAT with `gist` scope (set via wrangler secret)
 *    GIST_ID        — the gist ID where projects live
 *    ALLOWED_ORIGINS — comma-separated list, e.g.
 *                     "https://sonyvega-cloud.github.io,http://localhost:8080"
 *
 *  Endpoints (all relative to the Worker URL):
 *    OPTIONS *                       — CORS preflight
 *    GET    /index                   — fetch _index.json
 *    GET    /project/:id             — fetch full project JSON
 *    PUT    /project/:id             — upsert (body = full project JSON)
 *    DELETE /project/:id             — remove file + index entry
 *    GET    /health                  — sanity check (returns 'ok')
 *
 *  GitHub Gist quirk: a single PATCH /gists/:id call updates BOTH the index
 *  AND the project file in one shot, atomically. This is what we want for
 *  upsert (otherwise two HTTP roundtrips race when many users save at once).
 */

const GITHUB_API = 'https://api.github.com';
const INDEX_FILENAME = '_index.json';

// =============================================================================
// CORS
// =============================================================================
function corsHeaders(origin, allowed) {
  const ok = allowed.includes(origin);
  const allowOrigin = ok ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Nick',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

// =============================================================================
// GitHub Gist helpers
// =============================================================================
async function fetchGist(gistId, token) {
  const r = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'TN-Graphics-Worker',
    },
  });
  if (!r.ok) throw new Error(`gist fetch ${r.status}`);
  return await r.json();
}

async function patchGistFiles(gistId, token, files) {
  // files = { "filename.json": { content: "..." } | null (to delete) }
  const r = await fetch(`${GITHUB_API}/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'TN-Graphics-Worker',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ files }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`gist patch ${r.status}: ${txt}`);
  }
  return await r.json();
}

function readFile(gist, name) {
  const f = gist.files && gist.files[name];
  if (!f) return null;
  // GitHub may return truncated content for files > 1 MB. We're well below.
  if (f.truncated) {
    // TODO: fetch raw_url. For now, fail loudly.
    throw new Error(`file ${name} is truncated`);
  }
  return f.content;
}

function readJsonFile(gist, name) {
  const txt = readFile(gist, name);
  if (txt == null) return null;
  try { return JSON.parse(txt); } catch (_) { return null; }
}

function writeFile(content) {
  return { content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) };
}

// =============================================================================
// Index helpers — _index.json shape: { projects: [...] }
// =============================================================================
function emptyIndex() {
  return { version: 1, projects: [] };
}

function upsertIndexEntry(index, entry) {
  if (!index || !Array.isArray(index.projects)) index = emptyIndex();
  const i = index.projects.findIndex(p => p.id === entry.id);
  // Keep only metadata fields in the index — never the full state. Index is
  // loaded eagerly by every client; full state is loaded on demand.
  const meta = {
    id:        entry.id,
    name:      entry.name,
    owner:     entry.owner,
    template:  entry.template,
    show:      entry.show,
    fps:       entry.fps,
    duration:  entry.duration,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
  if (i >= 0) {
    // Preserve original createdAt
    meta.createdAt = index.projects[i].createdAt || meta.createdAt;
    index.projects[i] = meta;
  } else {
    index.projects.push(meta);
  }
  return index;
}

function removeIndexEntry(index, id) {
  if (!index || !Array.isArray(index.projects)) return emptyIndex();
  index.projects = index.projects.filter(p => p.id !== id);
  return index;
}

// =============================================================================
// Routes
// =============================================================================
async function handle(request, env) {
  const url = new URL(request.url);
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const cors = corsHeaders(request.headers.get('Origin') || '', allowed);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (url.pathname === '/health' || url.pathname === '/') {
    return jsonResponse({ ok: true, time: new Date().toISOString() }, 200, cors);
  }

  if (!env.GITHUB_TOKEN || !env.GIST_ID) {
    return jsonResponse({ error: 'worker not configured' }, 500, cors);
  }

  // GET /index → return _index.json (or empty if missing)
  if (url.pathname === '/index' && request.method === 'GET') {
    try {
      const gist = await fetchGist(env.GIST_ID, env.GITHUB_TOKEN);
      const idx = readJsonFile(gist, INDEX_FILENAME) || emptyIndex();
      return jsonResponse(idx, 200, cors);
    } catch (err) {
      return jsonResponse({ error: err.message }, 502, cors);
    }
  }

  // /project/:id
  const projMatch = url.pathname.match(/^\/project\/([A-Za-z0-9_-]+)$/);
  if (projMatch) {
    const id = projMatch[1];
    const fname = `proj_${id}.json`;

    if (request.method === 'GET') {
      try {
        const gist = await fetchGist(env.GIST_ID, env.GITHUB_TOKEN);
        const proj = readJsonFile(gist, fname);
        if (!proj) return jsonResponse({ error: 'not found' }, 404, cors);
        return jsonResponse(proj, 200, cors);
      } catch (err) {
        return jsonResponse({ error: err.message }, 502, cors);
      }
    }

    if (request.method === 'PUT') {
      let body;
      try { body = await request.json(); }
      catch (_) { return jsonResponse({ error: 'bad JSON' }, 400, cors); }
      // Sanity — ensure body.id matches URL id
      if (!body.id) body.id = id;
      if (body.id !== id) return jsonResponse({ error: 'id mismatch' }, 400, cors);

      try {
        // Read current index, mutate, write both files in one PATCH.
        const gist = await fetchGist(env.GIST_ID, env.GITHUB_TOKEN);
        let idx = readJsonFile(gist, INDEX_FILENAME) || emptyIndex();
        // Preserve createdAt from existing entry
        const existing = idx.projects.find(p => p.id === id);
        if (existing && !body.createdAt) body.createdAt = existing.createdAt;
        body.updatedAt = new Date().toISOString();

        idx = upsertIndexEntry(idx, body);
        const files = {
          [INDEX_FILENAME]: writeFile(idx),
          [fname]:          writeFile(body),
        };
        await patchGistFiles(env.GIST_ID, env.GITHUB_TOKEN, files);
        return jsonResponse({ ok: true, project: body }, 200, cors);
      } catch (err) {
        return jsonResponse({ error: err.message }, 502, cors);
      }
    }

    if (request.method === 'DELETE') {
      try {
        const gist = await fetchGist(env.GIST_ID, env.GITHUB_TOKEN);
        let idx = readJsonFile(gist, INDEX_FILENAME) || emptyIndex();
        idx = removeIndexEntry(idx, id);
        // GitHub gist file delete via PATCH: pass null for the file entry
        const files = {
          [INDEX_FILENAME]: writeFile(idx),
          [fname]:          null,
        };
        await patchGistFiles(env.GIST_ID, env.GITHUB_TOKEN, files);
        return jsonResponse({ ok: true }, 200, cors);
      } catch (err) {
        return jsonResponse({ error: err.message }, 502, cors);
      }
    }
  }

  return jsonResponse({ error: 'not found' }, 404, cors);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handle(request, env);
    } catch (err) {
      console.error(err);
      return new Response(JSON.stringify({ error: err.message || String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
