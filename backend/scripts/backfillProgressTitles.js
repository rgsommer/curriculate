#!/usr/bin/env node
// backend/scripts/backfillProgressTitles.js
//
// One-time backfill: rewrites PublishedResult.meta.title from the
// actual AI-detected title where recoverable.  Run after the fix that
// stopped BatchGrading.jsx clobbering per-result titles with the
// batch label.
//
// Recovery sources, in priority order:
//   1) meta.detectedTitle — populated by the post-fix code path
//      (commit 11833777 onward).  Authoritative when present.
//   2) First non-empty line of the payload string — for single-graded
//      results this is the detected_title (set by
//      frontend buildFullTeacherPayloadText).  Heuristically scrubbed:
//      ignores anything that starts with 'Grade:', 'Ref:', a bullet,
//      or 'View feedback online'.
//
// Legacy batch-graded results whose payload never embedded the title
// are NOT recoverable from the data we kept; the script reports them
// with --report-only so a human can manually rename or accept the
// batch label.
//
// Usage:
//   node backend/scripts/backfillProgressTitles.js            # dry run
//   node backend/scripts/backfillProgressTitles.js --apply    # write
//   node backend/scripts/backfillProgressTitles.js --apply --limit 500
//
// Env: MONGO_URI (or MONGODB_URI).

import "dotenv/config";
import mongoose from "mongoose";
import PublishedResult from "../models/PublishedResult.js";

const APPLY = process.argv.includes("--apply");
const limitIdx = process.argv.indexOf("--limit");
const LIMIT =
  limitIdx > -1 && process.argv[limitIdx + 1]
    ? parseInt(process.argv[limitIdx + 1], 10) || 0
    : 0;

// Lines we should NEVER treat as a candidate title.  These are
// payload-format markers / section headings that appear inside
// result payloads.  Anything ending in a colon is a heading by
// convention, so we also reject those wholesale.
const NON_TITLE_PREFIXES = [
  /^grade\s*:/i,
  /^ref\s*:/i,
  /^view feedback/i,
  /^links?\s*\/\s*evidence/i,
  /^submitted text/i,
  /^deduction/i,
  /^strengths?:/i,
  /^next steps?:/i,
  /^overall comment/i,
  /^comment\s*:/i,
  /^teacher comment/i,
  /^achievement categor/i,
  /^mark\s*:/i,
  /^score\s*:/i,
  /^total\s*:/i,
  /^note\s*:/i,
  /^[-•*]\s/, // bullet
  /^\d+[.)]\s/, // numbered list
  /^https?:\/\//i,
  /^no links/i,
  /^submitted as/i,
  // Header metadata lines that look like "Student: Naomi",
  // "Name: J. Smith", "Date: 5/10/26", "Class: 8A":
  // not assignment titles, just transcribed paper headers.
  /^student\s*:/i,
  /^name\s*:/i,
  /^date\s*:/i,
  /^class\s*:/i,
  /^period\s*:/i,
  /^teacher\s*:/i,
  /^by\s+\w+/i, // "By Kristen Chan; Pg. 139…" — author line
  /^video\s*:/i, // "Video: 31s, 1 frames analyzed" — video-grading header
  /^audio\s*:/i,
  /^performance\s+type\s*:/i,
  /^rubric\s*:/i,
  /^must have/i, // rubric criterion
  /^<!doctype/i,
  /^<html/i,
  /^transcript\s*:/i,
  /^duration\s*:/i,
  /^frames? analyzed/i,
  /^<[a-z!]/i, // any leading HTML / XML tag
  /^level\s+\d/i, // rubric levels: "Level 4 (Excellent)…"
  /^instrument\s*:/i, // music rubric header
  /^q\d+\s*[.\-)]/i, // "Q1 -", "Q2." — question prompt, not title
  /^question\s+\d/i,
  /^in your opinion/i, // student-prompt openers
];

function looksLikeTitle(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  if (t.length > 160) return false; // titles are short
  if (t.length < 3) return false;
  // Section headings end in a colon — never a real title.
  if (/:\s*$/.test(t)) return false;
  for (const re of NON_TITLE_PREFIXES) {
    if (re.test(t)) return false;
  }
  return true;
}

function extractTitleFromPayload(payload) {
  if (typeof payload !== "string") return "";
  const lines = payload.split(/\r?\n/);

  // Priority 1: paste-mode results put the AI-detected title (or the
  // student's own first line) right after the "Submitted text
  // (evidence):" marker.  This is the highest-confidence source.
  const markerIdx = lines.findIndex((l) =>
    /^submitted text\s*\(evidence\)\s*:/i.test(String(l || "").trim())
  );
  if (markerIdx !== -1) {
    let scanned = 0;
    for (let i = markerIdx + 1; i < lines.length && scanned < 6; i++) {
      const line = String(lines[i] || "").trim();
      if (!line) continue;
      scanned += 1;
      if (looksLikeTitle(line)) return line;
    }
  }

  // Priority 2: single-graded photo-mode payloads put detected_title
  // as the very first line of the file (see buildFullTeacherPayloadText).
  let checked = 0;
  for (const raw of lines) {
    const line = String(raw || "").trim();
    if (!line) continue;
    checked += 1;
    if (checked > 8) break;
    if (looksLikeTitle(line)) return line;
  }
  return "";
}

function pickRecoveredTitle(doc) {
  // 1) Explicit detectedTitle persisted post-fix
  const explicit = String(doc?.meta?.detectedTitle || "").trim();
  if (explicit) return { title: explicit, source: "meta.detectedTitle" };

  // 2) First-line-of-payload heuristic (single-grade flow)
  const fromPayload = extractTitleFromPayload(doc?.payload);
  if (fromPayload) return { title: fromPayload, source: "payload-first-line" };

  return null;
}

function isProbablyBatchLabel(title) {
  if (!title) return false;
  const t = String(title).trim();
  // Heuristics for batch labels: matches a teacher's PDF filename
  // pattern or one of the synthesized "Math — Quiz" composites.  This
  // is just informational — we don't suppress writes based on it.
  if (/\.pdf$/i.test(t)) return true;
  if (/\s—\s/.test(t)) return true;
  return false;
}

async function main() {
  const uri =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URL;
  if (!uri) {
    console.error("❌ MONGO_URI not set in env.  Aborting.");
    process.exit(1);
  }

  console.log(APPLY ? "🔧 APPLY mode" : "👁  DRY RUN (use --apply to write)");
  if (LIMIT) console.log(`Limiting to ${LIMIT} candidate docs.`);
  console.log("Connecting to Mongo…");
  await mongoose.connect(uri);
  console.log("Connected.");

  const filter = {};
  const cursor = PublishedResult.find(filter)
    .select("code meta payload createdAt")
    .lean()
    .cursor();

  let scanned = 0;
  let recoveredCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  let unrecoverableCount = 0;
  const unrecoverableSamples = [];
  const updatePromises = [];

  for await (const doc of cursor) {
    scanned += 1;
    if (LIMIT && scanned > LIMIT) break;

    const currentTitle = String(doc?.meta?.title || "").trim();
    const recovered = pickRecoveredTitle(doc);

    if (!recovered) {
      unrecoverableCount += 1;
      if (unrecoverableSamples.length < 10) {
        unrecoverableSamples.push({
          code: doc.code,
          currentTitle: currentTitle || "(none)",
          createdAt: doc.createdAt,
        });
      }
      continue;
    }

    recoveredCount += 1;

    if (recovered.title === currentTitle) {
      unchangedCount += 1;
      continue;
    }

    // Safety: the payload-first-line heuristic is high-recall but
    // medium-precision (for essay submissions it can grab the first
    // paragraph instead of the actual title).  When the current
    // meta.title already has a non-empty value, refuse to overwrite
    // it UNLESS the recovered title came from the authoritative
    // meta.detectedTitle field.  This means we'll fill empty slots
    // freely but never clobber a teacher-assigned / AI-assigned
    // title with a worse guess.
    if (
      currentTitle &&
      recovered.source !== "meta.detectedTitle"
    ) {
      // Skip — keep the existing title.  Don't even count this as
      // "would rewrite" because we're intentionally NOT touching it.
      continue;
    }

    const wasBatch = isProbablyBatchLabel(currentTitle);
    console.log(
      `  ${doc.code}: "${currentTitle}" → "${recovered.title}"` +
        ` (source: ${recovered.source}${wasBatch ? ", looked like batch label" : ""})`
    );

    if (APPLY) {
      updatePromises.push(
        PublishedResult.updateOne(
          { _id: doc._id },
          {
            $set: {
              "meta.title": recovered.title,
              "meta.detectedTitle": recovered.title,
              "meta.titleBackfilledAt": new Date(),
              "meta.titleBackfillSource": recovered.source,
            },
          }
        )
      );
      // Flush every 200 to avoid one giant unawaited batch
      if (updatePromises.length >= 200) {
        await Promise.all(updatePromises.splice(0));
      }
    }
    updatedCount += 1;
  }

  if (APPLY && updatePromises.length) await Promise.all(updatePromises);

  console.log("\n── Summary ───────────────────────────────");
  console.log(`Scanned:                     ${scanned}`);
  console.log(`Recoverable detected title:  ${recoveredCount}`);
  console.log(`  ↳ already matches:         ${unchangedCount}`);
  console.log(`  ↳ ${APPLY ? "rewrote" : "would rewrite"}:            ${updatedCount}`);
  console.log(`Unrecoverable (no source):   ${unrecoverableCount}`);
  if (unrecoverableSamples.length > 0) {
    console.log("\nSample unrecoverable records (likely legacy batch-graded):");
    for (const s of unrecoverableSamples) {
      console.log(`  ${s.code}: "${s.currentTitle}" (created ${s.createdAt?.toISOString?.() || s.createdAt})`);
    }
    console.log(
      "\nFor these, the detected title was lost when meta.title got\n" +
        "overwritten with the batch label and the payload never\n" +
        "embedded the title.  Re-grade or manually rename via the\n" +
        "/progress teacher view inline-edit if you need them fixed."
    );
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => {
  console.error("❌ Backfill failed:", err);
  process.exit(1);
});
