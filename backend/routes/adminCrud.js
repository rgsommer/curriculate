import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import AccessCode from "../models/AccessCode.js";
import SystemEmailTemplate from "../models/SystemEmailTemplate.js";
import ReferralProgramSettings from "../models/ReferralProgramSettings.js";
import SharedTasksetLink from "../models/SharedTasksetLink.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";

const router = express.Router();

// Admin check middleware
const adminCheck = (req, res, next) => {
  const u = req.user || {};
  const roles = Array.isArray(u.roles) ? u.roles : [];
  const ok = u.isAdmin === true || u.role === "admin" || u.userType === "admin" || roles.includes("admin");
  if (!ok) return res.status(403).json({ ok: false, error: "Admin only." });
  next();
};

const adminRequired = [authRequired, adminCheck];

// ============================================================
// Admin: Access Codes (create + list)
// ============================================================
function genAccessCode(len = 8) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no I/O/1/0 confusion
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// GET /api/admin/access-codes
router.get("/access-codes", ...adminRequired, async (req, res) => {
  try {
    const rows = await AccessCode.find({})
      .sort({ createdAt: -1 })
      .lean();

    const codes = (rows || []).map((c) => ({
      _id: String(c._id),
      code: String(c.code || ""),
      planTier: String(c.planTier || "FREE"),
      maxSeats: Number(c.maxSeats || 1),
      disabled: !!c.disabled,
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : null,
      claimantsCount: Array.isArray(c.claimants) ? c.claimants.length : 0,
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    }));

    return res.json({ ok: true, codes });
  } catch (err) {
    console.error("[admin-access-codes] list failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load access codes." });
  }
});

// POST /api/admin/access-codes
router.post("/access-codes", ...adminRequired, async (req, res) => {
  try {
    const planTier = String(req.body?.planTier || "FREE").toUpperCase().trim();
    const maxSeats = Math.max(1, Number(req.body?.maxSeats ?? req.body?.seats ?? 1));

    const expiresRaw = req.body?.expiresAt ?? req.body?.expires ?? null;
    let expiresAt = null;
    if (expiresRaw) {
      const d = new Date(expiresRaw);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }

    // generate unique code
    let code = genAccessCode(8);
    for (let i = 0; i < 5; i += 1) {
      const exists = await AccessCode.findOne({ code }).lean();
      if (!exists) break;
      code = genAccessCode(8);
    }

    const doc = await AccessCode.create({
      code,
      planTier,
      maxSeats,
      expiresAt,
      disabled: false,
      claimants: [],
    });

    return res.json({
      ok: true,
      accessCode: {
        _id: String(doc._id),
        code: doc.code,
        planTier: doc.planTier,
        maxSeats: doc.maxSeats,
        expiresAt: doc.expiresAt ? new Date(doc.expiresAt).toISOString().slice(0, 10) : null,
      },
    });
  } catch (err) {
    console.error("[admin-access-codes] create failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to create access code." });
  }
});

// DELETE /api/admin/access-codes/:id
router.delete("/access-codes/:id", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing code id." });

    const doc = await AccessCode.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Access code not found." });

    // Prevent deleting codes that have already been claimed
    const claimants = Array.isArray(doc.claimants) ? doc.claimants : [];
    if (claimants.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `Cannot delete: code has been claimed by ${claimants.length} user(s). Revoke/disable it instead.`,
      });
    }

    await AccessCode.deleteOne({ _id: id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin-access-codes] delete failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete access code." });
  }
});

// POST /api/admin/access-codes/:id/send
// Send an access code to an email address using the "access-code-invite" template.
router.post("/access-codes/:id/send", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const toEmail = String(req.body?.toEmail || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing code id." });
    if (!toEmail) return res.status(400).json({ ok: false, error: "Missing toEmail." });

    const doc = await AccessCode.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Access code not found." });

    const senderName =
      String(req.user?.name || req.user?.fullName || req.user?.displayName || "").trim() ||
      "Curriculate Admin";

    // Load the editable template (upsert default if missing)
    let template = await SystemEmailTemplate.findOne({ key: "access-code-invite" }).lean();
    if (!template) {
      template = await SystemEmailTemplate.create({
        key: "access-code-invite",
        label: "Access code invite",
        subject: "Your Curriculate access code from {{SENDER_NAME}}",
        html: DEFAULT_ACCESS_CODE_HTML,
        enabled: true,
      });
    }

    const signupUrl = process.env.TEACHER_APP_ORIGIN
      ? `${process.env.TEACHER_APP_ORIGIN}/signup`
      : "https://set.curriculate.net/signup";

    const vars = {
      SENDER_NAME: senderName,
      ACCESS_CODE: doc.code,
      PLAN_TIER: doc.planTier || "FREE",
      SIGNUP_URL: signupUrl,
      CUSTOM_MESSAGE: req.body?.message
        ? String(req.body.message).replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : "",
    };

    const subject = _render(template.subject || "", vars);
    const html = _render(template.html || "", vars);

    await sendSystemEmail({ to: toEmail, subject, html });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin-access-codes] send failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to send email: " + (err?.message || err) });
  }
});

function _render(str, vars) {
  let out = String(str || "");
  for (const [k, v] of Object.entries(vars || {})) {
    out = out.replaceAll(`{{${k}}}`, String(v ?? ""));
  }
  return out;
}

const DEFAULT_ACCESS_CODE_HTML = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e293b;margin-bottom:12px;">You've been invited to Curriculate!</h2>
  <p style="color:#334155;">{{SENDER_NAME}} has given you a <strong>{{PLAN_TIER}}</strong> access code to get started.</p>
  <div style="background:#f0f9ff;border:2px dashed #0ea5e9;border-radius:12px;padding:16px;text-align:center;margin:20px 0;">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Access Code</div>
    <div style="font-size:28px;font-weight:900;letter-spacing:3px;color:#0369a1;">{{ACCESS_CODE}}</div>
  </div>
  <p style="color:#334155;">Use this code when you sign up:</p>
  <div style="text-align:center;margin:20px 0;">
    <a href="{{SIGNUP_URL}}" style="display:inline-block;background:linear-gradient(135deg,#0ea5e9,#6366f1);color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">Sign Up Now</a>
  </div>
  {{CUSTOM_MESSAGE}}
  <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Curriculate — AI-Powered Station-Based Learning</p>
</div>
`.trim();

// ============================================================
// Admin: Email templates (get + update)
// ============================================================

// GET /api/admin/email-templates
router.get("/email-templates", ...adminRequired, async (req, res) => {
  try {
    const all = await SystemEmailTemplate.find({}).sort({ key: 1 }).lean();
    res.json({ ok: true, templates: all });
  } catch (err) {
    console.error("[admin-email-templates] get failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load templates." });
  }
});

// PUT /api/admin/email-templates/:key
router.put("/email-templates/:key", ...adminRequired, async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, error: "Missing key." });

    const patch = {
      subject: String(req.body?.subject || ""),
      html: String(req.body?.html || ""),
      enabled: req.body?.enabled !== false,
    };

    if (req.body?.followupDays != null) {
      patch.followupDays = Number(req.body.followupDays);
    }

    const updated = await SystemEmailTemplate.findOneAndUpdate(
      { key },
      { $set: patch },
      { new: true, upsert: true }
    ).lean();

    res.json({ ok: true, template: updated });
  } catch (err) {
    console.error("[admin-email-templates] save failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save template." });
  }
});

// ============================================================
// Admin: Referral program settings
// ============================================================

// GET /api/admin/referral-settings
router.get("/referral-settings", ...adminRequired, async (req, res) => {
  try {
    const s = await ReferralProgramSettings.findOne({ key: "default" }).lean();
    res.json({ ok: true, settings: s || { key: "default", enabled: true, threshold: 5, rewardMonths: 1 } });
  } catch (err) {
    console.error("[admin-referral-settings] get failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load referral settings." });
  }
});

// PUT /api/admin/referral-settings
router.put("/referral-settings", ...adminRequired, async (req, res) => {
  try {
    const enabled = req.body?.enabled !== false;
    const threshold = Math.max(1, Number(req.body?.threshold || 5));
    const rewardMonths = Math.max(0, Number(req.body?.rewardMonths || 1));

    const updated = await ReferralProgramSettings.findOneAndUpdate(
      { key: "default" },
      { $set: { enabled, threshold, rewardMonths } },
      { new: true, upsert: true }
    ).lean();

    res.json({ ok: true, settings: updated });
  } catch (err) {
    console.error("[admin-referral-settings] save failed:", err);
    res.status(500).json({ ok: false, error: "Failed to save referral settings." });
  }
});

// ============================================================
// Admin: Email metrics
// ============================================================

// GET /api/admin/email-metrics
router.get("/email-metrics", ...adminRequired, async (req, res) => {
  try {
    const shareLinks = await SharedTasksetLink.countDocuments({});
    const invitesAgg = await SharedTasksetLink.aggregate([
      { $unwind: { path: "$invites", preserveNullAndEmptyArrays: false } },
      {
        $group: {
          _id: null,
          invites: { $sum: 1 },
          followup7: { $sum: { $cond: [{ $ifNull: ["$invites.followup7SentAt", false] }, 1, 0] } },
          followup30: { $sum: { $cond: [{ $ifNull: ["$invites.followup30SentAt", false] }, 1, 0] } },
          used: { $sum: { $cond: [{ $ifNull: ["$invites.firstUsedAt", false] }, 1, 0] } },
          rewardEmails: { $sum: { $cond: [{ $ifNull: ["$invites.rewardSentAt", false] }, 1, 0] } },
        },
      },
    ]);

    const row = invitesAgg?.[0] || {};
    res.json({
      ok: true,
      counts: {
        shareLinks,
        invites: row.invites || 0,
        followup7: row.followup7 || 0,
        followup30: row.followup30 || 0,
        invitesUsed: row.used || 0,
        rewardEmails: row.rewardEmails || 0,
      },
    });
  } catch (err) {
    console.error("[admin-email-metrics] failed:", err);
    res.status(500).json({ ok: false, error: "Failed to load metrics." });
  }
});

export default router;
