# Secure Data API — Cloudflare Worker

This small Worker is the **only** place the GitHub write token exists. The
browser never sees it. The Worker will read and write **only** the three
JSON files in **one** repository you configure.

## Why a server-side API?

GitHub Pages serves static files only. A static page cannot keep a secret —
anything in `app.js` is public. To commit to a repo you need a GitHub token
with write access, and that token must live on a server. This Worker is that
server. Free tier: 100k requests/day, far more than a personal tracker needs.

## 1. Create a fine-grained GitHub token (least privilege)

1. GitHub → Settings → Developer settings → **Fine-grained personal access tokens** → *Generate new token*.
2. **Resource owner:** your account. **Repository access:** *Only select repositories* → pick `home-budget-spends`.
3. **Permissions → Repository permissions → Contents: Read and write.** Nothing else.
4. Set a short expiry and renew when it lapses.
5. Copy the token (starts with `github_pat_...`). You will paste it into `wrangler secret put`, never into a file.

## 2. Install Wrangler and log in

```bash
npm install -g wrangler
wrangler login
```

## 3. Configure

Edit `wrangler.toml` → `[vars]`:

| var | value |
|-----|-------|
| `GITHUB_OWNER` | your GitHub username |
| `GITHUB_REPO` | `home-budget-spends` |
| `GITHUB_BRANCH` | `main` |
| `DATA_PATH` | `data` |
| `ALLOWED_ORIGINS` | `https://<username>.github.io` (the Pages **origin**, no repo path) |

## 4. Set secrets (never committed)

```bash
cd api/cloudflare-worker
wrangler secret put GITHUB_TOKEN         # paste the fine-grained PAT
wrangler secret put WRITE_PASSPHRASE     # optional: any strong phrase; the app will prompt for it
```

If you skip `WRITE_PASSPHRASE`, set `API_REQUIRES_PASSPHRASE: false` in the
front-end `config.js`. With no passphrase, anyone who knows the Worker URL
can write — fine for a private hobby repo, not recommended otherwise.

## 5. Deploy

```bash
wrangler deploy
```

Wrangler prints a URL like `https://home-budget-api.<subdomain>.workers.dev`.
Put that in the front-end `config.js` as `API_BASE_URL`.

## 6. Test

```bash
# read (no auth needed for GET)
curl https://home-budget-api.<subdomain>.workers.dev/api/data/project

# write (passphrase header only if you set WRITE_PASSPHRASE)
curl -X PUT https://home-budget-api.<subdomain>.workers.dev/api/data/categories \
  -H 'Content-Type: application/json' \
  -H 'x-write-passphrase: YOUR_PHRASE' \
  -d '{"content":{"categories":["Cement","Steel"]},"baseSha":null,"message":"test"}'
```

## Endpoints

| Method | Path | Body | Notes |
|--------|------|------|-------|
| `GET`  | `/api/data/:name` | — | `:name` ∈ `project` \| `expenses` \| `categories`. Returns `{ ok, name, content, sha }`. Missing file → `sha: null` + empty structure. |
| `PUT`  | `/api/data/:name` | `{ content, baseSha, message }` | Validates structure, checks `baseSha` vs current blob SHA, commits. `409` `{ error:"conflict", currentSha, content }` if the file moved on. Header `x-write-passphrase` required when `WRITE_PASSPHRASE` is set. |

## Security properties

- Token only in Worker secret storage; never in responses, logs, or the repo.
- Hardcoded file allowlist + single repo from config — the browser cannot ask
  for arbitrary paths.
- JSON structure validated before every commit.
- Optimistic-concurrency via blob SHA: no silent overwrite of newer data.
- CORS restricted to your configured origin(s).
- Commit messages are stripped of newlines and length-capped.

## Alternatives

The same contract works on **Netlify Functions** or **Vercel Functions** —
port `worker.js` to a handler and read the same env vars. Keep the token as
a platform environment secret in every case.
