// backend/middleware/authRequired.js

import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  // TEMP DEV ONLY — remove before production launch
  if (authHeader === "Bearer dev-token" || authHeader === "Bearer dev-token123") {
    req.user = { _id: "dev-user-123", email: "dev@curriculate.net" };
    return next();
  }

  // Real production JWT check
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    console.warn("Invalid token attempt:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}