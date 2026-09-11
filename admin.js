const ADMIN_NAV = [
  { key: "overview", label: "Dashboard", ic: "▦" },
  { key: "users", label: "Users", ic: "👤" },
  { key: "workspaces", label: "Workspaces", ic: "🗂" },
  { key: "plans", label: "Plans", ic: "💳" },
  { key: "settings", label: "Site Settings", ic: "⚙" },
  { key: "health", label: "Health Check", ic: "💓" },
];

function renderNav(active) {
  document.getElementById("navList").innerHTML = ADMIN_NAV.map(
    (n) => `<div class="nav-item ${n.key === active ? "active" : ""}" data-nav="${n.key}"><span class="ic">${n.ic}</span> ${n.label}</div>`
  ).join("");
  document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => { location.hash = "#/" + el.dataset.nav; }));
}

function openModal(html) { document.getElementById("modalBody").innerHTML = html; document.getElementById("modalBackdrop").classList.add("show"); }
function closeModal() { document.getElementById("modalBackdrop").classList.remove("show"); document.getElementById("modalBody").innerHTML = ""; }
document.getElementById("modalBackdrop").addEventListener("click", (e) => { if (e.target.id === "modalBackdrop") closeModal(); });
function setContent(html) { document.getElementById("content").innerHTML = html; }

async function boot() {
  let me;
  try { me = (await API.get("/api/auth/me")).user; } catch { window.location.href = "/login"; return; }
  if (me.role !== "ADMIN") { window.location.href = "/dashboard"; return; }
  document.getElementById("userEmail").textContent = me.email;
  document.getElementById("avatarInit").textContent = me.email[0].toUpperCase();
  document.getElementById("logoutBtn").addEventListener("click", async () => { await API.post("/api/auth/logout"); window.location.href = "/login"; });
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const hash = (location.hash || "#/overview").replace("#/", "");
  const known = ADMIN_NAV.map((n) => n.key);
  const page = known.includes(hash) ? hash : "overview";
  renderNav(page);
  ({ overview: renderOverview, users: renderUsers, workspaces: renderWorkspaces, plans: renderPlans, settings: renderSettings, health: renderHealth }[page] || renderOverview)();
}

async function renderOverview() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const s = await API.get("/api/admin/stats");
  setContent(`
    <h1 class="page-title">Admin Dashboard</h1>
    <p class="page-sub">نمای کلی سیستم</p>
    <div class="grid grid-4">
      <div class="card stat-card"><div class="label">Total Users</div><div class="value">${s.totalUsers}</div></div>
      <div class="card stat-card"><div class="label">Active Users</div><div class="value green">${s.activeUsers}</div></div>
      <div class="card stat-card"><div class="label">Total Workspaces</div><div class="value">${s.totalWorkspaces}</div></div>
      <div class="card stat-card"><div class="label">Total Configs</div><div class="value">${s.totalConfigs}</div></div>
      <div class="card stat-card"><div class="label">Active Configs</div><div class="value green">${s.activeConfigs}</div></div>
      <div class="card stat-card"><div class="label">Traffic</div><div class="value cyan">${fmtBytes(s.totalTrafficUsedBytes)}</div></div>
      <div class="card stat-card"><div class="label">System Status</div><div class="value green">${s.systemStatus}</div></div>
    </div>
  `);
}

async function renderUsers() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { users } = await API.get("/api/admin/users");
  setContent(`
    <h1 class="page-title">User Management</h1>
    <div class="card" style="margin-bottom:14px"><input id="searchBox" class="field-input" placeholder="جستجو بر اساس ایمیل..." style="width:100%;background:var(--navy-800);border:1px solid var(--border);color:var(--text-primary);padding:9px 12px;border-radius:9px"></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead><tbody>
    ${users.map((u) => `<tr data-id="${u.id}"><td>${u.email}</td><td>${u.name || "-"}</td><td>${u.role}</td><td>${statusPill(u.status)}</td><td>${fmtDate(u.createdAt)}</td>
    <td><div class="action-icons">
      <button data-act="view" title="View">👁</button>
      <button data-act="toggle" title="${u.status === "ACTIVE" ? "Disable" : "Enable"}">${u.status === "ACTIVE" ? "⏸" : "▶"}</button>
      <button data-act="delete" title="Delete">🗑</button>
    </div></td></tr>`).join("")}
    </tbody></table></div></div>
  `);
  document.getElementById("searchBox").addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      const { users } = await API.get(`/api/admin/users?q=${encodeURIComponent(e.target.value)}`);
      document.querySelector("tbody").innerHTML = users.map((u) => `<tr data-id="${u.id}"><td>${u.email}</td><td>${u.name || "-"}</td><td>${u.role}</td><td>${statusPill(u.status)}</td><td>${fmtDate(u.createdAt)}</td><td></td></tr>`).join("");
    }
  });
  document.querySelectorAll("tbody tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelectorAll("button[data-act]").forEach((btn) => btn.addEventListener("click", async () => {
      try {
        if (btn.dataset.act === "view") {
          const d = await API.get(`/api/admin/users/${id}`);
          openModal(`<h3>${d.user.email}</h3>
            <p>Role: ${d.user.role} — Status: ${d.user.status}</p>
            ${d.workspace ? `<p style="color:var(--text-secondary);font-size:13px">Workspace: ${d.workspace.name}<br>Configs: ${d.workspace._count.configs} — Users: ${d.workspace._count.configUsers} — Subscriptions: ${d.workspace._count.subscriptions}</p>` : ""}
            <div class="modal-actions"><button class="btn btn-secondary" id="closeM">بستن</button></div>`);
          document.getElementById("closeM").addEventListener("click", closeModal);
        } else if (btn.dataset.act === "toggle") {
          const isActive = btn.title === "Disable";
          await API.patch(`/api/admin/users/${id}`, { status: isActive ? "DISABLED" : "ACTIVE" });
          renderUsers();
        } else if (btn.dataset.act === "delete") {
          if (!confirm("این کاربر برای همیشه حذف شود؟")) return;
          await API.del(`/api/admin/users/${id}`); renderUsers();
        }
      } catch (err) { toast(err.message, true); }
    }));
  });
}

async function renderWorkspaces() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { workspaces } = await API.get("/api/admin/workspaces");
  setContent(`
    <h1 class="page-title">Workspaces</h1>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Plan</th><th>Users</th><th>Configs</th><th>Config Users</th><th>Created</th></tr></thead><tbody>
    ${workspaces.map((w) => `<tr><td>${w.name}</td><td>${w.plan?.name || "-"}</td><td>${w._count.users}</td><td>${w._count.configs}</td><td>${w._count.configUsers}</td><td>${fmtDate(w.createdAt)}</td></tr>`).join("")}
    </tbody></table></div></div>
  `);
}

async function renderPlans() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { plans } = await API.get("/api/admin/plans");
  setContent(`
    <div class="section-head"><div><h1 class="page-title">Plan Management</h1></div><button class="btn btn-primary" id="newPlanBtn" style="width:auto">＋ New Plan</button></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Max Configs</th><th>Max Users</th><th>Traffic (GB)</th><th>Duration (Days)</th><th>Actions</th></tr></thead><tbody>
    ${plans.map((p) => `<tr data-id="${p.id}"><td>${p.name}</td><td>${p.maxConfigs}</td><td>${p.maxUsers}</td><td>${p.trafficLimitGb}</td><td>${p.durationDays}</td>
      <td><div class="action-icons"><button data-act="delete" title="Delete">🗑</button></div></td></tr>`).join("")}
    </tbody></table></div></div>
  `);
  document.getElementById("newPlanBtn").addEventListener("click", () => {
    openModal(`<h3>New Plan</h3><form id="planForm">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Maximum Configs</label><input name="maxConfigs" type="number" required></div>
      <div class="field"><label>Maximum Users</label><input name="maxUsers" type="number" required></div>
      <div class="field"><label>Traffic (GB)</label><input name="trafficLimitGb" type="number" required></div>
      <div class="field"><label>Duration (Days)</label><input name="durationDays" type="number" required></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelModal">انصراف</button><button class="btn btn-primary" type="submit">ایجاد</button></div>
    </form>`);
    document.getElementById("cancelModal").addEventListener("click", closeModal);
    document.getElementById("planForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.post("/api/admin/plans", Object.fromEntries(fd.entries()));
        closeModal(); renderPlans();
      } catch (err) { toast(err.message, true); }
    });
  });
  document.querySelectorAll("tbody tr[data-id] button[data-act='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.closest("tr").dataset.id;
      if (!confirm("این Plan حذف شود؟")) return;
      await API.del(`/api/admin/plans/${id}`); renderPlans();
    });
  });
}

async function renderSettings() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { settings } = await API.get("/api/admin/settings");
  setContent(`
    <h1 class="page-title">Site Settings</h1>
    <div class="card" style="max-width:480px">
      <form id="settingsForm">
        <div class="field"><label>Site Name</label><input name="siteName" value="${settings.siteName || ""}"></div>
        <div class="field"><label>Support Email</label><input name="supportEmail" value="${settings.supportEmail || ""}"></div>
        <div class="field"><label>Maintenance Mode</label>
          <select name="maintenanceMode"><option value="false" ${!settings.maintenanceMode ? "selected" : ""}>Off</option><option value="true" ${settings.maintenanceMode ? "selected" : ""}>On</option></select>
        </div>
        <div class="field"><label>Registration</label>
          <select name="registrationEnabled"><option value="true" ${settings.registrationEnabled !== false ? "selected" : ""}>Enabled</option><option value="false" ${settings.registrationEnabled === false ? "selected" : ""}>Disabled</option></select>
        </div>
        <button class="btn btn-primary" type="submit">ذخیره</button>
      </form>
    </div>
  `);
  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = {
      siteName: fd.get("siteName"),
      supportEmail: fd.get("supportEmail"),
      maintenanceMode: fd.get("maintenanceMode") === "true",
      registrationEnabled: fd.get("registrationEnabled") === "true",
    };
    await API.patch("/api/admin/settings", body);
    toast("تنظیمات ذخیره شد");
  });
}

async function renderHealth() {
  setContent(`<div class="empty-state">در حال بررسی...</div>`);
  const h = await API.get("/api/admin/health");
  setContent(`
    <h1 class="page-title">Health Check</h1>
    <div class="grid grid-4">
      <div class="card stat-card"><div class="label">Backend</div><div class="value ${h.backend === "ok" ? "green" : "amber"}">${h.backend}</div></div>
      <div class="card stat-card"><div class="label">Database</div><div class="value ${h.database === "ok" ? "green" : "amber"}">${h.database}</div></div>
      <div class="card stat-card"><div class="label">Cloudflare API</div><div class="value ${h.cloudflareApi === "ok" ? "green" : "amber"}">${h.cloudflareApi}</div></div>
    </div>
  `);
}

boot();
