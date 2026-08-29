// Validate every quickstart preset task against the serve-time playability gate.
import { auditPlayability } from "../../shared/taskPlayability.js";
import { QUICKSTART_TASKSETS } from "../../shared/quickstartTasksets.js";

let totalBad = 0;
for (const [key, set] of Object.entries(QUICKSTART_TASKSETS)) {
  const r = auditPlayability(set.tasks || []);
  const flag = r.notPlayable === 0 ? "✅" : "❌";
  console.log(`${flag} ${key.padEnd(34)} ${r.playable}/${r.total} playable  [${set.gradeBand} · ${set.subject}]`);
  for (const bad of r.bad) {
    const tt = set.tasks[bad.idx]?.taskType;
    console.log(`      task[${bad.idx}] ${tt}: ${bad.issues.join("; ")}`);
    totalBad++;
  }
}
console.log(`\n${totalBad === 0 ? "ALL PLAYABLE ✅" : `${totalBad} malformed task(s) ❌`}`);
process.exit(totalBad === 0 ? 0 : 1);
