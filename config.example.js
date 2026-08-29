/*
 * Copy this file to `config.js` and fill in your values.
 *
 * SECURITY: This file is served to the browser as a public static asset.
 * It MUST NOT contain a GitHub token, password, or any other secret.
 */
window.APP_CONFIG = {
  // Your GitHub username / org.
  GITHUB_OWNER: "your-github-username",

  // The repo that hosts this app on GitHub Pages.
  GITHUB_REPOSITORY: "House-spends",

  // Where the data/*.json files live. Leave "" to use GITHUB_REPOSITORY.
  // Set this to a PRIVATE repo (e.g. "home-budget-data") if you don't want the
  // expense numbers to be publicly readable — the app can still be on free
  // GitHub Pages because only the app repo needs to be public.
  DATA_REPO: "",

  GITHUB_BRANCH: "main",
  DATA_PATH: "data",

  // -------------------------------------------------------------------
  // How writes reach GitHub:
  //
  //  "direct"  (recommended for personal use)
  //     The browser calls the GitHub API directly using a fine-grained
  //     personal access token that YOU paste into the app. The token is
  //     stored only in your browser (session storage, or local storage if
  //     you tick "remember on this device"). It is never in this file, never
  //     committed. Only a device holding the token can read/write the data.
  //     No server to run.
  //
  //  "api"
  //     Writes go through a small serverless proxy (Cloudflare Worker in
  //     api/cloudflare-worker/) that holds the token as a server-side secret.
  //     Use this if several people share the app and you don't want each of
  //     them to hold a token.
  // -------------------------------------------------------------------
  AUTH_MODE: "direct",

  // Only used when AUTH_MODE === "api":
  API_BASE_URL: "",              // e.g. "https://home-budget-api.you.workers.dev"
  API_REQUIRES_PASSPHRASE: true  // false if the Worker has no WRITE_PASSPHRASE secret
};
