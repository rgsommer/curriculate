// node --test backend/behavior/tests/aiNote.test.mjs
//
// Tests the AI note fail-safe (brief §8): on AI error/timeout/empty, fall back
// to the deterministic template so a notice always goes out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeNotice,
  deterministicNote,
  buildPrompt,
  composePositiveNotice,
  deterministicPositiveNote,
  buildPositivePrompt,
} from "../lib/aiNote.js";

const ctx = {
  studentName: "Sam",
  pronoun: "they/them",
  incidents: [
    { behaviorName: "Talking out", teacherName: "Ms. A", date: "2026-06-05", detail: "during prayer" },
    { behaviorName: "Disruptive behaviour", teacherName: "Mr. B", date: "2026-06-06", detail: "" },
    { behaviorName: "Disrespectful", teacherName: "Ms. C", date: "2026-06-07", detail: "" },
  ],
  consequences: ["Write the expectation 10× before 9am."],
  sequenceNo: 1,
  daysSinceFirst: 2,
  schoolName: "Brampton CS",
  signature: "Ms. A\nGrade 7",
  toneGuidance: "Warm but clear.",
  ccVp: false,
};

test("AI success path is used when the client returns text", async () => {
  const aiClient = { async complete() { return "AI-COMPOSED NOTE BODY"; } };
  const { text, aiUsed } = await composeNotice(ctx, { aiClient });
  assert.equal(aiUsed, true);
  assert.equal(text, "AI-COMPOSED NOTE BODY");
});

test("FAIL-SAFE: AI throwing falls back to the deterministic template", async () => {
  const aiClient = { async complete() { throw new Error("model exploded"); } };
  const { text, aiUsed } = await composeNotice(ctx, { aiClient });
  assert.equal(aiUsed, false);
  assert.match(text, /Dear Parent\/Guardian/);
  assert.match(text, /Talking out/);
});

test("FAIL-SAFE: AI timeout falls back to the template", async () => {
  const aiClient = { complete: () => new Promise((r) => setTimeout(() => r("late"), 1000)) };
  const { aiUsed } = await composeNotice(ctx, { aiClient, timeoutMs: 20 });
  assert.equal(aiUsed, false);
});

test("FAIL-SAFE: empty AI response falls back to the template", async () => {
  const aiClient = { async complete() { return "   "; } };
  const { aiUsed } = await composeNotice(ctx, { aiClient });
  assert.equal(aiUsed, false);
});

test("No AI client at all → deterministic note, never throws", async () => {
  const { text, aiUsed } = await composeNotice(ctx, { aiClient: null });
  assert.equal(aiUsed, false);
  assert.ok(text.length > 50);
});

test("buildPrompt includes prior history as awareness-only (oblique, no summary)", () => {
  const p = buildPrompt({ ...ctx, history: { priorNotices: 2, priorIncidentCount: 5, behaviourTypes: ["Talking out", "Disrespectful"], lastBeforeDays: 3 } });
  assert.match(p, /do NOT summarize/i);
  assert.match(p, /oblique/i);
  assert.match(p, /Talking out/); // present as background context
  assert.match(p, /do not recount the background/i);
});

test("buildPrompt omits the background block when there's no history", () => {
  const p = buildPrompt({ ...ctx, history: { priorNotices: 0, priorIncidentCount: 0, behaviourTypes: [], lastBeforeDays: null } });
  assert.doesNotMatch(p, /BACKGROUND/);
});

test("Positives are acknowledged in the note and prompt, never as offset", () => {
  const withPositives = {
    ...ctx,
    positives: [
      { behaviorName: "Helped a classmate", date: "2026-06-06", detail: "" },
      { behaviorName: "Great effort in math", date: "2026-06-07", detail: "" },
    ],
  };
  const note = deterministicNote(withPositives);
  assert.match(note, /positive note/i);
  assert.match(note, /Helped a classmate/);

  const p = buildPrompt({ ...withPositives, history: { priorNotices: 0, priorIncidentCount: 0, behaviourTypes: [], lastBeforeDays: null } });
  assert.match(p, /POSITIVES TO ACKNOWLEDGE/);
  assert.match(p, /NOT as offsetting/i);
});

test("No positives → no positive line in the note", () => {
  const note = deterministicNote({ ...ctx, positives: [] });
  assert.doesNotMatch(note, /positive note/i);
});

test("Positive note: celebratory, names the positives, no concerns", () => {
  const pctx = {
    studentName: "Sam",
    schoolName: "Brampton CS",
    signature: "Ms. A\nGrade 7",
    incidents: [
      { behaviorName: "Helped a classmate", teacherName: "Ms. A", date: "2026-06-05", detail: "" },
      { behaviorName: "Great effort in math", teacherName: "Mr. B", date: "2026-06-06", detail: "" },
      { behaviorName: "Kindness award", teacherName: "Ms. C", date: "2026-06-07", detail: "" },
    ],
  };
  const note = deterministicPositiveNote(pctx);
  assert.match(note, /good news/i);
  assert.match(note, /Helped a classmate/);
  assert.doesNotMatch(note, /concern|consequence|point/i);

  const p = buildPositivePrompt(pctx);
  assert.match(p, /good news/i);
  assert.match(p, /Do NOT mention any negative/i);
});

test("Positive note: AI failure falls back to the deterministic good-news note", async () => {
  const aiClient = { async complete() { throw new Error("nope"); } };
  const { text, aiUsed } = await composePositiveNotice(
    { studentName: "Sam", schoolName: "BCS", incidents: [{ behaviorName: "Helped out", date: "2026-06-07" }] },
    { aiClient }
  );
  assert.equal(aiUsed, false);
  assert.match(text, /good news/i);
});

test("Deterministic note adapts tone: first vs repeat", () => {
  const first = deterministicNote({ ...ctx, sequenceNo: 1 });
  const repeat = deterministicNote({ ...ctx, sequenceNo: 2, ccVp: true });
  assert.match(first, /work with you/);
  assert.match(repeat, /notice #2/);
  assert.match(repeat, /Vice-Principal has been copied/);
});
