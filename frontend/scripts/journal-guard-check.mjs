// Check of src/app/daily/apps-script/journal-about-the-unit.gs — the rule that
// keeps the journal on a test, review or quiet-work day about the unit rather
// than about getting through the period.
//
// Run from frontend/:  node scripts/journal-guard-check.mjs
//
// The file is Apps Script, so it is loaded as text and run in a Function with
// the Sheets globals stubbed. Everything checked here is pure; the two
// functions that read the sheet (unitsAround_, checkJournals) are given a stub
// tab so their walk over the Lessons rows is checked too.

import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/app/daily/apps-script/journal-about-the-unit.gs", import.meta.url), "utf8");

// A stand-in for the Lessons tab: the code in C, the topic in D, from row 3.
const lessonRows = [
  ["~J015", "7.1 Unit 1: Number Sense — review for the test"],
  ["~J016", "Study . . ."],
  ["~J017", "Test — 7.1 Unit 1: Number Sense and Patterns and Algebra"],
  ["~J018", "Work period"],
  ["~J019", "Factors and multiples"],
  ["~J020", "Perfect squares and square roots"],
  ["~G009", "Quiet work time: Ch1 review tasks"],
  ["~G010", "Unit 2: Landforms and water"],
  ["~H001", "What makes a useful historical perspective?"],
];
const sheets = {
  Lessons: {
    getLastRow: () => lessonRows.length + 2,
    getRange: (row, col, rows, cols) =>
      ({ getValues: () => lessonRows.slice(row - 3, row - 3 + rows).map((r) => r.slice(col - 3, col - 3 + cols)) }),
  },
};
const globals = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: (name) => sheets[name] || null }) },
  Logger: { log: () => {} },
};

const G = new Function(
  "SpreadsheetApp", "Logger",
  `${src}\n;return { JOURNAL_RULES, periodKind_, isRoutineJournal_, unitFromRow_, unitsAround_, writtenJournal_, fixJournal_, normalizeCode_, codeIn_, lower_ };`
)(globals.SpreadsheetApp, globals.Logger);

let failures = 0;
const check = (label, ok, got) => {
  if (ok) { console.log(`ok   ${label}`); return; }
  failures += 1;
  console.log(`FAIL ${label}${got === undefined ? "" : ` ${JSON.stringify(got)}`}`);
};

// Both classes are the teacher's own, off VerticalAi.
const testClass = [
  "Math 7A (23) 202 (J017)",
  "Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.",
  "What helps you stay calm and focused during a test?",
  "🍎 Journal: Think about a time you faced a challenging test or situation. What practical steps, thoughts, or prayers helped you handle stress and do your best? How could you apply those strategies during today’s test?",
  "- Complete Test — 7.1 Unit 1.",
].join("\n");
const testJournal = testClass.split("\n")[3];

const workClass = [
  "Geography 8B (23) 211 (G009)",
  "Today we use quiet work time to complete assigned review tasks.",
  "What will you tackle first to make solid progress today?",
  "🍎 Journal: When you have a long list like today’s, how do you decide what to do first and stay focused? Describe one strategy that helps you keep momentum when working quietly and independently.",
  "- ✋Quiet Work Time (graded); whisper on topic only.",
  "- Complete XWord/Matching and Ch1 Review Handout.",
  "- Work on Study Guide and Practice Test.",
  "Reminders: Whisper on topic if needed; no loud talking or fooling around.",
].join("\n");
const workJournal = workClass.split("\n")[3];

const goodClass = [
  "History 7C (22) 206 (H007)",
  "Today we perform Skit #1, continue our case study, and launch the project.",
  "What makes a true peacemaker when treaties fail and tensions rise?",
  "🍎 Journal: When conflicts persist despite agreements, how do you personally practice peacemaking at school or home? Reflect on “Blessed are the peacemakers” and Micah 6:8.",
].join("\n");
const goodJournal = goodClass.split("\n")[3];

check("a test period is recognised", G.periodKind_(testClass) === "test", G.periodKind_(testClass));
check("a quiet work period is recognised", G.periodKind_(workClass) === "work", G.periodKind_(workClass));
check("an ordinary lesson is neither", G.periodKind_(goodClass) === "", G.periodKind_(goodClass));
check("a quiz counts as a test", G.periodKind_("Quiz on p73 #3") === "test");
check("so does a unit test written in capitals", G.periodKind_("Unit 2 TEST\nThe Promised Land") === "test");
check("a practice test is a work period, not a test",
  G.periodKind_("Today we work on the Study Guide and Practice Test.") === "work",
  G.periodKind_("Today we work on the Study Guide and Practice Test."));
check("a review period counts", G.periodKind_("Today we review Chapter 1 together.") === "work");

check("the test-day journal is caught", G.isRoutineJournal_(testJournal));
check("the quiet-work journal is caught", G.isRoutineJournal_(workJournal));
check("a peacemaking journal is left alone", !G.isRoutineJournal_(goodJournal), goodJournal);
check("so is one about the unit", !G.isRoutineJournal_(
  "🍎 Journal: Which idea in Number Sense took longest to come clear?"));
check("nerves are caught however they are put", G.isRoutineJournal_(
  "🍎 Journal: What do you do when you feel nervous before a quiz?"));
check("so is prioritising a list", G.isRoutineJournal_(
  "🍎 Journal: How do you prioritise when everything is due at once?"));
check("and working independently", G.isRoutineJournal_(
  "🍎 Journal: What helps you work independently without being reminded?"));
check("a unit that is genuinely about stress is not", !G.isRoutineJournal_(
  "🍎 Journal: How does stress affect the body, and what did Daniel do under pressure?"));
check("nor is a lesson about managing water", !G.isRoutineJournal_(
  "🍎 Journal: How do cities manage their water supply, and what would you change?"));

check("the unit comes out of the test row",
  G.unitFromRow_("Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.")
    === "Number Sense and Patterns and Algebra",
  G.unitFromRow_("Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra."));
check("and out of one written the other way round",
  G.unitFromRow_("Test on The Divided Kingdom: 1-2 Kings") === "The Divided Kingdom: 1-2 Kings",
  G.unitFromRow_("Test on The Divided Kingdom: 1-2 Kings"));
check("a bare unit test still names its unit",
  G.unitFromRow_("Unit 2 TEST") === "Unit 2", G.unitFromRow_("Unit 2 TEST"));
check("a work period falls back to the chapter its tasks name",
  G.unitFromRow_(workClass.split("\n").slice(1).join("\n")) === "Chapter 1",
  G.unitFromRow_(workClass.split("\n").slice(1).join("\n")));
check("a row naming nothing gives nothing",
  G.unitFromRow_("Test") === "", G.unitFromRow_("Test"));

check("the code comes out of the class text", G.codeIn_(testClass) === "J017", G.codeIn_(testClass));
check("and out of Vertical's bullet shape",
  G.codeIn_("Math 7A (23) 202\n● ~J017  : Unit test") === "J017");
check("a camera after the code does not hide it", G.normalizeCode_("~G007 📷") === "G007");

const about = G.unitsAround_("J017", "Test — 7.1 Unit 1: Number Sense and Patterns and Algebra");
check("the next unit skips the work period and the review",
  about.next === "Factors and multiples", about);
check("and the unit in hand comes with it",
  about.unit === "Number Sense and Patterns and Algebra", about);
check("another subject's rows are not walked into",
  G.unitsAround_("H001", "Test on perspective").next === "", G.unitsAround_("H001", "Test"));

const written = G.writtenJournal_(about, "test");
check("the test journal looks forward by name",
  /factors and multiples/i.test(written) && !/test/i.test(written), written);
check("it keeps the apple", written.indexOf("🍎 Journal:") === 0, written);
check("with no next unit it looks back by name",
  /Number Sense/.test(G.writtenJournal_({ unit: "Number Sense and Patterns and Algebra", next: "" }, "test")),
  G.writtenJournal_({ unit: "Number Sense and Patterns and Algebra", next: "" }, "test"));
check("with neither it still asks about the unit",
  /unit this test covers/.test(G.writtenJournal_({}, "test")), G.writtenJournal_({}, "test"));

const workAbout = G.unitsAround_("G009", workClass);
const workWritten = G.writtenJournal_(workAbout, "work");
check("a work period stays in the unit in hand",
  /Chapter 1/.test(workWritten) && !/hand(ed)? in/.test(workWritten), workWritten);
check("and does not look forward, since the unit is not finished",
  !/Landforms/.test(workWritten), workWritten);
check("a work period with no unit still asks about this one",
  /this unit/.test(G.writtenJournal_({}, "work")), G.writtenJournal_({}, "work"));

check("the fix replaces the test journal",
  G.fixJournal_(testJournal, testClass, about) === written,
  G.fixJournal_(testJournal, testClass, about));
check("the fix replaces the quiet-work journal",
  G.fixJournal_(workJournal, workClass, workAbout) === workWritten,
  G.fixJournal_(workJournal, workClass, workAbout));
check("and leaves a good one on a test day alone",
  G.fixJournal_("🍎 Journal: Which idea took longest to come clear?", testClass, about)
    === "🍎 Journal: Which idea took longest to come clear?");
check("and never touches an ordinary teaching day",
  G.fixJournal_(testJournal, goodClass, about) === testJournal);

check("the rule says what it is for",
  /test, review or quiet-work day/i.test(G.JOURNAL_RULES) && /momentum/i.test(G.JOURNAL_RULES));

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
