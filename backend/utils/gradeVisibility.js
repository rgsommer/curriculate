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

export async function hidesGrades(teacherEmail) {
  const email = String(teacherEmail || "").trim().toLowerCase();
  if (!email) return false;

  const hit = cache.get(email);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = false;
  try {
    const doc = await TeacherSettings.findOne({ teacherEmail: email }).select("hideGradesFromStudents").lean();
    value = !!doc?.hideGradesFromStudents;
  } catch (err) {
    // Fail open: a database hiccup must not start hiding marks a teacher
    // never asked to hide, nor revealing ones they did. Showing is the
    // long-standing default, so that is the safer of the two.
    console.warn("[gradeVisibility] lookup failed:", err?.message || err);
    value = false;
  }
  if (cache.size > 500) cache.clear();
  cache.set(email, { value, expires: Date.now() + CACHE_MS });
  return value;
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

    out.push(line);
  }
  // Collapse the blank runs left behind by the removals.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
