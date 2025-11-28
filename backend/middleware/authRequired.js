// backend/middleware/authRequired.js

import jwt from "jsonwebtoken";

export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;

  // ← DEV BYPASS — allow dummy token
  if (authHeader === "Bearer dev-token") {
    req.user = { _id: "dev-user-123", email: "dev@curriculate.net" }; // fake user
    return next();
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}