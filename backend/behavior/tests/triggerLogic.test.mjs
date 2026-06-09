// node --test backend/behavior/tests/triggerLogic.test.mjs
//
// Tests the core cross-teacher trigger logic, fade window, and CC-VP rule
// (brief §11). Pure functions → no DB required.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateIncident,
  evaluatePositive,
  activeThresholdIncidents,
  activePositiveIncidents,
  isWithinFadeWindow,
  repeatMultiplier,
} from "../lib/triggerLogic.js";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-06-08T12:00:00Z");

function inc({ id, mode = "THRESHOLD", teacher = "t1", daysAgo = 0, counted = false }) {
  return {
    _id: id,
    teacherId: teacher,
    immediateFlag: mode === "IMMEDIATE",
    behaviorSnapshot: { triggerMode: mode, name: "Talking out", consequenceText: "10x lines" },
    countedInNoticeId: counted ? "n1" : null,
    timestamp: new Date(now.getTime() - daysAgo * DAY),
  };
}

function pos({ id, teacher = "t1", daysAgo = 0, points = 5, counted = false }) {
  return {
    _id: id,
    teacherId: teacher,
    behaviorSnapshot: { triggerMode: "INTERACTION", name: "Helped a classmate", points },
    countedInNoticeId: counted ? "n1" : null,
    timestamp: new Date(now.getTime() - daysAgo * DAY),
  };
}

test("CORE: strikes aggregate across DIFFERENT teachers, not per-teacher", () => {
  // 3 incidents, one from each of three different teachers — the per-teacher
  // model would never fire; the shared model fires at 3.
  const prior = [
    inc({ id: "a", teacher: "tA", daysAgo: 1 }),
    inc({ id: "b", teacher: "tB", daysAgo: 1 }),
  ];
  const newInc = inc({ id: "c", teacher: "tC", daysAgo: 0 });
  const d = evaluateIncident({
    newIncident: newInc,
    priorIncidents: prior,
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0, thresholdResetAt: null },
    asOf: now,
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.reason, "threshold");
  assert.equal(d.contributingIncidents.length, 3);
});

test("THRESHOLD: does not fire below the trigger count", () => {
  const d = evaluateIncident({
    newIncident: inc({ id: "b", daysAgo: 0 }),
    priorIncidents: [inc({ id: "a", daysAgo: 1 })],
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, false);
  assert.equal(d.reason, null);
});

test("FADE WINDOW: incidents older than the window do not count", () => {
  // Two old (40 days) + one new — old ones have faded, so count = 1, no fire.
  const prior = [inc({ id: "a", daysAgo: 40 }), inc({ id: "b", daysAgo: 35 })];
  const d = evaluateIncident({
    newIncident: inc({ id: "c", daysAgo: 0 }),
    priorIncidents: prior,
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, false);
  assert.equal(isWithinFadeWindow(inc({ id: "a", daysAgo: 40 }), 30, now), false);
  assert.equal(isWithinFadeWindow(inc({ id: "c", daysAgo: 0 }), 30, now), true);
});

test("RESET: incidents before thresholdResetAt are kept but not counted", () => {
  const resetAt = new Date(now.getTime() - 2 * DAY);
  // Two incidents before reset, one after → only 1 counts.
  const all = [
    inc({ id: "a", daysAgo: 5 }),
    inc({ id: "b", daysAgo: 3 }),
    inc({ id: "c", daysAgo: 1 }),
  ];
  const active = activeThresholdIncidents(all, { fadeWindowDays: 30, thresholdResetAt: resetAt, asOf: now });
  assert.equal(active.length, 1);
  assert.equal(active[0]._id, "c");
});

test("SPENT: incidents already attributed to a prior notice are excluded", () => {
  const all = [inc({ id: "a", daysAgo: 2, counted: true }), inc({ id: "b", daysAgo: 1 })];
  const active = activeThresholdIncidents(all, { fadeWindowDays: 30, thresholdResetAt: null, asOf: now });
  assert.equal(active.length, 1);
  assert.equal(active[0]._id, "b");
});

test("IMMEDIATE: a single occurrence fires regardless of count", () => {
  const d = evaluateIncident({
    newIncident: inc({ id: "x", mode: "IMMEDIATE", daysAgo: 0 }),
    priorIncidents: [],
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.reason, "immediate");
  assert.equal(d.contributingIncidents.length, 1);
});

test("INTERACTION never notifies and never counts", () => {
  const d = evaluateIncident({
    newIncident: inc({ id: "x", mode: "INTERACTION", daysAgo: 0 }),
    priorIncidents: [inc({ id: "a", daysAgo: 1 }), inc({ id: "b", daysAgo: 0 })],
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, false);
});

test("POSITIVE behaviour (points > 0) never notifies, even in THRESHOLD mode", () => {
  // A positive incident sitting on top of 2 real strikes must NOT trigger.
  const positive = { ...inc({ id: "p", mode: "THRESHOLD", daysAgo: 0 }) };
  positive.behaviorSnapshot = { ...positive.behaviorSnapshot, name: "Helped a classmate", points: 5 };
  const d = evaluateIncident({
    newIncident: positive,
    priorIncidents: [inc({ id: "a", daysAgo: 1 }), inc({ id: "b", daysAgo: 0 })],
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, false);
});

test("POSITIVE incidents are excluded from the active strike count", () => {
  const positive = { ...inc({ id: "p", mode: "THRESHOLD", daysAgo: 0 }) };
  positive.behaviorSnapshot = { ...positive.behaviorSnapshot, points: 5 };
  const active = activeThresholdIncidents(
    [inc({ id: "a", daysAgo: 2 }), inc({ id: "b", daysAgo: 1 }), positive],
    { fadeWindowDays: 30, thresholdResetAt: null, asOf: now }
  );
  assert.equal(active.length, 2); // only the two real strikes
});

test("POSITIVE notice: fires at 3 positives within the 3× fade window", () => {
  // fade 30 → positive window 90 days. Three positives inside the window fire.
  const incidents = [
    pos({ id: "p1", daysAgo: 80 }),
    pos({ id: "p2", daysAgo: 40 }),
    pos({ id: "p3", daysAgo: 1 }),
  ];
  const d = evaluatePositive({
    incidents,
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: {},
    asOf: now,
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.contributingIncidents.length, 3);
});

test("POSITIVE notice: a positive older than the 3× window does not count", () => {
  const incidents = [
    pos({ id: "p1", daysAgo: 120 }), // outside the 90-day window
    pos({ id: "p2", daysAgo: 10 }),
    pos({ id: "p3", daysAgo: 1 }),
  ];
  const d = evaluatePositive({ incidents, config: { triggerCount: 3, fadeWindowDays: 30 }, student: {}, asOf: now });
  assert.equal(d.shouldNotify, false); // only 2 in-window
});

test("POSITIVE notice: negatives are neither counted nor subtracted", () => {
  const incidents = [
    pos({ id: "p1", daysAgo: 5 }),
    pos({ id: "p2", daysAgo: 4 }),
    pos({ id: "p3", daysAgo: 3 }),
    inc({ id: "n1", daysAgo: 2 }), // a negative strike — irrelevant to positives
    inc({ id: "n2", daysAgo: 1 }),
  ];
  const d = evaluatePositive({ incidents, config: { triggerCount: 3, fadeWindowDays: 30 }, student: {}, asOf: now });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.contributingIncidents.length, 3); // exactly the 3 positives
});

test("POSITIVE notice: already-celebrated positives are excluded", () => {
  const incidents = [
    pos({ id: "p1", daysAgo: 5, counted: true }),
    pos({ id: "p2", daysAgo: 4, counted: true }),
    pos({ id: "p3", daysAgo: 1 }),
  ];
  const d = evaluatePositive({ incidents, config: { triggerCount: 3, fadeWindowDays: 30 }, student: {}, asOf: now });
  assert.equal(d.shouldNotify, false); // only 1 fresh positive
});

test("IMMEDIATE pulls in the queued threshold incidents", () => {
  const prior = [inc({ id: "a", daysAgo: 1 }), inc({ id: "b", daysAgo: 0 })]; // 2 queued
  const d = evaluateIncident({
    newIncident: inc({ id: "x", mode: "IMMEDIATE", daysAgo: 0 }),
    priorIncidents: prior,
    config: { triggerCount: 3, fadeWindowDays: 30 },
    student: { noticesHomeCount: 0 },
    asOf: now,
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.reason, "immediate");
  assert.equal(d.contributingIncidents.length, 3); // the immediate one + 2 queued
});

test("CC-VP: first notice does not CC the VP; second-or-later does", () => {
  const base = {
    newIncident: inc({ id: "x", mode: "IMMEDIATE" }),
    priorIncidents: [],
    config: { triggerCount: 3, fadeWindowDays: 30 },
    asOf: now,
  };
  const first = evaluateIncident({ ...base, student: { noticesHomeCount: 0 } });
  assert.equal(first.sequenceNo, 1);
  assert.equal(first.ccVp, false);

  const second = evaluateIncident({ ...base, student: { noticesHomeCount: 1 } });
  assert.equal(second.sequenceNo, 2);
  assert.equal(second.ccVp, true);
});

test("repeatMultiplier: escalates 1->2->3 and caps at 3", () => {
  assert.equal(repeatMultiplier(0), 1); // first offence
  assert.equal(repeatMultiplier(1), 2); // second
  assert.equal(repeatMultiplier(2), 3); // third
  assert.equal(repeatMultiplier(3), 3); // capped
  assert.equal(repeatMultiplier(9), 3); // still capped
});
