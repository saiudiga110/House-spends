/* =====================================================================
 * Home Construction Expense Tracker — front-end application
 * Vanilla JS. No build step. Safe for GitHub Pages.
 *
 * SECURITY: This file is public. It contains NO secrets. All writes go
 * through the serverless API (config.API_BASE_URL) which holds the only
 * GitHub token as a server-side secret.
 * ===================================================================== */
(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------
  var CFG = window.APP_CONFIG || {};
  var API_BASE = (CFG.API_BASE_URL || "").replace(/\/+$/, "");
  var DATA_PATH = (CFG.DATA_PATH || "data").replace(/^\/+|\/+$/g, "");
  var FILES = ["project", "expenses", "categories"];

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
    mode: API_BASE ? "api" : "readonly",
    project: null,
    expenses: [],
    categories: DEFAULT_CATEGORIES.slice(),
    sha: { project: null, expenses: null, categories: null },
    lastSync: null,
    view: "dashboard"
  };

  var filters = { search: "", category: "", phase: "", payment: "", from: "", to: "", sort: "newest" };

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
  // Passphrase handling (kept only in sessionStorage)
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

  // ---------------------------------------------------------------------
  // Data client
  // ---------------------------------------------------------------------
  var dataClient = {
    readAll: function () {
      if (state.mode === "api") return this._readAllApi();
      return this._readAllStatic();
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
    }
  };

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
    }
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
      createdAt: x.createdAt || now,
      updatedAt: x.updatedAt || now
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
  function budgetSummary() {
    var budget = Number(state.project ? state.project.initialBudget : 0) || 0;
    var spent = totalSpent();
    var remaining = budget - spent;
    var pct = budget > 0 ? (spent / budget) * 100 : 0;
    return { budget: budget, spent: spent, remaining: remaining, pct: pct, over: spent > budget };
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
    $("readonly-banner").hidden = state.mode !== "readonly";
    renderDashboard();
    renderExpenses();
    renderReports();
    renderSettings();
  }

  function renderSyncStatus() {
    var dot = $("sync-indicator"), label = $("sync-label"), time = $("sync-time");
    dot.className = "sync-dot";
    if (state.mode === "readonly") { dot.classList.add("warn"); label.textContent = "Read-only"; }
    else if (state.lastSync) { dot.classList.add("ok"); label.textContent = "Synced"; }
    else { dot.classList.add("err"); label.textContent = "Not synced"; }
    time.textContent = state.lastSync ? formatDateTime(state.lastSync) : "";

    var detail = $("sync-detail");
    if (detail) {
      detail.innerHTML = "";
      kv(detail, "Mode", state.mode === "api" ? "Secure API (" + API_BASE + ")" : "Read-only (bundled JSON)");
      kv(detail, "Repository", (CFG.GITHUB_OWNER || "?") + "/" + (CFG.GITHUB_REPOSITORY || "?"));
      kv(detail, "Branch", CFG.GITHUB_BRANCH || "main");
      kv(detail, "Data path", DATA_PATH + "/");
      kv(detail, "Last synchronized", state.lastSync ? formatDateTime(state.lastSync) : "never");
    }
  }
  function kv(host, k, v) {
    host.appendChild(el("div", { class: "kv-row" }, [el("span", { class: "k", text: k }), el("span", { class: "v", text: v })]));
  }

  function renderDashboard() {
    var s = budgetSummary();
    $("stat-budget").textContent = formatCurrency(s.budget);
    $("stat-spent").textContent = formatCurrency(s.spent);
    $("stat-remaining").textContent = formatCurrency(s.remaining);
    $("stat-percent").textContent = (Math.round(s.pct * 10) / 10) + "%";
    $("stat-remaining").parentElement.classList.toggle("over", s.remaining < 0);

    var fill = $("progress-fill");
    fill.style.width = Math.min(100, Math.max(0, s.pct)) + "%";
    fill.className = "progress-fill" + (s.over ? " over" : s.pct >= 80 ? " warn" : "");
    $("progress-caption").textContent = formatCurrency(s.spent) + " of " + formatCurrency(s.budget)
      + " · " + (Math.round(s.pct * 10) / 10) + "% used";

    var warn = $("budget-warning");
    if (s.over) {
      warn.hidden = false;
      var lines = $("budget-warning-lines");
      lines.innerHTML = "";
      lines.appendChild(el("div", { text: "Budget: " + formatCurrency(s.budget) }));
      lines.appendChild(el("div", { text: "Spent: " + formatCurrency(s.spent) }));
      lines.appendChild(el("div", { text: "Exceeded by: " + formatCurrency(Math.abs(s.remaining)) }));
    } else {
      warn.hidden = true;
    }

    renderBarChart($("dash-category-chart"), groupSum(function (x) { return x.category; }).slice(0, 8), { empty: "Add an expense to see the breakdown." });

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
        el("td", { text: x.phase || "—" }),
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
    kv(ba, "Initial Budget", formatCurrency(s.budget));
    kv(ba, "Total Spent", formatCurrency(s.spent));
    kv(ba, "Remaining", formatCurrency(s.remaining));
    kv(ba, "Budget Used", (Math.round(s.pct * 10) / 10) + "%");
    kv(ba, "Budget Remaining", (Math.round((100 - s.pct) * 10) / 10) + "%");

    renderBarChart($("report-category-chart"), groupSum(function (x) { return x.category; }), { empty: "No expenses yet." });
    renderBarChart($("report-phase-chart"), groupSum(function (x) { return x.phase || "Unassigned"; }), { empty: "No expenses yet." });
    renderBarChart($("report-monthly-chart"), monthlySeries(), { empty: "No expenses yet." });
    renderBarChart($("report-payment-chart"), groupSum(function (x) { return x.paymentMethod || "Unspecified"; }), { empty: "No expenses yet." });
  }

  function renderSettings() {
    if (!state.project) return;
    $("set-name").value = state.project.projectName;
    $("set-budget").value = state.project.initialBudget;
    $("set-start").value = state.project.startDate;
    $("set-currency").value = state.project.currency;

    var list = $("category-list");
    list.innerHTML = "";
    state.categories.forEach(function (c) {
      list.appendChild(el("li", { class: "chip" }, [
        el("span", { text: c }),
        el("button", { type: "button", title: "Remove", "aria-label": "Remove " + c, onclick: function () { removeCategory(c); } }, ["✕"])
      ]));
    });

    var forms = qsa("#view-settings button, #view-settings input, #view-settings select");
    if (state.mode === "readonly") {
      forms.forEach(function (n) { if (n.id !== "btn-export") n.disabled = true; });
    }
  }

  // ---------------------------------------------------------------------
  // Mutations (all go through the API, then re-render)
  // ---------------------------------------------------------------------
  function expensesPayload() { return { expenses: state.expenses.map(normalizeExpense) }; }
  function categoriesPayload() { return { categories: state.categories }; }
  function projectPayload() {
    var p = state.project;
    p.updatedAt = new Date().toISOString();
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
      toast("Unable to connect to the data service. Your change was not saved. Check your connection and try again.", "err", 5000);
      $("offline-banner").hidden = false;
      $("offline-banner").textContent = "Unable to connect to the data service. Your latest data could not be synchronized.";
    } else if (err.code === "auth") {
      toast("API passphrase missing or rejected. Try the action again.", "err", 4000);
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
      notes: $("ex-notes").value.trim()
    };
    var errs = validateExpenseInput(input);
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
    var budget = Number($("set-budget").value);
    if (!isFinite(budget) || budget <= 0) { toast("Budget must be greater than 0.", "err"); return; }
    var name = $("set-name").value.trim();
    if (!name) { toast("Project name is required.", "err"); return; }
    var start = $("set-start").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) { toast("A valid start date is required.", "err"); return; }

    var snapshot = Object.assign({}, state.project);
    state.project.projectName = name;
    state.project.initialBudget = budget;
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
  // Import / export / demo
  // ---------------------------------------------------------------------
  function exportBackup() {
    var payload = {
      _type: "home-construction-tracker-backup",
      _version: 1,
      exportedAt: new Date().toISOString(),
      project: state.project,
      expenses: state.expenses,
      categories: state.categories
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
      var project, expenses, categories;
      try {
        project = normalizeProject(parsed.project || {});
        expenses = (Array.isArray(parsed.expenses) ? parsed.expenses : []).filter(isValidExpenseShape).map(normalizeExpense);
        categories = dedupeStrings(Array.isArray(parsed.categories) ? parsed.categories : DEFAULT_CATEGORIES.slice());
        if (project.initialBudget <= 0) throw new Error("budget must be > 0");
        if (!categories.length) categories = DEFAULT_CATEGORIES.slice();
      } catch (e) { toast("Import failed: " + e.message, "err", 4000); return; }

      openConfirm("Import will REPLACE the current project, budget, expenses (" + expenses.length + ") and categories, then sync to GitHub. Continue?", function () {
        closeConfirm();
        replaceAllData(project, expenses, categories, "Import backup data");
      }, "Import");
    };
    reader.readAsText(file);
  }

  function loadDemoData() {
    openConfirm("Load demo data? This REPLACES current project, expenses and categories, then syncs to GitHub.", function () {
      closeConfirm();
      var base = todayISO().slice(0, 7);
      var demoProject = normalizeProject({ projectName: "Demo Home Build", initialBudget: 5000000, currency: "INR", startDate: todayISO() });
      var rows = [
        ["Cement - 60 bags", "Cement", 45000, "Bank Transfer", "ABC Traders", "Foundation"],
        ["TMT steel bars", "Steel", 120000, "Bank Transfer", "SteelMart", "Structure"],
        ["River sand - 2 loads", "Sand", 35000, "Cash", "Local Supplier", "Foundation"],
        ["Masonry labour - week 1", "Labour", 80000, "UPI", "Ramesh Crew", "Structure"],
        ["Red bricks - 5000", "Bricks", 40000, "Cash", "Brick Yard", "Walls"],
        ["Plumbing rough-in", "Plumbing", 25000, "UPI", "CityPlumb", "Plumbing"],
        ["Electrical conduits & wiring", "Electrical", 30000, "Credit Card", "Volt Electricals", "Electrical"]
      ];
      var now = new Date().toISOString();
      var demoExpenses = rows.map(function (r, i) {
        return normalizeExpense({
          id: uid(), date: base + "-" + pad2((i % 26) + 2), description: r[0], category: r[1],
          amount: r[2], paymentMethod: r[3], vendor: r[4], phase: r[5],
          notes: "Demo entry", createdAt: now, updatedAt: now
        });
      });
      replaceAllData(demoProject, demoExpenses, DEFAULT_CATEGORIES.slice(), "Load demo data");
    }, "Load Demo");
  }

  function replaceAllData(project, expenses, categories, msg) {
    var snap = { p: state.project, e: state.expenses, c: state.categories };
    state.project = project; state.expenses = expenses; state.categories = categories;
    renderAll();
    if (state.mode !== "api") { toast("Read-only mode: data replaced locally only, not saved.", "err", 4000); return; }
    // sequential writes so each has a fresh sha
    dataClient.write("project", projectPayload(), msg + " (project)")
      .then(function () { return dataClient.write("categories", categoriesPayload(), msg + " (categories)"); })
      .then(function () { return dataClient.write("expenses", expensesPayload(), msg + " (expenses)"); })
      .then(function () { toast("✓ Data imported and synced to GitHub", "ok"); renderAll(); })
      .catch(function (err) {
        state.project = snap.p; state.expenses = snap.e; state.categories = snap.c;
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
      toast("Data refreshed from " + (state.mode === "api" ? "GitHub" : "bundled files"), "ok");
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

    qsa(".modal-overlay").forEach(function (ov) {
      ov.addEventListener("click", function (e) { if (e.target === ov && ov.id !== "pass-modal") ov.hidden = true; });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") qsa(".modal-overlay").forEach(function (ov) { if (ov.id !== "pass-modal") ov.hidden = true; });
    });

    // filters
    var fmap = { "filter-search": "search", "filter-category": "category", "filter-phase": "phase",
      "filter-payment": "payment", "filter-from": "from", "filter-to": "to", "filter-sort": "sort" };
    Object.keys(fmap).forEach(function (id) {
      $(id).addEventListener("input", function () { filters[fmap[id]] = $(id).value; renderExpenses(); });
    });
    $("btn-clear-filters").addEventListener("click", function () {
      filters = { search: "", category: "", phase: "", payment: "", from: "", to: "", sort: "newest" };
      Object.keys(fmap).forEach(function (id) { $(id).value = id === "filter-sort" ? "newest" : ""; });
      renderExpenses();
    });

    // settings
    $("settings-form").addEventListener("submit", saveProjectFromForm);
    $("btn-add-category").addEventListener("click", addCategory);
    $("new-category").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addCategory(); } });
    $("btn-export").addEventListener("click", exportBackup);
    $("btn-import").addEventListener("click", function () { $("import-file").click(); });
    $("import-file").addEventListener("change", function () { if (this.files[0]) { importBackup(this.files[0]); this.value = ""; } });
    $("btn-demo").addEventListener("click", loadDemoData);

    window.addEventListener("online", function () { $("offline-banner").hidden = true; });
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function boot() {
    wireEvents();
    dataClient.readAll().then(function () {
      finishBoot();
    }).catch(function (apiErr) {
      if (state.mode === "api") {
        // fall back to bundled static files, read-only
        console.warn("API unavailable, falling back to read-only:", apiErr);
        state.mode = "readonly";
        dataClient.readAll().then(function () {
          finishBoot();
          toast("API unreachable — loaded bundled data in read-only mode.", "err", 5000);
        }).catch(function (staticErr) {
          bootError(staticErr);
        });
      } else {
        bootError(apiErr);
      }
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
