const API = {
  async req(method, path, body) {
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    let data = null;
    try { data = await resp.json(); } catch { data = null; }
    if (!resp.ok) {
      const err = new Error((data && data.error) || "خطای ناشناخته رخ داد");
      err.status = resp.status;
      throw err;
    }
    return data;
  },
  get(path) { return this.req("GET", path); },
  post(path, body) { return this.req("POST", path, body); },
  patch(path, body) { return this.req("PATCH", path, body); },
  del(path) { return this.req("DELETE", path); },
};

function fmtBytes(bytesStr) {
  if (bytesStr === null || bytesStr === undefined) return "نامحدود";
  let bytes = Number(bytesStr);
  if (Number.isNaN(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(bytes < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

function fmtDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  return date.toLocaleDateString("fa-IR") + " " + date.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
}

function statusPill(status) {
  const map = { ACTIVE: ["pill-active", "Active"], DISABLED: ["pill-disabled", "Disabled"], EXPIRED: ["pill-expired", "Expired"] };
  const [cls, label] = map[status] || ["pill-disabled", status];
  return `<span class="pill ${cls}">${label}</span>`;
}

function toast(msg, isError) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:100;padding:11px 18px;border-radius:9px;font-size:13px;box-shadow:0 6px 24px rgba(0,0,0,.4);transition:opacity .2s;";
    document.body.appendChild(el);
  }
  el.style.background = isError ? "#f87171" : "#22d3ee";
  el.style.color = "#041018";
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2600);
}
