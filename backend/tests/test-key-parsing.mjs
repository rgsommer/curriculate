// An answer key, from whatever shape the teacher gives it in, to the mark
// scheme the markers actually use.
//
// This crosses the frontend/backend boundary on purpose. canonicaliseKeyText
// runs in the browser and markSchemeFromKey / parseKeyAnswers run on the
// server, and the contract between them is a text format with no schema and
// no types. Three separate faults this week were that contract drifting:
//
//   - a Word key in markdown parsed to NO sections, so a 30-mark test went
//     out marked 6 out of 7 against a scheme the model invented;
//   - an arrow inside an answer ("add 5 -> 23, 28") read as a new item and
//     took the rest of the answer with it;
//   - a trailing comma on "A1: A," stopped it matching a student's "A".
//
//   node backend/tests/test-key-parsing.mjs
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const { routeRubricAndKey, canonicaliseKeyText } =
  await import(path.join(repo, "frontend/src/app/grading/consensusKey.js"));
const { markSchemeFromKey, declaredTotals } =
  await import(path.join(repo, "backend/utils/sectionTotals.js"));
const { parseKeyAnswers, isClosedSetSection, answersMatch, normaliseAnswer } =
  await import(path.join(repo, "backend/utils/objectiveMarking.js"));

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}\n        got    ${JSON.stringify(got)}`);
};

// What the markers see, however the key arrived.
const schemeOf = (keyText) => {
  const key = routeRubricAndKey("", keyText).answerKey;
  const scheme = markSchemeFromKey(key);
  return {
    key,
    total: declaredTotals(key)[0] || 0,
    sections: [...scheme.entries()].map(([l, items]) => ({
      letter: l,
      items: items.length,
      outOf: items.reduce((t, i) => t + i.outOf, 0),
    })),
    answers: parseKeyAnswers(key),
  };
};

/* ---------------------------------------------------------------- *
 * 1. A key exported from Word, which is markdown.
 * ---------------------------------------------------------------- */
console.log("\na key exported from Word (markdown)");
{
  const WORD = [
    "# Math 7 --- Chapter 1",
    "",
    "**Unit Test --- Accommodated / 30 marks**",
    "",
    "**A. Key terms --- matching (5)**",
    "",
    "> **1 → A, 2 → D, 3 → C, 4 → B, 5 → E**",
    "",
    "**B. True or false (4)**",
    "",
    "> **1. TRUE**",
    ">",
    "> *you multiply first, so 10 - 6 = 4*",
    ">",
    "> **2. TRUE**",
    ">",
    "> **3. FALSE**",
    ">",
    "> **4. FALSE**",
    "",
    "**C. Fill in the blank (4)**",
    "",
    "> **1. brackets**",
    ">",
    "> **2. 5**",
    ">",
    "> **3. 7x**",
    ">",
    "> **4. 3n**",
    "",
    "**D. Show your work (12)**",
    "",
    "> **1. 3, 18, 16**",
    ">",
    "> **2. x = 6, y = 7, x = 21**",
    ">",
    "> **3. add 5 → 23, 28; multiply by 2 → 24, 48**",
    ">",
    "> **4. 15 pages per minute, 90 pages, 8 minutes**",
    "",
    "**E. Extended problem (5)**",
    "",
    "> **1. 11, 12, 13**",
  ].join("\n");

  const s = schemeOf(WORD);
  check("every section is found", s.sections, [
    { letter: "A", items: 5, outOf: 5 },
    { letter: "B", items: 4, outOf: 4 },
    { letter: "C", items: 4, outOf: 4 },
    { letter: "D", items: 4, outOf: 12 },
    { letter: "E", items: 1, outOf: 5 },
  ]);
  check("the paper's declared total is read", s.total, 30);
  check("the scheme adds to the declared total",
    s.sections.reduce((t, x) => t + x.outOf, 0), 30);

  // The matching letters and the true/falses must be settled by comparison,
  // never by judgement — that is the whole point of reading them in code.
  check("A is a closed set", isClosedSetSection(s.answers.get("A")), true);
  check("B is a closed set", isClosedSetSection(s.answers.get("B")), true);
  check("C is not", isClosedSetSection(s.answers.get("C")), false);

  // An arrow inside an answer is not an item separator.
  check("D3 keeps its whole answer", s.answers.get("D").get("3"),
    "add 5 → 23, 28; multiply by 2 → 24, 48");
  check("D has four items, not five", s.answers.get("D").size, 4);

  // The teacher's own note must not become an answer.
  check("the note \"10 - 6 = 4\" is not item 6", s.answers.get("B").has("6"), false);
  check("B still has exactly four", s.answers.get("B").size, 4);

  // A trailing comma has to come off an inline list, or the letter never
  // matches: "1 → A, 2 → D" left "A," against the key, and a student who
  // wrote A was marked wrong. Compared the way markObjective compares —
  // both sides through normaliseAnswer.
  const marks = (wrote, letter, n) =>
    answersMatch(normaliseAnswer(wrote), s.answers.get(letter).get(n));
  check("a student's a matches A1", marks("a", "A", "1"), true);
  check("a student's D matches A2", marks("D", "A", "2"), true);
  check("a student's b does not match A2", marks("b", "A", "2"), false);
  check("True matches B1", marks("True", "B", "1"), true);
  check("False does not match B1", marks("False", "B", "1"), false);
  check("brackets matches C1", marks("brackets", "C", "1"), true);
  check("bracket matches C1 too", marks("bracket", "C", "1"), true);
}

/* ---------------------------------------------------------------- *
 * 2. Plain prose, the way a key is typed straight into the box.
 * ---------------------------------------------------------------- */
console.log("\na key typed as prose");
{
  const PROSE = [
    "Geography 7 Unit Test  Total: /50",
    "",
    "A. Matching ( 10 marks )",
    "1. E  2. I  3. C  4. H  5. D  6. A  7. J  8. B  9. F  10. G",
    "",
    "B. True or false (5 marks)",
    "1. T  2. F  3. T  4. T  5. F",
    "",
    "C. Short answer (35)",
    "1. the prime meridian",
    "2. latitude",
  ].join("\n");

  const s = schemeOf(PROSE);
  check("sections found", s.sections.map((x) => `${x.letter}/${x.outOf}`), ["A/10", "B/5", "C/35"]);
  check("declared total", s.total, 50);
  check("ten matching items", s.answers.get("A").size, 10);
  check("A10 is G, not swallowed by A1", s.answers.get("A").get("10"), "G");
  check("A is a closed set", isClosedSetSection(s.answers.get("A")), true);
  check("B is a closed set", isClosedSetSection(s.answers.get("B")), true);
}

/* ---------------------------------------------------------------- *
 * 3. Nothing is made worse.
 * ---------------------------------------------------------------- */
console.log("\nleft alone");
{
  // Already canonical: the extractor's own output goes through untouched.
  const CANON = "A1: E (/1)\nA2: I (/1)\nB1: TRUE (/1)\nTotal: /3";
  check("an extracted key is unchanged", canonicaliseKeyText(CANON), CANON);

  // A rubric is not a key, and must not be rewritten into one.
  const RUBRIC = [
    "Level 4: The response shows thorough understanding and uses precise",
    "vocabulary throughout, with insightful supporting detail.",
    "Level 3: The response shows considerable understanding.",
    "Level 2: The response shows some understanding.",
    "Level 1: The response shows limited understanding.",
  ].join("\n");
  check("a rubric is not promoted", routeRubricAndKey(RUBRIC, "").answerKey, "");

  check("empty stays empty", canonicaliseKeyText(""), "");
  check("whitespace stays whitespace", canonicaliseKeyText("   "), "   ");
}

console.log(`\n${failed ? `${failed} check(s) FAILED` : "all checks passed"}`);
process.exit(failed ? 1 : 0);
