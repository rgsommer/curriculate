// backend/behavior/scripts/parseHistoryFromSheet.mjs
//
// Parse each student's existing behaviour record out of the legacy behaviour
// spreadsheet (the "Students" tab of sheet 1vVT62…) into a clean JSON:
//   { name, lastFirst, class, incidents:[{date,offense,comment}], notices:[{date,text}] }
//
// Current incidents come from the "Details" column — entries like:
//   "⚡ Monday, Dec 8, 2025 (11:55 am):  Use of class time: <desc>"
// Past notices home come from the "History" column — blocks each headed by a
// JS Date string, followed by recipient emails and the rendered note.
//
// This script only PARSES + reports/writes JSON. It never touches the database.
//
// Usage: node behavior/scripts/parseHistoryFromSheet.mjs [input.xlsx] [out.json]

import fs from "fs";
import ExcelJS from "exceljs";

const INPUT = process.argv[2] || `${process.env.HOME}/Downloads/behaviour-data.xlsx`;
const OUT = process.argv[3] || `${process.env.HOME}/Downloads/behaviour-history.json`;

function cell(v) {
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

const pad = (n) => String(n).padStart(2, "0");
function isoDate(d) {
  return isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function stripHtml(s) {
  return String(s || "")
    .replace(/<\/?p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Combine a date string ("Dec 8, 2025") + 12h time ("11:55 am") into a Date.
function combineDateTime(dateStr, timeStr) {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const m = String(timeStr || "").match(/(\d{1,2}):(\d{2})\s*([ap]m)?/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3] || "")) h += 12;
    d.setHours(h, Number(m[2]), 0, 0);
  }
  return d;
}

// Parse the Details cell into individual incidents.
// Each entry: "⚡ <Weekday>, <Mon DD, YYYY> (<time>):  <Behaviour>: <comment>"
function parseIncidents(detailsRaw) {
  const text = String(detailsRaw || "").replace(/<\/?p>/gi, "\n");
  const out = [];
  // Split on the ⚡ marker; each chunk is one incident.
  for (const chunk of text.split("⚡").map((s) => s.trim()).filter(Boolean)) {
    // <Weekday>, <Mon DD, YYYY> (<time>):  <Behaviour>: <rest>
    const m = chunk.match(/^[A-Za-z]+,\s*([A-Za-z]+ \d{1,2},\s*\d{4})\s*\(([^)]*)\):\s*([^:]+):\s*([\s\S]*)$/);
    if (!m) continue;
    const offense = stripHtml(m[3]).trim();
    const comment = stripHtml(m[4]).trim();
    const at = combineDateTime(m[1], m[2]); // full Date with clock time
    out.push({
      date: at ? isoDate(at) : m[1],
      time: m[2].trim(),
      at: at ? at.toISOString() : "",
      offense,
      comment,
    });
  }
  return out;
}

// Parse the History cell into past notices. Blocks are headed by a JS Date
// toString line ("Fri Feb 20 2026 14:49:35 GMT-0500 (…)").
function parseNotices(historyRaw) {
  const text = String(historyRaw || "");
  if (!text.trim()) return [];
  const headerRe = /([A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d{4} \d{1,2}:\d{2}:\d{2} GMT[^\n]*)/g;
  const heads = [];
  let m;
  while ((m = headerRe.exec(text))) heads.push({ idx: m.index, raw: m[1] });
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const start = heads[i].idx;
    const end = i + 1 < heads.length ? heads[i + 1].idx : text.length;
    const block = text.slice(start, end);
    const d = new Date(heads[i].raw);
    const body = stripHtml(block.slice(heads[i].raw.length));
    out.push({ date: isoDate(d) || heads[i].raw, text: body });
  }
  return out;
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(INPUT);
const ws = wb.getWorksheet("Students");
if (!ws) {
  console.error('No "Students" tab found');
  process.exit(1);
}
const S = (r, c) => String(cell(ws.getRow(r).getCell(c).value)).trim();

const students = [];
let totalIncidents = 0;
let totalNotices = 0;
for (let r = 4; r <= ws.rowCount; r++) {
  const name = S(r, 9); // "First Last"
  const lastFirst = S(r, 10); // "Last, First"
  if (!name || name.includes("#REF!")) continue;
  const cls = S(r, 7);
  const incidents = parseIncidents(S(r, 33));
  const notices = parseNotices(S(r, 40));
  if (!incidents.length && !notices.length) continue;
  totalIncidents += incidents.length;
  totalNotices += notices.length;
  students.push({
    name,
    lastFirst,
    class: cls,
    grandTotal: S(r, 36),
    firstDate: S(r, 44),
    incidents,
    notices,
  });
}

fs.writeFileSync(OUT, JSON.stringify(students, null, 2), "utf8");
console.log(`Parsed ${students.length} students with a record -> ${OUT}`);
console.log(`  total current incidents: ${totalIncidents}`);
console.log(`  total past notices:      ${totalNotices}`);

// Show a couple of samples for eyeballing.
const samples = students.filter((s) => s.incidents.length || s.notices.length).slice(0, 3);
for (const s of samples) {
  console.log(`\n── ${s.name} (${s.class}) — grandTotal=${s.grandTotal}, ${s.incidents.length} incident(s), ${s.notices.length} notice(s)`);
  s.incidents.slice(0, 4).forEach((i) => console.log(`   • ${i.date} ${i.time} — ${i.offense}${i.comment ? `: ${i.comment.slice(0, 60)}` : ""}`));
  if (s.notices.length) console.log(`   notice[0]: ${s.notices[0].date} — ${s.notices[0].text.slice(0, 90).replace(/\n/g, " ")}…`);
}
