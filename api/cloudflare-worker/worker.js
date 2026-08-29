/* =====================================================================
 * Secure data API for the Home Construction Expense Tracker
 * Runtime: Cloudflare Workers (free tier)
 *
 * Responsibilities:
 *   - Hold the GitHub token as a server-side secret (never sent to browser).
 *   - Read / write ONLY the three allowed JSON files in ONE configured repo.
 *   - Validate JSON structure before committing.
 *   - Detect concurrent edits via the GitHub blob SHA (409 on conflict).
 *   - Restrict browser origins via CORS allowlist.
 *   - Optional shared write passphrase.
 *
 * Required secrets / vars (see wrangler.toml + `wrangler secret put`):
 *   GITHUB_TOKEN        (secret)  fine-grained PAT, Contents: Read and write, this repo only
 *   GITHUB_OWNER        (var)     e.g. "your-github-username"
 *   GITHUB_REPO         (var)     e.g. "House-spends"
 *   GITHUB_BRANCH       (var)     e.g. "main"
 *   DATA_PATH           (var)     e.g. "data"
 *   ALLOWED_ORIGINS     (var)     comma list, e.g. "https://you.github.io"
 *   WRITE_PASSPHRASE    (secret)  optional; if set, PUT requires header x-write-passphrase
 *   COMMITTER_NAME      (var)     optional, default "Construction Tracker Bot"
 *   COMMITTER_EMAIL     (var)     optional, default "bot@users.noreply.github.com"
 * ===================================================================== */

const ALLOWED_FILES = {
  project: "project.json",
  expenses: "expenses.json",
  categories: "categories.json",
  funds: "funds.json",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Route: /api/data/:name
    const m = url.pathname.match(/^\/api\/data\/([a-z]+)\/?$/);
    if (!m) return json({ ok: false, error: "not_found" }, 404, cors);

    const name = m[1];
    const fileName = ALLOWED_FILES[name];
    if (!fileName) return json({ ok: false, error: "unknown_file" }, 400, cors);

    try {
      if (request.method === "GET") {
        return await handleGet(env, name, fileName, cors);
      }
      if (request.method === "PUT") {
        return await handlePut(request, env, name, fileName, cors);
      }
      return json({ ok: false, error: "method_not_allowed" }, 405, cors);
    } catch (err) {
      return json({ ok: false, error: "server_error", detail: String(err && err.message || err) }, 500, cors);
    }
  },
};

/* -------------------------------------------------------------------- */

async function handleGet(env, name, fileName, cors) {
  const gh = await ghGetFile(env, fileName);
  if (gh.status === 404) {
    // File missing — return an empty valid structure so the app can bootstrap.
    return json({ ok: true, name, content: emptyContent(name), sha: null }, 200, cors);
  }
  if (!gh.ok) return json({ ok: false, error: "github_read_failed", status: gh.status }, 502, cors);

  const decoded = b64decode(gh.body.content);
  let content;
  try { content = JSON.parse(decoded); }
  catch (e) { return json({ ok: false, error: "corrupt_json_in_repo" }, 502, cors); }

  return json({ ok: true, name, content, sha: gh.body.sha }, 200, cors);
}

async function handlePut(request, env, name, fileName, cors) {
  // Optional passphrase gate
  if (env.WRITE_PASSPHRASE) {
    const provided = request.headers.get("x-write-passphrase") || "";
    if (!timingSafeEqual(provided, env.WRITE_PASSPHRASE)) {
      return json({ ok: false, error: "unauthorized" }, 401, cors);
    }
  }

  let payload;
  try { payload = await request.json(); }
  catch (e) { return json({ ok: false, error: "invalid_request_body" }, 400, cors); }

  const content = payload && payload.content;
  const baseSha = (payload && payload.baseSha) || null;
  const message = sanitizeMessage(payload && payload.message, name);

  const validationError = validateContent(name, content);
  if (validationError) return json({ ok: false, error: "validation_failed", detail: validationError }, 400, cors);

  // Fetch current SHA and compare with the client's baseSha for conflict detection.
  const current = await ghGetFile(env, fileName);
  const currentSha = current.ok ? current.body.sha : null;

  if (baseSha && currentSha && baseSha !== currentSha) {
    let currentContent = null;
    try { currentContent = JSON.parse(b64decode(current.body.content)); } catch (e) {}
    return json({ ok: false, error: "conflict", currentSha, content: currentContent }, 409, cors);
  }
  if (baseSha && !currentSha) {
    // Client thinks file exists but it doesn't — treat as conflict.
    return json({ ok: false, error: "conflict", currentSha: null }, 409, cors);
  }

  const bodyText = JSON.stringify(content, null, 2) + "\n";
  const put = await ghPutFile(env, fileName, {
    message,
    content: b64encode(bodyText),
    sha: currentSha || undefined,
    branch: env.GITHUB_BRANCH || "main",
    committer: {
      name: env.COMMITTER_NAME || "Construction Tracker Bot",
      email: env.COMMITTER_EMAIL || "bot@users.noreply.github.com",
    },
  });

  if (put.status === 409) {
    return json({ ok: false, error: "conflict", currentSha }, 409, cors);
  }
  if (!put.ok) {
    return json({ ok: false, error: "github_write_failed", status: put.status, detail: put.detail }, 502, cors);
  }

  return json({ ok: true, sha: put.body.content && put.body.content.sha, commit: put.body.commit && put.body.commit.sha }, 200, cors);
}

/* --------------------------- GitHub API ----------------------------- */

function ghBase(env) {
  return `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents`;
}
function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "home-construction-tracker",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function filePath(env, fileName) {
  const dir = (env.DATA_PATH || "data").replace(/^\/+|\/+$/g, "");
  return `${dir}/${fileName}`;
}

async function ghGetFile(env, fileName) {
  const ref = encodeURIComponent(env.GITHUB_BRANCH || "main");
  const r = await fetch(`${ghBase(env)}/${filePath(env, fileName)}?ref=${ref}`, { headers: ghHeaders(env) });
  if (r.status === 404) return { ok: false, status: 404 };
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, status: 200, body: await r.json() };
}

async function ghPutFile(env, fileName, body) {
  const r = await fetch(`${ghBase(env)}/${filePath(env, fileName)}`, {
    method: "PUT",
    headers: { ...ghHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.ok) return { ok: true, status: r.status, body: await r.json() };
  let detail = "";
  try { detail = (await r.json()).message || ""; } catch (e) {}
  return { ok: false, status: r.status, detail };
}

/* ------------------------- Validation ------------------------------- */

function validateContent(name, content) {
  if (content == null || typeof content !== "object" || Array.isArray(content)) {
    return "content must be a JSON object";
  }
  if (name === "project") {
    if (typeof content.projectName !== "string" || !content.projectName.trim()) return "projectName required";
    if (typeof content.initialBudget !== "number" || !isFinite(content.initialBudget) || content.initialBudget <= 0) return "initialBudget must be a positive number";
    if (typeof content.currency !== "string") return "currency required";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(content.startDate || "")) return "startDate must be YYYY-MM-DD";
    return null;
  }
  if (name === "expenses") {
    if (!Array.isArray(content.expenses)) return "expenses must be an array";
    if (content.expenses.length > 20000) return "too many expenses";
    for (const x of content.expenses) {
      if (!x || typeof x !== "object") return "expense entries must be objects";
      if (typeof x.id !== "string" || !x.id) return "each expense needs a string id";
      if (typeof x.amount !== "number" || !isFinite(x.amount) || x.amount < 0) return "expense amount must be a non-negative number";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(x.date || "")) return "expense date must be YYYY-MM-DD";
      if (typeof x.description !== "string") return "expense description must be a string";
      if (typeof x.category !== "string") return "expense category must be a string";
    }
    const ids = content.expenses.map((x) => x.id);
    if (new Set(ids).size !== ids.length) return "duplicate expense ids";
    return null;
  }
  if (name === "categories") {
    if (!Array.isArray(content.categories)) return "categories must be an array";
    if (content.categories.length > 500) return "too many categories";
    if (!content.categories.every((c) => typeof c === "string" && c.length <= 80)) return "categories must be short strings";
    return null;
  }
  if (name === "funds") {
    if (!Array.isArray(content.funds)) return "funds must be an array";
    if (content.funds.length > 500) return "too many funds";
    for (const f of content.funds) {
      if (!f || typeof f !== "object") return "fund entries must be objects";
      if (typeof f.id !== "string" || !f.id) return "each fund needs a string id";
      if (typeof f.name !== "string" || !f.name.trim()) return "each fund needs a name";
      if (typeof f.amount !== "number" || !isFinite(f.amount) || f.amount < 0) return "fund amount must be a non-negative number";
    }
    const fids = content.funds.map((f) => f.id);
    if (new Set(fids).size !== fids.length) return "duplicate fund ids";
    return null;
  }
  return "unknown file";
}

function emptyContent(name) {
  if (name === "project") {
    const today = new Date().toISOString().slice(0, 10);
    return { projectName: "My New Home", initialBudget: 5000000, currency: "INR", startDate: today,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  }
  if (name === "expenses") return { expenses: [] };
  if (name === "categories") return { categories: [] };
  if (name === "funds") return { funds: [] };
  return {};
}

/* --------------------------- helpers ------------------------------- */

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : (allowed[0] || "");
  return {
    "Access-Control-Allow-Origin": allow || "null",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-write-passphrase",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function sanitizeMessage(msg, name) {
  const fallback = `Update ${name}.json`;
  if (typeof msg !== "string") return fallback;
  const clean = msg.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  return clean || fallback;
}

function b64decode(s) {
  const bin = atob((s || "").replace(/\n/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
