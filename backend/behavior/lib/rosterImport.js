// backend/behavior/lib/rosterImport.js
//
// Tolerant roster parsing (brief §3, §10). Accepts BOTH CSV and XLSX uploads.
// The real data is messy: duplicate first names, blank names, and "DELETE"
// placeholder rows. The importer handles that gracefully and REPORTS the rows
// it skipped rather than failing.
//
// PRIVACY (§10): the ethnicity field is dropped and NEVER stored. The source
// data also embeds ethnicity tags like "[White]" inside name cells — we strip
// any bracketed tag from names so it can't sneak in.
//
// Parent Edsby IDs + emails are read straight from the sheet when present
// (columns like "Parent 1 Edsby ID" / "Guardian 1 Email"); they feed the
// EdsbyProvider and EmailProvider respectively.

import Papa from "papaparse";

// Header aliases → canonical field. Matched case-insensitively after trimming.
const HEADER_ALIASES = {
  externalId: ["student id", "studentid", "id", "external id", "sis id", "edsby id", "edsby student id"],
  lastName: ["last name", "lastname", "surname", "last", "family name"],
  firstName: ["first name", "firstname", "first", "given name", "given"],
  preferredName: ["common name", "preferred name", "common/preferred name", "preferred", "nickname", "common"],
  gender: ["gender", "sex"],
  classGroup: ["class", "group", "class/group", "class group", "homeroom", "section"],
  grade: ["grade", "grade level", "year"],
  dob: ["dob", "date of birth", "birthdate", "birth date"],
  parent1Name: ["parent 1 name", "parent1 name", "guardian 1 name", "parent 1", "parent name", "guardian name"],
  parent1Email: ["parent 1 email", "parent1 email", "guardian 1 email", "parent email", "guardian email", "email"],
  parent1EdsbyId: [
    "parent 1 edsby id", "parent1 edsby id", "guardian 1 edsby id", "parent 1 edsby",
    "edsby parent id", "edsby parent id 1", "parent edsby id", "guardian edsby id",
  ],
  parent2Name: ["parent 2 name", "parent2 name", "guardian 2 name", "parent 2"],
  parent2Email: ["parent 2 email", "parent2 email", "guardian 2 email"],
  parent2EdsbyId: [
    "parent 2 edsby id", "parent2 edsby id", "guardian 2 edsby id", "parent 2 edsby", "edsby parent id 2",
  ],
  // Deliberately NOT mapped: ethnicity / race — dropped on purpose.
};

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Build { canonicalField -> actualHeaderName } from the sheet's header row. */
function resolveHeaderMap(headers) {
  const map = {};
  for (const raw of headers) {
    const norm = normalizeHeader(raw);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[field]) continue;
      if (aliases.includes(norm)) {
        map[field] = raw;
        break;
      }
    }
  }
  return map;
}

/** Strip bracketed ethnicity tags e.g. "Smith [White]" -> "Smith". */
function stripTags(s) {
  return String(s || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();
}

function parseDob(s) {
  const v = String(s || "").trim();
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Map an array of record objects (each carrying `__rowNo`) + the header list
 * into student records + a list of skipped rows. Shared by the CSV and XLSX
 * front doors.
 */
function buildStudents(records, headers) {
  const headerMap = resolveHeaderMap(headers);
  const get = (row, field) => (headerMap[field] ? String(row[headerMap[field]] ?? "").trim() : "");

  const students = [];
  const skipped = [];

  for (const row of records) {
    const rowNo = row.__rowNo;

    const lastName = stripTags(get(row, "lastName"));
    const firstName = stripTags(get(row, "firstName"));
    const preferredName = stripTags(get(row, "preferredName"));

    // "DELETE" placeholder rows (any name cell literally "DELETE").
    const cells = [lastName, firstName, preferredName].map((c) => c.toUpperCase());
    if (cells.includes("DELETE")) {
      skipped.push({ row: rowNo, reason: "DELETE placeholder row" });
      continue;
    }

    // Fully blank name → can't key a student; skip and report.
    if (!lastName && !firstName && !preferredName) {
      skipped.push({ row: rowNo, reason: "no name fields" });
      continue;
    }

    const parents = [];
    const p1n = stripTags(get(row, "parent1Name"));
    const p1e = get(row, "parent1Email").toLowerCase();
    const p1id = get(row, "parent1EdsbyId");
    const p2n = stripTags(get(row, "parent2Name"));
    const p2e = get(row, "parent2Email").toLowerCase();
    const p2id = get(row, "parent2EdsbyId");
    if (p1n || p1e || p1id) parents.push({ name: p1n, email: p1e, edsbyParentId: p1id });
    if (p2n || p2e || p2id) parents.push({ name: p2n, email: p2e, edsbyParentId: p2id });

    students.push({
      externalId: get(row, "externalId"),
      lastName,
      firstName,
      preferredName,
      gender: stripTags(get(row, "gender")),
      classGroup: stripTags(get(row, "classGroup")),
      grade: stripTags(get(row, "grade")),
      dob: parseDob(get(row, "dob")),
      parents,
    });
  }

  return { students, skipped, headerMap };
}

/**
 * Parse roster CSV text.
 * @returns {{ students, skipped, headerMap }}
 */
export function parseRoster(csvText) {
  const parsed = Papa.parse(String(csvText || ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h, // keep originals; we resolve aliases ourselves
  });
  const headers = parsed.meta?.fields || [];
  const records = (parsed.data || []).map((row, i) => ({ ...row, __rowNo: i + 2 })); // +header +1-based
  return buildStudents(records, headers);
}

/** Read an XLSX buffer into { records (with __rowNo), headers } via exceljs. */
async function xlsxToRecords(buffer) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { records: [], headers: [] };

  const cellText = (value) => {
    if (value == null) return "";
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "object") {
      if (Array.isArray(value.richText)) return value.richText.map((t) => t.text).join("");
      if (value.text != null) return String(value.text); // hyperlink cell
      if (value.result != null) return String(value.result); // formula cell
      return "";
    }
    return String(value);
  };

  const headerRow = ws.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value).trim();
  });

  const records = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj = { __rowNo: r };
    let any = false;
    headers.forEach((h, i) => {
      if (!h) return;
      const v = cellText(row.getCell(i + 1).value).trim();
      obj[h] = v;
      if (v) any = true;
    });
    if (any) records.push(obj);
  }
  return { records, headers };
}

/**
 * Parse a roster upload that may be CSV or XLSX. Detects by filename extension,
 * falling back to the XLSX magic bytes (a zip header "PK").
 *
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {Promise<{ students, skipped, headerMap }>}
 */
export async function parseRosterFile(buffer, filename = "") {
  const isXlsxName = /\.xlsx?$/i.test(filename);
  const isZipMagic = buffer && buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  if (isXlsxName || isZipMagic) {
    const { records, headers } = await xlsxToRecords(buffer);
    return buildStudents(records, headers);
  }
  return parseRoster(buffer.toString("utf8"));
}
