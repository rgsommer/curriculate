/**
 * Timer logic tests — these mirror the math + invariants that the
 * server-coordinated stopwatch relies on. We don't spin up a real DB or
 * Express here; instead we extract the small pure functions that the
 * routes wrap and verify them in isolation.
 *
 * Run with:  node __tests__/timer.test.js
 */
import { test } from "node:test";
import assert from "node:assert/strict";

// ---------- Helpers we re-implement here to mirror the routes ----------

/** Same elapsed math the timer/stop endpoint uses: round to centiseconds. */
function elapsedSeconds(startedAt, stoppedAt) {
  const elapsedMs = Math.max(0, stoppedAt - startedAt);
  return Math.round(elapsedMs / 10) / 100;
}

/** Same slot-finding logic the timer/stop endpoint uses. */
function pickAttemptSlot(attempts) {
  const empty = attempts.findIndex(v => v == null || v === "");
  return empty >= 0 ? empty : Math.max(0, attempts.length - 1);
}

/** Best-of-N clock skew calibration — same reduction as the api.js method. */
function bestSkew(samples) {
  let bestSkew = 0;
  let bestRtt = Infinity;
  for (const { t0, t1, serverTime } of samples) {
    const rtt = t1 - t0;
    if (rtt < bestRtt) {
      bestRtt = rtt;
      bestSkew = (serverTime + rtt / 2) - t1;
    }
  }
  return Math.round(bestSkew);
}

/** Mirror of the server's idempotent timer/start logic. */
function startTimerOn(ev, competitorId, startedAt, startedBy) {
  ev.liveTimers = ev.liveTimers || {};
  if (!ev.liveTimers[competitorId]) {
    ev.liveTimers[competitorId] = { startedAt, startedBy };
  }
  return ev.liveTimers[competitorId];
}

/** Mirror of the server's timer/stop logic. */
function stopTimerOn(ev, competitorId, stoppedAt) {
  ev.liveTimers = ev.liveTimers || {};
  const live = ev.liveTimers[competitorId];
  if (!live) return { already: true };
  const c = ev.competitors.find(x => x.id === competitorId);
  if (!c) return { error: "competitor_not_found" };
  const seconds = elapsedSeconds(live.startedAt, stoppedAt);
  const idx = pickAttemptSlot(c.attempts);
  while (c.attempts.length <= idx) c.attempts.push(null);
  c.attempts[idx] = seconds;
  delete ev.liveTimers[competitorId];
  return { elapsedSeconds: seconds, attemptIdx: idx };
}

/** Mass-start: every non-DQ competitor with an empty slot gets the same start. */
function startAllOn(ev, startedAt, startedBy) {
  ev.liveTimers = ev.liveTimers || {};
  let started = 0;
  for (const c of ev.competitors || []) {
    if (c.dq) continue;
    if (!(c.attempts || []).some(v => v == null || v === "")) continue;
    if (ev.liveTimers[c.id]) continue;
    ev.liveTimers[c.id] = { startedAt, startedBy };
    started++;
  }
  return started;
}

// ---------- elapsed math ----------

test("elapsed: 8.42-second sprint round-trips correctly", () => {
  assert.equal(elapsedSeconds(1000000, 1008420), 8.42);
});

test("elapsed: clamps negative deltas to 0 (clock skew protection)", () => {
  assert.equal(elapsedSeconds(2000, 1000), 0);
});

test("elapsed: rounds 12345 ms → 12.35 s (nearest centisecond)", () => {
  assert.equal(elapsedSeconds(0, 12345), 12.35);
});

test("elapsed: rounds 12349 ms → 12.35 s (rounds up)", () => {
  assert.equal(elapsedSeconds(0, 12349), 12.35);
});

test("elapsed: rounds 12344 ms → 12.34 s (rounds down)", () => {
  assert.equal(elapsedSeconds(0, 12344), 12.34);
});

test("elapsed: long run — 5:25.42 mile = 325.42 seconds", () => {
  assert.equal(elapsedSeconds(0, 325420), 325.42);
});

// ---------- slot picking ----------

test("slot: picks first empty when multiple empty", () => {
  assert.equal(pickAttemptSlot([null, null, null]), 0);
});

test("slot: skips filled, picks next empty", () => {
  assert.equal(pickAttemptSlot([8.42, null, null]), 1);
});

test("slot: returns last-index when all full (overwrite)", () => {
  assert.equal(pickAttemptSlot([8.42, 8.51, 8.39]), 2);
});

test("slot: handles empty-string as empty (legacy data)", () => {
  assert.equal(pickAttemptSlot([8.42, "", 8.39]), 1);
});

test("slot: empty array returns 0 (degenerate but safe)", () => {
  assert.equal(pickAttemptSlot([]), 0);
});

// ---------- clock skew ----------

test("skew: identical clocks + zero ping → skew=0", () => {
  const t0 = 1000;
  const skew = bestSkew([{ t0, t1: t0, serverTime: t0 }]);
  assert.equal(skew, 0);
});

test("skew: server 100ms ahead, 20ms RTT → skew≈100", () => {
  // Client sends at t0=1000. Server responds with serverTime=1110 (100 ahead + 10 = 1/2 RTT).
  // Client receives at t1=1020. Math: skew = (1110 + 10) - 1020 = 100.
  const skew = bestSkew([{ t0: 1000, t1: 1020, serverTime: 1110 }]);
  assert.equal(skew, 100);
});

test("skew: best-of-N picks lowest-RTT sample", () => {
  // The slow one (200ms RTT) should be ignored in favour of the 20ms one.
  const skew = bestSkew([
    { t0: 1000, t1: 1200, serverTime: 5000 },   // slow + bad value
    { t0: 2000, t1: 2020, serverTime: 2110 },   // fast + good value (skew = 2120 - 2020 = 100)
  ]);
  assert.equal(skew, 100);
});

// ---------- start/stop semantics ----------

test("start: idempotent — second tap doesn't reset startedAt", () => {
  const ev = { competitors: [{ id: "a", attempts: [null] }] };
  startTimerOn(ev, "a", 1000, "Maria");
  startTimerOn(ev, "a", 9999, "Tom");
  assert.equal(ev.liveTimers.a.startedAt, 1000);
  assert.equal(ev.liveTimers.a.startedBy, "Maria");
});

test("stop: writes elapsed into next empty slot, clears liveTimer", () => {
  const ev = { competitors: [{ id: "a", attempts: [null, null] }] };
  startTimerOn(ev, "a", 1000, "Maria");
  const r = stopTimerOn(ev, "a", 1000 + 8420);
  assert.equal(r.elapsedSeconds, 8.42);
  assert.equal(r.attemptIdx, 0);
  assert.equal(ev.competitors[0].attempts[0], 8.42);
  assert.equal(ev.competitors[0].attempts[1], null);
  assert.equal(ev.liveTimers.a, undefined);
});

test("stop: no-op when timer was never started or already stopped", () => {
  const ev = { competitors: [{ id: "a", attempts: [null] }] };
  const r = stopTimerOn(ev, "a", 9999);
  assert.equal(r.already, true);
  assert.equal(ev.competitors[0].attempts[0], null);
});

test("stop: preserves existing earlier attempt; writes into next slot", () => {
  const ev = { competitors: [{ id: "a", attempts: [8.42, null, null] }] };
  startTimerOn(ev, "a", 0, "Maria");
  stopTimerOn(ev, "a", 8500);
  assert.equal(ev.competitors[0].attempts[0], 8.42);  // untouched
  assert.equal(ev.competitors[0].attempts[1], 8.50);  // new
  assert.equal(ev.competitors[0].attempts[2], null);  // still empty
});

test("stop: overwrites last slot when all slots full (best-of-3 fourth attempt)", () => {
  const ev = { competitors: [{ id: "a", attempts: [11.5, 11.6, 11.7] }] };
  startTimerOn(ev, "a", 0, "Maria");
  stopTimerOn(ev, "a", 11800);
  assert.deepEqual(ev.competitors[0].attempts, [11.5, 11.6, 11.80]);
});

// ---------- mass start (Start All) ----------

test("startAll: ignores DQ'd competitors", () => {
  const ev = {
    competitors: [
      { id: "a", attempts: [null] },
      { id: "b", attempts: [null], dq: true },
      { id: "c", attempts: [null] }
    ]
  };
  const n = startAllOn(ev, 1000, "Maria");
  assert.equal(n, 2);
  assert.ok(ev.liveTimers.a);
  assert.ok(!ev.liveTimers.b);
  assert.ok(ev.liveTimers.c);
});

test("startAll: skips competitors with all attempts already filled", () => {
  const ev = {
    competitors: [
      { id: "a", attempts: [null] },
      { id: "b", attempts: [11.42] }   // already finished — skip
    ]
  };
  const n = startAllOn(ev, 1000, "Maria");
  assert.equal(n, 1);
  assert.ok(ev.liveTimers.a);
  assert.ok(!ev.liveTimers.b);
});

test("startAll: pins ONE shared startedAt for everyone (eliminates reaction-time variance)", () => {
  const ev = {
    competitors: [
      { id: "a", attempts: [null] },
      { id: "b", attempts: [null] },
      { id: "c", attempts: [null] }
    ]
  };
  startAllOn(ev, 1000, "Maria");
  assert.equal(ev.liveTimers.a.startedAt, 1000);
  assert.equal(ev.liveTimers.b.startedAt, 1000);
  assert.equal(ev.liveTimers.c.startedAt, 1000);
});

test("startAll: idempotent — already-running timers aren't reset", () => {
  const ev = {
    competitors: [
      { id: "a", attempts: [null] },
      { id: "b", attempts: [null] }
    ]
  };
  startTimerOn(ev, "a", 500, "OldHelper");
  startAllOn(ev, 1000, "NewHelper");
  // 'a' kept its original 500 + OldHelper; 'b' got the new 1000 + NewHelper.
  assert.equal(ev.liveTimers.a.startedAt, 500);
  assert.equal(ev.liveTimers.a.startedBy, "OldHelper");
  assert.equal(ev.liveTimers.b.startedAt, 1000);
  assert.equal(ev.liveTimers.b.startedBy, "NewHelper");
});

// ---------- multi-helper scenario ----------

test("multi-helper: HelperA starts, HelperB stops — recorded time is server-pinned", () => {
  const ev = { competitors: [{ id: "a", attempts: [null] }] };
  // Helper A taps Start at server-time 1000. (Their network had 50ms RTT
  // to deliver the request, but the timestamp is captured locally before
  // the request, so it doesn't matter.)
  startTimerOn(ev, "a", 1000, "HelperA");
  // Helper B (different person, different network) taps Stop. Their
  // captured timestamp is server-time 13420 (12.42 sec after start).
  // Their request travels for 80ms, but again — the timestamp was already
  // captured. Server stores 12.42.
  const r = stopTimerOn(ev, "a", 13420);
  assert.equal(r.elapsedSeconds, 12.42);
  assert.equal(ev.competitors[0].attempts[0], 12.42);
});

test("multi-helper: two simultaneous Stop taps — first wins, second is no-op", () => {
  const ev = { competitors: [{ id: "a", attempts: [null] }] };
  startTimerOn(ev, "a", 1000, "HelperA");
  const first = stopTimerOn(ev, "a", 9420);   // HelperB stops first → 8.42
  const second = stopTimerOn(ev, "a", 9500);  // HelperC's later tap → no-op
  assert.equal(first.elapsedSeconds, 8.42);
  assert.equal(second.already, true);
  assert.equal(ev.competitors[0].attempts[0], 8.42);  // first wins
});
