const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireWorkspace } = require("../middleware/workspace");
const { randomToken } = require("../lib/crypto");
const { getAdapter } = require("../protocols");
const { logAudit } = require("../lib/audit");
const { subscriptionGenLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// ---- مسیرهای مدیریتی (نیازمند احراز هویت) ----
const authedRouter = express.Router();
authedRouter.use(requireAuth, requireWorkspace);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  configIds: z.array(z.string()).min(1),
});

authedRouter.get("/", async (req, res) => {
  const subs = await prisma.subscription.findMany({
    where: { workspaceId: req.workspaceId },
    include: { configs: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ subscriptions: subs.map(serializeSub) });
});

authedRouter.post("/", subscriptionGenLimiter, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ورودی نامعتبر است" });
  const { name, configIds } = parsed.data;

  // مالکیت همه‌ی configId ها روی همین workspace چک می‌شود - جلوگیری از IDOR
  const owned = await prisma.config.findMany({
    where: { id: { in: configIds }, workspaceId: req.workspaceId },
    select: { id: true },
  });
  if (owned.length !== configIds.length) {
    return res.status(400).json({ error: "برخی Configها یافت نشدند یا متعلق به این Workspace نیستند" });
  }

  const sub = await prisma.subscription.create({
    data: {
      workspaceId: req.workspaceId,
      name,
      token: randomToken(24),
      configs: { create: configIds.map((configId) => ({ configId })) },
    },
    include: { configs: true },
  });

  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Subscription Created", metadata: { subscriptionId: sub.id }, ip: req.ip });
  res.status(201).json({ subscription: serializeSub(sub) });
});

authedRouter.post("/:id/regenerate", subscriptionGenLimiter, async (req, res) => {
  const existing = await prisma.subscription.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Subscription یافت نشد" });

  // توکن قبلی بلافاصله Invalid می‌شود چون با مقدار جدید جایگزین می‌شود
  const sub = await prisma.subscription.update({
    where: { id: existing.id },
    data: { token: randomToken(24) },
    include: { configs: true },
  });

  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Subscription Regenerated", metadata: { subscriptionId: sub.id }, ip: req.ip });
  res.json({ subscription: serializeSub(sub) });
});

authedRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.subscription.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Subscription یافت نشد" });

  const schema = z.object({ status: z.enum(["ACTIVE", "DISABLED"]).optional(), name: z.string().min(1).max(80).optional() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ورودی نامعتبر است" });

  const sub = await prisma.subscription.update({ where: { id: existing.id }, data: parsed.data, include: { configs: true } });
  res.json({ subscription: serializeSub(sub) });
});

authedRouter.delete("/:id", async (req, res) => {
  const existing = await prisma.subscription.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Subscription یافت نشد" });

  await prisma.subscription.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

function serializeSub(s) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    token: s.token,
    subscriptionUrl: `/sub/${s.token}`,
    configCount: s.configs?.length || 0,
    createdAt: s.createdAt,
  };
}

// ---- مسیر عمومی مصرف Subscription: /sub/{random-secure-id} ----
// این مسیر عمدا هیچ اطلاعات هویتی کاربر یا Workspace را افشا نمی‌کند.
const publicRouter = express.Router();

publicRouter.get("/sub/:token", async (req, res) => {
  const sub = await prisma.subscription.findUnique({
    where: { token: req.params.token },
    include: { configs: { include: { config: true } } },
  });

  if (!sub || sub.status !== "ACTIVE") {
    return res.status(404).type("text/plain").send("Not Found");
  }

  const activeConfigs = sub.configs
    .map((sc) => sc.config)
    .filter((c) => c && c.status === "ACTIVE" && c.workspaceId === sub.workspaceId);

  const lines = activeConfigs.map((c) => {
    try {
      const Adapter = getAdapter(c.protocol);
      return Adapter.parse(c);
    } catch {
      return null;
    }
  }).filter(Boolean);

  const body = Buffer.from(lines.join("\n"), "utf8").toString("base64");
  res.type("text/plain").send(body);
});

module.exports = { authedRouter, publicRouter };
