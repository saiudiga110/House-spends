/*
 * Public config. Edit these values for your deployment.
 * SECURITY: never put a GitHub token or any secret in this file — it is public.
 */
window.APP_CONFIG = {
  GITHUB_OWNER: "saiudiga110",

  // Repo that holds the app (this one). Used as the default data repo too.
  GITHUB_REPOSITORY: "House-spends",

  // Optional: keep the data in a SEPARATE repo (e.g. a private one) so the
  // expense JSON is not world-readable. Leave "" to use GITHUB_REPOSITORY.
  DATA_REPO: "",

  GITHUB_BRANCH: "main",
  DATA_PATH: "data",

  // "direct" = browser talks to GitHub using a fine-grained token you paste in
  //            (stored only in your browser; no server needed).
  // "api"    = writes go through the serverless proxy at API_BASE_URL.
  AUTH_MODE: "direct",

  // Only used when AUTH_MODE is "api".
  API_BASE_URL: "",
  API_REQUIRES_PASSPHRASE: true
};
