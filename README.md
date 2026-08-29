# 🏠 Home Construction Expense Tracker

A lightweight, responsive web app for tracking the budget and expenses of a
home‑construction project. Hosted **free on GitHub Pages**. Unlike a normal
static app, it stores its data as **JSON files inside a GitHub repository**, so
you get the same data on every device plus full **Git history / audit trail**.

---

## Two ways to save data — pick one

### A. Direct mode (default — no server, recommended for personal use)

```
Your browser  ──(your fine-grained token, stored only in your browser)──▶  GitHub API  ──▶  data/*.json
```

- You create a **fine‑grained personal access token** (Contents: Read and write, **one repo only**) and paste it into the app once.
- The token is stored **only in your browser** — session storage, or local storage if you tick *“remember on this device”*. It is **never** in the app code, **never** committed.
- Only a device that holds the token can write. If your data repo is **private**, only a device with the token can read it either.
- Nothing to deploy or pay for.
- Trade‑off: while you use the app the token sits in your browser storage. Scoped to one repo with a short expiry, the worst case is that someone with access to your unlocked browser could edit that one repo — no account‑wide exposure. On a shared computer, don’t tick “remember”, and use *Forget token* / a private window.

### B. API mode (serverless proxy — best when several people share the app)

```
Browser  ──▶  Cloudflare Worker (holds the token as a server secret)  ──▶  GitHub API  ──▶  data/*.json
```

- The token lives only as a Worker secret; users never hold it.
- Optional shared write passphrase.
- Setup: [`api/cloudflare-worker/README.md`](api/cloudflare-worker/README.md).

Set the mode in `config.js` → `AUTH_MODE: "direct"` or `"api"`.

> **What the token protects is your *repository*, not the expense numbers.**
> The numbers can be public and it doesn’t matter. But a GitHub *write token*
> in public page source would let a stranger vandalise your repo — so the token
> is never in the front end in either mode.

---

## Keeping the data itself private (optional)

GitHub Pages is free only for **public** repos. If you don’t want the expense
JSON to be world‑readable, split into two repos:

| repo | visibility | holds |
|------|------------|-------|
| `House-spends` | **public** | the app (HTML/CSS/JS) — Pages deploys from here |
| `home-budget-data` | **private** | just `data/project.json`, `expenses.json`, `categories.json`, `funds.json` |

Then in `config.js` set `DATA_REPO: "home-budget-data"`. Your fine‑grained token
(direct mode) or the Worker (API mode) is given access to the **private** data
repo. The app stays on free Pages because only the app repo is public. Nobody
without the token can read or write the data.

---

## Features

- **Dashboard** — initial budget, total spent, remaining budget, % used, progress bar, budget‑exceeded warning, category breakdown, per‑funding‑source progress, recent expenses.
- **Funding sources** — define money pools (e.g. *PF* ₹4,00,000 earmarked for appliances, *Home Loan*, *Savings*), tag each expense with the source it's paid from, and see allocated vs spent vs remaining per source in Reports. Filter the expense list by funding source.
- **Expenses** — add / edit / delete (delete confirms; edit updates in place, never duplicates). Search (description / vendor / notes), filter by category / phase / payment method / date range, sort by newest / oldest / highest / lowest.
- **Reports** — budget vs actual, spending by category, by construction phase, by month, by payment method. Bar charts that update automatically.
- **Settings** — project name, initial budget, start date, currency; custom categories; export / import JSON backup; load demo data; GitHub connection panel; sync status.
- **Indian currency formatting** (`₹1,00,000`) via a reusable formatter; also USD / EUR / GBP. Only numeric values are stored — never `"₹42,000"`.
- **Data integrity** — every write fetches the current file’s SHA; a concurrent edit produces *“Data changed on GitHub — please refresh”* instead of a silent overwrite. Optimistic UI changes roll back on any failure.
- **Offline / error states** — clear loading / saving / success / failure messages; the app never claims a save succeeded when it did not.
- **Read‑only fallback** — with no connection the app loads the bundled JSON files and disables writes.
- **Security** — no token in the front end; least‑privilege fine‑grained token; single‑repo + fixed‑file allowlist; user content rendered via DOM/`textContent`, never `innerHTML`.

---

## Setup (direct mode)

### 1. Create the repository and push this project

```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/House-spends.git
git push -u origin main
```

The `data/` folder already has starter files (empty expenses, 22 seeded
categories, a ₹50,00,000 placeholder budget). Edit `data/project.json` now or
change it later in **Settings**.

### 2. Enable GitHub Pages

Repo → **Settings → Pages** → *Source: **GitHub Actions***. The included
workflow `.github/workflows/deploy.yml` publishes on every push to `main`.
Site URL:

```
https://<username>.github.io/House-spends/
```

Relative paths are used throughout and `.nojekyll` is included, so it works
under the `/House-spends/` sub‑path.

### 3. Configure `config.js` (public — no secrets)

```js
window.APP_CONFIG = {
  GITHUB_OWNER: "saiudiga110",
  GITHUB_REPOSITORY: "House-spends",
  DATA_REPO: "",            // or "home-budget-data" for a private data repo
  GITHUB_BRANCH: "main",
  DATA_PATH: "data",
  AUTH_MODE: "direct",
  API_BASE_URL: ""
};
```

Commit and push.

### 4. Create a fine‑grained token

GitHub → Settings → Developer settings → **Fine‑grained personal access tokens** → *Generate new token*:

- **Repository access:** *Only select repositories* → your data repo (`House-spends`, or `home-budget-data` if you split).
- **Permissions → Repository permissions → Contents: Read and write.** Nothing else.
- Short expiry; renew when it lapses.

### 5. Connect

Open the app → **Settings → GitHub Connection → Connect to GitHub** (or the
banner on the dashboard) → paste the token. The app verifies it can write to the
data repo, then stores it in your browser only. Done — add expenses.

---

## Setup (API mode)

Do steps 1–2 above, set `AUTH_MODE: "api"` and `API_BASE_URL` in `config.js`,
then follow [`api/cloudflare-worker/README.md`](api/cloudflare-worker/README.md)
to deploy the Worker and set the `GITHUB_TOKEN` / `WRITE_PASSPHRASE` secrets.

---

## Data structure

### `data/project.json`
```json
{
  "projectName": "My New Home",
  "initialBudget": 5000000,
  "currency": "INR",
  "startDate": "2026-08-29",
  "createdAt": "2026-08-29T00:00:00Z",
  "updatedAt": "2026-08-29T00:00:00Z"
}
```

### `data/expenses.json`
```json
{
  "expenses": [
    {
      "id": "expense-abc123",
      "date": "2026-08-29",
      "description": "Cement - 100 bags",
      "category": "Cement",
      "amount": 42000,
      "paymentMethod": "Bank Transfer",
      "vendor": "ABC Traders",
      "phase": "Foundation",
      "fundId": "fund-abc123",
      "notes": "Initial cement purchase",
      "createdAt": "2026-08-29T10:30:00Z",
      "updatedAt": "2026-08-29T10:30:00Z"
    }
  ]
}
```

### `data/categories.json`
```json
{ "categories": ["Land", "Architect", "Cement", "Steel", "Labour", "..."] }
```

### `data/funds.json`
```json
{
  "funds": [
    {
      "id": "fund-abc123",
      "name": "PF Withdrawal",
      "amount": 400000,
      "purpose": "New home appliances: TV, Fridge, AC, Washing Machine",
      "notes": "",
      "createdAt": "2026-08-29T00:00:00Z",
      "updatedAt": "2026-08-29T00:00:00Z"
    }
  ]
}
```
Each expense may carry an optional `"fundId"` pointing at one of these.

---

## How data flows from the UI to GitHub (direct mode)

1. You submit the Add/Edit Expense form. The app validates it (date,
   description, category, amount > 0) and generates a unique `id` for new rows.
2. The app updates its in‑memory state **optimistically** and re‑renders.
3. It `PUT`s the whole `expenses.json` object to
   `https://api.github.com/repos/<owner>/<dataRepo>/contents/data/expenses.json`
   with `Authorization: Bearer <your token>`, the blob `sha` it last read, and a
   commit message like `Add expense: Steel bars - ₹1,20,000`.
4. GitHub checks the `sha`.
   - **Stale** (another device committed since) → `409`/`422`; the app shows
     *“Data changed on GitHub — refreshing”*, rolls back your optimistic change,
     and reloads the fresh data so you can re‑apply it. Nothing is silently lost.
   - **Current** → GitHub writes the file as a real commit and returns the new `sha`.
5. The app stores the new `sha` and shows *“✓ Expense saved successfully”*.
6. If GitHub is unreachable at step 3, the optimistic change is rolled back and
   the app shows *“Unable to reach GitHub”* — it never pretends the save worked.

Viewing data never writes, so there are **no junk commits** for browsing.
`git log data/expenses.json` is your audit trail. In API mode the flow is the
same except step 3 goes to the Worker, which performs the SHA check and commit
with its server‑side token.

---

## Security

- **Never** put a GitHub token, password, or secret in `index.html`, `app.js`,
  `style.css`, `config.js`, or any JSON file — all are public static assets.
- Direct mode: the token exists only in your browser’s session/local storage,
  entered by you, sent only to `api.github.com` over HTTPS. Use a fine‑grained
  token scoped to one repo, Contents‑only, with a short expiry.
- API mode: the token exists only as the Worker secret `GITHUB_TOKEN`.
- Either way the app can only touch four fixed files in one configured repo —
  the browser cannot request arbitrary repos or paths.
- Concurrent‑edit protection via blob SHA; no silent overwrite of newer data.
- User‑entered text is rendered with `textContent` / DOM nodes, never
  `innerHTML` — prevents XSS.
- The deploy workflow greps for token patterns and fails the build if any are found.

---

## Usage

1. **Set the budget** — Settings → Initial Budget → Save. Existing expenses are untouched; the dashboard recalculates.
2. **Connect** — Settings → GitHub Connection (direct mode only).
3. **Add expenses** — Expenses → *+ Add Expense*.
4. **Dashboard** — budget, spent, remaining, % used, warnings, breakdown.
5. **Reports** — category / monthly / phase / payment‑method / budget‑vs‑actual.
6. **Edit / delete** — from the Expenses table. Delete confirms first.
7. **Refresh** — the *↻ Refresh* button pulls the latest JSON from GitHub. “Last synchronized” shows the time.
8. **Backup** — Settings → Export Backup downloads `home-construction-backup-YYYY-MM-DD.json`. Import validates before writing back.

---

## Testing

Run locally:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

With `AUTH_MODE: "direct"` and a real token you can exercise the full write path
locally (GitHub’s API allows browser requests via CORS).

Checklist:

- **Budget** — set / change it; confirm Total Spent / Remaining / % recalc; push spend over budget → ⚠ warning + red progress bar.
- **Expenses** — add, edit (same row updates, no dup), delete (confirm dialog); totals and charts update.
- **Reports** — category / monthly / phase / payment totals match the list.
- **GitHub** — add an expense → a commit appears in `data/expenses.json` history; go offline → failure message, no false success; edit the file on GitHub then save from a stale tab → conflict message.
- **Security** — `grep -RInE 'github_pat_|ghp_' .` finds nothing; view deployed page source → no token.
- **Responsive** — 375 / 768 / 1024 / 1440 px: cards stack, table scrolls, forms single‑column, nav usable.
- **Browsers** — Chrome, Firefox, Edge.

Automated checks live in the repo history; `node --check app.js` and
`node --check api/cloudflare-worker/worker.js` must pass.

---

## Project structure

```
House-spends/
├── index.html                 # SPA shell — 4 views + modals (expense, confirm, passphrase, token)
├── style.css                  # responsive, light + dark
├── app.js                     # app logic: direct + API data clients, validation, charts
├── config.js                  # public config — NO secrets
├── config.example.js          # annotated template
├── .nojekyll  .gitignore  README.md
├── data/
│   ├── project.json
│   ├── expenses.json
│   ├── categories.json
│   └── funds.json
├── api/
│   └── cloudflare-worker/      # API mode only
│       ├── worker.js
│       ├── wrangler.toml
│       └── README.md
└── .github/workflows/deploy.yml
```

---

## License

MIT.
