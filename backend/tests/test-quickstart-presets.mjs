// backend/tests/test-quickstart-presets.mjs
//
// Validate every Quick Start preset's tasks pass the same pipeline a
// teacher-generated taskset goes through:
//   sanitizeTaskShapeByType → normalizeTaskByType → validateTaskByType
//   → assessTaskPlayability
// A preset that fails here would brick the onboarding flow at launch
// time — exactly the experience the Quick Start is supposed to avoid.

import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import {
  normalizeTaskByType,
  validateTaskByType,
} from "../validators/taskValidators.js";
import { assessTaskPlayability } from "../../shared/taskPlayability.js";
import { QUICKSTART_TASKSETS } from "../../shared/quickstartTasksets.js";

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else      { fail += 1; console.log(`  ✗ ${label}`); }
}
function section(name) { console.log(`\n${name}`); }

section("1. Preset metadata shape");
{
  const presets = Object.values(QUICKSTART_TASKSETS);
  assert(presets.length >= 4, `at least 4 presets (got ${presets.length})`);
  presets.forEach((p) => {
    assert(typeof p.key === "string" && p.key.trim().length > 0, `${p.title}: key`);
    assert(typeof p.title === "string" && p.title.trim().length > 0, `${p.key}: title`);
    assert(typeof p.subject === "string" && p.subject.trim().length > 0, `${p.key}: subject`);
    assert(["K-2", "3-5", "6-8", "9-12"].includes(p.gradeBand), `${p.key}: gradeBand valid`);
    assert(Number.isInteger(p.gradeLevel) && p.gradeLevel >= 0 && p.gradeLevel <= 12, `${p.key}: gradeLevel 0-12`);
    assert(Array.isArray(p.tasks) && p.tasks.length === 8, `${p.key}: exactly 8 tasks (got ${(p.tasks || []).length})`);
  });
}

section("2. Every task runs through the pipeline");
{
  for (const p of Object.values(QUICKSTART_TASKSETS)) {
    console.log(`\n  preset: ${p.key}`);
    p.tasks.forEach((t, i) => {
      const type = t.taskType;
      const label = `${p.key} task[${i}] (${type})`;
      let s, n, v, pl;
      try {
        s = sanitizeTaskShapeByType(type, JSON.parse(JSON.stringify(t)));
        n = normalizeTaskByType(type, s);
        v = validateTaskByType(type, n);
        pl = assessTaskPlayability(n);
      } catch (err) {
        fail += 1;
        console.log(`  ✗ ${label}: pipeline THREW — ${err?.message?.slice(0, 120)}`);
        return;
      }
      const vOk = v?.ok === true;
      const pOk = pl?.playable === true;
      if (vOk && pOk) {
        pass += 1;
        console.log(`  ✓ ${label}: validates + playable`);
      } else {
        fail += 1;
        const reason = vOk
          ? `playability: ${(pl.issues || []).join("; ").slice(0, 140)}`
          : `validate: ${(v.errors || []).join("; ").slice(0, 140)}`;
      console.log(`  ✗ ${label}: ${reason}`);
      }
    });
  }
}

section("3. Each grade band has at least one preset");
{
  const bands = new Set(Object.values(QUICKSTART_TASKSETS).map((p) => p.gradeBand));
  ["K-2", "3-5", "6-8", "9-12"].forEach((b) =>
    assert(bands.has(b), `grade band ${b} has a preset`)
  );
}

console.log(`\n────────────────────────────`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
