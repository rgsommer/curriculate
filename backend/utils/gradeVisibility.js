// backend/utils/gradeVisibility.js
//
// Whether a teacher's marks are shown to students and parents, and the one
// place that strips them out of a payload.
//
// Enforced when a result is SERVED, not when it is published. Stamping the
// decision onto each result at publish time would be simpler, but then
// turning the setting on would only affect work graded afterwards — and the
// reason a teacher turns it on is usually the marks already out there.
// Looking it up on the way out makes the switch retroactive and reversible.
import TeacherSettings from "../models/TeacherSettings.js";

// A settings row is read on every result view, so cache briefly. Sixty
// seconds is long enough to matter on a class opening their results at once,
// short enough that flipping the switch is effectively immediate.
const CACHE_MS = 60 * 1000;
const cache = new Map(); // email -> { value, expires }

// One cached read per teacher, serving every preference, rather than a cache
// per field — the settings arrive in one document anyway.
async function settingsFor(teacherEmail) {
  const email = String(teacherEmail || "").trim().toLowerCase();
  if (!email) return null;

  const hit = cache.get(email);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = {};
  try {
    value = await TeacherSettings.findOne({ teacherEmail: email })
      .select("hideGradesFromStudents notifyStudentsOnNewResult")
      .lean() || {};
  } catch (err) {
    // Fail to the defaults: a database hiccup must not start hiding marks a
    // teacher never asked to hide, nor silence notifications they rely on.
    console.warn("[gradeVisibility] lookup failed:", err?.message || err);
    value = {};
  }
  if (cache.size > 500) cache.clear();
  cache.set(email, { value, expires: Date.now() + CACHE_MS });
  return value;
}

export async function hidesGrades(teacherEmail) {
  if (!String(teacherEmail || "").trim()) return false;
  return !!(await settingsFor(teacherEmail))?.hideGradesFromStudents;
}

// Whether this teacher's students and parents are emailed when a result is
// published. On unless they have turned it off — a free sending tier has a
// daily cap and one batch of thirty can spend most of it.
export async function notifiesStudents(teacherEmail) {
  if (!String(teacherEmail || "").trim()) return true;
  return (await settingsFor(teacherEmail))?.notifyStudentsOnNewResult !== false;
}

// Silent when ANY teacher who could own this result has asked for silence.
// Same asymmetry as hiding: an email not sent can be sent later, and the
// result is sitting on the portal either way.
export async function notifiesForResult(meta) {
  const owners = await teachersForResult(meta);
  if (!owners.length) return true;
  const views = await Promise.all(owners.map((e) => notifiesStudents(e)));
  return views.every(Boolean);
}

// Which teacher a result belongs to.
//
// meta.teacherEmail is the answer when it is there — but it only started
// being written recently, and every result published before that has none.
// Those are exactly the ones a teacher turning this on wants covered, so fall
// back to the class: a roster names both the class and its owner.
//
// If two teachers have a class of the same name we cannot tell which, and
// guessing would hide one teacher's marks on another's say-so. No answer is
// the right answer there.
const ownerCache = new Map(); // className -> { value, expires }

// Everyone who could own this result. A list, not one answer: a class can
// have more than one roster row, and a teacherEmail field has been seen
// holding two addresses at once ("a@x.org, b@y.org"), which is why asking for
// a single owner found none and the setting appeared to do nothing.
export async function teachersForResult(meta) {
  const split = (v) => String(v || "")
    .split(/[,;]+/).map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@"));

  const direct = split(meta?.teacherEmail);
  if (direct.length) return direct;

  const className = String(meta?.className || "").trim();
  if (!className) return [];

  const hit = ownerCache.get(className);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = [];
  try {
    const { default: ClassRoster } = await import("../models/ClassRoster.js");
    const raw = await ClassRoster.distinct("teacherEmail", { className });
    value = [...new Set(raw.flatMap(split))];
  } catch (err) {
    console.warn("[gradeVisibility] owner lookup failed:", err?.message || err);
  }
  if (ownerCache.size > 500) ownerCache.clear();
  ownerCache.set(className, { value, expires: Date.now() + CACHE_MS });
  return value;
}

// Hide when somebody who could own this has asked to, and nobody has asked
// not to.
//
// With one owner this is just their setting. With several — a shared class,
// or two addresses in one field — it honours the only teacher who has
// expressed a view, rather than doing nothing because the data is untidy.
// The asymmetry is deliberate: hiding a mark is recoverable in a click,
// showing a family a mark that was never the grade is not.
export async function hidesGradesForResult(meta) {
  const owners = await teachersForResult(meta);
  if (!owners.length) return false;
  const views = await Promise.all(owners.map((e) => hidesGrades(e)));
  return views.some(Boolean);
}

export function invalidateGradeVisibility(teacherEmail) {
  cache.delete(String(teacherEmail || "").trim().toLowerCase());
}

// Remove the mark from a student-facing payload.
//
// The payloads are plain text built by the grading modes, and every one of
// them puts the mark on its own line: "Grade: 6 / 10", sometimes with a
// trailing "Ref: AB123" that has to survive. Percentages and section
// subtotals go too — "8/10 on Knowledge" is the same number by another name.
// Everything else (strengths, next steps, comments, the level words the bars
// are drawn from) is untouched.
// A mark as a word. Four bands, because more would be a mark with letters on.
export function band(ratio) {
  if (ratio >= 0.9) return "VG";   // very good
  if (ratio >= 0.75) return "G";   // good
  if (ratio >= 0.5) return "S";    // satisfactory
  return "N";                      // needs improvement
}

export function stripGradesFromPayload(payload) {
  const text = String(payload || "");
  if (!text) return text;

  const out = [];
  for (const line of text.split("\n")) {
    const t = line.trim();

    // "Grade: 6 / 10" or "Grade: 6 / 10  Ref: AB123" — keep the ref.
    const graded = t.match(/^Grade:\s*\S+\s*\/\s*\S+(\s+Ref:\s*(\S+))?\s*$/i);
    if (graded) {
      if (graded[2]) out.push(`Ref: ${graded[2]}`);
      continue;
    }
    // "Score: 6 / 10", "Total: 6/10", "Overall: 60%"
    if (/^(score|total|overall|mark|result)\s*:\s*[\d.]+\s*(\/\s*[\d.]+|%)\s*$/i.test(t)) continue;
    // A bare percentage line.
    if (/^\d{1,3}(\.\d+)?%$/.test(t)) continue;
    // Section subtotals: "Knowledge: 4/5", "- Communication 3 / 4"
    if (/^[-•*\s]*[A-Za-z][A-Za-z /&'-]{1,40}[:\s]\s*[\d.]+\s*\/\s*[\d.]+\s*$/.test(t)) continue;

    // An achievement line carries the level AND a mark:
    //   "- K Knowledge & Understanding 3.50/5.00 [strong]: good grasp"
    // The level is the bar the teacher wants shown, so keep the line and take
    // only the number out of it — dropping it whole would remove the bar too.
    const withLevel = line.match(/^(.*?)\s*[\d.]+\s*\/\s*[\d.]+\s*(\[[^\]]+\].*)$/);
    if (withLevel) { out.push(`${withLevel[1]} ${withLevel[2]}`); continue; }

    // A criterion with a mark and no level of its own:
    //   "- Title: 0/1 — Title 'Figure me out' not present"
    // Deleting these would take the breakdown with them, which is the most
    // useful part of the feedback. So the mark becomes a band — VG, G, S, N —
    // which says how it went without putting a number on it.
    const crit = line.match(/^(\s*[-•*]?\s*.+?[:\s])\s*([\d.]+)\s*\/\s*([\d.]+)(\s*(?:—|-|–|:).*)?$/);
    if (crit) {
      const got = parseFloat(crit[2]);
      const max = parseFloat(crit[3]);
      if (Number.isFinite(got) && Number.isFinite(max) && max > 0) {
        out.push(`${crit[1].replace(/[:\s]+$/, "")}: ${band(got / max)}${crit[4] || ""}`);
        continue;
      }
    }

    out.push(line);
  }
  // Collapse the blank runs left behind by the removals.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
