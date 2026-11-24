/* WebAgent dashboard. All DOM is built with textContent (never innerHTML) because much of the
   displayed data originates from untrusted target applications. */
"use strict";

const S = { me: null, csrf: null, assessments: [], aid: null, view: "overview", sub: null, ws: null,
            pending: 0, timers: [] };

// ------------------------------------------------------------------ helpers
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked") el.checked = !!v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const $ = (id) => document.getElementById(id);
function add(parent, ...kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    parent.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return parent;
}
const fmt = (v) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v, null, 2) : String(v));
const ts = (v) => (v ? new Date(v.endsWith && !v.endsWith("Z") && !v.includes("+") ? v + "Z" : v).toLocaleString() : "");
const sev = (s) => h("span", { class: `badge sev-${s}` }, s);
const stat = (s) => h("span", { class: `badge st-${s}` }, (s || "").replace("_", " "));
const cls = (c) => h("span", { class: `badge cls-${c}` }, (c || "").replace("_", " "));
const pre = (v) => h("pre", {}, fmt(v));

function toast(msg, error) {
  const t = h("div", { class: "toast" + (error ? " error" : "") }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), error ? 7000 : 3500);
}

async function api(method, path, body, isForm) {
  const opts = { method, credentials: "same-origin", headers: {} };
  if (method !== "GET" && S.csrf) opts.headers["X-CSRF-Token"] = S.csrf;
  if (body !== undefined) {
    if (isForm) opts.body = body;
    else { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  }
  const r = await fetch(path, opts);
  if (r.status === 401 && !path.startsWith("/api/auth")) { S.me = null; render(); throw new Error("login required"); }
  const ct = r.headers.get("content-type") || "";
  const data = ct.includes("json") ? await r.json() : await r.text();
  if (!r.ok) throw new Error(typeof data === "object" ? (data.detail ? fmt(data.detail) : fmt(data)) : data);
  return data;
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; } catch (e) { toast(e.message, true); e.shown = true; throw e; }
}
function field(label, input) { return h("div", {}, h("label", {}, label), input); }
function clearTimers() { S.timers.forEach(clearInterval); S.timers = []; }
function asmt() { return S.assessments.find((a) => a.id === S.aid); }

// ---------------------------------------------------------------- auth view
async function boot() {
  const me = await api("GET", "/api/auth/me");
  S.me = me.authenticated ? me.username : null;
  S.csrf = me.csrf;
  if (!S.me) return renderLogin(me.setup_required);
  await loadAssessments();
  const hash = location.hash.slice(1).split("/");
  if (hash[0]) { S.view = hash[0]; S.sub = hash[1] || null; }
  connectWs();
  render();
}

function renderLogin(setup) {
  const u = h("input", { autocomplete: "username" });
  const p = h("input", { type: "password", autocomplete: setup ? "new-password" : "current-password" });
  const submit = async (e) => {
    e.preventDefault();
    await act(async () => {
      if (setup) await api("POST", "/api/auth/setup", { username: u.value, password: p.value });
      const r = await api("POST", "/api/auth/login", { username: u.value, password: p.value });
      S.csrf = r.csrf;
      await boot();
    });
  };
  $("app").replaceChildren(h("div", { class: "center panel" },
    h("h1", {}, setup ? "Create the operator account" : "Sign in"),
    setup ? h("p", { class: "muted small" }, "First run: create the dashboard operator (password: 12+ characters).") : null,
    h("form", { onsubmit: submit, class: "col" }, field("Username", u), field("Password", p),
      h("button", { class: "primary", type: "submit" }, setup ? "Create and sign in" : "Sign in"))));
}

// ----------------------------------------------------------------- shell
const NAV = [
  ["overview", "Overview"], ["assessments", "Assessments"], ["scope", "Scope & accounts"],
  ["approvals", "Approvals"], ["coverage", "Test coverage"], ["agent", "Agent console"], ["findings", "Findings"], ["paths", "Attack paths"], ["positives", "Positive findings"], ["surface", "Attack surface"],
  ["tools", "Tools"], ["jobs", "Tool jobs"], ["evidence", "Evidence"], ["burp", "Burp Suite"], ["audit", "Audit log"],
  ["system", "System & models"],
];

async function loadAssessments() {
  S.assessments = await api("GET", "/api/assessments");
  if (!S.aid) { try { S.aid = Number(localStorage.getItem("aid")) || null; } catch (x) { S.aid = null; } }
  if (!S.aid || !asmt()) S.aid = S.assessments[0] ? S.assessments[0].id : null;
  try { S.pending = (await api("GET", "/api/approvals?status=pending")).length; } catch (e) { /* ignore */ }
}

function go(view, sub) { S.view = view; S.sub = sub || null; location.hash = view + (sub ? "/" + sub : ""); render(); }

function render() {
  if (!S.me) return boot();
  clearTimers();
  const sel = h("select", { onchange: (e) => { S.aid = Number(e.target.value); try { localStorage.setItem("aid", S.aid); } catch (x) { /* storage unavailable */ } render(); } },
    S.assessments.map((a) => h("option", { value: a.id, selected: a.id === S.aid }, `${a.name} (${a.status})`)));
  const a = asmt();
  const top = h("div", { class: "topbar" },
    h("span", { class: "brand" }, "WebAgent"),
    S.assessments.length ? sel : h("span", { class: "muted" }, "No assessments yet"),
    a ? h("span", { class: `badge ${a.status === "active" ? "ok" : "warnb"}` }, a.status) : null,
    h("span", { class: "spacer" }),
    h("a", { onclick: () => go("approvals") }, `Approvals: ${S.pending}`),
    h("button", { class: "estop", title: "Stop all agent runs and tool jobs, pause all assessments",
      onclick: emergencyStop }, "EMERGENCY STOP"),
    h("span", { class: "muted" }, S.me),
    h("button", { class: "small", onclick: async () => { await api("POST", "/api/auth/logout"); S.me = null; boot(); } },
      "Sign out"));
  const side = h("nav", { class: "sidebar" }, NAV.map(([k, label]) =>
    h("a", { class: S.view === k ? "active" : "", onclick: () => go(k) }, label,
      k === "approvals" && S.pending ? h("span", { class: "badge bad" }, S.pending) : null)));
  const main = h("main", { class: "main", id: "main" });
  $("app").replaceChildren(top, h("div", { id: "approval-banner" }), h("div", { class: "layout" }, side, main));
  updateApprovalBanner();
  const views = { overview, assessments, scope, approvals, coverage, agent, findings, paths, positives, surface, tools, jobs, evidence,
                  burp, audit, system };
  (views[S.view] || overview)(main).catch((e) => add(main, h("div", { class: "callout danger" }, e.message)));
}

function updateApprovalBanner() {
  document.title = (S.pending ? `(${S.pending}) ` : "") + "WebAgent Assessments";
  const link = document.querySelector(".topbar a");
  if (link) link.textContent = `Approvals: ${S.pending}`;
  const slot = $("approval-banner");
  if (!slot) return;
  if (!S.pending || S.view === "approvals") { slot.replaceChildren(); return; }
  const canNotify = "Notification" in window && Notification.permission === "default";
  slot.replaceChildren(h("div", { class: "banner" },
    h("b", {}, `${S.pending} approval${S.pending > 1 ? "s" : ""} waiting.`),
    " A login, tool run or request is paused until you answer.",
    h("button", { class: "small primary", onclick: () => go("approvals") }, "Review now"),
    canNotify ? h("button", { class: "small", onclick: () => Notification.requestPermission().then(updateApprovalBanner) }, "Enable desktop alerts") : null));
}
async function refreshPending(notifyText) {
  const before = S.pending;
  try { S.pending = (await api("GET", "/api/approvals?status=pending")).length; } catch (e) { return; }
  updateApprovalBanner();
  if (S.pending > before && notifyText) {
    toast("Approval needed: " + notifyText);
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification("WebAgent: approval needed", { body: notifyText }); } catch (e) { /* ignore */ }
    }
  }
  if (S.view === "approvals" && S.pending !== before) render();
}
setInterval(() => { if (S.me) refreshPending("a pending approval is waiting"); }, 10000);
// Reload automatically when the server was restarted with newer dashboard code (stale tabs keep old JS).
let BUILD = null;
async function checkBuild() {
  try {
    const r = await fetch("/api/build", { cache: "no-store" });
    if (!r.ok) return;
    const { build } = await r.json();
    if (BUILD && build !== BUILD) location.reload();
    BUILD = build;
  } catch (e) { /* server restarting */ }
}
checkBuild();
setInterval(checkBuild, 5000);

async function emergencyStop() {
  if (!confirm("EMERGENCY STOP: stop every agent run and tool job and pause all assessments?")) return;
  const r = await act(() => api("POST", "/api/emergency-stop", {}), "Emergency stop executed");
  await loadAssessments(); render();
  return r;
}

function connectWs() {
  if (S.ws) return;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  S.ws = ws;
  ws.onmessage = async (m) => {
    const ev = JSON.parse(m.data);
    if (ev.type === "approval_created") await refreshPending(ev.summary);
    else if (ev.type === "approval" || (ev.type === "agent_event" && ev.event === "tool_result")) await refreshPending();
    document.dispatchEvent(new CustomEvent("ws", { detail: ev }));
  };
  ws.onclose = () => { S.ws = null; setTimeout(() => S.me && connectWs(), 3000); };
}

function needAssessment(main) {
  if (S.aid) return false;
  add(main, h("div", { class: "panel" }, "Create an assessment first. ",
    h("a", { onclick: () => go("assessments") }, "Go to Assessments")));
  return true;
}

// -------------------------------------------------------------- overview
async function overview(main) {
  const st = await api("GET", "/api/status").catch(() => ({}));
  const all = S.assessments;
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  let awaiting = 0;
  all.forEach((a) => { Object.entries(a.finding_counts || {}).forEach(([k, v]) => counts[k] += v); awaiting += a.awaiting_validation || 0; });
  add(main, h("h1", {}, "Overview"),
    h("div", { class: "grid" },
      statBox(all.filter((a) => a.status === "active").length, "Active assessments"),
      statBox(all.filter((a) => a.status === "completed").length, "Completed assessments"),
      statBox(Object.values(counts).reduce((x, y) => x + y, 0), "Total findings"),
      statBox(awaiting, "Awaiting validation"),
      statBox(S.pending, "Pending approvals"),
      ...["critical", "high", "medium", "low"].map((s) => statBox(counts[s], s[0].toUpperCase() + s.slice(1)))),
    h("div", { class: "panel" }, h("h2", {}, "Components"), componentTable(st)));
  if (!S.aid) return;
  const [runs, jobsL, auth] = await Promise.all([
    api("GET", `/api/assessments/${S.aid}/agent/runs`), api("GET", `/api/assessments/${S.aid}/jobs`),
    api("GET", `/api/assessments/${S.aid}/auth-contexts`)]);
  add(main, h("div", { class: "two" },
    h("div", { class: "panel" }, h("h2", {}, "Recent agent activity"),
      runs.length ? h("table", {}, h("tr", {}, h("th", {}, "Run"), h("th", {}, "Objective"), h("th", {}, "Status")),
        runs.slice(0, 8).map((r) => h("tr", { class: "click", onclick: () => go("agent", r.id) },
          h("td", {}, "#" + r.id), h("td", {}, r.objective.slice(0, 90)), h("td", {}, stat(r.status)))))
        : h("p", { class: "muted" }, "No agent runs yet.")),
    h("div", { class: "panel" }, h("h2", {}, "Tool execution & authentication"),
      h("p", {}, `${jobsL.filter((j) => j.status === "running").length} running, `,
        `${jobsL.filter((j) => j.status === "awaiting_approval").length} awaiting approval, ${jobsL.length} total jobs.`),
      h("p", {}, "Authenticated roles: ", auth.contexts.length ? auth.contexts.map((c) => h("span", { class: "badge ok" }, c.role)) : h("span", { class: "muted" }, "none")),
      auth.logins_in_progress.map((l) => h("div", { class: "callout warn" }, `Login as ${l.role}: ${l.status}`)))));
}
function statBox(v, l) { return h("div", { class: "stat" }, h("div", { class: "v" }, v), h("div", { class: "l" }, l)); }
function componentTable(st) {
  const row = (name, s, extra) => h("tr", {}, h("td", {}, name),
    h("td", {}, s && (s.ok !== false) ? h("span", { class: "badge ok" }, "connected") : h("span", { class: "badge bad" }, "unavailable")),
    h("td", { class: "small muted" }, extra || (s && s.error) || ""));
  return h("table", {},
    row("Ollama", st.ollama, st.ollama && st.ollama.ok ? `v${st.ollama.version} · default model ${st.model}` : null),
    row("Kali gateway", st.kali, st.kali && st.kali.ok ? `${st.kali.hostname} · ${st.kali.os} · ${st.kali.running_jobs} running` : null),
    row("Burp REST API", st.burp, st.burp && st.burp.ok ? `${st.burp.issue_definitions} issue definitions` : null),
    h("tr", {}, h("td", {}, "Burp proxy"), h("td", {}, st.burp_proxy ? h("span", { class: "badge ok" }, "configured") : h("span", { class: "badge" }, "not set")), h("td", { class: "small muted" }, st.burp_proxy || "")));
}

// ----------------------------------------------------------- assessments
async function assessments(main) {
  await loadAssessments();
  const name = h("input"), desc = h("textarea"), hosts = h("textarea", { placeholder: "app.example.com\napi.example.com\n10.0.0.0/24" });
  const authBy = h("input"), ref = h("input");
  add(main, h("h1", {}, "Assessments"),
    h("div", { class: "panel" },
      h("table", {}, h("tr", {}, ["Name", "Status", "Findings", "Awaiting validation", "Created", ""].map((x) => h("th", {}, x))),
        S.assessments.map((a) => h("tr", {},
          h("td", {}, h("a", { onclick: () => { S.aid = a.id; go("scope"); } }, a.name)),
          h("td", {}, stat(a.status)),
          h("td", {}, Object.entries(a.finding_counts || {}).filter(([, v]) => v).map(([k, v]) => h("span", {}, sev(k), " ", v, " "))),
          h("td", {}, a.awaiting_validation), h("td", { class: "small" }, ts(a.created_at)),
          h("td", {}, statusButtons(a)))))),
    h("div", { class: "panel" }, h("h2", {}, "New assessment"),
      h("div", { class: "two" },
        h("div", { class: "col" }, field("Name", name), field("Description", desc),
          field("Authorized by (client contact)", authBy), field("Authorization reference (SOW / ticket)", ref)),
        h("div", { class: "col" }, field("Full-testing hosts / CIDRs (one per line). Others can be added later.", hosts),
          h("p", { class: "small muted" }, "Identity-provider and other domains are classified when first needed (Full / Lite / Login only)."))),
      h("button", { class: "primary", onclick: async () => {
        const rules = hosts.value.split(/\s+/).filter(Boolean).map((p) => ({ pattern: p, classification: "full" }));
        const r = await act(() => api("POST", "/api/assessments", { name: name.value, description: desc.value,
          scope: { rules }, authorization: { authorized_by: authBy.value, reference: ref.value } }), "Assessment created");
        S.aid = r.id; await loadAssessments(); go("scope");
      } }, "Create assessment")));
}
function statusButtons(a) {
  const set = (s) => async () => {
    await act(() => api("POST", `/api/assessments/${a.id}/status`, { status: s }), `Assessment ${s}`);
    await loadAssessments(); render();
  };
  return h("div", { class: "row" },
    a.status !== "active" ? h("button", { class: "small primary", onclick: set("active") }, a.status === "paused" ? "Resume" : "Start") : null,
    a.status === "active" ? h("button", { class: "small", onclick: set("paused") }, "Pause") : null,
    !["stopped", "completed"].includes(a.status) ? h("button", { class: "small", onclick: set("stopped") }, "Stop") : null,
    a.status !== "completed" ? h("button", { class: "small", onclick: set("completed") }, "Complete") : null);
}

// ------------------------------------------------------- scope & accounts
async function scope(main) {
  if (needAssessment(main)) return;
  const a = await api("GET", `/api/assessments/${S.aid}`);
  const sc = JSON.parse(JSON.stringify(a.scope));
  add(main, h("h1", {}, `Scope & accounts: ${a.name}`), h("div", { class: "row" }, statusButtons(a)));

  // Scope rules editor
  const tbody = h("tbody");
  const drawRules = () => tbody.replaceChildren(...sc.rules.map((r, i) => h("tr", {},
    h("td", {}, h("input", { value: r.pattern, oninput: (e) => (r.pattern = e.target.value) })),
    h("td", {}, h("select", { onchange: (e) => (r.classification = e.target.value) },
      ["full", "lite", "login_only", "excluded"].map((c) => h("option", { value: c, selected: r.classification === c }, c)))),
    h("td", { class: "small muted" }, r.approved_by ? `${r.approved_by} · ${ts(r.approved_at)}` : "new"),
    h("td", { class: "small muted" }, r.note || ""),
    h("td", {}, h("button", { class: "small", onclick: () => { sc.rules.splice(i, 1); drawRules(); } }, "Remove")))));
  drawRules();
  const exPaths = h("textarea", { value: (sc.excluded_paths || []).join("\n") });
  const inPaths = h("textarea", { value: (sc.included_paths || []).join("\n") });
  const prohibited = h("input", { value: (sc.prohibited_techniques || []).join(", ") });
  const windows = h("textarea", { placeholder: "2026-11-20T09:00:00-05:00 2026-11-20T17:00:00-05:00",
    value: (sc.test_windows || []).map((w) => `${w.start} ${w.end}`).join("\n") });
  add(main, h("div", { class: "panel" }, h("h2", {}, "Authorized scope"),
    h("p", { class: "small muted" }, "Enter host names (app.example.com), IPs or CIDRs; a pasted URL is reduced to its host. full = all permitted testing · lite = passive analysis of login traffic only · login_only = authentication only, no testing · excluded = never contacted. Wildcards must be explicit (*.example.com)."),
    h("table", {}, h("thead", {}, h("tr", {}, ["Domain / IP / CIDR", "Classification", "Approved", "Note", ""].map((x) => h("th", {}, x)))), tbody),
    h("button", { class: "small", onclick: () => { sc.rules.push({ pattern: "", classification: "full" }); drawRules(); } }, "Add rule"),
    h("div", { class: "two" },
      field("Excluded paths (glob, one per line, e.g. /logout*)", exPaths),
      field("Permitted paths (optional; if set, active testing is limited to these)", inPaths)),
    h("div", { class: "two" },
      field("Prohibited techniques (comma separated, e.g. brute_force, fuzzing, sql_injection)", prohibited),
      field("Test windows (start end, ISO 8601 with timezone, one per line; empty = any time)", windows)),
    h("button", { class: "primary", onclick: async () => {
      const next = { rules: sc.rules.filter((r) => r.pattern.trim()), excluded_paths: lines(exPaths.value),
        included_paths: lines(inPaths.value),
        prohibited_techniques: prohibited.value.split(",").map((x) => x.trim()).filter(Boolean),
        test_windows: lines(windows.value).map((l) => { const [start, end] = l.split(/\s+/); return { start, end }; }) };
      const summary = next.rules.map((r) => `${r.pattern} -> ${r.classification}`).join("\n");
      if (!confirm(`Confirm scope change for "${a.name}":\n\n${summary}\n\nThis is recorded in the audit log.`)) return;
      const saved = await act(() => api("PUT", `/api/assessments/${S.aid}/scope`, { scope: next, confirmed: true }));
      toast("Scope saved: " + (saved.rules.map((r) => `${r.pattern} (${r.classification})`).join(", ") || "no domains"));
      render();
    } }, "Save scope…")));

  // Profile + authorization
  const prof = a.profile;
  const pf = {};
  const profRows = Object.entries(prof).map(([k, v]) => {
    let inp;
    if (typeof v === "boolean") inp = h("input", { type: "checkbox", checked: v });
    else if (k === "intensity") inp = h("select", {}, ["low", "medium", "high"].map((x) => h("option", { selected: v === x }, x)));
    else inp = h("input", { value: Array.isArray(v) ? v.join(", ") : v });
    pf[k] = [inp, v];
    return field(k.replaceAll("_", " "), inp);
  });
  const auth = a.authorization || {};
  const authFields = ["authorized_by", "reference", "client_contact", "notes"].map((k) => [k, h("input", { value: auth[k] || "" })]);
  add(main, h("div", { class: "two" },
    h("div", { class: "panel" }, h("h2", {}, "Testing profile"), h("div", { class: "col" }, profRows),
      h("button", { class: "primary", onclick: async () => {
        const out = {};
        for (const [k, [inp, orig]] of Object.entries(pf)) {
          if (typeof orig === "boolean") out[k] = inp.checked;
          else if (typeof orig === "number") out[k] = Number(inp.value);
          else if (Array.isArray(orig)) out[k] = inp.value.split(",").map((x) => x.trim()).filter(Boolean);
          else out[k] = inp.value;
        }
        await act(() => api("PUT", `/api/assessments/${S.aid}/profile`, out), "Profile saved");
      } }, "Save profile")),
    h("div", { class: "panel" }, h("h2", {}, "Authorization record"),
      h("div", { class: "col" }, authFields.map(([k, inp]) => field(k.replaceAll("_", " "), inp))),
      h("button", { class: "primary", onclick: async () => {
        await act(() => api("PUT", `/api/assessments/${S.aid}/authorization`, Object.fromEntries(authFields.map(([k, i]) => [k, i.value]))), "Saved");
      } }, "Save authorization"))));

  // Accounts and authentication
  const accts = await api("GET", `/api/assessments/${S.aid}/accounts`);
  const authc = await api("GET", `/api/assessments/${S.aid}/auth-contexts`);
  const f = { role: h("input", { placeholder: "standard_user" }), username: h("input"), password: h("input", { type: "password", autocomplete: "new-password" }),
    login_url: h("input", { placeholder: "https://app.example.com/login" }), success_url_pattern: h("input", { placeholder: "regex, e.g. /dashboard" }),
    privilege_level: h("input", { value: 1 }) };
  add(main, h("div", { class: "panel" }, h("h2", {}, "Test accounts and authentication"),
    h("p", { class: "small muted" }, "If a login sends credentials to a domain you have not classified, the login pauses and asks you under Approvals."),
    h("table", {}, h("tr", {}, ["Role", "Username", "Privilege", "Login URL", ""].map((x) => h("th", {}, x))),
      accts.map((x) => h("tr", {}, h("td", {}, x.role), h("td", {}, x.username), h("td", {}, x.privilege_level),
        h("td", { class: "small mono" }, x.login_url),
        h("td", {}, h("div", { class: "row" },
          h("button", { class: "small primary", onclick: () => startLogin(x.role, "automated"), title: "Rule-based, falls back to the AI driver" }, "Log in (automated)"),
          h("button", { class: "small", onclick: () => startLogin(x.role, "ai"), title: "The local model operates the browser" }, "Log in (AI)"),
          h("button", { class: "small", onclick: () => startLogin(x.role, "assisted") }, "Tester-assisted"),
          h("button", { class: "small", onclick: async () => { if (confirm("Delete account?")) { await act(() => api("DELETE", `/api/assessments/${S.aid}/accounts/${x.id}`)); render(); } } }, "Delete")))))),
    h("h3", {}, "Add account"),
    h("div", { class: "grid" }, Object.entries(f).map(([k, inp]) => field(k.replaceAll("_", " "), inp))),
    h("button", { onclick: async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value]));
      body.privilege_level = Number(body.privilege_level || 1);
      await act(() => api("POST", `/api/assessments/${S.aid}/accounts`, body), "Account added (password encrypted at rest)");
      render();
    } }, "Add account"),
    h("h3", {}, "Authentication contexts (tokens are kept in memory only)"),
    authc.logins_in_progress.map((l) => h("div", { class: "callout warn" }, `Login as ${l.role} (${l.mode}): ${l.status}`)),
    authc.contexts.length ? authc.contexts.map((c) => h("div", { class: "panel" },
      h("div", { class: "row" }, h("b", {}, c.role), h("span", { class: "badge" }, c.method),
        h("button", { class: "small", onclick: async () => { await act(() => api("DELETE", `/api/assessments/${S.aid}/auth-contexts/${encodeURIComponent(c.role)}`), "Session invalidated"); render(); } }, "Invalidate")),
      pre(c.hosts), c.storage_keys && Object.keys(c.storage_keys).length ? h("details", {}, h("summary", {}, "Browser storage keys"), pre(c.storage_keys)) : null))
      : h("p", { class: "muted" }, "No authenticated roles yet."),
    authc.recent_logins.length ? h("details", {}, h("summary", {}, "Recent login results"), pre(authc.recent_logins.slice().reverse())) : null,
    manualAuthForm()));
}
function lines(v) { return v.split("\n").map((x) => x.trim()).filter(Boolean); }
async function startLogin(role, mode) {
  await act(() => api("POST", `/api/assessments/${S.aid}/login`, { role, mode }),
    mode === "assisted" ? "A browser window will open; complete the login there." : "Login started");
  const handler = (e) => {
    if (e.detail.type === "login") { toast(`Login as ${e.detail.result.role}: ${e.detail.result.success ? "success" : e.detail.result.reason}`, !e.detail.result.success); document.removeEventListener("ws", handler); if (S.view === "scope") render(); }
    if (e.detail.type === "approval" || (e.detail.type === "agent_event")) return;
  };
  document.addEventListener("ws", handler);
  setTimeout(async () => { await loadAssessments(); if (S.pending) toast("Approval required: check Approvals"); render(); }, 2500);
}
function manualAuthForm() {
  const role = h("input"), host = h("input"), header = h("input", { placeholder: "Authorization: Bearer …" }), cookie = h("input", { placeholder: "name=value; other=value" });
  return h("details", {}, h("summary", {}, "Paste credentials from Burp or a browser (for SSO/MFA flows)"),
    h("div", { class: "grid" }, field("Role", role), field("Host (must be classified)", host), field("Header", header), field("Cookie", cookie)),
    h("button", { onclick: async () => {
      const headers = {};
      if (header.value.includes(":")) { const i = header.value.indexOf(":"); headers[header.value.slice(0, i).trim()] = header.value.slice(i + 1).trim(); }
      const cookies = {};
      cookie.value.split(";").map((x) => x.trim()).filter(Boolean).forEach((kv) => { const i = kv.indexOf("="); if (i > 0) cookies[kv.slice(0, i)] = kv.slice(i + 1); });
      await act(() => api("POST", `/api/assessments/${S.aid}/auth-contexts/manual`, { role: role.value, host: host.value, headers, cookies }), "Stored in memory");
      render();
    } }, "Store"));
}

// ------------------------------------------------------------- approvals
async function approvals(main) {
  const pending = await api("GET", "/api/approvals?status=pending");
  const recent = (await api("GET", "/api/approvals")).filter((a) => a.status !== "pending").slice(0, 40);
  S.pending = pending.length;
  add(main, h("h1", {}, "Approvals"),
    pending.length ? pending.map(approvalCard) : h("div", { class: "panel muted" }, "Nothing is waiting for approval."),
    h("h2", {}, "Recently resolved"),
    h("div", { class: "panel" }, h("table", {}, h("tr", {}, ["#", "Kind", "Summary", "Decision", "By"].map((x) => h("th", {}, x))),
      recent.map((a) => h("tr", {}, h("td", {}, a.id), h("td", {}, a.kind), h("td", {}, a.summary),
        h("td", {}, stat(a.status), " ", a.resolution && a.resolution.decision ? cls(a.resolution.decision) : null), h("td", {}, a.resolved_by))))));
  const handler = (e) => { if (e.detail.type === "approval" && S.view === "approvals") render(); };
  document.addEventListener("ws", handler, { once: true });
  S.timers.push(setInterval(async () => { const n = (await api("GET", "/api/approvals?status=pending")).length; if (n !== pending.length && S.view === "approvals") render(); }, 4000));
}

function approvalCard(a, onDone) {
  const d = a.details || {};
  const resolve = async (body) => {
    await act(() => api("POST", `/api/approvals/${a.id}/resolve`, body), "Decision recorded");
    if (onDone) { await onDone(); return; }
    await loadAssessments(); render();
  };
  if (a.kind === "credential_domain") {
    const wildcard = h("input", { placeholder: `optional explicit wildcard, e.g. *.${d.domain.split(".").slice(-2).join(".")}` });
    const choice = (key, title, text) => h("button", { class: "choice" + (d.recommendation === key ? " recommended" : ""),
      onclick: () => resolve({ decision: key, pattern: wildcard.value.trim() || null }) },
      h("b", {}, title + (d.recommendation === key ? " (recommended)" : "")), h("span", { class: "small muted" }, text));
    return h("div", { class: "panel approval cred" },
      h("h2", {}, `Credentials would be sent to a new domain: `, h("span", { class: "mono" }, d.domain)),
      d.warning ? h("div", { class: "callout warn" }, d.warning) : null,
      h("div", { class: "kv" },
        h("div", {}, "Account"), h("div", {}, `${d.account_role} (${d.account_username})`),
        h("div", {}, "What would be sent"), h("div", {}, (d.credential_kinds || []).join(", "), h("span", { class: "muted" }, " (values hidden)")),
        h("div", {}, "Request"), h("div", { class: "mono small" }, `${d.method} ${d.url}`),
        h("div", {}, "Triggered by"), h("div", {}, d.trigger || ""),
        h("div", {}, "How it was reached"), h("div", {}, (d.redirect_chain || []).length ? h("ol", { class: "small mono" }, d.redirect_chain.map((u) => h("li", {}, u))) : "direct")),
      h("p", {}, "Add this domain for:"),
      h("div", { class: "choices" },
        choice("full", "Full testing", "Add to authorized scope; all testing the profile permits."),
        choice("lite", "Lite testing", "Passive analysis of login-flow traffic only; no extra requests."),
        choice("login_only", "Login process only", "Send credentials only to complete login; no testing."),
        h("button", { class: "choice", onclick: () => resolve({ decision: "decline" }) }, h("b", {}, "Decline"),
          h("span", { class: "small muted" }, "Do not send credentials. Use tester-assisted login instead."))),
      field("Wildcard (only if you want to classify sibling hosts too)", wildcard),
      h("p", { class: "small muted" }, "The login is paused until you answer. Your decision is recorded in the audit log."));
  }
  const body = [];
  if (a.kind === "tool_execution") {
    body.push(h("div", { class: "kv" }, h("div", {}, "Tool"), h("div", {}, `${d.tool} (risk: ${d.risk})`),
      h("div", {}, "Targets"), h("div", {}, (d.targets || []).join(", ")), h("div", {}, "Purpose"), h("div", {}, d.purpose),
      h("div", {}, "Why approval"), h("div", {}, (d.reasons || []).join("; "))),
      h("h3", {}, "Exact command"), pre(d.command),
      (d.warnings || []).map((w) => h("div", { class: "callout danger" }, w)));
  } else if (a.kind === "http_request") {
    body.push(h("div", { class: "kv" }, h("div", {}, "Request"), h("div", { class: "mono" }, `${d.method} ${d.url}`),
      h("div", {}, "Role"), h("div", {}, d.role || "unauthenticated"), h("div", {}, "Purpose"), h("div", {}, d.purpose)),
      d.body ? pre(d.body) : null);
  } else {
    body.push(pre(d));
  }
  return h("div", { class: "panel approval" }, h("h2", {}, `#${a.id} ${a.kind.replace("_", " ")}: ${a.summary}`), body,
    h("div", { class: "row" }, h("button", { class: "primary", onclick: () => resolve({ approve: true }) }, "Approve"),
      h("button", { class: "danger", onclick: () => resolve({ approve: false }) }, "Deny")));
}

// --------------------------------------------------------------- coverage
const COV_STATUSES = ["not_started", "in_progress", "passed", "issue_found", "not_applicable", "needs_manual", "blocked"];
async function coverage(main) {
  if (needAssessment(main)) return;
  const data = await api("GET", `/api/assessments/${S.aid}/coverage`);
  const sm = data.summary;
  const checkSel = h("select", {}, h("option", { value: "all" }, "all built-in checks"), data.checks.map((c) => h("option", { value: c }, c)));
  const out = h("div");
  add(main, h("h1", {}, "Test coverage"),
    h("div", { class: "grid" }, statBox(`${sm.completed}/${sm.total}`, "Tests completed"),
      ["issue_found", "passed", "not_applicable", "needs_manual", "blocked", "in_progress", "not_started"].map((k) => statBox(sm.counts[k] || 0, k.replace("_", " ")))),
    h("div", { class: "panel" }, h("div", { class: "row" }, h("b", {}, "Built-in checks"), checkSel,
        h("button", { class: "primary", onclick: async (e) => {
          e.target.disabled = true; e.target.textContent = "Running…";
          try {
            const runs = await act(() => api("POST", `/api/assessments/${S.aid}/checks`, { check: checkSel.value }));
            const issues = runs.reduce((n, r) => n + r.issues.length, 0);
            toast(`${runs.length} check(s) finished: ${issues} issue(s). New issues are 'potential' findings.`);
            render();
          } finally { e.target.disabled = false; e.target.textContent = "Run"; }
        } }, "Run")),
      h("p", { class: "small muted" }, "Deterministic, non-destructive checks (headers, cookies, CORS, methods, errors, listing, S3, GraphQL introspection, DNS email/CAA, takeover, TLS, tokens in URLs/storage, OAuth flow). Uses scope, rate limits and evidence capture like every other request."), out),
    h("p", { class: "small muted" }, "Sources: ", Object.entries(data.references).map(([k, v]) => h("a", { href: v, target: "_blank", rel: "noopener noreferrer" }, k + " ")),
      " · Edit config/test_catalog.yaml to change the methodology. 'blocked' permission = needs SOW permission (profile permitted_techniques) or prohibited."));
  const byCat = {};
  data.tests.forEach((t) => (byCat[t.category] = byCat[t.category] || []).push(t));
  for (const cat of data.categories) {
    const tests = byCat[cat.id] || [];
    if (!tests.length) continue;
    const done = tests.filter((t) => ["passed", "issue_found", "not_applicable"].includes(t.status)).length;
    add(main, h("details", { class: "panel", open: tests.some((t) => t.status === "issue_found") || null },
      h("summary", {}, h("b", {}, cat.name), ` - ${done}/${tests.length} done`,
        tests.some((t) => t.status === "issue_found") ? h("span", { class: "badge bad" }, `${tests.filter((t) => t.status === "issue_found").length} issue(s)`) : null),
      h("div", { class: "row small" }, h("button", { class: "small", onclick: () => {
        S.prefill = `Work through the "${cat.name}" tests in the test catalog. Run applicable built-in checks, test the autonomous items, request approval where required, give guidance for manual items, and record a result for every test.`;
        go("agent");
      } }, "Ask the agent to work on this category")),
      h("table", {}, h("tr", {}, ["ID", "Test", "Method", "Permission", "Status", "Findings", "Notes"].map((x) => h("th", {}, x))),
        tests.map((t) => {
          const sel = h("select", { onchange: async (e) => { await act(() => api("PUT", `/api/assessments/${S.aid}/coverage/${t.id}`, { status: e.target.value, notes: "" }), "Updated"); } },
            COV_STATUSES.map((s) => h("option", { selected: s === t.status }, s)));
          return h("tr", {}, h("td", { class: "mono small" }, t.id),
            h("td", {}, h("details", {}, h("summary", {}, t.name), h("div", { class: "small" }, t.how),
              h("div", { class: "small muted" }, [t.owasp, t.cwe].filter(Boolean).join(" · "), t.ref ? [" · ", h("a", { href: t.ref, target: "_blank", rel: "noopener noreferrer" }, "reference")] : null))),
            h("td", { class: "small" }, t.method.replace("builtin:", "built-in: ")),
            h("td", {}, h("span", { class: `badge ${({ autonomous: "ok", approval: "warnb", manual: "", blocked: "bad" })[t.permission.mode]}`, title: t.permission.reason }, t.permission.mode)),
            h("td", {}, sel),
            h("td", {}, (t.finding_ids || []).map((f) => h("a", { onclick: () => go("findings", f) }, `#${f} `))),
            h("td", { class: "small muted" }, (t.notes || "").slice(0, 160)));
        }))));
  }
}

// ---------------------------------------------------------------- agent
async function agent(main) {
  if (needAssessment(main)) return;
  const runs = await api("GET", `/api/assessments/${S.aid}/agent/runs`);
  const models = await api("GET", "/api/models").catch(() => []);
  const objective = h("textarea", { placeholder: "e.g. Analyze the authentication workflow and identify potential weaknesses.", value: S.prefill || "" });
  S.prefill = null;
  const model = h("select", {}, models.map((m) => h("option", { value: m.name, selected: m.default }, `${m.name}${m.supports_tools ? "" : " (no tool calling)"}`)));
  const examples = ["Analyze the authentication workflow and identify potential weaknesses.",
    "Review all discovered API endpoints for possible BOLA vulnerabilities.",
    "Analyze the Burp findings and identify which require manual validation.",
    "Investigate the application's JavaScript for exposed API endpoints.",
    "Review the current assessment and identify testing coverage gaps.",
    "What should I investigate next based on the confirmed findings?"];
  const runId = Number(S.sub) || (runs[0] && runs[0].id);
  add(main, h("h1", {}, "Agent console"),
    h("div", { class: "panel" },
      field("Ask the agent", objective),
      h("div", { class: "row small" }, examples.map((x) => h("a", { onclick: () => (objective.value = x) }, x.slice(0, 48) + "…"))),
      h("div", { class: "row" }, models.length ? field("Model", model) : h("span", { class: "err" }, "Ollama unavailable"),
        h("button", { class: "primary", onclick: async () => {
          const r = await act(() => api("POST", `/api/assessments/${S.aid}/agent`, { objective: objective.value, model: model.value || null }));
          go("agent", r.run_id);
        } }, "Run"))),
    await autonomousPanel(),
    consoleApprovals(),
    h("div", { class: "row" }, runs.slice(0, 12).map((r) => h("button", { class: "small" + (r.id === runId ? " primary" : ""), onclick: () => go("agent", r.id) }, `#${r.id} ${r.status}`))));
  if (!runId) return;
  const run = runs.find((r) => r.id === runId) || {};
  const list = h("div", { class: "events" });
  const head = h("div", { class: "row" }, h("h2", {}, `Run #${runId}`), stat(run.status), h("span", { class: "muted small" }, `${run.model} · ${run.steps} steps`),
    ["running", "queued"].includes(run.status) ? h("button", { class: "small danger", onclick: async () => { await act(() => api("POST", `/api/agent/runs/${runId}/stop`), "Stopped"); render(); } }, "Stop run") : null);
  add(main, h("div", { class: "panel" }, head, list));
  let after = 0;
  let live = ["running", "queued"].includes(run.status);
  let first = true;
  const pull = async () => {
    if (S.view !== "agent") return;
    const evs = await api("GET", `/api/agent/runs/${runId}/events?after=${after}`);
    evs.forEach((e) => { after = e.id; add(list, eventEl(e)); });
    // Re-render only when a run that was live when the page loaded reaches its end (never on the initial load,
    // otherwise a finished run's own "status" event re-triggers render -> pull -> render forever).
    const ended = evs.some((e) => e.type === "status" && ["finished", "stopped"].includes((e.content || {}).status));
    if (live && !first && ended) { live = false; render(); }
    first = false;
  };
  await pull();
  if (["running", "queued"].includes(run.status)) S.timers.push(setInterval(pull, 2000));
}
// Pending approvals shown inside the Agent console; refreshes itself without re-rendering the page.
function consoleApprovals() {
  const box = h("div", { id: "console-approvals" });
  box.dataset.key = "stale";
  const refresh = async () => {
    if (S.view !== "agent" || !document.body.contains(box)) return;
    let pending = [];
    try { pending = await api("GET", `/api/approvals?assessment_id=${S.aid}&status=pending`); } catch (e) { return; }
    const key = pending.map((p) => p.id).join(",");
    if (box.dataset.key === key) return;  // unchanged: keep any half-filled inputs
    box.dataset.key = key;
    box.replaceChildren(...(pending.length ? [h("div", { class: "callout danger" },
      h("b", {}, `Waiting for your approval (${pending.length})`),
      " - the agent paused these actions. Decide here; the agent picks up the result (check_approval)."),
      ...pending.map((p) => approvalCard(p, async () => { box.dataset.key = "stale"; await refresh(); await refreshPending(); }))] : []));
  };
  setTimeout(refresh, 0);
  S.timers.push(setInterval(refresh, 4000));
  const onWs = (e) => { if (["approval_created", "approval"].includes(e.detail.type)) refresh(); };
  document.addEventListener("ws", onWs);
  return box;
}

async function autonomousPanel() {
  const st = await api("GET", `/api/assessments/${S.aid}/autonomous`);
  const running = st.status === "running";
  const runs = h("input", { value: 20 }), steps = h("input", { value: 60 });
  const panel = h("div", { class: "panel" }, h("div", { class: "row" }, h("b", {}, "Autonomous mode"),
      h("span", { class: `badge ${running ? "ok" : ""}` }, st.status),
      running ? h("span", { class: "muted small" }, `${st.phase} · ${st.runs.length} run(s)`) : null),
    h("p", { class: "small muted" }, "Runs every built-in check, logs in the test accounts, then works through the test catalog category by category, each run building on what earlier runs found. Scope, approvals and SOW gating still apply: approval-gated steps pause until you answer."),
    running
      ? h("button", { class: "danger", onclick: async () => { await act(() => api("POST", `/api/assessments/${S.aid}/autonomous/stop`), "Autonomous mode stopped"); render(); } }, "Stop autonomous mode")
      : h("div", { class: "row" }, field("Max runs", runs), field("Steps per run", steps),
          h("button", { class: "primary", onclick: async () => {
            await act(() => api("POST", `/api/assessments/${S.aid}/autonomous`, { max_runs: Number(runs.value), steps_per_run: Number(steps.value) }), "Autonomous mode started");
            render();
          } }, "Start autonomous assessment")),
    (st.runs || []).length ? h("div", { class: "row small" }, st.runs.map((r) => h("a", { onclick: () => go("agent", r.run_id) }, `#${r.run_id} ${r.category}`))) : null,
    (st.skipped || []).length ? h("div", { class: "small muted" }, "No progress (skipped): " + st.skipped.join(", ")) : null);
  if (running) S.timers.push(setInterval(async () => { const n = await api("GET", `/api/assessments/${S.aid}/autonomous`); if (n.status !== "running" || n.runs.length !== st.runs.length) render(); }, 5000));
  return panel;
}
function inlineApproval(r) {
  const id = r && typeof r === "object" ? (r.approval_id || (r.job && r.job.approval_id)) : null;
  if (!id || (r.status && !["awaiting_approval", "pending"].includes(r.status) && !r.blocked)) return null;
  const box = h("div", { class: "row small" }, h("span", { class: "badge warnb" }, `approval #${id}`));
  const decide = (approve) => async () => {
    try {
      await api("POST", `/api/approvals/${id}/resolve`, { approve });
      box.replaceChildren(h("span", { class: `badge ${approve ? "ok" : "bad"}` }, `#${id} ${approve ? "approved" : "denied"}`));
      refreshPending();
    } catch (err) {
      box.replaceChildren(h("span", { class: "badge" }, `#${id}: ${err.message}`));
    }
  };
  box.append(h("button", { class: "small primary", onclick: decide(true) }, "Approve"),
             h("button", { class: "small danger", onclick: decide(false) }, "Deny"),
             h("a", { onclick: () => go("approvals") }, "details"));
  return box;
}
function resultHeadline(r) {
  if (!r || typeof r !== "object") return String(r ?? "").slice(0, 80);
  if (r.error) return "error: " + r.error;
  if (r.blocked) return "blocked: " + r.blocked;
  if (r.status !== undefined && r.url) return `HTTP ${r.status}${r.evidence_id ? " · evidence #" + r.evidence_id : ""}`;
  if (r.ref) return `${r.ref} (${r.status})`;
  if (r.success !== undefined) return r.success ? "login succeeded" : "login failed: " + (r.reason || "");
  if (r.status) return String(r.status);
  return Object.keys(r).slice(0, 5).join(", ");
}
function eventEl(e) {
  const c = e.content || {};
  let body;
  if (e.type === "operator" || e.type === "assistant") body = h("div", { class: "pre-wrap" }, h("pre", {}, c.text || ""));
  else if (e.type === "tool_call") body = h("div", {}, h("b", {}, c.name), c.arguments && c.arguments.purpose ? h("span", { class: "muted" }, " - " + c.arguments.purpose) : null,
    c.arguments && c.arguments.url ? h("div", { class: "mono small" }, `${c.arguments.method || ""} ${c.arguments.url}${c.arguments.role ? "  (as " + c.arguments.role + ")" : ""}`) : null,
    h("details", {}, h("summary", {}, "arguments"), pre(c.arguments)));
  else if (e.type === "tool_result") body = h("div", {}, h("details", {}, h("summary", {}, `result of ${c.name}: ${resultHeadline(c.result)}`), pre(c.result)),
    inlineApproval(c.result));
  else if (e.type === "status") body = h("div", {}, h("b", {}, c.status), c.summary ? pre(c.summary) : null);
  else body = pre(c);
  const label = { operator: "Tester", assistant: "Agent", tool_call: "Action", tool_result: "Result (untrusted data)", status: "Status", error: "Error" }[e.type] || e.type;
  return h("div", { class: `ev ${e.type}` }, h("div", { class: "h" }, `${label} · ${ts(e.ts)}`), body);
}

// -------------------------------------------------------------- findings
async function findings(main) {
  if (needAssessment(main)) return;
  if (S.sub) return findingWorkspace(main, Number(S.sub));
  const rows = await api("GET", `/api/assessments/${S.aid}/findings`);
  const q = h("input", { placeholder: "Search title, URL, parameter…" });
  const fs = h("select", {}, ["", "potential", "needs_review", "confirmed", "false_positive", "accepted_risk"].map((x) => h("option", { value: x }, x || "any status")));
  const fv = h("select", {}, ["", "critical", "high", "medium", "low", "info"].map((x) => h("option", { value: x }, x || "any severity")));
  const tbody = h("tbody");
  const draw = () => tbody.replaceChildren(...rows.filter((f) =>
    (!fs.value || f.status === fs.value) && (!fv.value || f.severity === fv.value) &&
    (!q.value || `${f.title} ${f.url} ${f.parameter}`.toLowerCase().includes(q.value.toLowerCase())))
    .map((f) => h("tr", { class: "click", onclick: () => go("findings", f.id) },
      h("td", {}, f.ref), h("td", {}, f.title), h("td", {}, sev(f.severity)), h("td", {}, f.confidence),
      h("td", {}, stat(f.status)), h("td", { class: "small mono" }, f.url), h("td", {}, f.source), h("td", { class: "small" }, ts(f.created_at)))));
  [q, fs, fv].forEach((x) => x.addEventListener("input", draw));
  draw();
  add(main, h("div", { class: "row" }, h("h1", {}, "Findings"), h("span", { class: "spacer" }),
      h("a", { href: `/api/assessments/${S.aid}/report.md` }, "Export Markdown report"),
      h("a", { href: `/api/assessments/${S.aid}/report.json` }, "Export JSON")),
    h("div", { class: "panel" }, h("div", { class: "row" }, q, fs, fv),
      h("table", {}, h("thead", {}, h("tr", {}, ["Ref", "Title", "Severity", "Confidence", "Status", "Affected", "Source", "Discovered"].map((x) => h("th", {}, x)))), tbody)),
    manualFindingForm());
}
function manualFindingForm() {
  const t = h("input"), u = h("input"), s = h("select", {}, ["high", "medium", "low", "info", "critical"].map((x) => h("option", {}, x))), d = h("textarea"), ev = h("input", { placeholder: "evidence ids, e.g. 12, 15" });
  return h("details", { class: "panel" }, h("summary", {}, "Add a finding manually"),
    h("div", { class: "grid" }, field("Title", t), field("URL", u), field("Severity", s), field("Evidence ids", ev)), field("Description", d),
    h("button", { onclick: async () => {
      await act(() => api("POST", `/api/assessments/${S.aid}/findings`, { data: { title: t.value, url: u.value, severity: s.value, description: d.value,
        status: "needs_review", evidence_ids: ev.value.split(",").map((x) => Number(x.trim())).filter(Boolean) } }), "Finding added");
      render();
    } }, "Add"));
}
async function findingWorkspace(main, id) {
  const repro = await api("GET", `/api/findings/${id}/reproduction`);
  const f = repro.finding;
  const tab = (S.tab = S.tab || "details");
  const tabs = h("div", { class: "tabs" }, [["details", "Details"], ["repro", "Reproduction"], ["evidence", "Evidence & commands"], ["next", "Suggested next steps"], ["notes", "Validation & notes"]]
    .map(([k, l]) => h("a", { class: tab === k ? "active" : "", onclick: () => { S.tab = k; render(); } }, l)));
  add(main, h("a", { onclick: () => { S.tab = null; go("findings"); } }, "← All findings"),
    h("h1", {}, `${f.ref}: ${f.title}`),
    h("div", { class: "row" }, sev(f.severity), stat(f.status), h("span", { class: "badge" }, `confidence ${f.confidence}`), h("span", { class: "muted small" }, `source ${f.source} · by ${f.created_by}${f.confirmed_by ? " · confirmed by " + f.confirmed_by : ""}`)),
    ["potential", "needs_review"].includes(f.status) ? h("div", { class: "callout warn" }, "Not yet validated by a tester. Do not report as confirmed until you have reproduced it.") : null,
    tabs);
  const p = h("div", { class: "panel" });
  add(main, p);
  if (tab === "details") {
    add(p, h("div", { class: "kv" }, [["Affected", `${f.method || ""} ${f.url}`], ["Parameter / component", f.parameter], ["CWE / OWASP", `${f.cwe || "-"} / ${f.owasp || "-"}`],
      ["CVSS", f.cvss_vector ? `${f.cvss_score ?? ""} ${f.cvss_vector}` : "-"], ["Required role", f.role], ["Authentication state", f.auth_state], ["Prerequisites", f.prerequisites]]
      .map(([k, v]) => [h("div", {}, k), h("div", { class: "mono small" }, v || "-")])));
    [["Description", "description"], ["Why this is a vulnerability", "why_vulnerable"], ["Expected secure behavior", "expected_behavior"],
      ["Actual observed behavior", "observed_behavior"], ["Impact", "impact"], ["Remediation", "remediation"]]
      .forEach(([l, k]) => f[k] && add(p, h("h3", {}, l), h("pre", {}, f[k])));
    if ((f.reproduction_steps || []).length) add(p, h("h3", {}, "Reproduction steps"), h("ol", {}, f.reproduction_steps.map((s) => h("li", {}, fmt(s)))));
  } else if (tab === "repro") {
    if (!repro.http.length) add(p, h("p", { class: "muted" }, "No HTTP evidence attached; see Evidence & commands."));
    repro.http.forEach((r) => add(p, 
      h("h2", {}, `Evidence #${r.evidence_id} · role: ${r.role || "unauthenticated"}`),
      r.variables.length ? h("div", { class: "callout info" }, "Set before running: ", r.variables.join(", "), " (valid values for the stated role)") : null,
      h("h3", {}, "Burp Repeater"), h("ol", { class: "small" }, r.burp_steps.map((s) => h("li", {}, s))), copyPre(r.burp_repeater_raw),
      h("h3", {}, "cURL (sanitized)"), copyPre(r.sanitized_curl),
      h("details", {}, h("summary", {}, "Python"), copyPre(r.python)),
      h("h3", {}, "Original request as sent (secrets redacted)"), pre(r.original_request),
      h("h3", {}, "Observed response"), pre(r.observed_response)));
    if ((f.reproduction_steps || []).length) add(p, h("h3", {}, "Browser / manual steps"), h("ol", {}, f.reproduction_steps.map((s) => h("li", {}, fmt(s)))));
  } else if (tab === "evidence") {
    repro.tools.forEach((t) => add(p, h("h2", {}, `Tool: ${t.tool} ${t.tool_version || ""} (evidence #${t.evidence_id})`),
      h("div", { class: "small muted" }, `exit code ${t.exit_code} · executed ${t.executed_at ? new Date(t.executed_at * 1000).toLocaleString() : ""}`),
      h("h3", {}, "Command executed"), pre(t.executed_command), h("h3", {}, "Sanitized reproduction command"), copyPre(t.sanitized_command),
      h("h3", {}, "Output excerpt"), pre(t.output_excerpt)));
    repro.other_evidence.forEach((o) => add(p, h("h3", {}, `Evidence #${o.evidence_id} (${o.kind})`), h("div", {}, o.summary), pre(o.data)));
    add(p, h("p", {}, "Evidence ids: ", (f.evidence_ids || []).map((e) => h("a", { onclick: () => go("evidence", e) }, `#${e} `))));
  } else if (tab === "next") {
    if (!(f.next_steps || []).length) add(p, h("p", { class: "muted" }, "No suggestions recorded. Ask the agent: “What should I investigate next for " + f.ref + "?”"));
    (f.next_steps || []).forEach((n, i) => add(p, h("div", { class: "panel" }, typeof n === "string" ? n :
      h("div", { class: "kv" }, Object.entries(n).map(([k, v]) => [h("div", {}, k.replaceAll("_", " ")), h("div", {}, fmt(v))])))));
  } else {
    const notes = h("textarea", { value: f.notes || "" });
    const set = (status) => async () => {
      if (status === "confirmed" && !confirm("Confirm that you reproduced this finding and the evidence supports it?")) return;
      await act(() => api("PUT", `/api/findings/${id}`, { data: { status, notes: notes.value } }), `Marked ${status}`); render();
    };
    add(p, field("Tester notes", notes),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: set("confirmed") }, "Confirm (reproduced)"),
        h("button", { onclick: set("needs_review") }, "Needs review"),
        h("button", { onclick: set("false_positive") }, "False positive"),
        h("button", { onclick: set("accepted_risk") }, "Accepted risk"),
        h("button", { onclick: async () => { await act(() => api("PUT", `/api/findings/${id}`, { data: { notes: notes.value } }), "Notes saved"); } }, "Save notes")),
      h("p", { class: "small muted" }, "Only operators can confirm, reject or risk-accept findings. Confirmation requires attached evidence."));
  }
}
// ----------------------------------------------------------- attack paths
async function paths(main) {
  if (needAssessment(main)) return;
  const rows = await api("GET", `/api/assessments/${S.aid}/attack-paths`);
  const open = new Set(S.pathOpen || []);
  const set = (p, status, notesEl) => async () => {
    if (status === "validated" && !confirm(`Validate ${p.ref}? It will be reported as a reproduced attack chain.`)) return;
    await act(() => api("PUT", `/api/attack-paths/${p.id}`, { data: { status, ...(notesEl ? { notes: notesEl.value } : {}) } }), `${p.ref} ${status}`);
    render();
  };
  const detail = (p) => {
    const notes = h("textarea", { value: p.notes || "" });
    return h("tr", { class: "pos-detail" }, h("td", { colspan: 6 },
      h("div", { class: "kv" }, [["Goal", p.goal], ["Entry point", p.entry_point], ["Prerequisites", p.prerequisites],
        ["Impact", p.impact], ["Source", `${p.source} · by ${p.created_by}${p.verified_by ? " · validated by " + p.verified_by : ""}`]]
        .map(([k, v]) => [h("div", {}, k), h("div", { class: "small" }, v || "-")])),
      h("h3", {}, "Steps"),
      h("table", {}, h("tr", {}, ["#", "Step", "Role", "Finding", "Evidence", "State"].map((x) => h("th", {}, x))),
        (p.steps || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((st) => h("tr", {},
          h("td", {}, st.order), h("td", {}, st.action, st.detail ? h("div", { class: "small muted" }, st.detail) : null, st.observed ? h("div", { class: "small mono" }, st.observed) : null),
          h("td", { class: "small" }, st.role || "-"),
          h("td", {}, st.finding_ref ? h("a", { onclick: () => goFinding(st.finding_ref) }, st.finding_ref) : "-"),
          h("td", { class: "small" }, (st.evidence_ids || []).map((e) => h("a", { onclick: () => go("evidence", e) }, `#${e} `))),
          h("td", { class: "small" }, st.requires_approval ? "changes state" : "read")))),
      field("Tester notes", notes),
      h("div", { class: "row" },
        p.status !== "validated" ? h("button", { class: "primary", onclick: set(p, "validated", notes) }, "Validate (reproduced)") : null,
        p.status !== "rejected" ? h("button", { onclick: set(p, "rejected", notes) }, "Reject") : null,
        p.status !== "proposed" ? h("button", { onclick: set(p, "proposed", notes) }, "Back to proposed") : null,
        h("button", { onclick: async () => { await act(() => api("PUT", `/api/attack-paths/${p.id}`, { data: { notes: notes.value } }), "Notes saved"); } }, "Save notes"))));
  };
  const tbody = h("tbody");
  const draw = () => tbody.replaceChildren(...rows.flatMap((p) => {
    const row = h("tr", { class: "click", onclick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); S.pathOpen = [...open]; draw(); } },
      h("td", { class: "nowrap" }, p.ref), h("td", {}, p.title, h("div", { class: "small muted" }, p.goal)),
      h("td", {}, sev(p.severity)), h("td", {}, stat(p.status)), h("td", {}, `${(p.steps || []).length} steps`),
      h("td", { class: "small" }, ts(p.updated_at)));
    return open.has(p.id) ? [row, detail(p)] : [row];
  }));
  draw();
  add(main, h("div", { class: "row" }, h("h1", {}, "Attack paths"), h("span", { class: "spacer" }),
      h("a", { href: `/api/assessments/${S.aid}/report.md` }, "Export Markdown report")),
    h("p", { class: "muted small" }, "Multi-step chains that combine findings and data into an end-to-end impact. The agent proposes them with per-step evidence; validate the ones you reproduce. Reported chains cover proposed and validated paths."),
    h("div", { class: "panel" }, rows.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Ref", "Title / goal", "Severity", "Status", "Steps", "Updated"].map((x) => h("th", {}, x)))), tbody)
      : h("p", { class: "muted" }, "None yet. Ask the agent to chain its findings into attack paths, or run autonomous mode.")));
}
function goFinding(ref) {
  act(() => api("GET", `/api/assessments/${S.aid}/findings`)).then((fs) => { const f = fs.find((x) => x.ref === ref); if (f) go("findings", f.id); });
}

// ------------------------------------------------------- positive findings
async function positives(main) {
  if (needAssessment(main)) return;
  const rows = await api("GET", `/api/assessments/${S.aid}/positive-findings`);
  const open = new Set((S.posOpen || []));
  const fs = h("select", {}, ["active", "proposed", "verified", "rejected", "withdrawn", ""].map((x) =>
    h("option", { value: x }, x === "active" ? "proposed + verified" : x || "any status")));
  const q = h("input", { placeholder: "Search control, host, test id…" });
  const tbody = h("tbody");
  const setStatus = (p, status, notesEl) => async () => {
    if (status === "verified" && !confirm(`Verify ${p.ref}? It will be reported as a tested, working control for: ${(p.hosts || []).join(", ") || "the application"}.`)) return;
    await act(() => api("PUT", `/api/positive-findings/${p.id}`, { data: { status, ...(notesEl ? { notes: notesEl.value } : {}) } }), `${p.ref} ${status}`);
    render();
  };
  const detail = (p) => {
    const notes = h("textarea", { value: p.notes || "" });
    return h("tr", { class: "pos-detail" }, h("td", { colspan: 7 },
      (p.conflicts || []).length ? h("div", { class: "callout danger" }, "Related findings on the same host/tests — review before reporting this control as effective: ",
        p.conflicts.map((c) => h("a", { onclick: () => go("findings", c.finding_id) }, `${c.ref} ${c.title} (${c.severity}, ${c.status}) `))) : null,
      p.description ? h("p", {}, p.description) : null,
      h("div", { class: "kv" }, [["How it was tested", p.tested_how], ["Hosts", (p.hosts || []).join(", ") || "application-wide"],
        ["Roles", (p.roles || []).join(", ")], ["Catalog tests", (p.test_ids || []).join(", ")], ["Source", `${p.source} · by ${p.created_by}${p.verified_by ? " · verified by " + p.verified_by : ""}`]]
        .map(([k, v]) => [h("div", {}, k), h("div", { class: "small" }, v || "-")])),
      h("h3", {}, "Observed"), h("pre", {}, p.observed_behavior || "-"),
      h("p", {}, "Evidence: ", (p.evidence_ids || []).map((e) => h("a", { onclick: () => go("evidence", e) }, `#${e} `))),
      field("Tester notes", notes),
      h("div", { class: "row" },
        p.status !== "verified" ? h("button", { class: "primary", onclick: setStatus(p, "verified", notes) }, "Verify") : null,
        p.status !== "rejected" ? h("button", { onclick: setStatus(p, "rejected", notes) }, "Reject") : null,
        p.status !== "proposed" ? h("button", { onclick: setStatus(p, "proposed", notes) }, "Back to proposed") : null,
        h("button", { onclick: async () => { await act(() => api("PUT", `/api/positive-findings/${p.id}`, { data: { notes: notes.value } }), "Notes saved"); } }, "Save notes"))));
  };
  const draw = () => {
    const shown = rows.filter((p) => (fs.value === "active" ? ["proposed", "verified"].includes(p.status) : !fs.value || p.status === fs.value) &&
      (!q.value || `${p.title} ${(p.hosts || []).join(" ")} ${(p.test_ids || []).join(" ")}`.toLowerCase().includes(q.value.toLowerCase())));
    tbody.replaceChildren(...shown.flatMap((p) => {
      const row = h("tr", { class: "click", onclick: () => { open.has(p.id) ? open.delete(p.id) : open.add(p.id); S.posOpen = [...open]; draw(); } },
        h("td", { class: "nowrap" }, p.ref), h("td", {}, p.title, (p.conflicts || []).length ? h("span", { class: "badge bad", title: "conflicts with findings" }, " conflict") : null),
        h("td", { class: "small mono" }, (p.hosts || []).slice(0, 4).join(", ") + ((p.hosts || []).length > 4 ? " …" : "") || "application-wide"),
        h("td", { class: "small" }, (p.test_ids || []).join(", ")), h("td", {}, stat(p.status)), h("td", { class: "small" }, p.source),
        h("td", { class: "small" }, ts(p.updated_at)));
      return open.has(p.id) ? [row, detail(p)] : [row];
    }));
  };
  [q, fs].forEach((x) => x.addEventListener("input", draw));
  draw();
  const counts = { proposed: 0, verified: 0 };
  rows.forEach((p) => { if (p.status in counts) counts[p.status] += 1; });
  add(main, h("div", { class: "row" }, h("h1", {}, "Positive findings"), h("span", { class: "spacer" }),
      h("a", { href: `/api/assessments/${S.aid}/report.md` }, "Export Markdown report")),
    h("p", { class: "muted small" }, "Security controls that were tested and observed working. Built-in checks and the agent propose them with evidence; ",
      "verify the ones you want in the report. A later check that contradicts a control removes that host from it (a contradicted verified item returns to proposed)."),
    h("div", { class: "grid" }, statBox(counts.verified, "Verified"), statBox(counts.proposed, "Awaiting review"),
      statBox(rows.filter((p) => (p.conflicts || []).length).length, "With conflicts")),
    h("div", { class: "panel" }, h("div", { class: "row" }, q, fs),
      rows.length ? h("table", {}, h("thead", {}, h("tr", {}, ["Ref", "Control", "Hosts", "Tests", "Status", "Source", "Updated"].map((x) => h("th", {}, x)))), tbody)
        : h("p", { class: "muted" }, "None yet. Run the built-in checks (Test coverage) or an agent run; controls observed working appear here.")),
    manualPositiveForm());
}
function manualPositiveForm() {
  const t = h("input"), hosts = h("input", { placeholder: "graphql.example.com, app.example.com" }), tests = h("input", { placeholder: "AC-18, API-02" }),
    how = h("textarea"), obs = h("textarea"), ev = h("input", { placeholder: "evidence ids, e.g. 12, 15" });
  const list = (v) => v.split(",").map((x) => x.trim()).filter(Boolean);
  return h("details", { class: "panel" }, h("summary", {}, "Add a positive finding manually"),
    h("div", { class: "grid" }, field("Control (title)", t), field("Hosts", hosts), field("Catalog test ids", tests), field("Evidence ids", ev)),
    field("How it was tested", how), field("Observed behavior", obs),
    h("button", { onclick: async () => {
      await act(() => api("POST", `/api/assessments/${S.aid}/positive-findings`, { data: { title: t.value, hosts: list(hosts.value), test_ids: list(tests.value),
        tested_how: how.value, observed_behavior: obs.value, status: "verified",
        evidence_ids: list(ev.value).map(Number).filter(Boolean) } }), "Positive finding added");
      render();
    } }, "Add (verified)"));
}
function copyPre(text) {
  return h("div", {}, h("button", { class: "small", onclick: () => navigator.clipboard.writeText(text).then(() => toast("Copied")) }, "Copy"), h("pre", {}, text));
}

// ----------------------------------------------------------- attack surface
async function surface(main) {
  if (needAssessment(main)) return;
  const obs = await api("GET", `/api/assessments/${S.aid}/observations`);
  const a = await api("GET", `/api/assessments/${S.aid}`);
  const by = {};
  obs.forEach((o) => (by[o.kind] = by[o.kind] || []).push(o));
  add(main, h("h1", {}, "Attack surface"),
    h("div", { class: "panel" }, h("h2", {}, "Domains"), h("table", {}, a.scope.rules.map((r) => h("tr", {}, h("td", { class: "mono" }, r.pattern), h("td", {}, cls(r.classification)))))),
    Object.keys(by).length ? Object.entries(by).map(([k, list]) => h("div", { class: "panel" }, h("h2", {}, `${k} (${list.length})`),
      h("table", {}, list.map((o) => h("tr", {}, h("td", { class: "mono small" }, o.value), h("td", { class: "small" }, Object.keys(o.details || {}).length ? fmt(o.details) : ""),
        h("td", {}, (o.evidence_ids || []).map((e) => h("a", { onclick: () => go("evidence", e) }, `#${e} `))))))))
      : h("div", { class: "panel muted" }, "No attack-surface items recorded yet. Ask the agent to perform reconnaissance."));
}

// ------------------------------------------------------------------ tools
async function tools(main) {
  const showAll = S.sub === "all";
  const list = await api("GET", `/api/tools${showAll ? "?all=true" : ""}`);
  const q = h("input", { placeholder: "filter" });
  const tbody = h("tbody");
  const draw = () => tbody.replaceChildren(...list.filter((t) => !q.value || `${t.name} ${t.description} ${t.capabilities.join(" ")}`.toLowerCase().includes(q.value.toLowerCase())).slice(0, 400).map((t) =>
    h("tr", {}, h("td", {}, h("a", { onclick: () => showTool(t.name) }, t.name), t.custom ? h("span", { class: "badge" }, "custom") : null),
      h("td", { class: "small" }, t.version), h("td", { class: "small" }, t.source),
      h("td", {}, h("select", { disabled: t.is_interpreter, onchange: async (e) => { await act(() => api("PUT", `/api/tools/${encodeURIComponent(t.name)}`, { risk: e.target.value }), "Risk updated"); } },
        ["unclassified", "passive", "low", "active", "intrusive", "dangerous"].map((r) => h("option", { selected: t.risk === r }, r))),
        h("div", { class: "small muted" }, t.risk_set_by)),
      h("td", {}, h("input", { type: "checkbox", checked: t.enabled, onchange: async (e) => { await act(() => api("PUT", `/api/tools/${encodeURIComponent(t.name)}`, { enabled: e.target.checked })); } })),
      h("td", { class: "small" }, (t.capabilities || []).join(", ")), h("td", { class: "small muted" }, t.description))));
  q.addEventListener("input", draw); draw();
  add(main, h("div", { class: "row" }, h("h1", {}, "Tools"), h("span", { class: "spacer" }),
      h("button", { class: "primary", onclick: async () => { const r = await act(() => api("POST", "/api/tools/discover"), "Discovery complete"); toast(JSON.stringify(r)); render(); } }, "Discover tools on Kali"),
      h("button", { onclick: async () => { await act(() => api("POST", "/api/tools/reload-policy"), "Policy reloaded"); render(); } }, "Reload policy file"),
      h("a", { onclick: () => go("tools", showAll ? null : "all") }, showAll ? "Show security tools only" : "Show all executables")),
    h("p", { class: "small muted" }, "Risk is set by you (here or in config/tool_policies.yaml), never by the AI. Unclassified tools always need approval; interpreters are always dangerous."),
    h("div", { class: "panel" }, q, h("table", {}, h("thead", {}, h("tr", {}, ["Tool", "Version", "Source", "Risk", "Enabled", "Capabilities", "Description"].map((x) => h("th", {}, x)))), tbody)),
    h("div", { class: "panel", id: "tooldetail" }),
    customToolForm(), installForm());
}
async function showTool(name) {
  const t = await api("GET", `/api/tools/${encodeURIComponent(name)}`);
  $("tooldetail").replaceChildren(h("h2", {}, t.name), h("div", { class: "small mono" }, t.path),
    h("button", { class: "small", onclick: async () => { await act(() => api("POST", `/api/tools/${encodeURIComponent(name)}/help`), "Documentation refreshed"); showTool(name); } }, "Fetch --help / man from Kali"),
    t.help_text ? pre(t.help_text) : h("p", { class: "muted" }, "No local documentation captured yet."));
  $("tooldetail").scrollIntoView();
}
function customToolForm() {
  const f = { name: h("input"), path: h("input", { placeholder: "/opt/webagent/tools/myscan.py" }), description: h("input"), capabilities: h("input", { placeholder: "comma separated" }),
    categories: h("input"), risk: h("select", {}, ["unclassified", "passive", "low", "active", "intrusive", "dangerous"].map((r) => h("option", {}, r))), input_spec: h("input"), output_spec: h("input") };
  return h("details", { class: "panel" }, h("summary", {}, "Register a custom tool or script"),
    h("div", { class: "grid" }, Object.entries(f).map(([k, i]) => field(k.replaceAll("_", " "), i))),
    h("button", { onclick: async () => {
      const body = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value]));
      body.capabilities = body.capabilities.split(",").map((x) => x.trim()).filter(Boolean);
      body.categories = body.categories.split(",").map((x) => x.trim()).filter(Boolean);
      await act(() => api("POST", "/api/tools/custom", body), "Registered"); render();
    } }, "Register"));
}
function installForm() {
  const m = h("select", {}, ["apt", "pipx", "go", "cargo", "gem"].map((x) => h("option", {}, x))), p = h("input", { placeholder: "package (go: module@version)" }), r = h("input");
  return h("details", { class: "panel" }, h("summary", {}, "Request installation of a tool on Kali"),
    h("div", { class: "grid" }, field("Manager", m), field("Package", p), field("Reason", r)),
    h("p", { class: "small muted" }, "Creates an approval. The gateway must have allow_install enabled. Verify package provenance before approving."),
    h("button", { onclick: async () => { await act(() => api("POST", "/api/tools/install", { manager: m.value, package: p.value, reason: r.value }), "Approval requested"); } }, "Request"));
}

// ------------------------------------------------------------------ jobs
async function jobs(main) {
  if (needAssessment(main)) return;
  const list = await api("GET", `/api/assessments/${S.aid}/jobs`);
  const tool = h("input"), args = h("textarea", { placeholder: "one argument per line\n-u\nhttps://app.example.com" }), targets = h("input", { placeholder: "https://app.example.com" }), purpose = h("input");
  add(main, h("h1", {}, "Tool jobs"),
    h("details", { class: "panel" }, h("summary", {}, "Run a tool manually (same policy checks as the agent)"),
      h("div", { class: "grid" }, field("Tool", tool), field("Targets (comma separated)", targets), field("Purpose", purpose)), field("Arguments", args),
      h("button", { onclick: async () => {
        const r = await act(() => api("POST", `/api/assessments/${S.aid}/jobs`, { tool: tool.value, args: lines(args.value), targets: targets.value.split(",").map((x) => x.trim()).filter(Boolean), purpose: purpose.value }));
        toast(`Job ${r.job_id}: ${r.status}${r.reasons ? " - " + r.reasons.join("; ") : ""}`, r.status === "denied"); render();
      } }, "Submit")),
    h("div", { class: "panel" }, h("table", {}, h("tr", {}, ["#", "Tool", "Command", "Status", "Exit", "By", "Started", ""].map((x) => h("th", {}, x))),
      list.map((j) => [h("tr", {}, h("td", {}, j.id), h("td", {}, j.tool), h("td", { class: "mono small" }, (j.parsed && j.parsed.command) || [j.executable, ...j.argv].join(" ")),
        h("td", {}, stat(j.status), j.error ? h("div", { class: "small err" }, j.error) : null), h("td", {}, j.exit_code ?? ""), h("td", { class: "small" }, j.requested_by), h("td", { class: "small" }, ts(j.started_at)),
        h("td", {}, j.status === "running" ? h("button", { class: "small", onclick: async () => { await act(() => api("POST", `/api/jobs/${j.id}/cancel`), "Cancelled"); render(); } }, "Cancel") : null)),
        j.stdout ? h("tr", {}, h("td", {}), h("td", { colspan: 7 }, h("details", {}, h("summary", {}, `output (${j.parsed && j.parsed.format})`), pre(j.stdout)))) : null]))));
  if (list.some((j) => j.status === "running")) S.timers.push(setInterval(() => S.view === "jobs" && render(), 4000));
}

// --------------------------------------------------------------- evidence
async function evidence(main) {
  if (needAssessment(main)) return;
  if (S.sub) {
    const e = await api("GET", `/api/evidence/${S.sub}`);
    add(main, h("a", { onclick: () => go("evidence") }, "← All evidence"), h("h1", {}, `Evidence #${e.id} (${e.kind})`),
      h("p", {}, e.summary), h("div", { class: "small muted" }, `sha256 ${e.sha256} · ${e.created_by} · ${ts(e.created_at)} · role ${e.role || "-"}`),
      Object.keys(e.request || {}).length ? [h("h2", {}, "Request (redacted)"), pre(e.request)] : null,
      Object.keys(e.response || {}).length ? [h("h2", {}, "Response (redacted)"), pre(e.response)] : null,
      Object.keys(e.data || {}).length ? [h("h2", {}, "Data"), pre(e.data)] : null);
    return;
  }
  const list = await api("GET", `/api/assessments/${S.aid}/evidence`);
  add(main, h("h1", {}, "Evidence"), h("div", { class: "panel" }, h("table", {}, h("tr", {}, ["#", "Kind", "Summary", "Status", "Role", "By", "When"].map((x) => h("th", {}, x))),
    list.map((e) => h("tr", { class: "click", onclick: () => go("evidence", e.id) }, h("td", {}, e.id), h("td", {}, e.kind), h("td", { class: "small" }, e.summary),
      h("td", {}, e.status ?? ""), h("td", {}, e.role), h("td", { class: "small" }, e.created_by), h("td", { class: "small" }, ts(e.created_at)))))));
}

// ------------------------------------------------------------------- burp
async function burp(main) {
  if (needAssessment(main)) return;
  const bs = await api("GET", `/api/assessments/${S.aid}/burp/status`).catch((e) => ({ rest_api: { ok: false, error: e.message }, proxy: {}, tasks: [] }));
  const check = bs.rest_api || {};
  const tasks = bs.tasks || [];
  const urls = h("textarea", { placeholder: "https://app.example.com/" }), conf = h("input", { placeholder: "optional named scan configuration" });
  const file = h("input", { type: "file", accept: ".xml,.har,.json" }), kind = h("select", {}, h("option", { value: "issues" }, "Issues XML (Report > XML)"), h("option", { value: "items" }, "Items XML (Proxy history / Site map > Save items)"), h("option", { value: "har" }, "HAR (browser devtools / extensions)"));
  add(main, h("h1", {}, "Burp Suite Professional"),
    h("div", { class: "panel" }, h("h2", {}, "REST API"), check.ok ? h("span", { class: "badge ok" }, `connected · ${check.issue_definitions} issue definitions`) : h("div", { class: "callout warn" }, check.error),
      check.fix ? h("p", { class: "small" }, check.fix) : null,
      h("div", { class: "kv" }, [
        ["Agent access", bs.trusted ? "trusted: the agent can check Burp, start scans and import their issues" : "not trusted (config/tool_policies.yaml burp.trusted)"],
        ["Scan approval", bs.scan_requires_approval ? "each scan needs your approval" : "agent may start scans without asking"],
        ["Proxy", bs.proxy && bs.proxy.configured ? `${bs.proxy.configured} · ${bs.proxy.reachable ? "reachable" : "not reachable"}` : "not set"],
        ["Agent traffic via Burp", bs.route_through_burp ? "yes (profile route_through_burp)" : "no — enable route_through_burp in the assessment profile to see agent requests in Burp history"]]
        .map(([k, v]) => [h("div", {}, k), h("div", { class: "small" }, v)])),
      h("p", { class: "small muted" }, "The REST API launches scans and returns their issues. Proxy history is read live through the MCP Server extension (below). Trust and approval are set in config/tool_policies.yaml (burp:).")),
    historyPanel(bs),
    h("div", { class: "two" },
      h("div", { class: "panel" }, h("h2", {}, "Request an active scan"), field("URLs (must be Full-testing scope)", urls), field("Scan configuration", conf),
        h("button", { onclick: async () => { await act(() => api("POST", `/api/assessments/${S.aid}/burp/scan`, { urls: lines(urls.value), scan_configurations: conf.value ? [conf.value] : [] }), "Approval requested"); await loadAssessments(); render(); } }, "Request scan (needs approval)"),
        h("h3", {}, "Scan tasks"), tasks.length ? tasks.map((t) => h("div", { class: "row" }, h("span", { class: "mono" }, `task ${t.task_id}`),
          h("span", { class: "small muted" }, `${(t.urls || []).join(", ")} · ${t.last_status || "?"} · by ${t.started_by}`),
          h("button", { class: "small", onclick: async () => { const r = await act(() => api("POST", `/api/assessments/${S.aid}/burp/tasks/${t.task_id}/import`)); toast(JSON.stringify(r)); render(); } }, "Refresh & import issues"))) : h("p", { class: "muted" }, "none")),
      h("div", { class: "panel" }, h("h2", {}, "Import Burp XML"), field("Type", kind), file,
        h("p", { class: "small muted" }, "Only items on hosts classified Full or Lite are imported. Findings arrive as 'potential' until validated."),
        h("button", { onclick: async () => {
          if (!file.files[0]) return toast("Choose a file", true);
          const fd = new FormData(); fd.append("kind", kind.value); fd.append("file", file.files[0]);
          const r = await act(() => api("POST", `/api/assessments/${S.aid}/burp/import-xml`, fd, true)); toast(JSON.stringify(r));
        } }, "Import"))));
}

function historyPanel(bs) {
  const ph = bs.proxy_history || {};
  const out = h("div");
  const host = h("input", { placeholder: "host filter (optional)" });
  const objective = "Review the live Burp Proxy HTTP history: map every in-scope endpoint and GraphQL operation with burp_proxy_overview, " +
    "open the interesting requests with burp_proxy_item, recommend attacks for each (with example request bodies), and test the most promising ones as each role.";
  return h("div", { class: "panel" }, h("h2", {}, "Live proxy history"),
    ph.ok ? h("span", { class: "badge ok" }, `connected via ${ph.via}`) : h("div", { class: "callout warn" }, ph.error || "not connected"),
    !ph.ok && ph.fix ? h("p", { class: "small" }, ph.fix) : null,
    h("p", { class: "small muted" }, "The agent reads Burp's Proxy > HTTP history directly through PortSwigger's MCP Server extension: in-scope (Full/Lite) items only, credentials redacted. No export or import needed."),
    h("div", { class: "row" }, host,
      h("button", { onclick: async () => {
        out.replaceChildren(h("p", { class: "muted" }, "Reading history… the first read of a large history takes up to a minute; later reads only fetch new items."));
        const r = await act(() => api("GET", `/api/assessments/${S.aid}/burp/history/overview${host.value ? "?host=" + encodeURIComponent(host.value) : ""}`)).catch(() => null);
        if (!r) return out.replaceChildren();
        out.replaceChildren(h("p", { class: "small muted" }, `${r.history_items_read} items read · ${r.in_scope_items} in scope · ${r.endpoint_count} endpoints`),
          h("table", {}, h("tr", {}, ["Method", "Host", "Path / operation", "Count", "Status", "Auth", "Params", "Examples"].map((x) => h("th", {}, x))),
            r.endpoints.map((e) => h("tr", {}, h("td", {}, e.method), h("td", { class: "small mono" }, e.host),
              h("td", { class: "small mono" }, e.path, e.graphql_operation ? h("div", { class: "muted" }, e.graphql_operation) : null),
              h("td", {}, e.count), h("td", { class: "small" }, e.statuses.join(", ")), h("td", { class: "small" }, e.auth.join(", ")),
              h("td", { class: "small" }, e.params.join(", ")), h("td", { class: "small" }, e.example_indexes.map((i) => `#${i}`).join(" "))))));
      } }, "Map endpoints"),
      h("button", { class: "primary", onclick: async () => {
        const r = await act(() => api("POST", `/api/assessments/${S.aid}/agent`, { objective }), "Agent run started");
        go("agent", r.run_id);
      } }, "Ask the agent to review it")),
    out);
}

// ------------------------------------------------------------------ audit
async function audit(main) {
  const rows = await api("GET", `/api/audit${S.aid ? "?assessment_id=" + S.aid : ""}`);
  const verify = h("span");
  add(main, h("div", { class: "row" }, h("h1", {}, "Audit log"), h("span", { class: "spacer" }),
      h("button", { onclick: async () => { const r = await api("GET", "/api/audit/verify"); verify.replaceChildren(r.ok ? h("span", { class: "badge ok" }, "hash chain intact") : h("span", { class: "badge bad" }, `chain broken at #${r.first_bad_id}`)); } }, "Verify integrity"), verify),
    h("div", { class: "panel" }, h("table", {}, h("tr", {}, ["#", "Time", "Actor", "Action", "Details"].map((x) => h("th", {}, x))),
      rows.map((e) => h("tr", {}, h("td", {}, e.id), h("td", { class: "small" }, ts(e.ts)), h("td", {}, e.actor), h("td", {}, e.action),
        h("td", {}, h("details", {}, h("summary", {}, Object.keys(e.details || {}).slice(0, 4).join(", ")), pre(e.details))))))));
}

// ----------------------------------------------------------------- system
async function system(main) {
  const st = await api("GET", "/api/status");
  const models = await api("GET", "/api/models").catch((e) => ({ error: e.message }));
  add(main, h("h1", {}, "System & models"), h("div", { class: "panel" }, componentTable(st)),
    h("div", { class: "panel" }, h("h2", {}, "Ollama models"),
      models.error ? h("div", { class: "callout danger" }, models.error) :
        h("table", {}, h("tr", {}, ["Model", "Size", "Capabilities", "Context", "Limitations"].map((x) => h("th", {}, x))),
          models.map((m) => h("tr", {}, h("td", {}, m.name, m.default ? h("span", { class: "badge ok" }, "default") : null), h("td", {}, m.parameter_size),
            h("td", {}, (m.capabilities || []).join(", ")), h("td", {}, m.context_length ?? "?"), h("td", { class: "small" }, h("ul", {}, m.limitations.map((l) => h("li", {}, l)))))))),
    h("p", { class: "small muted" }, "Change the default model, Kali gateway and Burp settings in .env (see README)."));
}

// Errors already shown to the operator by act() stop the calling handler but need no console noise.
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.shown) e.preventDefault(); });
window.addEventListener("hashchange", () => { const [v, s] = location.hash.slice(1).split("/"); if (v && (v !== S.view || (s || null) !== S.sub)) { S.view = v; S.sub = s || null; render(); } });
boot().catch((e) => $("app").replaceChildren(h("div", { class: "center panel err" }, e.message)));
