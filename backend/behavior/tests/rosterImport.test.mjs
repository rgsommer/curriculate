// node --test backend/behavior/tests/rosterImport.test.mjs
//
// Tests the tolerant roster importer (brief §3, §10): messy CSV/XLSX input is
// handled, skipped rows are reported, the ethnicity field/tags are never
// stored, and parent Edsby IDs + emails are read from the sheet.

import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseRoster, parseRosterFile } from "../lib/rosterImport.js";

const csv = [
  "Last name,First name,Common/preferred name,Gender,Class/Group,Grade,DOB,Parent 1 name,Parent 1 email,Parent 1 Edsby ID,Parent 2 name,Parent 2 email,Ethnicity",
  "Smith,Jonathan,Jon,M,7A,7,2013-04-01,Jane Smith,jane@bcs.org,EP-1001,John Smith,john@bcs.org,[White]",
  "Patel,Aisha,,F,7A,7,2013-09-12,Raj Patel,raj@bcs.org,EP-2002,,,[Indian]",
  "DELETE,DELETE,DELETE,,,,,,,,,,",                       // placeholder row -> skip
  ",,,M,7A,7,,,,,,,",                                      // has data but no name -> skip
  "O'Brien [Black],Sam,,X,8B,8,,,,,,,[Black]",            // bracketed tag in name
].join("\n");

test("parses valid rows, skips DELETE + blank, reports skips", () => {
  const { students, skipped } = parseRoster(csv);
  assert.equal(students.length, 3);
  assert.equal(skipped.length, 2);
  assert.ok(skipped.some((s) => /DELETE/.test(s.reason)));
  assert.ok(skipped.some((s) => /no name/.test(s.reason)));
});

test("reads parent Edsby IDs + emails from the sheet", () => {
  const { students } = parseRoster(csv);
  const smith = students.find((s) => s.lastName === "Smith");
  assert.equal(smith.parents[0].email, "jane@bcs.org");
  assert.equal(smith.parents[0].edsbyParentId, "EP-1001");
});

test("drops the ethnicity column entirely", () => {
  const { students } = parseRoster(csv);
  for (const s of students) {
    assert.equal("ethnicity" in s, false);
    assert.equal(JSON.stringify(s).toLowerCase().includes("white"), false);
    assert.equal(JSON.stringify(s).toLowerCase().includes("indian"), false);
  }
});

test("strips bracketed ethnicity tags embedded in name cells", () => {
  const { students } = parseRoster(csv);
  const obrien = students.find((s) => s.lastName.startsWith("O'Brien"));
  assert.ok(obrien);
  assert.equal(obrien.lastName, "O'Brien"); // "[Black]" stripped
});

test("builds parent contacts, handling a missing parent 2", () => {
  const { students } = parseRoster(csv);
  const smith = students.find((s) => s.lastName === "Smith");
  const patel = students.find((s) => s.lastName === "Patel");
  assert.equal(smith.parents.length, 2);
  assert.equal(patel.parents.length, 1);
});

test("reads a House column into houseName when present", () => {
  const withHouse = [
    "Last name,First name,Class/Group,Grade,House",
    "Lee,Mara,7A,7,Phoenix",
    "Kim,Noah,7A,7,",
  ].join("\n");
  const { students } = parseRoster(withHouse);
  const lee = students.find((s) => s.lastName === "Lee");
  const kim = students.find((s) => s.lastName === "Kim");
  assert.equal(lee.houseName, "Phoenix");
  assert.equal(kim.houseName, ""); // blank house → empty, never assigned
});

// ── XLSX ─────────────────────────────────────────────────────────────────────

async function makeXlsx(rows2d) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Roster");
  rows2d.forEach((r) => ws.addRow(r));
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

test("parses XLSX uploads, including parent Edsby IDs, and reports skips", async () => {
  const buf = await makeXlsx([
    ["Last name", "First name", "Class/Group", "Grade", "Parent 1 email", "Parent 1 Edsby ID"],
    ["Singh", "Anaya", "8B", "8", "mom@bcs.org", "EP-9001"],
    ["DELETE", "DELETE", "", "", "", ""],
  ]);
  const { students, skipped } = await parseRosterFile(buf, "roster.xlsx");
  assert.equal(students.length, 1);
  assert.equal(students[0].lastName, "Singh");
  assert.equal(students[0].classGroup, "8B");
  assert.equal(students[0].parents[0].edsbyParentId, "EP-9001");
  assert.ok(skipped.some((s) => /DELETE/.test(s.reason)));
});

test("detects XLSX by magic bytes even without a filename", async () => {
  const buf = await makeXlsx([
    ["First name", "Last name"],
    ["Mya", "Bassoo"],
  ]);
  const { students } = await parseRosterFile(buf, "");
  assert.equal(students.length, 1);
  assert.equal(students[0].firstName, "Mya");
});

test("parseRosterFile still handles CSV buffers", async () => {
  const { students } = await parseRosterFile(Buffer.from(csv, "utf8"), "roster.csv");
  assert.equal(students.length, 3);
});
