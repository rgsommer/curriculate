import "dotenv/config";
import { MongoClient } from "mongodb";
import { normalizeAndValidateTask } from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const DB_NAME = process.env.MONGO_DB_NAME || process.env.DB_NAME || "test";
const KEY = process.argv[2] || "JesusReigns";

if (!MONGO_URI) {
  console.error("Missing MONGO_URI / MONGODB_URI");
  process.exit(1);
}

function summarizePlayIssues(results) {
  const counts = {};
  for (const r of results) {
    for (const msg of r.playIssues || []) counts[msg] = (counts[msg] || 0) + 1;
  }
  return counts;
}

function summarize(errors) {
  const counts = {};
  for (const e of errors) counts[e] = (counts[e] || 0) + 1;
  return counts;
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db(DB_NAME);

  // Adjust collection name if yours differs
  const col = db.collection("demotasksets");

  const doc = await col.findOne({ key: KEY });
  if (!doc) {
    console.error("No demo taskset found for key:", KEY);
    process.exit(2);
  }

  console.log("doc keys:", Object.keys(doc));

  const tasks =
    Array.isArray(doc.tasks) ? doc.tasks :
    Array.isArray(doc.taskset?.tasks) ? doc.taskset.tasks :
    Array.isArray(doc.data?.tasks) ? doc.data.tasks :
    Array.isArray(doc.payload?.tasks) ? doc.payload.tasks :
    [];

  console.log("tasks path used:",
    Array.isArray(doc.tasks) ? "doc.tasks" :
    Array.isArray(doc.taskset?.tasks) ? "doc.taskset.tasks" :
    Array.isArray(doc.data?.tasks) ? "doc.data.tasks" :
    Array.isArray(doc.payload?.tasks) ? "doc.payload.tasks" :
    "(none)"
  );

  console.log(`Found ${tasks.length} tasks for key=${KEY}`);

  const results = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const taskType = t?.taskType || t?.type || "(unknown)";
    const { ok, errors, normalizedTask } = normalizeAndValidateTask(taskType, t);
    const play = assessTaskPlayability(normalizedTask);

    // ✅ DEBUG: print playability failures (must be inside loop)
    if (!play.playable) {
      console.log(`\n#${i} ${taskType} — ${normalizedTask?.title || "(no title)"}`);
      console.log("issues:", play.issues);
      console.log("has:", {
        items: Array.isArray(normalizedTask?.items) ? normalizedTask.items.length : null,
        cfgItems: Array.isArray(normalizedTask?.config?.items) ? normalizedTask.config.items.length : null,
        seq: Array.isArray(normalizedTask?.sequence) ? normalizedTask.sequence.length : null,
        cfgSeq: Array.isArray(normalizedTask?.config?.sequence) ? normalizedTask.config.sequence.length : null,
        passage: Boolean(normalizedTask?.passage || normalizedTask?.reading || normalizedTask?.text),
        cfgText: Boolean(normalizedTask?.config?.text || normalizedTask?.config?.passage || normalizedTask?.config?.reading),
        cfgStructure: Boolean(normalizedTask?.config?.structure),
      });
    }

    results.push({
      idx: i,
      taskType,
      title: (t?.title || t?.name || "").slice(0, 80),
      ok,
      errors,
      playable: !!play.playable,
      playIssues: Array.isArray(play.issues) ? play.issues : [],
      normalizedType: play.normalizedType,
      clueCount:
        Array.isArray(t?.clues) ? t.clues.length :
        Array.isArray(t?.config?.clues) ? t.config.clues.length :
        null,
      roundCount:
        Array.isArray(t?.rounds) ? t.rounds.length :
        Array.isArray(t?.config?.rounds) ? t.config.rounds.length :
        null,
      itemCount: Array.isArray(t?.items) ? t.items.length : null,
    });
  }

  const failed = results.filter(r => !r.ok);
  console.log(`✅ OK: ${results.length - failed.length}`);
  console.log(`❌ FAIL: ${failed.length}`);

  const playFailed = results.filter(r => !r.playable);
  console.log(`🟡 PLAYABILITY FAIL: ${playFailed.length}`);
  console.log("Common playability issues:", summarizePlayIssues(playFailed));

  // Print failures
  for (const f of failed) {
    console.log(`\n#${f.idx} ${f.taskType} — ${f.title || "(no title)"}`);
    console.log("errors:", f.errors);
    if (f.clueCount != null) console.log("clues:", f.clueCount);
    if (f.itemCount != null) console.log("items:", f.itemCount);
  }

  // Aggregate common errors
  const allErrors = failed.flatMap(f => f.errors);
  console.log("\nCommon errors:", summarize(allErrors));

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
