# 🏠 Home Construction Expense Tracker

A lightweight, responsive web app for tracking the budget and expenses of a
home‑construction project. Hosted **free on GitHub Pages**. Unlike a normal
static app, it stores its data as **JSON files inside a GitHub repository**, so
you get the same data on every device plus full **Git history / audit trail**.

```
User
 │
 ▼
GitHub Pages web app  (index.html / style.css / app.js — NO secrets)
 │  HTTPS
 ▼
Secure serverless API  (Cloudflare Worker — holds the GitHub token as a secret)
 │  GitHub REST API
 ▼
GitHub repository
 └── data/
     ├── project.json
     ├── expenses.json
     └── categories.json
```

---

## Features

- **Dashboard** — initial budget, total spent, remaining budget, % used, progress bar, budget‑exceeded warning, category breakdown, recent expenses.
- **Expenses** — add / edit / delete (delete asks for confirmation; edit updates in place, never duplicates). Search (description / vendor / notes), filter by category / phase / payment method / date range, sort by newest / oldest / highest / lowest.
- **Reports** — budget vs actual, spending by category, by construction phase, by month, by payment method. Simple bar charts that update automatically.
- **Settings** — edit project name, initial budget, start date, currency; manage custom categories; export / import JSON backup; load demo data; view sync status.
- **Indian currency formatting** (`₹1,00,000`) with a reusable formatter; also USD / EUR / GBP. Only numeric values are stored.
- **Data integrity** — every write fetches the current file, validates JSON, and commits with a meaningful message. Concurrent edits are detected via the blob SHA and produce a *“Data changed on GitHub — please refresh”* message instead of a silent overwrite.
- **Offline / error states** — clear loading, saving, success and failure messages; the app never claims a save succeeded when it did not. Optimistic changes roll back on failure.
- **Read‑only fallback** — with no API configured (or if the API is unreachable), the app loads the bundled JSON files and disables writes.
- **Security** — no GitHub token anywhere in the front end; least‑privilege fine‑grained token stored only as a server secret; file + repo allowlist on the API; user content escaped on render (no `innerHTML` with user data).

---

## Architecture

| Layer | What it is | Where secrets live |
|-------|------------|--------------------|
| Front end | Static `index.html` + `style.css` + `app.js` + `config.js` on GitHub Pages | **none** |
| Secure API | Cloudflare Worker (`api/cloudflare-worker/`) | `GITHUB_TOKEN`, optional `WRITE_PASSPHRASE` as Worker secrets |
| Storage | `data/*.json` in this repo, committed by the API via the GitHub Contents API | — |

The browser talks only to the API. The API talks only to GitHub. The token is
only ever in the API's secret storage.

---

## Setup

### 1. Create the repository

Create a GitHub repo named **`home-budget-spends`** (any name works — keep it
consistent) and push this project to it.

```bash
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/home-budget-spends.git
git push -u origin main
```

### 2. The data directory & initial JSON files

They are already in this repo under `data/`:

- `data/project.json` — project name, `initialBudget` (number), currency, start date.
- `data/expenses.json` — `{ "expenses": [ … ] }`, starts empty.
- `data/categories.json` — `{ "categories": [ … ] }`, seeded with 22 construction categories.

Edit `data/project.json` to set your real budget, or do it later in **Settings**.

### 3. Enable GitHub Pages

Repo → **Settings → Pages** → *Build and deployment* → **Source: GitHub Actions**.
The included workflow `.github/workflows/deploy.yml` publishes on every push to
`main`. Your site will be at:

```
https://<username>.github.io/home-budget-spends/
```

(Relative paths are used throughout, so it works under the `/home-budget-spends/`
sub‑path. `.nojekyll` is included.)

### 4. Deploy the secure API

Full instructions: [`api/cloudflare-worker/README.md`](api/cloudflare-worker/README.md). Short version:

```bash
npm install -g wrangler
wrangler login
cd api/cloudflare-worker
# edit wrangler.toml [vars]: GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH, DATA_PATH, ALLOWED_ORIGINS
wrangler secret put GITHUB_TOKEN        # fine-grained PAT, Contents: Read and write, this repo only
wrangler secret put WRITE_PASSPHRASE    # optional but recommended
wrangler deploy
```

Wrangler prints the Worker URL.

### 5. The GitHub secret / token

- Create a **fine‑grained personal access token**: *Repository access → only `home-budget-spends`*, *Permissions → Contents: Read and write*, nothing else.
- Store it **only** with `wrangler secret put GITHUB_TOKEN`. It is never in a file, never in the repo, never sent to the browser.
- `WRITE_PASSPHRASE` (optional) is a shared phrase the app prompts for before the first write; it is kept in the browser tab's `sessionStorage` only.

### 6. Connect the front end to the API

Edit **`config.js`** (committed template — contains **no secrets**):

```js
window.APP_CONFIG = {
  GITHUB_OWNER: "your-github-username",
  GITHUB_REPOSITORY: "home-budget-spends",
  GITHUB_BRANCH: "main",
  DATA_PATH: "data",
  API_BASE_URL: "https://home-budget-api.<subdomain>.workers.dev",
  API_REQUIRES_PASSPHRASE: true   // false if you did not set WRITE_PASSPHRASE
};
```

Commit and push. Leaving `API_BASE_URL: ""` runs the app in read‑only mode.

### 7. Deploy the application

`git push` to `main` → GitHub Actions builds and deploys Pages automatically.
Or trigger **Actions → Deploy to GitHub Pages → Run workflow**.

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
      "notes": "Initial cement purchase",
      "createdAt": "2026-08-29T10:30:00Z",
      "updatedAt": "2026-08-29T10:30:00Z"
    }
  ]
}
```

### `data/categories.json`
```json
{ "categories": ["Land", "Architect", "Cement", "Steel", "Labour", "..." ] }
```

Amounts are always stored as **numbers** — never `"₹42,000"`. Formatting happens
only at display time via `formatCurrency()`.

---

## How data flows from the UI to GitHub

1. You submit the Add/Edit Expense form. The app validates the input (date,
   description, category, amount > 0) and generates a unique `id` for new rows.
2. The app updates its in‑memory state **optimistically** and re‑renders.
3. It `PUT`s the whole `expenses.json` object to `POST {API}/api/data/expenses`
   together with `baseSha` (the SHA it last read) and a commit message like
   `Add expense: Cement - ₹42,000`.
4. The Worker checks the passphrase, validates the JSON structure, then fetches
   the file's **current** SHA from GitHub.
   - If it differs from `baseSha` → `409 conflict`; the app shows *“Data changed
     on GitHub — refreshing”* and reloads. Your change is **not** lost silently
     — it is rolled back and you re‑apply it on fresh data.
   - Otherwise the Worker commits the file via the GitHub Contents API, creating
     a real Git commit.
5. The Worker returns the new SHA; the app stores it and shows
   *“✓ Expense saved successfully”*.
6. If the API is unreachable at step 3, the optimistic change is rolled back and
   the app shows *“Unable to connect to the data service”* — it never pretends
   the save worked.

Viewing data never writes, so there are **no junk commits** for browsing.
`git log data/expenses.json` is your audit trail.

---

## Security

- **Never** put a GitHub token, password, or secret in `index.html`, `app.js`,
  `style.css`, `config.js`, or any JSON file. These are all public static assets
  on GitHub Pages. The browser must never receive a GitHub write token.
- The only token is the fine‑grained PAT, stored **only** as the Worker secret
  `GITHUB_TOKEN`. It has write access to **one** repo and nothing else.
- The API exposes a fixed allowlist of three files in one configured repo. The
  browser cannot request arbitrary repos or paths.
- All writes validate JSON structure server‑side before committing.
- CORS on the API is restricted to your GitHub Pages origin.
- User‑entered text is rendered with `textContent` / DOM nodes, not
  `innerHTML` — prevents XSS.
- The deploy workflow greps for token patterns and fails if any are found.

---

## Usage

1. **Set the budget** — Settings → Initial Budget → Save. Existing expenses are untouched; the dashboard recalculates.
2. **Add expenses** — Expenses → *+ Add Expense*.
3. **View the dashboard** — budget, spent, remaining, % used, warnings, breakdown.
4. **View reports** — category / monthly / phase / payment‑method / budget‑vs‑actual.
5. **Edit / delete** — from the Expenses table. Delete confirms first.
6. **Refresh sync** — the *↻ Refresh* button (top bar or Settings) pulls the latest JSON from GitHub. "Last synchronized" shows the time.
7. **Backup** — Settings → Export Backup downloads `home-construction-backup-YYYY-MM-DD.json` (project + budget + expenses + categories). Import validates before writing back.

---

## Testing

Run locally (read‑only unless you point `API_BASE_URL` at a deployed Worker):

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

Checklist:

- **Budget** — set it, change it, confirm Total Spent / Remaining / % recalculate; push spend over budget and confirm the ⚠ warning + red progress bar.
- **Expenses** — add, edit (same row updates), delete (confirm dialog), check totals and charts update.
- **Reports** — category / monthly / phase / payment totals match the expense list.
- **GitHub** — with the Worker live: add an expense, confirm a commit appears in `data/expenses.json` history; stop the Worker and confirm the failure message; edit the file on GitHub directly then try to save from a stale tab and confirm the conflict message.
- **Security** — `grep -RInE 'github_pat_|ghp_' .` finds nothing; view page source on the deployed site and confirm no token.
- **Responsive** — check at 375 / 768 / 1024 / 1440 px: cards stack, table scrolls horizontally, forms go single‑column, nav stays usable.
- **Browsers** — Chrome, Firefox, Edge.

---

## Project structure

```
home-budget-spends/
├── index.html                 # single-page app shell (4 views + modals)
├── style.css                  # responsive styling, light + dark
├── app.js                     # all app logic, API client, validation, charts
├── config.js                  # public config (owner/repo/API URL) — NO secrets
├── config.example.js          # annotated template
├── .nojekyll
├── README.md
├── data/
│   ├── project.json
│   ├── expenses.json
│   └── categories.json
├── api/
│   └── cloudflare-worker/
│       ├── worker.js          # the secure API (holds the token)
│       ├── wrangler.toml      # non-secret config
│       └── README.md          # API setup + token instructions
└── .github/workflows/deploy.yml
```

---

## License

MIT — do what you like.
