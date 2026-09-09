// Which school a user acts under when they belong to more than one.
//
// The unique index on BehaviorTeacher is {schoolId, userId}, so multiple
// memberships are allowed. loadMembership used a bare findOne({userId}), which
// returns an arbitrary row — a teacher could land in their own empty school
// while colleagues saw the imported roster, and it could differ per request.
//
//   node backend/behavior/tests/chooseMembership.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../routes.js"), "utf8");
const chooseMembership = eval(
  "(" + src.match(/export function chooseMembership[\s\S]*?\n}/)[0].replace("export ", "") + ")"
);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n    got ${a}\n    exp ${b}`); }
};
const m = (id, status, schoolId, updatedAt) => ({ _id: id, status, schoolId, updatedAt });

eq("no memberships", chooseMembership([]), null);
eq("null safe", chooseMembership(null), null);
eq("single passes through", chooseMembership([m("a", "accepted", "S1", "2026-01-01")])._id, "a");

// The case that prompted this: a teacher ran /setup, creating their own school,
// then accepted an invite to the real one.
eq("accepted beats pending",
   chooseMembership([m("own", "pending", "S_OWN", "2026-05-01"),
                     m("real", "accepted", "S_REAL", "2026-01-01")])._id, "real");
eq("most recent among accepted",
   chooseMembership([m("old", "accepted", "S1", "2026-01-01"),
                     m("new", "accepted", "S2", "2026-06-01")])._id, "new");

// Determinism matters more than which row wins: the old bug was that the
// answer could change between requests.
eq("stable when timestamps tie",
   chooseMembership([m("b", "accepted", "S2", "2026-01-01"),
                     m("a", "accepted", "S1", "2026-01-01")])._id, "a");
eq("input order does not change the answer",
   chooseMembership([m("a", "accepted", "S1", "2026-01-01"), m("b", "accepted", "S2", "2026-01-01")])._id,
   chooseMembership([m("b", "accepted", "S2", "2026-01-01"), m("a", "accepted", "S1", "2026-01-01")])._id);
eq("missing timestamps do not throw",
   chooseMembership([m("a", "accepted", "S1", undefined), m("b", "accepted", "S2", undefined)])._id, "a");
eq("nulls are filtered", chooseMembership([null, m("a", "accepted", "S1", "2026-01-01")])._id, "a");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
