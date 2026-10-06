// Check of src/app/daily/apps-script/journal-on-a-test-day.gs — the rule that
// keeps a test day's journal off the subject of writing tests.
//
// Run from frontend/:  node scripts/journal-guard-check.mjs
//
// The file is Apps Script, so it is loaded as text and run in a Function with
// the Sheets globals stubbed. Everything checked here is pure; the two
// functions that read the sheet (unitsAroundTest_, checkJournals) are given a
// stub tab so their walk over the Lessons rows is checked too.

import fs from "node:fs";

const src = fs.readFileSync(new URL("../src/app/daily/apps-script/journal-on-a-test-day.gs", import.meta.url), "utf8");

// A stand-in for the Lessons tab: the code in C, the topic in D, from row 3.
const lessonRows = [
  ["~J015", "7.1 Unit 1: Number Sense — review for the test"],
  ["~J016", "Study . . ."],
  ["~J017", "Test — 7.1 Unit 1: Number Sense and Patterns and Algebra"],
  ["~J018", "Work period"],
  ["~J019", "Factors and multiples"],
  ["~J020", "Perfect squares and square roots"],
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
  `${src}\n;return { JOURNAL_RULES, isTestPeriod_, isTestSkillsJournal_, unitFromTestRow_, unitsAroundTest_, writtenJournal_, fixJournal_, normalizeCode_, codeIn_, lower_ };`
)(globals.SpreadsheetApp, globals.Logger);

let failures = 0;
const check = (label, ok, got) => {
  if (ok) { console.log(`ok   ${label}`); return; }
  failures += 1;
  console.log(`FAIL ${label}${got === undefined ? "" : ` ${JSON.stringify(got)}`}`);
};

// The lines are the teacher's own, off VerticalAi.
const testClass = [
  "Math 7A (23) 202 (J017)",
  "Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.",
  "What helps you stay calm and focused during a test?",
  "🍎 Journal: Think about a time you faced a challenging test or situation. What practical steps, thoughts, or prayers helped you handle stress and do your best? How could you apply those strategies during today’s test?",
  "- Complete Test — 7.1 Unit 1.",
].join("\n");
const testJournal = testClass.split("\n")[3];

const goodClass = [
  "History 7C (22) 206 (H007)",
  "Today we perform Skit #1, continue our case study, and launch the project.",
  "What makes a true peacemaker when treaties fail and tensions rise?",
  "🍎 Journal: When conflicts persist despite agreements, how do you personally practice peacemaking at school or home? Reflect on “Blessed are the peacemakers” and Micah 6:8.",
].join("\n");
const goodJournal = goodClass.split("\n")[3];

check("a test period is recognised", G.isTestPeriod_(testClass));
check("an ordinary lesson is not", !G.isTestPeriod_(goodClass), goodClass);
check("a quiz counts", G.isTestPeriod_("Quiz on p73 #3"));
check("so does a unit test written in capitals", G.isTestPeriod_("Unit 2 TEST\nThe Promised Land"));

check("the teacher's own test journal is caught", G.isTestSkillsJournal_(testJournal));
check("a peacemaking journal is left alone", !G.isTestSkillsJournal_(goodJournal), goodJournal);
check("so is one about the unit", !G.isTestSkillsJournal_(
  "🍎 Journal: Which idea in Number Sense took longest to come clear?"));
check("nerves are caught however they are put", G.isTestSkillsJournal_(
  "🍎 Journal: What do you do when you feel nervous before a quiz?"));
check("study habits are caught", G.isTestSkillsJournal_(
  "🍎 Journal: What study habits worked for you this term?"));
check("a unit that is genuinely about stress is not", !G.isTestSkillsJournal_(
  "🍎 Journal: How does stress affect the body, and what did Daniel do under pressure?"));

check("the unit comes out of the test row",
  G.unitFromTestRow_("Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra.")
    === "Number Sense and Patterns and Algebra",
  G.unitFromTestRow_("Today we take the Test — 7.1 Unit 1: Number Sense and Patterns and Algebra."));
check("and out of one written the other way round",
  G.unitFromTestRow_("Test on The Divided Kingdom: 1-2 Kings") === "The Divided Kingdom: 1-2 Kings",
  G.unitFromTestRow_("Test on The Divided Kingdom: 1-2 Kings"));
check("a bare unit test still names its unit",
  G.unitFromTestRow_("Unit 2 TEST") === "Unit 2", G.unitFromTestRow_("Unit 2 TEST"));
check("a test row naming nothing gives nothing",
  G.unitFromTestRow_("Test") === "", G.unitFromTestRow_("Test"));

check("the code comes out of the class text", G.codeIn_(testClass) === "J017", G.codeIn_(testClass));
check("and out of Vertical's bullet shape",
  G.codeIn_("Math 7A (23) 202\n● ~J017  : Unit test") === "J017");
check("a camera after the code does not hide it", G.normalizeCode_("~G007 📷") === "G007");

const about = G.unitsAroundTest_("J017", "Test — 7.1 Unit 1: Number Sense and Patterns and Algebra");
check("the next unit skips the work period and the review",
  about.next === "Factors and multiples", about);
check("and the tested unit comes with it",
  about.tested === "Number Sense and Patterns and Algebra", about);
check("another subject's rows are not walked into",
  G.unitsAroundTest_("J020", "Test on square roots").next === "", G.unitsAroundTest_("J020", "Test"));

const written = G.writtenJournal_(about);
check("the written journal looks forward by name",
  /factors and multiples/i.test(written) && !/test/i.test(written), written);
check("it keeps the apple", written.indexOf("🍎 Journal:") === 0, written);
check("with no next unit it looks back by name",
  /Number Sense/.test(G.writtenJournal_({ tested: "Number Sense and Patterns and Algebra", next: "" })),
  G.writtenJournal_({ tested: "Number Sense and Patterns and Algebra", next: "" }));
check("with neither it still asks about the unit",
  /unit this test covers/.test(G.writtenJournal_({})), G.writtenJournal_({}));

check("the fix replaces the test-skills journal",
  G.fixJournal_(testJournal, testClass, about) === written,
  G.fixJournal_(testJournal, testClass, about));
check("and leaves a good one on a test day alone",
  G.fixJournal_("🍎 Journal: Which idea took longest to come clear?", testClass, about)
    === "🍎 Journal: Which idea took longest to come clear?");
check("and never touches a day that is not a test",
  G.fixJournal_(testJournal, goodClass, about) === testJournal);

check("the rule says what it is for", /test day/i.test(G.JOURNAL_RULES) && /next/i.test(G.JOURNAL_RULES));

console.log(failures ? `\n${failures} failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
