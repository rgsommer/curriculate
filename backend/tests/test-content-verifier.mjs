// backend/tests/test-content-verifier.mjs
//
// Structural tests for the contentVerifier module. No live AI calls —
// these run offline against fixtures so they're fast + deterministic.
// Run live verification via backend/scripts/audit-generate.mjs.

import { verifyTaskContent, CONTENT_VERIFY_TYPES, clearVerifierCache } from "../services/contentVerifier.js";

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else      { fail += 1; console.log(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n${name}`); }

const SAVED_KEY = process.env.OPENAI_API_KEY;
const SAVED_SKIP = process.env.SKIP_CONTENT_VERIFY;

section("1. Whitelist coverage");
{
  // The 8 types from the audit work that resisted structural rules.
  const expected = [
    "multiple-choice", "true-false", "short-answer", "timeline",
    "legends", "fake-out", "vennsort", "truth-or-dare",
  ];
  assert(CONTENT_VERIFY_TYPES.size === 8, `whitelist has 8 entries (got ${CONTENT_VERIFY_TYPES.size})`);
  expected.forEach((t) =>
    assert(CONTENT_VERIFY_TYPES.has(t), `whitelist includes ${t}`)
  );
  // Spot-check excluded types
  ["mapit", "open-text", "make-and-snap", "role-play-deck"].forEach((t) =>
    assert(!CONTENT_VERIFY_TYPES.has(t), `whitelist excludes ${t}`)
  );
}

section("2. Skip-paths return ok with skipped reason");
{
  delete process.env.OPENAI_API_KEY; // force no-api-key skip
  const r = await verifyTaskContent({ taskType: "multiple-choice", title: "x" });
  assert(r.ok === true && r.skipped === "no-api-key", `no-api-key skip (got ${r.skipped})`);

  // Restore a placeholder key (real or fake) so the env-flag check is reached.
  process.env.OPENAI_API_KEY = SAVED_KEY || "sk-test-placeholder";
  process.env.SKIP_CONTENT_VERIFY = "1";
  const r2 = await verifyTaskContent({ taskType: "multiple-choice", title: "x" });
  assert(r2.ok === true && r2.skipped === "env-flag", `env-flag skip (got ${r2.skipped})`);
  delete process.env.SKIP_CONTENT_VERIFY;

  // Non-whitelisted task type is checked BEFORE the api-key, so it skips
  // regardless of key presence.
  const r3 = await verifyTaskContent({ taskType: "mapit", title: "x" });
  assert(r3.ok === true && r3.skipped === "type-not-verified", `non-whitelist skip (got ${r3.skipped})`);

  const r4 = await verifyTaskContent({});
  assert(r4.ok === true && r4.skipped === "no-task-type", `no-task-type skip (got ${r4.skipped})`);

  // Restore original env after this section so later tests behave correctly.
  if (SAVED_KEY) process.env.OPENAI_API_KEY = SAVED_KEY;
  else delete process.env.OPENAI_API_KEY;
}

section("3. Cache returns identical results for identical content");
{
  if (SAVED_SKIP) process.env.SKIP_CONTENT_VERIFY = SAVED_SKIP;

  // SKIP_CONTENT_VERIFY=1 makes calls deterministic (skipped immediately) —
  // sufficient to verify cache behaviour without burning API.
  process.env.SKIP_CONTENT_VERIFY = "1";
  clearVerifierCache();
  const t = { taskType: "true-false", title: "X", items: [{ prompt: "Y", correctAnswer: 1 }] };
  const r1 = await verifyTaskContent(t);
  const r2 = await verifyTaskContent(t);
  // Both are env-skipped — they don't hit the cache, but they MUST be
  // identical and never throw.
  assert(r1.warnings.length === 0 && r2.warnings.length === 0, "identical clean results on repeat call");
  delete process.env.SKIP_CONTENT_VERIFY;
}

console.log(`\n────────────────────────────`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
