// backend/middleware/requireAuth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export async function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    // NOTE: payload.userId vs payload.id – match whatever you sign in auth.js
    const userId = payload.userId || payload.id;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Attach user info to req for downstream routes
    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      subscriptionTier: user.subscriptionTier || "FREE",
      plan: user.plan, // if you add a plan object later
    };

    next();
  } catch (err) {
    console.error("requireAuth error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}
