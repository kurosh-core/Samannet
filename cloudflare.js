const express = require("express");
const crypto = require("crypto");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireWorkspace } = require("../middleware/workspace");
const { encryptSecret, decryptSecret } = require("../lib/crypto");
const { logAudit } = require("../lib/audit");
const { cloudflareLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(requireAuth, requireWorkspace);

const CF_API = "https://api.cloudflare.com/client/v4";
const OAUTH_ENABLED = Boolean(process.env.CLOUDFLARE_CLIENT_ID && process.env.CLOUDFLARE_CLIENT_SECRET);

// حافظه‌ی موقت state برای CSRF در فرآیند OAuth (در تولید واقعی: Redis/DB با TTL)
const oauthStates = new Map();

router.get("/status", async (req, res) => {
  const conn = await prisma.cloudflareConnection.findUnique({ where: { workspaceId: req.workspaceId } });
  if (!conn) return res.json({ connected: false, oauthEnabled: OAUTH_ENABLED });

  res.json({
    connected: true,
    oauthEnabled: OAUTH_ENABLED,
    account: conn.accountName || conn.accountId,
    zone: conn.zoneName || conn.zoneId,
    status: conn.status,
    lastChecked: conn.lastChecked,
  });
  // توجه: encryptedToken هرگز در پاسخ قرار نمی‌گیرد
});

// --- روش 1: Cloudflare OAuth (در صورت وجود Client ID/Secret) ---
router.get("/oauth/start", cloudflareLimiter, (req, res) => {
  if (!OAUTH_ENABLED) {
    return res.status(400).json({ error: "OAuth در این محیط پیکربندی نشده - از اتصال با API Token استفاده کنید" });
  }
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, { workspaceId: req.workspaceId, expires: Date.now() + 10 * 60 * 1000 });

  const redirectUri = `${process.env.APP_URL}/api/cloudflare/oauth/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.CLOUDFLARE_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "account:read zone:read", // Least Privilege
    state,
  });
  res.json({ authorizeUrl: `https://dash.cloudflare.com/oauth2/auth?${params.toString()}` });
});

router.get("/oauth/callback", cloudflareLimiter, async (req, res) => {
  try {
    const { code, state } = req.query;
    const record = oauthStates.get(state);
    if (!record || record.expires < Date.now()) {
      return res.status(400).send("درخواست OAuth نامعتبر یا منقضی شده است");
    }
    oauthStates.delete(state);

    const redirectUri = `${process.env.APP_URL}/api/cloudflare/oauth/callback`;
    const tokenResp = await fetch("https://dash.cloudflare.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: process.env.CLOUDFLARE_CLIENT_ID,
        client_secret: process.env.CLOUDFLARE_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenResp.json();
    if (!tokenResp.ok || !tokenData.access_token) {
      return res.status(400).send("اتصال به Cloudflare ناموفق بود");
    }

    await saveConnection(record.workspaceId, tokenData.access_token);
    res.redirect("/dashboard/cloudflare?connected=1");
  } catch (err) {
    console.error("[cloudflare] oauth callback error:", err.message);
    res.status(500).send("خطا در برقراری اتصال");
  }
});

// --- روش 2: اتصال امن با API Token از سمت Backend (Fallback) ---
const tokenSchema = z.object({ apiToken: z.string().min(20) });

router.post("/connect", cloudflareLimiter, async (req, res) => {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "API Token نامعتبر است" });

  try {
    await saveConnection(req.workspaceId, parsed.data.apiToken);
    await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Cloudflare Connected", ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    // پیام خطا هرگز شامل مقدار توکن یا جزئیات داخلی نیست
    res.status(400).json({ error: "اعتبارسنجی Token با Cloudflare ناموفق بود" });
  }
});

router.post("/test", cloudflareLimiter, async (req, res) => {
  const conn = await prisma.cloudflareConnection.findUnique({ where: { workspaceId: req.workspaceId } });
  if (!conn) return res.status(404).json({ error: "اتصالی یافت نشد" });

  const token = decryptSecret(conn.encryptedToken);
  const result = await verifyToken(token);
  await prisma.cloudflareConnection.update({
    where: { workspaceId: req.workspaceId },
    data: { status: result.ok ? "connected" : "error", lastChecked: new Date() },
  });
  res.json({ ok: result.ok });
});

router.delete("/disconnect", async (req, res) => {
  await prisma.cloudflareConnection.deleteMany({ where: { workspaceId: req.workspaceId } });
  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Cloudflare Disconnected", ip: req.ip });
  res.json({ ok: true });
});

async function verifyToken(token) {
  const resp = await fetch(`${CF_API}/user/tokens/verify`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  return { ok: resp.ok && data.success === true };
}

async function saveConnection(workspaceId, token) {
  const verify = await verifyToken(token);
  if (!verify.ok) throw new Error("Cloudflare token verification failed");

  const accountsResp = await fetch(`${CF_API}/accounts`, { headers: { Authorization: `Bearer ${token}` } });
  const accountsData = await accountsResp.json();
  const account = accountsData.result?.[0];

  const zonesResp = await fetch(`${CF_API}/zones`, { headers: { Authorization: `Bearer ${token}` } });
  const zonesData = await zonesResp.json();
  const zone = zonesData.result?.[0];

  const encryptedToken = encryptSecret(token); // Secret فقط رمزنگاری‌شده ذخیره می‌شود

  await prisma.cloudflareConnection.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      accountId: account?.id || "unknown",
      accountName: account?.name || null,
      zoneId: zone?.id || null,
      zoneName: zone?.name || null,
      encryptedToken,
      status: "connected",
      lastChecked: new Date(),
    },
    update: {
      accountId: account?.id || "unknown",
      accountName: account?.name || null,
      zoneId: zone?.id || null,
      zoneName: zone?.name || null,
      encryptedToken,
      status: "connected",
      lastChecked: new Date(),
    },
  });
}

module.exports = router;
