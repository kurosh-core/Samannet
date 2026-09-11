// این میان‌افزار تضمین می‌کند هر Request فقط به Workspace خودِ کاربر دسترسی دارد.
// جلوگیری از IDOR: تمام Query‌ها باید workspaceId را از req.workspaceId بگیرند،
// نه از پارامتر ورودی کاربر.
async function requireWorkspace(req, res, next) {
  if (!req.user || !req.user.workspaceId) {
    return res.status(403).json({ error: "این کاربر به هیچ Workspace متصل نیست" });
  }
  req.workspaceId = req.user.workspaceId;
  next();
}

module.exports = { requireWorkspace };
