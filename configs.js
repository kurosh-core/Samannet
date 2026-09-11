const express = require("express");
const { z } = require("zod");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireWorkspace } = require("../middleware/workspace");
const { getAdapter, listProtocols } = require("../protocols");
const { logAudit } = require("../lib/audit");

const router = express.Router();
router.use(requireAuth, requireWorkspace);

const PROTOCOLS = ["VLESS", "VMESS", "TROJAN", "SHADOWSOCKS", "SOCKS5", "HTTP", "WIREGUARD"];

const configSchema = z.object({
  name: z.string().min(1).max(80),
  protocol: z.enum(PROTOCOLS),
  server: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  description: z.string().max(500).optional(),
  trafficLimitGb: z.union([z.coerce.number().positive(), z.literal("unlimited")]).optional(),
  expirationDays: z.union([z.coerce.number().positive(), z.literal("never")]).optional(),
  maxUsers: z.coerce.number().int().positive().optional(),
  settings: z.record(z.any()).default({}),
});

router.get("/protocols", (req, res) => {
  res.json({ protocols: listProtocols() });
});

router.get("/", async (req, res) => {
  const configs = await prisma.config.findMany({
    where: { workspaceId: req.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json({ configs: configs.map(serializeConfig) });
});

router.get("/:id", async (req, res) => {
  const config = await prisma.config.findFirst({
    where: { id: req.params.id, workspaceId: req.workspaceId }, // مالکیت همیشه چک می‌شود
  });
  if (!config) return res.status(404).json({ error: "Config یافت نشد" });
  res.json({ config: serializeConfig(config) });
});

router.post("/", async (req, res) => {
  const parsed = configSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || "ورودی نامعتبر است" });
  }
  const data = parsed.data;

  if (!["VLESS", "VMESS", "TROJAN", "SHADOWSOCKS", "WIREGUARD"].includes(data.protocol)) {
    return res.status(400).json({ error: "این پروتکل هنوز Generator اختصاصی ندارد" });
  }

  const Adapter = getAdapter(data.protocol);
  const validation = Adapter.validate({ ...data.settings, server: data.server, port: data.port });
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join(" / ") });
  }
  const settings = Adapter.generate({ ...data.settings, server: data.server, port: data.port });

  const expiresAt =
    data.expirationDays && data.expirationDays !== "never"
      ? new Date(Date.now() + Number(data.expirationDays) * 86400000)
      : null;
  const trafficLimitBytes =
    data.trafficLimitGb && data.trafficLimitGb !== "unlimited"
      ? BigInt(Math.round(Number(data.trafficLimitGb) * 1024 * 1024 * 1024))
      : null;

  const config = await prisma.config.create({
    data: {
      workspaceId: req.workspaceId,
      name: data.name,
      protocol: data.protocol,
      server: data.server,
      port: data.port,
      settings,
      description: data.description || null,
      expiresAt,
      trafficLimitBytes,
      maxUsers: data.maxUsers || null,
    },
  });

  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Config Created", metadata: { configId: config.id, protocol: config.protocol }, ip: req.ip });
  res.status(201).json({ config: serializeConfig(config) });
});

router.patch("/:id", async (req, res) => {
  const existing = await prisma.config.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Config یافت نشد" });

  const updateSchema = z.object({
    name: z.string().min(1).max(80).optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
    description: z.string().max(500).optional(),
  });
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "ورودی نامعتبر است" });

  const config = await prisma.config.update({
    where: { id: existing.id },
    data: parsed.data,
  });

  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Config Updated", metadata: { configId: config.id }, ip: req.ip });
  res.json({ config: serializeConfig(config) });
});

router.delete("/:id", async (req, res) => {
  const existing = await prisma.config.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Config یافت نشد" });

  await prisma.config.delete({ where: { id: existing.id } });
  await logAudit({ workspaceId: req.workspaceId, userId: req.user.id, action: "Config Deleted", metadata: { configId: existing.id }, ip: req.ip });
  res.json({ ok: true });
});

router.post("/:id/duplicate", async (req, res) => {
  const existing = await prisma.config.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!existing) return res.status(404).json({ error: "Config یافت نشد" });

  const copy = await prisma.config.create({
    data: {
      workspaceId: req.workspaceId,
      name: `${existing.name} (Copy)`,
      protocol: existing.protocol,
      server: existing.server,
      port: existing.port,
      settings: existing.settings,
      description: existing.description,
      trafficLimitBytes: existing.trafficLimitBytes,
      maxUsers: existing.maxUsers,
      expiresAt: existing.expiresAt,
    },
  });
  res.status(201).json({ config: serializeConfig(copy) });
});

// خروجی URI/Link قابل Import برای این Config
router.get("/:id/link", async (req, res) => {
  const config = await prisma.config.findFirst({ where: { id: req.params.id, workspaceId: req.workspaceId } });
  if (!config) return res.status(404).json({ error: "Config یافت نشد" });

  const Adapter = getAdapter(config.protocol);
  const link = Adapter.parse(config);
  res.json({ link });
});

function serializeConfig(c) {
  return {
    id: c.id,
    name: c.name,
    protocol: c.protocol,
    server: c.server,
    port: c.port,
    status: c.status,
    description: c.description,
    trafficLimitBytes: c.trafficLimitBytes ? c.trafficLimitBytes.toString() : null,
    trafficUsedBytes: c.trafficUsedBytes.toString(),
    maxUsers: c.maxUsers,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
  };
}

module.exports = router;
