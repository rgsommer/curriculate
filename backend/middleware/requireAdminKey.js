// backend/middleware/requireAdminKey.js

export function requireAdminKey(req, res, next) {
  const expected = process.env.ADMIN_KEY;

  if (!expected) {
    return res.status(500).json({ error: "Missing ADMIN_KEY on server" });
  }

  const provided = req.get("x-admin-key");

  if (provided && provided === expected) {
    return next();
  }

  return res.status(401).json({ error: "Unauthorized" });
}