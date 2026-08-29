/*
 * Copy this file to `config.js` and fill in your values.
 *
 * SECURITY: This file is served to the browser as a public static asset.
 * It MUST NOT contain a GitHub token, password, or any other secret.
 * The only secret (the GitHub write token) lives on the serverless API
 * as a server-side environment secret — never here.
 */
window.APP_CONFIG = {
  // GitHub repository that stores the data/*.json files.
  GITHUB_OWNER: "your-github-username",
  GITHUB_REPOSITORY: "home-budget-spends",

  // Branch the data files live on.
  GITHUB_BRANCH: "main",

  // Folder inside the repo that holds project.json / expenses.json / categories.json
  DATA_PATH: "data",

  // Base URL of the deployed serverless API (Cloudflare Worker / Netlify / Vercel).
  // Example: "https://home-budget-api.your-name.workers.dev"
  // Leave empty ("") to run in READ-ONLY mode using the bundled static JSON files.
  API_BASE_URL: "",

  // If your API is configured with a WRITE_PASSPHRASE secret, the app will
  // prompt for it on first write and keep it in sessionStorage. Set to false
  // if your API has no passphrase configured.
  API_REQUIRES_PASSPHRASE: true
};
