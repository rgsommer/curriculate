// A homework set that spans several lessons.
//
// The lesson field took one code. A set covering NS7-18, NS7-19 and NS7-21
// therefore loaded one key, and every question from the other two lessons
// came back "no key" — reported to the teacher as unverifiable work rather
// than as a key that was never looked up.
//
// Two things have to be right for several lessons to work at all:
//   - whatever the teacher types between the codes is a separator, and the
//     hyphen inside a code is not;
//   - question 1 exists in every lesson and the answers differ, so the key
//     the grader sees is grouped under its lesson rather than flattened.
//
//   node backend/tests/test-homework-lessons.mjs
const { parseLessonCodes, keyLinesFor } = await import("../routes/homeworkCheck.js");

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok) console.log(`        wanted ${JSON.stringify(want)}\n        got    ${JSON.stringify(got)}`);
};

console.log("\nreading the codes a teacher types");
check("commas", parseLessonCodes("NS7-18, NS7-19, NS7-21"), ["NS7-18", "NS7-19", "NS7-21"]);
check("spaces only", parseLessonCodes("NS7-18 NS7-19"), ["NS7-18", "NS7-19"]);
check("semicolons and slashes", parseLessonCodes("ns7-18; ns7-19 / ns7-21"), ["NS7-18", "NS7-19", "NS7-21"]);
check("the word and", parseLessonCodes("NS7-18 and NS7-19"), ["NS7-18", "NS7-19"]);
// The hyphen is part of the code, never a separator.
check("one code is still one code", parseLessonCodes("NS7-3"), ["NS7-3"]);
check("a decimal code survives", parseLessonCodes("3.4, 3.5"), ["3.4", "3.5"]);
check("the same code twice is once", parseLessonCodes("NS7-18, NS7-18"), ["NS7-18"]);
check("nothing typed", parseLessonCodes("   "), []);
check("undefined", parseLessonCodes(undefined), []);

console.log("\nwhat the grader is shown");
// One lesson is exactly what it always was — a flat list, no headings. The
// common case must not change shape.
check("one lesson stays flat",
  keyLinesFor([{ q: "1", answer: "42", lessonCode: "NS7-18" }, { q: "2", answer: "9", lessonCode: "NS7-18" }]),
  ["1 = 42", "2 = 9"]);
check("a key with no lesson recorded stays flat",
  keyLinesFor([{ q: "1", answer: "42" }]), ["1 = 42"]);

// Two lessons both have a question 1, and the answers differ. Flattened,
// whichever came second would overwrite the first in the grader's reading.
check("several lessons are grouped under their codes",
  keyLinesFor([
    { q: "1", answer: "42", lessonCode: "NS7-18" },
    { q: "2", answer: "9", lessonCode: "NS7-18" },
    { q: "1", answer: "7", lessonCode: "NS7-19" },
  ]),
  ["NS7-18:", "  1 = 42", "  2 = 9", "NS7-19:", "  1 = 7"]);

check("the teacher's order is kept",
  keyLinesFor([
    { q: "1", answer: "c", lessonCode: "NS7-21" },
    { q: "1", answer: "a", lessonCode: "NS7-18" },
  ]),
  ["NS7-21:", "  1 = c", "NS7-18:", "  1 = a"]);

console.log(`\n${failed ? `${failed} check(s) FAILED` : "all checks passed"}`);
process.exit(failed ? 1 : 0);
