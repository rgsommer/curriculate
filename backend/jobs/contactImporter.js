// backend/jobs/contactImporter.js
//
// (A) Auto-import: scan the workspace folder for xlsx files matching our
// research-output naming, parse the "All Contacts" sheet, and upsert each
// row into BlastContact. Runs once at server boot and on-demand via
// POST /admin/blast/import-folder.
//
// Files we look for (any of):
//   *-school-admins.xlsx        e.g. hamilton-halton-school-admins.xlsx
//   *-schools.xlsx              e.g. ontario-christian-schools.xlsx
//
// Path resolution order:
//   1. BLAST_IMPORT_DIR env var, if set
//   2. Repo root (../ from this file → backend/.. = project root)

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import BlastContact from "../models/BlastContact.js";
import { inferTimezoneForBoard } from "./blastSender.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function importDir() {
  if (process.env.BLAST_IMPORT_DIR) return process.env.BLAST_IMPORT_DIR;
  return path.resolve(__dirname, "..", ".."); // repo root
}

// Same Christian-detection patterns as adminBlast.js — kept local so this
// module has no cross-route dependencies.
const CHRISTIAN_PATTERNS = [
  /\bchristian\b/i, /\bOACS\b/, /\bACSI\b/, /\bmennonite\b/i,
  /\breformed\b/i, /\bevangelical\b/i, /\bbaptist\b/i, /\bpentecostal\b/i,
];
function detectChristian(row) {
  const explicit = String(row.IsChristian ?? row.isChristian ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(explicit)) return true;
  return CHRISTIAN_PATTERNS.some((p) => p.test(`${row.Board || ""} ${row.School || ""}`));
}

function detectLanguage(board) {
  const b = String(board || "").toLowerCase();
  return (b === "viamonde" || b === "monavenir") ? "fr" : "en";
}

/** Parse one xlsx file and return its rows as plain JS objects. */
async function readContactsSheet(filePath) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const sheet = wb.getWorksheet("All Contacts") || wb.worksheets[0];
  if (!sheet) return [];

  const headers = [];
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) {
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        headers[col - 1] = String(cell.value ?? "").trim();
      });
      return;
    }
    const obj = {};
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      const key = headers[col - 1];
      if (!key) return;
      let val = cell.value;
      if (val && typeof val === "object" && "text" in val) val = val.text;       // rich text
      if (val && typeof val === "object" && "result" in val) val = val.result;   // formula
      obj[key] = val == null ? "" : String(val).trim();
    });
    if (obj.Email) rows.push(obj);
  });
  return rows;
}

/** Build a single bulk-upsert operation for a row. Returns null if the row
 *  lacks a valid email (caller should skip). */
function buildBulkOp(r) {
  const email = String(r.Email || "").toLowerCase().trim();
  if (!email || !email.includes("@")) return null;
  const board = r.Board || "";
  return {
    updateOne: {
      filter: { email },
      update: {
        $setOnInsert: {
          email,
          firstName: r.FirstName || "",
          lastName:  r.LastName  || "",
          source:    "xlsx-auto-import",
          pendingReview: false,
        },
        $set: {
          school:      r.School || undefined,
          board:       board    || undefined,
          role:        r.Role   || undefined,
          level:       r.Level  || undefined,
          language:    detectLanguage(board),
          isChristian: detectChristian(r),
          timezone:    inferTimezoneForBoard(board) || undefined,
        },
      },
      upsert: true,
    },
  };
}

/** Main entry — scan + import. Safe to run repeatedly. */
export async function importContactsFromFolder({ folder = importDir(), patterns = [/-school-admins\.xlsx$/i, /-schools\.xlsx$/i] } = {}) {
  let files;
  try {
    files = await fs.readdir(folder);
  } catch (e) {
    console.warn(`[contactImporter] skip — folder not found: ${folder}`);
    return { ok: false, error: e.message, folder };
  }

  const matching = files.filter(f => patterns.some(p => p.test(f)));
  if (!matching.length) {
    console.log(`[contactImporter] no matching xlsx files in ${folder}`);
    return { ok: true, folder, files: [], inserted: 0, updated: 0 };
  }

  let totalInserted = 0, totalUpdated = 0, totalSkipped = 0;
  const perFile = [];

  for (const filename of matching) {
    const full = path.join(folder, filename);
    const t0 = Date.now();
    try {
      const rows = await readContactsSheet(full);

      // Build all bulk-upsert ops up-front; skip rows missing email
      const ops = [];
      let skipped = 0;
      for (const r of rows) {
        const op = buildBulkOp(r);
        if (op) ops.push(op);
        else skipped++;
      }

      // Single round-trip to MongoDB instead of one per row. With 1,200+ rows
      // this drops import time from ~60s to a few seconds.
      let inserted = 0, updated = 0;
      if (ops.length) {
        const res = await BlastContact.bulkWrite(ops, { ordered: false });
        inserted = res.upsertedCount || 0;
        updated  = (res.modifiedCount || 0); // matchedCount-upsertedCount also possible; modifiedCount is what we care about
      }

      const ms = Date.now() - t0;
      perFile.push({ file: filename, rows: rows.length, inserted, updated, skipped, ms });
      totalInserted += inserted; totalUpdated += updated; totalSkipped += skipped;
      console.log(`[contactImporter] ${filename}: ${rows.length} rows → +${inserted} new, ~${updated} updated, ${skipped} skipped (${ms}ms)`);
    } catch (e) {
      console.error(`[contactImporter] FAIL ${filename}: ${e.message}`);
      perFile.push({ file: filename, error: e.message });
    }
  }

  return { ok: true, folder, files: perFile, inserted: totalInserted, updated: totalUpdated, skipped: totalSkipped };
}

let started = false;
/** Call once at boot (idempotent). Runs the scan in the background so it
 *  doesn't slow startup. */
export function startContactImporter({ delayMs = 8_000 } = {}) {
  if (started) return;
  started = true;
  setTimeout(() => {
    importContactsFromFolder().catch(e => console.error("[contactImporter] boot error:", e));
  }, delayMs);
  console.log(`[contactImporter] will scan ${importDir()} in ${delayMs}ms`);
}
