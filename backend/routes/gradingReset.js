// backend/routes/gradingReset.js
//
// "Start a new school year" — lets a teacher clear out last year's published
// results so a fresh set of students isn't sharing a progress portal with the
// previous cohort.
//
// This is the most destructive thing in the grading tool, so it is built as
// two deliberate steps:
//
//   POST /grading/reset/preview   counts everything that WOULD go. Deletes nothing.
//   POST /grading/reset/execute   requires the token the preview returned.
//
// The token binds the deletion to a preview the teacher actually saw, so a
// stray or replayed request can't wipe a year of work. It carries the counts
// and expires in 15 minutes.
//
// FINDING A TEACHER'S RESULTS IS NOT AS SIMPLE AS meta.teacherEmail.
// Batch grading publishes without it (only the single-photo path sets it), so
// matching on that alone would leave every batch-graded result on students'
// pages while telling the teacher everything was cleared. We therefore match
// on three axes: meta.teacherEmail, meta.studentId ∈ the teacher's rosters,
// and meta.className ∈ the teacher's class names.

import express from "express";
import crypto from "crypto";
import PublishedResult from "../models/PublishedResult.js";
import HomeworkCheckBatch from "../models/HomeworkCheckBatch.js";
import HomeworkAnswerKey from "../models/HomeworkAnswerKey.js";
import ClassRoster from "../models/ClassRoster.js";
import StudentContact from "../models/StudentContact.js";

const router = express.Router();

const TOKEN_TTL_MS = 15 * 60 * 1000;
const TOKEN_SECRET = process.env.GRADING_RESET_SECRET || process.env.JWT_SECRET || "curriculate-reset";

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url").slice(0, 32);
  return `${body}.${sig}`;
}

function verifyToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url").slice(0, 32);
  // Constant-time compare on equal-length strings.
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.issuedAt || Date.now() - payload.issuedAt > TOKEN_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Build the set of filters that identify "this teacher's published results".
 * Returns null when we can't identify anything — the caller must treat that as
 * "delete nothing" rather than "delete everything".
 */
async function buildResultScope(teacherEmail) {
  const rosters = await ClassRoster.find({ teacherEmail }).lean();

  const studentIds = new Set();
  const classNames = new Set();
  for (const r of rosters) {
    if (r.className) classNames.add(r.className);
    for (const s of r.students || []) {
      if (s.studentId) studentIds.add(String(s.studentId));
      if (s.edsbyId) studentIds.add(String(s.edsbyId));
    }
  }

  const or = [{ "meta.teacherEmail": teacherEmail }];
  if (studentIds.size) or.push({ "meta.studentId": { $in: [...studentIds] } });
  if (classNames.size) or.push({ "meta.className": { $in: [...classNames] } });

  return {
    filter: { $or: or },
    rosterCount: rosters.length,
    studentIdCount: studentIds.size,
    classNames: [...classNames],
  };
}

function withCutoff(filter, before) {
  if (!before) return filter;
  const d = new Date(before);
  if (Number.isNaN(d.getTime())) return filter;
  return { $and: [filter, { createdAt: { $lt: d } }] };
}

// ---------------------------------------------------------------------------
// POST /grading/reset/preview
// Body: { teacherEmail, before? }
// Counts what would be removed. Deletes nothing.
// ---------------------------------------------------------------------------
router.post("/preview", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });
    const before = req.body?.before || null;

    const scope = await buildResultScope(teacherEmail);
    const resultFilter = withCutoff(scope.filter, before);

    const [
      publishedResults,
      homeworkBatches,
      rosters,
      answerKeys,
      contacts,
    ] = await Promise.all([
      PublishedResult.countDocuments(resultFilter),
      HomeworkCheckBatch.countDocuments(withCutoff({ teacherEmail }, before)),
      ClassRoster.countDocuments({ teacherEmail }),
      HomeworkAnswerKey.countDocuments({ teacherEmail }),
      StudentContact.countDocuments({ teacherEmail }).catch(() => 0),
    ]);

    // A sample so the teacher can sanity-check the scope caught the right
    // cohort before agreeing to anything.
    const sample = await PublishedResult.find(resultFilter)
      .select("meta.studentName meta.className meta.title createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();

    const counts = { publishedResults, homeworkBatches, rosters, answerKeys, contacts };
    const token = signToken({ teacherEmail, before, counts, issuedAt: Date.now() });

    return res.json({
      ok: true,
      counts,
      scope: {
        matchedBy: [
          "results tagged with your email",
          scope.studentIdCount ? `${scope.studentIdCount} student IDs from your rosters` : null,
          scope.classNames.length ? `classes: ${scope.classNames.join(", ")}` : null,
        ].filter(Boolean),
        classNames: scope.classNames,
      },
      sample: sample.map((s) => ({
        studentName: s.meta?.studentName || "(unnamed)",
        className: s.meta?.className || "",
        title: s.meta?.title || "",
        createdAt: s.createdAt,
      })),
      token,
      expiresInMs: TOKEN_TTL_MS,
      // Said plainly so it can be shown verbatim in the confirm dialog.
      warning:
        "This permanently deletes the selected items. Students and parents will " +
        "no longer see the affected results at /progress, and any printed QR " +
        "codes or ref-code links for them will stop working.",
    });
  } catch (err) {
    console.error("[grading/reset/preview]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Could not work out what would be reset." });
  }
});

// ---------------------------------------------------------------------------
// POST /grading/reset/execute
// Body: { teacherEmail, token, confirmPhrase, include: {...}, before? }
//
// `include` is opt-in per collection. Note the defaults:
//   publishedResults  true   the point of the exercise
//   homeworkBatches   true   last year's homework history
//   rosters           false  the teacher may want to re-use or edit them
//   contacts          false  parent emails are painful to re-collect
//   answerKeys        false  keys are per BOOK, not per year — the same
//                            textbook is taught again next September, and
//                            re-photographing every key page is an hour's work
// ---------------------------------------------------------------------------
router.post("/execute", async (req, res) => {
  try {
    const teacherEmail = String(req.body?.teacherEmail || "").trim().toLowerCase();
    const confirmPhrase = String(req.body?.confirmPhrase || "").trim().toUpperCase();
    if (!teacherEmail) return res.status(400).json({ ok: false, error: "teacherEmail is required." });

    // Typed confirmation — a click alone shouldn't be able to do this.
    if (confirmPhrase !== "NEW YEAR") {
      return res.status(400).json({ ok: false, error: 'Type "NEW YEAR" to confirm.' });
    }

    const payload = verifyToken(req.body?.token);
    if (!payload) {
      return res.status(400).json({
        ok: false,
        error: "That confirmation has expired or is invalid. Run the preview again so you can see the current counts.",
      });
    }
    if (payload.teacherEmail !== teacherEmail) {
      return res.status(403).json({ ok: false, error: "This confirmation belongs to a different account." });
    }

    const include = req.body?.include || {};
    const doResults = include.publishedResults !== false;
    const doHomework = include.homeworkBatches !== false;
    const doRosters = include.rosters === true;
    const doContacts = include.contacts === true;
    const doKeys = include.answerKeys === true;
    const before = payload.before || null;

    const scope = await buildResultScope(teacherEmail);
    const resultFilter = withCutoff(scope.filter, before);

    const removed = {
      publishedResults: 0, homeworkBatches: 0, rosters: 0, answerKeys: 0, contacts: 0,
    };

    if (doResults) {
      const r = await PublishedResult.deleteMany(resultFilter);
      removed.publishedResults = r.deletedCount || 0;
    }
    if (doHomework) {
      const r = await HomeworkCheckBatch.deleteMany(withCutoff({ teacherEmail }, before));
      removed.homeworkBatches = r.deletedCount || 0;
    }
    if (doRosters) {
      const r = await ClassRoster.deleteMany({ teacherEmail });
      removed.rosters = r.deletedCount || 0;
    }
    if (doContacts) {
      try {
        const r = await StudentContact.deleteMany({ teacherEmail });
        removed.contacts = r.deletedCount || 0;
      } catch { /* collection may not exist for this teacher */ }
    }
    if (doKeys) {
      const r = await HomeworkAnswerKey.deleteMany({ teacherEmail });
      removed.answerKeys = r.deletedCount || 0;
    }

    // Loud, permanent log line — this is the one action worth being able to
    // reconstruct from logs afterwards.
    console.log(
      `[grading/reset] ${teacherEmail} reset for new year${before ? ` (before ${before})` : ""}: ` +
      JSON.stringify(removed)
    );

    return res.json({ ok: true, removed });
  } catch (err) {
    console.error("[grading/reset/execute]", err?.message || err);
    return res.status(500).json({ ok: false, error: "Reset failed. Nothing further was deleted." });
  }
});

export default router;
