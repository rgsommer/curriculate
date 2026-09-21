#!/usr/bin/env node
// backend/scripts/cleanup-orphaned-audio.mjs
//
// One-off cleanup for the audio-grading S3 objects that nothing can reach.
//
// BACKGROUND
// The audio grading path used to mint a 30-day presigned URL. AWS SigV4 caps
// presigned URLs at 7 days, so getSignedUrl threw on every audio grade. The
// upload itself had already succeeded, so each grade left an object in the
// bucket under `audio-grading/` with no surviving link and no GradingCapture
// row pointing at it. Audio now writes to `grading/{submissionId}/audio.{ext}`
// and is served through the /grading/capture proxy, so nothing writes to the
// old prefix any more and everything under it is dead weight.
//
// SAFETY
// This deletes from a live bucket, so:
//   * It is DRY-RUN unless you pass --delete. The default run only reports.
//   * The prefix is hard-coded and validated. It cannot be pointed at the
//     live `grading/` prefix, at the bucket root, or at an empty string.
//   * It does not trust the prefix assumption. Every key is checked against
//     GradingCapture.keys in Mongo; anything actually referenced is SKIPPED
//     and reported loudly, even though nothing should be.
//   * --older-than-days lets you leave anything recent alone.
//   * --delete additionally requires --yes, so a half-typed command can't fire.
//
// USAGE
//   node backend/scripts/cleanup-orphaned-audio.mjs                         # report only
//   node backend/scripts/cleanup-orphaned-audio.mjs --older-than-days=7     # report, ignoring the last week
//   node backend/scripts/cleanup-orphaned-audio.mjs --delete --yes          # actually delete
//   node backend/scripts/cleanup-orphaned-audio.mjs --delete --yes --older-than-days=30
//
// ENV: MONGO_URI, S3_BUCKET, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
//
// Exit codes: 0 done, 1 refused/bad config, 2 crashed mid-run.

import "dotenv/config";
import mongoose from "mongoose";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

// ── The one prefix this script is allowed to touch ──────────────────────────
const PREFIX = "audio-grading/";
// Prefixes that must never be purged, checked against PREFIX below as a
// tripwire in case someone edits the constant above carelessly.
const PROTECTED = ["", "/", "grading/", "grading", "audio-grading"];

const S3_DELETE_BATCH = 1000; // hard API limit for DeleteObjects

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const num = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const v = parseInt(hit.split("=")[1], 10);
  return Number.isFinite(v) ? v : dflt;
};

const DO_DELETE = has("--delete");
const CONFIRMED = has("--yes");
const OLDER_THAN_DAYS = num("older-than-days", 0);

function bytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

async function main() {
  // ── guards ────────────────────────────────────────────────────────────────
  if (!PREFIX || PROTECTED.includes(PREFIX) || !PREFIX.endsWith("/")) {
    fail(`Refusing to run: PREFIX ${JSON.stringify(PREFIX)} is empty, protected, or not a folder prefix.`);
  }
  if (PREFIX.startsWith("grading/")) {
    fail("Refusing to run: that is the LIVE capture prefix, not the orphaned one.");
  }

  const bucket = process.env.S3_BUCKET;
  if (!bucket) fail("S3_BUCKET is not set.");
  const region = process.env.AWS_REGION || "us-east-2";
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) fail("MONGO_URI is not set — the script verifies orphanhood against GradingCapture.");

  if (DO_DELETE && !CONFIRMED) {
    fail("--delete also requires --yes. Run without --delete first and read the report.");
  }

  const cutoff = OLDER_THAN_DAYS > 0 ? new Date(Date.now() - OLDER_THAN_DAYS * 86400000) : null;

  console.log(`\nBucket   : ${bucket} (${region})`);
  console.log(`Prefix   : ${PREFIX}`);
  console.log(`Mode     : ${DO_DELETE ? "DELETE" : "DRY RUN (nothing will be removed)"}`);
  if (cutoff) console.log(`Age      : only objects last modified before ${cutoff.toISOString()}`);
  console.log("");

  // ── 1. connect to Mongo FIRST ─────────────────────────────────────────────
  // Orphanhood is verified against GradingCapture, so a bad URI means the run
  // is useless. Find that out now rather than after listing tens of thousands
  // of objects.
  await mongoose.connect(mongoUri);
  const GradingCapture =
    mongoose.models.GradingCapture ||
    mongoose.model(
      "GradingCapture",
      new mongoose.Schema({ submissionId: String, keys: [String], createdAt: Date }, { strict: false })
    );
  console.log("Mongo    : connected\n");

  // ── 2. list everything under the prefix ───────────────────────────────────
  const s3 = new S3Client({ region });
  const objects = [];
  let token;
  let pages = 0;

  do {
    const page = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: PREFIX,
      ContinuationToken: token,
    }));
    for (const o of page.Contents || []) {
      // Paranoia: ListObjectsV2 is prefix-scoped, but confirm before we ever
      // put a key on a delete list.
      if (!o.Key || !o.Key.startsWith(PREFIX)) continue;
      objects.push({ key: o.Key, size: o.Size || 0, lastModified: o.LastModified });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
    pages++;
    process.stdout.write(`\rListing… ${objects.length} objects (${pages} page${pages === 1 ? "" : "s"})`);
  } while (token);
  process.stdout.write("\n\n");

  if (!objects.length) {
    console.log("Nothing under that prefix. Already clean.\n");
    await mongoose.disconnect();
    return;
  }

  // ── 3. verify orphanhood ──────────────────────────────────────────────────
  // The whole premise is that nothing references these. Check rather than
  // assume — it is one query and it is the difference between a safe purge
  // and deleting a recording someone can still open.
  const referenced = new Set();
  const cursor = GradingCapture.find({ keys: { $regex: `^${PREFIX}` } }).select("keys").lean().cursor();
  for await (const doc of cursor) {
    for (const k of doc.keys || []) if (k.startsWith(PREFIX)) referenced.add(k);
  }
  await mongoose.disconnect();

  // ── 4. partition ──────────────────────────────────────────────────────────
  const stillReferenced = [];
  const tooRecent = [];
  const orphans = [];

  for (const o of objects) {
    if (referenced.has(o.key)) { stillReferenced.push(o); continue; }
    if (cutoff && o.lastModified && o.lastModified >= cutoff) { tooRecent.push(o); continue; }
    orphans.push(o);
  }

  const totalBytes = objects.reduce((n, o) => n + o.size, 0);
  const orphanBytes = orphans.reduce((n, o) => n + o.size, 0);
  const dates = objects.map((o) => o.lastModified).filter(Boolean).sort((a, b) => a - b);

  console.log(`Found         : ${objects.length} objects, ${bytes(totalBytes)}`);
  if (dates.length) {
    console.log(`Date range    : ${dates[0].toISOString().slice(0, 10)} → ${dates[dates.length - 1].toISOString().slice(0, 10)}`);
  }
  console.log(`Orphaned      : ${orphans.length} objects, ${bytes(orphanBytes)}`);
  if (tooRecent.length) console.log(`Skipped (new) : ${tooRecent.length} objects newer than the cutoff`);

  if (stillReferenced.length) {
    console.log(`\n⚠  ${stillReferenced.length} object(s) under this prefix ARE referenced by a GradingCapture row.`);
    console.log("   These are NOT orphans and will be left alone:");
    for (const o of stillReferenced.slice(0, 10)) console.log(`     ${o.key}`);
    if (stillReferenced.length > 10) console.log(`     …and ${stillReferenced.length - 10} more`);
    console.log("   Worth understanding why before purging anything else.");
  }

  if (!orphans.length) {
    console.log("\nNothing to delete.\n");
    return;
  }

  console.log(`\nSample of what would be removed:`);
  for (const o of orphans.slice(0, 8)) {
    console.log(`  ${o.key}  (${bytes(o.size)}, ${o.lastModified ? o.lastModified.toISOString().slice(0, 10) : "?"})`);
  }
  if (orphans.length > 8) console.log(`  …and ${orphans.length - 8} more`);

  if (!DO_DELETE) {
    console.log(`\nDry run — nothing was deleted.`);
    console.log(`To remove them: node backend/scripts/cleanup-orphaned-audio.mjs --delete --yes\n`);
    return;
  }

  // ── 5. delete, batched ────────────────────────────────────────────────────
  console.log(`\nDeleting ${orphans.length} objects…`);
  let deleted = 0;
  const errors = [];

  for (let i = 0; i < orphans.length; i += S3_DELETE_BATCH) {
    const slice = orphans.slice(i, i + S3_DELETE_BATCH);
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: slice.map((o) => ({ Key: o.key })), Quiet: true },
    }));
    deleted += slice.length - (res.Errors?.length || 0);
    for (const e of res.Errors || []) errors.push(`${e.Key}: ${e.Code} ${e.Message}`);
    process.stdout.write(`\r  ${deleted} / ${orphans.length}`);
  }
  process.stdout.write("\n");

  console.log(`\nDeleted ${deleted} objects, freed ~${bytes(orphanBytes)}.`);
  if (errors.length) {
    console.log(`\n${errors.length} object(s) failed to delete:`);
    for (const e of errors.slice(0, 20)) console.log(`  ${e}`);
    if (errors.length > 20) console.log(`  …and ${errors.length - 20} more`);
  }
  console.log("");
}

main().catch(async (err) => {
  console.error("\n✖ Crashed:", err?.message || err);
  try { await mongoose.disconnect(); } catch {}
  process.exit(2);
});
