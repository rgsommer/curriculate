// backend/behavior/scripts/convertBdaysTab.mjs
//
// Converter: the "Bdays" tab of the teacher-toolkit sheet → a clean roster CSV
// with standard headers the app importer understands. Accepts EITHER the full
// workbook .xlsx (reads its "Bdays" worksheet) OR a CSV export of just the
// Bdays tab (lighter — no 65MB download).
//
// Bdays layout: config rows 1-2, HEADER on ROW 3, a junk/#REF row 4, student
// data from ROW 5. Logical (1-based) columns:
//   Last[2], Formal[3], First[4], Common[5], Gender[7], Class[8], DOB[9],
//   Dad name[15], Dad email[16], Mom name[17], Mom email[18].
// Grade is derived from the class (e.g. "8B" -> 8). The sheet has parent
// EMAILS, not parent Edsby IDs.
//
// Usage:
//   node behavior/scripts/convertBdaysTab.mjs [input.csv|input.xlsx] [output.csv]

import fs from "fs";
import Papa from "papaparse";
import ExcelJS from "exceljs";

const INPUT = process.argv[2] || `${process.env.HOME}/Downloads/bdays-sheet.xlsx`;
const OUTPUT = process.argv[3] || `${process.env.HOME}/Downloads/behaviour-roster-clean.csv`;

const pad = (n) => String(n).padStart(2, "0");

// Normalize any cell to a string; DOB handling below deals with Dates/ISO.
function asText(v) {
  if (v == null) return "";
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

// DOB -> YYYY-MM-DD. Date cells use UTC calendar (the sheet stores tz-naive
// dates as UTC midnight, so UTC components recover the intended day); ISO-ish
// strings (CSV export) pass through unchanged.
function dob(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? "" : v.toISOString().slice(0, 10);
  const s = asText(v).trim();
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const stripNickname = (s) => String(s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
function classCode(s) {
  const v = String(s || "").trim();
  return /^\d{1,2}\s*[A-Za-z]?$/.test(v) ? v.replace(/\s+/g, "") : "";
}
const gradeFromClass = (c) => (c.match(/^(\d{1,2})/) || [, ""])[1];

// Build a (1-based row, 1-based col) accessor over either source, plus rowCount.
async function loadCells() {
  const isCsv = /\.csv$/i.test(INPUT) || !/\.xlsx?$/i.test(INPUT);
  if (isCsv) {
    const txt = fs.readFileSync(INPUT, "utf8");
    const { data } = Papa.parse(txt, { header: false });
    return {
      rowCount: data.length,
      raw: (r, c) => (data[r - 1] ? data[r - 1][c - 1] : ""),
    };
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(INPUT);
  const ws = wb.getWorksheet("Bdays") || wb.worksheets.find((w) => w.name.toLowerCase() === "bdays");
  if (!ws) {
    console.error(`No "Bdays" worksheet found in ${INPUT}`);
    process.exit(1);
  }
  return { rowCount: ws.rowCount, raw: (r, c) => ws.getRow(r).getCell(c).value };
}

const { rowCount, raw } = await loadCells();
const S = (r, c) => asText(raw(r, c)).trim();

// Header sanity check (row 3).
if (S(3, 2) !== "Last" || S(3, 8) !== "Class") {
  console.error(`Unexpected Bdays header (row3 col2="${S(3, 2)}", col8="${S(3, 8)}"). Aborting.`);
  process.exit(1);
}

const out = [];
const skipped = [];
for (let r = 5; r <= rowCount; r++) {
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
    DOB: dob(raw(r, 9)),
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
console.log(`Source: ${INPUT}`);
console.log(`Wrote ${out.length} students -> ${OUTPUT}`);
console.log(`  with ≥1 parent email: ${withEmail}`);
console.log(`  skipped (#REF): ${skipped.length}`);
console.log(`  classes: ${JSON.stringify(classes)}`);
