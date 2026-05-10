// backend/routes/adminBlast.js
//
// Admin-only routes for the bulk email "blast" tool. The frontend at
// /admin/blast (or the teacher-app admin page) uses these to:
//   1. POST a CSV-derived recipient list + template → create a campaign
//   2. Schedule sends in 50/day batches inside teacher-friendly send windows
//   3. Pause / resume / cancel running campaigns
//   4. Inspect per-recipient delivery status

import express from "express";
import { requireAdminToken } from "../middleware/requireAdminToken.js";
import BlastCampaign from "../models/BlastCampaign.js";
import BlastRecipient from "../models/BlastRecipient.js";
import BlastContact from "../models/BlastContact.js";
import { sendSystemEmail } from "../email/shareInviteEmailer.js";
import {
  scheduleSlots,
  renderTemplate,
  defaultTemplateForProduct,
  detectLanguageForBoard,
} from "../jobs/blastSender.js";

const router = express.Router();

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

const VALID_PRODUCTS = ["curriculate", "pulse", "fieldday"];

// Christian-school detection: board or school name explicitly says "Christian"
// or matches a known Protestant/Evangelical network (OACS, ACSI, Mennonite,
// Reformed). Catholic boards (HWCDSB, HCDSB, NCDSB) are NOT auto-flagged
// because they brand themselves under "Catholic" — the user can flag those
// per row via the IsChristian column if desired.
const CHRISTIAN_PATTERNS = [
  /\bchristian\b/i, /\bOACS\b/, /\bACSI\b/, /\bmennonite\b/i,
  /\breformed\b/i, /\bevangelical\b/i, /\bbaptist\b/i, /\bpentecostal\b/i,
];
function detectChristian(row) {
  const explicit = String(row.isChristian || row.IsChristian || "").trim().toLowerCase();
  if (explicit === "true" || explicit === "yes" || explicit === "1" || explicit === "y") return true;
  const text = `${row.board || row.Board || ""} ${row.school || row.School || ""}`;
  return CHRISTIAN_PATTERNS.some((p) => p.test(text));
}

function normalizeRecipient(r) {
  const email = String(r.email || r.Email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) return null;
  const board = String(r.board || r.Board || "").trim();
  const language = detectLanguageForBoard(board);
  return {
    email,
    firstName: String(r.firstName || r.FirstName || "").trim(),
    lastName:  String(r.lastName  || r.LastName  || "").trim(),
    school:    String(r.school    || r.School    || "").trim(),
    board,
    role:      String(r.role      || r.Role      || "").trim(),
    level:     String(r.level     || r.Level     || "").trim(),
    language,
    isChristian: detectChristian(r),
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * GET /admin/blast/templates → return defaults for the UI
 * ────────────────────────────────────────────────────────────────────── */
router.get("/blast/templates", requireAdminToken, (req, res) => {
  const templates = {};
  for (const product of VALID_PRODUCTS) {
    templates[product] = defaultTemplateForProduct(product);
  }
  res.json({ ok: true, products: VALID_PRODUCTS, templates });
});

/* ──────────────────────────────────────────────────────────────────────
 * POST /admin/blast/campaigns → create a new campaign + queue recipients
 *
 * body: {
 *   name: string,
 *   product: "curriculate" | "pulse" | "fieldday",
 *   subjectEn, bodyEn, subjectFr, bodyFr: strings (template HTML),
 *   recipients: [{ email, firstName, lastName, school, board, role, level }, ...],
 *   dailyCap?: number,             // default 50
 *   sendDays?: number[],           // default [2,3,4] (Tue/Wed/Thu, Sun=0)
 *   sendStartHour?, sendStartMinute?, sendEndHour?, sendEndMinute?
 *   fromName?, fromAddress?, replyTo?
 *   notes?: string,
 *   startInDays?: number           // default 0 → start on next eligible day
 * }
 * ────────────────────────────────────────────────────────────────────── */
router.post("/blast/campaigns", requireAdminToken, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.name || !VALID_PRODUCTS.includes(b.product)) {
      return res.status(400).json({ error: "name + valid product required" });
    }
    if (!Array.isArray(b.recipients) || b.recipients.length === 0) {
      return res.status(400).json({ error: "recipients[] required (non-empty)" });
    }

    const cleaned = b.recipients.map(normalizeRecipient).filter(Boolean);
    if (!cleaned.length) {
      return res.status(400).json({ error: "no valid recipients (need email column)" });
    }

    // Deduplicate by email; if duplicates appear, keep the first
    const seen = new Set();
    const unique = [];
    for (const r of cleaned) {
      if (seen.has(r.email)) continue;
      seen.add(r.email);
      unique.push(r);
    }

    const defaults = defaultTemplateForProduct(b.product);
    const campaign = await BlastCampaign.create({
      name: String(b.name).slice(0, 200),
      product: b.product,
      subjectEn: b.subjectEn || defaults.subjectEn,
      bodyEn:    b.bodyEn    || defaults.bodyEn,
      subjectFr: b.subjectFr || defaults.subjectFr,
      bodyFr:    b.bodyFr    || defaults.bodyFr,
      fromName:    b.fromName    || "Curriculate",
      fromAddress: b.fromAddress || process.env.EMAIL_FROM_ADDRESS || "noreply@curriculate.net",
      replyTo:     b.replyTo     || "",
      dailyCap:        Math.min(100, Math.max(1, parseInt(b.dailyCap, 10) || 50)),
      sendDays:        Array.isArray(b.sendDays) && b.sendDays.length ? b.sendDays.map(Number) : [2, 3, 4],
      sendStartHour:   b.sendStartHour   ?? 7,
      sendStartMinute: b.sendStartMinute ?? 30,
      sendEndHour:     b.sendEndHour     ?? 8,
      sendEndMinute:   b.sendEndMinute   ?? 30,
      timezone:        b.timezone || "America/Toronto",
      status:          "scheduled",
      totalRecipients: unique.length,
      notes:           b.notes || "",
    });

    // Build the schedule of send slots
    const startInDays = Math.max(0, parseInt(b.startInDays, 10) || 0);
    const slots = scheduleSlots({
      count: unique.length,
      dailyCap: campaign.dailyCap,
      sendDays: campaign.sendDays,
      startHour: campaign.sendStartHour,
      startMinute: campaign.sendStartMinute,
      endHour: campaign.sendEndHour,
      endMinute: campaign.sendEndMinute,
      timezone: campaign.timezone,
      startInDays,
    });

    // Bulk-insert recipients (skip duplicates within the campaign via the unique index)
    const docs = unique.map((r, i) => ({
      ...r,
      campaignId: campaign._id,
      scheduledFor: slots[i] || slots[slots.length - 1],
    }));
    try {
      await BlastRecipient.insertMany(docs, { ordered: false });
    } catch (e) {
      // unique-index conflicts are fine; just log
      if (e?.code !== 11000) throw e;
    }

    // Upsert into the master BlastContact list — this campaign appended these
    // contacts. The history entry starts as "queued" and is updated to "sent"
    // by the worker on successful delivery.
    const bulkOps = unique.map((r) => ({
      updateOne: {
        filter: { email: r.email },
        update: {
          $setOnInsert: {
            email: r.email,
            firstName: r.firstName,
            lastName: r.lastName,
          },
          // Always refresh latest known metadata from this upload
          $set: {
            school: r.school || undefined,
            board: r.board || undefined,
            role: r.role || undefined,
            level: r.level || undefined,
            language: r.language || "en",
            isChristian: r.isChristian || false,
          },
          $inc: { totalCampaigns: 1 },
          $push: {
            history: {
              $each: [{
                campaignId: campaign._id,
                campaignName: campaign.name,
                product: campaign.product,
                status: "queued",
                sentAt: null,
                subject: r.language === "fr" ? campaign.subjectFr : campaign.subjectEn,
              }],
              $slice: -50, // keep last 50 history entries
            },
          },
        },
        upsert: true,
      },
    }));
    if (bulkOps.length) {
      await BlastContact.bulkWrite(bulkOps, { ordered: false });
    }

    return res.json({
      ok: true,
      campaign: campaign.toJSON(),
      scheduled: docs.length,
      firstSendAt: slots[0],
      lastSendAt:  slots[slots.length - 1],
    });
  } catch (e) {
    console.error("POST /admin/blast/campaigns error:", e);
    return res.status(500).json({ error: e.message || "Failed to create campaign" });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * GET /admin/blast/campaigns → list with summary counters
 * ────────────────────────────────────────────────────────────────────── */
router.get("/blast/campaigns", requireAdminToken, async (req, res) => {
  try {
    const camps = await BlastCampaign.find({}).sort({ createdAt: -1 }).lean();
    // Refresh counters from recipients (cheap aggregate)
    const ids = camps.map(c => c._id);
    const stats = await BlastRecipient.aggregate([
      { $match: { campaignId: { $in: ids } } },
      { $group: {
          _id: { c: "$campaignId", s: "$status" },
          n: { $sum: 1 },
        }
      },
    ]);
    const byCampaign = new Map();
    for (const s of stats) {
      const key = String(s._id.c);
      if (!byCampaign.has(key)) byCampaign.set(key, {});
      byCampaign.get(key)[s._id.s] = s.n;
    }
    const result = camps.map(c => {
      const s = byCampaign.get(String(c._id)) || {};
      return {
        ...c,
        counts: {
          queued: s.queued || 0,
          sending: s.sending || 0,
          sent: s.sent || 0,
          failed: s.failed || 0,
          skipped: s.skipped || 0,
          bounced: s.bounced || 0,
          unsubscribed: s.unsubscribed || 0,
        },
      };
    });
    res.json({ ok: true, campaigns: result });
  } catch (e) {
    console.error("GET /admin/blast/campaigns error:", e);
    res.status(500).json({ error: "Failed to load campaigns" });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * GET /admin/blast/campaigns/:id → full detail + paginated recipients
 * ────────────────────────────────────────────────────────────────────── */
router.get("/blast/campaigns/:id", requireAdminToken, async (req, res) => {
  try {
    const camp = await BlastCampaign.findById(req.params.id).lean();
    if (!camp) return res.status(404).json({ error: "Campaign not found" });

    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    const skip  = Math.max(0, parseInt(req.query.skip, 10)  || 0);
    const filter = { campaignId: camp._id };
    if (req.query.status) filter.status = String(req.query.status);

    const recipients = await BlastRecipient
      .find(filter)
      .sort({ scheduledFor: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({ ok: true, campaign: camp, recipients });
  } catch (e) {
    console.error("GET /admin/blast/campaigns/:id error:", e);
    res.status(500).json({ error: "Failed to load campaign" });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * POST /admin/blast/campaigns/:id/(pause|resume|cancel)
 * ────────────────────────────────────────────────────────────────────── */
router.post("/blast/campaigns/:id/pause", requireAdminToken, async (req, res) => {
  await BlastCampaign.findByIdAndUpdate(req.params.id, { status: "paused" });
  res.json({ ok: true });
});
router.post("/blast/campaigns/:id/resume", requireAdminToken, async (req, res) => {
  await BlastCampaign.findByIdAndUpdate(req.params.id, { status: "running" });
  res.json({ ok: true });
});
router.post("/blast/campaigns/:id/cancel", requireAdminToken, async (req, res) => {
  await BlastCampaign.findByIdAndUpdate(req.params.id, { status: "cancelled" });
  await BlastRecipient.updateMany(
    { campaignId: req.params.id, status: "queued" },
    { status: "skipped", errorMessage: "campaign cancelled" }
  );
  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────────────
 * POST /admin/blast/campaigns/:id/test → send one preview email to admin
 *
 * body: { toEmail: string, language?: "en"|"fr" }
 * ────────────────────────────────────────────────────────────────────── */
router.post("/blast/campaigns/:id/test", requireAdminToken, async (req, res) => {
  try {
    const camp = await BlastCampaign.findById(req.params.id).lean();
    if (!camp) return res.status(404).json({ error: "Campaign not found" });

    const toEmail = String(req.body?.toEmail || "").toLowerCase().trim();
    if (!toEmail || !toEmail.includes("@")) {
      return res.status(400).json({ error: "valid toEmail required" });
    }
    const language = req.body?.language === "fr" ? "fr" : "en";
    const subject = language === "fr" ? camp.subjectFr : camp.subjectEn;
    const body    = language === "fr" ? camp.bodyFr    : camp.bodyEn;

    // Use placeholder values for variable substitution preview
    const html = renderTemplate(body, {
      firstName: "TEST",
      lastName:  "RECIPIENT",
      school:    "Sample Secondary School",
      board:     "HWDSB",
      role:      "Principal",
    });
    await sendSystemEmail({
      to: toEmail,
      subject: `[TEST] ${subject}`,
      html,
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("POST /admin/blast/campaigns/:id/test error:", e);
    res.status(500).json({ error: e.message || "Failed to send test" });
  }
});

/* ──────────────────────────────────────────────────────────────────────
 * GET /admin/blast/contacts → master contact list (paginated, filterable)
 *
 * query: ?board=HWDSB&role=Principal&q=smith&status=never|contacted&limit=200&skip=0
 * ────────────────────────────────────────────────────────────────────── */
router.get("/blast/contacts", requireAdminToken, async (req, res) => {
  try {
    const filter = {};
    if (req.query.board) filter.board = String(req.query.board);
    if (req.query.role)  filter.role  = String(req.query.role);
    if (req.query.school) filter.school = String(req.query.school);
    if (req.query.status === "never") filter.lastContactedAt = null;
    if (req.query.status === "contacted") filter.lastContactedAt = { $ne: null };
    if (req.query.q) {
      const q = String(req.query.q).trim();
      filter.$or = [
        { firstName: { $regex: q, $options: "i" } },
        { lastName:  { $regex: q, $options: "i" } },
        { email:     { $regex: q, $options: "i" } },
        { school:    { $regex: q, $options: "i" } },
      ];
    }

    const limit = Math.min(500, parseInt(req.query.limit, 10) || 200);
    const skip  = Math.max(0, parseInt(req.query.skip,  10) || 0);

    const [contacts, total] = await Promise.all([
      BlastContact.find(filter)
        .sort({ lastContactedAt: -1, createdAt: -1 })
        .skip(skip).limit(limit).lean(),
      BlastContact.countDocuments(filter),
    ]);

    res.json({ ok: true, contacts, total, limit, skip });
  } catch (e) {
    console.error("GET /admin/blast/contacts error:", e);
    res.status(500).json({ error: "Failed to load contacts" });
  }
});

/* GET /admin/blast/contacts/stats → aggregate counts for the dashboard */
router.get("/blast/contacts/stats", requireAdminToken, async (req, res) => {
  try {
    const [byBoard, byRole, ever, never] = await Promise.all([
      BlastContact.aggregate([
        { $group: { _id: "$board", n: { $sum: 1 }, contacted: { $sum: { $cond: [{ $ne: ["$lastContactedAt", null] }, 1, 0] } } } },
        { $sort: { n: -1 } },
      ]),
      BlastContact.aggregate([
        { $group: { _id: "$role", n: { $sum: 1 } } },
        { $sort: { n: -1 } },
      ]),
      BlastContact.countDocuments({ lastContactedAt: { $ne: null } }),
      BlastContact.countDocuments({ lastContactedAt: null }),
    ]);
    res.json({ ok: true, total: ever + never, contacted: ever, neverContacted: never, byBoard, byRole });
  } catch (e) {
    console.error("GET /admin/blast/contacts/stats error:", e);
    res.status(500).json({ error: "Failed to load contact stats" });
  }
});

/* DELETE /admin/blast/contacts/:email → remove a contact from master list */
router.delete("/blast/contacts/:email", requireAdminToken, async (req, res) => {
  const email = decodeURIComponent(req.params.email).toLowerCase().trim();
  await BlastContact.deleteOne({ email });
  res.json({ ok: true });
});

/* ──────────────────────────────────────────────────────────────────────
 * DELETE /admin/blast/campaigns/:id (hard delete; only if not running)
 * ────────────────────────────────────────────────────────────────────── */
router.delete("/blast/campaigns/:id", requireAdminToken, async (req, res) => {
  const camp = await BlastCampaign.findById(req.params.id).lean();
  if (!camp) return res.status(404).json({ error: "Campaign not found" });
  if (camp.status === "running") {
    return res.status(409).json({ error: "Pause campaign before deleting" });
  }
  await BlastRecipient.deleteMany({ campaignId: camp._id });
  await BlastCampaign.findByIdAndDelete(camp._id);
  res.json({ ok: true });
});

export default router;
