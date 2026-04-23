// backend/routes/classRoster.js
// Routes for managing class rosters (Edsby CSV upload, student lookup)
import express from "express";
import ClassRoster from "../models/ClassRoster.js";

const router = express.Router();

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
    const studentId = sidIdx >= 0 ? (cols[sidIdx] || "").trim() : "";

    // Derive last4 from whichever ID is available (prefer studentId, fall back to edsbyId)
    const idForLast4 = studentId || edsbyId;
    const digitsOnly = idForLast4.replace(/\D/g, "");
    // For short/alphanumeric IDs (e.g. "AS01"), use the full ID as last4
    const last4 = idForLast4.length <= 4 ? idForLast4 : (digitsOnly.length >= 4 ? digitsOnly.slice(-4) : digitsOnly || idForLast4.slice(-4));

    if (!edsbyId && !studentId) continue; // no usable ID

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
    derivedClassName = derivedClassName || "Imported Class";

    // If the same teacher already uploaded the same sourceFile, replace it
    if (sourceFile) {
      await ClassRoster.deleteMany({ teacherEmail: email, sourceFile });
    }

    const roster = await ClassRoster.create({
      teacherEmail: email,
      className: derivedClassName,
      sourceFile: sourceFile || "",
      students,
    });

    return res.json({
      ok: true,
      rosterId: roster._id,
      className: derivedClassName,
      studentCount: students.length,
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

    return res.json({
      ok: true,
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
 *  DELETE /class-roster/:id
 *  Deletes a single roster by ID.
 * ------------------------------------------------------------------ */
router.delete("/:id", async (req, res) => {
  try {
    await ClassRoster.findByIdAndDelete(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /class-roster/:id error:", err?.message || err);
    return res.status(500).json({ error: "Failed to delete roster." });
  }
});

export default router;
