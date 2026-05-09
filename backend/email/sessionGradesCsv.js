// ====================================================================
//  sessionGradesCsv.js
//  Curriculate — Build Edsby-format gradebook CSV for a session report.
//
//  Mirrors the column layout used by Pulse Grading's
//  buildSessionEdsbyCsv (frontend/src/app/grading/pdfReports.js):
//    Student ID, First Name, Last Name, Assessment Name, Date,
//    Grade, Out Of, Comment
//
//  Behavior:
//    - Always produces a CSV (one row per completed student).
//    - If teacher rosters are provided, attempts a Levenshtein-≤2
//      match on either name part to back-fill Student ID for rows
//      whose perParticipant record had no edsbyId/studentId.
//    - Returns { csv, hasAnyId, anyMatched } so the caller can
//      decide which email body block to render and which filename
//      to use ("edsby-import" vs "grades").
// ====================================================================

function escCsv(v) {
  const s = String(v ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

function normName(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Compact Levenshtein distance (early-exit when above max).
function lev(a, b, max = 2) {
  a = String(a || "");
  b = String(b || "");
  const al = a.length, bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (!al) return bl;
  if (!bl) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost  // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1; // early exit
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

/**
 * Try to match a free-form student name to a roster student.
 * Returns the matched roster entry or null.
 *
 * Match priority (highest first):
 *   1. exact normalized full name
 *   2. firstName/lastName both Levenshtein ≤ 2
 *   3. firstName exact and lastName Levenshtein ≤ 2 (or vice versa)
 *   4. either side Levenshtein ≤ 2 alone (only if uniquely identifying)
 */
function matchStudentName(studentName, rosterStudents) {
  if (!studentName || !rosterStudents?.length) return null;

  const parts = String(studentName).trim().split(/\s+/);
  const fnIn = normName(parts[0] || "");
  const lnIn = normName(parts.slice(1).join(""));
  const fullIn = fnIn + lnIn;

  if (!fullIn) return null;

  // Pass 1: exact full-name match
  for (const s of rosterStudents) {
    const fn = normName(s.firstName);
    const ln = normName(s.lastName);
    if (fn + ln === fullIn) return s;
    if (ln + fn === fullIn) return s;
  }

  // Pass 2: both within Levenshtein 2
  let bestPair = null;
  let bestPairScore = Infinity;
  for (const s of rosterStudents) {
    const fn = normName(s.firstName);
    const ln = normName(s.lastName);
    const dFn = lev(fnIn, fn, 2);
    const dLn = lev(lnIn, ln, 2);
    if (dFn <= 2 && dLn <= 2) {
      const score = dFn + dLn;
      if (score < bestPairScore) { bestPairScore = score; bestPair = s; }
    }
    // try swapped ordering
    const dFnSwap = lev(fnIn, ln, 2);
    const dLnSwap = lev(lnIn, fn, 2);
    if (dFnSwap <= 2 && dLnSwap <= 2) {
      const score = dFnSwap + dLnSwap;
      if (score < bestPairScore) { bestPairScore = score; bestPair = s; }
    }
  }
  if (bestPair) return bestPair;

  // Pass 3: one side close, other side close-ish
  for (const s of rosterStudents) {
    const fn = normName(s.firstName);
    const ln = normName(s.lastName);
    if (fnIn === fn && lev(lnIn, ln, 2) <= 2) return s;
    if (lnIn === ln && lev(fnIn, fn, 2) <= 2) return s;
  }

  return null;
}

/**
 * Build an Edsby-format gradebook CSV from session results.
 *
 * @param {Object} opts
 * @param {Array}  opts.studentGrades    - per-student grades
 *                                         (studentName, teamName, pointsEarned,
 *                                          pointsPossible, percent, scaledGrade,
 *                                          maxGrade, letterGrade, edsbyId?, studentId?)
 * @param {Array}  opts.perParticipant   - optional source of refCode + comment
 * @param {String} opts.assessmentName   - e.g., the taskset name
 * @param {String} opts.dateIso          - YYYY-MM-DD; defaults to today
 * @param {Array}  opts.rosterStudents   - optional flat array of all roster students
 *                                         (firstName, lastName, edsbyId, studentId)
 * @returns {{ csv: string, anyMatched: boolean, hasAnyId: boolean,
 *             completedCount: number, totalCount: number }}
 */
export function buildSessionEdsbyCsv({
  studentGrades = [],
  perParticipant = [],
  assessmentName = "Curriculate Activity",
  dateIso = null,
  rosterStudents = [],
}) {
  const today = dateIso || new Date().toISOString().slice(0, 10);
  const headers = [
    "Student ID",
    "First Name",
    "Last Name",
    "Assessment Name",
    "Date",
    "Grade",
    "Out Of",
    "Comment",
  ];

  // Index perParticipant by name for refCode + comment enrichment
  const ppByName = {};
  for (const p of perParticipant || []) {
    if (p?.studentName) ppByName[String(p.studentName).trim().toLowerCase()] = p;
  }

  // Only include students who actually completed (have any points possible).
  const eligible = (studentGrades || []).filter(
    (g) => Number(g?.pointsPossible) > 0
  );

  // Determine the canonical "Out Of" — most common maxGrade
  const outOfCounts = {};
  for (const g of eligible) {
    const m = Number(g?.maxGrade) || 0;
    if (m > 0) outOfCounts[m] = (outOfCounts[m] || 0) + 1;
  }
  let outOfNorm = 100;
  let maxCount = 0;
  for (const [d, c] of Object.entries(outOfCounts)) {
    if (c > maxCount) { maxCount = c; outOfNorm = parseFloat(d); }
  }

  let anyMatched = false;
  let hasAnyId = false;
  let unmatchedCounter = 0;

  const rows = [headers.map(escCsv).join(",")];

  for (const g of eligible) {
    // Try to find a roster match if the participant doesn't already have an ID.
    let edsbyId = g.edsbyId || g.studentId || "";
    let firstName = "";
    let lastName = "";

    if (g.firstName || g.lastName) {
      firstName = g.firstName || "";
      lastName = g.lastName || "";
    } else {
      const parts = String(g.studentName || "").trim().split(/\s+/);
      firstName = parts[0] || "";
      lastName = parts.slice(1).join(" ") || "";
    }

    if (!edsbyId && rosterStudents?.length) {
      const match = matchStudentName(g.studentName, rosterStudents);
      if (match) {
        edsbyId = match.edsbyId || match.studentId || "";
        // Prefer roster's canonical name spelling
        firstName = match.firstName || firstName;
        lastName = match.lastName || lastName;
        anyMatched = true;
      }
    }

    if (edsbyId) hasAnyId = true;

    // If still unmatched and the studentName looks like a generic placeholder,
    // emit the existing "Student N" convention with blank Student ID.
    if (!edsbyId && (!firstName || /^student\b/i.test(firstName))) {
      unmatchedCounter += 1;
      firstName = `Student ${unmatchedCounter}`;
      lastName = "";
    }

    // Build comment: existing comment + reference link
    const pp = ppByName[String(g.studentName || "").trim().toLowerCase()] || {};
    let comment = String(pp.comment || pp.aiFeedback || g.comment || "")
      .replace(/\s+/g, " ")
      .trim();
    const refCode = pp.refCode || pp.resultCode || g.refCode || "";
    if (refCode) {
      comment +=
        (comment ? " " : "") +
        `For detailed feedback, check www.curriculate.net/results/${refCode}?src=email`;
      comment += ` For all results, check www.curriculate.net/progress`;
    }

    // Normalize the grade to outOfNorm
    const origPct = Number.isFinite(g.percent) ? g.percent : null;
    let grade = "";
    if (origPct != null) {
      grade = String(Math.round((origPct / 100) * outOfNorm * 10) / 10);
    } else if (Number(g.scaledGrade) >= 0) {
      grade = String(g.scaledGrade);
    } else if (g.pointsPossible > 0) {
      grade = String(
        Math.round((Number(g.pointsEarned) / Number(g.pointsPossible)) * outOfNorm * 10) / 10
      );
    }

    rows.push(
      [
        escCsv(edsbyId),
        escCsv(firstName),
        escCsv(lastName),
        escCsv(assessmentName),
        escCsv(today),
        escCsv(grade),
        escCsv(outOfNorm),
        escCsv(comment),
      ].join(",")
    );
  }

  return {
    csv: rows.join("\n"),
    anyMatched,
    hasAnyId,
    completedCount: eligible.length,
    totalCount: (studentGrades || []).length,
  };
}

export default buildSessionEdsbyCsv;
