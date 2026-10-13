// Check of src/app/daily/apps-script/lesson-pictures.gs — the script that fills
// the Lessons picture column from Wikimedia Commons.
//
// Run from frontend/:        node scripts/lesson-pictures-check.mjs
// With the live search:      node scripts/lesson-pictures-check.mjs --live
//
// The file is Apps Script, so it is loaded as text and run in a Function with
// the Sheets globals stubbed. The query builder is pure and is checked always;
// `--live` also stubs UrlFetchApp with curl and asks Commons for real, which is
// the only way to know whether a subject's hint word pulls the right kind of
// picture.

import fs from "node:fs";
import { execFileSync } from "node:child_process";

const src = fs.readFileSync(new URL("../src/app/daily/apps-script/lesson-pictures.gs", import.meta.url), "utf8");

const live = process.argv.includes("--live");
const UrlFetchApp = {
  fetch: (url) => {
    const body = execFileSync("curl", ["-sS", "--max-time", "25", url], { encoding: "utf8", maxBuffer: 1 << 26 });
    return { getResponseCode: () => 200, getContentText: () => body };
  },
};
const G = new Function(
  "SpreadsheetApp", "PropertiesService", "Logger", "UrlFetchApp",
  `${src}\n;return { lessonQuery_, pictureUrl_, commonsPicture_, SUBJECT_WORDS };`
)({}, {}, { log: () => {} }, UrlFetchApp);

let failures = 0;
const check = (label, ok, got) => {
  if (ok) { console.log(`ok   ${label}`); return; }
  failures += 1;
  console.log(`FAIL ${label}${got === undefined ? "" : ` ${JSON.stringify(got)}`}`);
};

// The teacher's own topics, off the Lessons tab.
const q = (topic, code) => G.lessonQuery_(topic, code);

check("query: a Bible lesson keeps its names",
  q("The Promised Land: Joshua: Go Get 'Em!", "~B030") === "promised land joshua get Bible",
  q("The Promised Land: Joshua: Go Get 'Em!", "~B030"));
check("query: a geography topic gains its subject",
  q("CHAPTER 2 TERMS CLASS: Settlements and the Environment", "~G012")
    === "terms settlements environment geography",
  q("CHAPTER 2 TERMS CLASS: Settlements and the Environment", "~G012"));
check("query: the lesson code comes off the front",
  !/m00|j021/i.test(q("~M001 Improper Fractions and Mixed Numbers", "~M001")),
  q("~M001 Improper Fractions and Mixed Numbers", "~M001"));
check("query: a maths topic is searched as mathematics",
  /mathematics$/.test(q("Improper Fractions and Mixed Numbers", "~M001")),
  q("Improper Fractions and Mixed Numbers", "~M001"));
check("query: page references and numbers drop out",
  !/\d/.test(q("2.3 Multiplication/Division of Proper Fractions (p.75 #1-9)", "~M005")),
  q("2.3 Multiplication/Division of Proper Fractions (p.75 #1-9)", "~M005"));
check("query: the assignment block is not part of the lesson",
  !/notebook|bibles/i.test(q("Abraham [Assign: complete the chapter in your notebooks. You will need your Bibles.]", "~B025")),
  q("Abraham [Assign: complete the chapter in your notebooks. You will need your Bibles.]", "~B025"));
check("query: links do not reach the search",
  !/https|docs/i.test(q("The Ascension\n-What it is? https://youtu.be/U8-6BjpOwiU", "~C076")),
  q("The Ascension\n-What it is? https://youtu.be/U8-6BjpOwiU", "~C076"));

for (const skip of [
  "Test on Genesis Lessons 1-5",
  "Review for Lessons 6-10",
  "Study . . .",
  "QWT\nComplete theme poster",
  "Book Fair",
  "Counselor visit",
]) {
  check(`query: not a lesson with a subject — ${skip.split("\n")[0].slice(0, 28)}`, q(skip, "~B001") === "", q(skip, "~B001"));
}

check("url: Commons' own permanent address, ending in the file's extension",
  G.pictureUrl_("File:Fractions of a circle.jpg")
    === "https://commons.wikimedia.org/wiki/Special:FilePath/Fractions_of_a_circle.jpg?width=1200",
  G.pictureUrl_("File:Fractions of a circle.jpg"));

if (!live) {
  console.log("\n(run with --live to search Commons for real)");
  console.log(failures ? `${failures} failed` : "all checks passed");
  process.exit(failures ? 1 : 0);
}

// ---- the live search, over the teacher's own lessons ----
const lessons = [
  ["~C074", "Evidence for the Flood"],
  ["~C076", "The Ascension"],
  ["~C080", "Persecution of Christians"],
  ["~B040", "The Divided Kingdom: 1-2 Kings; 2 Chron: Kings and kingdoms"],
  ["~B036", "1 Chron: The king God loved"],
  ["~G012", "CHAPTER 2 TERMS CLASS: Settlements and the Environment"],
  ["~G013", "CHAPTER 2 CASE STUDY: Land reclamation in Hong Kong and the Netherlands"],
  ["~H009", "North America 1713 vs 1763: the map"],
  ["~H010", "The Acadians and the deportation"],
  ["~M001", "Improper Fractions and Mixed Numbers"],
  ["~J021", "Powers and Exponential Notation"],
  ["~C078", "Sanctity of Life"],
];
let found = 0;
for (const [code, topic] of lessons) {
  const query = G.lessonQuery_(topic, code);
  if (!query) { console.log(`\n${code}  ${topic}\n     SKIP (not a lesson with a subject)`); continue; }
  const pic = G.commonsPicture_(query);
  console.log(`\n${code}  ${topic}\n     search: "${query}"`);
  if (!pic) { console.log("     nothing good enough — the cell stays empty"); continue; }
  found += 1;
  console.log(`     ${pic.file}  (${pic.licence}, ${pic.width}px)`);
  console.log(`     ${pic.url}`);
}
console.log(`\n${found} of ${lessons.length} lessons would get a picture`);
console.log(failures ? `${failures} failed` : "all checks passed");
process.exit(failures ? 1 : 0);
