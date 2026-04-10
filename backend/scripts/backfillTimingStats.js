#!/usr/bin/env node
// backend/scripts/backfillTimingStats.js
//
// One-time script: reads all existing SessionReports and backfills TaskTypeStats
// from their transcript data.
//
// Usage:  node backend/scripts/backfillTimingStats.js
// Requires MONGODB_URI in env (or .env file).

import "dotenv/config";
import mongoose from "mongoose";
import SessionReport from "../models/SessionReport.js";
import TaskTypeStats from "../models/TaskTypeStats.js";
import { TASK_TYPE_META } from "../../shared/taskTypes.js";

const GLOBAL_OWNER = "__global__";
const MIN_MS = 1_000;
const MAX_MS = 20 * 60 * 1000;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI not set. Exiting.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  // Stream through all session reports
  const cursor = SessionReport.find({}).cursor();
  let reportCount = 0;
  let submissionCount = 0;

  // Accumulate stats in memory first, then batch-upsert
  // Key: `${ownerId}::${taskType}`
  const accum = {};

  const addSample = (ownerId, taskType, timeMs, maxTimeSeconds) => {
    const key = `${ownerId}::${taskType}`;
    if (!accum[key]) {
      accum[key] = { ownerId, taskType, count: 0, totalMs: 0, minMs: Infinity, maxMs: 0, withinLimit: 0 };
    }
    const a = accum[key];
    a.count++;
    a.totalMs += timeMs;
    a.minMs = Math.min(a.minMs, timeMs);
    a.maxMs = Math.max(a.maxMs, timeMs);
    if (maxTimeSeconds > 0 && timeMs <= maxTimeSeconds * 1000) {
      a.withinLimit++;
    }
  };

  for await (const report of cursor) {
    reportCount++;
    const ownerId = report.ownerId || "";
    const transcript = report.transcript;
    if (!transcript) continue;

    // transcript is a Mixed field — structure varies, but commonly has:
    // transcript.tasks[] with taskType, and transcript.submissions[] with timeMs + taskIndex
    const tasks = transcript.tasks || transcript.taskset?.tasks || [];
    const submissions = transcript.submissions || [];

    if (!Array.isArray(tasks) || !Array.isArray(submissions)) continue;

    // Build taskIndex → taskType map
    const taskByIndex = new Map();
    tasks.forEach((t, i) => {
      const taskType = t?.taskType || t?.type;
      if (taskType) {
        const meta = TASK_TYPE_META?.[taskType];
        const maxTimeSeconds = Number(t?.timeLimitSeconds || t?.maxTimeSeconds || meta?.maxTimeSeconds) || 0;
        taskByIndex.set(i, { taskType, maxTimeSeconds });
      }
    });

    for (const sub of submissions) {
      const timeMs = Number(sub?.timeMs);
      if (!Number.isFinite(timeMs) || timeMs < MIN_MS || timeMs > MAX_MS) continue;

      const taskIndex = sub?.taskIndex;
      const taskMeta = taskByIndex.get(taskIndex);
      if (!taskMeta) continue;

      submissionCount++;
      const { taskType, maxTimeSeconds } = taskMeta;

      // Global
      addSample(GLOBAL_OWNER, taskType, timeMs, maxTimeSeconds);
      // Per-teacher
      if (ownerId && ownerId !== GLOBAL_OWNER) {
        addSample(ownerId, taskType, timeMs, maxTimeSeconds);
      }
    }

    if (reportCount % 100 === 0) {
      console.log(`  Processed ${reportCount} reports, ${submissionCount} valid submissions…`);
    }
  }

  console.log(`\nDone scanning. ${reportCount} reports, ${submissionCount} submissions.`);
  console.log(`Upserting ${Object.keys(accum).length} stat records…`);

  // Batch upsert
  const ops = Object.values(accum).map((a) =>
    TaskTypeStats.findOneAndUpdate(
      { ownerId: a.ownerId, taskType: a.taskType },
      {
        $inc: {
          sampleCount: a.count,
          totalMs: a.totalMs,
          withinLimitCount: a.withinLimit,
        },
        $min: { minMs: a.minMs },
        $max: { maxMs: a.maxMs },
        $set: { lastUpdatedAt: new Date() },
      },
      { upsert: true, new: true }
    ).then((doc) => {
      if (doc && doc.sampleCount > 0) {
        doc.avgMs = Math.round(doc.totalMs / doc.sampleCount);
        return doc.save();
      }
    })
  );

  await Promise.all(ops);
  console.log("Backfill complete!");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
