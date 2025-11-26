// backend/middleware/requireAuth.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

/**
 * Authentication middleware for protected API routes.
 *
 * Expects a JWT either in:
 *   - Authorization: Bearer <token>
 *   - (optionally later) req.cookies.token
 *
 * On success, attaches:
 *   req.user = {
 *     id,
 *     email,
 *     name,
 *     subscriptionTier,
 *     plan,
 *   }
 */
export async function authRequired(req, res, next) {
  // 1) Try Authorization header
  const authHeader = req.headers.authorization || "";
  let token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

  // 2) (Optional) cookie support later:
  // if (!token && req.cookies && req.cookies.token) {
  //   token = req.cookies.token;
  // }

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    // MUST match backend/routes/auth.js
    const secret = process.env.JWT_SECRET || "devsecret";

    const payload = jwt.verify(token, secret);

    // auth.js signs { id, role, plan }
    const userId = payload.id;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      subscriptionTier: user.subscriptionTier || "FREE",
      plan: user.plan || payload.plan || { tier: (user.subscriptionTier || "FREE").toLowerCase() },
    };

    return next();
  } catch (err) {
    console.error("requireAuth error:", err);
    return res.status(401).json({ error: "Invalid token" });
  }
}

export default authRequired;
