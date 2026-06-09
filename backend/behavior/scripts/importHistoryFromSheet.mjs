// backend/behavior/scripts/importHistoryFromSheet.mjs
//
// Backfill each student's behaviour record (parsed by parseHistoryFromSheet.mjs)
// into the live DB: current incidents → BehaviorIncident, past notices →
// BehaviorNotice. Matched to existing students by name. All inserts are tagged
// legacyImport:true so they're reversible.
//
// SAFE BY DEFAULT: dry-run (match + report, NO writes). Pass --commit to write.
// Re-running --commit first deletes prior legacyImport rows for the matched
// students, so it's idempotent.
//
// Usage:
//   node behavior/scripts/importHistoryFromSheet.mjs            # dry run
//   node behavior/scripts/importHistoryFromSheet.mjs --commit   # write

import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import BehaviorSchool from "../models/BehaviorSchool.js";
import BehaviorTeacher from "../models/BehaviorTeacher.js";
import BehaviorStudent from "../models/BehaviorStudent.js";
import Behavior from "../models/Behavior.js";
import BehaviorIncident from "../models/BehaviorIncident.js";
import BehaviorNotice from "../models/BehaviorNotice.js";

const COMMIT = process.argv.includes("--commit");
const JSON_PATH = process.argv.find((a) => a.endsWith(".json")) || `${process.env.HOME}/Downloads/behaviour-history.json`;

const norm = (s) => String(s || "").toLowerCase().replace(/\([^)]*\)/g, "").replace(/[^a-z]/g, "");
const emailsIn = (t) => [...new Set((String(t || "").match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []).map((e) => e.toLowerCase()))];

function splitName(parsed) {
  if (parsed.lastFirst && parsed.lastFirst.includes(",")) {
    const [last, first] = parsed.lastFirst.split(",");
    return { last: last.trim(), first: (first || "").trim() };
  }
  const parts = String(parsed.name || "").trim().split(/\s+/);
  return { last: parts.slice(-1)[0] || "", first: parts.slice(0, -1).join(" ") };
}

const data = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });

const school = await BehaviorSchool.findOne().lean();
if (!school) { console.error("No BehaviorSchool found."); process.exit(1); }
const sommer =
  (await BehaviorTeacher.findOne({ schoolId: school._id, email: /rsommer/i }).lean()) ||
  (await BehaviorTeacher.findOne({ schoolId: school._id, role: "originator" }).lean());
if (!sommer) { console.error("No teacher to attribute imports to."); process.exit(1); }

// Student index: several keys per student + a lastName bucket for fallbacks.
const students = await BehaviorStudent.find({ schoolId: school._id }).lean();
const studentIdx = new Map();
const byLast = new Map();
const ft = (s) => norm(String(s).split(/\s+/)[0] || ""); // first token, normalized
for (const s of students) {
  const last = norm(s.lastName);
  studentIdx.set(`${last}|${norm(s.firstName)}`, s);
  if (s.preferredName) studentIdx.set(`${last}|${norm(s.preferredName)}`, s);
  studentIdx.set(`${last}|${ft(s.firstName)}`, s); // last|first-token
  if (!byLast.has(last)) byLast.set(last, []);
  byLast.get(last).push(s);
}
function matchStudent(parsed) {
  const { last, first } = splitName(parsed);
  const L = norm(last);
  return (
    studentIdx.get(`${L}|${norm(first)}`) ||
    studentIdx.get(`${L}|${ft(first)}`) ||
    // last name unique in the roster → accept it
    (byLast.get(L) && byLast.get(L).length === 1 ? byLast.get(L)[0] : null)
  );
}

// Behaviour matching: exact, else fuzzy (one name is a prefix of the other) so
// "No computer" → "No computer/charger" and "Disruptive behaviour involving
// Blue" → "Disruptive behaviour". Missing ones are created on --commit.
const behaviors = await Behavior.find({ schoolId: school._id }).lean();
const behIdx = new Map(behaviors.map((b) => [norm(b.name), b]));
function resolveBehavior(offense) {
  const key = norm(offense);
  if (behIdx.has(key)) return behIdx.get(key);
  let best = null;
  for (const b of behIdx.values()) {
    const bn = norm(b.name);
    if (key.startsWith(bn) || bn.startsWith(key)) {
      if (!best || norm(best.name).length < bn.length) best = b;
    }
  }
  return best; // null if truly new
}
const missingOffenses = new Set();

let matched = 0;
const unmatched = [];
let plannedIncidents = 0;
let plannedNotices = 0;
const plan = []; // { student, incidents:[...], notices:[...] }

for (const p of data) {
  const stu = matchStudent(p);
  if (!stu) { unmatched.push(p.name); continue; }
  matched++;
  for (const inc of p.incidents) {
    if (!resolveBehavior(inc.offense)) missingOffenses.add(inc.offense);
  }
  plannedIncidents += p.incidents.length;
  plannedNotices += p.notices.length;
  plan.push({ stu, parsed: p });
}

console.log(`\n=== ${COMMIT ? "COMMIT" : "DRY RUN"} — legacy history import ===`);
console.log(`School: ${school.name}  | attributing to: ${sommer.name || sommer.email}`);
console.log(`Parsed students: ${data.length}  | matched to DB: ${matched}  | unmatched: ${unmatched.length}`);
console.log(`Incidents to insert: ${plannedIncidents}  | notices to insert: ${plannedNotices}`);
if (unmatched.length) console.log(`Unmatched names: ${unmatched.join(", ")}`);
if (missingOffenses.size) console.log(`Offenses not in master (will be created as standard): ${[...missingOffenses].join(", ")}`);

if (!COMMIT) {
  console.log(`\nDry run only — no writes. Re-run with --commit to apply.`);
  await mongoose.disconnect();
  process.exit(0);
}

// ── COMMIT ───────────────────────────────────────────────────────────────────
// Create any missing behaviours as standard.
for (const name of missingOffenses) {
  const doc = await Behavior.create({ schoolId: school._id, name, scope: "standard", triggerMode: "THRESHOLD" });
  behIdx.set(norm(name), doc.toObject());
}

let insIncidents = 0, insNotices = 0;
for (const { stu, parsed } of plan) {
  // Idempotency: clear any prior legacy rows for this student.
  await BehaviorIncident.deleteMany({ studentId: stu._id, legacyImport: true });
  await BehaviorNotice.deleteMany({ studentId: stu._id, legacyImport: true });

  const incidentDocs = parsed.incidents.map((inc) => {
    const beh = resolveBehavior(inc.offense);
    return {
      schoolId: school._id, studentId: stu._id, teacherId: sommer._id, behaviorId: beh._id,
      behaviorSnapshot: {
        name: beh.name, description: beh.description || "",
        triggerMode: beh.triggerMode || "THRESHOLD", consequenceText: beh.consequenceText || "",
      },
      detailText: inc.comment || "", immediateFlag: beh.triggerMode === "IMMEDIATE",
      timestamp: new Date(inc.date), legacyImport: true,
    };
  });
  if (incidentDocs.length) { await BehaviorIncident.insertMany(incidentDocs); insIncidents += incidentDocs.length; }

  const noticeDocs = parsed.notices.map((n, i) => ({
    schoolId: school._id, studentId: stu._id, sequenceNo: i + 1, reason: "threshold",
    fromTeachers: [{ teacherId: sommer._id, name: sommer.name || "" }],
    channels: ["email"], recipients: emailsIn(n.text).map((e) => ({ role: "parent", email: e })),
    renderedText: n.text, aiUsed: false, status: "sent", sentByTeacherId: sommer._id,
    sentAt: new Date(n.date), createdAt: new Date(n.date), legacyImport: true,
  }));
  if (noticeDocs.length) { await BehaviorNotice.insertMany(noticeDocs); insNotices += noticeDocs.length; }

  // Keep the CC-VP sequence correct going forward.
  await BehaviorStudent.updateOne({ _id: stu._id }, { $set: { noticesHomeCount: parsed.notices.length } });
}

console.log(`\n✅ Committed: ${insIncidents} incidents, ${insNotices} notices across ${plan.length} students.`);
await mongoose.disconnect();
