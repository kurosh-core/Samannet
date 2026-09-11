const express = require("express");
const prisma = require("../db");
const { requireAuth } = require("../middleware/auth");
const { requireWorkspace } = require("../middleware/workspace");

const router = express.Router();
router.use(requireAuth, requireWorkspace);

router.get("/", async (req, res) => {
  const [totalConfigs, activeConfigs, expiredConfigs, totalUsers, activeUsers, configs] = await Promise.all([
    prisma.config.count({ where: { workspaceId: req.workspaceId } }),
    prisma.config.count({ where: { workspaceId: req.workspaceId, status: "ACTIVE" } }),
    prisma.config.count({ where: { workspaceId: req.workspaceId, status: "EXPIRED" } }),
    prisma.configUser.count({ where: { workspaceId: req.workspaceId } }),
    prisma.configUser.count({ where: { workspaceId: req.workspaceId, status: "ACTIVE" } }),
    prisma.config.findMany({ where: { workspaceId: req.workspaceId }, select: { trafficUsedBytes: true, trafficLimitBytes: true } }),
  ]);

  let usedTraffic = 0n;
  let totalTrafficLimit = 0n;
  let unlimited = false;
  for (const c of configs) {
    usedTraffic += c.trafficUsedBytes;
    if (c.trafficLimitBytes === null) unlimited = true;
    else totalTrafficLimit += c.trafficLimitBytes;
  }

  res.json({
    totalConfigs,
    activeConfigs,
    expiredConfigs,
    totalUsers,
    activeUsers,
    usedTrafficBytes: usedTraffic.toString(),
    totalTrafficBytes: unlimited ? null : totalTrafficLimit.toString(),
    remainingTrafficBytes: unlimited ? null : (totalTrafficLimit - usedTraffic > 0n ? (totalTrafficLimit - usedTraffic).toString() : "0"),
  });
});

router.get("/traffic", async (req, res) => {
  const range = req.query.range || "7d";
  const days = range === "today" ? 1 : range === "30d" ? 30 : range === "all" ? 365 : 7;
  const since = new Date(Date.now() - days * 86400000);

  const rows = await prisma.trafficUsage.findMany({
    where: { workspaceId: req.workspaceId, recordedAt: { gte: since } },
    orderBy: { recordedAt: "asc" },
  });

  res.json({
    points: rows.map((r) => ({
      date: r.recordedAt,
      upload: r.uploadBytes.toString(),
      download: r.downloadBytes.toString(),
    })),
  });
});

router.get("/recent-activity", async (req, res) => {
  const logs = await prisma.auditLog.findMany({
    where: { workspaceId: req.workspaceId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  res.json({ logs });
});

module.exports = router;
