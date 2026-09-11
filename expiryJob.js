const cron = require("node-cron");
const prisma = require("../db");

async function enforceExpiryAndTraffic() {
  const now = new Date();

  // انقضای Config
  await prisma.config.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });

  // انقضای ConfigUser
  await prisma.configUser.updateMany({
    where: { status: "ACTIVE", expiresAt: { lt: now } },
    data: { status: "DISABLED" },
  });

  // غیرفعال‌سازی خودکار بر اساس محدودیت ترافیک (Config)
  const overLimitConfigs = await prisma.$queryRaw`
    SELECT id FROM "Config"
    WHERE status = 'ACTIVE'
      AND "trafficLimitBytes" IS NOT NULL
      AND "trafficUsedBytes" >= "trafficLimitBytes"
  `;
  if (overLimitConfigs.length) {
    await prisma.config.updateMany({
      where: { id: { in: overLimitConfigs.map((c) => c.id) } },
      data: { status: "DISABLED" },
    });
  }

  const overLimitUsers = await prisma.$queryRaw`
    SELECT id FROM "ConfigUser"
    WHERE status = 'ACTIVE'
      AND "trafficLimitBytes" IS NOT NULL
      AND "trafficUsedBytes" >= "trafficLimitBytes"
  `;
  if (overLimitUsers.length) {
    await prisma.configUser.updateMany({
      where: { id: { in: overLimitUsers.map((u) => u.id) } },
      data: { status: "DISABLED" },
    });
  }
}

function startExpiryJob() {
  // هر 5 دقیقه اجرا می‌شود
  cron.schedule("*/5 * * * *", () => {
    enforceExpiryAndTraffic().catch((err) => console.error("[expiryJob] error:", err.message));
  });
  // یک بار هم در لحظه‌ی start اجرا شود
  enforceExpiryAndTraffic().catch((err) => console.error("[expiryJob] initial run error:", err.message));
}

module.exports = { startExpiryJob, enforceExpiryAndTraffic };
