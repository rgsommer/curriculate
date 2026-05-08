// End-to-end test for the class-linking + tier-gating + improvement
// pipeline. Exercises the pure-function units (no Mongo connection).
//
// Run from the backend dir:
//   node tests/test-class-linking-flow.mjs

import { hasTierAtLeast, tierRank } from "../utils/tierGate.js";
import { buildSessionEdsbyCsv } from "../email/sessionGradesCsv.js";

let passes = 0;
let failures = 0;

function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passes += 1;
  else failures += 1;
  console.log(ok ? "✓" : "✗", label,
    ok ? "" : `\n   actual:   ${JSON.stringify(actual)}\n   expected: ${JSON.stringify(expected)}`);
}

function truthy(actual, label) {
  const ok = !!actual;
  if (ok) passes += 1;
  else failures += 1;
  console.log(ok ? "✓" : "✗", label,
    ok ? "" : `\n   got falsy value: ${JSON.stringify(actual)}`);
}

// ─────────────────────────────────────────────────────────────────────
// 1. Tier gating
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Tier gating —");
eq(hasTierAtLeast("FREE", "PLUS"), false, "FREE blocks PLUS gate");
eq(hasTierAtLeast("FREE", "PRO"),  false, "FREE blocks PRO gate");
eq(hasTierAtLeast("PLUS", "PLUS"), true,  "PLUS passes PLUS gate");
eq(hasTierAtLeast("PLUS", "PRO"),  false, "PLUS blocks PRO gate");
eq(hasTierAtLeast("PRO",  "PLUS"), true,  "PRO passes PLUS gate");
eq(hasTierAtLeast("PRO",  "PRO"),  true,  "PRO passes PRO gate");
eq(hasTierAtLeast("TEACHER_PLUS_MONTHLY", "PLUS"), true,  "Stripe label parses PLUS");
eq(hasTierAtLeast("TEACHER_PRO_MONTHLY",  "PRO"),  true,  "Stripe label parses PRO");
eq(hasTierAtLeast("SCHOOL_PRO_YEARLY",    "PRO"),  true,  "School PRO passes");
eq(hasTierAtLeast("",                     "PLUS"), false, "Empty plan blocks PLUS");
eq(tierRank("FREE"), 0, "rank FREE = 0");
eq(tierRank("PLUS"), 1, "rank PLUS = 1");
eq(tierRank("PRO"),  2, "rank PRO  = 2");

// ─────────────────────────────────────────────────────────────────────
// 2. CSV builder — Mode A (no roster)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— CSV: Mode A (no roster) —");
{
  const studentGrades = [
    { studentName: "Alice Apple",   pointsEarned: 50, pointsPossible: 70, percent: 71.4, scaledGrade: 50, maxGrade: 70 },
    { studentName: "Bob Banana",    pointsEarned: 60, pointsPossible: 70, percent: 85.7, scaledGrade: 60, maxGrade: 70 },
    { studentName: "Did Not Start", pointsEarned: 0,  pointsPossible: 0,  percent: 0,    scaledGrade: 0,  maxGrade: 70 },
  ];
  const out = buildSessionEdsbyCsv({ studentGrades, perParticipant: [] });
  eq(out.completedCount, 2, "Mode A excludes pointsPossible=0 rows");
  eq(out.hasAnyId, false, "Mode A no IDs");
  eq(out.anyMatched, false, "Mode A no fuzzy match");
  truthy(out.csv.includes("Alice,Apple"), "Mode A CSV has Alice row");
  truthy(out.csv.includes("Bob,Banana"), "Mode A CSV has Bob row");
}

// ─────────────────────────────────────────────────────────────────────
// 3. CSV builder — Mode B (identities pre-attached)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— CSV: Mode B (identities pre-attached) —");
{
  const studentGrades = [
    { studentName: "Niyammat Dhillon", firstName: "Niyammat", lastName: "Dhillon", edsbyId: "11111", studentId: "22222",
      pointsEarned: 53, pointsPossible: 70, percent: 76, scaledGrade: 53.9, maxGrade: 70 },
  ];
  const out = buildSessionEdsbyCsv({ studentGrades, perParticipant: [] });
  eq(out.hasAnyId, true, "Mode B has IDs");
  eq(out.anyMatched, false, "Mode B no fuzzy needed");
  truthy(out.csv.startsWith("Student ID,First Name"), "Mode B CSV header correct");
  truthy(out.csv.includes("11111,Niyammat,Dhillon"), "Mode B CSV row carries Edsby ID");
}

// ─────────────────────────────────────────────────────────────────────
// 4. CSV builder — Mode C (post-hoc Levenshtein)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— CSV: Mode C (post-hoc Levenshtein) —");
{
  const studentGrades = [
    { studentName: "Eli Cambell", pointsEarned: 46, pointsPossible: 70, percent: 65.7, scaledGrade: 46, maxGrade: 70 },
    { studentName: "Ghost Player", pointsEarned: 30, pointsPossible: 70, percent: 42.9, scaledGrade: 30, maxGrade: 70 },
  ];
  const rosterStudents = [
    { firstName: "Eli", lastName: "Campbell", edsbyId: "C-1", studentId: "C-S1" }, // Levenshtein 1 vs Cambell
  ];
  const out = buildSessionEdsbyCsv({ studentGrades, perParticipant: [], rosterStudents });
  eq(out.anyMatched, true, "Mode C fuzzy match flagged");
  eq(out.hasAnyId, true, "Mode C has at least one ID");
  truthy(out.csv.includes("C-1,Eli,Campbell"), "Mode C uses canonical roster spelling (Campbell)");
  truthy(out.csv.includes(",Ghost,Player"), "Mode C leaves unmatched as blank-Student-ID row");
}

// ─────────────────────────────────────────────────────────────────────
// 5. CSV builder — comment + refCode threading
// ─────────────────────────────────────────────────────────────────────
console.log("\n— CSV: comment + refCode —");
{
  const studentGrades = [
    { studentName: "Anna Apricot", edsbyId: "A-1", firstName: "Anna", lastName: "Apricot",
      pointsEarned: 60, pointsPossible: 70, percent: 85.7, scaledGrade: 60, maxGrade: 70 },
  ];
  const perParticipant = [
    { studentName: "Anna Apricot", refCode: "AB123", comment: "Strong performance, with care needed on T/F." },
  ];
  const out = buildSessionEdsbyCsv({ studentGrades, perParticipant, assessmentName: "Test 7" });
  truthy(out.csv.includes("Strong performance"), "Comment text included");
  truthy(out.csv.includes("results/AB123"), "RefCode link included");
  truthy(out.csv.includes("/progress"), "Progress link included");
}

// ─────────────────────────────────────────────────────────────────────
// 6. Levenshtein-≤2 algorithm — boundary cases
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Levenshtein boundary —");
{
  // Test that the matcher rejects a name that's too far off
  const studentGrades = [
    { studentName: "Xyz Zzy", pointsEarned: 50, pointsPossible: 70, percent: 71.4, scaledGrade: 50, maxGrade: 70 },
  ];
  const rosterStudents = [
    { firstName: "Alice", lastName: "Apple", edsbyId: "A-1", studentId: "A-S1" },
  ];
  const out = buildSessionEdsbyCsv({ studentGrades, perParticipant: [], rosterStudents });
  eq(out.anyMatched, false, "Levenshtein rejects nothing-in-common name");
  eq(out.hasAnyId, false, "No IDs in CSV when no match");
}

// ─────────────────────────────────────────────────────────────────────
// 7. Streak math (date-of-day arithmetic)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Streak math —");
{
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  function nextStreak(prevStreak, lastPlayedAt, today) {
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    if (!lastPlayedAt) return 1;
    const lp = new Date(lastPlayedAt);
    const startOfLast = new Date(lp.getFullYear(), lp.getMonth(), lp.getDate()).getTime();
    const diff = startOfToday - startOfLast;
    if (diff <= 0) return prevStreak || 1;
    if (diff <= ONE_DAY_MS + 1) return (prevStreak || 0) + 1;
    return 1;
  }
  // First time
  eq(nextStreak(0, null, new Date("2026-05-07")), 1, "first session → streak 1");
  // Same day re-play
  eq(nextStreak(3, new Date("2026-05-07T08:00:00"), new Date("2026-05-07T15:00:00")), 3, "same-day keeps streak");
  // Next day
  eq(nextStreak(3, new Date("2026-05-06T15:00:00"), new Date("2026-05-07T08:00:00")), 4, "next-day extends streak");
  // 2-day gap
  eq(nextStreak(3, new Date("2026-05-05"), new Date("2026-05-07")), 1, "2-day gap resets streak");
  // 1-week gap
  eq(nextStreak(10, new Date("2026-04-30"), new Date("2026-05-07")), 1, "1-week gap resets streak");
}

// ─────────────────────────────────────────────────────────────────────
// 8. Improvement / trend computation
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Improvement / trend —");
{
  function attachImprovement(g, recent) {
    if (!recent.length) {
      g.improvement = { priorCount: 0, vsLast: null, vsAvg: null, trend: "first" };
      return;
    }
    const last = recent[recent.length - 1];
    const vsLast = Math.round((g.percent - (Number(last?.percent) || 0)) * 10) / 10;
    const avg = recent.reduce((s, r) => s + (Number(r?.percent) || 0), 0) / recent.length;
    const vsAvg = Math.round((g.percent - avg) * 10) / 10;
    const trend = vsLast >= 5 ? "up" : vsLast <= -5 ? "down" : "flat";
    g.improvement = { priorCount: recent.length, vsLast, vsAvg, trend };
  }
  const cases = [
    { now: 78, prior: [60, 65, 68], wantTrend: "up",   wantVsLast: 10 },
    { now: 55, prior: [70, 75, 72], wantTrend: "down", wantVsLast: -17 },
    { now: 70, prior: [68, 72, 70], wantTrend: "flat", wantVsLast: 0 },
    { now: 82, prior: [],            wantTrend: "first", wantVsLast: null },
  ];
  for (const c of cases) {
    const g = { percent: c.now };
    attachImprovement(g, c.prior.map((p) => ({ percent: p })));
    eq(g.improvement.trend, c.wantTrend, `now=${c.now} prior=${JSON.stringify(c.prior)} → trend=${c.wantTrend}`);
    eq(g.improvement.vsLast, c.wantVsLast, `   vsLast = ${c.wantVsLast}`);
  }
}

// ─────────────────────────────────────────────────────────────────────
// 9. Mode B server-side roster validation (defensive lock)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Mode B identity validation —");
{
  // Simulates the cleanMemberDetails block in handleStudentJoinRoom that
  // strips ID claims when they don't match the bound roster.
  function validate(memberDetails, roster) {
    const rosterById = new Map();
    const rosterByName = new Map();
    for (const s of roster) {
      if (s.edsbyId) rosterById.set(s.edsbyId, s);
      if (s.studentId && !rosterById.has(s.studentId)) rosterById.set(s.studentId, s);
      const fullKey = `${(s.firstName || "").toLowerCase()}|${(s.lastName || "").toLowerCase()}`;
      rosterByName.set(fullKey, s);
    }
    for (const md of memberDetails) {
      if (!md.edsbyId && !md.studentId && !md.firstName) continue;
      let canonical = null;
      if (md.edsbyId && rosterById.has(md.edsbyId)) canonical = rosterById.get(md.edsbyId);
      else if (md.studentId && rosterById.has(md.studentId)) canonical = rosterById.get(md.studentId);
      else {
        const k = `${(md.firstName || "").toLowerCase()}|${(md.lastName || "").toLowerCase()}`;
        if (rosterByName.has(k)) canonical = rosterByName.get(k);
      }
      if (canonical) {
        md.firstName = canonical.firstName;
        md.lastName = canonical.lastName;
        md.edsbyId = canonical.edsbyId;
        md.studentId = canonical.studentId;
      } else {
        md.firstName = "";
        md.lastName = "";
        md.edsbyId = "";
        md.studentId = "";
      }
    }
    return memberDetails;
  }

  const roster = [
    { firstName: "Alice", lastName: "Apple",  edsbyId: "A-1", studentId: "A-S1" },
    { firstName: "Bob",   lastName: "Banana", edsbyId: "B-1", studentId: "B-S1" },
  ];

  // Legitimate pick
  const legit = validate([{ edsbyId: "A-1", firstName: "Alice", lastName: "Apple" }], roster);
  eq(legit[0].edsbyId, "A-1", "Legit pick keeps edsbyId");

  // Spoofed edsbyId — not in roster
  const spoof = validate([{ edsbyId: "EVIL-1", firstName: "Evil", lastName: "Person" }], roster);
  eq(spoof[0].edsbyId, "", "Spoofed edsbyId stripped");
  eq(spoof[0].firstName, "", "Spoofed name stripped");
}

// ─────────────────────────────────────────────────────────────────────
// 10. Email-template branch selection (Mode A vs B)
// ─────────────────────────────────────────────────────────────────────
console.log("\n— Email body branch selection —");
{
  // Reproduces the buildCsvImportBlockHtml branch logic from
  // backend/email/transcriptEmailer.js.
  function chooseBlock({ csvInfo, classBound }) {
    if (!csvInfo) return "none";
    if (csvInfo.hasAnyId && classBound) return "edsby_attached_modeB";
    if (csvInfo.hasAnyId && !classBound) return "edsby_attached_modeC";
    return "generic_with_prompt";
  }
  eq(chooseBlock({ csvInfo: null, classBound: false }), "none", "no CSV → no block");
  eq(chooseBlock({ csvInfo: { hasAnyId: false, completedCount: 3 }, classBound: false }),
     "generic_with_prompt", "Mode A → upload-roster prompt");
  eq(chooseBlock({ csvInfo: { hasAnyId: true, completedCount: 3 }, classBound: true }),
     "edsby_attached_modeB", "Mode B → Edsby instructions");
  eq(chooseBlock({ csvInfo: { hasAnyId: true, completedCount: 3 }, classBound: false }),
     "edsby_attached_modeC", "Mode C-style (matched but not bound) → Edsby instructions");
}

// ─────────────────────────────────────────────────────────────────────
console.log(`\n${passes + failures} checks: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
