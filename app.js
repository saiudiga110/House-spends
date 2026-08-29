/* =====================================================================
 * Home Construction Expense Tracker — front-end application
 * Vanilla JS. No build step. Safe for GitHub Pages.
 *
 * SECURITY: This file is public. It contains NO secrets and NO hardcoded
 * token. Two write modes:
 *   - "direct": the browser calls the GitHub API using a fine-grained token
 *     that YOU paste in. It is kept only in this browser (session or, if you
 *     opt in, local storage) — never in the code, never committed. Only a
 *     device holding that token can read/write the data repo.
 *   - "api": writes go through a serverless proxy (config.API_BASE_URL) that
 *     holds the token as a server-side secret. Best when several people use
 *     the same app.
 * ===================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  var CFG = window.APP_CONFIG || {};
  var API_BASE = (CFG.API_BASE_URL || "").replace(/\/+$/, "");
  var DATA_PATH = (CFG.DATA_PATH || "data").replace(/^\/+|\/+$/g, "");
  var FILES = ["project", "budgets", "expenses", "categories", "funds"];
  var FILE_NAMES = { project: "project.json", budgets: "budgets.json", expenses: "expenses.json", categories: "categories.json", funds: "funds.json" };
  var PRIMARY_BUDGET_ID = "budget-primary";

  // "direct" (browser -> GitHub with your token) | "api" (serverless proxy) | "readonly"
  var MODE = CFG.AUTH_MODE || (API_BASE ? "api" : "direct");
  var GH_OWNER = CFG.GITHUB_OWNER || "";
  // The data can live in a SEPARATE (e.g. private) repo from the app.
  var DATA_REPO = CFG.DATA_REPO || CFG.GITHUB_REPOSITORY || "";
  var GH_BRANCH = CFG.GITHUB_BRANCH || "main";
  var GH_API = "https://api.github.com";
  var TOKEN_HELP_URL = "https://github.com/settings/personal-access-tokens/new";

  var PHASES = ["Planning", "Foundation", "Structure", "Walls", "Roofing",
    "Electrical", "Plumbing", "Flooring", "Painting", "Interior", "Kitchen",
    "Bathroom", "Final Works", "Other"];
  var PAYMENT_METHODS = ["Cash", "UPI", "Bank Transfer", "Credit Card",
    "Debit Card", "Cheque", "Other"];
  var DEFAULT_CATEGORIES = ["Land", "Architect", "Plan Approval", "Materials",
    "Cement", "Steel", "Bricks", "Sand", "Plumbing", "Electrical", "Flooring",
    "Painting", "Doors & Windows", "Kitchen", "Bathroom", "Labour", "Contractor",
    "Furniture", "Appliances", "Transportation", "Government Fees", "Miscellaneous"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var CURRENCY_SYMBOL = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  var state = {
    mode: MODE,
    ghUser: null,      // login string once a token is validated (direct mode)
    canWrite: MODE === "api",
    project: null,
    expenses: [],
    categories: DEFAULT_CATEGORIES.slice(),
    funds: [],
    budgets: [],
    sha: { project: null, budgets: null, expenses: null, categories: null, funds: null },
    lastSync: null,
    view: "dashboard"
  };

  var filters = { search: "", category: "", phase: "", payment: "", fund: "", budget: "", from: "", to: "", sort: "newest" };

  // ---------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else if (k === "text") node.textContent = attrs[k];
        else if (k === "html") node.innerHTML = attrs[k]; // only used with trusted static strings
        else if (k.slice(0, 2) === "on" && typeof attrs[k] === "function") node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function indianNumber(n) {
    try { return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n); }
    catch (e) { return String(Math.round(n)); }
  }

  function formatCurrency(amount) {
    var currency = (state.project && state.project.currency) || "INR";
    var sym = CURRENCY_SYMBOL[currency] || "";
    var neg = amount < 0;
    var abs = Math.abs(Math.round(amount));
    var body = currency === "INR" ? indianNumber(abs)
      : (function () { try { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(abs); } catch (e) { return String(abs); } })();
    return (neg ? "-" : "") + sym + body;
  }

  function formatDate(iso) {
    if (!iso) return "";
    var d = new Date(String(iso).slice(0, 10) + "T00:00:00");
    if (isNaN(d.getTime())) return String(iso);
    return pad2(d.getDate()) + "-" + MONTHS[d.getMonth()] + "-" + d.getFullYear();
  }
  function formatDateTime(d) {
    if (!d) return "";
    var dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return "";
    var h = dt.getHours(), m = pad2(dt.getMinutes());
    var ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return formatDate(dt.toISOString()) + " " + h + ":" + m + " " + ampm;
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function todayISO() { return new Date().toISOString().slice(0, 10); }

  function uid() {
    return "expense-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  function toast(message, kind, ms) {
    var t = el("div", { class: "toast " + (kind || "info"), text: message });
    $("toast-stack").appendChild(t);
    setTimeout(function () { t.style.opacity = "0"; setTimeout(function () { t.remove(); }, 250); }, ms || 3200);
  }

  // ---------------------------------------------------------------------
  // Credentials — never in the code, only in this browser
  //   API passphrase  -> sessionStorage
  //   GitHub token    -> sessionStorage, or localStorage if "remember" ticked
  // ---------------------------------------------------------------------
  function getPassphrase() {
    try { return sessionStorage.getItem("hcet_passphrase") || ""; } catch (e) { return ""; }
  }
  function setPassphrase(v) {
    try { sessionStorage.setItem("hcet_passphrase", v); } catch (e) { /* ignore */ }
  }
  function askPassphrase() {
    return new Promise(function (resolve) {
      var modal = $("pass-modal"), form = $("pass-form"), input = $("pass-input");
      input.value = "";
      modal.hidden = false;
      input.focus();
      function done(val) {
        modal.hidden = true;
        form.onsubmit = null;
        $("pass-cancel").onclick = null;
        resolve(val);
      }
      form.onsubmit = function (e) { e.preventDefault(); var v = input.value.trim(); if (v) { setPassphrase(v); done(v); } };
      $("pass-cancel").onclick = function () { done(""); };
    });
  }

  function getToken() {
    try { return localStorage.getItem("hcet_token") || sessionStorage.getItem("hcet_token") || ""; }
    catch (e) { return ""; }
  }
  function saveToken(tok, remember) {
    clearToken();
    try { (remember ? localStorage : sessionStorage).setItem("hcet_token", tok); } catch (e) { /* ignore */ }
  }
  function clearToken() {
    try { localStorage.removeItem("hcet_token"); sessionStorage.removeItem("hcet_token"); } catch (e) { /* ignore */ }
    state.ghUser = null; state.canWrite = false;
  }
  function tokenIsRemembered() {
    try { return !!localStorage.getItem("hcet_token"); } catch (e) { return false; }
  }

  // Validate a token against GitHub and confirm write access to the data repo.
  function validateToken(tok) {
    return fetch(GH_API + "/user", { headers: ghHeaders(tok) })
      .then(function (r) {
        if (r.status === 401) { var e = new Error("That token is invalid or expired."); e.code = "auth"; throw e; }
        if (!r.ok) { var e2 = new Error("GitHub rejected the token (" + r.status + ")."); e2.code = "auth"; throw e2; }
        return r.json();
      })
      .then(function (u) {
        return fetch(GH_API + "/repos/" + GH_OWNER + "/" + DATA_REPO, { headers: ghHeaders(tok) })
          .then(function (r) {
            if (!r.ok) { var e = new Error("Token cannot access " + GH_OWNER + "/" + DATA_REPO + "."); e.code = "auth"; throw e; }
            return r.json();
          })
          .then(function (repo) {
            if (!repo.permissions || !repo.permissions.push) {
              var e = new Error("Token has read-only access. It needs Contents: Read and write."); e.code = "auth"; throw e;
            }
            return u.login;
          });
      });
  }

  function ghHeaders(tok) {
    var h = { "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    if (tok) h["Authorization"] = "Bearer " + tok;
    return h;
  }

  // Open the "Connect to GitHub" modal. Resolves to a validated token, or "".
  function askToken() {
    return new Promise(function (resolve) {
      var modal = $("token-modal"), form = $("token-form");
      var input = $("token-input"), remember = $("token-remember"), errBox = $("token-error");
      var submit = $("token-submit");
      input.value = ""; errBox.hidden = true; remember.checked = tokenIsRemembered();
      modal.hidden = false;
      input.focus();
      function close(val) {
        modal.hidden = true; form.onsubmit = null; $("token-cancel").onclick = null;
        resolve(val);
      }
      $("token-cancel").onclick = function () { close(""); };
      form.onsubmit = function (e) {
        e.preventDefault();
        var v = input.value.trim();
        if (!v) return;
        errBox.hidden = true; submit.disabled = true; submit.textContent = "Checking…";
        validateToken(v).then(function (login) {
          saveToken(v, remember.checked);
          state.ghUser = login; state.canWrite = true;
          submit.disabled = false; submit.textContent = "Connect";
          close(v);
        }).catch(function (err) {
          submit.disabled = false; submit.textContent = "Connect";
          errBox.textContent = err.message || "Could not verify the token."; errBox.hidden = false;
        });
      };
    });
  }

  // ---------------------------------------------------------------------
  // Data client
  // ---------------------------------------------------------------------
  var dataClient = {
    readAll: function () {
      if (state.mode === "api") return this._readAllApi();
      if (state.mode === "direct") return this._readAllDirect();
      return this._readAllStatic();
    },

    _ghContentsUrl: function (name) {
      return GH_API + "/repos/" + GH_OWNER + "/" + DATA_REPO + "/contents/" +
        DATA_PATH + "/" + FILE_NAMES[name];
    },

    _readAllDirect: function () {
      var tok = getToken();
      var self = this;
      return Promise.all(FILES.map(function (name) {
        return fetch(self._ghContentsUrl(name) + "?ref=" + encodeURIComponent(GH_BRANCH),
          { headers: ghHeaders(tok), cache: "no-store" })
          .then(function (r) {
            if (r.status === 404) return { name: name, content: null, sha: null };
            if (r.status === 401 || r.status === 403) {
              var e = new Error("GitHub denied access to " + name + " (" + r.status + ")."); e.code = "auth"; throw e;
            }
            if (!r.ok) throw new Error("GitHub read failed for " + name + " (" + r.status + ")");
            return r.json().then(function (body) {
              if (body.encoding !== "base64" || !body.content) {
                if (body.size > 1000000) throw new Error(name + ".json is over 1 MB — too large for direct mode.");
                return { name: name, content: null, sha: body.sha };
              }
              var text = b64decode(body.content);
              var parsed;
              try { parsed = JSON.parse(text); }
              catch (e) { throw new Error(name + ".json in the repo is not valid JSON."); }
              return { name: name, content: parsed, sha: body.sha };
            });
          });
      })).then(function (results) {
        results.forEach(function (res) {
          applyLoadedFile(res.name, res.content);
          state.sha[res.name] = res.sha || null;
        });
        state.lastSync = new Date();
        if (tok && !state.ghUser) { state.canWrite = true; }
      });
    },

    _readAllApi: function () {
      return Promise.all(FILES.map(function (name) {
        return fetch(API_BASE + "/api/data/" + name, { headers: { "Accept": "application/json" } })
          .then(function (r) {
            if (!r.ok) throw new Error("API read failed for " + name + " (" + r.status + ")");
            return r.json();
          })
          .then(function (body) { return { name: name, content: body.content, sha: body.sha }; });
      })).then(function (results) {
        results.forEach(function (res) {
          applyLoadedFile(res.name, res.content);
          state.sha[res.name] = res.sha || null;
        });
        state.lastSync = new Date();
      });
    },

    _readAllStatic: function () {
      return Promise.all(FILES.map(function (name) {
        return fetch(DATA_PATH + "/" + name + ".json", { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("static read failed for " + name); return r.json(); })
          .then(function (content) { return { name: name, content: content }; });
      })).then(function (results) {
        results.forEach(function (res) { applyLoadedFile(res.name, res.content); });
        state.lastSync = new Date();
      });
    },

    // Write one file. Returns Promise resolving to new sha, or rejecting with
    // Error whose .code may be "conflict" | "offline" | "readonly" | "auth".
    write: function (name, content, message) {
      if (state.mode === "direct") return this._writeDirect(name, content, message);
      if (state.mode !== "api") {
        var e = new Error("Read-only mode: no API configured."); e.code = "readonly"; return Promise.reject(e);
      }
      var self = this;
      var passReq = CFG.API_REQUIRES_PASSPHRASE !== false;
      var pass = getPassphrase();
      var ensurePass = (passReq && !pass) ? askPassphrase() : Promise.resolve(pass);

      return ensurePass.then(function (pp) {
        if (passReq && !pp) { var e = new Error("Passphrase required."); e.code = "auth"; throw e; }
        var headers = { "Content-Type": "application/json" };
        if (pp) headers["x-write-passphrase"] = pp;
        return fetch(API_BASE + "/api/data/" + name, {
          method: "PUT",
          headers: headers,
          body: JSON.stringify({ content: content, baseSha: state.sha[name] || null, message: message || ("Update " + name) })
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (body) { return { r: r, body: body }; });
        }).then(function (o) {
          if (o.r.status === 409) {
            var ce = new Error("Data changed on GitHub. Please refresh and try again."); ce.code = "conflict"; throw ce;
          }
          if (o.r.status === 401 || o.r.status === 403) {
            try { sessionStorage.removeItem("hcet_passphrase"); } catch (e) {}
            var ae = new Error("API rejected the passphrase."); ae.code = "auth"; throw ae;
          }
          if (!o.r.ok || !o.body || o.body.ok === false) {
            throw new Error((o.body && o.body.error) || ("API write failed (" + o.r.status + ")"));
          }
          state.sha[name] = o.body.sha || state.sha[name];
          state.lastSync = new Date();
          return o.body.sha;
        }).catch(function (err) {
          if (err.code) throw err;
          var oe = new Error("Unable to connect to the data service."); oe.code = "offline"; oe.cause = err; throw oe;
        });
      });
    },

    // Direct browser -> GitHub Contents API write. GitHub itself enforces the
    // optimistic-concurrency check via the blob sha (409 / 422 on mismatch).
    _writeDirect: function (name, content, message) {
      var self = this;
      var tok = getToken();
      var ensure = tok ? Promise.resolve(tok) : askToken();
      return ensure.then(function (t) {
        if (!t) { var e = new Error("A GitHub token is required to save."); e.code = "auth"; throw e; }
        var body = {
          message: (message || ("Update " + name)).replace(/[\r\n]+/g, " ").slice(0, 120),
          content: b64encode(JSON.stringify(content, null, 2) + "\n"),
          branch: GH_BRANCH
        };
        if (state.sha[name]) body.sha = state.sha[name];
        return fetch(self._ghContentsUrl(name), {
          method: "PUT",
          headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders(t)),
          body: JSON.stringify(body)
        }).then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; });
        }).then(function (o) {
          if (o.r.status === 409 || o.r.status === 422) {
            var ce = new Error("Data changed on GitHub. Please refresh and try again."); ce.code = "conflict"; throw ce;
          }
          if (o.r.status === 401) {
            clearToken();
            var ae = new Error("Your GitHub token is invalid or expired. Reconnect and try again."); ae.code = "auth"; throw ae;
          }
          if (o.r.status === 403) {
            var pe = new Error("GitHub refused the write (token lacks Contents: write, or rate limited)."); pe.code = "auth"; throw pe;
          }
          if (!o.r.ok || !o.j.content) {
            throw new Error((o.j && o.j.message) || ("GitHub write failed (" + o.r.status + ")"));
          }
          state.sha[name] = o.j.content.sha;
          state.lastSync = new Date();
          return o.j.content.sha;
        }).catch(function (err) {
          if (err.code) throw err;
          var oe = new Error("Unable to reach GitHub."); oe.code = "offline"; oe.cause = err; throw oe;
        });
      });
    }
  };

  function b64decode(s) {
    var bin = atob(String(s || "").replace(/\s/g, ""));
    var bytes = Uint8Array.from(bin, function (c) { return c.charCodeAt(0); });
    return new TextDecoder().decode(bytes);
  }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    bytes.forEach(function (b) { bin += String.fromCharCode(b); });
    return btoa(bin);
  }

  function applyLoadedFile(name, content) {
    if (name === "project") {
      state.project = normalizeProject(content || {});
    } else if (name === "expenses") {
      var list = (content && Array.isArray(content.expenses)) ? content.expenses : [];
      state.expenses = list.filter(isValidExpenseShape).map(normalizeExpense);
    } else if (name === "categories") {
      var cats = (content && Array.isArray(content.categories)) ? content.categories : DEFAULT_CATEGORIES.slice();
      state.categories = dedupeStrings(cats).slice(0, 200);
      if (!state.categories.length) state.categories = DEFAULT_CATEGORIES.slice();
    } else if (name === "funds") {
      var fl = (content && Array.isArray(content.funds)) ? content.funds : [];
      state.funds = fl.filter(function (f) { return f && typeof f === "object" && typeof f.id === "string"; })
        .map(normalizeFund).slice(0, 200);
    } else if (name === "budgets") {
      var bl = (content && Array.isArray(content.budgets)) ? content.budgets : [];
      state.budgets = bl.filter(function (b) { return b && typeof b === "object" && typeof b.id === "string"; })
        .map(normalizeBudget).slice(0, 200);
      ensurePrimaryBudget();
    }
  }

  // If budgets.json has no entries yet, keep one derived from project.initialBudget
  // so nothing breaks for a project that never used multiple budgets.
  function ensurePrimaryBudget() {
    if (state.budgets.length) return;
    var amount = Number(state.project ? state.project.initialBudget : 0) || 0;
    var now = new Date().toISOString();
    state.budgets = [normalizeBudget({ id: PRIMARY_BUDGET_ID, name: "Main Budget", amount: amount, createdAt: now, updatedAt: now })];
  }

  // ---------------------------------------------------------------------
  // Validation / normalization
  // ---------------------------------------------------------------------
  function normalizeProject(p) {
    var now = new Date().toISOString();
    return {
      projectName: typeof p.projectName === "string" && p.projectName.trim() ? p.projectName.trim() : "My New Home",
      initialBudget: numOr(p.initialBudget, 0),
      currency: CURRENCY_SYMBOL[p.currency] ? p.currency : "INR",
      startDate: /^\d{4}-\d{2}-\d{2}$/.test(p.startDate) ? p.startDate : todayISO(),
      createdAt: p.createdAt || now,
      updatedAt: p.updatedAt || now
    };
  }
  function isValidExpenseShape(x) {
    return x && typeof x === "object" && typeof x.id === "string" && isFinite(Number(x.amount));
  }
  function normalizeExpense(x) {
    var now = new Date().toISOString();
    return {
      id: String(x.id),
      date: /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : todayISO(),
      description: str(x.description),
      category: str(x.category) || "Miscellaneous",
      amount: Math.max(0, numOr(x.amount, 0)),
      paymentMethod: str(x.paymentMethod),
      vendor: str(x.vendor),
      phase: str(x.phase),
      notes: str(x.notes),
      fundId: str(x.fundId),
      budgetId: str(x.budgetId),
      createdAt: x.createdAt || now,
      updatedAt: x.updatedAt || now
    };
  }
  function normalizeBudget(b) {
    var now = new Date().toISOString();
    return {
      id: String(b.id),
      name: str(b.name).slice(0, 80) || "Untitled budget",
      amount: Math.max(0, numOr(b.amount, 0)),
      notes: str(b.notes).slice(0, 500),
      createdAt: b.createdAt || now,
      updatedAt: b.updatedAt || now
    };
  }
  function normalizeFund(f) {
    var now = new Date().toISOString();
    return {
      id: String(f.id),
      name: str(f.name).slice(0, 80) || "Untitled source",
      amount: Math.max(0, numOr(f.amount, 0)),
      purpose: str(f.purpose).slice(0, 200),
      notes: str(f.notes).slice(0, 500),
      createdAt: f.createdAt || now,
      updatedAt: f.updatedAt || now
    };
  }
  function numOr(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
  function str(v) { return v == null ? "" : String(v).slice(0, 1000); }
  function dedupeStrings(arr) {
    var seen = {}, out = [];
    arr.forEach(function (s) {
      if (typeof s !== "string") return;
      var t = s.trim();
      var k = t.toLowerCase();
      if (t && !seen[k]) { seen[k] = 1; out.push(t); }
    });
    return out;
  }

  function validateExpenseInput(inp) {
    var errs = [];
    if (!inp.date || !/^\d{4}-\d{2}-\d{2}$/.test(inp.date)) errs.push("A valid date is required.");
    if (!inp.description || !inp.description.trim()) errs.push("Description is required.");
    if (!inp.category) errs.push("Category is required.");
    var amt = Number(inp.amount);
    if (!isFinite(amt) || amt <= 0) errs.push("Amount must be greater than 0.");
    return errs;
  }

  // ---------------------------------------------------------------------
  // Derived calculations
  // ---------------------------------------------------------------------
  function totalSpent() {
    return state.expenses.reduce(function (s, x) { return s + (Number(x.amount) || 0); }, 0);
  }
  function totalBudget() {
    return state.budgets.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
  }
  // Overall summary across ALL budgets.
  function budgetSummary() {
    var budget = totalBudget();
    var spent = totalSpent();
    var remaining = budget - spent;
    var pct = budget > 0 ? (spent / budget) * 100 : 0;
    return { budget: budget, spent: spent, remaining: remaining, pct: pct, over: spent > budget };
  }
  function budgetById(id) {
    for (var i = 0; i < state.budgets.length; i++) if (state.budgets[i].id === id) return state.budgets[i];
    return null;
  }
  // Per budget: limit vs spent (expenses tagged to it) vs remaining.
  function perBudgetSummary() {
    var spentBy = {};
    state.expenses.forEach(function (x) {
      if (x.budgetId) spentBy[x.budgetId] = (spentBy[x.budgetId] || 0) + (Number(x.amount) || 0);
    });
    var rows = state.budgets.map(function (b) {
      var spent = spentBy[b.id] || 0;
      return {
        id: b.id, name: b.name, allocated: b.amount, spent: spent,
        remaining: b.amount - spent, pct: b.amount > 0 ? (spent / b.amount) * 100 : 0,
        over: spent > b.amount
      };
    });
    var taggedSpent = Object.keys(spentBy).reduce(function (s, k) { return budgetById(k) ? s + spentBy[k] : s; }, 0);
    return { rows: rows, unassigned: totalSpent() - taggedSpent, anyOver: rows.some(function (r) { return r.over; }) };
  }
  function groupSum(keyFn) {
    var map = {};
    state.expenses.forEach(function (x) {
      var k = keyFn(x) || "—";
      map[k] = (map[k] || 0) + (Number(x.amount) || 0);
    });
    return Object.keys(map).map(function (k) { return { key: k, value: map[k] }; })
      .sort(function (a, b) { return b.value - a.value; });
  }
  function monthlySeries() {
    var map = {};
    state.expenses.forEach(function (x) {
      var k = String(x.date).slice(0, 7); // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(k)) return;
      map[k] = (map[k] || 0) + (Number(x.amount) || 0);
    });
    return Object.keys(map).sort().map(function (k) {
      var parts = k.split("-");
      return { key: MONTHS[Number(parts[1]) - 1] + " " + parts[0], value: map[k] };
    });
  }
  function fundById(id) {
    for (var i = 0; i < state.funds.length; i++) if (state.funds[i].id === id) return state.funds[i];
    return null;
  }
  // Per funding-source: allocated amount vs what has actually been spent from it.
  function fundSummary() {
    var spentByFund = {};
    state.expenses.forEach(function (x) {
      if (x.fundId) spentByFund[x.fundId] = (spentByFund[x.fundId] || 0) + (Number(x.amount) || 0);
    });
    var rows = state.funds.map(function (f) {
      var spent = spentByFund[f.id] || 0;
      return {
        id: f.id, name: f.name, purpose: f.purpose, allocated: f.amount,
        spent: spent, remaining: f.amount - spent,
        pct: f.amount > 0 ? (spent / f.amount) * 100 : 0,
        over: spent > f.amount
      };
    });
    var totalAllocated = state.funds.reduce(function (s, f) { return s + f.amount; }, 0);
    var taggedSpent = Object.keys(spentByFund).reduce(function (s, k) {
      return fundById(k) ? s + spentByFund[k] : s;
    }, 0);
    var untagged = totalSpent() - taggedSpent;
    return { rows: rows, totalAllocated: totalAllocated, taggedSpent: taggedSpent, untagged: untagged };
  }

  // ---------------------------------------------------------------------
  // Rendering — chart primitive
  // ---------------------------------------------------------------------
  function renderBarChart(host, rows, opts) {
    opts = opts || {};
    host.innerHTML = "";
    if (!rows.length) {
      host.appendChild(el("div", { class: "chart-empty", text: opts.empty || "No data yet." }));
      return;
    }
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; })) || 1;
    rows.forEach(function (r, i) {
      var pct = Math.max(1, (r.value / max) * 100);
      var color = "var(--chart-" + ((i % 8) + 1) + ")";
      host.appendChild(el("div", { class: "bar-row" }, [
        el("span", { class: "bar-label", title: r.key, text: r.key }),
        el("div", { class: "bar-track" }, [
          el("div", { class: "bar-value", style: "width:" + pct + "%;background:" + color })
        ]),
        el("span", { class: "bar-amt", text: formatCurrency(r.value) })
      ]));
    });
  }

  // ---------------------------------------------------------------------
  // Rendering — views
  // ---------------------------------------------------------------------
  function renderAll() {
    $("brand-project-name").textContent = state.project ? state.project.projectName : "Home Construction Tracker";
    renderSyncStatus();
    renderConnectBanner();
    renderDashboard();
    renderExpenses();
    renderReports();
    renderSettings();
  }

  function renderConnectBanner() {
    var ro = $("readonly-banner");
    if (state.mode === "readonly") {
      ro.hidden = false;
      ro.textContent = "Read-only mode: data is loaded from the bundled JSON files and changes cannot be saved.";
    } else if (state.mode === "direct" && !state.canWrite) {
      ro.hidden = false;
      ro.textContent = "";
      ro.appendChild(document.createTextNode("Not connected to GitHub — you can view data but not save. "));
      ro.appendChild(el("button", { class: "btn btn-primary btn-sm", type: "button",
        onclick: function () { askToken().then(function (t) { if (t) refresh(); }); } }, ["Connect to GitHub"]));
    } else {
      ro.hidden = true;
    }
  }

  function renderSyncStatus() {
    var dot = $("sync-indicator"), label = $("sync-label"), time = $("sync-time");
    dot.className = "sync-dot";
    if (state.mode === "readonly") { dot.classList.add("warn"); label.textContent = "Read-only"; }
    else if (state.mode === "direct" && !state.canWrite) { dot.classList.add("warn"); label.textContent = "View only"; }
    else if (state.lastSync) { dot.classList.add("ok"); label.textContent = "Synced"; }
    else { dot.classList.add("err"); label.textContent = "Not synced"; }
    time.textContent = state.lastSync ? formatDateTime(state.lastSync) : "";

    var detail = $("sync-detail");
    if (detail) {
      detail.innerHTML = "";
      var modeText = state.mode === "api" ? "Secure API proxy (" + API_BASE + ")"
        : state.mode === "direct" ? "Direct — browser to GitHub with your token"
        : "Read-only (bundled JSON)";
      kv(detail, "Mode", modeText);
      if (state.mode === "direct") {
        kv(detail, "GitHub connection", state.canWrite
          ? "Connected" + (state.ghUser ? " as " + state.ghUser : "") + (tokenIsRemembered() ? " (remembered on this device)" : " (this session only)")
          : "Not connected");
      }
      kv(detail, "Data repository", (GH_OWNER || "?") + "/" + (DATA_REPO || "?"));
      kv(detail, "Branch", GH_BRANCH);
      kv(detail, "Data path", DATA_PATH + "/");
      kv(detail, "Last synchronized", state.lastSync ? formatDateTime(state.lastSync) : "never");
    }
  }
  function kv(host, k, v) {
    host.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k", text: k }), el("span", { class: "v", text: v })]));
  }

  function renderDashboard() {
    var s = budgetSummary();
    var multi = state.budgets.length > 1;
    $("stat-budget-label").textContent = multi ? "All Budgets" : "Initial Budget";
    $("stat-budget").textContent = formatCurrency(s.budget);
    $("stat-spent").textContent = formatCurrency(s.spent);
    $("stat-remaining").textContent = formatCurrency(s.remaining);
    $("stat-percent").textContent = (Math.round(s.pct * 10) / 10) + "%";
    $("stat-remaining").parentElement.classList.toggle("over", s.remaining < 0);

    var fill = $("progress-fill");
    fill.style.width = Math.min(100, Math.max(0, s.pct)) + "%";
    fill.className = "progress-fill" + (s.over ? " over" : s.pct >= 80 ? " warn" : "");
    $("progress-caption").textContent = formatCurrency(s.spent) + " of " + formatCurrency(s.budget)
      + " · " + (Math.round(s.pct * 10) / 10) + "% used" + (multi ? " (all budgets)" : "");

    var pbs = perBudgetSummary();
    var warn = $("budget-warning");
    if (s.over || pbs.anyOver) {
      warn.hidden = false;
      var lines = $("budget-warning-lines");
      lines.innerHTML = "";
      if (s.over) {
        lines.appendChild(el("div", { text: "Total budget: " + formatCurrency(s.budget) }));
        lines.appendChild(el("div", { text: "Total spent: " + formatCurrency(s.spent) }));
        lines.appendChild(el("div", { text: "Exceeded by: " + formatCurrency(Math.abs(s.remaining)) }));
      }
      pbs.rows.filter(function (r) { return r.over; }).forEach(function (r) {
        lines.appendChild(el("div", { text: "“" + r.name + "” over by " + formatCurrency(Math.abs(r.remaining)) + " (" + formatCurrency(r.spent) + " of " + formatCurrency(r.allocated) + ")" }));
      });
      $("budget-warning").querySelector("strong").textContent = s.over ? "⚠ Budget Exceeded" : "⚠ A budget is exceeded";
    } else {
      warn.hidden = true;
    }

    // Per-budget progress list
    var bCard = $("dash-budgets-card");
    if (bCard) {
      bCard.hidden = state.budgets.length < 2;
      var bh = $("dash-budgets");
      bh.innerHTML = "";
      pbs.rows.forEach(function (r) {
        var pct = Math.min(100, Math.max(0, r.pct));
        bh.appendChild(el("div", { class: "fund-mini" }, [
          el("div", { class: "fund-mini-head" }, [
            el("span", { text: r.name }),
            el("span", { class: "muted", text: formatCurrency(r.spent) + " / " + formatCurrency(r.allocated) + " · " + formatCurrency(r.remaining) + " left" })
          ]),
          el("div", { class: "progress-track", style: "height:8px" }, [
            el("div", { class: "progress-fill" + (r.over ? " over" : pct >= 80 ? " warn" : ""), style: "width:" + pct + "%" })
          ])
        ]));
      });
    }

    renderBarChart($("dash-category-chart"), groupSum(function (x) { return x.category; }).slice(0, 8), { empty: "Add an expense to see the breakdown." });

    var fundCard = $("dash-funds-card");
    if (fundCard) {
      var fs = fundSummary();
      fundCard.hidden = state.funds.length === 0;
      var fh = $("dash-funds");
      fh.innerHTML = "";
      fs.rows.forEach(function (r) {
        var pct = Math.min(100, Math.max(0, r.pct));
        fh.appendChild(el("div", { class: "fund-mini" }, [
          el("div", { class: "fund-mini-head" }, [
            el("span", { text: r.name }),
            el("span", { class: "muted", text: formatCurrency(r.spent) + " / " + formatCurrency(r.allocated) })
          ]),
          el("div", { class: "progress-track", style: "height:8px" }, [
            el("div", { class: "progress-fill" + (r.over ? " over" : pct >= 80 ? " warn" : ""), style: "width:" + pct + "%" })
          ])
        ]));
      });
    }

    var recent = state.expenses.slice().sort(function (a, b) {
      return (b.createdAt || b.date).localeCompare(a.createdAt || a.date);
    }).slice(0, 6);
    var host = $("dash-recent");
    host.innerHTML = "";
    if (!recent.length) { host.appendChild(el("div", { class: "chart-empty", text: "No expenses recorded yet." })); }
    recent.forEach(function (x) {
      host.appendChild(el("div", { class: "recent-row" }, [
        el("div", {}, [
          el("div", { text: x.description || "(no description)" }),
          el("div", { class: "meta", text: formatDate(x.date) + " · " + x.category + (x.vendor ? " · " + x.vendor : "") })
        ]),
        el("div", { class: "amt", text: formatCurrency(x.amount) })
      ]));
    });
  }

  function fillSelect(sel, values, keepFirst) {
    var first = keepFirst ? sel.firstElementChild : null;
    sel.innerHTML = "";
    if (first) sel.appendChild(first);
    values.forEach(function (v) { sel.appendChild(el("option", { value: v, text: v })); });
  }

  function renderExpenses() {
    fillSelect($("filter-category"), state.categories, true);
    fillSelect($("filter-phase"), PHASES, true);
    fillSelect($("filter-payment"), PAYMENT_METHODS, true);
    var ff = $("filter-fund");
    if (ff) {
      var cur = ff.value;
      ff.innerHTML = "";
      ff.appendChild(el("option", { value: "", text: "All funding sources" }));
      ff.appendChild(el("option", { value: "__none__", text: "— not assigned —" }));
      state.funds.forEach(function (f) { ff.appendChild(el("option", { value: f.id, text: f.name })); });
      ff.value = cur;
    }
    var fb = $("filter-budget");
    if (fb) {
      var curB = fb.value;
      fb.innerHTML = "";
      fb.appendChild(el("option", { value: "", text: "All budgets" }));
      fb.appendChild(el("option", { value: "__none__", text: "— not assigned —" }));
      state.budgets.forEach(function (b) { fb.appendChild(el("option", { value: b.id, text: b.name })); });
      fb.value = curB;
    }

    var rows = applyFilters(state.expenses);
    $("expense-count").textContent = rows.length + " of " + state.expenses.length + " expense(s) · Total shown: " + formatCurrency(rows.reduce(function (s, x) { return s + x.amount; }, 0));

    var tb = $("expense-tbody");
    tb.innerHTML = "";
    $("expense-empty").hidden = rows.length > 0;
    rows.forEach(function (x) {
      var tr = el("tr", {}, [
        el("td", { text: formatDate(x.date) }),
        el("td", {}, [el("div", { text: x.description }), x.notes ? el("div", { class: "meta muted", text: x.notes }) : null]),
        el("td", { text: x.category }),
        el("td", { text: (function () { var b = budgetById(x.budgetId); return b ? b.name : "—"; })() }),
        el("td", { text: x.phase || "—" }),
        el("td", { text: (function () { var f = fundById(x.fundId); return f ? f.name : "—"; })() }),
        el("td", { text: x.vendor || "—" }),
        el("td", { text: x.paymentMethod || "—" }),
        el("td", { class: "num", text: formatCurrency(x.amount) }),
        el("td", {}, [
          el("div", { class: "row-actions" }, [
            el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: function () { openExpenseModal(x); } }, ["Edit"]),
            el("button", { class: "btn btn-danger btn-sm", type: "button", onclick: function () { confirmDelete(x); } }, ["Delete"])
          ])
        ])
      ]);
      tb.appendChild(tr);
    });
  }

  function applyFilters(list) {
    var f = filters;
    var out = list.filter(function (x) {
      if (f.category && x.category !== f.category) return false;
      if (f.phase && x.phase !== f.phase) return false;
      if (f.payment && x.paymentMethod !== f.payment) return false;
      if (f.fund === "__none__" && x.fundId) return false;
      if (f.fund && f.fund !== "__none__" && x.fundId !== f.fund) return false;
      if (f.budget === "__none__" && x.budgetId) return false;
      if (f.budget && f.budget !== "__none__" && x.budgetId !== f.budget) return false;
      if (f.from && x.date < f.from) return false;
      if (f.to && x.date > f.to) return false;
      if (f.search) {
        var q = f.search.toLowerCase();
        var hay = (x.description + " " + x.vendor + " " + x.notes).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    out.sort(function (a, b) {
      if (f.sort === "oldest") return a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt);
      if (f.sort === "high") return b.amount - a.amount;
      if (f.sort === "low") return a.amount - b.amount;
      return b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""); // newest
    });
    return out;
  }

  function renderReports() {
    var s = budgetSummary();
    var ba = $("report-budget-actual");
    ba.innerHTML = "";
    var pbs = perBudgetSummary();

    if (state.budgets.length > 1) {
      var table = el("table", { class: "data-table" });
      table.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Budget" }), el("th", { class: "num", text: "Allocated" }),
        el("th", { class: "num", text: "Spent" }), el("th", { class: "num", text: "Remaining" }),
        el("th", { class: "num", text: "Used" })
      ])]));
      var tb = el("tbody");
      pbs.rows.forEach(function (r) {
        tb.appendChild(el("tr", {}, [
          el("td", { text: r.name }),
          el("td", { class: "num", text: formatCurrency(r.allocated) }),
          el("td", { class: "num", text: formatCurrency(r.spent) }),
          el("td", { class: "num", text: formatCurrency(r.remaining), style: r.over ? "color:var(--danger)" : "" }),
          el("td", { class: "num", text: (Math.round(r.pct * 10) / 10) + "%" })
        ]));
      });
      tb.appendChild(el("tr", { style: "font-weight:700" }, [
        el("td", { text: "All budgets" }),
        el("td", { class: "num", text: formatCurrency(s.budget) }),
        el("td", { class: "num", text: formatCurrency(s.spent) }),
        el("td", { class: "num", text: formatCurrency(s.remaining) }),
        el("td", { class: "num", text: (Math.round(s.pct * 10) / 10) + "%" })
      ]));
      table.appendChild(tb);
      ba.appendChild(el("div", { class: "table-wrap" }, [table]));
      if (pbs.unassigned > 0) ba.appendChild(el("p", { class: "muted small", text: "Spending not assigned to any budget: " + formatCurrency(pbs.unassigned) }));
    } else {
      kv(ba, "Initial Budget", formatCurrency(s.budget));
      kv(ba, "Total Spent", formatCurrency(s.spent));
      kv(ba, "Remaining", formatCurrency(s.remaining));
      kv(ba, "Budget Used", (Math.round(s.pct * 10) / 10) + "%");
      kv(ba, "Budget Remaining", (Math.round((100 - s.pct) * 10) / 10) + "%");
    }

    renderBarChart($("report-category-chart"), groupSum(function (x) { return x.category; }), { empty: "No expenses yet." });
    renderBarChart($("report-phase-chart"), groupSum(function (x) { return x.phase || "Unassigned"; }), { empty: "No expenses yet." });
    renderBarChart($("report-monthly-chart"), monthlySeries(), { empty: "No expenses yet." });
    renderBarChart($("report-payment-chart"), groupSum(function (x) { return x.paymentMethod || "Unspecified"; }), { empty: "No expenses yet." });

    renderFundReport($("report-fund-table"));
  }

  // Funding-source report: allocated vs spent vs remaining, per source.
  function renderFundReport(host) {
    if (!host) return;
    host.innerHTML = "";
    var fs = fundSummary();
    if (!state.funds.length) {
      host.appendChild(el("p", { class: "chart-empty", text: "No funding sources yet. Add them in Settings — e.g. \"PF\" ₹4,00,000 for appliances." }));
      return;
    }
    var table = el("table", { class: "data-table" });
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Source" }), el("th", { text: "Purpose" }),
      el("th", { class: "num", text: "Allocated" }), el("th", { class: "num", text: "Spent" }),
      el("th", { class: "num", text: "Remaining" }), el("th", { class: "num", text: "Used" })
    ])]));
    var tb = el("tbody");
    fs.rows.forEach(function (r) {
      tb.appendChild(el("tr", {}, [
        el("td", { text: r.name }),
        el("td", { text: r.purpose || "—" }),
        el("td", { class: "num", text: formatCurrency(r.allocated) }),
        el("td", { class: "num", text: formatCurrency(r.spent) }),
        el("td", { class: "num", text: formatCurrency(r.remaining), style: r.over ? "color:var(--danger)" : "" }),
        el("td", { class: "num", text: (Math.round(r.pct * 10) / 10) + "%" })
      ]));
    });
    tb.appendChild(el("tr", { style: "font-weight:700" }, [
      el("td", { text: "Total allocated" }), el("td", { text: "" }),
      el("td", { class: "num", text: formatCurrency(fs.totalAllocated) }),
      el("td", { class: "num", text: formatCurrency(fs.taggedSpent) }),
      el("td", { class: "num", text: formatCurrency(fs.totalAllocated - fs.taggedSpent) }),
      el("td", { class: "num", text: fs.totalAllocated > 0 ? (Math.round(fs.taggedSpent / fs.totalAllocated * 1000) / 10) + "%" : "—" })
    ]));
    table.appendChild(tb);
    host.appendChild(el("div", { class: "table-wrap" }, [table]));
    if (fs.untagged > 0) {
      host.appendChild(el("p", { class: "muted small", text: "Spending not assigned to any source: " + formatCurrency(fs.untagged) }));
    }
  }

  function renderSettings() {
    if (!state.project) return;
    $("set-name").value = state.project.projectName;
    $("set-start").value = state.project.startDate;
    $("set-currency").value = state.project.currency;

    var bHost = $("budget-list");
    if (bHost) {
      bHost.innerHTML = "";
      var pbs = perBudgetSummary();
      state.budgets.forEach(function (b) {
        var r = pbs.rows.filter(function (x) { return x.id === b.id; })[0] || { spent: 0, remaining: b.amount };
        bHost.appendChild(el("div", { class: "fund-row" }, [
          el("div", {}, [
            el("div", { text: b.name + " · " + formatCurrency(b.amount) }),
            el("div", { class: "meta muted", text: "spent " + formatCurrency(r.spent) + ", " + formatCurrency(r.remaining) + " left" })
          ]),
          el("div", { class: "row-actions" }, [
            el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: function () { openBudgetModal(b); } }, ["Edit"]),
            el("button", { class: "btn btn-danger btn-sm", type: "button", onclick: function () { confirmDeleteBudget(b); } }, ["Delete"])
          ])
        ]));
      });
      bHost.appendChild(el("p", { class: "muted small", text: "Total across all budgets: " + formatCurrency(totalBudget()) }));
    }

    var list = $("category-list");
    list.innerHTML = "";
    state.categories.forEach(function (c) {
      list.appendChild(el("li", { class: "chip" }, [
        el("span", { text: c }),
        el("button", { type: "button", title: "Remove", "aria-label": "Remove " + c, onclick: function () { removeCategory(c); } }, ["✕"])
      ]));
    });

    var fundHost = $("fund-list");
    if (fundHost) {
      fundHost.innerHTML = "";
      if (!state.funds.length) {
        fundHost.appendChild(el("p", { class: "muted small", text: "No funding sources yet. Add one — e.g. name \"PF\", amount ₹4,00,000, purpose \"New home appliances: TV, Fridge, AC\"." }));
      }
      state.funds.forEach(function (f) {
        var sp = fundSummary().rows.filter(function (r) { return r.id === f.id; })[0] || { spent: 0, remaining: f.amount };
        fundHost.appendChild(el("div", { class: "fund-row" }, [
          el("div", {}, [
            el("div", { text: f.name + " · " + formatCurrency(f.amount) }),
            el("div", { class: "meta muted", text: (f.purpose || "no purpose noted") + "  —  spent " + formatCurrency(sp.spent) + ", left " + formatCurrency(sp.remaining) })
          ]),
          el("div", { class: "row-actions" }, [
            el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: function () { openFundModal(f); } }, ["Edit"]),
            el("button", { class: "btn btn-danger btn-sm", type: "button", onclick: function () { confirmDeleteFund(f); } }, ["Delete"])
          ])
        ]));
      });
    }

    // GitHub connection panel (direct mode only)
    var connWrap = $("connection-panel");
    if (connWrap) {
      connWrap.hidden = state.mode !== "direct";
      if (state.mode === "direct") {
        var status = $("connection-status");
        status.textContent = state.canWrite
          ? "Connected" + (state.ghUser ? " as " + state.ghUser : "") + (tokenIsRemembered() ? " · remembered on this device" : " · this browser session only")
          : "Not connected — you can view data but not save changes.";
        $("btn-connect").textContent = state.canWrite ? "Change token" : "Connect to GitHub";
        $("btn-forget-token").hidden = !state.canWrite;
      }
    }

    var forms = qsa("#view-settings button, #view-settings input, #view-settings select");
    var canSave = state.mode === "api" || (state.mode === "direct");
    if (!canSave) {
      forms.forEach(function (n) {
        if (n.id !== "btn-export" && n.id !== "btn-connect" && n.id !== "btn-forget-token") n.disabled = true;
      });
    }
  }

  // ---------------------------------------------------------------------
  // Mutations (all go through the API, then re-render)
  // ---------------------------------------------------------------------
  function expensesPayload() { return { expenses: state.expenses.map(normalizeExpense) }; }
  function categoriesPayload() { return { categories: state.categories }; }
  function fundsPayload() { return { funds: state.funds.map(normalizeFund) }; }
  function budgetsPayload() { return { budgets: state.budgets.map(normalizeBudget) }; }
  function projectPayload() {
    var p = state.project;
    p.updatedAt = new Date().toISOString();
    // Keep initialBudget mirrored to the sum of all budgets for backward compat.
    p.initialBudget = totalBudget();
    return {
      projectName: p.projectName, initialBudget: p.initialBudget, currency: p.currency,
      startDate: p.startDate, createdAt: p.createdAt, updatedAt: p.updatedAt
    };
  }

  function withSaving(btn, label, fn) {
    var prev = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = label || "Saving…"; }
    return Promise.resolve().then(fn).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = prev; }
      return r;
    }, function (err) {
      if (btn) { btn.disabled = false; btn.textContent = prev; }
      handleWriteError(err);
      throw err;
    });
  }

  function handleWriteError(err) {
    if (!err) return;
    if (err.code === "conflict") {
      toast("Data changed on GitHub. Refreshing…", "err", 4000);
      refresh();
    } else if (err.code === "offline") {
      var svc = state.mode === "direct" ? "GitHub" : "the data service";
      toast("Unable to connect to " + svc + ". Your change was not saved. Check your connection and try again.", "err", 5000);
      $("offline-banner").hidden = false;
      $("offline-banner").textContent = "Unable to connect to " + svc + ". Your latest data could not be synchronized. Please check your internet connection and try again.";
    } else if (err.code === "auth") {
      if (state.mode === "direct") {
        toast("GitHub token missing or rejected — reconnect to save.", "err", 4000);
        renderAll();
      } else {
        toast("API passphrase missing or rejected. Try the action again.", "err", 4000);
      }
    } else if (err.code === "readonly") {
      toast("Read-only mode: configure the API to save changes.", "err", 4000);
    } else {
      toast("Save failed: " + err.message, "err", 5000);
    }
  }

  function saveExpenseFromForm() {
    var errBox = $("expense-form-error");
    errBox.hidden = true;
    var input = {
      id: $("ex-id").value || "",
      date: $("ex-date").value,
      description: $("ex-description").value.trim(),
      category: $("ex-category").value,
      amount: $("ex-amount").value,
      paymentMethod: $("ex-payment").value,
      vendor: $("ex-vendor").value.trim(),
      phase: $("ex-phase").value,
      fundId: $("ex-fund").value,
      budgetId: $("ex-budget").value,
      notes: $("ex-notes").value.trim()
    };
    var errs = validateExpenseInput(input);
    if (state.budgets.length && !input.budgetId) errs.push("Please choose a budget.");
    if (errs.length) { errBox.textContent = errs.join(" "); errBox.hidden = false; return; }

    var now = new Date().toISOString();
    var isEdit = !!input.id;
    var snapshot = state.expenses.slice();
    var msg;

    if (isEdit) {
      var idx = state.expenses.findIndex(function (e) { return e.id === input.id; });
      if (idx === -1) { errBox.textContent = "This expense no longer exists. Refresh and retry."; errBox.hidden = false; return; }
      var existing = state.expenses[idx];
      state.expenses[idx] = normalizeExpense(Object.assign({}, existing, input, { updatedAt: now }));
      msg = "Update expense: " + (input.description || existing.description);
    } else {
      var newExp = normalizeExpense(Object.assign({}, input, { id: uid(), createdAt: now, updatedAt: now }));
      state.expenses.push(newExp);
      msg = "Add expense: " + newExp.description + " - " + formatCurrency(newExp.amount);
    }

    withSaving($("expense-submit"), "Saving…", function () {
      return dataClient.write("expenses", expensesPayload(), msg);
    }).then(function () {
      closeExpenseModal();
      toast("✓ Expense saved successfully", "ok");
      $("offline-banner").hidden = true;
      renderAll();
    }).catch(function () {
      state.expenses = snapshot; // roll back optimistic change
      renderAll();
    });
  }

  function confirmDelete(x) {
    openConfirm("Delete expense “" + x.description + "” (" + formatCurrency(x.amount) + ")? This cannot be undone.", function () {
      var snapshot = state.expenses.slice();
      state.expenses = state.expenses.filter(function (e) { return e.id !== x.id; });
      renderAll();
      withSaving($("confirm-yes"), "Deleting…", function () {
        return dataClient.write("expenses", expensesPayload(), "Delete expense: " + x.description);
      }).then(function () {
        toast("Expense deleted", "ok");
        closeConfirm();
        renderAll();
      }).catch(function () {
        state.expenses = snapshot;
        closeConfirm();
        renderAll();
      });
    });
  }

  function saveProjectFromForm(e) {
    e.preventDefault();
    var name = $("set-name").value.trim();
    if (!name) { toast("Project name is required.", "err"); return; }
    var start = $("set-start").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast("A valid start date is required.", "err"); return; }

    var snapshot = Object.assign({}, state.project);
    state.project.projectName = name;
    state.project.startDate = start;
    state.project.currency = $("set-currency").value;

    withSaving(e.submitter, "Saving…", function () {
      return dataClient.write("project", projectPayload(), "Update construction budget / project settings");
    }).then(function () {
      toast("✓ Project settings saved", "ok");
      renderAll();
    }).catch(function () { state.project = snapshot; renderAll(); });
  }

  function addCategory() {
    var input = $("new-category");
    var v = input.value.trim();
    if (!v) return;
    if (state.categories.some(function (c) { return c.toLowerCase() === v.toLowerCase(); })) {
      toast("Category already exists.", "err"); return;
    }
    var snapshot = state.categories.slice();
    state.categories.push(v);
    input.value = "";
    withSaving($("btn-add-category"), "Adding…", function () {
      return dataClient.write("categories", categoriesPayload(), "Add category: " + v);
    }).then(function () { toast("Category added", "ok"); renderAll(); })
      .catch(function () { state.categories = snapshot; renderAll(); });
  }

  function removeCategory(c) {
    var inUse = state.expenses.some(function (x) { return x.category === c; });
    if (inUse) { toast("Cannot remove “" + c + "” — it is used by existing expenses.", "err", 4000); return; }
    var snapshot = state.categories.slice();
    state.categories = state.categories.filter(function (x) { return x !== c; });
    renderAll();
    dataClient.write("categories", categoriesPayload(), "Remove category: " + c)
      .then(function () { toast("Category removed", "ok"); })
      .catch(function (err) { state.categories = snapshot; renderAll(); handleWriteError(err); });
  }

  // ---------------------------------------------------------------------
  // Funding sources
  // ---------------------------------------------------------------------
  function openFundModal(fund) {
    $("fund-form-error").hidden = true;
    $("fund-modal-title").textContent = fund ? "Edit Funding Source" : "Add Funding Source";
    $("fund-id").value = fund ? fund.id : "";
    $("fund-name").value = fund ? fund.name : "";
    $("fund-amount").value = fund ? fund.amount : "";
    $("fund-purpose").value = fund ? fund.purpose : "";
    $("fund-notes").value = fund ? fund.notes : "";
    $("fund-modal").hidden = false;
    $("fund-name").focus();
  }
  function closeFundModal() { $("fund-modal").hidden = true; }

  function saveFundFromForm() {
    var errBox = $("fund-form-error");
    errBox.hidden = true;
    var id = $("fund-id").value || "";
    var name = $("fund-name").value.trim();
    var amount = Number($("fund-amount").value);
    if (!name) { errBox.textContent = "A name is required (e.g. PF, Home Loan, Savings)."; errBox.hidden = false; return; }
    if (!isFinite(amount) || amount <= 0) { errBox.textContent = "Amount must be greater than 0."; errBox.hidden = false; return; }
    if (state.funds.some(function (f) { return f.id !== id && f.name.toLowerCase() === name.toLowerCase(); })) {
      errBox.textContent = "A funding source with that name already exists."; errBox.hidden = false; return;
    }
    var now = new Date().toISOString();
    var snapshot = state.funds.map(function (f) { return Object.assign({}, f); });
    var input = { name: name, amount: amount, purpose: $("fund-purpose").value.trim(), notes: $("fund-notes").value.trim() };
    var msg;
    if (id) {
      var idx = state.funds.findIndex(function (f) { return f.id === id; });
      if (idx === -1) { errBox.textContent = "This source no longer exists. Refresh and retry."; errBox.hidden = false; return; }
      state.funds[idx] = normalizeFund(Object.assign({}, state.funds[idx], input, { updatedAt: now }));
      msg = "Update funding source: " + name;
    } else {
      state.funds.push(normalizeFund(Object.assign({ id: "fund-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), createdAt: now, updatedAt: now }, input)));
      msg = "Add funding source: " + name + " - " + formatCurrency(amount);
    }
    withSaving($("fund-submit"), "Saving…", function () {
      return dataClient.write("funds", fundsPayload(), msg);
    }).then(function () {
      closeFundModal();
      toast("✓ Funding source saved", "ok");
      renderAll();
    }).catch(function () { state.funds = snapshot; renderAll(); });
  }

  function confirmDeleteFund(f) {
    var inUse = state.expenses.filter(function (x) { return x.fundId === f.id; });
    var extra = inUse.length ? " " + inUse.length + " expense(s) are assigned to it — they will become unassigned." : "";
    openConfirm("Delete funding source “" + f.name + "”?" + extra, function () {
      var snapshot = state.funds.map(function (x) { return Object.assign({}, x); });
      var expSnapshot = state.expenses.slice();
      var touchedExpenses = inUse.length > 0;
      state.funds = state.funds.filter(function (x) { return x.id !== f.id; });
      state.expenses = state.expenses.map(function (x) {
        return x.fundId === f.id ? normalizeExpense(Object.assign({}, x, { fundId: "", updatedAt: new Date().toISOString() })) : x;
      });
      renderAll();
      withSaving($("confirm-yes"), "Deleting…", function () {
        return dataClient.write("funds", fundsPayload(), "Delete funding source: " + f.name)
          .then(function () { return touchedExpenses ? dataClient.write("expenses", expensesPayload(), "Unassign expenses from deleted source: " + f.name) : null; });
      }).then(function () {
        toast("Funding source deleted", "ok");
        closeConfirm();
        renderAll();
      }).catch(function () {
        state.funds = snapshot; state.expenses = expSnapshot;
        closeConfirm(); renderAll();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Budgets
  // ---------------------------------------------------------------------
  function openBudgetModal(budget) {
    $("budget-form-error").hidden = true;
    $("budget-modal-title").textContent = budget ? "Edit Budget" : "Add Budget";
    $("budget-id").value = budget ? budget.id : "";
    $("budget-name").value = budget ? budget.name : "";
    $("budget-amount").value = budget ? budget.amount : "";
    $("budget-notes").value = budget ? budget.notes : "";
    $("budget-modal").hidden = false;
    $("budget-name").focus();
  }
  function closeBudgetModal() { $("budget-modal").hidden = true; }

  function saveBudgetFromForm() {
    var errBox = $("budget-form-error");
    errBox.hidden = true;
    var id = $("budget-id").value || "";
    var name = $("budget-name").value.trim();
    var amount = Number($("budget-amount").value);
    if (!name) { errBox.textContent = "A name is required (e.g. Construction, Interiors, Appliances)."; errBox.hidden = false; return; }
    if (!isFinite(amount) || amount <= 0) { errBox.textContent = "Amount must be greater than 0."; errBox.hidden = false; return; }
    if (state.budgets.some(function (b) { return b.id !== id && b.name.toLowerCase() === name.toLowerCase(); })) {
      errBox.textContent = "A budget with that name already exists."; errBox.hidden = false; return;
    }
    var now = new Date().toISOString();
    var snapshot = state.budgets.map(function (b) { return Object.assign({}, b); });
    var projSnap = Object.assign({}, state.project);
    var input = { name: name, amount: amount, notes: $("budget-notes").value.trim() };
    var msg;
    if (id) {
      var idx = state.budgets.findIndex(function (b) { return b.id === id; });
      if (idx === -1) { errBox.textContent = "This budget no longer exists. Refresh and retry."; errBox.hidden = false; return; }
      state.budgets[idx] = normalizeBudget(Object.assign({}, state.budgets[idx], input, { updatedAt: now }));
      msg = "Update budget: " + name;
    } else {
      state.budgets.push(normalizeBudget(Object.assign({ id: "budget-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), createdAt: now, updatedAt: now }, input)));
      msg = "Add budget: " + name + " - " + formatCurrency(amount);
    }
    withSaving($("budget-submit"), "Saving…", function () {
      return dataClient.write("budgets", budgetsPayload(), msg)
        .then(function () { return dataClient.write("project", projectPayload(), "Sync total budget"); });
    }).then(function () {
      closeBudgetModal();
      toast("✓ Budget saved", "ok");
      renderAll();
    }).catch(function () { state.budgets = snapshot; state.project = projSnap; renderAll(); });
  }

  function confirmDeleteBudget(b) {
    if (state.budgets.length <= 1) { toast("At least one budget is required.", "err", 4000); return; }
    var inUse = state.expenses.filter(function (x) { return x.budgetId === b.id; });
    var extra = inUse.length ? " " + inUse.length + " expense(s) are assigned to it — they will become unassigned." : "";
    openConfirm("Delete budget “" + b.name + "” (" + formatCurrency(b.amount) + ")?" + extra, function () {
      var bSnap = state.budgets.map(function (x) { return Object.assign({}, x); });
      var eSnap = state.expenses.slice();
      var pSnap = Object.assign({}, state.project);
      var touched = inUse.length > 0;
      state.budgets = state.budgets.filter(function (x) { return x.id !== b.id; });
      state.expenses = state.expenses.map(function (x) {
        return x.budgetId === b.id ? normalizeExpense(Object.assign({}, x, { budgetId: "", updatedAt: new Date().toISOString() })) : x;
      });
      renderAll();
      withSaving($("confirm-yes"), "Deleting…", function () {
        return dataClient.write("budgets", budgetsPayload(), "Delete budget: " + b.name)
          .then(function () { return dataClient.write("project", projectPayload(), "Sync total budget"); })
          .then(function () { return touched ? dataClient.write("expenses", expensesPayload(), "Unassign expenses from deleted budget: " + b.name) : null; });
      }).then(function () {
        toast("Budget deleted", "ok"); closeConfirm(); renderAll();
      }).catch(function () {
        state.budgets = bSnap; state.expenses = eSnap; state.project = pSnap;
        closeConfirm(); renderAll();
      });
    });
  }

  // ---------------------------------------------------------------------
  // Import / export / demo
  // ---------------------------------------------------------------------
  function exportBackup() {
    var payload = {
      _type: "home-construction-tracker-backup",
      _version: 3,
      exportedAt: new Date().toISOString(),
      project: state.project,
      budgets: state.budgets,
      expenses: state.expenses,
      categories: state.categories,
      funds: state.funds
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: "home-construction-backup-" + todayISO() + ".json" });
    document.body.appendChild(a); a.click(); a.remove();
    toast("Backup downloaded", "ok");
  }

  function importBackup(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var parsed;
      try { parsed = JSON.parse(reader.result); }
      catch (e) { toast("Import failed: file is not valid JSON.", "err", 4000); return; }
      var project, expenses, categories, funds, budgets;
      try {
        project = normalizeProject(parsed.project || {});
        expenses = (Array.isArray(parsed.expenses) ? parsed.expenses : []).filter(isValidExpenseShape).map(normalizeExpense);
        categories = dedupeStrings(Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_CATEGORIES.slice());
        funds = (Array.isArray(parsed.funds) ? parsed.funds : [])
          .filter(function (f) { return f && typeof f === "object" && typeof f.id === "string"; })
          .map(normalizeFund);
        budgets = (Array.isArray(parsed.budgets) ? parsed.budgets : [])
          .filter(function (b) { return b && typeof b === "object" && typeof b.id === "string"; })
          .map(normalizeBudget);
        if (!budgets.length && project.initialBudget > 0) {
          budgets = [normalizeBudget({ id: PRIMARY_BUDGET_ID, name: "Main Budget", amount: project.initialBudget })];
        }
        if (!budgets.length) throw new Error("no budgets in backup");
        if (!categories.length) categories = DEFAULT_CATEGORIES.slice();
      } catch (e) { toast("Import failed: " + e.message, "err", 4000); return; }

      openConfirm("Import will REPLACE the current project, budgets (" + budgets.length + "), expenses (" + expenses.length + "), categories and funding sources (" + funds.length + "), then sync to GitHub. Continue?", function () {
        closeConfirm();
        replaceAllData(project, expenses, categories, funds, budgets, "Import backup data");
      }, "Import");
    };
    reader.readAsText(file);
  }

  function loadDemoData() {
    openConfirm("Load demo data? This REPLACES the current project, budgets, expenses, categories and funding sources, then syncs to GitHub.", function () {
      closeConfirm();
      var base = todayISO().slice(0, 7);
      var demoProject = normalizeProject({ projectName: "Demo Home Build", initialBudget: 5700000, currency: "INR", startDate: todayISO() });
      var now = new Date().toISOString();
      var demoBudgets = [
        normalizeBudget({ id: "budget-demo-construction", name: "Construction", amount: 4500000, createdAt: now, updatedAt: now }),
        normalizeBudget({ id: "budget-demo-interiors", name: "Interiors", amount: 800000, createdAt: now, updatedAt: now }),
        normalizeBudget({ id: "budget-demo-appliances", name: "Appliances", amount: 400000, createdAt: now, updatedAt: now })
      ];
      var demoFunds = [
        normalizeFund({ id: "fund-demo-pf", name: "PF Withdrawal", amount: 400000, purpose: "New home appliances: TV, Fridge, AC, Washing Machine", createdAt: now, updatedAt: now }),
        normalizeFund({ id: "fund-demo-loan", name: "Home Loan", amount: 3500000, purpose: "Construction — structure, materials, labour", createdAt: now, updatedAt: now }),
        normalizeFund({ id: "fund-demo-savings", name: "Savings", amount: 1100000, purpose: "Land, approvals, interiors, contingency", createdAt: now, updatedAt: now })
      ];
      var rows = [
        ["Cement - 60 bags", "Cement", 45000, "Bank Transfer", "ABC Traders", "Foundation", "fund-demo-loan", "budget-demo-construction"],
        ["TMT steel bars", "Steel", 120000, "Bank Transfer", "SteelMart", "Structure", "fund-demo-loan", "budget-demo-construction"],
        ["River sand - 2 loads", "Sand", 35000, "Cash", "Local Supplier", "Foundation", "fund-demo-loan", "budget-demo-construction"],
        ["Masonry labour - week 1", "Labour", 80000, "UPI", "Ramesh Crew", "Structure", "fund-demo-loan", "budget-demo-construction"],
        ["Red bricks - 5000", "Bricks", 40000, "Cash", "Brick Yard", "Walls", "fund-demo-loan", "budget-demo-construction"],
        ["Modular kitchen cabinets", "Kitchen", 185000, "Bank Transfer", "KitchenCo", "Kitchen", "fund-demo-savings", "budget-demo-interiors"],
        ["Split AC 1.5 ton", "Appliances", 42000, "Credit Card", "CoolWorld", "Interior", "fund-demo-pf", "budget-demo-appliances"],
        ["Double-door refrigerator", "Appliances", 48000, "Credit Card", "CoolWorld", "Interior", "fund-demo-pf", "budget-demo-appliances"],
        ["55\" LED TV", "Appliances", 55000, "UPI", "ElectroMart", "Interior", "fund-demo-pf", "budget-demo-appliances"],
        ["Plan approval fees", "Government Fees", 30000, "Bank Transfer", "Municipal Office", "Planning", "fund-demo-savings", "budget-demo-construction"]
      ];
      var demoExpenses = rows.map(function (r, i) {
        return normalizeExpense({
          id: uid(), date: base + "-" + pad2((i % 26) + 2), description: r[0], category: r[1],
          amount: r[2], paymentMethod: r[3], vendor: r[4], phase: r[5], fundId: r[6], budgetId: r[7],
          notes: "Demo entry", createdAt: now, updatedAt: now
        });
      });
      replaceAllData(demoProject, demoExpenses, DEFAULT_CATEGORIES.slice(), demoFunds, demoBudgets, "Load demo data");
    }, "Load Demo");
  }

  function replaceAllData(project, expenses, categories, funds, budgets, msg) {
    var snap = { p: state.project, e: state.expenses, c: state.categories, f: state.funds, b: state.budgets };
    state.project = project; state.expenses = expenses; state.categories = categories;
    state.funds = funds || []; state.budgets = budgets || [];
    ensurePrimaryBudget();
    renderAll();
    if (state.mode === "readonly" || (state.mode === "direct" && !state.canWrite)) {
      toast("Not connected: data replaced locally only, not saved to GitHub.", "err", 4000); return;
    }
    // sequential writes so each has a fresh sha
    dataClient.write("project", projectPayload(), msg + " (project)")
      .then(function () { return dataClient.write("budgets", budgetsPayload(), msg + " (budgets)"); })
      .then(function () { return dataClient.write("categories", categoriesPayload(), msg + " (categories)"); })
      .then(function () { return dataClient.write("funds", fundsPayload(), msg + " (funds)"); })
      .then(function () { return dataClient.write("expenses", expensesPayload(), msg + " (expenses)"); })
      .then(function () { toast("✓ Data imported and synced to GitHub", "ok"); renderAll(); })
      .catch(function (err) {
        state.project = snap.p; state.expenses = snap.e; state.categories = snap.c; state.funds = snap.f; state.budgets = snap.b;
        renderAll();
        handleWriteError(err);
        toast("Import aborted — some files may need a manual refresh.", "err", 5000);
      });
  }

  // ---------------------------------------------------------------------
  // Modals
  // ---------------------------------------------------------------------
  function openExpenseModal(expense) {
    fillSelect($("ex-category"), state.categories, false);
    var fundSel = $("ex-fund");
    fundSel.innerHTML = "";
    fundSel.appendChild(el("option", { value: "", text: "— none —" }));
    state.funds.forEach(function (f) {
      fundSel.appendChild(el("option", { value: f.id, text: f.name + " (" + formatCurrency(f.amount) + ")" }));
    });
    var budgetSel = $("ex-budget");
    budgetSel.innerHTML = "";
    if (!state.budgets.length) budgetSel.appendChild(el("option", { value: "", text: "— no budgets defined —" }));
    state.budgets.forEach(function (b) {
      var pb = perBudgetSummary().rows.filter(function (r) { return r.id === b.id; })[0];
      var left = pb ? pb.remaining : b.amount;
      budgetSel.appendChild(el("option", { value: b.id, text: b.name + " — " + formatCurrency(left) + " left" }));
    });
    $("expense-form-error").hidden = true;
    $("expense-modal-title").textContent = expense ? "Edit Expense" : "Add Expense";
    $("ex-id").value = expense ? expense.id : "";
    $("ex-date").value = expense ? expense.date : todayISO();
    $("ex-description").value = expense ? expense.description : "";
    $("ex-category").value = expense ? expense.category : (state.categories[0] || "");
    $("ex-amount").value = expense ? expense.amount : "";
    $("ex-payment").value = expense ? expense.paymentMethod : "";
    $("ex-vendor").value = expense ? expense.vendor : "";
    $("ex-phase").value = expense ? expense.phase : "";
    $("ex-fund").value = expense ? (expense.fundId || "") : "";
    $("ex-budget").value = expense ? (expense.budgetId || "") : (state.budgets[0] ? state.budgets[0].id : "");
    $("ex-notes").value = expense ? expense.notes : "";
    $("expense-modal").hidden = false;
    $("ex-description").focus();
  }
  function closeExpenseModal() { $("expense-modal").hidden = true; }

  var confirmCb = null;
  function openConfirm(message, cb, yesLabel) {
    $("confirm-message").textContent = message;
    $("confirm-yes").textContent = yesLabel || "Delete";
    $("confirm-yes").disabled = false;
    confirmCb = cb;
    $("confirm-modal").hidden = false;
  }
  function closeConfirm() { $("confirm-modal").hidden = true; confirmCb = null; }

  // ---------------------------------------------------------------------
  // Sync / refresh
  // ---------------------------------------------------------------------
  function refresh() {
    $("sync-indicator").className = "sync-dot syncing";
    $("sync-label").textContent = "Syncing…";
    return dataClient.readAll().then(function () {
      $("offline-banner").hidden = true;
      renderAll();
      toast("Data refreshed from " + (state.mode === "readonly" ? "bundled files" : "GitHub"), "ok");
    }).catch(function (err) {
      renderSyncStatus();
      $("offline-banner").hidden = false;
      $("offline-banner").textContent = "Unable to connect to the data service. Your latest data could not be synchronized. Please check your internet connection and try again.";
      toast("Refresh failed: " + err.message, "err", 4000);
    });
  }

  // ---------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------
  function switchView(name) {
    state.view = name;
    qsa(".tab").forEach(function (t) { t.classList.toggle("active", t.dataset.view === name); });
    ["dashboard", "expenses", "reports", "settings"].forEach(function (v) {
      $("view-" + v).hidden = v !== name;
    });
    try { window.scrollTo(0, 0); } catch (e) { /* non-browser env */ }
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------
  function wireEvents() {
    qsa(".tab").forEach(function (t) { t.addEventListener("click", function () { switchView(t.dataset.view); }); });
    qsa("[data-goto]").forEach(function (b) { b.addEventListener("click", function () { switchView(b.dataset.goto); }); });

    $("btn-refresh").addEventListener("click", refresh);
    $("btn-refresh-2").addEventListener("click", refresh);

    $("btn-add-expense").addEventListener("click", function () { openExpenseModal(null); });
    $("expense-modal-close").addEventListener("click", closeExpenseModal);
    $("expense-cancel").addEventListener("click", closeExpenseModal);
    $("expense-form").addEventListener("submit", function (e) { e.preventDefault(); saveExpenseFromForm(); });

    $("confirm-no").addEventListener("click", closeConfirm);
    $("confirm-yes").addEventListener("click", function () { if (confirmCb) confirmCb(); });

    var stickyModals = { "pass-modal": 1, "token-modal": 1 };
    qsa(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov && !stickyModals[ov.id]) ov.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") qsa(".modal-overlay").forEach(function (ov) { if (!stickyModals[ov.id]) ov.hidden = true; });
    });

    // filters
    var fmap = { "filter-search": "search", "filter-category": "category", "filter-phase": "phase",
      "filter-payment": "payment", "filter-fund": "fund", "filter-budget": "budget", "filter-from": "from", "filter-to": "to", "filter-sort": "sort" };
    Object.keys(fmap).forEach(function (id) {
      $(id).addEventListener("input", function () { filters[fmap[id]] = $(id).value; renderExpenses(); });
    });
    $("btn-clear-filters").addEventListener("click", function () {
      filters = { search: "", category: "", phase: "", payment: "", fund: "", budget: "", from: "", to: "", sort: "newest" };
      Object.keys(fmap).forEach(function (id) { $(id).value = id === "filter-sort" ? "newest" : ""; });
      renderExpenses();
    });

    // settings
    $("settings-form").addEventListener("submit", saveProjectFromForm);
    $("btn-add-category").addEventListener("click", addCategory);
    $("new-category").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });
    $("btn-add-fund").addEventListener("click", function () { openFundModal(null); });
    $("fund-modal-close").addEventListener("click", closeFundModal);
    $("fund-cancel").addEventListener("click", closeFundModal);
    $("fund-form").addEventListener("submit", function (e) { e.preventDefault(); saveFundFromForm(); });
    $("btn-add-budget").addEventListener("click", function () { openBudgetModal(null); });
    $("budget-modal-close").addEventListener("click", closeBudgetModal);
    $("budget-cancel").addEventListener("click", closeBudgetModal);
    $("budget-form").addEventListener("submit", function (e) { e.preventDefault(); saveBudgetFromForm(); });
    $("btn-export").addEventListener("click", exportBackup);
    $("btn-import").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function () { if (this.files[0]) { importBackup(this.files[0]); this.value = ""; } });
    $("btn-demo").addEventListener("click", loadDemoData);

    var btnConnect = $("btn-connect");
    if (btnConnect) btnConnect.addEventListener("click", function () { askToken().then(function (t) { if (t) refresh(); else renderAll(); }); });
    var btnForget = $("btn-forget-token");
    if (btnForget) btnForget.addEventListener("click", function () {
      clearToken();
      toast("GitHub token removed from this browser.", "ok");
      renderAll();
    });
    var tokenHelp = $("token-help-link");
    if (tokenHelp) tokenHelp.href = TOKEN_HELP_URL;

    window.addEventListener("online", function () { $("offline-banner").hidden = true; });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    wireEvents();

    if (state.mode !== "readonly" && (!GH_OWNER || !DATA_REPO)) {
      return bootError(new Error("config.js is missing GITHUB_OWNER / repository. Edit config.js and reload."));
    }

    dataClient.readAll().then(function () {
      finishBoot();
      if (state.mode === "direct" && !state.canWrite) {
        toast("Connected in view-only mode. Use “Connect to GitHub” to save changes.", "info", 5000);
      }
    }).catch(function (err) {
      if (state.mode === "api") {
        console.warn("API unavailable, falling back to read-only:", err);
        state.mode = "readonly";
        dataClient.readAll().then(function () {
          finishBoot();
          toast("API unreachable — loaded bundled data in read-only mode.", "err", 5000);
        }).catch(bootError);
        return;
      }
      if (state.mode === "direct") {
        // Data repo needs a token (private) or GitHub is unreachable.
        // Try the bundled static files so the app still opens.
        var wasAuth = err.code === "auth" || err.code === "offline";
        var prevMode = state.mode;
        state.mode = "readonly";
        dataClient.readAll().then(function () {
          state.mode = prevMode;   // stay in direct mode; just not connected yet
          state.canWrite = false;
          finishBoot();
          askToken().then(function (t) { if (t) refresh(); });
        }).catch(function () {
          state.mode = prevMode;
          finishBoot();
          toast(wasAuth ? "Connect your GitHub token to load private data." : ("Could not load data: " + err.message), "err", 6000);
          askToken().then(function (t) { if (t) refresh(); });
        });
        return;
      }
      bootError(err);
    });
  }

  function finishBoot() {
    if (!state.project) state.project = normalizeProject({});
    $("app-loading").hidden = true;
    $("main").hidden = false;
    qsa(".topbar, .tabbar").forEach(function (n) { n.hidden = false; });
    switchView("dashboard");
    renderAll();
  }

  function bootError(err) {
    $("app-loading").innerHTML = "";
    $("app-loading").appendChild(el("div", {}, [
      el("p", { text: "Unable to load construction data." }),
      el("p", { class: "small", text: String(err && err.message || err) }),
      el("button", { class: "btn btn-primary", type: "button", onclick: function () { location.reload(); } }, ["Retry"])
    ]));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
