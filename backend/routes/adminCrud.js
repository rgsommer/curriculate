import express from "express";
import { authRequired } from "../middleware/authRequired.js";
import AccessCode from "../models/AccessCode.js";
import ReferralCode from "../models/ReferralCode.js";
import SystemEmailTemplate from "../models/SystemEmailTemplate.js";
import ReferralProgramSettings from "../models/ReferralProgramSettings.js";
import ReferralApplication from "../models/ReferralApplication.js";
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

// ============================================================
// Admin: Referral Codes (agent commissions)
// ============================================================

function genReferralCode(prefix = "REF", len = 6) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${out}`;
}

// GET /api/admin/referral-codes
router.get("/referral-codes", ...adminRequired, async (req, res) => {
  try {
    const rows = await ReferralCode.find({})
      .sort({ createdAt: -1 })
      .lean();

    const codes = (rows || []).map((c) => ({
      _id: String(c._id),
      code: c.code,
      agentName: c.agentName,
      agentEmail: c.agentEmail,
      commissionPercent: c.commissionPercent,
      commissionDurationMonths: c.commissionDurationMonths,
      customerDiscountPercent: c.customerDiscountPercent,
      disabled: !!c.disabled,
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString().slice(0, 10) : null,
      totalConversions: c.totalConversions || 0,
      totalRevenueCents: c.totalRevenueCents || 0,
      totalCommissionCents: c.totalCommissionCents || 0,
      totalPaidCents: c.totalPaidCents || 0,
      notes: c.notes || "",
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
    }));

    return res.json({ ok: true, codes });
  } catch (err) {
    console.error("[admin-referral-codes] list failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load referral codes." });
  }
});

// POST /api/admin/referral-codes
router.post("/referral-codes", ...adminRequired, async (req, res) => {
  try {
    const agentName = String(req.body?.agentName || "").trim();
    const agentEmail = String(req.body?.agentEmail || "").trim().toLowerCase();
    if (!agentName || !agentEmail) {
      return res.status(400).json({ ok: false, error: "Agent name and email are required." });
    }

    const commissionPercent = Math.min(100, Math.max(0, Number(req.body?.commissionPercent ?? 15)));
    const commissionDurationMonths = Math.max(0, Number(req.body?.commissionDurationMonths ?? 0));
    const customerDiscountPercent = Math.min(100, Math.max(0, Number(req.body?.customerDiscountPercent ?? 0)));
    const notes = String(req.body?.notes || "").trim();

    const expiresRaw = req.body?.expiresAt ?? null;
    let expiresAt = null;
    if (expiresRaw) {
      const d = new Date(expiresRaw);
      if (!Number.isNaN(d.getTime())) expiresAt = d;
    }

    // Allow custom code or auto-generate
    let code = String(req.body?.code || "").toUpperCase().trim();
    if (!code) {
      const prefix = agentName.split(/\s+/)[0].toUpperCase().slice(0, 6);
      code = genReferralCode(prefix);
    }

    // Ensure uniqueness
    for (let i = 0; i < 5; i++) {
      const exists = await ReferralCode.findOne({ code }).lean();
      if (!exists) break;
      code = genReferralCode("REF");
    }

    const doc = await ReferralCode.create({
      code,
      agentName,
      agentEmail,
      commissionPercent,
      commissionDurationMonths,
      customerDiscountPercent,
      expiresAt,
      notes,
      disabled: false,
      conversions: [],
    });

    return res.json({
      ok: true,
      referralCode: {
        _id: String(doc._id),
        code: doc.code,
        agentName: doc.agentName,
        agentEmail: doc.agentEmail,
        commissionPercent: doc.commissionPercent,
        customerDiscountPercent: doc.customerDiscountPercent,
      },
    });
  } catch (err) {
    console.error("[admin-referral-codes] create failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to create referral code." });
  }
});

// PUT /api/admin/referral-codes/:id  (update/disable)
router.put("/referral-codes/:id", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id." });

    const patch = {};
    if (req.body?.agentName != null) patch.agentName = String(req.body.agentName).trim();
    if (req.body?.agentEmail != null) patch.agentEmail = String(req.body.agentEmail).trim().toLowerCase();
    if (req.body?.commissionPercent != null) patch.commissionPercent = Math.min(100, Math.max(0, Number(req.body.commissionPercent)));
    if (req.body?.commissionDurationMonths != null) patch.commissionDurationMonths = Math.max(0, Number(req.body.commissionDurationMonths));
    if (req.body?.customerDiscountPercent != null) patch.customerDiscountPercent = Math.min(100, Math.max(0, Number(req.body.customerDiscountPercent)));
    if (req.body?.disabled != null) patch.disabled = !!req.body.disabled;
    if (req.body?.notes != null) patch.notes = String(req.body.notes).trim();
    if (req.body?.expiresAt !== undefined) {
      patch.expiresAt = req.body.expiresAt ? new Date(req.body.expiresAt) : null;
    }

    const updated = await ReferralCode.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
    if (!updated) return res.status(404).json({ ok: false, error: "Referral code not found." });

    return res.json({ ok: true, referralCode: updated });
  } catch (err) {
    console.error("[admin-referral-codes] update failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to update referral code." });
  }
});

// DELETE /api/admin/referral-codes/:id
router.delete("/referral-codes/:id", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "Missing id." });

    const doc = await ReferralCode.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Referral code not found." });

    if ((doc.totalConversions || 0) > 0) {
      return res.status(400).json({
        ok: false,
        error: `Cannot delete: code has ${doc.totalConversions} conversion(s). Disable it instead.`,
      });
    }

    await ReferralCode.deleteOne({ _id: id });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin-referral-codes] delete failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to delete referral code." });
  }
});

// GET /api/admin/referral-codes/:id/conversions  (detailed conversion list)
router.get("/referral-codes/:id/conversions", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const doc = await ReferralCode.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Referral code not found." });

    return res.json({
      ok: true,
      code: doc.code,
      agentName: doc.agentName,
      conversions: doc.conversions || [],
    });
  } catch (err) {
    console.error("[admin-referral-codes] conversions failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load conversions." });
  }
});

// POST /api/admin/referral-codes/:id/mark-paid  (mark conversions as paid)
router.post("/referral-codes/:id/mark-paid", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const doc = await ReferralCode.findById(id);
    if (!doc) return res.status(404).json({ ok: false, error: "Referral code not found." });

    let paidCount = 0;
    let paidCents = 0;
    const now = new Date();

    for (const conv of doc.conversions) {
      if (!conv.paid) {
        conv.paid = true;
        conv.paidAt = now;
        paidCount++;
        paidCents += conv.commissionCents || 0;
      }
    }

    doc.totalPaidCents = (doc.totalPaidCents || 0) + paidCents;
    await doc.save();

    return res.json({ ok: true, paidCount, paidCents });
  } catch (err) {
    console.error("[admin-referral-codes] mark-paid failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to mark as paid." });
  }
});

// POST /api/admin/referral-codes/:id/send  (send agent their referral info via email)
router.post("/referral-codes/:id/send", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const doc = await ReferralCode.findById(id).lean();
    if (!doc) return res.status(404).json({ ok: false, error: "Referral code not found." });

    const toEmail = String(req.body?.toEmail || doc.agentEmail || "").trim();
    if (!toEmail) return res.status(400).json({ ok: false, error: "Missing recipient email." });

    const senderName =
      String(req.user?.name || req.user?.fullName || req.user?.displayName || "").trim() ||
      "Curriculate Admin";

    // Load/create the referral-agent-invite template
    let template = await SystemEmailTemplate.findOne({ key: "referral-agent-invite" }).lean();
    if (!template) {
      template = await SystemEmailTemplate.create({
        key: "referral-agent-invite",
        label: "Referral agent invite",
        subject: "Your Curriculate referral code is ready!",
        html: DEFAULT_REFERRAL_AGENT_HTML,
        enabled: true,
      });
    }

    const vars = {
      SENDER_NAME: senderName,
      AGENT_NAME: doc.agentName,
      REFERRAL_CODE: doc.code,
      COMMISSION_PERCENT: String(doc.commissionPercent),
      CUSTOMER_DISCOUNT: doc.customerDiscountPercent > 0
        ? `Your referrals get ${doc.customerDiscountPercent}% off their first payment!`
        : "",
      SITE_URL: "https://www.curriculate.net",
      AI_GRADING_URL: "https://www.curriculate.net/prism",
      CUSTOM_MESSAGE: req.body?.message
        ? String(req.body.message).replace(/</g, "&lt;").replace(/>/g, "&gt;")
        : "",
    };

    const subject = _render(template.subject || "", vars);
    const html = _render(template.html || "", vars);

    await sendSystemEmail({ to: toEmail, subject, html });

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin-referral-codes] send failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to send email: " + (err?.message || err) });
  }
});

const DEFAULT_REFERRAL_AGENT_HTML = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e293b;margin-bottom:12px;">Welcome to the Curriculate Referral Program!</h2>
  <p style="color:#334155;">Hi {{AGENT_NAME}},</p>
  <p style="color:#334155;">You've been set up as a Curriculate referral partner. Share your personal referral code with teachers and schools to earn <strong>{{COMMISSION_PERCENT}}% commission</strong> on every subscription.</p>
  <div style="background:#f0fdf4;border:2px dashed #22c55e;border-radius:12px;padding:16px;text-align:center;margin:20px 0;">
    <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Your Referral Code</div>
    <div style="font-size:28px;font-weight:900;letter-spacing:3px;color:#16a34a;">{{REFERRAL_CODE}}</div>
  </div>
  <p style="color:#334155;">{{CUSTOMER_DISCOUNT}}</p>
  <p style="color:#334155;">When someone signs up and enters your code during checkout, they're linked to you automatically. You can track your conversions and commissions at any time.</p>

  <p style="color:#334155;font-size:14px;margin-top:16px;"><strong>Key links to share with prospects:</strong></p>
  <div style="margin:16px 0;">
    <div style="text-align:center;margin-bottom:12px;">
      <a href="{{SITE_URL}}" style="display:inline-block;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">Visit Curriculate</a>
    </div>
    <div style="text-align:center;">
      <a href="{{AI_GRADING_URL}}" style="display:inline-block;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:16px;">Prism &mdash; See It In Action</a>
    </div>
  </div>

  <p style="color:#334155;font-size:14px;"><strong>How it works:</strong></p>
  <ol style="color:#334155;font-size:14px;padding-left:20px;">
    <li>Share your code along with the links above</li>
    <li>Direct teachers to <a href="{{AI_GRADING_URL}}" style="color:#16a34a;font-weight:600;">curriculate.net/prism</a> to see Prism in action</li>
    <li>They enter your referral code at checkout</li>
    <li>You earn {{COMMISSION_PERCENT}}% commission on their subscription</li>
    <li>Commissions are tracked and paid out by the Curriculate team</li>
  </ol>
  {{CUSTOM_MESSAGE}}
  <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Curriculate — AI-Powered Station-Based Learning</p>
</div>
`.trim();

// ============================================================
// Public: Validate referral code (called from checkout flow)
// ============================================================
// GET /api/admin/validate-referral-code?code=XYZ
// (No auth required — used by the pricing/checkout page)
router.get("/validate-referral-code", async (req, res) => {
  try {
    const code = String(req.query?.code || "").toUpperCase().trim();
    if (!code) return res.json({ ok: false, valid: false });

    const doc = await ReferralCode.findOne({ code, disabled: { $ne: true } }).lean();
    if (!doc) return res.json({ ok: true, valid: false });

    // Check expiry
    if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) {
      return res.json({ ok: true, valid: false, reason: "expired" });
    }

    return res.json({
      ok: true,
      valid: true,
      agentName: doc.agentName,
      customerDiscountPercent: doc.customerDiscountPercent || 0,
    });
  } catch (err) {
    console.error("[validate-referral-code] failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to validate code." });
  }
});

// ============================================================
// Public: Referral agent application (no auth required)
// ============================================================

// POST /api/admin/referral-applications
router.post("/referral-applications", async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!name || !email) {
      return res.status(400).json({ ok: false, error: "Name and email are required." });
    }

    // Prevent duplicate applications from same email
    const existing = await ReferralApplication.findOne({ email }).lean();
    if (existing) {
      return res.json({
        ok: true,
        alreadyApplied: true,
        status: existing.status,
        message: "You've already applied! We'll be in touch soon.",
      });
    }

    const organization = String(req.body?.organization || "").trim();
    const message = String(req.body?.message || "").trim();

    await ReferralApplication.create({ name, email, organization, message, status: "pending" });

    // Send confirmation email to applicant
    let template = await SystemEmailTemplate.findOne({ key: "referral-application-received" }).lean();
    if (!template) {
      template = await SystemEmailTemplate.create({
        key: "referral-application-received",
        label: "Referral application received",
        subject: "We received your Curriculate referral application!",
        html: DEFAULT_REFERRAL_APPLICATION_HTML,
        enabled: true,
      });
    }

    if (template.enabled !== false) {
      const vars = {
        NAME: name,
        EMAIL: email,
        SITE_URL: "https://www.curriculate.net",
        AI_GRADING_URL: "https://www.curriculate.net/prism",
      };
      const subject = _render(template.subject || "", vars);
      const html = _render(template.html || "", vars);
      await sendSystemEmail({ to: email, subject, html }).catch((err) => {
        console.warn("[referral-application] confirmation email failed:", err.message);
      });
    }

    return res.json({ ok: true, message: "Application received! We'll be in touch." });
  } catch (err) {
    console.error("[referral-application] create failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to submit application." });
  }
});

const DEFAULT_REFERRAL_APPLICATION_HTML = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="color:#1e293b;margin-bottom:12px;">Thanks for applying, {{NAME}}!</h2>
  <p style="color:#334155;">We received your application to join the Curriculate referral program. Our team will review it and get back to you shortly with your personal referral code and commission details.</p>

  <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;">
    <p style="color:#166534;font-weight:700;margin:0 0 8px 0;">What happens next?</p>
    <ol style="color:#334155;font-size:14px;padding-left:20px;margin:0;">
      <li style="margin-bottom:6px;">We review your application (usually within 24 hours)</li>
      <li style="margin-bottom:6px;">You receive your personal referral code via email</li>
      <li style="margin-bottom:6px;">Share the code with teachers and schools</li>
      <li>Earn commission on every subscription</li>
    </ol>
  </div>

  <p style="color:#334155;">In the meantime, get familiar with what you'll be sharing:</p>
  <div style="margin:16px 0;">
    <div style="text-align:center;margin-bottom:12px;">
      <a href="{{SITE_URL}}" style="display:inline-block;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">Explore Curriculate</a>
    </div>
    <div style="text-align:center;">
      <a href="{{AI_GRADING_URL}}" style="display:inline-block;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;padding:12px 28px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;">Try Free Prism</a>
    </div>
  </div>

  <p style="color:#94a3b8;font-size:13px;margin-top:24px;">Curriculate &mdash; AI-Powered Station-Based Learning</p>
</div>
`.trim();

// GET /api/admin/referral-applications (admin only)
router.get("/referral-applications", ...adminRequired, async (req, res) => {
  try {
    const status = req.query?.status || null;
    const filter = status ? { status } : {};
    const rows = await ReferralApplication.find(filter).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, applications: rows });
  } catch (err) {
    console.error("[admin-referral-applications] list failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to load applications." });
  }
});

// PUT /api/admin/referral-applications/:id/approve  (admin approves + creates referral code)
router.put("/referral-applications/:id/approve", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const app = await ReferralApplication.findById(id);
    if (!app) return res.status(404).json({ ok: false, error: "Application not found." });
    if (app.status === "approved") {
      return res.json({ ok: true, message: "Already approved.", referralCodeId: app.referralCodeId });
    }

    const commissionPercent = Math.min(100, Math.max(0, Number(req.body?.commissionPercent ?? 15)));
    const customerDiscountPercent = Math.min(100, Math.max(0, Number(req.body?.customerDiscountPercent ?? 0)));

    // Auto-generate referral code
    const prefix = app.name.split(/\s+/)[0].toUpperCase().slice(0, 6);
    let code = genReferralCode(prefix);
    for (let i = 0; i < 5; i++) {
      const exists = await ReferralCode.findOne({ code }).lean();
      if (!exists) break;
      code = genReferralCode("REF");
    }

    const refDoc = await ReferralCode.create({
      code,
      agentName: app.name,
      agentEmail: app.email,
      commissionPercent,
      customerDiscountPercent,
      disabled: false,
      conversions: [],
      notes: `Auto-created from application ${id}`,
    });

    app.status = "approved";
    app.referralCodeId = refDoc._id;
    app.approvedAt = new Date();
    app.adminNotes = String(req.body?.adminNotes || "").trim();
    await app.save();

    // Send the agent their code via the existing referral-agent-invite template
    try {
      let template = await SystemEmailTemplate.findOne({ key: "referral-agent-invite" }).lean();
      if (!template) {
        template = await SystemEmailTemplate.create({
          key: "referral-agent-invite",
          label: "Referral agent invite",
          subject: "Your Curriculate referral code is ready!",
          html: DEFAULT_REFERRAL_AGENT_HTML,
          enabled: true,
        });
      }

      const senderName =
        String(req.user?.name || req.user?.fullName || req.user?.displayName || "").trim() ||
        "Curriculate Admin";

      const vars = {
        SENDER_NAME: senderName,
        AGENT_NAME: app.name,
        REFERRAL_CODE: refDoc.code,
        COMMISSION_PERCENT: String(commissionPercent),
        CUSTOMER_DISCOUNT: customerDiscountPercent > 0
          ? `Your referrals get ${customerDiscountPercent}% off their first payment!`
          : "",
        SITE_URL: "https://www.curriculate.net",
        AI_GRADING_URL: "https://www.curriculate.net/prism",
        CUSTOM_MESSAGE: "",
      };

      const subject = _render(template.subject || "", vars);
      const html = _render(template.html || "", vars);
      await sendSystemEmail({ to: app.email, subject, html });
    } catch (emailErr) {
      console.warn("[admin-referral-applications] approval email failed:", emailErr.message);
    }

    return res.json({ ok: true, referralCode: { _id: String(refDoc._id), code: refDoc.code } });
  } catch (err) {
    console.error("[admin-referral-applications] approve failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to approve application." });
  }
});

// PUT /api/admin/referral-applications/:id/decline
router.put("/referral-applications/:id/decline", ...adminRequired, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const app = await ReferralApplication.findById(id);
    if (!app) return res.status(404).json({ ok: false, error: "Application not found." });

    app.status = "declined";
    app.declinedAt = new Date();
    app.adminNotes = String(req.body?.adminNotes || "").trim();
    await app.save();

    return res.json({ ok: true });
  } catch (err) {
    console.error("[admin-referral-applications] decline failed:", err);
    return res.status(500).json({ ok: false, error: "Failed to decline application." });
  }
});

export default router;
