// backend/routes/classRoster.js
// Routes for managing class rosters (Edsby CSV upload, student lookup)
import express from "express";
import ClassRoster from "../models/ClassRoster.js";
import StudentContact from "../models/StudentContact.js";
import User from "../models/User.js";
import { hasTierAtLeast } from "../utils/tierGate.js";
import { resolveAccessForUser } from "../billing/planResolver.js";

const router = express.Router();

// Used when a class name can't be derived from the filename. Rosters that fall
// back to it are NOT treated as the same class as each other — two unnamed
// uploads are two classes, not one overwriting the other.
const FALLBACK_CLASS_NAME = "Imported Class";

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Look up a teacher's tier by email. Returns "FREE" if not found.
 * Used by the upload route to gate class-linking behind PLUS.
 */
async function lookupTeacherTierByEmail(email) {
  try {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return "FREE";
    const user = await User.findOne({ email: { $regex: new RegExp(`^${e}$`, "i") } }).lean();
    if (!user) return "FREE";
    const access = await resolveAccessForUser(user);
    return String(access?.tier || user.planTier || "FREE").toUpperCase();
  } catch (e) {
    console.warn("[classRoster] tier lookup failed:", e?.message || e);
    return "FREE";
  }
}

/* ------------------------------------------------------------------
 * Parse Edsby gradebook CSV into student records.
 *
 * Edsby exports:
 *   Row 1: headers — "Header Column,First Name,Last Name,Edsby ID,Student ID,..."
 *   Rows 2–10: metadata (assessment IDs, dates, types, etc.)
 *   Row 11+: student data — ",Ronit,Atwal,24354412,328400224,..."
 *
 * We skip metadata rows (rows where column A is non-empty, except "Header Column"),
 * then extract firstName, lastName, edsbyId, studentId from each student row.
 * ------------------------------------------------------------------ */
function parseEdsbyCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { students: [], className: "" };

  // Simple CSV parser that handles quoted fields
  function splitCSVLine(line) {
    const fields = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    fields.push(current);
    return fields;
  }

  // Find header row and column indices
  const headerRow = splitCSVLine(lines[0]);
  const fnIdx = headerRow.findIndex((h) => /first\s*name/i.test(h.trim()));
  const lnIdx = headerRow.findIndex((h) => /last\s*name/i.test(h.trim()));
  const eidIdx = headerRow.findIndex((h) => /edsby\s*id/i.test(h.trim()));
  const sidIdx = headerRow.findIndex((h) => /student\s*id/i.test(h.trim()));
  const unIdx = headerRow.findIndex((h) => /^username$/i.test(h.trim()));

  if (fnIdx < 0 || lnIdx < 0) {
    return { students: [], className: "", error: "Could not find First Name / Last Name columns" };
  }

  const students = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCSVLine(lines[i]);
    const firstName = (cols[fnIdx] || "").trim();
    const lastName = (cols[lnIdx] || "").trim();

    // Skip metadata rows (no first name) and header-like rows
    if (!firstName || /^(edsby|assessment|unit|header)/i.test(firstName)) continue;
    // Skip rows that look like percentages in the name column (summary rows)
    if (/^\d+(\.\d+)?%$/.test(firstName)) continue;

    const edsbyId = eidIdx >= 0 ? (cols[eidIdx] || "").trim() : "";
    const username = unIdx >= 0 ? (cols[unIdx] || "").trim() : "";
    // Use username as studentId if no explicit Student ID column exists, since
    // that's the number students actually know (e.g. Edsby "Username" = 400529)
    const studentId = sidIdx >= 0 ? (cols[sidIdx] || "").trim() : username;

    // Derive last4 from whichever ID is available (prefer studentId/username, fall back to edsbyId)
    const idForLast4 = studentId || edsbyId;
    const digitsOnly = idForLast4.replace(/\D/g, "");
    // For short/alphanumeric IDs (e.g. "AS01"), use the full ID as last4
    const last4 = idForLast4.length <= 4 ? idForLast4 : (digitsOnly.length >= 4 ? digitsOnly.slice(-4) : digitsOnly || idForLast4.slice(-4));

    if (!edsbyId && !studentId && !username) continue; // no usable ID

    students.push({ firstName, lastName, edsbyId, studentId, last4 });
  }

  return { students, className: "" };
}

/* ------------------------------------------------------------------
 *  POST /class-roster/upload
 *  Body: { teacherEmail, csvText, className?, sourceFile? }
 *  Parses Edsby CSV and upserts a class roster for this teacher.
 *  Teachers can upload multiple CSVs (one per class); each is stored
 *  as a separate ClassRoster document.
 * ------------------------------------------------------------------ */
router.post("/upload", async (req, res) => {
  try {
    const { teacherEmail, csvText, className, sourceFile } = req.body || {};
    const email = String(teacherEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid teacherEmail is required." });
    }
    if (!csvText || typeof csvText !== "string") {
      return res.status(400).json({ error: "csvText is required." });
    }

    // Tier gate (PLUS or above). Class linking is a paid feature in both
    // the scavenger-hunt teacher app and the Pulse Grading UI.
    const tier = await lookupTeacherTierByEmail(email);
    if (!hasTierAtLeast(tier, "PLUS")) {
      return res.status(403).json({
        error: "Class linking requires a PLUS plan or above.",
        requiredPlan: "PLUS",
        currentPlan: tier,
      });
    }

    const { students, error } = parseEdsbyCSV(csvText);
    if (error) {
      return res.status(400).json({ error });
    }
    if (!students.length) {
      return res.status(400).json({ error: "No students found in CSV." });
    }

    // Derive class name from sourceFile if not provided.
    // Edsby filenames look like "Mr. Richard Sommer HIST7C - Gradebook.csv"
    // — the class code is the last word before the dash.
    let derivedClassName = className || "";
    if (!derivedClassName && sourceFile) {
      const base = sourceFile.replace(/\.csv$/i, "").trim();
      // Try to extract class code: last token before " - " (e.g. "HIST7C")
      const dashIdx = base.indexOf(" - ");
      if (dashIdx > 0) {
        const beforeDash = base.slice(0, dashIdx).trim();
        const tokens = beforeDash.split(/\s+/);
        derivedClassName = tokens[tokens.length - 1] || beforeDash;
      } else {
        derivedClassName = base;
      }
    }
    derivedClassName = derivedClassName || FALLBACK_CLASS_NAME;

    // Replace, don't accumulate. Re-uploading a class list is a correction or a
    // new year's version of a roster the teacher already has — two rosters for
    // GEO8A is never what they meant, and both would then be offered as match
    // targets after grading.
    //
    // Matching on sourceFile alone was too narrow: next year's export, a
    // re-download the browser names "… (1).csv", or a file renamed by hand all
    // arrive under a different filename and used to land beside the old roster
    // rather than replacing it. The class name is the identity that matters, so
    // match on either — case-insensitively, since "Geo8a" and "GEO8A" are the
    // same class.
    //
    // Parent emails are not collateral here: StudentContact is its own
    // collection keyed by edsbyId, so contacts survive the roster document
    // being replaced and re-attach to the new one.
    // ORDER MATTERS: create the replacement first, then remove what it
    // supersedes. Deleting first and creating second loses the roster outright
    // whenever the create fails — the teacher is left with no class list at
    // all, which is far worse than the duplicate this is preventing. Creating
    // first fails safe: the worst case is briefly holding two rosters, and the
    // delete that follows resolves it.
    const roster = await ClassRoster.create({
      teacherEmail: email,
      className: derivedClassName,
      sourceFile: sourceFile || "",
      students,
    });

    const replaceMatch = [];
    if (sourceFile) replaceMatch.push({ sourceFile });
    if (derivedClassName !== FALLBACK_CLASS_NAME) {
      replaceMatch.push({ className: new RegExp(`^${escapeRegex(derivedClassName)}$`, "i") });
    }
    let replacedCount = 0;
    if (replaceMatch.length) {
      const del = await ClassRoster.deleteMany({
        teacherEmail: email,
        _id: { $ne: roster._id }, // never the one just created
        $or: replaceMatch,
      });
      replacedCount = del?.deletedCount || 0;
    }
    console.log(
      `[classRoster] ${email} uploaded "${derivedClassName}" (${students.length} students), replaced ${replacedCount}`
    );

    return res.json({
      ok: true,
      rosterId: roster._id,
      className: derivedClassName,
      studentCount: students.length,
      // How many existing rosters this upload replaced, so the UI can say
      // "replaced" rather than implying a second copy was added.
      replacedCount,
      students: students.map((s) => ({
        firstName: s.firstName,
        lastName: s.lastName,
        last4: s.last4,
        edsbyId: s.edsbyId,
        studentId: s.studentId,
      })),
    });
  } catch (err) {
    console.error("POST /class-roster/upload error:", err?.message || err);
    return res.status(500).json({ error: "Failed to upload roster." });
  }
});

/* ------------------------------------------------------------------
 *  GET /class-roster/list?teacherEmail=...
 *  Returns all rosters for a teacher (all classes combined).
 * ------------------------------------------------------------------ */
router.get("/list", async (req, res) => {
  try {
    const email = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "teacherEmail required" });

    const rosters = await ClassRoster.find({ teacherEmail: email })
      .sort({ createdAt: -1 })
      .lean();

    // Tell the UI whether uploading is even allowed, so the gate can be stated
    // up front instead of only as a 403 after a teacher has picked their files.
    // Listing stays ungated: a teacher whose plan lapsed must still be able to
    // see — and delete — the rosters they already have.
    const tier = await lookupTeacherTierByEmail(email);

    return res.json({
      ok: true,
      tier,
      canLinkClasses: hasTierAtLeast(tier, "PLUS"),
      requiredPlan: "PLUS",
      rosters: rosters.map((r) => ({
        id: r._id,
        className: r.className,
        sourceFile: r.sourceFile,
        studentCount: r.students?.length || 0,
        students: (r.students || []).map((s) => ({
          firstName: s.firstName,
          lastName: s.lastName,
          last4: s.last4,
          edsbyId: s.edsbyId,
          studentId: s.studentId,
        })),
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error("GET /class-roster/list error:", err?.message || err);
    return res.status(500).json({ error: "Failed to list rosters." });
  }
});

/* ------------------------------------------------------------------
 *  GET /class-roster/lookup?teacherEmail=...&last4=...
 *  Looks up a student by last 4 digits across all of a teacher's rosters.
 *  Returns the matched student(s) — should usually be exactly 1.
 * ------------------------------------------------------------------ */
router.get("/lookup", async (req, res) => {
  try {
    const email = String(req.query.teacherEmail || "").trim().toLowerCase();
    const last4 = String(req.query.last4 || "").trim();
    if (!email || !last4) {
      return res.status(400).json({ error: "teacherEmail and last4 required" });
    }

    const rosters = await ClassRoster.find({ teacherEmail: email }).lean();
    const matches = [];
    for (const r of rosters) {
      for (const s of r.students || []) {
        if (s.last4 === last4) {
          matches.push({
            firstName: s.firstName,
            lastName: s.lastName,
            edsbyId: s.edsbyId,
            studentId: s.studentId,
            last4: s.last4,
            className: r.className,
            rosterId: r._id,
          });
        }
      }
    }

    return res.json({ ok: true, matches });
  } catch (err) {
    console.error("GET /class-roster/lookup error:", err?.message || err);
    return res.status(500).json({ error: "Lookup failed." });
  }
});

/* ------------------------------------------------------------------
 *  GET /class-roster/:id/contacts?teacherEmail=...
 *  Returns the full roster joined with each student's StudentContact
 *  (email, parentEmail, declined flags). Used by the teacher-side
 *  Class Rosters admin in TeacherProfile so the teacher can review
 *  and fill in missing student / parent emails.
 *  Tier gate: PLUS or above. Owner check by teacherEmail.
 * ------------------------------------------------------------------ */
router.get("/:id/contacts", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const email = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!id || !email) return res.status(400).json({ error: "id + teacherEmail required" });

    const tier = await lookupTeacherTierByEmail(email);
    if (!hasTierAtLeast(tier, "PLUS")) {
      return res.status(403).json({
        error: "Class linking requires a PLUS plan or above.",
        requiredPlan: "PLUS",
        currentPlan: tier,
      });
    }

    const roster = await ClassRoster.findById(id).lean();
    if (!roster) return res.status(404).json({ error: "Roster not found." });
    if (String(roster.teacherEmail || "").toLowerCase() !== email) {
      return res.status(403).json({ error: "Roster not yours." });
    }

    const ids = (roster.students || [])
      .map((s) => s.edsbyId)
      .filter(Boolean);
    let contactByEdsbyId = new Map();
    if (ids.length) {
      const contacts = await StudentContact.find({ edsbyId: { $in: ids } }).lean();
      for (const c of contacts) contactByEdsbyId.set(c.edsbyId, c);
    }

    const students = (roster.students || []).map((s) => {
      const c = contactByEdsbyId.get(s.edsbyId) || {};
      return {
        firstName: s.firstName || "",
        lastName: s.lastName || "",
        edsbyId: s.edsbyId || "",
        studentId: s.studentId || "",
        last4: s.last4 || "",
        // Contact fields (may be blank)
        email: c.email || "",
        parentEmail: c.parentEmail || "",
        emailUpdatedAt: c.emailUpdatedAt || null,
        parentEmailUpdatedAt: c.parentEmailUpdatedAt || null,
        parentEmailDeclined: !!c.parentEmailDeclined,
      };
    });

    return res.json({
      ok: true,
      rosterId: String(roster._id),
      className: roster.className || "",
      students,
    });
  } catch (err) {
    console.error("GET /class-roster/:id/contacts error:", err?.message || err);
    return res.status(500).json({ error: "Lookup failed." });
  }
});

/* ------------------------------------------------------------------
 *  POST /class-roster/:id/contacts/bulk-set
 *  Body: { teacherEmail, updates: [{ edsbyId, email?, parentEmail? }] }
 *  Lets the teacher save multiple student/parent email edits in one
 *  shot. Validates the roster belongs to this teacher, validates each
 *  edsbyId exists in the roster (so a teacher can't edit students
 *  they don't own), and upserts to StudentContact.
 * ------------------------------------------------------------------ */
router.post("/:id/contacts/bulk-set", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const { teacherEmail, updates } = req.body || {};
    const email = String(teacherEmail || "").trim().toLowerCase();
    if (!id || !email) return res.status(400).json({ error: "id + teacherEmail required" });
    if (!Array.isArray(updates)) return res.status(400).json({ error: "updates required" });

    const tier = await lookupTeacherTierByEmail(email);
    if (!hasTierAtLeast(tier, "PLUS")) {
      return res.status(403).json({
        error: "Class linking requires a PLUS plan or above.",
        requiredPlan: "PLUS",
        currentPlan: tier,
      });
    }

    const roster = await ClassRoster.findById(id).lean();
    if (!roster) return res.status(404).json({ error: "Roster not found." });
    if (String(roster.teacherEmail || "").toLowerCase() !== email) {
      return res.status(403).json({ error: "Roster not yours." });
    }

    const validIds = new Set(
      (roster.students || []).map((s) => s.edsbyId).filter(Boolean)
    );

    const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const now = new Date();
    let saved = 0;
    let skipped = 0;
    const errors = [];

    for (const u of updates) {
      const edsbyId = String(u?.edsbyId || "").trim();
      if (!edsbyId || !validIds.has(edsbyId)) { skipped += 1; continue; }
      const set = { edsbyId };
      const studentEmail = String(u.email || "").trim().toLowerCase();
      const parentEmail = String(u.parentEmail || "").trim().toLowerCase();

      if (studentEmail !== "" && !VALID_EMAIL.test(studentEmail)) {
        errors.push({ edsbyId, error: "Invalid student email" });
        continue;
      }
      if (parentEmail !== "" && !VALID_EMAIL.test(parentEmail)) {
        errors.push({ edsbyId, error: "Invalid parent email" });
        continue;
      }

      // Find the roster student to enrich the StudentContact record
      const rs = (roster.students || []).find((s) => s.edsbyId === edsbyId);
      if (rs) {
        if (rs.firstName) set.firstName = rs.firstName;
        if (rs.lastName) set.lastName = rs.lastName;
        if (rs.studentId) set.studentId = rs.studentId;
      }

      const update = { $setOnInsert: { edsbyId } };
      const $set = { ...set };
      if (studentEmail) {
        $set.email = studentEmail;
        $set.emailUpdatedAt = now;
      }
      if (parentEmail) {
        $set.parentEmail = parentEmail;
        $set.parentEmailUpdatedAt = now;
        $set.parentEmailDeclined = false; // teacher provided override
      }
      if (Object.keys($set).length) update.$set = $set;

      await StudentContact.updateOne({ edsbyId }, update, { upsert: true });
      saved += 1;
    }

    return res.json({ ok: true, saved, skipped, errors });
  } catch (err) {
    console.error("POST /class-roster/:id/contacts/bulk-set error:", err?.message || err);
    return res.status(500).json({ error: "Bulk save failed." });
  }
});

/* ------------------------------------------------------------------
 *  DELETE /class-roster/:id?teacherEmail=...
 *  Deletes a single roster by ID, if it belongs to this teacher.
 *
 *  The ownership check is not optional: roster ids are handed to the browser by
 *  /list and ObjectIds carry a timestamp and counter, so without it any caller
 *  could delete another teacher's class list. Every other route in this file
 *  verifies the owner; this one used to delete on the id alone.
 * ------------------------------------------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    const email = String(req.query.teacherEmail || "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid teacherEmail is required." });
    }
    const roster = await ClassRoster.findById(req.params.id).lean();
    if (!roster) return res.json({ ok: true, removed: 0 }); // already gone
    if (String(roster.teacherEmail || "").toLowerCase() !== email) {
      return res.status(403).json({ error: "Roster not yours." });
    }
    await ClassRoster.deleteOne({ _id: roster._id });
    return res.json({ ok: true, removed: 1 });
  } catch (err) {
    console.error("DELETE /class-roster/:id error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete roster." });
  }
});

export default router;
