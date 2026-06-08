// backend/behavior/scripts/convertLegacySheet.mjs
//
// One-off (re-runnable) converter: the legacy "Bubble" behaviour spreadsheet →
// a clean roster CSV with standard headers that the app importer understands.
//
// The legacy workbook (export of the Google Sheet) has three tabs:
//   • "Students" — a formula-driven display tab (=sort(filter(Raw!...))) — ignore.
//   • "Raw"      — the actual source roster. Header is on ROW 2; data from row 3.
//   • "Setup"    — division config — ignore here.
//
// Raw columns (1-based): LName[1], FormalFirst[2], Name[3], Common[4],
//   Pasted[5], Gender[6], Group[7], DOB[8], FLName[9], LFName[10], BDay[11],
//   Celebrate[12], Grade[13], Mom[14], MomEmail[16], Dad[17], DadEmail[19].
//
// The sheet has parent EMAILS but no parent Edsby IDs (those come from Edsby).
//
// Usage:
//   node behavior/scripts/convertLegacySheet.mjs [input.xlsx] [output.csv]

import fs from "fs";
import Papa from "papaparse";
import ExcelJS from "exceljs";

const INPUT = process.argv[2] || `${process.env.HOME}/Downloads/behaviour-roster.xlsx`;
const OUTPUT = process.argv[3] || `${process.env.HOME}/Downloads/behaviour-roster-clean.csv`;

function cellText(v) {
  if (v == null) return "";
  if (v instanceof Date) return v; // keep Date for DOB handling
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("");
    if (v.text != null) return String(v.text);
    if (v.result != null) return String(v.result);
    return "";
  }
  return String(v);
}

function str(v) {
  const c = cellText(v);
  return (c instanceof Date ? "" : String(c)).trim();
}

// Format a DOB cell to YYYY-MM-DD. Date cells are rendered with LOCAL calendar
// components (matching what a human sees in the sheet); ISO-ish strings pass
// through; everything else is best-effort.
function fmtLocal(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dob(v) {
  const c = cellText(v);
  if (c instanceof Date) return isNaN(c.getTime()) ? "" : fmtLocal(c);
  const s = String(c).trim();
  if (!s) return "";
  // Already an ISO date → keep as-is (avoid timezone drift through Date()).
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // Otherwise it's a JS Date toString (as stored in this sheet) → parse + format.
  const d = new Date(s);
  return isNaN(d.getTime()) ? s : fmtLocal(d);
}

// "Oluwatobiloba(Tobi)" -> "Oluwatobiloba" (drop the parenthetical nickname).
function stripNickname(s) {
  return String(s || "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(INPUT);
const ws = wb.getWorksheet("Raw");
if (!ws) {
  console.error(`No "Raw" worksheet found in ${INPUT}`);
  process.exit(1);
}

const out = [];
const skipped = [];
for (let r = 3; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const lname = str(row.getCell(1).value);
  const formalFirst = str(row.getCell(2).value);

  if (!lname && !formalFirst) continue; // blank
  if (lname.includes("#REF!") || formalFirst.includes("#REF!")) {
    skipped.push({ row: r, reason: "#REF! formula row" });
    continue;
  }

  const firstName = stripNickname(formalFirst) || formalFirst;
  const preferred = str(row.getCell(4).value); // Common
  const gender = str(row.getCell(6).value);
  const group = str(row.getCell(7).value); // class
  const birth = dob(row.getCell(8).value);
  const grade = str(row.getCell(13).value);
  const momName = str(row.getCell(14).value);
  const momEmail = str(row.getCell(16).value).toLowerCase();
  const dadName = str(row.getCell(17).value);
  const dadEmail = str(row.getCell(19).value).toLowerCase();

  out.push({
    "Last name": lname,
    "First name": firstName,
    "Common/preferred name": preferred,
    Gender: gender,
    "Class/Group": group,
    Grade: grade,
    DOB: birth,
    "Parent 1 name": momName,
    "Parent 1 email": momEmail,
    "Parent 2 name": dadName,
    "Parent 2 email": dadEmail,
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
console.log(`  skipped: ${skipped.length}`);
console.log(`  classes: ${JSON.stringify(classes)}`);
