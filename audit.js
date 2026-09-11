const prisma = require("../db");

// هرگز password/token/private key را در metadata قرار ندهید
async function logAudit({ workspaceId = null, userId = null, action, metadata = {}, ip = null }) {
  try {
    await prisma.auditLog.create({
      data: { workspaceId, userId, action, metadata, ip },
    });
  } catch (err) {
    console.error("[audit] failed to write audit log:", err.message);
  }
}

module.exports = { logAudit };
