// Payroll → GL smoke test. Runs the REAL _payroll_gl bridge + ledger engine
// against the shared Mongo shim (or live MongoDB if MONGO_URI is set). Proves:
// the aggregated payroll JE is balanced, lands on the right control accounts,
// is idempotent (no double-post), reverses cleanly, and that a zero run posts
// nothing.
//
// Run:  node --import ./scripts/ts-resolve.mjs scripts/payroll-gl-smoke.ts
import { getTestDb, ObjectId } from "./mongo-shim.ts";
import { seedChartOfAccounts, trialBalance, accountTotals } from "../src/app/api/teebeepay/_ledger.ts";
import { postPayrollPeriod, reversePayrollPeriod } from "../src/app/api/teebeepay/_payroll_gl.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
}

// Two employees. Numbers chosen so gross = net + tax + nasfund_emp + other.
//   A: gross 2000, tax 300, nasfund_emp 120 (6%), nasfund_empr 168 (8.4%),
//      other (post-tax deduction) 80  → net = 2000-300-120-80 = 1500
//   B: gross 1000, tax 100, nasfund_emp 60,  nasfund_empr 84, other 0
//      → net = 1000-100-60 = 840
const ENTRIES = [
  { gross: 2000, tax: 300, nasfund: 120, net: 1500, calc_breakdown: { nasfund_employer: 168, post_tax_deductions: [{ name: "Union dues", amount: 80 }] } },
  { gross: 1000, tax: 100, nasfund: 60,  net: 840,  calc_breakdown: { nasfund_employer: 84 } },
];
// Expected aggregate: gross 3000, tax 400, nasfund_emp 180, nasfund_empr 252,
// net 2340, other = 3000-2340-400-180 = 80.

async function main() {
  const { db, cleanup } = await getTestDb("pngpay_payroll_gl_smoke");
  const C = new ObjectId();
  await seedChartOfAccounts(db, C);
  const acctId = async (code: string) => (await db.collection("accounts").findOne({ company_id: C, code }))._id;

  const period: any = { _id: new ObjectId(), company_id: C, period_start: "2026-02-01", period_end: "2026-02-14", pay_date: "2026-02-15" };
  await db.collection("pay_periods").insertOne(period);

  console.log("\n── Post payroll run ──");
  const je = await postPayrollPeriod(db, C, period, ENTRIES, { created_by: new ObjectId() });
  check("posts a journal entry", !!je && !!je.entry_ref, je ? je.entry_ref : "null");
  check("entry is balanced (Dr === Cr)", je.total_debit === je.total_credit, `Dr ${je.total_debit} / Cr ${je.total_credit}`);
  check("debit total = gross + employer nasfund (3252)", je.total_debit === 3252, String(je.total_debit));
  check("source tagged payroll", je.source === "payroll", je.source);

  const sumBy = async (code: string) => {
    const totals = await accountTotals(db, C);
    const id = (await acctId(code)).toString();
    return totals.get(id) || { debit: 0, credit: 0 };
  };
  console.log("\n── Control-account postings ──");
  check("6000 Salaries & Wages debited 3000", (await sumBy("6000")).debit === 3000, JSON.stringify(await sumBy("6000")));
  check("6010 Payroll Taxes debited 252 (employer nasfund)", (await sumBy("6010")).debit === 252, JSON.stringify(await sumBy("6010")));
  check("2210 PAYE/SWT Payable credited 400", (await sumBy("2210")).credit === 400, JSON.stringify(await sumBy("2210")));
  check("2220 Nasfund Payable credited 432 (180+252)", (await sumBy("2220")).credit === 432, JSON.stringify(await sumBy("2220")));
  check("2200 Wages Payable credited 2340 (net)", (await sumBy("2200")).credit === 2340, JSON.stringify(await sumBy("2200")));
  check("2230 Payroll Deductions Payable credited 80", (await sumBy("2230")).credit === 80, JSON.stringify(await sumBy("2230")));

  const tb = await trialBalance(db, C);
  check("trial balance balanced", tb.balanced, `Dr ${tb.total_debit} / Cr ${tb.total_credit}`);

  console.log("\n── Idempotency ──");
  const stamped: any = await db.collection("pay_periods").findOne({ _id: period._id });
  check("pay_period stamped with gl_entry_ref", stamped.gl_entry_ref === je.entry_ref, stamped.gl_entry_ref);
  const again = await postPayrollPeriod(db, C, stamped, ENTRIES, {});
  check("re-post returns same entry, no double-post", again && again.entry_ref === je.entry_ref, again ? again.entry_ref : "null");
  const jeCount = (await db.collection("journal_entries").find({ company_id: C }).toArray()).length;
  check("exactly one journal entry exists", jeCount === 1, String(jeCount));

  console.log("\n── Reversal ──");
  const rev = await reversePayrollPeriod(db, C, stamped, { created_by: new ObjectId() });
  check("reversal posted", !!rev && String(rev.memo).includes("Reversal"), rev ? rev.memo : "null");
  const tb2 = await trialBalance(db, C);
  check("trial balance still balanced after reversal", tb2.balanced);
  check("net wages payable back to 0", ((await sumBy("2200")).credit - (await sumBy("2200")).debit) === 0, JSON.stringify(await sumBy("2200")));
  const cleared: any = await db.collection("pay_periods").findOne({ _id: period._id });
  check("gl stamp cleared after reversal", !cleared.gl_entry_id, JSON.stringify({ gl_entry_id: cleared.gl_entry_id }));

  console.log("\n── Zero run ──");
  const emptyPeriod: any = { _id: new ObjectId(), company_id: C, period_start: "2026-03-01", period_end: "2026-03-14" };
  await db.collection("pay_periods").insertOne(emptyPeriod);
  const none = await postPayrollPeriod(db, C, emptyPeriod, [], {});
  check("zero/empty run posts nothing", none === null, String(none));

  console.log(`\n──────── ${fail === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} ────────`);
  console.log(`pass: ${pass}   fail: ${fail}`);
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
