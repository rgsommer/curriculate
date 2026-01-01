// backend/middleware/authRequired.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  // TEMP DEV ONLY — remove before production launch
  if (authHeader === "Bearer dev-token" || authHeader === "Bearer dev-token123") {
    req.user = { _id: "dev-user-123", email: "dev@curriculate.net", isAdmin: true, roles: ["admin"] };
    req.userId = String(req.user._id);
    return next();
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId = String(payload?._id || payload?.userId || payload?.id || "").trim();
    if (!userId) {
      return res.status(401).json({ error: "Invalid token (missing user id)" });
    }
    req.userId = userId;

    // ✅ SERVER TRUTH
    const dbUser = await User.findById(userId).lean();
    if (!dbUser) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = dbUser;
    return next();
  } catch (err) {
    console.warn("Invalid token attempt:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}
