const NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", ic: "▦" },
  { key: "configs", label: "Configs", ic: "⛭" },
  { key: "create-config", label: "Create Config", ic: "＋" },
  { key: "subscriptions", label: "Subscriptions", ic: "🔗" },
  { key: "users", label: "Users", ic: "👤" },
  { key: "traffic", label: "Traffic", ic: "📶" },
  { key: "statistics", label: "Statistics", ic: "📊" },
  { key: "cloudflare", label: "Cloudflare", ic: "☁" },
  { key: "settings", label: "Settings", ic: "⚙" },
  { key: "security", label: "Security", ic: "🛡" },
];

let ME = null;
let PROTOCOL_DEFS = [];

function renderNav(active) {
  const html = NAV_ITEMS.map(
    (n) => `<div class="nav-item ${n.key === active ? "active" : ""}" data-nav="${n.key}"><span class="ic">${n.ic}</span> ${n.label}</div>`
  ).join("");
  document.getElementById("navList").innerHTML = html;
  document.getElementById("mobileNav").innerHTML = NAV_ITEMS.slice(0, 6).map(
    (n) => `<div class="nav-item ${n.key === active ? "active" : ""}" data-nav="${n.key}"><span class="ic">${n.ic}</span>${n.label}</div>`
  ).join("");
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => { location.hash = "#/" + el.dataset.nav; });
  });
}

function openModal(html) {
  document.getElementById("modalBody").innerHTML = html;
  document.getElementById("modalBackdrop").classList.add("show");
}
function closeModal() {
  document.getElementById("modalBackdrop").classList.remove("show");
  document.getElementById("modalBody").innerHTML = "";
}
document.getElementById("modalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "modalBackdrop") closeModal();
});

async function boot() {
  try {
    const data = await API.get("/api/auth/me");
    ME = data.user;
    document.getElementById("userEmail").textContent = ME.email;
    document.getElementById("avatarInit").textContent = ME.email[0].toUpperCase();
    if (ME.role === "ADMIN") {
      NAV_ITEMS.push({ key: "admin-link", label: "Admin Panel", ic: "🛠" });
    }
  } catch {
    window.location.href = "/login";
    return;
  }
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await API.post("/api/auth/logout");
    window.location.href = "/login";
  });
  try {
    const p = await API.get("/api/configs/protocols");
    PROTOCOL_DEFS = p.protocols;
  } catch {}
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const hash = (location.hash || "#/dashboard").replace("#/", "");
  if (hash === "admin-link") { window.location.href = "/admin"; return; }
  const known = NAV_ITEMS.map((n) => n.key);
  const page = known.includes(hash) ? hash : "dashboard";
  renderNav(page);
  const renderers = {
    dashboard: renderDashboard,
    configs: renderConfigs,
    "create-config": () => renderConfigs(true),
    subscriptions: renderSubscriptions,
    users: renderUsers,
    traffic: renderTraffic,
    statistics: renderStatistics,
    cloudflare: renderCloudflare,
    settings: renderSettings,
    security: renderSecurity,
    support: renderSupport,
  };
  (renderers[page] || renderDashboard)();
}

function setContent(html) { document.getElementById("content").innerHTML = html; }

/* ---------------- Dashboard ---------------- */
async function renderDashboard() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const [stats, activity, cf] = await Promise.all([
    API.get("/api/statistics"),
    API.get("/api/statistics/recent-activity").catch(() => ({ logs: [] })),
    API.get("/api/cloudflare/status").catch(() => ({ connected: false })),
  ]);

  setContent(`
    <h1 class="page-title">Dashboard</h1>
    <p class="page-sub">نمای کلی از Workspace شما</p>
    <div class="grid grid-4 section">
      <div class="card stat-card"><div class="label">Total Configs</div><div class="value">${stats.totalConfigs}</div></div>
      <div class="card stat-card"><div class="label">Active Configs</div><div class="value green">${stats.activeConfigs}</div></div>
      <div class="card stat-card"><div class="label">Expired Configs</div><div class="value amber">${stats.expiredConfigs}</div></div>
      <div class="card stat-card"><div class="label">Total Users</div><div class="value">${stats.totalUsers}</div></div>
      <div class="card stat-card"><div class="label">Active Users</div><div class="value green">${stats.activeUsers}</div></div>
      <div class="card stat-card"><div class="label">Total Traffic</div><div class="value">${stats.totalTrafficBytes ? fmtBytes(stats.totalTrafficBytes) : "Unlimited"}</div></div>
      <div class="card stat-card"><div class="label">Used Traffic</div><div class="value cyan">${fmtBytes(stats.usedTrafficBytes)}</div></div>
      <div class="card stat-card"><div class="label">Remaining Traffic</div><div class="value">${stats.remainingTrafficBytes !== null ? fmtBytes(stats.remainingTrafficBytes) : "Unlimited"}</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card section">
        <div class="section-head"><h3>Traffic Chart</h3></div>
        <canvas id="miniChart" width="500" height="180" style="width:100%;height:180px"></canvas>
      </div>
      <div class="card section">
        <div class="section-head"><h3>Cloudflare Status</h3></div>
        ${cf.connected
          ? `<p>وضعیت: <b style="color:var(--green)">Cloudflare Connected</b></p><p style="color:var(--text-secondary);font-size:12.5px">Account: ${cf.account || "-"}<br>Zone: ${cf.zone || "-"}<br>Last Checked: ${fmtDate(cf.lastChecked)}</p>`
          : `<p style="color:var(--text-secondary)">هنوز به Cloudflare متصل نشده‌اید.</p><button class="btn btn-secondary btn-sm" data-nav="cloudflare">اتصال به Cloudflare</button>`}
      </div>
    </div>

    <div class="card section">
      <div class="section-head"><h3>Recent Activity</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Action</th><th>Time</th></tr></thead><tbody>
      ${(activity.logs || []).length ? activity.logs.map((l) => `<tr><td>${l.action}</td><td>${fmtDate(l.createdAt)}</td></tr>`).join("") : `<tr><td colspan="2" class="empty-state">فعالیتی ثبت نشده است</td></tr>`}
      </tbody></table></div>
    </div>
  `);
  document.querySelectorAll("[data-nav]").forEach((el) => el.addEventListener("click", () => { location.hash = "#/" + el.dataset.nav; }));
  drawMiniChart();
}

function drawMiniChart() {
  const canvas = document.getElementById("miniChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148,163,184,0.15)";
  for (let i = 0; i <= 4; i++) {
    const y = (h / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  const points = Array.from({ length: 12 }, () => Math.random() * 0.7 + 0.15);
  ctx.strokeStyle = "#22d3ee";
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = (w / (points.length - 1)) * i;
    const y = h - p * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ---------------- Configs ---------------- */
async function renderConfigs(openCreate) {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { configs } = await API.get("/api/configs");
  setContent(`
    <div class="section-head"><div><h1 class="page-title">Configs</h1><p class="page-sub">مدیریت کانفیگ‌های شبکه</p></div>
    <button class="btn btn-primary" id="newConfigBtn" style="width:auto">＋ Create Config</button></div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr>
        <th>Name</th><th>Protocol</th><th>Server:Port</th><th>Status</th><th>Traffic</th><th>Expiration</th><th>Actions</th>
      </tr></thead><tbody>
      ${configs.length ? configs.map(rowConfig).join("") : `<tr><td colspan="7"><div class="empty-state">هنوز Configی ایجاد نشده است</div></td></tr>`}
      </tbody></table></div>
    </div>
  `);
  document.getElementById("newConfigBtn").addEventListener("click", openCreateConfigModal);
  bindConfigActions();
  if (openCreate) openCreateConfigModal();
}

function rowConfig(c) {
  const used = fmtBytes(c.trafficUsedBytes);
  const limit = c.trafficLimitBytes ? fmtBytes(c.trafficLimitBytes) : "Unlimited";
  return `<tr data-id="${c.id}">
    <td>${c.name}</td>
    <td>${c.protocol}</td>
    <td>${c.server}:${c.port}</td>
    <td>${statusPill(c.status)}</td>
    <td>${used} / ${limit}</td>
    <td>${c.expiresAt ? fmtDate(c.expiresAt) : "Never"}</td>
    <td><div class="action-icons">
      <button data-act="copy" title="Copy Link">🔗</button>
      <button data-act="toggle" title="${c.status === "ACTIVE" ? "Disable" : "Enable"}">${c.status === "ACTIVE" ? "⏸" : "▶"}</button>
      <button data-act="duplicate" title="Duplicate">⧉</button>
      <button data-act="delete" title="Delete">🗑</button>
    </div></td>
  </tr>`;
}

function bindConfigActions() {
  document.querySelectorAll("#content tbody tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act;
        try {
          if (act === "copy") {
            const { link } = await API.get(`/api/configs/${id}/link`);
            await navigator.clipboard.writeText(link);
            toast("لینک کانفیگ کپی شد");
          } else if (act === "toggle") {
            const isActive = btn.title === "Disable";
            await API.patch(`/api/configs/${id}`, { status: isActive ? "DISABLED" : "ACTIVE" });
            toast("وضعیت به‌روزرسانی شد");
            renderConfigs();
          } else if (act === "duplicate") {
            await API.post(`/api/configs/${id}/duplicate`);
            toast("Config کپی شد");
            renderConfigs();
          } else if (act === "delete") {
            if (!confirm("آیا از حذف این Config مطمئن هستید؟")) return;
            await API.del(`/api/configs/${id}`);
            toast("Config حذف شد");
            renderConfigs();
          }
        } catch (err) { toast(err.message, true); }
      });
    });
  });
}

function openCreateConfigModal() {
  const protocolOptions = PROTOCOL_DEFS.map((p) => `<option value="${p.key}">${p.key}</option>`).join("");
  openModal(`
    <h3>Create Config</h3>
    <div class="error-box" id="cfgErr"></div>
    <form id="cfgForm">
      <div class="protocol-fields">
        <div class="field full"><label>Config Name</label><input name="name" required placeholder="Germany-01"></div>
        <div class="field"><label>Protocol</label><select name="protocol" id="protocolSelect">${protocolOptions}</select></div>
        <div class="field"><label>Server</label><input name="server" required placeholder="1.2.3.4"></div>
        <div class="field"><label>Port</label><input name="port" type="number" required placeholder="443"></div>
        <div class="field"><label>Traffic Limit (GB)</label><input name="trafficLimitGb" type="number" placeholder="خالی = نامحدود"></div>
        <div class="field"><label>Expiration (Days)</label><input name="expirationDays" type="number" placeholder="خالی = بدون انقضا"></div>
        <div class="field"><label>Maximum Users</label><input name="maxUsers" type="number" placeholder="اختیاری"></div>
        <div class="field full"><label>Description</label><textarea name="description" rows="2"></textarea></div>
      </div>
      <div id="dynamicFields" class="protocol-fields"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelModal">انصراف</button>
        <button type="submit" class="btn btn-primary">ایجاد Config</button>
      </div>
    </form>
  `);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  document.getElementById("protocolSelect").addEventListener("change", renderDynamicFields);
  renderDynamicFields();

  document.getElementById("cfgForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("cfgErr");
    errBox.classList.remove("show");
    const fd = new FormData(e.target);
    const proto = fd.get("protocol");
    const def = PROTOCOL_DEFS.find((p) => p.key === proto);
    const settings = {};
    (def?.fields || []).forEach((f) => { settings[f.name] = fd.get(`settings.${f.name}`) || undefined; });

    const body = {
      name: fd.get("name"),
      protocol: proto,
      server: fd.get("server"),
      port: fd.get("port"),
      description: fd.get("description") || undefined,
      trafficLimitGb: fd.get("trafficLimitGb") || "unlimited",
      expirationDays: fd.get("expirationDays") || "never",
      maxUsers: fd.get("maxUsers") || undefined,
      settings,
    };
    try {
      await API.post("/api/configs", body);
      toast("Config ایجاد شد");
      closeModal();
      renderConfigs();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.add("show");
    }
  });
}

function renderDynamicFields() {
  const proto = document.getElementById("protocolSelect").value;
  const def = PROTOCOL_DEFS.find((p) => p.key === proto);
  const container = document.getElementById("dynamicFields");
  if (!def) { container.innerHTML = ""; return; }
  container.innerHTML = def.fields.map((f) => {
    if (f.type === "select") {
      return `<div class="field"><label>${f.label}</label><select name="settings.${f.name}">${f.options.map((o) => `<option value="${o}">${o || "(none)"}</option>`).join("")}</select></div>`;
    }
    return `<div class="field"><label>${f.label}</label><input name="settings.${f.name}" type="${f.type}" ${f.note ? `placeholder="${f.note}"` : ""}></div>`;
  }).join("");
}

/* ---------------- Subscriptions ---------------- */
async function renderSubscriptions() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const [{ subscriptions }, { configs }] = await Promise.all([
    API.get("/api/subscriptions"),
    API.get("/api/configs"),
  ]);
  setContent(`
    <div class="section-head"><div><h1 class="page-title">Subscriptions</h1><p class="page-sub">اشتراک‌های قابل ارائه به کاربران</p></div>
    <button class="btn btn-primary" id="newSubBtn" style="width:auto">＋ Create Subscription</button></div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Configs</th><th>Status</th><th>URL</th><th>Actions</th></tr></thead><tbody>
      ${subscriptions.length ? subscriptions.map(rowSub).join("") : `<tr><td colspan="5"><div class="empty-state">هنوز Subscriptionی ایجاد نشده است</div></td></tr>`}
      </tbody></table></div>
    </div>
  `);
  document.getElementById("newSubBtn").addEventListener("click", () => openCreateSubModal(configs));
  bindSubActions();
}

function rowSub(s) {
  return `<tr data-id="${s.id}">
    <td>${s.name}</td><td>${s.configCount}</td><td>${statusPill(s.status)}</td>
    <td><code style="font-size:11px">${s.subscriptionUrl}</code></td>
    <td><div class="action-icons">
      <button data-act="copy" title="Copy">🔗</button>
      <button data-act="regen" title="Regenerate">↻</button>
      <button data-act="toggle" title="${s.status === "ACTIVE" ? "Disable" : "Enable"}">${s.status === "ACTIVE" ? "⏸" : "▶"}</button>
      <button data-act="delete" title="Delete">🗑</button>
    </div></td>
  </tr>`;
}

function bindSubActions() {
  document.querySelectorAll("#content tbody tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          if (btn.dataset.act === "copy") {
            const url = tr.querySelector("code").textContent;
            await navigator.clipboard.writeText(location.origin + url);
            toast("لینک Subscription کپی شد");
          } else if (btn.dataset.act === "regen") {
            if (!confirm("Subscription قبلی بلافاصله غیرمعتبر می‌شود. ادامه می‌دهید؟")) return;
            await API.post(`/api/subscriptions/${id}/regenerate`);
            toast("Subscription بازتولید شد"); renderSubscriptions();
          } else if (btn.dataset.act === "toggle") {
            const isActive = btn.title === "Disable";
            await API.patch(`/api/subscriptions/${id}`, { status: isActive ? "DISABLED" : "ACTIVE" });
            renderSubscriptions();
          } else if (btn.dataset.act === "delete") {
            if (!confirm("حذف شود؟")) return;
            await API.del(`/api/subscriptions/${id}`);
            renderSubscriptions();
          }
        } catch (err) { toast(err.message, true); }
      });
    });
  });
}

function openCreateSubModal(configs) {
  openModal(`
    <h3>Create Subscription</h3>
    <div class="error-box" id="subErr"></div>
    <form id="subForm">
      <div class="field"><label>Subscription Name</label><input name="name" required placeholder="Germany Servers"></div>
      <div class="field"><label>Configs</label>
        <div style="max-height:180px;overflow-y:auto;border:1px solid var(--border);border-radius:9px;padding:8px">
          ${configs.length ? configs.map((c) => `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px"><input type="checkbox" value="${c.id}" name="configIds"> ${c.name} <span style="color:var(--text-muted);font-size:11px">(${c.protocol})</span></label>`).join("") : `<p style="color:var(--text-muted)">ابتدا یک Config بسازید</p>`}
        </div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelModal">انصراف</button>
        <button type="submit" class="btn btn-primary">ایجاد</button>
      </div>
    </form>
  `);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  document.getElementById("subForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("subErr");
    errBox.classList.remove("show");
    const fd = new FormData(e.target);
    const configIds = fd.getAll("configIds");
    if (!configIds.length) { errBox.textContent = "حداقل یک Config انتخاب کنید"; errBox.classList.add("show"); return; }
    try {
      await API.post("/api/subscriptions", { name: fd.get("name"), configIds });
      toast("Subscription ایجاد شد");
      closeModal();
      renderSubscriptions();
    } catch (err) { errBox.textContent = err.message; errBox.classList.add("show"); }
  });
}

/* ---------------- Users (ConfigUser) ---------------- */
async function renderUsers() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { users } = await API.get("/api/users");
  setContent(`
    <div class="section-head"><div><h1 class="page-title">Users</h1><p class="page-sub">کاربران مصرف‌کننده کانفیگ‌ها</p></div>
    <button class="btn btn-primary" id="newUserBtn" style="width:auto">＋ Create User</button></div>
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Status</th><th>Traffic</th><th>Expiration</th><th>Last Seen</th><th>Actions</th></tr></thead><tbody>
      ${users.length ? users.map(rowUser).join("") : `<tr><td colspan="6"><div class="empty-state">کاربری ثبت نشده است</div></td></tr>`}
      </tbody></table></div>
    </div>
  `);
  document.getElementById("newUserBtn").addEventListener("click", openCreateUserModal);
  bindUserActions();
}

function rowUser(u) {
  return `<tr data-id="${u.id}">
    <td>${u.name}</td><td>${statusPill(u.status)}</td>
    <td>${fmtBytes(u.trafficUsedBytes)} / ${u.trafficLimitBytes ? fmtBytes(u.trafficLimitBytes) : "Unlimited"}</td>
    <td>${u.expiresAt ? fmtDate(u.expiresAt) : "Never"}</td>
    <td>${u.lastSeen ? fmtDate(u.lastSeen) : "—"}</td>
    <td><div class="action-icons">
      <button data-act="reset" title="Reset Traffic">↺</button>
      <button data-act="toggle" title="${u.status === "ACTIVE" ? "Disable" : "Enable"}">${u.status === "ACTIVE" ? "⏸" : "▶"}</button>
      <button data-act="delete" title="Delete">🗑</button>
    </div></td>
  </tr>`;
}

function bindUserActions() {
  document.querySelectorAll("#content tbody tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          if (btn.dataset.act === "reset") { await API.post(`/api/users/${id}/reset-traffic`); toast("ترافیک ریست شد"); renderUsers(); }
          else if (btn.dataset.act === "toggle") { const isActive = btn.title === "Disable"; await API.patch(`/api/users/${id}`, { status: isActive ? "DISABLED" : "ACTIVE" }); renderUsers(); }
          else if (btn.dataset.act === "delete") { if (!confirm("حذف شود؟")) return; await API.del(`/api/users/${id}`); renderUsers(); }
        } catch (err) { toast(err.message, true); }
      });
    });
  });
}

function openCreateUserModal() {
  openModal(`
    <h3>Create User</h3>
    <div class="error-box" id="userErr"></div>
    <form id="userForm">
      <div class="field"><label>Name</label><input name="name" required></div>
      <div class="field"><label>Traffic Limit (GB)</label><input name="trafficLimitGb" type="number" placeholder="خالی = نامحدود"></div>
      <div class="field"><label>Expiration (Days)</label><input name="expirationDays" type="number" placeholder="خالی = بدون انقضا"></div>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" id="cancelModal">انصراف</button><button type="submit" class="btn btn-primary">ایجاد</button></div>
    </form>
  `);
  document.getElementById("cancelModal").addEventListener("click", closeModal);
  document.getElementById("userForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errBox = document.getElementById("userErr");
    const fd = new FormData(e.target);
    try {
      await API.post("/api/users", {
        name: fd.get("name"),
        trafficLimitGb: fd.get("trafficLimitGb") || "unlimited",
        expirationDays: fd.get("expirationDays") || "never",
      });
      toast("User ایجاد شد"); closeModal(); renderUsers();
    } catch (err) { errBox.textContent = err.message; errBox.classList.add("show"); }
  });
}

/* ---------------- Traffic ---------------- */
async function renderTraffic() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { configs } = await API.get("/api/configs");
  setContent(`
    <h1 class="page-title">Traffic</h1>
    <p class="page-sub">مصرف ترافیک به تفکیک Config</p>
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>Config</th><th>Used</th><th>Limit</th><th>Status</th></tr></thead><tbody>
      ${configs.length ? configs.map((c) => `<tr><td>${c.name}</td><td>${fmtBytes(c.trafficUsedBytes)}</td><td>${c.trafficLimitBytes ? fmtBytes(c.trafficLimitBytes) : "Unlimited"}</td><td>${statusPill(c.status)}</td></tr>`).join("") : `<tr><td colspan="4"><div class="empty-state">داده‌ای موجود نیست</div></td></tr>`}
      </tbody></table></div>
    </div>
  `);
}

/* ---------------- Statistics ---------------- */
async function renderStatistics() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  await paintStatistics("7d");
}
async function paintStatistics(range) {
  const stats = await API.get("/api/statistics");
  const traffic = await API.get(`/api/statistics/traffic?range=${range}`);
  setContent(`
    <h1 class="page-title">Statistics</h1>
    <p class="page-sub">آمار مصرف Workspace</p>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      ${["today", "7d", "30d", "all"].map((r) => `<button class="btn ${r === range ? "btn-primary" : "btn-secondary"} btn-sm" data-range="${r}" style="width:auto">${{today:"Today", "7d":"7 Days", "30d":"30 Days", all:"All Time"}[r]}</button>`).join("")}
    </div>
    <div class="grid grid-2 section">
      <div class="card"><div class="stat-card"><div class="label">Upload</div><div class="value cyan">${fmtBytes(sumField(traffic.points, "upload"))}</div></div></div>
      <div class="card"><div class="stat-card"><div class="label">Download</div><div class="value cyan">${fmtBytes(sumField(traffic.points, "download"))}</div></div></div>
    </div>
    <div class="card">
      <div class="section-head"><h3>Total Traffic</h3></div>
      <canvas id="statChart" width="900" height="220" style="width:100%;height:220px"></canvas>
      ${!traffic.points.length ? `<p style="color:var(--text-muted);text-align:center;margin-top:10px">داده‌ای برای این بازه ثبت نشده است</p>` : ""}
    </div>
  `);
  document.querySelectorAll("[data-range]").forEach((btn) => btn.addEventListener("click", () => paintStatistics(btn.dataset.range)));
  drawStatChart(traffic.points);
}
function sumField(points, field) {
  return points.reduce((sum, p) => sum + BigInt(p[field] || "0"), 0n).toString();
}
function drawStatChart(points) {
  const canvas = document.getElementById("statChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(148,163,184,0.15)";
  for (let i = 0; i <= 4; i++) { const y = (h / 4) * i; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  if (!points.length) return;
  const maxVal = Math.max(1, ...points.map((p) => Number(p.upload) + Number(p.download)));
  ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 2; ctx.beginPath();
  points.forEach((p, i) => {
    const x = (w / Math.max(1, points.length - 1)) * i;
    const y = h - ((Number(p.upload) + Number(p.download)) / maxVal) * (h - 10) - 5;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/* ---------------- Cloudflare ---------------- */
async function renderCloudflare() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const status = await API.get("/api/cloudflare/status");
  setContent(`
    <h1 class="page-title">Cloudflare</h1>
    <p class="page-sub">اتصال حساب Cloudflare به این Workspace</p>
    <div class="card" style="max-width:520px">
      ${status.connected ? `
        <p style="color:var(--green);font-weight:700">✔ Cloudflare Connected</p>
        <table style="margin-top:10px"><tbody>
          <tr><td style="color:var(--text-secondary)">Account</td><td>${status.account || "-"}</td></tr>
          <tr><td style="color:var(--text-secondary)">Zone</td><td>${status.zone || "-"}</td></tr>
          <tr><td style="color:var(--text-secondary)">Status</td><td>${statusPill(status.status === "connected" ? "ACTIVE" : "DISABLED")}</td></tr>
          <tr><td style="color:var(--text-secondary)">Last Checked</td><td>${fmtDate(status.lastChecked)}</td></tr>
        </tbody></table>
        <div style="display:flex;gap:8px;margin-top:16px">
          <button class="btn btn-secondary" id="testBtn">Test Connection</button>
          <button class="btn btn-danger" id="disconnectBtn">Disconnect</button>
        </div>
      ` : `
        ${status.oauthEnabled ? `<button class="btn btn-primary" id="oauthBtn" style="margin-bottom:14px">اتصال با Cloudflare OAuth</button><p style="text-align:center;color:var(--text-muted);font-size:12px">یا</p>` : ""}
        <form id="cfForm">
          <div class="field"><label>Cloudflare API Token</label><input name="apiToken" type="password" required placeholder="API Token با دسترسی حداقلی"></div>
          <div class="note" style="margin-bottom:12px">Token شما هرگز در Frontend یا لاگ ذخیره نمی‌شود و فقط به‌صورت رمزنگاری‌شده در سرور نگه‌داری می‌شود.</div>
          <button class="btn btn-primary" type="submit">اتصال امن</button>
        </form>
      `}
    </div>
  `);
  if (status.connected) {
    document.getElementById("testBtn").addEventListener("click", async () => {
      try { const r = await API.post("/api/cloudflare/test"); toast(r.ok ? "اتصال سالم است" : "اتصال ناموفق است", !r.ok); } catch (err) { toast(err.message, true); }
    });
    document.getElementById("disconnectBtn").addEventListener("click", async () => {
      if (!confirm("اتصال Cloudflare قطع شود؟")) return;
      await API.del("/api/cloudflare/disconnect"); renderCloudflare();
    });
  } else {
    const oauthBtn = document.getElementById("oauthBtn");
    if (oauthBtn) oauthBtn.addEventListener("click", async () => {
      try { const r = await API.get("/api/cloudflare/oauth/start"); window.location.href = r.authorizeUrl; } catch (err) { toast(err.message, true); }
    });
    document.getElementById("cfForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        await API.post("/api/cloudflare/connect", { apiToken: fd.get("apiToken") });
        toast("Cloudflare متصل شد"); renderCloudflare();
      } catch (err) { toast(err.message, true); }
    });
  }
}

/* ---------------- Settings / Security / Support ---------------- */
function renderSettings() {
  setContent(`
    <h1 class="page-title">Settings</h1>
    <p class="page-sub">تنظیمات حساب کاربری</p>
    <div class="card" style="max-width:480px">
      <div class="field"><label>ایمیل</label><input value="${ME.email}" disabled></div>
      <div class="field"><label>نام</label><input value="${ME.name || ""}" disabled></div>
      <p style="color:var(--text-muted);font-size:12px">ویرایش پروفایل در نسخه‌های بعدی اضافه می‌شود.</p>
    </div>
  `);
}

async function renderSecurity() {
  setContent(`<div class="empty-state">در حال بارگذاری...</div>`);
  const { logs } = await API.get("/api/statistics/recent-activity").catch(() => ({ logs: [] }));
  setContent(`
    <h1 class="page-title">Security</h1>
    <p class="page-sub">گزارش رویدادهای امنیتی (Audit Log)</p>
    <div class="card">
      <div class="table-wrap"><table><thead><tr><th>Action</th><th>IP</th><th>Time</th></tr></thead><tbody>
      ${logs.length ? logs.map((l) => `<tr><td>${l.action}</td><td>${l.ip || "-"}</td><td>${fmtDate(l.createdAt)}</td></tr>`).join("") : `<tr><td colspan="3"><div class="empty-state">رویدادی ثبت نشده است</div></td></tr>`}
      </tbody></table></div>
    </div>
  `);
}

function renderSupport() {
  setContent(`
    <h1 class="page-title">Support</h1>
    <p class="page-sub">پشتیبانی Config Cloud Panel</p>
    <div class="card" style="max-width:480px">
      <p>برای پشتیبانی می‌توانید با تیم فنی مرتبط شوید. آدرس تماس پشتیبانی توسط ادمین سیستم تعیین می‌شود.</p>
    </div>
  `);
}

boot();
