const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireWorkspace } = require("../middleware/workspace");
const { logAudit } = require("../lib/audit");

const router = express.Router();
router.use(requireAuth, requireWorkspace);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  trafficLimitGb: z.union([z.coerce.number().positive(), z.literal("unlimited")]).optional(),
  expirationDays: z.union([z.coerce.number().positive(), z.literal("never")]).optional(),
});

router.get("/", async (req, res) => {
  const users = await prisma.configUser.findMany({
    where: { workspaceId: req.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ users: users.map(serializeUser) });
});

router.post("/", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ورودی نامعتبر است" });
  const data = parsed.data;

  const expiresAt =
    data.expirationDays && data.expirationDays !== "never"
      ? new Date(Date.now() + Number(data.expirationDays) * 86400000)
      : null;
  const trafficLimitBytes =
    data.trafficLimitGb && data.trafficLimitGb !== "unlimited"
      ? BigInt(Math.round(Number(data.trafficLimitGb) * 1024 * 1024 * 1024))
      : null;

  const user = await prisma.configUser.create({
    data: { workspaceId: req.workspaceId, name: data.name, expiresAt, trafficLimitBytes },
  });
  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "User Created", metadata: { configUserId: user.id }, ip: req.ip });
  res.status(201).json({ user: serializeUser(user) });
});

router.patch("/:id", async (req, res) => {
  const existing = await prisma.configUser.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "User یافت نشد" });

  const updateSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ورودی نامعتبر است" });

  const user = await prisma.configUser.update({ where: { id: existing.id }, data: parsed.data });
  res.json({ user: serializeUser(user) });
});

router.post("/:id/reset-traffic", async (req, res) => {
  const existing = await prisma.configUser.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "User یافت نشد" });

  const user = await prisma.configUser.update({ where: { id: existing.id }, data: { trafficUsedBytes: 0n } });
  res.json({ user: serializeUser(user) });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.configUser.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "User یافت نشد" });

  await prisma.configUser.delete({ where: { id: existing.id } });
  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "User Deleted", metadata: { configUserId: existing.id }, ip: req.ip });
  res.json({ ok: true });
});

function serializeUser(u) {
  return {
    id: u.id,
    name: u.name,
    status: u.status,
    trafficLimitBytes: u.trafficLimitBytes ? u.trafficLimitBytes.toString() : null,
    trafficUsedBytes: u.trafficUsedBytes.toString(),
    expiresAt: u.expiresAt,
    createdAt: u.createdAt,
    lastSeen: u.lastSeen,
  };
}

module.exports = router;
