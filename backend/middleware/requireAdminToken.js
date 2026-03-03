// backend/middleware/requireAdminToken.js
// Middleware to require an admin token for feedback routes
export function requireAdminToken(req, res, next) {
  const token = req.get("x-admin-token");
  if (!token || token !== process.env.ADMIN_API_TOKEN) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  next();
}