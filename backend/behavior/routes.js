// backend/behavior/routes.js
//
// Behaviours API (brief §6, §3, §5d, §7). Mounted at /api/behavior in index.js.
// Reuses the existing JWT auth (authAny) — every route is behind it. School
// membership + role are loaded from BehaviorTeacher.
//
// The append-only incident model + cross-teacher aggregation live in
// ./lib/triggerLogic.js; delivery + failover in ./lib/notify.js; the AI note in
// ./lib/aiNote.js. This file is the orchestration glue.

import express from "express";
import mongoose from "mongoose";
import crypto from "crypto";
import multer from "multer";

import authAny from "../middleware/authAny.js";
import { sendEmail } from "./lib/sendEmail.js";

import BehaviorSchool from "./models/BehaviorSchool.js";
import BehaviorTeacher from "./models/BehaviorTeacher.js";
import BehaviorInvite from "./models/BehaviorInvite.js";
import BehaviorStudent from "./models/BehaviorStudent.js";
import Behavior from "./models/Behavior.js";
import BehaviorIncident from "./models/BehaviorIncident.js";
import BehaviorNotice from "./models/BehaviorNotice.js";
import BehaviorConfig from "./models/BehaviorConfig.js";
import BehaviorAuditLog from "./models/BehaviorAuditLog.js";
import BehaviorFollowup from "./models/BehaviorFollowup.js";
import BehaviorHouse from "./models/BehaviorHouse.js";
import HousePointEvent from "./models/HousePointEvent.js";
import BehaviorCompetition from "./models/BehaviorCompetition.js";

import { evaluateIncident, activeThresholdIncidents, evaluatePositive } from "./lib/triggerLogic.js";
import { nextSchoolDay } from "./lib/schoolCalendar.js";
import { encrypt, decrypt } from "./lib/secretBox.js";
import { EdsbyProvider } from "./lib/providers/EdsbyProvider.js";
import { seedBehaviorDocs } from "./lib/seedBehaviors.js";
import { parseRoster, parseRosterFile } from "./lib/rosterImport.js";
import { STANDARD_BEHAVIORS } from "./lib/standardBehaviors.js";
import { composeNotice, composePositiveNotice, makeDefaultAiClient, deterministicNote, deterministicPositiveNote } from "./lib/aiNote.js";
import { buildAvgsRouter } from "./avgsRoutes.js";
import { emailShell, emailButton, noteToHtml, mdToHtml, monthlyKindChartHtml } from "./lib/emailTemplate.js";
import { scheduleDispatch, dispatchNotice } from "./lib/notify.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Helpers ────────────────────────────────────────────────────────────────

function emailDomain(email) {
  const e = String(email || "").toLowerCase().replace(/[<>]/g, "").trim();
  const at = e.lastIndexOf("@");
  return at === -1 ? "" : e.slice(at + 1).trim();
}

function appBase() {
  return (process.env.APP_BASE_URL || "https://www.curriculate.net").replace(/\/+$/, "");
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Load the caller's school membership; 404 if they have none yet. */
async function loadMembership(req, res, next) {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) {
      return res.status(404).json({ ok: false, error: "No Behaviours school for this account", needsSetup: true });
    }
    req.membership = membership;
    req.schoolId = membership.schoolId;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  const role = req.membership?.role;
  if (role !== "originator" && role !== "admin") {
    return res.status(403).json({ ok: false, error: "Admin only" });
  }
  next();
}

function canLog(req, res, next) {
  const role = req.membership?.role;
  if (role === "principal") {
    return res.status(403).json({ ok: false, error: "Principal role is read-only" });
  }
  next();
}

async function audit(schoolId, type, req, extra = {}) {
  try {
    await BehaviorAuditLog.create({
      schoolId,
      type,
      actorUserId: req?.userId || null,
      actorEmail: req?.user?.email || "",
      ...extra,
    });
  } catch (err) {
    console.warn("[behavior] audit write failed:", err?.message || err);
  }
}

// ── Identity / setup ─────────────────────────────────────────────────────────

// Who am I in the Behaviours app (membership + role + config summary).
// Never expose the encrypted Edsby cookie to the client; surface a boolean.
function sanitizeConfig(config) {
  if (!config) return config;
  const c = { ...config };
  if (c.edsby) {
    c.edsby = {
      enabled: !!c.edsby.enabled,
      baseUrl: c.edsby.baseUrl || "",
      userNid: c.edsby.userNid || "",
      jver: c.edsby.jver || "",
      cver: c.edsby.cver || "",
      zoomId: c.edsby.zoomId || "",
      cookieConfigured: !!c.edsby.cookieEnc,
      formkeyConfigured: !!c.edsby.formkeyEnc,
      ingestTokenSet: !!c.edsby.ingestToken,
      updatedAt: c.edsby.updatedAt || null,
    };
  }
  return c;
}

router.get("/me", authAny, async (req, res, next) => {
  try {
    const membership = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (!membership) return res.json({ ok: true, membership: null, needsSetup: true });
    const school = await BehaviorSchool.findById(membership.schoolId).lean();
    const config = await BehaviorConfig.findOne({ schoolId: membership.schoolId }).lean();
    const admins = await BehaviorTeacher.find({ schoolId: membership.schoolId, role: { $in: ["originator", "admin"] } })
      .select("name email role")
      .lean();
    res.json({ ok: true, membership, school, config: sanitizeConfig(config), admins });
  } catch (err) {
    next(err);
  }
});

// Originator creates the school + seeds config + standard behaviours (§5).
router.post("/setup", authAny, async (req, res, next) => {
  try {
    const existing = await BehaviorTeacher.findOne({ userId: req.userId }).lean();
    if (existing) return res.status(409).json({ ok: false, error: "Account already belongs to a Behaviours school" });

    const schoolName = String(req.body?.schoolName || "").trim();
    if (!schoolName) return res.status(400).json({ ok: false, error: "schoolName required" });

    const domain = emailDomain(req.user?.email);
    if (!domain) return res.status(400).json({ ok: false, error: "Could not determine your email domain" });

    const school = await BehaviorSchool.create({
      name: schoolName,
      originatorUserId: req.userId,
      emailDomain: domain,
    });

    await BehaviorConfig.create({
      schoolId: school._id,
      branding: { schoolName },
    });

    await BehaviorTeacher.create({
      schoolId: school._id,
      userId: req.userId,
      email: String(req.user.email).toLowerCase(),
      name: req.user.name || "",
      role: "originator",
      status: "accepted",
    });

    await Behavior.insertMany(seedBehaviorDocs(school._id));
    await audit(school._id, "school.created", req, { meta: { schoolName, domain } });

    res.json({ ok: true, schoolId: school._id });
  } catch (err) {
    next(err);
  }
});

// ── Config (§5b/§5c) ─────────────────────────────────────────────────────────

router.get("/config", authAny, loadMembership, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

router.put("/config", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const allowed = [
      "triggerCount", "fadeWindowDays", "vp", "branding", "channels",
      "aiSendMode", "cancelWindowSeconds", "aiProvider", "aiModel",
      "noticesResetMode", "termStartDates", "repeatScopeDays",
      "reminderTime", "manualNonSchoolDays", "houseReport", "housesEnabled", "housePointsResetAt",
    ];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const config = await BehaviorConfig.findOneAndUpdate(
      { schoolId: req.schoolId },
      { $set: update },
      { new: true }
    ).lean();
    await audit(req.schoolId, "config.updated", req, { meta: { fields: Object.keys(update) } });
    res.json({ ok: true, config: sanitizeConfig(config) });
  } catch (err) {
    next(err);
  }
});

// Connect Edsby (admin): store the base URL + session cookie (encrypted). The
// cookie is write-only — it's never returned. Posting per-parent happens via
// the EdsbyProvider once channels.edsby is enabled.
router.put("/config/edsby", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const update = { "edsby.updatedAt": new Date() };
    if ("enabled" in b) update["edsby.enabled"] = !!b.enabled;
    if ("baseUrl" in b) update["edsby.baseUrl"] = String(b.baseUrl || "").trim().replace(/\/+$/, "");
    // Non-secret identifiers stored plainly.
    for (const k of ["userNid", "jver", "cver", "zoomId"]) {
      if (k in b) update[`edsby.${k}`] = String(b[k] || "").trim();
    }
    // Secrets encrypted; only updated when a fresh value is supplied.
    if (b.cookie) update["edsby.cookieEnc"] = encrypt(String(b.cookie));
    if (b.formkey) update["edsby.formkeyEnc"] = encrypt(String(b.formkey));
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: update });
    await audit(req.schoolId, "config.edsby_updated", req, {
      meta: { enabled: update["edsby.enabled"], baseUrl: update["edsby.baseUrl"], cookieSet: !!b.cookie, formkeySet: !!b.formkey },
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Scrape Edsby's jver/cver from a fetched page. jver is the engine bundle hash
// (engine.min.js?..._i=<hash>); cver is the bundle version. Tolerant of layout.
function extractEdsbyVersions(html) {
  const grab = (k) => {
    for (const re of [
      new RegExp(`["']?${k}["']?\\s*[:=]\\s*["']([A-Za-z0-9._-]+)["']`, "i"), // jver:"abc"
      new RegExp(`[?&]${k}=([A-Za-z0-9._-]+)`, "i"), // ...?jver=abc
    ]) {
      const m = html.match(re);
      if (m && m[1]) return m[1];
    }
    return "";
  };
  let jver = grab("jver");
  let cver = grab("cver");
  if (!jver) {
    const m =
      html.match(/engine(?:\.min)?\.js\?[^"'<> ]*?[?&]_i=([A-Za-z0-9._-]+)/i) ||
      html.match(/[?&]_i=([A-Za-z0-9._-]{6,})/i);
    if (m) jver = m[1];
  }
  // The formkey is often embedded in a logged-in page (window._cf.formkey /
  // _formkey). Scraping it from the authenticated HTML beats the openSesame call.
  let formkey = "";
  const fm =
    html.match(/["']?_?formkey["']?\s*[:=]\s*["']([A-Za-z0-9._\-]+)["']/i) ||
    html.match(/name=["']_formkey["'][^>]*value=["']([^"']+)["']/i);
  if (fm) formkey = fm[1];
  return { jver, cver, formkey };
}

// One-tap "Refresh from Edsby": auto-detects jver/cver from the public bootstrap
// AND, if a session cookie is stored, refreshes the (short-lived) formkey. Saves
// whatever it can and reports what was updated / what's still missing. The cookie
// itself can't be fetched (login-gated / HttpOnly) — it stays a manual paste.
router.post("/edsby/refresh", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const baseUrl = String(req.body?.baseUrl || e.baseUrl || "").trim().replace(/\/+$/, "");
    const updated = [];
    const notes = [];
    let jver = e.jver || "";
    let cver = e.cver || "";
    const cookie = e.cookieEnc ? decrypt(e.cookieEnc) : "";

    // 1) Read jver/cver (and maybe the formkey) from the Edsby page. Fetch it
    // WITH the cookie when we have one — the anonymous landing page is just a
    // login shell, but the authenticated page embeds the bundle hash + formkey.
    let scrapedFormkey = "";
    if (/^https:\/\//i.test(baseUrl)) {
      try {
        const headers = { "User-Agent": "Mozilla/5.0", Accept: "text/html" };
        if (cookie) headers.Cookie = cookie;
        const r = await fetch(baseUrl, { redirect: "follow", headers });
        const found = extractEdsbyVersions(await r.text());
        if (found.jver) jver = found.jver;
        if (found.cver) cver = found.cver;
        if (found.formkey) scrapedFormkey = found.formkey;
        if (!found.jver && !found.cver) {
          notes.push(cookie
            ? "couldn't read jver/cver even when signed in — copy them from a request's x-xds-jver / x-xds-cver headers, or run the Cookie Sync extension"
            : "couldn't read jver/cver from the public page — save the cookie first, then Refresh again");
        } else if (!cver) {
          // cver lives only in the x-xds-cver request header, never the HTML —
          // the formkey call 403s without it.
          notes.push("got jver but cver isn't on the page — paste x-xds-cver from a request header (DevTools), or run the Cookie Sync extension to capture it");
        }
      } catch (err) {
        notes.push(`version fetch failed: ${err?.message || err}`);
      }
    } else {
      notes.push("set the Edsby base URL (https://…) first");
    }

    const set = {};
    if (jver && jver !== e.jver) { set["edsby.jver"] = jver; updated.push("jver"); }
    if (cver && cver !== e.cver) { set["edsby.cver"] = cver; updated.push("cver"); }

    // 2) Formkey: prefer the one scraped from the authenticated page; otherwise
    // fall back to the openSesame refresh (needs a cookie + correct jver/cver).
    let formkeyOk = null;
    let formkeyError = "";
    if (scrapedFormkey) {
      set["edsby.formkeyEnc"] = encrypt(scrapedFormkey);
      updated.push("formkey");
      formkeyOk = true;
    } else if (cookie) {
      const provider = new EdsbyProvider({
        baseUrl, cookie, formkey: decrypt(e.formkeyEnc), jver, cver, userNid: e.userNid,
      });
      const r = await provider.testConnection(e.zoomId);
      formkeyOk = r.ok;
      if (r.ok && r.formkey) { set["edsby.formkeyEnc"] = encrypt(r.formkey); updated.push("formkey"); }
      else formkeyError = r.error || r.message || "";
    } else {
      notes.push("no session cookie saved yet — paste it from DevTools, Save, then Refresh again");
    }

    if (Object.keys(set).length) {
      set["edsby.updatedAt"] = new Date();
      await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: set });
    }
    await audit(req.schoolId, "edsby.refresh", req, { meta: { updated, formkeyOk } });
    res.json({ ok: true, jver, cver, updated, formkeyOk, formkeyError, notes });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// Generate (or rotate) the ingest token a browser script uses to push fresh
// Edsby creds in. Returns the token ONCE — store it in your script; regenerating
// invalidates the previous one.
router.post("/edsby/ingest-token", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const token = crypto.randomBytes(24).toString("hex");
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "edsby.ingestToken": token } });
    await audit(req.schoolId, "edsby.ingest_token_rotated", req, {});
    res.json({ ok: true, token, url: "/api/behavior/edsby/ingest" });
  } catch (err) {
    next(err);
  }
});

// Token-authenticated credential push — NO login required (the token IS the
// auth), so a browser userscript on the Edsby page can POST fresh creds here.
// Accepts any of: cookie, formkey, jver, cver, userNid, zoomId, baseUrl. Secrets
// are encrypted at rest. Only the fields supplied are updated.
router.post("/edsby/ingest", async (req, res) => {
  try {
    const token = String(req.headers["x-ingest-token"] || req.body?.token || "").trim();
    if (!token) return res.status(401).json({ ok: false, error: "missing token" });
    const config = await BehaviorConfig.findOne({ "edsby.ingestToken": token }).select("_id schoolId").lean();
    if (!config) return res.status(401).json({ ok: false, error: "invalid token" });

    const b = req.body || {};
    const set = { "edsby.updatedAt": new Date() };
    const updated = [];
    for (const k of ["userNid", "jver", "cver", "zoomId"]) {
      if (k in b && String(b[k] || "").trim()) { set[`edsby.${k}`] = String(b[k]).trim(); updated.push(k); }
    }
    if (b.baseUrl) { set["edsby.baseUrl"] = String(b.baseUrl).trim().replace(/\/+$/, ""); updated.push("baseUrl"); }
    if (b.cookie) { set["edsby.cookieEnc"] = encrypt(String(b.cookie)); updated.push("cookie"); }
    if (b.formkey) { set["edsby.formkeyEnc"] = encrypt(String(b.formkey)); updated.push("formkey"); }
    if (updated.length <= 0) return res.status(400).json({ ok: false, error: "no fields to update" });

    await BehaviorConfig.updateOne({ _id: config._id }, { $set: set });
    await audit(config.schoolId, "edsby.ingested", req, { meta: { updated, via: "ingest-token" } });
    res.json({ ok: true, updated });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Send a test email (admin) to verify SMTP delivery. Returns the SMTP error in
// the body (still 200) so the UI can show exactly why it failed.
router.post("/test-email", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const to = String(req.body?.to || req.user?.email || "").trim();
    if (!to) return res.status(400).json({ ok: false, error: "No recipient address" });
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    try {
      await sendEmail({
        from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
        to,
        subject: "Behaviours — test email ✓",
        text: `This is a test from Behaviours. If you received it, email delivery is working.\n\nSent ${new Date().toLocaleString()}.`,
        html: emailShell({
          title: "Email delivery is working ✓",
          contentHtml:
            `<p style="margin:0 0 10px;color:#334155;line-height:1.6">This is a test from Behaviours. If you can read this, your email delivery is set up correctly.</p>` +
            `<p style="margin:0;color:#94a3b8;font-size:13px">Sent ${escapeHtml(new Date().toLocaleString())}.</p>`,
        }),
      });
      await audit(req.schoolId, "email.test_sent", req, { meta: { to } });
      return res.json({ ok: true, to, fromConfigured: !!fromAddr });
    } catch (mailErr) {
      return res.json({ ok: false, to, fromConfigured: !!fromAddr, error: mailErr?.message || String(mailErr) });
    }
  } catch (err) {
    next(err);
  }
});

// Build a SAMPLE parent notice (with your branding + signature) so you can see
// exactly what families receive. Returns the rendered HTML for an in-app preview
// and, when { email:true }, sends it to you. Uses the deterministic template
// (no AI cost) and made-up incidents — nothing is logged or sent to a parent.
router.post("/test-notice", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const kind = req.body?.kind === "positive" ? "positive" : "negative";
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("branding").lean();
    const schoolName = config?.branding?.schoolName || "";
    const signature = (req.membership?.signature || config?.branding?.signatureBlock || `Sincerely,\n${schoolName}`).trim();
    const studentName = "Alex";
    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();

    let text;
    if (kind === "positive") {
      text = deterministicPositiveNote({
        studentName, schoolName, signature,
        incidents: [
          { behaviorName: "Helped a classmate", teacherName: "Ms. Lee", date: new Date(now - 6 * DAY) },
          { behaviorName: "Great effort in math", teacherName: "Mr. Patel", date: new Date(now - 3 * DAY) },
          { behaviorName: "Showed leadership at recess", teacherName: "Ms. Lee", date: new Date(now - 1 * DAY) },
        ],
      });
    } else {
      text = deterministicNote({
        studentName, schoolName, signature, sequenceNo: 1, daysSinceFirst: 3,
        consequences: ["Write out the expectation 10× and return it signed."],
        incidents: [
          { behaviorName: "Talking during instruction", teacherName: "Ms. Lee", date: new Date(now - 3 * DAY) },
          { behaviorName: "Disrupting the lesson", teacherName: "Mr. Patel", date: new Date(now - 1 * DAY) },
          { behaviorName: "Out of seat repeatedly", teacherName: "Ms. Lee", date: new Date(now) },
        ],
        positives: [],
      });
    }

    const subject = kind === "positive" ? `Good news about ${studentName} 🎉 (sample)` : `Behaviour notice — ${studentName} (sample)`;
    const html = emailShell({
      title: kind === "positive" ? "A note of good news" : "A note from school",
      schoolName,
      preheader: "Sample notice — preview only.",
      accent: kind === "positive" ? "#16a34a" : "#0f172a",
      footnote: "This is a SAMPLE preview — no incident was logged and no parent was contacted.",
      contentHtml: noteToHtml(text),
    });

    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        await sendEmail({
          from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
          to: req.user.email,
          subject,
          text,
          html,
        });
        emailed = true;
      } catch (e) {
        emailError = e?.message || String(e);
      }
    }

    res.json({ ok: true, kind, subject, html, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Test the Edsby connection (admin): authenticates with the stored cookie and
// refreshes the formkey. Saves the fresh formkey on success. Doesn't message a
// parent. The actual broadcast is exercised when a real notice sends via Edsby.
router.post("/test-edsby", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const provider = new EdsbyProvider({
      baseUrl: e.baseUrl,
      cookie: decrypt(e.cookieEnc),
      formkey: decrypt(e.formkeyEnc),
      jver: e.jver,
      cver: e.cver,
      userNid: e.userNid,
    });
    const r = await provider.testConnection(e.zoomId);
    if (r.ok && r.formkey) {
      await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { "edsby.formkeyEnc": encrypt(r.formkey) } });
    }
    await audit(req.schoolId, "edsby.test", req, { meta: { ok: r.ok } });
    res.json({ ok: r.ok, message: r.message, error: r.error });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// End-to-end Edsby test: actually POST a broadcast to a nid (defaults to your
// own Edsby user nid) so you can confirm a message lands in Edsby.
router.post("/test-edsby-send", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const e = config?.edsby || {};
    const toNid = String(req.body?.toNid || "").trim() || String(e.userNid || "").trim();
    if (!toNid) return res.json({ ok: false, error: "No target nid — set your Edsby user nid, or enter one." });
    // Edsby links a parent broadcast to a student context (Panorama Referer).
    // Only set it if a real student nid is given — defaulting it to the recipient
    // builds an invalid Panorama referer (and 1042s) when the recipient is a
    // teacher/colleague rather than a parent.
    const studentNid = String(req.body?.studentNid || "").trim();
    const provider = new EdsbyProvider({
      baseUrl: e.baseUrl, cookie: decrypt(e.cookieEnc), formkey: decrypt(e.formkeyEnc),
      jver: e.jver, cver: e.cver, userNid: e.userNid, studentNid,
    });
    const message = String(req.body?.message || "").trim() ||
      "Test broadcast from Behaviours — if you can see this in Edsby, posting works.";
    const r = await provider.send({ recipient: { edsbyParentId: toNid }, body: message });
    await audit(req.schoolId, "edsby.test_send", req, { meta: { toNid, ok: r.ok } });
    res.json({ ok: r.ok, error: r.error });
  } catch (err) {
    res.json({ ok: false, error: err?.message || String(err) });
  }
});

// ── Invites (§5d) ────────────────────────────────────────────────────────────

router.post("/invite", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const role = ["admin", "teacher", "principal"].includes(req.body?.role) ? req.body.role : "teacher";
    // Only the originator may grant admin.
    if (role === "admin" && req.membership.role !== "originator") {
      return res.status(403).json({ ok: false, error: "Only the originator can grant admin" });
    }
    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const emails = (Array.isArray(req.body?.emails) ? req.body.emails : [req.body?.email])
      .map((e) => {
        const m = String(e || "").match(/[\w.+-]+@[\w.-]+\.\w{2,}/); // pull addr from "Name <email>"
        return m ? m[0].toLowerCase() : String(e || "").trim().toLowerCase().replace(/[<>]/g, "");
      })
      .filter(Boolean);
    if (!emails.length) return res.status(400).json({ ok: false, error: "No email addresses provided" });

    const created = [];
    const rejected = [];
    for (const email of emails) {
      // Domain restriction (§5d): must match the school's domain.
      if (emailDomain(email) !== school.emailDomain) {
        rejected.push({ email, reason: `outside school domain @${school.emailDomain}` });
        continue;
      }
      const token = crypto.randomBytes(24).toString("hex");
      await BehaviorInvite.findOneAndUpdate(
        { schoolId: req.schoolId, email },
        { $set: { token, role, status: "pending", invitedByEmail: req.user.email } },
        { upsert: true, new: true }
      );
      const link = `${appBase()}/behavior/accept?token=${token}`;
      const inviter = (req.user?.name || "").trim();
      const inviterEmail = req.user?.email || "";
      const by = inviter ? `${inviter}${inviterEmail ? ` (${inviterEmail})` : ""}` : "A colleague";
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      try {
        await sendEmail({
          from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
          to: email,
          replyTo: inviterEmail || undefined,
          subject: `${inviter || "You're"} invited you to Behaviours`,
          text:
            `Hi,\n\n` +
            `${by} has invited you to Behaviours — a tool for tracking student behaviour across teachers and keeping parents in the loop. ` +
            `You'll be able to log incidents against any student and see each student's cross-teacher status.\n\n` +
            `Set your password and get started:\n${link}\n\n` +
            `If you didn't expect this, you can ignore this email.\n\n— Behaviours`,
          html: emailShell({
            title: "You're invited to Behaviours",
            schoolName: school?.name || "Behaviours",
            preheader: `${by} invited you to Behaviours.`,
            contentHtml:
              `<p style="margin:0 0 12px;color:#334155;line-height:1.6"><strong>${escapeHtml(by)}</strong> has invited you to Behaviours — a tool for tracking student behaviour across teachers and keeping parents in the loop. ` +
              `You'll be able to log incidents against any student and see each student's cross-teacher status.</p>` +
              emailButton("Accept & set your password", link) +
              `<p style="color:#94a3b8;font-size:13px;word-break:break-all;margin:8px 0 0">Or paste this link: ${escapeHtml(link)}</p>` +
              `<p style="color:#94a3b8;font-size:13px;margin:12px 0 0">If you didn't expect this, you can ignore this email.</p>`,
          }),
        });
      } catch (mailErr) {
        console.warn("[behavior] invite email failed:", mailErr?.message || mailErr);
      }
      created.push({ email, role });
    }
    await audit(req.schoolId, "invite.sent", req, { meta: { created, rejected } });
    res.json({ ok: true, invited: created, rejected });
  } catch (err) {
    next(err);
  }
});

router.get("/invites", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const invites = await BehaviorInvite.find({ schoolId: req.schoolId }).sort({ createdAt: -1 }).lean();
    res.json({ ok: true, invites });
  } catch (err) {
    next(err);
  }
});

// Resend a pending invite — fresh token + a (reminder) branded email.
router.post("/invites/resend", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });
    const invite = await BehaviorInvite.findOne({ schoolId: req.schoolId, email, status: "pending" });
    if (!invite) return res.status(404).json({ ok: false, error: "No pending invite for that address" });
    invite.token = crypto.randomBytes(24).toString("hex");
    await invite.save();

    const school = await BehaviorSchool.findById(req.schoolId).lean();
    const link = `${appBase()}/behavior/accept?token=${invite.token}`;
    const inviter = (req.user?.name || "").trim();
    const inviterEmail = req.user?.email || "";
    const by = inviter ? `${inviter}${inviterEmail ? ` (${inviterEmail})` : ""}` : "A colleague";
    const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    let emailed = false;
    let emailError = "";
    try {
      await sendEmail({
        from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
        to: email,
        replyTo: inviterEmail || undefined,
        subject: `Reminder: you're invited to Behaviours`,
        text: `Reminder — ${by} invited you to Behaviours.\n\nSet your password and get started:\n${link}\n`,
        html: emailShell({
          title: "Reminder: you're invited to Behaviours",
          schoolName: school?.name || "Behaviours",
          preheader: `${by} invited you to Behaviours.`,
          contentHtml:
            `<p style="margin:0 0 12px;color:#334155;line-height:1.6">Just a reminder — <strong>${escapeHtml(by)}</strong> invited you to Behaviours. Here's your link again.</p>` +
            emailButton("Accept & set your password", link) +
            `<p style="color:#94a3b8;font-size:13px;word-break:break-all;margin:8px 0 0">Or paste this link: ${escapeHtml(link)}</p>`,
        }),
      });
      emailed = true;
    } catch (e) {
      emailError = e?.message || String(e);
    }
    await audit(req.schoolId, "invite.resent", req, { meta: { email, emailed } });
    res.json({ ok: true, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Revoke a pending invite so it stops counting / showing.
router.post("/invites/revoke", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ ok: false, error: "email required" });
    const r = await BehaviorInvite.updateOne(
      { schoolId: req.schoolId, email, status: "pending" },
      { $set: { status: "revoked" } }
    );
    await audit(req.schoolId, "invite.revoked", req, { meta: { email } });
    res.json({ ok: r.modifiedCount > 0 });
  } catch (err) {
    next(err);
  }
});

// Team & usage overview (admins + principal): who's a member, who was invited
// but hasn't joined, and per-teacher activity. "Last active" is the most recent
// of a logged incident or an audited action (we don't track raw logins).
router.get("/team", authAny, loadMembership, async (req, res, next) => {
  try {
    if (!["originator", "admin", "principal"].includes(req.membership.role)) {
      return res.status(403).json({ ok: false, error: "Admins and principals only" });
    }
    const teachers = await BehaviorTeacher.find({ schoolId: req.schoolId })
      .select("name email role status createdAt userId")
      .lean();

    const incAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId } },
      { $group: { _id: "$teacherId", n: { $sum: 1 }, last: { $max: "$timestamp" } } },
    ]);
    const incById = Object.fromEntries(incAgg.map((a) => [String(a._id), a]));

    const notAgg = await BehaviorNotice.aggregate([
      { $match: { schoolId: req.schoolId } },
      { $group: { _id: "$sentByTeacherId", n: { $sum: 1 } } },
    ]);
    const notById = Object.fromEntries(notAgg.map((a) => [String(a._id), a.n]));

    // Earlier/legacy offences often exist ONLY as a historical notice home (a
    // one-time import of past paper records), with no itemised incident row.
    // Count those standalone offences per teacher so the Incidents column
    // reflects the FULL history, not just what's been logged in the app — the
    // same reconciliation the AI summaries use.
    const legNotAgg = await BehaviorNotice.aggregate([
      {
        $match: {
          schoolId: req.schoolId,
          $or: [{ legacyImport: true }, { triggeringIncidentIds: { $exists: false } }, { triggeringIncidentIds: { $size: 0 } }],
        },
      },
      { $group: { _id: "$sentByTeacherId", n: { $sum: 1 } } },
    ]);
    const legOffByTeacher = Object.fromEntries(legNotAgg.map((a) => [String(a._id), a.n]));

    const auditAgg = await BehaviorAuditLog.aggregate([
      { $match: { schoolId: req.schoolId, actorUserId: { $ne: null } } },
      { $group: { _id: "$actorUserId", last: { $max: "$createdAt" } } },
    ]);
    const auditByUser = Object.fromEntries(auditAgg.map((a) => [String(a._id), a.last]));

    const DAY = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const rows = teachers
      .map((t) => {
        const inc = incById[String(t._id)];
        const lastIncident = inc?.last ? new Date(inc.last).getTime() : 0;
        const lastAudit = auditByUser[String(t.userId)] ? new Date(auditByUser[String(t.userId)]).getTime() : 0;
        const lastActive = Math.max(lastIncident, lastAudit);
        const legOff = legOffByTeacher[String(t._id)] || 0;
        return {
          _id: String(t._id),
          name: t.name,
          email: t.email,
          role: t.role,
          status: t.status,
          joinedAt: t.createdAt,
          // History-inclusive: itemised incidents + standalone legacy offences.
          incidents: (inc?.n || 0) + legOff,
          legacyOffences: legOff,
          notices: notById[String(t._id)] || 0,
          lastActiveAt: lastActive ? new Date(lastActive) : null,
        };
      })
      .sort((a, b) => new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime());

    // Pending invites — exclude anyone who has already joined (e.g. the
    // originator, or someone invited then created/accepted separately).
    const memberEmails = new Set(teachers.map((t) => (t.email || "").toLowerCase()));
    const pendingInvites = (await BehaviorInvite.find({ schoolId: req.schoolId, status: "pending" })
      .select("email role invitedByEmail createdAt")
      .sort({ createdAt: -1 })
      .lean()
    ).filter((p) => !memberEmails.has((p.email || "").toLowerCase()));

    const activeLast30 = rows.filter((r) => r.lastActiveAt && now - new Date(r.lastActiveAt).getTime() < 30 * DAY).length;
    const totalIncidents = incAgg.reduce((s, a) => s + a.n, 0) + legNotAgg.reduce((s, a) => s + a.n, 0);
    const totalNotices = notAgg.reduce((s, a) => s + a.n, 0);

    res.json({
      ok: true,
      teachers: rows,
      pending: pendingInvites.map((p) => ({ email: p.email, role: p.role, invitedBy: p.invitedByEmail, invitedAt: p.createdAt })),
      stats: { members: rows.length, pending: pendingInvites.length, activeLast30, totalIncidents, totalNotices },
    });
  } catch (err) {
    next(err);
  }
});

// Accept an invite: the signed-in user (who set a password via the existing
// signup flow) becomes a member. Their email must match the invite.
router.post("/invite/accept", authAny, async (req, res, next) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) return res.status(400).json({ ok: false, error: "token required" });
    const invite = await BehaviorInvite.findOne({ token, status: "pending" });
    if (!invite) return res.status(404).json({ ok: false, error: "Invite not found or already used" });

    const myEmail = String(req.user?.email || "").toLowerCase();
    if (myEmail !== invite.email) {
      return res.status(403).json({ ok: false, error: "Signed-in email does not match the invite" });
    }

    await BehaviorTeacher.findOneAndUpdate(
      { schoolId: invite.schoolId, userId: req.userId },
      {
        $set: {
          email: myEmail,
          name: req.user.name || "",
          role: invite.role,
          status: "accepted",
        },
      },
      { upsert: true, new: true }
    );
    invite.status = "accepted";
    await invite.save();
    await audit(invite.schoolId, "invite.accepted", req, { meta: { email: myEmail, role: invite.role } });
    res.json({ ok: true, schoolId: invite.schoolId });
  } catch (err) {
    next(err);
  }
});

router.post("/invite/:id/revoke", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    await BehaviorInvite.updateOne(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { status: "revoked" } }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Roster import (§3) ───────────────────────────────────────────────────────

router.post("/roster/import", authAny, loadMembership, requireAdmin, upload.single("file"), async (req, res, next) => {
  try {
    // Accept either an uploaded file (CSV or XLSX) or raw CSV text in the body.
    let parsed;
    if (req.file) {
      parsed = await parseRosterFile(req.file.buffer, req.file.originalname || "");
    } else if (req.body?.csv) {
      parsed = parseRoster(String(req.body.csv));
    } else {
      return res.status(400).json({ ok: false, error: "No file or CSV provided" });
    }
    const { students, skipped, headerMap } = parsed;

    // Resolve any "House" column to a houseId, matching existing houses by name
    // (case-insensitive) and creating any that are new to this school.
    const existingHouses = await BehaviorHouse.find({ schoolId: req.schoolId }).select("name active").lean();
    const houseByName = new Map(existingHouses.map((h) => [h.name.trim().toLowerCase(), h]));
    let housesCreated = 0;
    async function resolveHouseId(name) {
      const key = String(name || "").trim().toLowerCase();
      if (!key) return null;
      let h = houseByName.get(key);
      if (!h) {
        h = (await BehaviorHouse.create({ schoolId: req.schoolId, name: String(name).trim() })).toObject();
        houseByName.set(key, h);
        housesCreated += 1;
      } else if (h.active === false) {
        await BehaviorHouse.updateOne({ _id: h._id }, { $set: { active: true } });
      }
      return h._id;
    }

    let imported = 0;
    let updated = 0;
    for (const s of students) {
      // Resolve + strip the parsed house name into a real houseId.
      const { houseName, ...fields } = s;
      if (houseName) fields.houseId = await resolveHouseId(houseName);

      // Match an existing student on externalId (preferred) or full name.
      const match = fields.externalId
        ? { schoolId: req.schoolId, externalId: fields.externalId }
        : { schoolId: req.schoolId, lastName: fields.lastName, firstName: fields.firstName };
      const existing = fields.externalId || (fields.lastName && fields.firstName)
        ? await BehaviorStudent.findOne(match)
        : null;

      if (existing) {
        Object.assign(existing, fields, { schoolId: req.schoolId, active: true });
        await existing.save();
        updated += 1;
      } else {
        await BehaviorStudent.create({ ...fields, schoolId: req.schoolId });
        imported += 1;
      }
    }

    await audit(req.schoolId, "roster.imported", req, {
      meta: { imported, updated, skippedCount: skipped.length, housesCreated, headerMap },
    });
    res.json({ ok: true, imported, updated, skipped, housesCreated, headerMap });
  } catch (err) {
    next(err);
  }
});

// ── Students (§3, §6) ────────────────────────────────────────────────────────

// Search any student in the school (no teacher↔student permission layer).
router.get("/students", authAny, loadMembership, async (req, res, next) => {
  try {
    const q = String(req.query.query || "").trim();
    const cls = String(req.query.class || "").trim();
    const filter = { schoolId: req.schoolId };
    if (req.query.includeInactive !== "1") filter.active = true; // mgmt view can see deactivated
    if (cls) filter.classGroup = cls;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ lastName: rx }, { firstName: rx }, { preferredName: rx }];
    }
    // Sorted grade → class → name so the client can group by grade directly.
    // Returns the whole roster when there's no query (for the grouped picker).
    const students = await BehaviorStudent.find(filter)
      .select("lastName firstName preferredName classGroup grade active houseId houseCaptain")
      .sort({ grade: 1, classGroup: 1, lastName: 1, firstName: 1 })
      .limit(q ? 50 : 2000)
      .lean();

    // Per-student active THRESHOLD count (for list colouring). Unspent incidents
    // within the fade window — spent ones already carry countedInNoticeId.
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const triggerCount = config?.triggerCount ?? 3;
    const cutoff = new Date(Date.now() - fadeDays * DAY_MS);
    const agg = await BehaviorIncident.aggregate([
      {
        $match: {
          schoolId: req.schoolId,
          studentId: { $in: students.map((s) => s._id) },
          countedInNoticeId: null,
          "behaviorSnapshot.triggerMode": "THRESHOLD",
          timestamp: { $gt: cutoff },
        },
      },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const cnt = Object.fromEntries(agg.map((a) => [String(a._id), a.n]));
    const out = students.map((s) => ({ ...s, activeCount: cnt[String(s._id)] || 0 }));
    res.json({ ok: true, students: out, triggerCount });
  } catch (err) {
    next(err);
  }
});

// Full cross-teacher status + history for a student.
router.get("/students/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const fadeDays = config?.fadeWindowDays ?? 30;
    const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
    const cutoff = Date.now() - fadeDays * DAY_MS;

    const incidents = await BehaviorIncident.find({ studentId: student._id })
      .sort({ timestamp: -1 })
      .limit(200)
      .lean();

    // Active count = THRESHOLD incidents within window, after reset, unspent.
    const activeCount = incidents.filter((inc) => {
      const mode = inc.behaviorSnapshot?.triggerMode || (inc.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
      return (
        mode === "THRESHOLD" &&
        !inc.countedInNoticeId &&
        new Date(inc.timestamp).getTime() > resetAt &&
        new Date(inc.timestamp).getTime() > cutoff
      );
    }).length;

    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: -1 }).lean();

    // Enrich incidents with the logging teacher's name for display.
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const incidentsOut = incidents.map((i) => ({ ...i, teacherName: tName[String(i.teacherId)] || "" }));

    res.json({
      ok: true,
      student,
      activeCount,
      triggerCount: config?.triggerCount ?? 3,
      noticesHomeCount: student.noticesHomeCount || 0,
      incidents: incidentsOut,
      notices,
    });
  } catch (err) {
    next(err);
  }
});

// Add a single student (admin) — used by the Setup "Add test student" button
// and any one-off addition outside a bulk import.
router.post("/students", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.lastName && !b.firstName && !b.preferredName) {
      return res.status(400).json({ ok: false, error: "A name is required" });
    }
    const parents = (Array.isArray(b.parents) ? b.parents : [])
      .filter((p) => p && (p.email || p.name || p.edsbyParentId))
      .map((p) => ({
        name: String(p.name || "").trim(),
        email: String(p.email || "").trim().toLowerCase(),
        edsbyParentId: String(p.edsbyParentId || "").trim(),
      }));
    const student = await BehaviorStudent.create({
      schoolId: req.schoolId,
      externalId: String(b.externalId || "").trim(),
      lastName: String(b.lastName || "").trim(),
      firstName: String(b.firstName || "").trim(),
      preferredName: String(b.preferredName || "").trim(),
      gender: String(b.gender || "").trim(),
      classGroup: String(b.classGroup || "").trim(),
      grade: String(b.grade || "").trim(),
      dob: b.dob ? new Date(b.dob) : null,
      parents,
    });
    await audit(req.schoolId, "student.created", req, {
      studentId: student._id,
      meta: { name: `${student.firstName} ${student.lastName}`.trim(), test: !!b.test },
    });
    res.json({ ok: true, student });
  } catch (err) {
    next(err);
  }
});

// Deactivate / reactivate a student (admin). Deactivating keeps the record +
// history but hides them from rosters/search — the safe default for a student
// who has left. Reversible.
router.patch("/students/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    if ("active" in b) $set.active = !!b.active;
    if ("houseId" in b) $set.houseId = b.houseId || null;
    if ("houseCaptain" in b) $set.houseCaptain = !!b.houseCaptain;
    if (!Object.keys($set).length) return res.status(400).json({ ok: false, error: "Nothing to update" });
    const student = await BehaviorStudent.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set },
      { new: true }
    ).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    if ("active" in b) await audit(req.schoolId, $set.active ? "student.reactivated" : "student.deactivated", req, { studentId: student._id });
    res.json({ ok: true, active: student.active, houseId: student.houseId, houseCaptain: student.houseCaptain });
  } catch (err) {
    next(err);
  }
});

// PERMANENTLY delete a student (admin) + cascade their incidents and notices.
// Irreversible — prefer PATCH deactivate for a student who simply left.
router.delete("/students/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const inc = await BehaviorIncident.deleteMany({ studentId: student._id });
    const not = await BehaviorNotice.deleteMany({ studentId: student._id });
    await BehaviorStudent.deleteOne({ _id: student._id });
    await audit(req.schoolId, "student.deleted", req, {
      studentId: student._id,
      meta: {
        name: `${student.firstName} ${student.lastName}`.trim(),
        incidentsRemoved: inc.deletedCount,
        noticesRemoved: not.deletedCount,
      },
    });
    res.json({ ok: true, incidentsRemoved: inc.deletedCount, noticesRemoved: not.deletedCount });
  } catch (err) {
    next(err);
  }
});

// ── Behaviours (§5a) ─────────────────────────────────────────────────────────

// Standard behaviours + this teacher's own custom ones (custom is private).
router.get("/behaviors", authAny, loadMembership, async (req, res, next) => {
  try {
    const behaviors = await Behavior.find({
      schoolId: req.schoolId,
      active: true,
      $or: [{ scope: "standard" }, { scope: "custom", ownerTeacherId: req.membership._id }],
    })
      .sort({ scope: 1, sortOrder: 1, name: 1 })
      .lean();
    res.json({ ok: true, behaviors });
  } catch (err) {
    next(err);
  }
});

// Add a behaviour. Admin may add a standard (shared) one; any teacher may add a
// custom (private) one.
// Upsert the standard behaviour set (admin) — adds any that are missing by name
// (case-insensitive), leaves existing ones untouched.
router.post("/behaviors/seed-standard", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const existing = await Behavior.find({ schoolId: req.schoolId }).select("name").lean();
    const have = new Set(existing.map((b) => String(b.name || "").trim().toLowerCase()));
    let created = 0;
    for (const b of STANDARD_BEHAVIORS) {
      if (have.has(b.name.trim().toLowerCase())) continue;
      await Behavior.create({
        schoolId: req.schoolId,
        name: b.name,
        keyword: b.keyword || "",
        description: b.description || "",
        consequenceText: b.consequenceText || "",
        triggerMode: b.triggerMode || "THRESHOLD",
        followUpType: b.followUpType || "none",
        kind: "negative",
        scope: "standard",
        ownerTeacherId: null,
      });
      created += 1;
    }
    await audit(req.schoolId, "behaviors.seed_standard", req, { meta: { created } });
    res.json({ ok: true, created, total: STANDARD_BEHAVIORS.length, skipped: STANDARD_BEHAVIORS.length - created });
  } catch (err) {
    next(err);
  }
});

router.post("/behaviors", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const isAdmin = ["originator", "admin"].includes(req.membership.role);
    const wantStandard = req.body?.scope === "standard" && isAdmin;
    const kind = req.body?.kind === "positive" ? "positive" : "negative";
    // A positive behaviour is a reward: it documents + awards points but never
    // counts as a strike or notifies, so its mode is always INTERACTION.
    const triggerMode = kind === "positive"
      ? "INTERACTION"
      : ["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(req.body?.triggerMode) ? req.body.triggerMode : "THRESHOLD";
    const doc = await Behavior.create({
      schoolId: req.schoolId,
      name: String(req.body?.name || "").trim(),
      description: String(req.body?.description || ""),
      keyword: String(req.body?.keyword || "").trim(),
      kind,
      triggerMode,
      consequenceText: kind === "positive" ? "" : String(req.body?.consequenceText || ""),
      points: Number(req.body?.points) || 0,
      followUpType: ["none", "next_school_day", "custom_deadline"].includes(req.body?.followUpType)
        ? req.body.followUpType
        : "none",
      scope: wantStandard ? "standard" : "custom",
      ownerTeacherId: wantStandard ? null : req.membership._id,
    });
    if (!doc.name) {
      await Behavior.deleteOne({ _id: doc._id });
      return res.status(400).json({ ok: false, error: "name required" });
    }
    await audit(req.schoolId, "behavior.created", req, { meta: { name: doc.name, scope: doc.scope } });
    res.json({ ok: true, behavior: doc });
  } catch (err) {
    next(err);
  }
});

// Can the caller manage this behaviour? Admin/originator for standard; the owner
// for a custom one. (Edits don't rewrite history — incidents snapshot at log time.)
function canManageBehavior(membership, beh) {
  if (beh.scope === "standard") return ["originator", "admin"].includes(membership.role);
  return String(beh.ownerTeacherId) === String(membership._id);
}

// Edit a behaviour (name, mode, consequence, follow-up, description).
router.put("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to edit this behaviour" });
    }
    const b = req.body || {};
    if ("name" in b) beh.name = String(b.name || "").trim();
    if ("description" in b) beh.description = String(b.description || "");
    if ("keyword" in b) beh.keyword = String(b.keyword || "").trim();
    if (b.kind === "positive" || b.kind === "negative") beh.kind = b.kind;
    if ("consequenceText" in b) beh.consequenceText = String(b.consequenceText || "");
    if (["THRESHOLD", "IMMEDIATE", "INTERACTION"].includes(b.triggerMode)) beh.triggerMode = b.triggerMode;
    if ("points" in b) beh.points = Number(b.points) || 0;
    // Positive behaviours never count/notify → force INTERACTION + no consequence.
    if (beh.kind === "positive") { beh.triggerMode = "INTERACTION"; beh.consequenceText = ""; }
    if (["none", "next_school_day", "custom_deadline"].includes(b.followUpType)) beh.followUpType = b.followUpType;
    if (typeof b.sortOrder === "number") beh.sortOrder = b.sortOrder;
    if (!beh.name) return res.status(400).json({ ok: false, error: "name required" });
    await beh.save();
    await audit(req.schoolId, "behavior.updated", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true, behavior: beh });
  } catch (err) {
    next(err);
  }
});

// Remove a behaviour (soft delete — keeps history snapshots intact).
router.delete("/behaviors/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const beh = await Behavior.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!beh) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    if (!canManageBehavior(req.membership, beh)) {
      return res.status(403).json({ ok: false, error: "Not allowed to remove this behaviour" });
    }
    beh.active = false;
    await beh.save();
    await audit(req.schoolId, "behavior.removed", req, { meta: { name: beh.name, scope: beh.scope } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Incident logging + trigger (§6, §7) ──────────────────────────────────────

router.post("/incidents", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const studentId = req.body?.studentId;
    const behaviorIds = Array.isArray(req.body?.behaviorIds)
      ? req.body.behaviorIds
      : req.body?.behaviorId
      ? [req.body.behaviorId]
      : [];
    const detailText = String(req.body?.detailText || "");
    // Optional event time (teacher may set/adjust when the incident occurred).
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();
    if (!studentId || !behaviorIds.length) {
      return res.status(400).json({ ok: false, error: "studentId and behaviorIds required" });
    }

    const student = await BehaviorStudent.findOne({ _id: studentId, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    // Create one append-only incident per selected behaviour, snapshotting the
    // behaviour wording so later edits don't rewrite history (§5a).
    const createdIncidents = [];
    for (const bId of behaviorIds) {
      const behavior = await Behavior.findOne({ _id: bId, schoolId: req.schoolId }).lean();
      if (!behavior) continue;
      const inc = await BehaviorIncident.create({
        schoolId: req.schoolId,
        studentId: student._id,
        teacherId: req.membership._id,
        behaviorId: behavior._id,
        behaviorSnapshot: {
          name: behavior.name,
          description: behavior.description,
          triggerMode: behavior.triggerMode,
          kind: behavior.kind || "negative",
          consequenceText: behavior.consequenceText,
          points: behavior.points || 0,
        },
        detailText,
        immediateFlag: behavior.triggerMode === "IMMEDIATE",
        timestamp,
      });
      createdIncidents.push(inc.toObject());

      // House points: apply this behaviour's point value to the student's house.
      if (behavior.points && student.houseId) {
        await HousePointEvent.create({
          schoolId: req.schoolId, houseId: student.houseId, studentId: student._id,
          points: behavior.points, reason: behavior.name, behaviorId: behavior._id,
          incidentId: inc._id, awardedByTeacherId: req.membership._id, at: timestamp,
        });
      }
    }
    if (!createdIncidents.length) {
      return res.status(400).json({ ok: false, error: "No valid behaviours" });
    }

    // Evaluate the trigger across ALL of the student's incidents (cross-teacher).
    const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
    let notice = null;
    if (req.body?.sendImmediately) {
      // Teacher chose "send now": fire a notice for these incidents PLUS any
      // accumulated queue, regardless of the behaviour's normal trigger mode.
      const createdIds = new Set(createdIncidents.map((i) => String(i._id)));
      const queued = activeThresholdIncidents(priorIncidents, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      }).filter((q) => !createdIds.has(String(q._id)));
      const sequenceNo = (student.noticesHomeCount || 0) + 1;
      notice = await fireNotice({
        req, student, config,
        decision: {
          shouldNotify: true,
          reason: "immediate",
          contributingIncidents: [...createdIncidents, ...queued],
          sequenceNo,
          ccVp: sequenceNo >= 2,
        },
      });
    } else {
      for (const inc of createdIncidents) {
        const others = priorIncidents.filter((p) => String(p._id) !== String(inc._id));
        const decision = evaluateIncident({
          newIncident: inc,
          priorIncidents: others,
          config: { triggerCount: config?.triggerCount ?? 3, fadeWindowDays: config?.fadeWindowDays ?? 30 },
          student,
        });
        if (decision.shouldNotify) {
          notice = await fireNotice({ req, student, config, decision });
          break; // one notice per submission; counter reset handled in fireNotice
        }
      }
    }

    // Independent POSITIVE trigger: when a positive was just logged, check whether
    // the student has accumulated enough positives for a good-news note home.
    let positiveNotice = null;
    if (createdIncidents.some((i) => (i.behaviorSnapshot?.points || 0) > 0)) {
      positiveNotice = await maybeFirePositiveNotice({ req, student, config });
    }

    // The incidents that make up the CURRENT trigger, for the teacher to review:
    // if a notice just fired, the incidents that fed it; otherwise the running
    // set still accumulating toward the threshold (cross-teacher). Enriched with
    // teacher name so the teacher sees who logged each one.
    let triggerRaw;
    if (notice) {
      triggerRaw = await BehaviorIncident.find({ studentId: student._id, countedInNoticeId: notice._id })
        .sort({ timestamp: 1 })
        .lean();
    } else {
      const all = await BehaviorIncident.find({ studentId: student._id }).lean();
      triggerRaw = activeThresholdIncidents(all, {
        fadeWindowDays: config?.fadeWindowDays ?? 30,
        thresholdResetAt: student.thresholdResetAt,
        asOf: new Date(),
      });
    }
    const tIds = [...new Set(triggerRaw.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const triggerIncidents = triggerRaw.map((i) => ({
      date: i.timestamp,
      teacher: tName[String(i.teacherId)] || "",
      offense: i.behaviorSnapshot?.name || "",
      comment: i.detailText || "",
    }));

    res.json({
      ok: true,
      incidents: createdIncidents.map((i) => ({ _id: i._id, behaviorName: i.behaviorSnapshot.name })),
      notice: notice ? { _id: notice._id, status: notice.status, cancelUntil: notice.cancelUntil, ccVp: notice.ccVp } : null,
      positiveNotice: positiveNotice ? { _id: positiveNotice._id, status: positiveNotice.status } : null,
      triggerIncidents,
      triggerCount: config?.triggerCount ?? 3,
    });
  } catch (err) {
    next(err);
  }
});

// Reverse/batch flow (§6): one behaviour applied to several students at once
// ("not ready for class — these 5"). Each student gets their own append-only
// incident, house-point deduction, and independent trigger evaluation; a notice
// that fires is queued for review on that student's page (no inline send dance).
router.post("/incidents/batch", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const behaviorId = req.body?.behaviorId;
    const studentIds = Array.isArray(req.body?.studentIds) ? req.body.studentIds : [];
    const detailText = String(req.body?.detailText || "");
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();
    if (!behaviorId || !studentIds.length) {
      return res.status(400).json({ ok: false, error: "behaviorId and studentIds required" });
    }

    const behavior = await Behavior.findOne({ _id: behaviorId, schoolId: req.schoolId }).lean();
    if (!behavior) return res.status(404).json({ ok: false, error: "Behaviour not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    const results = [];
    for (const sid of studentIds) {
      const student = await BehaviorStudent.findOne({ _id: sid, schoolId: req.schoolId });
      if (!student) continue;

      const inc = await BehaviorIncident.create({
        schoolId: req.schoolId,
        studentId: student._id,
        teacherId: req.membership._id,
        behaviorId: behavior._id,
        behaviorSnapshot: {
          name: behavior.name,
          description: behavior.description,
          triggerMode: behavior.triggerMode,
          kind: behavior.kind || "negative",
          consequenceText: behavior.consequenceText,
          points: behavior.points || 0,
        },
        detailText,
        immediateFlag: behavior.triggerMode === "IMMEDIATE",
        timestamp,
      });

      if (behavior.points && student.houseId) {
        await HousePointEvent.create({
          schoolId: req.schoolId, houseId: student.houseId, studentId: student._id,
          points: behavior.points, reason: behavior.name, behaviorId: behavior._id,
          incidentId: inc._id, awardedByTeacherId: req.membership._id, at: timestamp,
        });
      }

      const priorIncidents = await BehaviorIncident.find({ studentId: student._id }).lean();
      const others = priorIncidents.filter((p) => String(p._id) !== String(inc._id));
      const decision = evaluateIncident({
        newIncident: inc.toObject(),
        priorIncidents: others,
        config: { triggerCount: config?.triggerCount ?? 3, fadeWindowDays: config?.fadeWindowDays ?? 30 },
        student,
      });
      let notice = null;
      if (decision.shouldNotify) notice = await fireNotice({ req, student, config, decision });

      // Positive note home if this batch behaviour is a positive and the student
      // has now accumulated enough.
      let positiveNotice = null;
      if ((behavior.points || 0) > 0) {
        positiveNotice = await maybeFirePositiveNotice({ req, student, config });
      }

      results.push({
        studentId: String(student._id),
        name: `${student.preferredName || student.firstName} ${student.lastName}`.trim(),
        notice: notice ? { _id: notice._id, status: notice.status, ccVp: notice.ccVp } : null,
        positiveNotice: positiveNotice ? { _id: positiveNotice._id, status: positiveNotice.status } : null,
      });
    }

    await audit(req.schoolId, "incident.batch", req, { meta: { behavior: behavior.name, count: results.length } });
    res.json({ ok: true, logged: results.length, behaviorName: behavior.name, points: behavior.points || 0, results });
  } catch (err) {
    next(err);
  }
});

// Resolve the channels for a send: per-notice override, else the school default.
function resolveChannels(config, override) {
  if (Array.isArray(override) && override.length) {
    const c = override.filter((x) => ["email", "edsby"].includes(x));
    if (c.length) return c;
  }
  const c = [];
  if (config?.channels?.edsby) c.push("edsby");
  if (config?.channels?.email) c.push("email");
  return c.length ? c : ["email"];
}

// Double the first integer in a consequence string ("10× lines" -> "20× lines").
// Returns { text, changed } — changed=false for non-countable consequences.
function doubleConsequence(text) {
  const s = String(text || "");
  const m = s.match(/\d+/);
  if (!m) return { text: s, changed: false };
  const doubled = String(Number(m[0]) * 2);
  return { text: s.slice(0, m.index) + doubled + s.slice(m.index + m[0].length), changed: true };
}

/**
 * Shared core: compose the AI (or template) note, persist a queued notice, and
 * schedule its dispatch after the cancellable window. Used by both the incident
 * trigger path and the missed-consequence escalation.
 */
async function composeAndCreateNotice({
  schoolId, student, config, reason, sequenceNo, ccVp, sentByTeacherId,
  channels, consequenceTexts, fromTeachers, contextIncidents, triggeringIncidentIds, kind = "discipline",
}) {
  const isPositive = kind === "positive";
  const recipients = (student.parents || [])
    .filter((p) => p.email || p.edsbyParentId)
    .map((p) => ({ role: "parent", name: p.name, email: p.email, edsbyParentId: p.edsbyParentId }));
  if (ccVp && config?.vp?.email) {
    recipients.push({ role: "vp", name: config.vp.name, email: config.vp.email });
  }

  const firstTs = contextIncidents.length ? new Date(contextIncidents[0].timestamp).getTime() : Date.now();
  const daysSinceFirst = Math.max(0, Math.round((Date.now() - firstTs) / DAY_MS));
  const sender = await BehaviorTeacher.findById(sentByTeacherId).lean();
  const signature = (sender?.signature || config?.branding?.signatureBlock || "").trim();

  // Replace the legacy "nnn" name placeholder with the student's name; the AI
  // otherwise handles naming/pronouns naturally from studentName + pronoun.
  const studentName = student.preferredName || student.firstName || "your child";
  const personalize = (t) => String(t || "").replace(/\bnnn\b/gi, studentName);

  // Background history + recent positives are only relevant to the disciplinary
  // note. A positive (good-news) note is built purely from its own incidents.
  let history = null;
  let positives = [];
  if (!isPositive) {
    const contribIds = new Set((triggeringIncidentIds || []).map(String));
    const allInc = await BehaviorIncident.find({ studentId: student._id })
      .select("behaviorSnapshot.name timestamp")
      .lean();
    const priorInc = allInc.filter((i) => !contribIds.has(String(i._id)));
    const behaviourTypes = [...new Set(priorInc.map((i) => i.behaviorSnapshot?.name).filter(Boolean))];
    const lastPriorTs = priorInc.length ? Math.max(...priorInc.map((i) => new Date(i.timestamp).getTime())) : null;
    history = {
      priorNotices: Math.max(0, sequenceNo - 1),
      priorIncidentCount: priorInc.length,
      behaviourTypes,
      lastBeforeDays: lastPriorTs ? Math.round((Date.now() - lastPriorTs) / DAY_MS) : null,
    };

    // Recent POSITIVE behaviours (points > 0) to acknowledge as a balancing,
    // encouraging note within the disciplinary note.
    const positiveWindowDays = Math.max(30, (config?.fadeWindowDays ?? 30) * 2);
    const positiveInc = await BehaviorIncident.find({
      studentId: student._id,
      "behaviorSnapshot.points": { $gt: 0 },
      timestamp: { $gt: new Date(Date.now() - positiveWindowDays * DAY_MS) },
    })
      .sort({ timestamp: -1 })
      .limit(5)
      .lean();
    positives = positiveInc.map((i) => ({
      behaviorName: i.behaviorSnapshot?.name || "",
      date: i.timestamp,
      detail: personalize(i.detailText || ""),
    }));
  }

  const ctx = {
    studentName,
    pronoun: student.pronoun || "",
    history,
    positives,
    incidents: contextIncidents.map((i) => ({
      behaviorName: i.behaviorSnapshot?.name,
      teacherName: i.__teacherName || "",
      date: i.timestamp,
      detail: personalize(i.detailText || ""),
    })),
    consequences: consequenceTexts.map(personalize),
    sequenceNo,
    daysSinceFirst,
    schoolName: config?.branding?.schoolName || "",
    signature,
    toneGuidance: config?.branding?.toneGuidance || "",
    ccVp,
  };
  const aiClient = makeDefaultAiClient(config || {});
  const { text, aiUsed } = isPositive
    ? await composePositiveNotice(ctx, { aiClient })
    : await composeNotice(ctx, { aiClient });

  const cancelWindow = config?.cancelWindowSeconds ?? 60;
  const notice = await BehaviorNotice.create({
    schoolId, studentId: student._id, periodNo: 1, sequenceNo, reason,
    fromTeachers, triggeringIncidentIds, consequenceTexts, channels, recipients, ccVp,
    renderedText: text, aiUsed, status: "queued", sentByTeacherId,
    cancelUntil: new Date(Date.now() + cancelWindow * 1000),
    autoDispatch: config?.aiSendMode !== "draft",
  });
  if (config?.aiSendMode !== "draft") scheduleDispatch(notice._id, cancelWindow);
  return notice;
}

// Create open follow-up tasks for the behaviours in a notice that carry a
// follow-up type (brief §8b). Due = next school day at 9am.
async function createFollowups({ schoolId, student, config, contributingIncidents, sentByTeacherId, noticeId, multiplier = 1, missLevel = 0 }) {
  const byBehavior = new Map();
  for (const inc of contributingIncidents) if (inc.behaviorId) byBehavior.set(String(inc.behaviorId), inc);
  const due = nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] });
  const created = [];
  for (const [bid, inc] of byBehavior) {
    const beh = await Behavior.findById(bid).lean();
    if (!beh || beh.followUpType === "none") continue;
    created.push(
      await BehaviorFollowup.create({
        schoolId, studentId: student._id, behaviorId: bid, behaviorName: beh.name,
        consequenceText: inc.behaviorSnapshot?.consequenceText || beh.consequenceText,
        multiplier, missLevel, assignedByTeacherId: sentByTeacherId, noticeId, dueDate: due, status: "open",
      })
    );
  }
  return created;
}

/**
 * Fire a notice home from a trigger decision. Composes + queues the note, marks
 * contributing incidents spent, resets the shared threshold counter (threshold
 * notices only), and opens follow-up tasks for any consequence with a follow-up.
 */
async function fireNotice({ req, student, config, decision }) {
  const contributing = decision.contributingIncidents;
  const contribIds = contributing.map((i) => i._id);

  const teacherIds = [...new Set(contributing.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  for (const i of contributing) i.__teacherName = teacherById[String(i.teacherId)]?.name || "";
  const fromTeachers = contributing.map((i) => ({
    teacherId: i.teacherId,
    name: teacherById[String(i.teacherId)]?.name || "",
    behaviorName: i.behaviorSnapshot?.name || "",
  }));
  const consequenceTexts = [...new Set(contributing.map((i) => i.behaviorSnapshot?.consequenceText).filter(Boolean))];
  const channels = resolveChannels(config, req.body?.channelOverride);

  const notice = await composeAndCreateNotice({
    schoolId: req.schoolId, student, config, reason: decision.reason, sequenceNo: decision.sequenceNo,
    ccVp: decision.ccVp, sentByTeacherId: req.membership._id, channels, consequenceTexts, fromTeachers,
    contextIncidents: contributing, triggeringIncidentIds: contribIds,
  });

  await BehaviorIncident.updateMany(
    { _id: { $in: contribIds }, countedInNoticeId: null },
    { $set: { countedInNoticeId: notice._id } }
  );
  const counter = { $set: { lastNoticeAt: new Date() }, $inc: { noticesHomeCount: 1 } };
  if (decision.reason === "threshold") counter.$set.thresholdResetAt = new Date();
  await BehaviorStudent.updateOne({ _id: student._id }, counter);

  await createFollowups({
    schoolId: req.schoolId, student, config, contributingIncidents: contributing,
    sentByTeacherId: req.membership._id, noticeId: notice._id,
  });
  return notice;
}

/**
 * Fire a good-news note home when a student's accumulated positives cross the
 * positive threshold. Marks the celebrated positives so they don't re-fire; does
 * NOT touch the disciplinary counters, the VP, or follow-ups.
 */
async function firePositiveNotice({ req, student, config, contributingIncidents }) {
  const contribIds = contributingIncidents.map((i) => i._id);
  const teacherIds = [...new Set(contributingIncidents.map((i) => String(i.teacherId)))];
  const teachers = await BehaviorTeacher.find({ _id: { $in: teacherIds } }).lean();
  const teacherById = Object.fromEntries(teachers.map((t) => [String(t._id), t]));
  for (const i of contributingIncidents) i.__teacherName = teacherById[String(i.teacherId)]?.name || "";
  const fromTeachers = contributingIncidents.map((i) => ({
    teacherId: i.teacherId,
    name: teacherById[String(i.teacherId)]?.name || "",
    behaviorName: i.behaviorSnapshot?.name || "",
  }));

  const notice = await composeAndCreateNotice({
    schoolId: req.schoolId, student, config, reason: "positive", sequenceNo: 1, ccVp: false,
    sentByTeacherId: req.membership._id, channels: resolveChannels(config, req.body?.channelOverride),
    consequenceTexts: [], fromTeachers, contextIncidents: contributingIncidents,
    triggeringIncidentIds: contribIds, kind: "positive",
  });

  // Mark these positives celebrated so the next positive note starts fresh.
  await BehaviorIncident.updateMany(
    { _id: { $in: contribIds }, countedInNoticeId: null },
    { $set: { countedInNoticeId: notice._id } }
  );
  return notice;
}

// Evaluate + fire a positive note home if the student has crossed the positive
// threshold. Returns the notice (or null). Safe to call after any submission
// that logged at least one positive incident.
async function maybeFirePositiveNotice({ req, student, config }) {
  const all = await BehaviorIncident.find({ studentId: student._id }).lean();
  const decision = evaluatePositive({ incidents: all, config, student });
  if (!decision.shouldNotify) return null;
  return firePositiveNotice({ req, student, config, contributingIncidents: decision.contributingIncidents });
}

// Send a queued notice now — bypasses the auto-send window (and is the manual
// send for draft mode). "Don't send" is the cancel route below.
router.post("/notices/:id/send", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (!["queued", "failed"].includes(notice.status)) {
      return res.status(409).json({ ok: false, error: `Notice is already ${notice.status}` });
    }
    // Optional: weave in a request to meet with the parents, just before the
    // signature (idempotent).
    if (req.body?.requestMeeting && !/arrange a (?:brief )?meeting/i.test(notice.renderedText || "")) {
      const line = "We would also like to arrange a brief meeting to discuss this. Please reply with a few times that would work for you, and we'll do our best to accommodate.";
      const parts = String(notice.renderedText || "").split(/\n\n+/);
      if (parts.length >= 2) parts.splice(parts.length - 1, 0, line);
      else parts.push(line);
      notice.renderedText = parts.join("\n\n");
      await notice.save();
    }
    const result = await dispatchNotice(notice._id); // re-attempts delivery (e.g. after fixing Edsby)
    await audit(req.schoolId, "notice.sent_manual", req, { studentId: notice.studentId, noticeId: notice._id });
    res.json({ ok: result.ok !== false, status: result.status || (result.ok ? "sent" : "failed") });
  } catch (err) {
    next(err);
  }
});

// Cancel a queued notice during its cancellable window (§8 send model).
router.post("/notices/:id/cancel", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (notice.status !== "queued") {
      return res.status(409).json({ ok: false, error: `Cannot cancel a ${notice.status} notice` });
    }
    notice.status = "cancelled";
    await notice.save();
    await audit(req.schoolId, "notice.cancelled", req, { studentId: notice.studentId, noticeId: notice._id });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Single notice (communication-history detail view).
router.get("/notices/:id", authAny, loadMembership, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    res.json({ ok: true, notice });
  } catch (err) {
    next(err);
  }
});

// ── Consequence follow-ups + morning reminders (§8b) ─────────────────────────

// A teacher's open follow-ups (default: mine). ?due=today limits to due-by-today.
router.get("/followups", authAny, loadMembership, async (req, res, next) => {
  try {
    const filter = { schoolId: req.schoolId, status: "open" };
    if (req.query.mine !== "0") filter.assignedByTeacherId = req.membership._id;
    if (req.query.due === "today") {
      const end = new Date();
      end.setHours(23, 59, 59, 999);
      filter.dueDate = { $lte: end };
    }
    const followups = await BehaviorFollowup.find(filter).sort({ dueDate: 1 }).limit(200).lean();
    const sIds = [...new Set(followups.map((f) => String(f.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: sIds } })
      .select("firstName lastName preferredName classGroup")
      .lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    res.json({ ok: true, followups: followups.map((f) => ({ ...f, student: sById[String(f.studentId)] || null })) });
  } catch (err) {
    next(err);
  }
});

// Mark a follow-up Done / Not done / Waived. "Not done" escalates (§8b).
router.post("/followups/:id/status", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const status = req.body?.status;
    if (!["done", "not_done", "waived"].includes(status)) {
      return res.status(400).json({ ok: false, error: "status must be done | not_done | waived" });
    }
    const fu = await BehaviorFollowup.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!fu) return res.status(404).json({ ok: false, error: "Follow-up not found" });
    if (fu.status !== "open") return res.status(409).json({ ok: false, error: `Already ${fu.status}` });

    fu.status = status;
    fu.resolvedAt = new Date();
    fu.resolvedByTeacherId = req.membership._id;
    await fu.save();

    let escalation = null;
    if (status === "not_done") escalation = await escalateMissedConsequence(fu, req);
    await audit(req.schoolId, "followup.resolved", req, { studentId: fu.studentId, meta: { status, escalated: !!escalation } });
    res.json({ ok: true, escalation });
  } catch (err) {
    next(err);
  }
});

/**
 * Missed-consequence escalation (§8b): log a new incident, re-issue the
 * consequence doubled (once, capped at 2×), and send a new note home. A first
 * miss goes to parents; a second-or-later miss also CCs the VP. A fresh
 * follow-up is opened so the loop can be tracked.
 */
async function escalateMissedConsequence(fu, req) {
  const config = await BehaviorConfig.findOne({ schoolId: fu.schoolId }).lean();
  const student = await BehaviorStudent.findOne({ _id: fu.studentId });
  if (!student) return null;
  const beh = fu.behaviorId ? await Behavior.findById(fu.behaviorId).lean() : null;
  const sender = await BehaviorTeacher.findById(fu.assignedByTeacherId).lean();

  const newMissLevel = (fu.missLevel || 0) + 1;
  const firstMiss = newMissLevel === 1;

  // (a) Log a new (system-generated) incident for the missed consequence.
  const snapshot = {
    name: fu.behaviorName || beh?.name || "Missed consequence",
    description: beh?.description || "",
    triggerMode: "THRESHOLD",
    consequenceText: fu.consequenceText,
  };
  const sysInc = await BehaviorIncident.create({
    schoolId: fu.schoolId, studentId: student._id, teacherId: fu.assignedByTeacherId,
    behaviorId: fu.behaviorId || undefined, behaviorSnapshot: snapshot,
    detailText: `Missed consequence: ${fu.behaviorName}`, immediateFlag: false, systemGenerated: true,
  });

  // (b) Re-issue the consequence: double once (cap 2×); don't double again.
  let consequenceText = fu.consequenceText;
  let multiplier = fu.multiplier || 1;
  if (firstMiss) {
    const dbl = doubleConsequence(fu.consequenceText);
    consequenceText = dbl.text;
    if (dbl.changed) multiplier = Math.min(2, multiplier * 2);
  }

  // First miss → parents; second-or-later → parent + VP.
  const ccVp = newMissLevel >= 2;
  const sequenceNo = (student.noticesHomeCount || 0) + 1;
  const incObj = sysInc.toObject();
  incObj.__teacherName = sender?.name || "";

  const notice = await composeAndCreateNotice({
    schoolId: fu.schoolId, student, config, reason: "missed_consequence", sequenceNo, ccVp,
    sentByTeacherId: fu.assignedByTeacherId, channels: resolveChannels(config, null),
    consequenceTexts: [consequenceText],
    fromTeachers: [{ teacherId: fu.assignedByTeacherId, name: sender?.name || "", behaviorName: fu.behaviorName }],
    contextIncidents: [incObj], triggeringIncidentIds: [sysInc._id],
  });

  await BehaviorIncident.updateOne({ _id: sysInc._id }, { $set: { countedInNoticeId: notice._id } });
  await BehaviorStudent.updateOne({ _id: student._id }, { $inc: { noticesHomeCount: 1 }, $set: { lastNoticeAt: new Date() } });

  // (c) Open a fresh follow-up so the re-issued consequence is tracked too.
  const newFu = await BehaviorFollowup.create({
    schoolId: fu.schoolId, studentId: student._id, behaviorId: fu.behaviorId, behaviorName: fu.behaviorName,
    consequenceText, multiplier, missLevel: newMissLevel, assignedByTeacherId: fu.assignedByTeacherId,
    noticeId: notice._id, dueDate: nextSchoolDay(new Date(), { manualNonSchoolDays: config?.manualNonSchoolDays || [] }),
    status: "open",
  });

  return { noticeId: notice._id, followupId: newFu._id, missLevel: newMissLevel, multiplier, ccVp, consequenceText };
}

// Edit a queued notice's text before it sends (auto-send mode gives a window;
// editing extends that window so the edit isn't immediately swept out).
router.put("/notices/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const notice = await BehaviorNotice.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!notice) return res.status(404).json({ ok: false, error: "Notice not found" });
    if (!["queued", "failed"].includes(notice.status)) {
      return res.status(409).json({ ok: false, error: `Only queued or failed notices can be edited (this one is ${notice.status})` });
    }
    if (typeof req.body?.renderedText === "string") notice.renderedText = req.body.renderedText;
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    notice.cancelUntil = new Date(Date.now() + (config?.cancelWindowSeconds ?? 60) * 1000);
    await notice.save();
    await audit(req.schoolId, "notice.edited", req, { noticeId: notice._id, studentId: notice.studentId });
    res.json({ ok: true, notice: { _id: notice._id, renderedText: notice.renderedText, status: notice.status, cancelUntil: notice.cancelUntil } });
  } catch (err) {
    next(err);
  }
});

// Append a PRIVATE teacher note to an incident — internal documentation, never
// sent to parents, but included in the AI Admin Summary (§ teacher request).
router.post("/incidents/:id/notes", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ ok: false, error: "text required" });
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    inc.teacherNotes.push({ teacherId: req.membership._id, name: req.membership.name || "", text, at: new Date() });
    await inc.save();
    await audit(req.schoolId, "incident.note_added", req, { studentId: inc.studentId });
    res.json({ ok: true, teacherNotes: inc.teacherNotes });
  } catch (err) {
    next(err);
  }
});

// Can this teacher edit/delete this incident? The teacher who logged it, or an
// admin/originator.
function canEditIncident(membership, inc) {
  if (["originator", "admin"].includes(membership.role)) return true;
  return String(inc.teacherId) === String(membership._id);
}

// Edit an incident's detail text and/or its date/time (corrections).
router.put("/incidents/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    if (!canEditIncident(req.membership, inc)) return res.status(403).json({ ok: false, error: "Only the teacher who logged it (or an admin) can edit it." });
    if ("detailText" in (req.body || {})) inc.detailText = String(req.body.detailText || "");
    if (req.body?.occurredAt) {
      const d = new Date(req.body.occurredAt);
      if (!isNaN(d.getTime())) inc.timestamp = d;
    }
    await inc.save();
    await audit(req.schoolId, "incident.edited", req, { studentId: inc.studentId });
    res.json({ ok: true, incident: { _id: inc._id, detailText: inc.detailText, timestamp: inc.timestamp } });
  } catch (err) {
    next(err);
  }
});

// Delete an incident (a mis-log). Removes any house points it awarded. Strikes
// recompute automatically since they're derived from the incident rows.
router.delete("/incidents/:id", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const inc = await BehaviorIncident.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!inc) return res.status(404).json({ ok: false, error: "Incident not found" });
    if (!canEditIncident(req.membership, inc)) return res.status(403).json({ ok: false, error: "Only the teacher who logged it (or an admin) can delete it." });
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, incidentId: inc._id });
    await BehaviorIncident.deleteOne({ _id: inc._id });
    await audit(req.schoolId, "incident.deleted", req, { studentId: inc.studentId, meta: { behavior: inc.behaviorSnapshot?.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// AI "Admin Summary" for a student — scope "all" (full history) or "current"
// (just the active trigger incidents). Includes private teacher notes. Returns
// text for the client to copy to the clipboard. Fails safe to a plain digest.
// Email a behaviour summary to the requester (+ optional extra recipients, e.g.
// the VP). Confidential — branded shell, markdown-rendered, never to parents.
async function sendAdminSummaryEmail(req, name, schoolName, text, toRaw, studentId) {
  const extra = String(toRaw || "")
    .split(/[,\s;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(e));
  const to = [...new Set([req.user?.email, ...extra].filter(Boolean))];
  if (!to.length) return { emailed: false, emailError: "no recipient" };

  // Build the red/green timeline across the WHOLE record (incidents by kind +
  // legacy/notices-only offences as negative).
  const byMonth = {};
  const bump = (d, kind) => {
    const k = new Date(d).toISOString().slice(0, 7);
    byMonth[k] = byMonth[k] || { neg: 0, pos: 0 };
    byMonth[k][kind] += 1;
  };
  const incs = await BehaviorIncident.find({ studentId }).select("timestamp behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode").lean();
  for (const i of incs) {
    const pos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
    // Documented interactions (e.g. a logged parent meeting) are neutral — keep
    // them off the red/green chart so they don't read as offences.
    if (!pos && i.behaviorSnapshot?.triggerMode === "INTERACTION") continue;
    bump(i.timestamp, pos ? "pos" : "neg");
  }
  const nots = await BehaviorNotice.find({ studentId }).select("sentAt createdAt legacyImport triggeringIncidentIds").lean();
  for (const n of nots) {
    const backed = Array.isArray(n.triggeringIncidentIds) && n.triggeringIncidentIds.length > 0;
    if (n.legacyImport || !backed) bump(n.sentAt || n.createdAt, "neg");
  }
  // Positive tracking is new — caption the graph so a lone green bar isn't read
  // as a lack of positive recognition.
  const firstPositive = await BehaviorIncident.findOne({
    schoolId: req.schoolId,
    $or: [{ "behaviorSnapshot.kind": "positive" }, { "behaviorSnapshot.points": { $gt: 0 } }],
  }).sort({ timestamp: 1 }).select("timestamp").lean();
  const positivesNew = !firstPositive || Date.now() - new Date(firstPositive.timestamp).getTime() < 90 * DAY_MS;
  const chartCaption = positivesNew
    ? `<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">Positive recognition was recently introduced, so green is still ramping up.</p>`
    : "";

  const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
  try {
    await sendEmail({
      from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
      to,
      subject: `Behaviour summary — ${name}`,
      text,
      html: emailShell({
        title: `Behaviour summary — ${name}`,
        schoolName: schoolName || "Behaviours",
        preheader: `Confidential behaviour summary for ${name}.`,
        footnote: "Confidential — includes private teacher notes. For VP/principal; not sent to parents.",
        contentHtml:
          mdToHtml(text) +
          `<hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">` +
          `<h3 style="margin:0 0 6px;font-size:15px;color:#0f172a">Timeline (red = negative, green = positive)</h3>` +
          monthlyKindChartHtml(byMonth) +
          chartCaption,
      }),
    });
    return { emailed: true, emailError: "", recipients: to };
  } catch (e) {
    return { emailed: false, emailError: e?.message || String(e) };
  }
}

router.post("/students/:id/admin-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    const scope = req.body?.scope === "current" ? "current" : "all";
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId }).lean();
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();

    // Email an already-generated summary without re-running the AI.
    if (req.body?.email && req.body?.summaryText) {
      const nm = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
      const r = await sendAdminSummaryEmail(req, nm, config?.branding?.schoolName || "", String(req.body.summaryText), req.body.to, student._id);
      return res.json({ ok: true, summary: String(req.body.summaryText), emailed: r.emailed, emailError: r.emailError });
    }

    let incidents = await BehaviorIncident.find({ studentId: student._id }).sort({ timestamp: 1 }).lean();
    if (scope === "current") {
      const resetAt = student.thresholdResetAt ? new Date(student.thresholdResetAt).getTime() : 0;
      const cutoff = Date.now() - (config?.fadeWindowDays ?? 30) * DAY_MS;
      incidents = incidents.filter((i) => {
        const mode = i.behaviorSnapshot?.triggerMode || (i.immediateFlag ? "IMMEDIATE" : "THRESHOLD");
        return mode === "THRESHOLD" && !i.countedInNoticeId &&
          new Date(i.timestamp).getTime() > resetAt && new Date(i.timestamp).getTime() > cutoff;
      });
    }
    const tIds = [...new Set(incidents.map((i) => String(i.teacherId)))];
    const tDocs = await BehaviorTeacher.find({ _id: { $in: tIds } }).select("name").lean();
    const tName = Object.fromEntries(tDocs.map((t) => [String(t._id), t.name]));
    const lines = incidents.map((i) => {
      const d = new Date(i.timestamp).toLocaleString("en-CA");
      const notes = (i.teacherNotes || []).map((n) => `    • teacher note (${n.name || "teacher"}): ${n.text}`).join("\n");
      return `- ${d} — ${i.behaviorSnapshot?.name || ""}${i.detailText ? `: ${i.detailText}` : ""} [logged by ${tName[String(i.teacherId)] || "teacher"}]${notes ? `\n${notes}` : ""}`;
    });
    const notices = await BehaviorNotice.find({ studentId: student._id }).sort({ createdAt: 1 }).lean();
    // For "all", include the FULL note content — earlier/legacy offences often
    // exist only as notices home, so the note text is the record of what
    // happened. For "current", a brief line is enough.
    const noticeLines = notices.map((n) => {
      const date = new Date(n.sentAt || n.createdAt).toLocaleDateString("en-CA");
      if (scope !== "all") return `- ${date}: notice #${n.sequenceNo} (${n.reason}, ${n.status})`;
      const body = String(n.renderedText || "").replace(/\s+/g, " ").trim().slice(0, 600);
      return `- ${date} (notice #${n.sequenceNo}, ${n.status}): ${body || `(${n.reason})`}`;
    });

    const name = `${student.preferredName || student.firstName} ${student.lastName}`.trim();
    // Span across BOTH incidents and notices (legacy offences live in notices).
    const allTs = [
      ...incidents.map((i) => new Date(i.timestamp).getTime()),
      ...notices.map((n) => new Date(n.sentAt || n.createdAt).getTime()),
    ].filter((t) => t && !isNaN(t)).sort((a, b) => a - b);
    const span = allTs.length
      ? `${new Date(allTs[0]).toLocaleDateString("en-CA")} to ${new Date(allTs[allTs.length - 1]).toLocaleDateString("en-CA")}`
      : "—";

    // How staff have MANAGED this student — the diligence record. This summary
    // may be used to show a parent/administrator that the behaviour was handled
    // conscientiously, so surface every form of staff response, not just the
    // offences. Computed over the FULL student record regardless of scope, since
    // it describes the overall handling.
    const allIncs = scope === "all"
      ? incidents
      : await BehaviorIncident.find({ studentId: student._id }).select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode teacherNotes timestamp").lean();
    let offenceCount = 0, positiveCount = 0, interactionCount = 0, teacherNoteCount = 0;
    for (const i of allIncs) {
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = !isPositive && (i.behaviorSnapshot?.triggerMode === "INTERACTION");
      if (isPositive) positiveCount += 1;
      else if (isInteraction) interactionCount += 1;
      else offenceCount += 1;
      teacherNoteCount += i.teacherNotes?.length || 0;
    }
    const noticesSent = notices.filter((n) => n.status === "sent").length;
    const fuAgg = await BehaviorFollowup.aggregate([
      { $match: { schoolId: req.schoolId, studentId: student._id } },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const fu = { open: 0, done: 0, not_done: 0, waived: 0 };
    for (const f of fuAgg) fu[f._id] = f.n;
    const fuTotal = fu.open + fu.done + fu.not_done + fu.waived;
    const fuResolved = fu.done + fu.waived;
    const managementText =
      `\nHOW STAFF MANAGED THIS STUDENT (the diligence record — give this due weight; it shows the behaviour was handled, not ignored):\n` +
      `- Staff involved: ${tIds.length} teacher(s).\n` +
      `- Positive recognition given to this student: ${positiveCount}.\n` +
      `- Documented interactions / parent meetings logged: ${interactionCount}.\n` +
      `- Private documentation notes on incidents: ${teacherNoteCount}.\n` +
      `- Notices home to parents: ${notices.length} (${noticesSent} sent) — parents were kept informed.\n` +
      (fuTotal ? `- Consequence follow-through: ${fuResolved}/${fuTotal} consequence(s) with a follow-up were resolved (${fu.done} completed, ${fu.waived} waived), ${fu.not_done} missed, ${fu.open} still open.\n` : "");

    // GENERAL PRACTICE of the teacher most involved with this student — context
    // that the same standards are applied consistently across students, so the
    // handling of THIS student isn't read as singling them out or as poor
    // discipline. The teacher's own aggregate (counts only, no other names).
    const primaryAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, studentId: student._id } },
      { $group: { _id: "$teacherId", n: { $sum: 1 } } },
      { $sort: { n: -1 } }, { $limit: 1 },
    ]);
    const primaryTeacherId = primaryAgg[0]?._id || null;
    let practiceText = "";
    if (primaryTeacherId) {
      const pSince = new Date(); pSince.setMonth(pSince.getMonth() - 12);
      const gincs = await BehaviorIncident.find({ schoolId: req.schoolId, teacherId: primaryTeacherId, timestamp: { $gt: pSince } })
        .select("behaviorSnapshot.kind behaviorSnapshot.points behaviorSnapshot.triggerMode studentId").lean();
      let gOff = 0, gPos = 0, gInt = 0; const gStudents = new Set();
      for (const i of gincs) {
        const isPos = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
        const isInt = !isPos && i.behaviorSnapshot?.triggerMode === "INTERACTION";
        if (isPos) gPos += 1; else if (isInt) gInt += 1; else gOff += 1;
        gStudents.add(String(i.studentId));
      }
      const gfu = { done: 0, waived: 0, not_done: 0, open: 0 };
      const gfuAgg = await BehaviorFollowup.aggregate([
        { $match: { schoolId: req.schoolId, assignedByTeacherId: primaryTeacherId, createdAt: { $gt: pSince } } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]);
      for (const f of gfuAgg) gfu[f._id] = f.n;
      const gfuTotal = gfu.done + gfu.waived + gfu.not_done + gfu.open;
      const gfuPct = gfuTotal ? Math.round(((gfu.done + gfu.waived) / gfuTotal) * 100) : 0;
      const pName = tName[String(primaryTeacherId)] || (await BehaviorTeacher.findById(primaryTeacherId).select("name").lean())?.name || "this teacher";
      if (gincs.length || gfuTotal) {
        practiceText =
          `\nGENERAL PRACTICE of ${pName} (last 12 months, across ALL their students — for the 1-2 consistency sentences only):\n` +
          `- ${gOff} offence(s) handled across ${gStudents.size} different student(s), alongside ${gPos} positive recognition(s) and ${gInt} documented interaction(s).\n` +
          (gfuTotal ? `- Followed through on ${gfuPct}% of ${gfuTotal} consequence(s) that carried a follow-up.\n` : "");
      }
    }

    const ctxText =
      `Student: ${name}${student.classGroup ? ` (${student.classGroup})` : ""}.\n` +
      `Records on file: ${incidents.length} individually-logged incident(s) + ${notices.length} notice(s) home, spanning ${span}.\n` +
      (scope === "all" ? `NOTE: earlier offences may exist ONLY as notices home — treat each notice below as a record of past behaviour, not just a communication.\n` : "") +
      managementText +
      practiceText +
      `\n${scope === "current" ? "CURRENT trigger incidents" : "FULL incident history"} (incl. private teacher notes):\n${lines.join("\n") || "(none)"}\n\n` +
      `Notices home${scope === "all" ? " (full content = the record of earlier offences)" : ""}:\n${noticeLines.join("\n") || "(none)"}`;
    const prompt =
      `Write a thorough, objective summary of a student's behaviour record for a school administrator (VP/principal). ` +
      `It may be used to show — to an administrator or a parent — that staff have managed this student's behaviour conscientiously and fairly, so be comprehensive: cover BOTH the behaviour itself AND how staff responded (positive recognition given, parent meetings/interactions logged, notices home keeping parents informed, consequences followed through, and documentation kept). Give the staff-response record genuine weight; do not reduce the summary to a list of offences. ` +
      `Base your assessment on ALL the records below — BOTH the individually-logged incidents AND the notices home (which, especially for earlier events, are the only record of past offences). ` +
      `State the overall date range and the number of events on file (counting notices that describe offences), then cover the pattern, frequency, types of behaviour, any escalation, and what has been communicated home. ` +
      (practiceText ? `Also weave in 1-2 sentences (no more) — using the GENERAL PRACTICE figures — situating how this student was handled within the teacher's consistent, balanced approach across their other students (the same standards and follow-through applied to everyone, not singling this student out). Keep it factual; do not dump the raw practice numbers as a separate section. ` : "") +
      `Be factual and brief; you need not list every event, but the assessment must reflect the WHOLE record back to the earliest date. Use ONLY the data below — do not invent.\n\n${ctxText}`;

    let summary = `Behaviour summary — ${name}\n\n${ctxText}`; // deterministic fallback
    let aiUsed = false;
    try {
      const client = makeDefaultAiClient(config || {});
      if (client) {
        const out = await Promise.race([
          client.complete(prompt),
          new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 15000)),
        ]);
        if (out && String(out).trim()) { summary = String(out).trim(); aiUsed = true; }
      }
    } catch {
      /* fall back to the deterministic digest */
    }
    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const r = await sendAdminSummaryEmail(req, name, config?.branding?.schoolName || "", summary, req.body.to, student._id);
      emailed = r.emailed;
      emailError = r.emailError;
    }
    await audit(req.schoolId, "admin_summary.generated", req, { studentId: student._id, meta: { scope, aiUsed, emailed } });
    res.json({ ok: true, summary, aiUsed, scope, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Division/teacher EXECUTIVE summary — an AI overview over a 6/12-month window,
// scoped to me (this teacher) or all teachers. Behaviour trend, interaction
// patterns, notices home, current strike load. Copied to clipboard by the UI.
router.post("/executive-summary", authAny, loadMembership, async (req, res, next) => {
  try {
    const months = [3, 6, 12].includes(Number(req.body?.months)) ? Number(req.body.months) : 12;
    const scope = req.body?.scope === "me" ? "me" : "all";
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const triggerCount = config?.triggerCount ?? 3;
    const fadeDays = config?.fadeWindowDays ?? 30;

    const incMatch = { schoolId: req.schoolId, timestamp: { $gt: cutoff } };
    if (scope === "me") incMatch.teacherId = req.membership._id;
    const incidents = await BehaviorIncident.find(incMatch)
      .select("behaviorSnapshot.name behaviorSnapshot.triggerMode behaviorSnapshot.kind behaviorSnapshot.points timestamp studentId teacherNotes")
      .lean();

    // Classify every event into one of three distinct threads so the summary
    // reflects the whole picture, not just discipline:
    //   • offence     — a negative behaviour that counts toward strikes
    //   • positive     — a reward / good behaviour (kind positive or points > 0)
    //   • interaction  — a documented conversation/parent-meeting (INTERACTION
    //                    mode, not positive): kept for the record, no strike,
    //                    nothing sent home.
    const byType = {};          // offence types
    const posByType = {};       // positive types
    const byMonth = {};         // OFFENCE monthly volume (the discipline trend)
    const byMonthKind = {};     // { "YYYY-MM": { neg, pos } } red/green chart — offences vs positives only
    const bumpKind = (d, kind) => {
      const k = new Date(d).toISOString().slice(0, 7);
      byMonthKind[k] = byMonthKind[k] || { neg: 0, pos: 0 };
      byMonthKind[k][kind] += 1;
    };
    const students = new Set();
    let teacherNoteCount = 0;
    let offenceCount = 0, positiveCount = 0, interactionCount = 0;
    for (const i of incidents) {
      const nm = i.behaviorSnapshot?.name || "Other";
      const mode = i.behaviorSnapshot?.triggerMode || "THRESHOLD";
      const isPositive = i.behaviorSnapshot?.kind === "positive" || (i.behaviorSnapshot?.points || 0) > 0;
      const isInteraction = !isPositive && mode === "INTERACTION";
      students.add(String(i.studentId));
      teacherNoteCount += i.teacherNotes?.length || 0;
      if (isPositive) {
        positiveCount += 1;
        posByType[nm] = (posByType[nm] || 0) + 1;
        bumpKind(i.timestamp, "pos");
      } else if (isInteraction) {
        // Documented interaction — neutral; not an offence and not on the chart.
        interactionCount += 1;
      } else {
        offenceCount += 1;
        byType[nm] = (byType[nm] || 0) + 1;
        const mk = new Date(i.timestamp).toISOString().slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + 1;
        bumpKind(i.timestamp, "neg");
      }
    }
    const notMatch = { schoolId: req.schoolId, createdAt: { $gt: cutoff } };
    if (scope === "me") notMatch.sentByTeacherId = req.membership._id;
    const notices = await BehaviorNotice.find(notMatch)
      .select("reason status studentId sentAt createdAt legacyImport triggeringIncidentIds")
      .lean();
    const noticeByReason = {};
    for (const n of notices) noticeByReason[n.reason] = (noticeByReason[n.reason] || 0) + 1;
    const noticesSent = notices.filter((n) => n.status === "sent").length;

    // Earlier/legacy offences often exist ONLY as notices home (no individual
    // incident row). Fold those into the monthly trend + student set so the
    // history isn't undercounted — but skip notices backed by counted incidents
    // (modern flow) to avoid double-counting.
    let legacyOffences = 0;
    for (const n of notices) {
      const backed = Array.isArray(n.triggeringIncidentIds) && n.triggeringIncidentIds.length > 0;
      if (n.legacyImport || !backed) {
        legacyOffences += 1;
        const mk = new Date(n.sentAt || n.createdAt).toISOString().slice(0, 7);
        byMonth[mk] = (byMonth[mk] || 0) + 1;
        bumpKind(n.sentAt || n.createdAt, "neg");
        if (n.studentId) students.add(String(n.studentId));
      }
    }
    const topTypes = Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const monthly = Object.keys(byMonth).sort().map((k) => `${k}: ${byMonth[k]}`);

    // Division current strike load (shared count — not per-teacher).
    const agg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, countedInNoticeId: null, "behaviorSnapshot.triggerMode": "THRESHOLD", timestamp: { $gt: new Date(Date.now() - fadeDays * DAY_MS) } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const atThreshold = agg.filter((a) => a.n >= triggerCount - 1).length;

    // Follow-through diligence: of consequences that carried a follow-up, how
    // many did the teacher/division actually resolve vs let slip. This is a
    // record of conscientiousness — valuable when the summary is used to
    // represent how thoroughly someone manages behaviour.
    const fuMatch = { schoolId: req.schoolId, createdAt: { $gt: cutoff } };
    if (scope === "me") fuMatch.assignedByTeacherId = req.membership._id;
    const fuAgg = await BehaviorFollowup.aggregate([
      { $match: fuMatch },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ]);
    const fu = { open: 0, done: 0, not_done: 0, waived: 0 };
    for (const f of fuAgg) fu[f._id] = f.n;
    const fuTotal = fu.open + fu.done + fu.not_done + fu.waived;
    const fuResolved = fu.done + fu.waived;
    const fuResolvedPct = fuTotal ? Math.round((fuResolved / fuTotal) * 100) : 0;

    // Distinct active months — a span of steady engagement, not a one-off burst.
    const activeMonths = Object.keys(byMonth).length;

    // Positive behaviours are a new feature — flag it so a low positive count
    // isn't read as the teacher/division being "unbalanced".
    const firstPositive = await BehaviorIncident.findOne({
      schoolId: req.schoolId,
      $or: [{ "behaviorSnapshot.kind": "positive" }, { "behaviorSnapshot.points": { $gt: 0 } }],
    }).sort({ timestamp: 1 }).select("timestamp").lean();
    const positivesNew = !firstPositive || Date.now() - new Date(firstPositive.timestamp).getTime() < 90 * DAY_MS;
    const positiveNote = positivesNew
      ? `\nNOTE: positive-behaviour recognition was only recently introduced${firstPositive ? ` (first positive logged ${new Date(firstPositive.timestamp).toLocaleDateString("en-CA")})` : ""}. The small number of positive events (${positiveCount}) reflects that it is NEW — do NOT characterise the teacher/division as unbalanced, lacking positives, or skewed toward discipline; if anything, note that positive tracking is just getting underway.`
      : "";

    const who = scope === "me" ? (req.membership.name || "this teacher") : "all teachers (division-wide)";
    const totalOffences = offenceCount + legacyOffences;
    const topPosTypes = Object.entries(posByType).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ctxText =
      `Window: last ${months} months (since ${cutoff.toISOString().slice(0, 10)}). Scope: ${who}.\n` +
      `Students involved (any event type): ${students.size}.\n` +
      `\nThree DISTINCT threads — keep them separate, do not conflate:\n` +
      `1) OFFENCES (negative behaviour, counts toward strikes): ${totalOffences} total — ${offenceCount} logged as individual incidents in the app` +
      `${legacyOffences ? `, plus ${legacyOffences} earlier offence(s) that exist ONLY as historical notices home (from a one-time import of past paper records)` : ""}.\n` +
      (legacyOffences
        ? `   RECONCILIATION (important — do not contradict): those ${legacyOffences} historical notices ARE offences and are already counted in the ${totalOffences} offence total and the monthly volume below. The "${notices.length} notices home" figure overlaps with them — it is NOT additional events. Do NOT state there were more notices than offences, and do NOT headline the small "${offenceCount}" logged-incident number as the year's total; use ${totalOffences} total offences.\n`
        : "") +
      `2) POSITIVE recognitions (rewards / good behaviour — NEVER a strike): ${positiveCount}${topPosTypes.length ? ` — e.g. ${topPosTypes.map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}.\n` +
      `3) Documented INTERACTIONS (conversations & parent meetings logged for the record — no note home, no strike; relationship-building / proactive engagement): ${interactionCount}.\n` +
      `\nBy offence type: ${topTypes.map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n` +
      `Engagement span: activity recorded across ${activeMonths} distinct month(s) of the window.\n` +
      `Documentation diligence: ${teacherNoteCount} private teacher note(s) recorded alongside incidents.\n` +
      `Monthly OFFENCE volume (incidents + historical notices): ${monthly.join("; ") || "n/a"}.\n` +
      `Parent communication: ${notices.length} notice(s) home created (${noticesSent} sent) — by reason: ${Object.entries(noticeByReason).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}.\n` +
      `Consequence follow-through: of ${fuTotal} consequence(s) that carried a follow-up, ${fuResolved} were resolved (${fu.done} completed, ${fu.waived} waived) — ${fuResolvedPct}% — with ${fu.not_done} missed and ${fu.open} still open.\n` +
      `Current strike load (division, shared count): ${atThreshold} student(s) at or one away from the ${triggerCount}-strike trigger.` +
      positiveNote;
    const prompt =
      `You are writing a COMPREHENSIVE executive summary for a teacher reflecting on their classroom-behaviour management over the period. ` +
      `This summary may later be used by the teacher to represent the full, fair picture of how conscientiously they manage behaviour — so be thorough and give due weight to every form of engagement, not just discipline. Do not omit a thread because its number is small. ` +
      `Cover, as distinct threads: (1) how things are going overall and the OFFENCE trend across the window (improving / worsening / steady, citing the monthly offence volumes — use the ${totalOffences} total offences, not just the logged-incident count); ` +
      `(2) POSITIVE recognition — how positives are being used to reinforce good behaviour (${positiveCount} in the window); ` +
      `(3) documented INTERACTIONS (${interactionCount}) such as conversations and parent meetings logged for the record — proactive, relationship-building engagement that is NOT discipline; ` +
      `(4) thoroughness and follow-through — parent communication (${notices.length} notice(s) home), consequence follow-through (${fuResolvedPct}% of ${fuTotal} resolved), documentation via ${teacherNoteCount} private note(s), and steady engagement across ${activeMonths} month(s); ` +
      `${scope === "me" ? "this teacher's overall engagement style, including the balance of positives and documented interactions vs. discipline, and the diligence shown in following process through;" : "patterns across the division and which behaviours dominate;"} ` +
      `and the current load. Keep the figures internally consistent (never more notices than total offences; positives and interactions are NOT offences and must not be added into the offence count). Be objective, balanced, fair and professional — suitable to share with an administrator or for personal reflection. Do not exaggerate or editorialise; let the comprehensiveness come from covering every thread accurately. Use ONLY the data; do not invent. A few short paragraphs.\n\n${ctxText}`;

    let summary = `Executive summary — ${who} (last ${months} months)\n\n${ctxText}`;
    let aiUsed = false;
    const provided = String(req.body?.summaryText || "").trim();
    if (provided) {
      summary = provided; // emailing an already-generated summary — skip the AI re-call
      aiUsed = true;
    } else {
      try {
        const client = makeDefaultAiClient(config || {});
        if (client) {
          const out = await Promise.race([client.complete(prompt), new Promise((_, r) => setTimeout(() => r(new Error("AI timeout")), 15000))]);
          if (out && String(out).trim()) { summary = String(out).trim(); aiUsed = true; }
        }
      } catch {
        /* deterministic digest fallback */
      }
    }

    // Email path — HTML with a red/green monthly timeline so the graph +
    // formatting are preserved (clipboard text can't carry either).
    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const html = emailShell({
        title: "Executive summary",
        schoolName: config?.branding?.schoolName || "Behaviours",
        preheader: `${who} · last ${months} months`,
        contentHtml:
          `<p style="color:#64748b;margin:0 0 16px">${escapeHtml(who)} · last ${months} months</p>` +
          mdToHtml(summary) +
          `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0">` +
          `<h3 style="margin:0 0 6px;font-size:15px;color:#0f172a">Monthly volume (red = negative, green = positive)</h3>${monthlyKindChartHtml(byMonthKind)}` +
          (positivesNew ? `<p style="font-size:11px;color:#94a3b8;margin:6px 0 0">Positive recognition was recently introduced, so green is still ramping up.</p>` : ""),
      });
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      const extra = String(req.body?.to || "")
        .split(/[,\s;]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(e));
      const to = [...new Set([req.user.email, ...extra].filter(Boolean))];
      try {
        await sendEmail({
          from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
          to,
          subject: `Behaviours executive summary — ${who} (last ${months} months)`,
          text: summary,
          html,
        });
        emailed = true;
      } catch (mailErr) {
        emailError = mailErr?.message || String(mailErr);
      }
    }

    await audit(req.schoolId, "executive_summary.generated", req, { meta: { scope, months, aiUsed, emailed } });
    res.json({ ok: true, summary, aiUsed, scope, months, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// Aggregated stats for the in-app reports/charts (Phase 4).
router.get("/stats", authAny, loadMembership, async (req, res, next) => {
  try {
    const months = [6, 12, 24].includes(Number(req.query.months)) ? Number(req.query.months) : 12;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    cutoff.setDate(1);
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const triggerCount = config?.triggerCount ?? 3;
    const fadeDays = config?.fadeWindowDays ?? 30;
    const pad = (n) => String(n).padStart(2, "0");

    const incidents = await BehaviorIncident.find({ schoolId: req.schoolId, timestamp: { $gt: cutoff } })
      .select("behaviorSnapshot.name behaviorSnapshot.triggerMode timestamp studentId")
      .lean();
    const studentsAll = await BehaviorStudent.find({ schoolId: req.schoolId }).select("classGroup").lean();
    const classById = Object.fromEntries(studentsAll.map((s) => [String(s._id), s.classGroup || "—"]));

    const incByMonth = {};
    const byType = {};
    const byClass = {};
    const byMode = { THRESHOLD: 0, IMMEDIATE: 0, INTERACTION: 0 };
    for (const i of incidents) {
      const mk = new Date(i.timestamp).toISOString().slice(0, 7);
      incByMonth[mk] = (incByMonth[mk] || 0) + 1;
      const nm = i.behaviorSnapshot?.name || "Other";
      byType[nm] = (byType[nm] || 0) + 1;
      const cls = classById[String(i.studentId)] || "—";
      byClass[cls] = (byClass[cls] || 0) + 1;
      const mode = i.behaviorSnapshot?.triggerMode || "THRESHOLD";
      byMode[mode] = (byMode[mode] || 0) + 1;
    }

    const notices = await BehaviorNotice.find({ schoolId: req.schoolId, createdAt: { $gt: cutoff } }).select("createdAt status").lean();
    const notByMonth = {};
    let noticesSent = 0;
    for (const n of notices) {
      notByMonth[new Date(n.createdAt).toISOString().slice(0, 7)] = (notByMonth[new Date(n.createdAt).toISOString().slice(0, 7)] || 0) + 1;
      if (n.status === "sent") noticesSent++;
    }

    // Continuous month axis (fill gaps with zeros).
    const axis = [];
    const d = new Date(cutoff);
    const now = new Date();
    while (d <= now) {
      axis.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
      d.setMonth(d.getMonth() + 1);
    }
    const monthly = axis.map((mk) => ({ month: mk, incidents: incByMonth[mk] || 0, notices: notByMonth[mk] || 0 }));

    // Current strike load (shared count).
    const agg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, countedInNoticeId: null, "behaviorSnapshot.triggerMode": "THRESHOLD", timestamp: { $gt: new Date(Date.now() - fadeDays * DAY_MS) } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const strikeBuckets = [];
    for (let k = 1; k <= triggerCount; k++) {
      strikeBuckets.push({
        strikes: k >= triggerCount ? `${triggerCount}+` : String(k),
        students: agg.filter((a) => (k >= triggerCount ? a.n >= triggerCount : a.n === k)).length,
      });
    }
    const activeStudents = await BehaviorStudent.countDocuments({ schoolId: req.schoolId, active: true });

    res.json({
      ok: true,
      months,
      triggerCount,
      totals: {
        incidents: incidents.length,
        notices: notices.length,
        noticesSent,
        students: activeStudents,
        atOrNearThreshold: agg.filter((a) => a.n >= triggerCount - 1).length,
        interactions: byMode.INTERACTION,
      },
      monthly,
      topTypes: Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => ({ type, count })),
      classCounts: Object.entries(byClass).sort((a, b) => a[0].localeCompare(b[0])).map(([cls, count]) => ({ class: cls, count })),
      modePie: [
        { name: "Threshold", value: byMode.THRESHOLD },
        { name: "Immediate", value: byMode.IMMEDIATE },
        { name: "Interaction", value: byMode.INTERACTION },
      ],
      strikeBuckets,
    });
  } catch (err) {
    next(err);
  }
});

// ── Parent meeting / contact log (no strike, no note home) ───────────────────
// A teacher records that a meeting or contact happened. Logged as an
// INTERACTION incident so it lives in the student's history for context but
// never counts toward a notice and never sends anything home (§5a).
router.post("/students/:id/meeting", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const student = await BehaviorStudent.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!student) return res.status(404).json({ ok: false, error: "Student not found" });

    const detailText = String(req.body?.detailText || "").trim();
    if (!detailText) return res.status(400).json({ ok: false, error: "Please add a short note about the meeting." });
    const occurredAt = req.body?.occurredAt ? new Date(req.body.occurredAt) : null;
    const timestamp = occurredAt && !isNaN(occurredAt.getTime()) ? occurredAt : new Date();

    // Find-or-create the shared "Parent meeting / contact" interaction behaviour.
    let beh = await Behavior.findOne({ schoolId: req.schoolId, name: "Parent meeting / contact" });
    if (!beh) {
      beh = await Behavior.create({
        schoolId: req.schoolId,
        name: "Parent meeting / contact",
        keyword: "meeting",
        kind: "negative",
        triggerMode: "INTERACTION",
        description: "A logged meeting or contact with a parent/guardian — kept for the record. Does not count as a strike and sends nothing home.",
        consequenceText: "",
        points: 0,
      });
    }

    const inc = await BehaviorIncident.create({
      schoolId: req.schoolId,
      studentId: student._id,
      teacherId: req.membership._id,
      behaviorId: beh._id,
      behaviorSnapshot: {
        name: beh.name,
        description: beh.description,
        triggerMode: "INTERACTION",
        kind: "negative",
        consequenceText: "",
        points: 0,
      },
      detailText,
      immediateFlag: false,
      timestamp,
    });
    await audit(req.schoolId, "meeting.log", req, { studentId: String(student._id), incidentId: String(inc._id) });
    res.json({ ok: true, incident: inc.toObject() });
  } catch (err) {
    next(err);
  }
});

// ── Intervention view (admin/VP read-only, school-wide) ──────────────────────
// Who needs attention right now: students at/near the strike threshold, the
// most-logged students, and a per-class breakdown. Read-only, admin only.
router.get("/intervention", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const triggerCount = config?.triggerCount ?? 3;
    const fadeDays = config?.fadeWindowDays ?? 30;
    const fadeCutoff = new Date(Date.now() - fadeDays * DAY_MS);

    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true })
      .select("firstName preferredName lastName grade classGroup noticesHomeCount")
      .lean();
    const sById = Object.fromEntries(students.map((s) => [String(s._id), s]));
    const nameOf = (s) => (s ? `${s.preferredName || s.firstName} ${s.lastName || ""}`.trim() : "—");

    // Current strike load (uncounted THRESHOLD incidents within the fade window).
    const strikeAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, countedInNoticeId: null, "behaviorSnapshot.triggerMode": "THRESHOLD", timestamp: { $gt: fadeCutoff } } },
      { $group: { _id: "$studentId", strikes: { $sum: 1 }, last: { $max: "$timestamp" } } },
    ]);
    const atThreshold = strikeAgg
      .filter((a) => a.strikes >= triggerCount - 1 && sById[String(a._id)])
      .map((a) => ({
        studentId: String(a._id),
        name: nameOf(sById[String(a._id)]),
        classGroup: sById[String(a._id)].classGroup || "—",
        grade: sById[String(a._id)].grade || "—",
        strikes: a.strikes,
        triggerCount,
        lastAt: a.last,
      }))
      .sort((a, b) => b.strikes - a.strikes || new Date(b.lastAt) - new Date(a.lastAt));

    // Most-logged students over the last 90 days (all incidents, any mode).
    const since = new Date(Date.now() - 90 * DAY_MS);
    const repeatAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, timestamp: { $gt: since } } },
      { $group: { _id: "$studentId", n: { $sum: 1 }, last: { $max: "$timestamp" } } },
      { $sort: { n: -1 } },
      { $limit: 15 },
    ]);
    const topRepeat = repeatAgg
      .filter((a) => sById[String(a._id)])
      .map((a) => ({
        studentId: String(a._id),
        name: nameOf(sById[String(a._id)]),
        classGroup: sById[String(a._id)].classGroup || "—",
        count: a.n,
        lastAt: a.last,
      }));

    // Per-class incident counts over the same 90-day window.
    const byClassAgg = await BehaviorIncident.aggregate([
      { $match: { schoolId: req.schoolId, timestamp: { $gt: since } } },
      { $group: { _id: "$studentId", n: { $sum: 1 } } },
    ]);
    const classCounts = {};
    for (const a of byClassAgg) {
      const cls = sById[String(a._id)]?.classGroup || "—";
      classCounts[cls] = (classCounts[cls] || 0) + a.n;
    }
    const byClass = Object.entries(classCounts)
      .map(([classGroup, count]) => ({ classGroup, count }))
      .sort((a, b) => b.count - a.count || a.classGroup.localeCompare(b.classGroup));

    res.json({ ok: true, triggerCount, fadeDays, atThreshold, topRepeat, byClass });
  } catch (err) {
    next(err);
  }
});

// ── Houses + points ──────────────────────────────────────────────────────────

// Houses with their point totals + member counts (for the leaderboard).
router.get("/houses", authAny, loadMembership, async (req, res, next) => {
  try {
    // Master switch: when Houses is off, the whole aspect is hidden — report no
    // houses so every consumer surface (leaderboard, assignment dropdown) hides.
    const cfg = await BehaviorConfig.findOne({ schoolId: req.schoolId }).select("housesEnabled housePointsResetAt").lean();
    if (!cfg?.housesEnabled) return res.json({ ok: true, enabled: false, houses: [] });

    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const pointMatch = { schoolId: req.schoolId };
    if (cfg.housePointsResetAt) pointMatch.at = { $gt: new Date(cfg.housePointsResetAt) };
    const totals = await HousePointEvent.aggregate([
      { $match: pointMatch },
      { $group: { _id: "$houseId", points: { $sum: "$points" } } },
    ]);
    const totalById = Object.fromEntries(totals.map((t) => [String(t._id), t.points]));
    const members = await BehaviorStudent.aggregate([
      { $match: { schoolId: req.schoolId, active: true, houseId: { $ne: null } } },
      { $group: { _id: "$houseId", n: { $sum: 1 } } },
    ]);
    const memberById = Object.fromEntries(members.map((m) => [String(m._id), m.n]));
    res.json({
      ok: true,
      enabled: true,
      resetAt: cfg.housePointsResetAt || null,
      houses: houses
        .map((h) => ({ ...h, points: totalById[String(h._id)] || 0, members: memberById[String(h._id)] || 0 }))
        .sort((a, b) => b.points - a.points),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/houses", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const house = await BehaviorHouse.create({
      schoolId: req.schoolId, name, color: req.body?.color || "#0f172a", sortOrder: Number(req.body?.sortOrder) || 0,
    });
    await audit(req.schoolId, "house.created", req, { meta: { name } });
    res.json({ ok: true, house });
  } catch (err) {
    next(err);
  }
});

router.put("/houses/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    if ("name" in b) $set.name = String(b.name || "").trim();
    if ("color" in b) $set.color = String(b.color || "#0f172a");
    if ("sortOrder" in b) $set.sortOrder = Number(b.sortOrder) || 0;
    const house = await BehaviorHouse.findOneAndUpdate({ _id: req.params.id, schoolId: req.schoolId }, { $set }, { new: true }).lean();
    if (!house) return res.status(404).json({ ok: false, error: "House not found" });
    res.json({ ok: true, house });
  } catch (err) {
    next(err);
  }
});

router.delete("/houses/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const house = await BehaviorHouse.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!house) return res.status(404).json({ ok: false, error: "House not found" });
    await audit(req.schoolId, "house.removed", req, { meta: { name: house.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Award (or deduct) house points — to a whole house, or to a student (whose
// house gets the points). Positive or negative.
router.post("/house-points", authAny, loadMembership, canLog, async (req, res, next) => {
  try {
    const points = Number(req.body?.points);
    if (!points || isNaN(points)) return res.status(400).json({ ok: false, error: "points must be a non-zero number" });
    let houseId = req.body?.houseId || null;
    let studentId = req.body?.studentId || null;
    if (studentId) {
      const stu = await BehaviorStudent.findOne({ _id: studentId, schoolId: req.schoolId }).select("houseId").lean();
      if (!stu) return res.status(404).json({ ok: false, error: "Student not found" });
      houseId = houseId || stu.houseId;
      if (!houseId) return res.status(400).json({ ok: false, error: "That student isn't assigned to a house" });
    }
    if (!houseId) return res.status(400).json({ ok: false, error: "houseId or a student with a house required" });
    const event = await HousePointEvent.create({
      schoolId: req.schoolId, houseId, studentId, points,
      reason: String(req.body?.reason || ""), awardedByTeacherId: req.membership._id,
    });
    await audit(req.schoolId, "house.points", req, { studentId, meta: { houseId: String(houseId), points } });
    res.json({ ok: true, event });
  } catch (err) {
    next(err);
  }
});

// Population variance of a list of numbers (for balancing).
function variance(arr) {
  const n = arr.length || 1;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  return arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n;
}

// Balanced house assignment. Two modes:
//   full (default)     — (re)create the four starter houses, deactivate others,
//                        and reassign ALL active students from scratch.
//   mode:"unassigned"  — keep current assignments + houses; only place students
//                        who have no house, fitting them into the existing
//                        houses to keep things balanced. Siblings (same surname)
//                        join the house their family is already in.
// In both modes families (same last name) stay together and placement greedily
// minimises imbalance across total size, grade spread, and gender mix.
router.post("/houses/backfill", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const onlyUnassigned = req.body?.mode === "unassigned" || req.body?.onlyUnassigned === true;
    const NAMES = Array.isArray(req.body?.names) && req.body.names.length
      ? req.body.names.map((n) => String(n).trim()).filter(Boolean)
      : ["Alpha", "Beta", "Delta", "Gamma"];
    const COLORS = ["#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];

    // Choose the houses to assign into.
    let houses = [];
    let deactivatedCount = 0;
    if (onlyUnassigned) {
      houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).sort({ sortOrder: 1, name: 1 });
      if (!houses.length) {
        for (let i = 0; i < NAMES.length; i++) {
          houses.push(await BehaviorHouse.create({ schoolId: req.schoolId, name: NAMES[i], color: COLORS[i % COLORS.length], sortOrder: i }));
        }
      }
    } else {
      for (let i = 0; i < NAMES.length; i++) {
        const name = NAMES[i];
        let h = await BehaviorHouse.findOne({ schoolId: req.schoolId, name });
        if (!h) h = await BehaviorHouse.create({ schoolId: req.schoolId, name, color: COLORS[i % COLORS.length], sortOrder: i });
        else if (!h.active) { h.active = true; await h.save(); }
        houses.push(h);
      }
      const r = await BehaviorHouse.updateMany(
        { schoolId: req.schoolId, active: true, name: { $nin: NAMES } },
        { $set: { active: false } }
      );
      deactivatedCount = r.modifiedCount;
    }
    const houseIds = houses.map((h) => h._id);
    const idxById = Object.fromEntries(houseIds.map((id, i) => [String(id), i]));
    const K = houseIds.length;

    const students = await BehaviorStudent.find({ schoolId: req.schoolId, active: true })
      .select("lastName grade gender houseId")
      .lean();

    const surnameKey = (s) => (s.lastName || "").trim().toLowerCase() || `__solo_${s._id}`;
    const gradeKey = (s) => (String(s.grade || "").trim() || "?");
    const sexKey = (s) => {
      const g = String(s.gender || "").trim().toLowerCase();
      if (g.startsWith("m")) return "M";
      if (g.startsWith("f")) return "F";
      return "U";
    };
    const allGrades = [...new Set(students.map(gradeKey))];
    const tally = (h, s) => {
      h.total++;
      h.grade[gradeKey(s)] = (h.grade[gradeKey(s)] || 0) + 1;
      h.gender[sexKey(s)] = (h.gender[sexKey(s)] || 0) + 1;
    };

    // Per-house tallies; seed with already-assigned students in unassigned mode
    // so balancing accounts for the current distribution.
    const H = houseIds.map(() => ({ total: 0, grade: {}, gender: {} }));
    const familyHouse = {}; // surname -> house index a family is already in
    if (onlyUnassigned) {
      for (const s of students) {
        const hi = s.houseId ? idxById[String(s.houseId)] : undefined;
        if (hi != null) {
          tally(H[hi], s);
          const key = surnameKey(s);
          if (familyHouse[key] == null) familyHouse[key] = hi;
        }
      }
    }

    const toAssign = onlyUnassigned
      ? students.filter((s) => !(s.houseId && idxById[String(s.houseId)] != null))
      : students;
    const skipped = students.length - toAssign.length;

    // Group the students-to-assign by surname (families together).
    const fam = new Map();
    for (const s of toAssign) {
      const key = surnameKey(s);
      if (!fam.has(key)) fam.set(key, []);
      fam.get(key).push(s);
    }
    const groups = [...fam.values()].sort((a, b) => b.length - a.length);

    const scoreIfAdded = (hi, group) => {
      const sim = H.map((h) => ({ total: h.total, grade: { ...h.grade }, gender: { ...h.gender } }));
      for (const s of group) {
        sim[hi].total++;
        sim[hi].grade[gradeKey(s)] = (sim[hi].grade[gradeKey(s)] || 0) + 1;
        sim[hi].gender[sexKey(s)] = (sim[hi].gender[sexKey(s)] || 0) + 1;
      }
      let score = variance(sim.map((x) => x.total)) * 3;
      for (const g of allGrades) score += variance(sim.map((x) => x.grade[g] || 0));
      for (const sx of ["M", "F", "U"]) score += variance(sim.map((x) => x.gender[sx] || 0));
      return score;
    };

    const assignments = [];
    for (const group of groups) {
      const key = surnameKey(group[0]);
      let best;
      if (onlyUnassigned && familyHouse[key] != null) {
        best = familyHouse[key]; // join siblings already placed
      } else {
        best = 0;
        let bestScore = Infinity;
        for (let hi = 0; hi < K; hi++) {
          const sc = scoreIfAdded(hi, group);
          if (sc < bestScore) { bestScore = sc; best = hi; }
        }
      }
      for (const s of group) {
        assignments.push({ updateOne: { filter: { _id: s._id }, update: { $set: { houseId: houseIds[best] } } } });
        tally(H[best], s);
      }
    }

    if (assignments.length) await BehaviorStudent.bulkWrite(assignments);
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });

    const summary = houses.map((h, i) => ({ name: h.name, total: H[i].total, byGrade: H[i].grade, byGender: H[i].gender }));
    await audit(req.schoolId, "houses.backfilled", req, {
      meta: { mode: onlyUnassigned ? "unassigned" : "full", assigned: assignments.length, skipped, deactivated: deactivatedCount },
    });
    res.json({ ok: true, mode: onlyUnassigned ? "unassigned" : "full", assigned: assignments.length, skipped, deactivated: deactivatedCount, houses: summary });
  } catch (err) {
    next(err);
  }
});

// House standings report: each house's running total + its TOP 3 contributing
// students (by positive points earned). Returns the data for an in-app preview
// and, when { email: true }, sends it as an HTML standings email.
router.post("/house-report", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const config = await BehaviorConfig.findOne({ schoolId: req.schoolId }).lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).lean();
    const resetAt = config?.housePointsResetAt ? new Date(config.housePointsResetAt) : null;
    const sinceMatch = resetAt ? { at: { $gt: resetAt } } : {};

    // House totals (all events, +/-).
    const totals = await HousePointEvent.aggregate([
      { $match: { schoolId: req.schoolId, ...sinceMatch } },
      { $group: { _id: "$houseId", points: { $sum: "$points" } } },
    ]);
    const totalById = Object.fromEntries(totals.map((t) => [String(t._id), t.points]));

    // Top contributors: POSITIVE points only, summed per (house, student),
    // globally sorted so the first 3 seen per house are its top 3.
    const contribAgg = await HousePointEvent.aggregate([
      { $match: { schoolId: req.schoolId, points: { $gt: 0 }, studentId: { $ne: null }, ...sinceMatch } },
      { $group: { _id: { houseId: "$houseId", studentId: "$studentId" }, points: { $sum: "$points" } } },
      { $sort: { points: -1 } },
    ]);
    const studentIds = [...new Set(contribAgg.map((c) => String(c._id.studentId)))];
    const students = await BehaviorStudent.find({ _id: { $in: studentIds } })
      .select("firstName lastName preferredName")
      .lean();
    const nameById = Object.fromEntries(
      students.map((s) => [String(s._id), `${s.preferredName || s.firstName} ${s.lastName}`.trim()])
    );
    const topByHouse = {};
    for (const c of contribAgg) {
      const hid = String(c._id.houseId);
      topByHouse[hid] = topByHouse[hid] || [];
      if (topByHouse[hid].length < 3) {
        topByHouse[hid].push({ name: nameById[String(c._id.studentId)] || "Student", points: c.points });
      }
    }

    // House captains.
    const captainDocs = await BehaviorStudent.find({ schoolId: req.schoolId, active: true, houseCaptain: true, houseId: { $ne: null } })
      .select("firstName preferredName lastName houseId")
      .lean();
    const captainsByHouse = {};
    for (const c of captainDocs) {
      const k = String(c.houseId);
      (captainsByHouse[k] ||= []).push(`${c.preferredName || c.firstName} ${c.lastName || ""}`.trim());
    }

    const report = houses
      .map((h) => ({
        _id: String(h._id),
        name: h.name,
        color: h.color || "#0f172a",
        points: totalById[String(h._id)] || 0,
        top: topByHouse[String(h._id)] || [],
        captains: captainsByHouse[String(h._id)] || [],
      }))
      .sort((a, b) => b.points - a.points);

    const max = Math.max(1, ...report.map((h) => Math.abs(h.points)));
    const rows = report
      .map((h, i) => {
        const w = Math.max(2, Math.round((Math.abs(h.points) / max) * 100));
        const top = h.top.length
          ? h.top.map((t, j) => `${j + 1}. ${escapeHtml(t.name)} (${t.points})`).join(" &middot; ")
          : "&mdash;";
        return (
          `<div style="margin:12px 0">` +
          `<div style="display:flex;align-items:center;gap:8px">` +
          `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${h.color}"></span>` +
          `<strong>${i + 1}. ${escapeHtml(h.name)}</strong>` +
          (h.captains.length ? `<span style="font-size:11px;color:#94a3b8">© ${escapeHtml(h.captains.join(", "))}</span>` : "") +
          `<span style="margin-left:auto;font-variant-numeric:tabular-nums;color:#0f172a">${h.points} pts</span>` +
          `</div>` +
          `<div style="background:#f1f5f9;border-radius:4px;height:8px;margin:5px 0"><div style="background:${h.color};height:8px;border-radius:4px;width:${w}%"></div></div>` +
          `<div style="font-size:12px;color:#475569">Top contributors: ${top}</div>` +
          `</div>`
        );
      })
      .join("");
    const html = emailShell({
      title: "House standings",
      schoolName: config?.branding?.schoolName || "Behaviours",
      preheader: "Current house point standings.",
      accent: "#16a34a",
      contentHtml: rows || "<p style='color:#94a3b8'>No houses defined yet.</p>",
    });

    let emailed = false;
    let emailError = "";
    if (req.body?.email) {
      const to = config?.houseReport?.recipientEmail || req.user.email;
      const fromAddr = process.env.BEHAVIOR_FROM_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
      const text = report
        .map((h, i) => `${i + 1}. ${h.name}: ${h.points} pts — top: ${h.top.map((t) => `${t.name} (${t.points})`).join(", ") || "—"}`)
        .join("\n");
      try {
        await sendEmail({
          from: fromAddr ? { name: "Behaviours", address: fromAddr } : undefined,
          to,
          subject: `House standings — ${config?.branding?.schoolName || "Behaviours"}`,
          text,
          html,
        });
        emailed = true;
      } catch (e) {
        emailError = e?.message || String(e);
      }
    }

    await audit(req.schoolId, "house_report.generated", req, { meta: { emailed } });
    res.json({ ok: true, report, emailed, emailError });
  } catch (err) {
    next(err);
  }
});

// ── House competitions (Sept–June calendar) ─────────────────────────────────

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// List the competition calendar with each event's results mapped to houses.
router.get("/competitions", authAny, loadMembership, async (req, res, next) => {
  try {
    const comps = await BehaviorCompetition.find({ schoolId: req.schoolId, active: true }).sort({ monthOrder: 1, createdAt: 1 }).lean();
    const houses = await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).select("name color").lean();
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));
    const out = comps.map((c) => ({
      _id: String(c._id),
      name: c.name,
      description: c.description,
      monthOrder: c.monthOrder,
      monthLabel: c.monthLabel,
      placementPoints: c.placementPoints,
      scoredAt: c.scoredAt,
      results: (c.results || [])
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((r) => ({
          place: r.place,
          houseId: String(r.houseId),
          houseName: houseById[String(r.houseId)]?.name || "",
          houseColor: houseById[String(r.houseId)]?.color || "#0f172a",
          points: c.placementPoints[r.place - 1] || 0,
        })),
    }));
    res.json({ ok: true, competitions: out });
  } catch (err) {
    next(err);
  }
});

// Seed the default Sept–June calendar (upsert: only adds the events that are
// missing, so it's safe to run again).
router.post("/competitions/seed", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const DEFAULTS = [
      { monthOrder: 0, monthLabel: "September", name: "Spirit Week" },
      { monthOrder: 1, monthLabel: "October", name: "Quiz Bowl" },
      { monthOrder: 2, monthLabel: "November", name: "Food Drive" },
      { monthOrder: 3, monthLabel: "December", name: "Choir / Christmas Concert" },
      { monthOrder: 4, monthLabel: "January", name: "STEM Day" },
      { monthOrder: 5, monthLabel: "February", name: "Kindness Marathon" },
      { monthOrder: 6, monthLabel: "March", name: "Trivia Challenge" },
      { monthOrder: 7, monthLabel: "April", name: "Mini-Olympics" },
      { monthOrder: 8, monthLabel: "May", name: "Arts Festival" },
      { monthOrder: 9, monthLabel: "June", name: "Field Day" },
    ];
    let created = 0;
    for (const d of DEFAULTS) {
      const exists = await BehaviorCompetition.findOne({ schoolId: req.schoolId, name: d.name, active: true });
      if (!exists) {
        await BehaviorCompetition.create({ schoolId: req.schoolId, ...d, placementPoints: [500, 300, 200, 100] });
        created += 1;
      }
    }
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });
    await audit(req.schoolId, "competitions.seeded", req, { meta: { created } });
    res.json({ ok: true, created });
  } catch (err) {
    next(err);
  }
});

// Create or edit a competition.
router.post("/competitions", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    const placementPoints = Array.isArray(b.placementPoints) && b.placementPoints.length
      ? b.placementPoints.map((n) => Number(n) || 0)
      : [500, 300, 200, 100];
    if (b._id) {
      const comp = await BehaviorCompetition.findOne({ _id: b._id, schoolId: req.schoolId });
      if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
      comp.name = name;
      comp.description = String(b.description || "");
      if (typeof b.monthOrder === "number") comp.monthOrder = b.monthOrder;
      if (b.monthLabel != null) comp.monthLabel = String(b.monthLabel);
      comp.placementPoints = placementPoints;
      await comp.save();
      return res.json({ ok: true, competition: comp });
    }
    const comp = await BehaviorCompetition.create({
      schoolId: req.schoolId, name, description: String(b.description || ""),
      monthOrder: Number(b.monthOrder) || 0, monthLabel: String(b.monthLabel || ""), placementPoints,
    });
    res.json({ ok: true, competition: comp });
  } catch (err) {
    next(err);
  }
});

// Score a competition: set placements + award (capped) placement points to the
// houses. Idempotent — re-scoring deletes the prior award and re-applies.
router.post("/competitions/:id/score", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const comp = await BehaviorCompetition.findOne({ _id: req.params.id, schoolId: req.schoolId });
    if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
    const raw = Array.isArray(req.body?.results) ? req.body.results : [];
    const validHouses = new Set(
      (await BehaviorHouse.find({ schoolId: req.schoolId, active: true }).select("_id").lean()).map((h) => String(h._id))
    );
    const results = raw
      .map((r) => ({ houseId: r.houseId, place: Number(r.place) }))
      .filter((r) => r.houseId && validHouses.has(String(r.houseId)) && r.place >= 1);

    // Re-award cleanly.
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, competitionId: comp._id });
    const events = results
      .map((r) => ({
        schoolId: req.schoolId, houseId: r.houseId, points: comp.placementPoints[r.place - 1] || 0,
        reason: `${comp.name} — ${ordinal(r.place)} place`, competitionId: comp._id, awardedByTeacherId: req.membership._id,
      }))
      .filter((e) => e.points);
    if (events.length) await HousePointEvent.insertMany(events);

    comp.results = results;
    comp.scoredAt = new Date();
    await comp.save();
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housesEnabled: true } });
    await audit(req.schoolId, "competition.scored", req, { meta: { name: comp.name, awarded: events.length } });
    res.json({ ok: true, awarded: events.reduce((s, e) => s + e.points, 0) });
  } catch (err) {
    next(err);
  }
});

// Remove a competition + reverse its awarded points.
router.delete("/competitions/:id", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    const comp = await BehaviorCompetition.findOneAndUpdate(
      { _id: req.params.id, schoolId: req.schoolId },
      { $set: { active: false } },
      { new: true }
    ).lean();
    if (!comp) return res.status(404).json({ ok: false, error: "Competition not found" });
    await HousePointEvent.deleteMany({ schoolId: req.schoolId, competitionId: comp._id });
    await audit(req.schoolId, "competition.removed", req, { meta: { name: comp.name } });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Generate (or rotate) the 4-digit student-portal code (admin). Returned once;
// share it with students. Unique across schools.
router.post("/houses/portal-code", authAny, loadMembership, requireAdmin, async (req, res, next) => {
  try {
    let code = "";
    const wanted = String(req.body?.code || "").trim();
    if (wanted) {
      // Custom code: 3–6 digits, not already used by another school.
      if (!/^\d{3,6}$/.test(wanted)) return res.status(400).json({ ok: false, error: "Code must be 3–6 digits." });
      const taken = await BehaviorConfig.findOne({ housePortalCode: wanted, schoolId: { $ne: req.schoolId } }).select("_id").lean();
      if (taken) return res.status(409).json({ ok: false, error: "That code is taken by another school — pick another." });
      code = wanted;
    } else {
      // Auto: random unique 4-digit.
      for (let attempt = 0; attempt < 20; attempt++) {
        const c = String(1000 + (crypto.randomBytes(2).readUInt16BE(0) % 9000));
        const t = await BehaviorConfig.findOne({ housePortalCode: c, schoolId: { $ne: req.schoolId } }).select("_id").lean();
        if (!t) { code = c; break; }
      }
      if (!code) return res.status(500).json({ ok: false, error: "Could not allocate a code — try again" });
    }
    await BehaviorConfig.updateOne({ schoolId: req.schoolId }, { $set: { housePortalCode: code, housesEnabled: true } });
    await audit(req.schoolId, "houses.portal_code", req, {});
    res.json({ ok: true, code });
  } catch (err) {
    next(err);
  }
});

// ── Public student portal (no auth) — house standings only, never PII ────────

// Public house standings + competition results, gated by the 4-digit code so the
// portal isn't openly browseable. House-level only — no student data.
router.get("/public/houses", async (req, res, next) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!/^\d{3,6}$/.test(code)) return res.status(400).json({ ok: false, error: "Enter your school code." });
    const config = await BehaviorConfig.findOne({ housePortalCode: code, housesEnabled: true }).select("schoolId housePointsResetAt").lean();
    if (!config) return res.status(404).json({ ok: false, error: "No school matches that code." });
    const schoolId = config.schoolId;
    const sid = new mongoose.Types.ObjectId(schoolId);
    const school = await BehaviorSchool.findById(schoolId).select("name").lean();

    const houses = await BehaviorHouse.find({ schoolId, active: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const pointMatch = { schoolId: sid };
    if (config.housePointsResetAt) pointMatch.at = { $gt: new Date(config.housePointsResetAt) };
    const totals = await HousePointEvent.aggregate([
      { $match: pointMatch },
      { $group: { _id: "$houseId", points: { $sum: "$points" } } },
    ]);
    const totalById = Object.fromEntries(totals.map((t) => [String(t._id), t.points]));
    const members = await BehaviorStudent.aggregate([
      { $match: { schoolId: sid, active: true, houseId: { $ne: null } } },
      { $group: { _id: "$houseId", n: { $sum: 1 } } },
    ]);
    const memberById = Object.fromEntries(members.map((m) => [String(m._id), m.n]));
    const houseById = Object.fromEntries(houses.map((h) => [String(h._id), h]));

    // House captains (first name + last initial only — minimal PII for a wall board).
    const captains = await BehaviorStudent.find({ schoolId, active: true, houseCaptain: true, houseId: { $ne: null } })
      .select("firstName preferredName lastName houseId")
      .lean();
    const captainsByHouse = {};
    for (const c of captains) {
      const k = String(c.houseId);
      (captainsByHouse[k] ||= []).push(`${c.preferredName || c.firstName} ${(c.lastName || "").charAt(0)}.`.trim());
    }

    const houseOut = houses
      .map((h) => ({
        id: String(h._id), name: h.name, color: h.color || "#0f172a",
        points: totalById[String(h._id)] || 0, members: memberById[String(h._id)] || 0,
        captains: captainsByHouse[String(h._id)] || [],
      }))
      .sort((a, b) => b.points - a.points);

    const comps = await BehaviorCompetition.find({ schoolId, active: true }).sort({ monthOrder: 1 }).lean();
    const compOut = comps.map((c) => ({
      name: c.name,
      monthLabel: c.monthLabel,
      scored: !!c.scoredAt,
      results: (c.results || [])
        .slice()
        .sort((a, b) => a.place - b.place)
        .map((r) => ({ place: r.place, houseName: houseById[String(r.houseId)]?.name || "", houseColor: houseById[String(r.houseId)]?.color || "#0f172a" })),
    }));

    // Recent point activity — last ~12 awards (house-level only, no student names).
    const recent = await HousePointEvent.find(pointMatch).sort({ at: -1 }).limit(12).select("houseId points reason at").lean();
    const activity = recent.map((e) => ({
      house: houseById[String(e.houseId)]?.name || "",
      color: houseById[String(e.houseId)]?.color || "#0f172a",
      points: e.points,
      reason: e.reason || "",
      at: e.at,
    }));

    res.json({ ok: true, enabled: true, schoolName: school?.name || "", houses: houseOut, competitions: compOut, activity });
  } catch (err) {
    next(err);
  }
});

// ── Honour roll (weighted averages from Edsby) — backs the /avgs panel ───────
router.use("/avgs", authAny, loadMembership, buildAvgsRouter({ requireAdmin }));

export default router;
