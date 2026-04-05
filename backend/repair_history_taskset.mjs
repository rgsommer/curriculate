/**
 * repair_history_taskset.mjs
 * Fixes four broken tasks in the "Taskset: History" document.
 *
 * Run from backend/:  node repair_history_taskset.mjs
 */

import mongoose from "mongoose";
import { writeFileSync } from "fs";

const MONGO_URI = "mongodb+srv://AtlasDB:NpGOIFdzwWLB8w4H@curriculate.7s8bdye.mongodb.net/?appName=curriculate";
const TASKSET_ID = "6970245f36d2258ace30b32c";

await mongoose.connect(MONGO_URI);
console.log("Connected.");

const TaskSet = mongoose.model("TaskSet", new mongoose.Schema({}, { strict: false }));
const doc = await TaskSet.findById(TASKSET_ID).lean();
if (!doc) { console.error("Taskset not found!"); process.exit(1); }

const tasks = [...doc.tasks];

// ─────────────────────────────────────────────────────────────
// TASK 2  (index 1) — physical-multiple-choice
// config.items and top-level items had diverging wrong answers.
// Use config.items as canonical; delete config.items; keep only items[].
// ─────────────────────────────────────────────────────────────
const pmc = tasks[1];
const canonicalPmcItems = pmc.config?.items ?? pmc.items;
tasks[1] = {
  ...pmc,
  items: canonicalPmcItems,
  config: undefined,   // strip config entirely for MC types
};

// ─────────────────────────────────────────────────────────────
// TASK 5  (index 4) — reading-comp
// Replace placeholder questions and deduplicate passage fields.
// ─────────────────────────────────────────────────────────────
const passage =
  "Fort Michilimackinac was a crucial military outpost during the early 18th century, " +
  "particularly during Queen Anne's War, which lasted from 1702 to 1713. This fort, located " +
  "at the strategic point where Lake Huron meets Lake Michigan, served as a key site for trade " +
  "and military operations between the French and British forces. The conflict over control of " +
  "Fort Michilimackinac highlighted the intense rivalry between the two nations, as both sought " +
  "to expand their influence in North America. Queen Anne's War was marked by various battles " +
  "and skirmishes, with Fort Michilimackinac playing a significant role in the broader struggle " +
  "for dominance in the region.";

tasks[4] = {
  ...tasks[4],
  config: {
    passage,            // single canonical field
    questions: [
      {
        id: "1",
        prompt: "Where was Fort Michilimackinac located, and why did that location make it strategically important?"
      },
      {
        id: "2",
        prompt: "Which two European nations were competing for control of Fort Michilimackinac, and what were they fighting over?"
      },
      {
        id: "3",
        prompt: "Write one sentence that summarizes the main idea of the passage."
      }
    ]
  }
};

// ─────────────────────────────────────────────────────────────
// TASK 10 (index 9) — sort
// Restore lost bucket labels and fix item→bucket assignments.
// ─────────────────────────────────────────────────────────────
tasks[9] = {
  ...tasks[9],
  config: {
    buckets: ["Key Figures", "Major Events", "Important Concepts"],
    items: [
      { id: "item1", text: "General Wolfe",            bucketIndex: 0 },  // Key Figures
      { id: "item2", text: "The Albany Meeting",        bucketIndex: 1 },  // Major Events
      { id: "item3", text: "The Turning of the War",   bucketIndex: 1 },  // Major Events
      { id: "item4", text: "Thematic Map",              bucketIndex: 2 },  // Important Concepts
      { id: "item5", text: "Treaty of Niagara",         bucketIndex: 1 },  // Major Events
      { id: "item6", text: "Turning Point",             bucketIndex: 2 },  // Important Concepts
    ],
    answerKey: {
      item1: 0,   // General Wolfe → Key Figures
      item2: 1,   // The Albany Meeting → Major Events
      item3: 1,   // The Turning of the War → Major Events
      item4: 2,   // Thematic Map → Important Concepts
      item5: 1,   // Treaty of Niagara → Major Events
      item6: 2,   // Turning Point → Important Concepts
    }
  },
  // keep top-level items in sync
  items: [
    { id: "item1", text: "General Wolfe",            bucketIndex: 0 },
    { id: "item2", text: "The Albany Meeting",        bucketIndex: 1 },
    { id: "item3", text: "The Turning of the War",   bucketIndex: 1 },
    { id: "item4", text: "Thematic Map",              bucketIndex: 2 },
    { id: "item5", text: "Treaty of Niagara",         bucketIndex: 1 },
    { id: "item6", text: "Turning Point",             bucketIndex: 2 },
  ]
};

// ─────────────────────────────────────────────────────────────
// TASK 12 (index 11) — matching
// Was completely empty. Add 6 vocabulary pairs from the lesson.
// ─────────────────────────────────────────────────────────────
tasks[11] = {
  ...tasks[11],
  leftItems: [
    { id: "L1", text: "Mercantilism" },
    { id: "L2", text: "Assimilation" },
    { id: "L3", text: "Tensions & Grievances" },
    { id: "L4", text: "Oath of Allegiance" },
    { id: "L5", text: "Wampum" },
    { id: "L6", text: "Treaty of Paris" },
  ],
  rightItems: [
    { id: "R1", text: "Beads used in Indigenous diplomacy and trade" },
    { id: "R2", text: "The agreement that officially ended the French and Indian War" },
    { id: "R3", text: "A promise to remain loyal to one's nation or ruler" },
    { id: "R4", text: "Adopting the customs and practices of another culture" },
    { id: "R5", text: "Economic theory focused on accumulating wealth through trade" },
    { id: "R6", text: "Feelings of anger arising from perceived unfair treatment" },
  ],
  correctMatches: {
    L1: "R5",   // Mercantilism → economic theory
    L2: "R4",   // Assimilation → adopting customs
    L3: "R6",   // Tensions & Grievances → anger/injustice
    L4: "R3",   // Oath of Allegiance → loyalty promise
    L5: "R1",   // Wampum → Indigenous diplomacy
    L6: "R2",   // Treaty of Paris → ended the war
  },
  items: [],   // matching doesn't use generic items[]
};

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
const result = await TaskSet.findByIdAndUpdate(
  TASKSET_ID,
  { $set: { tasks } },
  { new: true }
).lean();

console.log(`\nUpdated taskset: ${result.name}`);
console.log(`Task count: ${result.tasks.length}`);

// Sanity dump
const summary = result.tasks.map((t, i) => {
  const issues = [];
  if (t.taskType === "sort") {
    const b = t.config?.buckets ?? [];
    if (b.some(x => String(x).includes("object"))) issues.push("❌ buckets still [object Object]");
    else issues.push(`✅ buckets: ${b.join(" | ")}`);
  }
  if (t.taskType === "matching") {
    const left = t.leftItems?.length ?? 0;
    const right = t.rightItems?.length ?? 0;
    issues.push(left >= 4 ? `✅ ${left} pairs` : `❌ only ${left} left items`);
  }
  if (t.taskType === "reading-comp") {
    const qs = t.config?.questions ?? [];
    const hasPlaceholders = qs.some(q => q.prompt?.includes("_____"));
    issues.push(hasPlaceholders ? "❌ still has placeholder questions" : `✅ ${qs.length} real questions`);
  }
  if (t.taskType === "physical-multiple-choice") {
    issues.push(t.config ? "⚠️ config still present" : "✅ config removed, items canonical");
  }
  return `  [${i}] ${t.taskType.padEnd(26)} ${t.title.slice(0, 40)}  ${issues.join(" ")}`;
});
console.log("\nTask status:\n" + summary.join("\n"));

// Write repaired JSON for inspection
writeFileSync(
  new URL("./taskset_history_repaired.json", import.meta.url),
  JSON.stringify(result, null, 2)
);
console.log("\nRepaired snapshot written to taskset_history_repaired.json");

await mongoose.disconnect();
