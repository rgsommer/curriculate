// backend/tests/test-subs-engine.mjs
//
// Self-contained test of the /subs escalation engine. No MongoDB, no
// network, no external accounts — it drives the real engine
// (services/subsEngine.js) against an in-memory store, a mock notifier,
// and a virtual clock, so the urgent (5-min) and non-urgent (multi-hour)
// timelines play out instantly.
//
//   node backend/tests/test-subs-engine.mjs
//
// Covers the spec's required happy paths:
//   1. Urgent request escalates #1 → #2 → #3 on the short interval.
//   2. Non-urgent request waits the LONG interval before escalating.
//   3. First teacher to accept wins; all further contact stops.
//   4. Decline escalates immediately (no waiting out the interval).
//   5. Running out of ranked subs marks the request exhausted.

import assert from "node:assert";
import { createEngine } from "../services/subsEngine.js";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// ── In-memory store implementing the engine's contract ────────────────
function makeStore({ rankedTeachers }) {
  let oid = 1;
  const requests = new Map();
  const offers = new Map();

  function addRequest(r) {
    const _id = `req${oid++}`;
    requests.set(_id, { _id, status: "open", currentRank: -1, ...r });
    return requests.get(_id);
  }

  const store = {
    _requests: requests,
    _offers: offers,
    addRequest,
    async getOpenRequests() {
      return [...requests.values()].filter((r) => r.status === "open");
    },
    async getRequest(id) {
      return requests.get(String(id)) || null;
    },
    async getOffersForRequest(requestId) {
      return [...offers.values()].filter((o) => String(o.requestId) === String(requestId));
    },
    async getOffer(id) {
      return offers.get(String(id)) || null;
    },
    async getTeacher(id) {
      return rankedTeachers.find((t) => String(t.teacherId) === String(id))?.teacher || null;
    },
    async getRankedTeachers() {
      return rankedTeachers.filter((t) => t.teacher.active !== false);
    },
    async getRequestContext(requestId) {
      return {
        request: requests.get(String(requestId)),
        school: { name: "Test School", adminEmails: ["admin@school.test"] },
        gradeLevel: { name: "Grade 3" },
        adminEmails: ["admin@school.test"],
      };
    },
    async createOffer(doc) {
      const _id = `off${oid++}`;
      offers.set(_id, { _id, ...doc });
      return offers.get(_id);
    },
    async updateOffer(id, patch) {
      Object.assign(offers.get(String(id)), patch);
    },
    async updateRequest(id, patch) {
      Object.assign(requests.get(String(id)), patch);
    },
  };
  return store;
}

function makeNotifier(log) {
  return {
    async sendOffer({ teacher }) {
      log.push({ type: "offer", to: teacher.email });
      return ["email"];
    },
    async notifyFilled({ teacher }) {
      log.push({ type: "filled", who: teacher?.email });
    },
    async notifyExhausted() {
      log.push({ type: "exhausted" });
    },
  };
}

const TEACHERS = [
  { teacherId: "t1", rank: 0, teacher: { _id: "t1", email: "alice@subs.test", name: "Alice", active: true, contactPrefs: { email: true } } },
  { teacherId: "t2", rank: 1, teacher: { _id: "t2", email: "bob@subs.test", name: "Bob", active: true, contactPrefs: { email: true } } },
  { teacherId: "t3", rank: 2, teacher: { _id: "t3", email: "cara@subs.test", name: "Cara", active: true, contactPrefs: { email: true } } },
];

let passed = 0;
function ok(name) {
  console.log(`  ✓ ${name}`);
  passed++;
}

// ── Test 1: urgent escalation #1 → #2 → #3 on the short interval ───────
async function testUrgentEscalation() {
  console.log("Test 1: urgent request escalates through the ranking");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN });
  await engine.onRequestCreated(req._id);

  assert.equal(log.filter((l) => l.type === "offer").length, 1, "one offer sent on creation");
  assert.equal(log[0].to, "alice@subs.test", "first offer goes to rank 0 (Alice)");
  ok("contacts preferred sub #1 immediately");

  // Before the interval elapses, a sweep must NOT escalate.
  clock = 3 * MIN;
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, 1, "no escalation before interval");
  ok("does not escalate before the 5-min interval");

  // After 5 min with no response → escalate to Bob.
  clock = 5 * MIN + 1;
  await engine.sweep();
  let sent = log.filter((l) => l.type === "offer");
  assert.equal(sent.length, 2, "escalated to #2");
  assert.equal(sent[1].to, "bob@subs.test", "second offer goes to Bob");
  ok("escalates to sub #2 after the interval");

  // After another 5 min → Cara.
  clock = 10 * MIN + 2;
  await engine.sweep();
  sent = log.filter((l) => l.type === "offer");
  assert.equal(sent.length, 3, "escalated to #3");
  assert.equal(sent[2].to, "cara@subs.test", "third offer goes to Cara");
  ok("escalates to sub #3 after the next interval");

  // Past the end of the ranking → exhausted.
  clock = 15 * MIN + 3;
  await engine.sweep();
  assert.ok(log.some((l) => l.type === "exhausted"), "exhausted notice fired");
  assert.equal((await store.getRequest(req._id)).status, "exhausted", "request marked exhausted");
  ok("marks request exhausted when ranking runs out");
}

// ── Test 2: non-urgent uses the LONG interval ─────────────────────────
async function testAdvanceInterval() {
  console.log("Test 2: non-urgent request waits the long interval");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "advance", escalationIntervalMs: 4 * HOUR });
  await engine.onRequestCreated(req._id);
  ok("contacts preferred sub #1 immediately");

  // 5 minutes in — the urgent interval — must NOT escalate.
  clock = 5 * MIN;
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, 1, "no escalation at 5 min for advance mode");
  ok("does not escalate at 5 minutes (long interval not elapsed)");

  // Just before 4h — still waiting.
  clock = 4 * HOUR - 1;
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, 1, "still waiting just before 4h");
  ok("still waiting just before the 4-hour interval");

  // Past 4h — escalate.
  clock = 4 * HOUR + 1;
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, 2, "escalated after 4h");
  ok("escalates only after the 4-hour interval");
}

// ── Test 3: first to accept wins; contacting stops ────────────────────
async function testAcceptStops() {
  console.log("Test 3: first acceptance wins and stops escalation");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN });
  await engine.onRequestCreated(req._id);

  // Escalate once so Bob also has a (the current) pending offer.
  clock = 5 * MIN + 1;
  await engine.sweep();
  const offers = await store.getOffersForRequest(req._id);
  const bobOffer = offers.find((o) => String(o.teacherId) === "t2");
  const r = await engine.accept(bobOffer);
  assert.equal(r.ok, true, "accept succeeded");

  const filled = await store.getRequest(req._id);
  assert.equal(filled.status, "filled", "request marked filled");
  assert.equal(String(filled.filledByTeacherId), "t2", "filled by Bob");
  ok("acceptance marks the request filled");

  // Further sweeps must NOT contact anyone else.
  const before = log.filter((l) => l.type === "offer").length;
  clock = 100 * MIN;
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, before, "no further offers after fill");
  ok("no further contact after acceptance");

  // A late accept on a now-expired sibling offer is rejected.
  const alice = (await store.getOffersForRequest(req._id)).find((o) => String(o.teacherId) === "t1");
  const late = await engine.accept(alice);
  assert.equal(late.ok, false, "late accept rejected");
  ok("late acceptance on a closed request is rejected");
}

// ── Test 4: decline escalates immediately ─────────────────────────────
async function testDeclineImmediate() {
  console.log("Test 4: decline escalates immediately");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN });
  await engine.onRequestCreated(req._id);

  const aliceOffer = (await store.getOffersForRequest(req._id))[0];
  // No clock advance — decline right away.
  await engine.decline(aliceOffer);
  const sent = log.filter((l) => l.type === "offer");
  assert.equal(sent.length, 2, "next offer sent immediately on decline");
  assert.equal(sent[1].to, "bob@subs.test", "escalated to Bob with no wait");
  ok("decline contacts the next sub without waiting for the interval");
}

// ── Test 5: only QUALIFIED subs are offered the job ───────────────────
async function testQualificationMatching() {
  console.log("Test 5: only qualified subs are offered (skips ineligible)");
  let clock = 0;
  const log = [];
  // Alice & Cara are certified in French; Bob is not.
  const ranked = [
    { teacherId: "t1", rank: 0, teacher: { _id: "t1", email: "alice@subs.test", name: "Alice", active: true, roleTypes: ["teacher"], qualifications: ["French"], contactPrefs: { email: true } } },
    { teacherId: "t2", rank: 1, teacher: { _id: "t2", email: "bob@subs.test", name: "Bob", active: true, roleTypes: ["teacher"], qualifications: ["HS Math"], contactPrefs: { email: true } } },
    { teacherId: "t3", rank: 2, teacher: { _id: "t3", email: "cara@subs.test", name: "Cara", active: true, roleTypes: ["teacher"], qualifications: ["French"], contactPrefs: { email: true } } },
  ];
  const store = makeStore({ rankedTeachers: ranked });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN, requiredRole: "teacher", requiredQualifications: ["French"] });

  assert.equal(await engine.countEligible(req), 2, "two qualified candidates (Alice, Cara)");
  ok("countEligible counts only qualified subs");

  await engine.onRequestCreated(req._id);
  assert.equal(log.filter((l) => l.type === "offer")[0].to, "alice@subs.test", "first offer to Alice");

  // Escalate — Bob (unqualified) must be SKIPPED, Cara offered next.
  clock = 5 * MIN + 1;
  await engine.sweep();
  const sent = log.filter((l) => l.type === "offer");
  assert.equal(sent.length, 2, "exactly two offers (Bob skipped)");
  assert.equal(sent[1].to, "cara@subs.test", "escalated past unqualified Bob to Cara");
  ok("skips the unqualified sub and offers the next qualified one");
}

// ── Test 6: zero qualified candidates is surfaced clearly ─────────────
async function testZeroEligible() {
  console.log("Test 6: zero qualified candidates → exhausted (no_eligible)");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS }); // none have "Chemistry"
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN, requiredQualifications: ["Chemistry"] });
  assert.equal(await engine.countEligible(req), 0, "no qualified candidates");

  await engine.onRequestCreated(req._id);
  assert.equal(log.filter((l) => l.type === "offer").length, 0, "no offers sent");
  const after = await store.getRequest(req._id);
  assert.equal(after.status, "exhausted", "request exhausted immediately");
  assert.equal(after.exhaustedReason, "no_eligible", "reason is no_eligible");
  ok("flags zero-qualified-candidates without contacting anyone");
}

// ── Test 7: internal-coverage fallback ────────────────────────────────
async function testInternalCoverage() {
  console.log("Test 7: internal-coverage fallback closes an unfilled request");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN, requiredQualifications: ["Chemistry"] });
  await engine.onRequestCreated(req._id); // exhausted, no_eligible

  const r = await engine.assignInternalCoverage(await store.getRequest(req._id), { internalCoverageId: "ic1" });
  assert.equal(r.ok, true, "internal coverage assigned");
  const after = await store.getRequest(req._id);
  assert.equal(after.status, "filled", "request now filled");
  assert.equal(after.coverageType, "internal", "coverageType is internal");
  assert.equal(String(after.internalCoverageId), "ic1", "internal coverage linked");
  ok("internal coverage marks the request covered internally");
}

// ── Test 8: pending-approval requests are NOT contacted until approved ─
async function testApprovalGating() {
  console.log("Test 8: teacher requests wait for approval before contacting");
  let clock = 0;
  const log = [];
  const store = makeStore({ rankedTeachers: TEACHERS });
  const engine = createEngine({ store, notifier: makeNotifier(log), now: () => clock });

  // A teacher-submitted request sits in pending_approval.
  const req = store.addRequest({ schoolId: "s1", gradeLevelId: "g1", urgency: "urgent", escalationIntervalMs: 5 * MIN, status: "pending_approval" });

  // Sweeps must ignore it (getOpenRequests only returns status "open").
  await engine.sweep();
  assert.equal(log.filter((l) => l.type === "offer").length, 0, "no contact while pending approval");
  ok("does not contact anyone while awaiting approval");

  // Principal approves → status open + fire the engine.
  await store.updateRequest(req._id, { status: "open" });
  await engine.onRequestCreated(req._id);
  assert.equal(log.filter((l) => l.type === "offer")[0]?.to, "alice@subs.test", "first offer goes out on approval");
  ok("fires the fulfillment routine once approved");
}

(async () => {
  console.log("\nsubs escalation engine — tests\n");
  await testUrgentEscalation();
  await testAdvanceInterval();
  await testAcceptStops();
  await testDeclineImmediate();
  await testQualificationMatching();
  await testZeroEligible();
  await testInternalCoverage();
  await testApprovalGating();
  console.log(`\n${passed} assertions passed ✓\n`);
})().catch((err) => {
  console.error("\n✗ TEST FAILED:", err.message);
  console.error(err.stack);
  process.exit(1);
});
