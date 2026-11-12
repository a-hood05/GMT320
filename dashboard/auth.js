// =====================================================================
// SIGN IN + ROLE-BASED ACCESS CONTROL (browser side)
// Who may see what: roles_config.js. The server checks the same rules,
// this file only decides what is SHOWN:
//   - every element with data-need="<permission>" is hidden for roles
//     that don't have that permission (e.g. data-need="soil")
//   - AUTH.can("soil") tells the scripts whether to load a layer at all
//   - AUTH.fetch(url) is fetch() + the sign-in token, used for every /api/ call
// Signing in or out reloads the page, so every layer is built for the new role.
// =====================================================================
const AUTH = (function () {
  const KEY = "farmtech_session";       // sessionStorage: closing the tab signs you out
  const API = DASHBOARD_CONFIG.API_BASE;

  let session = null;
  try { session = JSON.parse(sessionStorage.getItem(KEY)); } catch { /* storage blocked */ }
  if (!session || !ROLES_CONFIG[session.role] || !(session.exp > Date.now())) session = { role: "public" };

  const role = session.role;
  const info = ROLES_CONFIG[role];
  const can = (permission) => info.can.includes(permission);

  function save(s) {
    try { s ? sessionStorage.setItem(KEY, JSON.stringify(s)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  }

  function authFetch(url, options = {}) {
    const headers = Object.assign({}, options.headers);
    if (session.token) headers.Authorization = "Bearer " + session.token;
    return fetch(url, Object.assign({}, options, { headers }));
  }

  // ---- Hide what this role may not see ----
  document.body.dataset.role = role;
  document.querySelectorAll("[data-need]").forEach((el) => {
    if (!can(el.dataset.need)) el.classList.add("rbac-hidden");
  });

  // ---- Sign-in button + dialog ----
  const btn = document.getElementById("btn-login");
  btn.innerHTML = role === "public"
    ? "🔒 Sign in"
    : `<span class="role-dot"></span>${info.short || info.label} <span class="login-out">· Sign out</span>`;
  btn.title = role === "public" ? "Sign in to see sensor data" : `Signed in as ${info.label} - click to sign out`;

  const dialog = document.createElement("div");
  dialog.id = "loginDialog";
  dialog.className = "login-backdrop";
  dialog.hidden = true;
  const signInRoles = Object.entries(ROLES_CONFIG).filter(([, r]) => r.passwordKey);
  dialog.innerHTML = `
    <form class="login-card" autocomplete="off">
      <button type="button" class="login-close" title="Close">✕</button>
      <h3>Sign in</h3>
      <p class="login-sub">Without signing in you see the farm layout and the irrigation decision.
        Sign in to see what your role needs.</p>
      <label>Role
        <select id="login-role">${signInRoles.map(([k, r]) => `<option value="${k}">${r.label}</option>`).join("")}</select>
      </label>
      <ul id="login-sees" class="login-sees"></ul>
      <label>Password <input type="password" id="login-pass" required /></label>
      <div id="login-error" class="login-error"></div>
      <button type="submit" class="login-submit">Sign in</button>
    </form>`;
  document.body.appendChild(dialog);

  const $ = (id) => document.getElementById(id);
  const showSees = () => {
    const r = ROLES_CONFIG[$("login-role").value];
    $("login-sees").innerHTML = ["farm layout + irrigation decision"].concat(r.can.map((p) => PERMISSION_LABELS[p]))
      .map((t) => `<li>${t}</li>`).join("");
  };
  $("login-role").addEventListener("change", showSees);
  showSees();

  const open = () => { dialog.hidden = false; $("login-error").textContent = ""; $("login-pass").value = ""; $("login-pass").focus(); };
  const close = () => { dialog.hidden = true; };
  dialog.querySelector(".login-close").addEventListener("click", close);
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !dialog.hidden) close(); });

  dialog.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("login-error").textContent = "Checking…";
    try {
      const res = await fetch(`${API}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: $("login-role").value, password: $("login-pass").value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Sign-in failed");
      save({ role: data.role, token: data.token, exp: Date.now() + data.hours * 3600000, fresh: true });
      location.reload();
    } catch (err) {
      $("login-error").textContent = err.message === "Failed to fetch"
        ? "Can't reach the server. Is it running? (npm run server)" : err.message;
    }
  });

  btn.addEventListener("click", () => {
    if (role === "public") return open();
    save(null);
    location.reload();
  });

  // ---- After signing in: say what's new for this role ----
  if (session.fresh) {
    session.fresh = false;
    save(session);
    const toast = document.createElement("div");
    toast.className = "login-toast";
    toast.innerHTML = `<b>Signed in as ${info.label}</b><br>You can now also see: ${info.can.map((p) => PERMISSION_LABELS[p]).join(", ")}.`;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add("gone"), 6000);
    setTimeout(() => toast.remove(), 7000);
  }

  // ---- If the server no longer accepts the token (expired / server restarted), sign out ----
  if (session.token) {
    authFetch(`${API}/api/me`).then((r) => r.json()).then((me) => {
      if (me.role !== role) {
        save(null);
        alertExpired();
      }
    }).catch(() => { /* server down: keep the session, the panels show their own errors */ });
  }
  function alertExpired() {
    const toast = document.createElement("div");
    toast.className = "login-toast warn";
    toast.innerHTML = `<b>Your sign-in has expired.</b><br><button type="button">Reload and sign in again</button>`;
    toast.querySelector("button").addEventListener("click", () => location.reload());
    document.body.appendChild(toast);
  }

  return { role, label: info.label, can, fetch: authFetch, openSignIn: open };
})();
