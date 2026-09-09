// The emailed code that proves a join requester can read the mailbox.
//
// Without it, a student could sign up as a real teacher who has not joined yet
// (jsmith@school.org), ask to join, and an admin would see a plausible name in
// the approval list with nothing contradicting it. Signup does not verify email
// ownership, so this is the only proof in the chain.
//
//   node backend/behavior/tests/joinCode.test.mjs

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../routes.js"), "utf8");
const grab = (re) => src.match(re)[0].replace("export ", "");
const { generateJoinCode, hashJoinCode, checkJoinCode } = eval([
  grab(/const JOIN_CODE_TTL_MS[\s\S]*?;/),
  grab(/const JOIN_CODE_MAX_ATTEMPTS[\s\S]*?;/),
  grab(/export function generateJoinCode[\s\S]*?\n}/),
  grab(/export function hashJoinCode[\s\S]*?\n}/),
  grab(/export function checkJoinCode[\s\S]*?\n}/),
  "({ generateJoinCode, hashJoinCode, checkJoinCode })",
].join("\n"));

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n    got ${a}\n    exp ${b}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);

const USER = "u123";
const soon = () => new Date(Date.now() + 10 * 60 * 1000);
const challengeFor = (code, over = {}) => ({
  userId: USER, codeHash: hashJoinCode(code, USER), attempts: 0, expiresAt: soon(), ...over,
});

console.log("\nCode generation");
const codes = Array.from({ length: 200 }, generateJoinCode);
ok("always six digits", codes.every((c) => /^\d{6}$/.test(c)));
ok("leading zeros are kept", codes.every((c) => c.length === 6));
ok("not all identical", new Set(codes).size > 100);

console.log("\nHashing");
ok("the raw code is not stored", hashJoinCode("123456", USER) !== "123456");
eq("stable for the same user", hashJoinCode("123456", USER), hashJoinCode("123456", USER));
// Binding to the user means a hash lifted from another row is useless.
ok("bound to the user", hashJoinCode("123456", "other") !== hashJoinCode("123456", USER));
ok("different codes differ", hashJoinCode("123456", USER) !== hashJoinCode("123457", USER));

console.log("\nAccepting a code");
eq("the right code passes", checkJoinCode(challengeFor("123456"), "123456").ok, true);
eq("surrounding spaces are tolerated", checkJoinCode(challengeFor("123456"), " 123456 ").ok, true);
eq("a wrong code fails", checkJoinCode(challengeFor("123456"), "000000").ok, false);
eq("and says so", checkJoinCode(challengeFor("123456"), "000000").reason, "that code is not right");

console.log("\nRefusing a code");
eq("no challenge", checkJoinCode(null, "123456").ok, false);
eq("expired", checkJoinCode(challengeFor("123456", { expiresAt: new Date(Date.now() - 1000) }), "123456").ok, false);
ok("expired is flagged", checkJoinCode(challengeFor("123456", { expiresAt: new Date(Date.now() - 1000) }), "123456").expired);
// A 6-digit code is only 10^6 wide; unlimited guesses would be brute-forceable.
eq("attempts exhausted", checkJoinCode(challengeFor("123456", { attempts: 5 }), "123456").ok, false);
ok("exhausted is flagged", checkJoinCode(challengeFor("123456", { attempts: 5 }), "123456").exhausted);
eq("one guess left still works", checkJoinCode(challengeFor("123456", { attempts: 4 }), "123456").ok, true);
// Expiry and the ceiling are checked BEFORE the comparison, so a correct code
// cannot rescue a dead challenge.
eq("a correct code cannot revive an expired challenge",
   checkJoinCode(challengeFor("123456", { expiresAt: new Date(Date.now() - 1) }), "123456").ok, false);

console.log("\nMalformed input");
for (const bad of ["", "12345", "1234567", "abcdef", "12345a", null, undefined, "123 456"]) {
  eq(`rejects ${JSON.stringify(bad)}`, checkJoinCode(challengeFor("123456"), bad).ok, false);
}
eq("a hash of the wrong length does not throw",
   checkJoinCode({ ...challengeFor("123456"), codeHash: "short" }, "123456").ok, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
