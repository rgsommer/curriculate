// One-time index setup for the TeebeePay / accounting collections.
//
// Every list query in these routes is `find({ company_id })` (and the payroll
// join is `find({ pay_period_id })`). Without these indexes each one is a full
// collection scan — fine for a single demo company, a cliff once a firm has a
// real book of clients. ensureIndexes() is called fire-and-forget from db() and
// guarded by a global promise so it runs at most once per warm process;
// createIndex is idempotent so cold starts just re-confirm what already exists.
import type { Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _teebepayIndexesEnsured: Promise<void> | undefined;
}

// [collection, keys, options]. allSettled below means one failure (e.g. a
// unique build hitting legacy duplicate data) never blocks the others.
const SPECS: Array<[string, Record<string, 1 | -1>, Record<string, unknown>?]> = [
  // Ledger
  ["accounts", { company_id: 1, code: 1 }, { unique: true }],
  ["gl_counters", { company_id: 1, name: 1 }, { unique: true }],
  ["journal_entries", { company_id: 1, entry_no: -1 }],
  // Accounts receivable
  ["ar_invoices", { company_id: 1, status: 1 }],
  ["ar_invoices", { company_id: 1, invoice_no: -1 }],
  ["ar_customers", { company_id: 1, created_at: -1 }],
  // Payroll / company
  ["pay_periods", { company_id: 1 }],
  ["payroll_entries", { pay_period_id: 1 }],
  ["employees", { company_id: 1 }],
  ["divisions", { company_id: 1, name: 1 }],
  ["users", { email: 1 }],
];

export function ensureIndexes(database: Db): void {
  if (global._teebepayIndexesEnsured) return;
  global._teebepayIndexesEnsured = (async () => {
    const results = await Promise.allSettled(
      SPECS.map(([coll, keys, opts]) => database.collection(coll).createIndex(keys as any, opts as any)),
    );
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length) {
      console.warn(`[teebeepay] ensureIndexes: ${failed.length}/${SPECS.length} index(es) not built:`,
        failed.map((f: any) => f.reason?.message || f.reason));
    }
  })().catch((e) => {
    // Don't poison the guard — let a later request retry the whole batch.
    global._teebepayIndexesEnsured = undefined;
    console.warn("[teebeepay] ensureIndexes failed:", e);
  });
}
