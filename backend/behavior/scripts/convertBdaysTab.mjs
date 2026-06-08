// backend/behavior/scripts/convertBdaysTab.mjs
//
// Converter: the "Bdays" tab of the teacher-toolkit Google Sheet → a clean
// roster CSV with standard headers the app importer understands.
//
// Bdays layout: a config row 1-2, the HEADER on ROW 3, a junk/#REF row 4, and
// student data from ROW 5. Roster columns (1-based):
//   Last[2], Formal[3], First[4], Common[5], Gender[7], Class[8], DOB[9],
//   Dad name[15], Dad email[16], Mom name[17], Mom email[18].
// Grade is derived from the class (e.g. "8B" -> 8). DOB cells are JS Date
// toString strings. The sheet has parent EMAILS, not parent Edsby IDs.
//
// Usage:
//   node behavior/scripts/convertBdaysTab.mjs [input.xlsx] [output.csv]

import fs from "fs";
import Papa from "papaparse";
import ExcelJS from "exceljs";

const INPUT = process.argv[2] || `${process.env.HOME}/Downloads/bdays-sheet.xlsx`;
const OUTPUT = process.argv[3] || `${process.env.HOME}/Downloads/behaviour-roster-clean.csv`;

function raw(v) {
  if (v == null) return "";
  if (v instanceof Date) return v;
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}
const str = (v) => {
  const c = raw(v);
  return (c instanceof Date ? "" : String(c)).trim();
};

function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function dob(v) {
  const c = raw(v);
  if (c instanceof Date) return isNaN(c.getTime()) ? "" : fmtLocal(c);
  const s = String(c).trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : fmtLocal(d);
}
const stripNickname = (s) => String(s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();

// Keep a value only if it looks like a class code (e.g. "7A", "8C", "6"); the
// sheet leaves stray rows with an "Invalid Date" in the class cell.
function classCode(s) {
  const v = String(s || "").trim();
  return /^\d{1,2}\s*[A-Za-z]?$/.test(v) ? v.replace(/\s+/g, "") : "";
}
const gradeFromClass = (c) => (c.match(/^(\d{1,2})/) || [, ""])[1];

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(INPUT);
const ws = wb.getWorksheet("Bdays") || wb.worksheets.find((w) => w.name.toLowerCase() === "bdays");
if (!ws) {
  console.error(`No "Bdays" worksheet found in ${INPUT}`);
  process.exit(1);
}
const S = (r, c) => str(ws.getRow(r).getCell(c).value);

// Sanity-check the header row is where we expect it.
if (S(3, 2) !== "Last" || S(3, 8) !== "Class") {
  console.error(`Unexpected Bdays header (row3 col2="${S(3, 2)}", col8="${S(3, 8)}"). Aborting.`);
  process.exit(1);
}

const out = [];
const skipped = [];
for (let r = 5; r <= ws.rowCount; r++) {
  const last = S(r, 2);
  const formal = S(r, 3);
  if (!last && !formal) continue;
  if (last.includes("#REF!") || formal.includes("#REF!")) {
    skipped.push({ row: r, reason: "#REF! row" });
    continue;
  }
  const firstName = stripNickname(formal) || S(r, 4);
  const preferred = S(r, 5) || stripNickname(formal);
  const gender = /^[MF]/i.test(S(r, 7)) ? S(r, 7).slice(0, 1).toUpperCase() : "";
  const cls = classCode(S(r, 8));

  out.push({
    "Last name": last,
    "First name": firstName,
    "Common/preferred name": preferred,
    Gender: gender,
    "Class/Group": cls,
    Grade: cls ? gradeFromClass(cls) : "",
    DOB: dob(ws.getRow(r).getCell(9).value),
    "Parent 1 name": S(r, 17), // Mom
    "Parent 1 email": S(r, 18).toLowerCase(),
    "Parent 2 name": S(r, 15), // Dad
    "Parent 2 email": S(r, 16).toLowerCase(),
  });
}

const csv = Papa.unparse(out, {
  columns: [
    "Last name", "First name", "Common/preferred name", "Gender", "Class/Group",
    "Grade", "DOB", "Parent 1 name", "Parent 1 email", "Parent 2 name", "Parent 2 email",
  ],
});
fs.writeFileSync(OUTPUT, csv, "utf8");

const classes = {};
let withEmail = 0;
for (const s of out) {
  if (s["Class/Group"]) classes[s["Class/Group"]] = (classes[s["Class/Group"]] || 0) + 1;
  if (s["Parent 1 email"].includes("@") || s["Parent 2 email"].includes("@")) withEmail++;
}
console.log(`Wrote ${out.length} students -> ${OUTPUT}`);
console.log(`  with ≥1 parent email: ${withEmail}`);
console.log(`  skipped (#REF): ${skipped.length}`);
console.log(`  classes: ${JSON.stringify(classes)}`);
