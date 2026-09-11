const rateLimit = require("express-rate-limit");

function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || "تعداد درخواست‌ها بیش از حد مجاز است، کمی بعد دوباره تلاش کنید" },
  });
}

module.exports = {
  authLimiter: makeLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: "تلاش‌های ورود بیش از حد مجاز - لطفا بعدا تلاش کنید" }),
  cloudflareLimiter: makeLimiter({ windowMs: 10 * 60 * 1000, max: 15 }),
  subscriptionGenLimiter: makeLimiter({ windowMs: 10 * 60 * 1000, max: 30 }),
  adminLimiter: makeLimiter({ windowMs: 5 * 60 * 1000, max: 100 }),
  publicSubLimiter: makeLimiter({ windowMs: 5 * 60 * 1000, max: 60 }),
};
