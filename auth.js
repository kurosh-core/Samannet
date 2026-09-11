const jwt = require("jsonwebtoken");
const prisma = require("../db");
const { sha256 } = require("../lib/crypto");

const COOKIE_NAME = "ccp_session";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 روز

function signSession(userId, sessionId) {
  return jwt.sign({ sub: userId, sid: sessionId }, process.env.SESSION_SECRET, {
    expiresIn: TOKEN_TTL_SECONDS,
  });
}

async function createSession(user, req) {
  const token = signSession(user.id, "pending");
  const decoded = jwt.decode(token);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      userAgent: req.headers["user-agent"] || null,
      ip: req.ip,
      expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000),
    },
  });
  return token;
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_TTL_SECONDS * 1000,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "احراز هویت لازم است" });

    let payload;
    try {
      payload = jwt.verify(token, process.env.SESSION_SECRET);
    } catch {
      clearSessionCookie(res);
      return res.status(401).json({ error: "نشست نامعتبر یا منقضی شده است" });
    }

    const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
    if (!session || session.expiresAt < new Date()) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "نشست منقضی شده است" });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== "ACTIVE") {
      clearSessionCookie(res);
      return res.status(401).json({ error: "کاربر یافت نشد یا غیرفعال است" });
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    console.error("[auth] error:", err.message);
    res.status(500).json({ error: "خطای داخلی سرور" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "دسترسی غیرمجاز" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  createSession,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
};
