// AR / invoicing smoke test. Runs the REAL _ar module + ledger engine against
// the shared Mongo shim (or live MongoDB if MONGO_URI is set). Proves: invoice
// totals + GST, issue posts a balanced DR-AR / CR-Sales / CR-GST entry, partial
// then full payment clears the receivable, void reverses an issued invoice, a
// paid invoice can't be voided, and the aging report buckets correctly.
//
// Run:  node --import ./scripts/ts-resolve.mjs scripts/ar-smoke.ts
import { getTestDb, ObjectId } from "./mongo-shim.ts";
import { seedChartOfAccounts, trialBalance, accountTotals } from "../src/app/api/teebeepay/_ledger.ts";
import { createCustomer, createInvoice, issueInvoice, recordPayment, voidInvoice, arAging, computeInvoiceTotals } from "../src/app/api/teebeepay/_ar.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? "  — " + detail : ""}`); }
}
async function expectThrow(name: string, fn: () => Promise<any>, wantSub = "") {
  try { await fn(); check(name, false, "expected throw, got success"); }
  catch (e: any) { check(name, !wantSub || String(e.message).toLowerCase().includes(wantSub.toLowerCase()), `got: ${e.message}`); }
}

async function main() {
  const { db, cleanup } = await getTestDb("pngpay_ar_smoke");
  const C = new ObjectId();
  await seedChartOfAccounts(db, C);
  const acctId = async (code: string) => (await db.collection("accounts").findOne({ company_id: C, code }))._id;
  const sumBy = async (code: string) => {
    const totals = await accountTotals(db, C);
    return totals.get((await acctId(code)).toString()) || { debit: 0, credit: 0 };
  };

  console.log("\n── Totals + GST ──");
  const t = computeInvoiceTotals([
    { description: "Consulting", quantity: 10, unit_price: 100 },           // 1000 taxable
    { description: "Disbursement (no GST)", quantity: 1, unit_price: 200, taxable: false }, // 200 exempt
  ]);
  check("subtotal 1200", t.subtotal === 1200, String(t.subtotal));
  check("GST only on taxable lines = 100", t.gst === 100, String(t.gst));
  check("total 1300", t.total === 1300, String(t.total));

  console.log("\n── Customer + draft invoice ──");
  const cust = await createCustomer(db, C, { name: "Sample Buyer Ltd", email: "buyer@example.com" });
  check("customer created", !!cust._id);
  const inv = await createInvoice(db, C, {
    customer_id: cust._id, date: "2026-02-01", due_date: "2026-03-03",
    lines: [{ description: "Services", quantity: 10, unit_price: 100 }],
  });
  check("invoice ref INV-00001", inv.invoice_ref === "INV-00001", inv.invoice_ref);
  check("invoice total 1100 (1000 + 10% GST)", inv.total === 1100, String(inv.total));
  check("starts as draft", inv.status === "draft", inv.status);
  await expectThrow("foreign customer rejected", () => createInvoice(db, C, { customer_id: new ObjectId(), lines: [{ quantity: 1, unit_price: 5 }] }), "customer not found");

  console.log("\n── Issue (posts sale) ──");
  const issued = await issueInvoice(db, C, inv._id);
  check("issue posts a JE", !!issued.entry?.entry_ref, issued.entry?.entry_ref);
  check("issue entry balanced", issued.entry.total_debit === issued.entry.total_credit, `Dr ${issued.entry.total_debit}/Cr ${issued.entry.total_credit}`);
  check("1100 AR debited 1100", (await sumBy("1100")).debit === 1100, JSON.stringify(await sumBy("1100")));
  check("4000 Sales credited 1000", (await sumBy("4000")).credit === 1000, JSON.stringify(await sumBy("4000")));
  check("2100 GST Payable credited 100", (await sumBy("2100")).credit === 100, JSON.stringify(await sumBy("2100")));
  await expectThrow("can't issue twice", () => issueInvoice(db, C, inv._id), "only a draft");

  console.log("\n── Payments (partial then full) ──");
  const p1 = await recordPayment(db, C, inv._id, { amount: 400, date: "2026-02-10" });
  check("partial payment keeps status issued", p1.status === "issued", p1.status);
  check("1010 Bank debited 400", (await sumBy("1010")).debit === 400, JSON.stringify(await sumBy("1010")));
  const p2 = await recordPayment(db, C, inv._id, { date: "2026-02-20" }); // remainder
  check("final payment flips to paid", p2.status === "paid", p2.status);
  check("AR net cleared to 0", ((await sumBy("1100")).debit - (await sumBy("1100")).credit) === 0, JSON.stringify(await sumBy("1100")));
  await expectThrow("overpayment rejected on a paid invoice", () => recordPayment(db, C, inv._id, { amount: 10 }), "only an issued");
  await expectThrow("paid invoice can't be voided", () => voidInvoice(db, C, inv._id), "credit note");

  const tb = await trialBalance(db, C);
  check("trial balance balanced", tb.balanced, `Dr ${tb.total_debit}/Cr ${tb.total_credit}`);

  console.log("\n── Void an issued (unpaid) invoice ──");
  const inv2 = await createInvoice(db, C, { customer_id: cust._id, date: "2026-02-05", lines: [{ description: "Extra", quantity: 1, unit_price: 500 }] });
  await issueInvoice(db, C, inv2._id);
  const salesAfterIssue = (await sumBy("4000")).credit;
  const v = await voidInvoice(db, C, inv2._id);
  check("void reverses the sale entry", !!v.reversed?.entry_ref, v.reversed?.entry_ref || "null");
  check("sales revenue back down after void", (await sumBy("4000")).credit < salesAfterIssue || ((await sumBy("4000")).credit - (await sumBy("4000")).debit) === 1000, JSON.stringify(await sumBy("4000")));
  const tbV = await trialBalance(db, C);
  check("trial balance still balanced after void", tbV.balanced);

  console.log("\n── Aging ──");
  // Fresh invoice due in the future → current; an overdue one → 31-60 bucket.
  const aCust = await createCustomer(db, C, { name: "Aging Co" });
  const cur = await createInvoice(db, C, { customer_id: aCust._id, date: "2026-04-01", due_date: "2026-05-30", lines: [{ quantity: 1, unit_price: 1000 }] });
  await issueInvoice(db, C, cur._id);
  const old = await createInvoice(db, C, { customer_id: aCust._id, date: "2026-02-01", due_date: "2026-02-15", lines: [{ quantity: 1, unit_price: 2000 }] });
  await issueInvoice(db, C, old._id);
  const aging = await arAging(db, C, "2026-04-01");
  check("current bucket holds the future-due invoice (1100)", aging.buckets.current === 1100, JSON.stringify(aging.buckets));
  check("overdue invoice lands in a >0 bucket", aging.buckets.d31_60 === 2200, JSON.stringify(aging.buckets));
  check("aging total = 3300", aging.total === 3300, String(aging.total));

  console.log(`\n──────── ${fail === 0 ? "ALL CHECKS PASSED" : "FAILURES PRESENT"} ────────`);
  console.log(`pass: ${pass}   fail: ${fail}`);
  await cleanup();
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(2); });
