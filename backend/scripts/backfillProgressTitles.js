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
// payload-format markers that appear at the top of various result
// types.
const NON_TITLE_PREFIXES = [
  /^grade\s*:/i,
  /^ref\s*:/i,
  /^view feedback/i,
  /^links?\s*\/\s*evidence/i,
  /^submitted text/i,
  /^deduction/i,
  /^strengths?:/i,
  /^next steps?:/i,
  /^achievement categor/i,
  /^[-•*\d]\s/, // bullet / numbered list
  /^https?:\/\//i,
];

function looksLikeTitle(line) {
  const t = String(line || "").trim();
  if (!t) return false;
  if (t.length > 160) return false; // titles are short
  if (t.length < 3) return false;
  for (const re of NON_TITLE_PREFIXES) {
    if (re.test(t)) return false;
  }
  return true;
}

function extractTitleFromPayload(payload) {
  if (typeof payload !== "string") return "";
  // Walk first ~10 non-empty lines; first one that passes the heuristic
  // is our candidate.
  const lines = payload.split(/\r?\n/);
  let checked = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    checked += 1;
    if (checked > 10) break;
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
