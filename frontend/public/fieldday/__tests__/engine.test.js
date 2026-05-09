/**
 * Unit tests for the Field Day scoring engine.
 *
 * Run with:   node --test frontend/public/fieldday/__tests__/engine.test.js
 *
 * No external dependencies — uses Node's built-in `node:test` runner
 * (Node 18+) and `node:assert/strict`.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../engine.js");

/* ====================================================================== *
 *   bestOf
 * ====================================================================== */
test("bestOf — picks min for timed events", () => {
  assert.equal(E.bestOf([8.5, 9.1, 7.92], "timed"), 7.92);
});
test("bestOf — picks max for distance events", () => {
  assert.equal(E.bestOf([3.2, 3.5, 3.4], "distance"), 3.5);
});
test("bestOf — picks max for weight events", () => {
  assert.equal(E.bestOf([10, 12, 11], "weight"), 12);
});
test("bestOf — returns null for empty / all-null attempts", () => {
  assert.equal(E.bestOf([], "timed"), null);
  assert.equal(E.bestOf([null, null], "timed"), null);
  assert.equal(E.bestOf([null, "", undefined], "distance"), null);
});
test("bestOf — ignores blanks among real numbers", () => {
  assert.equal(E.bestOf([null, 8.5, "", 9.0], "timed"), 8.5);
});

/* ====================================================================== *
 *   compareResults
 * ====================================================================== */
test("compareResults — timed: lower wins (ascending sort)", () => {
  assert.ok(E.compareResults(8.5, 9.0, "timed") < 0);
  assert.ok(E.compareResults(9.0, 8.5, "timed") > 0);
});
test("compareResults — distance: higher wins (ascending sort)", () => {
  assert.ok(E.compareResults(3.5, 3.2, "distance") < 0);
  assert.ok(E.compareResults(3.2, 3.5, "distance") > 0);
});
test("compareResults — null-handling: nulls sort last", () => {
  assert.ok(E.compareResults(null, 10, "timed") > 0);
  assert.ok(E.compareResults(10, null, "timed") < 0);
  assert.equal(E.compareResults(null, null, "distance"), 0);
});

/* ====================================================================== *
 *   computePlacements — placement scoring
 * ====================================================================== */
function evWith(competitors, opts = {}) {
  return Object.assign({ competitors, type: "timed", status: "in_progress", scoreBy: "event", age: "8" }, opts);
}

test("placements — simple timed event, no ties", () => {
  const ev = evWith([
    { id: "a", attempts: [10.5] },
    { id: "b", attempts: [9.8]  },
    { id: "c", attempts: [11.2] },
    { id: "d", attempts: [10.0] }
  ]);
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.b.place, 1); assert.equal(m.b.points, 5);
  assert.equal(m.d.place, 2); assert.equal(m.d.points, 4);
  assert.equal(m.a.place, 3); assert.equal(m.a.points, 3);
  assert.equal(m.c.place, 4); assert.equal(m.c.points, 2);
});

test("placements — distance event, highest wins", () => {
  const ev = evWith([
    { id: "a", attempts: [3.0, 3.5] },
    { id: "b", attempts: [4.1] }
  ], { type: "distance" });
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.b.place, 1);
  assert.equal(m.a.place, 2);
});

test("placements — best-of-N picks the best attempt", () => {
  const ev = evWith([
    { id: "a", attempts: [3, 5, 4] }, // best 5
    { id: "b", attempts: [null, 4.8, 4] } // best 4.8
  ], { type: "distance" });
  const p = E.computePlacements(ev, "average");
  assert.equal(p.find(r => r.competitorId === "a").place, 1);
  assert.equal(p.find(r => r.competitorId === "b").place, 2);
});

/* ====================================================================== *
 *   computePlacements — tie modes
 * ====================================================================== */
test("ties — average mode: tie for 1st gets 4.5 points each, next is 3rd", () => {
  const ev = evWith([
    { id: "a", attempts: [5] },
    { id: "b", attempts: [5] },
    { id: "c", attempts: [3] }
  ], { type: "distance" });
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.a.place, 1); assert.equal(m.a.points, 4.5);
  assert.equal(m.b.place, 1); assert.equal(m.b.points, 4.5);
  assert.equal(m.c.place, 3); assert.equal(m.c.points, 3);
  assert.equal(m.a.tied, true);
});

test("ties — higher mode: tie for 1st gets 5 each, next is 3rd", () => {
  const ev = evWith([
    { id: "a", attempts: [5] },
    { id: "b", attempts: [5] },
    { id: "c", attempts: [3] }
  ], { type: "distance" });
  const p = E.computePlacements(ev, "higher");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.a.points, 5);
  assert.equal(m.b.points, 5);
  assert.equal(m.c.place, 3); assert.equal(m.c.points, 3);
});

test("ties — three-way tie for 1st averaged: 4 each, next is 4th", () => {
  const ev = evWith([
    { id: "a", attempts: [5] },
    { id: "b", attempts: [5] },
    { id: "c", attempts: [5] },
    { id: "d", attempts: [2] }
  ], { type: "distance" });
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.a.points, 4);
  assert.equal(m.b.points, 4);
  assert.equal(m.c.points, 4);
  assert.equal(m.d.place, 4); assert.equal(m.d.points, 2);
});

test("ties — tie for 2nd averaged: each gets 3.5, next is 4th", () => {
  const ev = evWith([
    { id: "a", attempts: [10] },
    { id: "b", attempts: [9] },
    { id: "c", attempts: [9] },
    { id: "d", attempts: [7] }
  ], { type: "distance" });
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.a.points, 5);
  assert.equal(m.b.points, 3.5);
  assert.equal(m.c.points, 3.5);
  assert.equal(m.d.place, 4); assert.equal(m.d.points, 2);
});

/* ====================================================================== *
 *   computePlacements — completion / participation points
 * ====================================================================== */
test("completion — competitors with no result get 1 pt only when event completed", () => {
  const ev = evWith([
    { id: "a", attempts: [8.0] },
    { id: "b", attempts: [null] }
  ], { status: "completed" });
  const p = E.computePlacements(ev, "average");
  assert.equal(p.find(r => r.competitorId === "b").points, 1);
});
test("completion — no-result competitors get 0 pts while event in progress", () => {
  const ev = evWith([
    { id: "a", attempts: [8.0] },
    { id: "b", attempts: [null] }
  ], { status: "in_progress" });
  const p = E.computePlacements(ev, "average");
  assert.equal(p.find(r => r.competitorId === "b").points, 0);
});

/* ====================================================================== *
 *   computePlacements — score-by-age band
 * ====================================================================== */
test("scoreBy=ageBand — 5th-grade heat with 10s and 11s scores separately", () => {
  const ev = {
    type: "timed", status: "in_progress", scoreBy: "ageBand", age: "10",
    competitors: [
      { id: "a", attempts: [11.0], actualAge: "10" },
      { id: "b", attempts: [11.5], actualAge: "10" },
      { id: "c", attempts: [10.8], actualAge: "11" },
      { id: "d", attempts: [11.1], actualAge: "11" }
    ]
  };
  const ageBands = ["5-6","7-8","9-10","11-12"];
  const p = E.computePlacements(ev, "average", ageBands);
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  // Age 9-10 band: a(11.0)=1st, b(11.5)=2nd
  assert.equal(m.a.place, 1); assert.equal(m.a.points, 5);
  assert.equal(m.b.place, 2); assert.equal(m.b.points, 4);
  // Age 11-12 band: c(10.8)=1st, d(11.1)=2nd — both also 1st in their band
  assert.equal(m.c.place, 1); assert.equal(m.c.points, 5);
  assert.equal(m.d.place, 2); assert.equal(m.d.points, 4);
});

/* ====================================================================== *
 *   parseBand / ageInBand / bandForAge / divisionForAge
 * ====================================================================== */
test("parseBand — single age", () => { assert.deepEqual(E.parseBand("8"), [8, 8]); });
test("parseBand — range", ()       => { assert.deepEqual(E.parseBand("7-8"), [7, 8]); });
test("parseBand — en-dash works", () => { assert.deepEqual(E.parseBand("9–10"), [9, 10]); });
test("parseBand — empty / garbage returns [0,0]", () => {
  assert.deepEqual(E.parseBand(""), [0, 0]);
  assert.deepEqual(E.parseBand("abc"), [0, 0]);
});

test("ageInBand — string age within range", () => {
  assert.equal(E.ageInBand("8", [7, 9]), true);
  assert.equal(E.ageInBand("6", [7, 9]), false);
});
test("ageInBand — boundaries are inclusive", () => {
  assert.equal(E.ageInBand("7", [7, 9]), true);
  assert.equal(E.ageInBand("9", [7, 9]), true);
});

test("bandForAge — finds the matching band", () => {
  const bands = ["5-6","7-8","9-10","11-12"];
  assert.equal(E.bandForAge("8", bands), "7-8");
  assert.equal(E.bandForAge("11", bands), "11-12");
  assert.equal(E.bandForAge("99", bands), null);
});

test("divisionForAge — returns the named division", () => {
  const divs = [
    { name: "Junior", ageRange: [5, 8] },
    { name: "Intermediate", ageRange: [9, 11] },
    { name: "Senior", ageRange: [12, 14] }
  ];
  assert.equal(E.divisionForAge("7", divs), "Junior");
  assert.equal(E.divisionForAge("11", divs), "Intermediate");
  assert.equal(E.divisionForAge("13", divs), "Senior");
  assert.equal(E.divisionForAge("3", divs), null);
});

/* ====================================================================== *
 *   computeAge — DOB + cutoff
 * ====================================================================== */
test("computeAge — default Dec 31 cutoff: kid born May 2017 is 8 in 2025", () => {
  assert.equal(E.computeAge("2017-05-01", "12-31", 2025), 8);
});
test("computeAge — kid hasn't had birthday yet by cutoff: still last age", () => {
  // Cutoff August 31 — kid born September 2016 is 8 (not 9) on Aug 31 2025
  assert.equal(E.computeAge("2016-09-15", "08-31", 2025), 8);
});
test("computeAge — kid's birthday on cutoff day: ages up", () => {
  // Cutoff December 31 — kid born December 31 2017 turns 8 on Dec 31 2025
  assert.equal(E.computeAge("2017-12-31", "12-31", 2025), 8);
});
test("computeAge — invalid DOB returns null", () => {
  assert.equal(E.computeAge("not-a-date", "12-31", 2025), null);
  assert.equal(E.computeAge("", "12-31", 2025), null);
});
test("computeAge — DOB after cutoff in future year returns null", () => {
  assert.equal(E.computeAge("2030-01-01", "12-31", 2025), null);
});

/* ====================================================================== *
 *   tierForResult — standards
 * ====================================================================== */
test("tierForResult — timed: 7.5s beats gold of 8.0s", () => {
  assert.equal(E.tierForResult(7.5, { gold: 8.0, silver: 9.0, bronze: 10.0 }, "timed"), "gold");
});
test("tierForResult — timed: 8.5s beats silver but not gold", () => {
  assert.equal(E.tierForResult(8.5, { gold: 8.0, silver: 9.0, bronze: 10.0 }, "timed"), "silver");
});
test("tierForResult — timed: 10.5s beats nothing", () => {
  assert.equal(E.tierForResult(10.5, { gold: 8.0, silver: 9.0, bronze: 10.0 }, "timed"), null);
});
test("tierForResult — distance: 3.5m hits gold of 3.0m+", () => {
  assert.equal(E.tierForResult(3.5, { gold: 3.0, silver: 2.5, bronze: 2.0 }, "distance"), "gold");
});
test("tierForResult — null inputs return null", () => {
  assert.equal(E.tierForResult(null, { gold: 1, silver: 2, bronze: 3 }, "timed"), null);
  assert.equal(E.tierForResult(5, null, "timed"), null);
});

/* ====================================================================== *
 *   isNewRecord / didBeatPB
 * ====================================================================== */
test("isNewRecord — first record always wins", () => {
  assert.equal(E.isNewRecord(10, null, "timed"), true);
});
test("isNewRecord — timed beats existing only if strictly faster", () => {
  assert.equal(E.isNewRecord(8.5, { value: 9.0 }, "timed"), true);
  assert.equal(E.isNewRecord(9.0, { value: 9.0 }, "timed"), false); // tie does not break
  assert.equal(E.isNewRecord(9.5, { value: 9.0 }, "timed"), false);
});
test("isNewRecord — distance beats existing only if strictly farther", () => {
  assert.equal(E.isNewRecord(3.5, { value: 3.0 }, "distance"), true);
  assert.equal(E.isNewRecord(3.0, { value: 3.0 }, "distance"), false);
});

test("didBeatPB — picks correct PB by name + title and beats it", () => {
  const pbs = [
    { name: "Maya Patel",     title: "50m Sprint",  value: 8.5 },
    { name: "Sofia Martinez", title: "50m Sprint",  value: 9.0 }
  ];
  const ev = { title: "50m Sprint", type: "timed" };
  const c = { name: "Maya Patel", attempts: [8.42] };
  assert.equal(E.didBeatPB(c, ev, pbs), true);
  const c2 = { name: "Maya Patel", attempts: [8.7] };
  assert.equal(E.didBeatPB(c2, ev, pbs), false);
});
test("didBeatPB — name match is case-insensitive + trim", () => {
  const pbs = [{ name: "Maya Patel", title: "50m Sprint", value: 8.5 }];
  const ev  = { title: "50m Sprint", type: "timed" };
  assert.equal(E.didBeatPB({ name: " maya PATEL ", attempts: [8.0] }, ev, pbs), true);
});
test("didBeatPB — missing PB returns false (not flagged)", () => {
  assert.equal(E.didBeatPB({ name: "Newcomer", attempts: [8.0] }, { title: "50m Sprint", type: "timed" }, []), false);
});

/* ====================================================================== *
 *   DQ + wind
 * ====================================================================== */
test("DQ — disqualified competitor doesn't earn placement", () => {
  const ev = evWith([
    { id: "a", attempts: [10] },
    { id: "b", attempts: [9],  dq: true, dqReason: "false start" },
    { id: "c", attempts: [11] }
  ], { status: "completed" });
  const p = E.computePlacements(ev, "average");
  const m = Object.fromEntries(p.map(r => [r.competitorId, r]));
  assert.equal(m.a.place, 1);
  assert.equal(m.c.place, 2);
  assert.equal(m.b.place, null);
  assert.equal(m.b.dq, true);
  assert.equal(m.b.points, 0); // DQ gets 0, not 1 (no participation pts for cause)
});

test("bestOfCompetitor — DQ'd competitor returns null even with results", () => {
  assert.equal(E.bestOfCompetitor({ attempts: [8.5], dq: true }, "timed"), null);
  assert.equal(E.bestOfCompetitor({ attempts: [8.5] }, "timed"), 8.5);
});

test("isWindAided — true above 2.0 m/s, false at or below", () => {
  assert.equal(E.isWindAided(2.1), true);
  assert.equal(E.isWindAided(2.0), false);
  assert.equal(E.isWindAided(0),   false);
  assert.equal(E.isWindAided(null), false);
  assert.equal(E.isWindAided(""),   false);
});

/* ====================================================================== *
 *   ordinal / fmtTimer
 * ====================================================================== */
test("ordinal — typical placements", () => {
  assert.equal(E.ordinal(1), "1st");
  assert.equal(E.ordinal(2), "2nd");
  assert.equal(E.ordinal(3), "3rd");
  assert.equal(E.ordinal(4), "4th");
});
test("ordinal — teen exceptions", () => {
  assert.equal(E.ordinal(11), "11th");
  assert.equal(E.ordinal(12), "12th");
  assert.equal(E.ordinal(13), "13th");
});
test("ordinal — 21st, 22nd etc.", () => {
  assert.equal(E.ordinal(21), "21st");
  assert.equal(E.ordinal(22), "22nd");
  assert.equal(E.ordinal(23), "23rd");
});

test("fmtTimer — hundredths precision, zero-padded", () => {
  assert.equal(E.fmtTimer(8420), "00:08.42");
  assert.equal(E.fmtTimer(125_500), "02:05.50");
});
test("fmtTimer — null returns dashes", () => {
  assert.equal(E.fmtTimer(null), "--");
  assert.equal(E.fmtTimer(NaN), "--");
});
