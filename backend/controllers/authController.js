// controllers/authController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

function signToken(user) {
  return jwt.sign(
    {
      userId: user._id,
      subscriptionTier: user.subscriptionTier || "FREE",
    },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "7d" }
  );
}

async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  const user = await User.findOne({ email }).exec();
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken(user);

  return res.json({
    token,
    user: {
      id: user._id,
      email: user.email,
      name: user.name,
      subscriptionTier: user.subscriptionTier || "FREE",
    },
  });
}

async function me(req, res) {
  const user = await User.findById(req.user._id).lean();
  if (!user) return res.status(404).json({ error: "User not found" });

  return res.json({
    id: user._id,
    email: user.email,
    name: user.name,
    subscriptionTier: user.subscriptionTier || "FREE",
  });
}

module.exports = { login, me };
