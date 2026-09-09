// Domain-based joining: who may ask to join a school, and who may not.
//
// This is deliberately a REQUEST an admin approves, not an auto-join.
// POST /auth/signup does not verify email ownership (auth.js creates the User
// outright, and User.js has no emailVerified field), so a matching domain is a
// hint rather than proof. Auto-join would hand the full student roster — names,
// DOBs, parent emails, behaviour records — to anyone able to type an address at
// the school's domain.
//
//   node backend/behavior/tests/joinByDomain.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../routes.js"), "utf8");
const grab = (re) => src.match(re)[0].replace("export ", "");
const sandbox = [
  grab(/const PUBLIC_EMAIL_DOMAINS[\s\S]*?\]\);/),
  grab(/function emailDomain[\s\S]*?\n}/),
  grab(/export function isSchoolDomain[\s\S]*?\n}/),
  grab(/export function joinEligibility[\s\S]*?\n}/),
  "({ isSchoolDomain, joinEligibility })",
].join("\n");
const { isSchoolDomain, joinEligibility } = eval(sandbox);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a === b) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log(`  FAIL ${name}\n    got ${a}\n    exp ${b}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const school = { _id: "S1", name: "Brampton Christian School", emailDomain: "bramptoncs.org" };

console.log("\nSchool domains");
ok("a school domain qualifies", isSchoolDomain("bramptoncs.org"));
ok("subdomains qualify", isSchoolDomain("staff.bramptoncs.org"));
// A school whose originator signed up with a personal address must not offer
// domain joining — otherwise the whole internet shares that "domain".
ok("gmail does not", !isSchoolDomain("gmail.com"));
ok("icloud does not", !isSchoolDomain("icloud.com"));
ok("me.com does not", !isSchoolDomain("me.com"));
ok("outlook does not", !isSchoolDomain("outlook.com"));
ok("proton does not", !isSchoolDomain("proton.me"));
ok("case is ignored", !isSchoolDomain("GMAIL.COM"));
ok("a dotless host does not", !isSchoolDomain("localhost"));
ok("empty does not", !isSchoolDomain(""));
ok("null does not", !isSchoolDomain(null));

console.log("\nWho may request");
eq("matching domain, no membership",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school, existingMembership: null }).canRequest, true);
eq("the school is named back",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school, existingMembership: null }).schoolName,
   "Brampton Christian School");
eq("case-insensitive address",
   joinEligibility({ userEmail: "Teacher@BramptonCS.org", school, existingMembership: null }).canRequest, true);

console.log("\nWho may not");
eq("another domain", joinEligibility({ userEmail: "someone@elsewhere.com", school, existingMembership: null }).canRequest, false);
// The look-alike case: a domain that merely ends with the school's.
eq("look-alike domain",
   joinEligibility({ userEmail: "attacker@evilbramptoncs.org", school, existingMembership: null }).canRequest, false);
eq("subdomain of the school domain is not the school domain",
   joinEligibility({ userEmail: "x@mail.bramptoncs.org", school, existingMembership: null }).canRequest, false);
eq("no school on that domain",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school: null, existingMembership: null }).canRequest, false);
eq("no email", joinEligibility({ userEmail: "", school, existingMembership: null }).canRequest, false);
eq("a school on a public domain offers no joining",
   joinEligibility({ userEmail: "anyone@gmail.com",
                     school: { _id: "S2", name: "Someone's School", emailDomain: "gmail.com" },
                     existingMembership: null }).canRequest, false);
eq("already accepted",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school,
                     existingMembership: { status: "accepted" } }).canRequest, false);
eq("already accepted says so",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school,
                     existingMembership: { status: "accepted" } }).reason, "already a member");
eq("already pending cannot re-request",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school,
                     existingMembership: { status: "pending" } }).canRequest, false);
eq("already pending says so",
   joinEligibility({ userEmail: "teacher@bramptoncs.org", school,
                     existingMembership: { status: "pending" } }).reason, "already requested");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
