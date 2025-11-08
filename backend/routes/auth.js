// backend/routes/auth.js
import express from "express";
import User from "../models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const router = express.Router();

router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;
  const existing = await User.findOne({ email });
  if (existing) return res.status(400).json({ error: "Email in use" });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ email, passwordHash, name });

  res.json({ ok: true, user: { id: user._id, email: user.email } });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: "Bad credentials" });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: "Bad credentials" });

  const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET || "devsecret");
  res.json({ token });
});

export default router;
