// Payroll → General Ledger bridge.
//
// When a pay period is approved we post ONE balanced journal entry that books
// the whole run into the ledger. Per employee the calc gives us: gross, the
// employee tax (PAYE/SWT), nasfund employee + employer, net, and everything
// else withheld (pre-tax + post-tax deductions + cash advance), all of which
// already satisfy:
//
//   gross = net + tax + nasfund_employee + other_deductions
//
// so the aggregated journal is:
//
//   DR 6000 Salaries & Wages        Σ gross
//   DR 6010 Payroll Taxes           Σ nasfund_employer        (employer super cost)
//      CR 2210 PAYE / SWT Payable          Σ tax
//      CR 2220 Nasfund Payable             Σ (nasfund_emp + nasfund_empr)
//      CR 2200 Wages Payable               Σ net
//      CR 2230 Payroll Deductions Payable  Σ other_deductions
//
// Debits (gross + nasfund_employer) === credits, by the identity above, so the
// entry is balanced by construction for any set of entries.
import type { Db } from "mongodb";
import { ObjectId } from "./_auth";
import { ensureAccount, postJournalEntry, reverseJournalEntry, round2 } from "./_ledger";

function num(v: any): number {
  return Number(v) || 0;
}

// Reduce the period's payroll_entries into the six control-account totals.
function summarisePayroll(entries: any[]) {
  let gross = 0, tax = 0, nasfundEmployee = 0, nasfundEmployer = 0, net = 0;
  for (const e of entries) {
    gross += num(e.gross);
    tax += num(e.tax);
    nasfundEmployee += num(e.nasfund);
    nasfundEmployer += num(e.calc_breakdown?.nasfund_employer);
    net += num(e.net);
  }
  gross = round2(gross);
  tax = round2(tax);
  nasfundEmployee = round2(nasfundEmployee);
  nasfundEmployer = round2(nasfundEmployer);
  net = round2(net);
  // Everything withheld that isn't tax or nasfund-employee (pre/post-tax
  // deductions + cash advances). Derived so the entry always balances.
  const otherDeductions = round2(gross - net - tax - nasfundEmployee);
  return { gross, tax, nasfundEmployee, nasfundEmployer, net, otherDeductions };
}

// Post the approved pay period into the GL. Idempotent: if the period already
// carries a gl_entry_id we return that entry untouched. Returns the posted
// (or pre-existing) journal entry, or null when there's nothing to post.
export async function postPayrollPeriod(
  db: Db,
  companyId: string | ObjectId,
  period: any,
  entries: any[],
  { created_by }: { created_by?: string | ObjectId | null } = {},
): Promise<any | null> {
  if (period?.gl_entry_id) {
    return db.collection("journal_entries").findOne({ _id: period.gl_entry_id });
  }
  const t = summarisePayroll(entries || []);
  if (t.gross === 0) return null; // empty / zero run — nothing to book

  // Resolve the control accounts (creating any the company's chart is missing).
  const [salaries, payrollTax, payePayable, nasfundPayable, wagesPayable, deductionsPayable] = await Promise.all([
    ensureAccount(db, companyId, { code: "6000", name: "Salaries & Wages", type: "expense", subtype: "expense" }),
    ensureAccount(db, companyId, { code: "6010", name: "Payroll Taxes", type: "expense", subtype: "expense" }),
    ensureAccount(db, companyId, { code: "2210", name: "PAYE / SWT Payable", type: "liability", subtype: "tax" }),
    ensureAccount(db, companyId, { code: "2220", name: "Nasfund Payable", type: "liability", subtype: "tax" }),
    ensureAccount(db, companyId, { code: "2200", name: "Wages Payable", type: "liability", subtype: "current_liability" }),
    ensureAccount(db, companyId, { code: "2230", name: "Payroll Deductions Payable", type: "liability", subtype: "current_liability" }),
  ]);

  const lines: any[] = [
    { account_id: salaries!._id, description: "Gross wages", debit: t.gross, credit: 0 },
  ];
  if (t.nasfundEmployer > 0) lines.push({ account_id: payrollTax!._id, description: "Employer nasfund", debit: t.nasfundEmployer, credit: 0 });
  if (t.tax > 0) lines.push({ account_id: payePayable!._id, description: "PAYE / SWT withheld", debit: 0, credit: t.tax });
  if (t.nasfundEmployee + t.nasfundEmployer > 0) lines.push({ account_id: nasfundPayable!._id, description: "Nasfund payable", debit: 0, credit: round2(t.nasfundEmployee + t.nasfundEmployer) });
  if (t.net > 0) lines.push({ account_id: wagesPayable!._id, description: "Net pay", debit: 0, credit: t.net });
  if (t.otherDeductions > 0) lines.push({ account_id: deductionsPayable!._id, description: "Other payroll deductions", debit: 0, credit: t.otherDeductions });

  const periodLabel = period.period_start && period.period_end
    ? `${period.period_start} → ${period.period_end}`
    : String(period._id);
  const entry = await postJournalEntry(db, companyId, {
    date: period.pay_date || period.period_end || undefined,
    memo: `Payroll ${periodLabel}`,
    reference: `PAYRUN-${String(period._id)}`,
    source: "payroll",
    lines,
    created_by: created_by ?? null,
  });

  await db.collection("pay_periods").updateOne(
    { _id: period._id },
    { $set: { gl_entry_id: entry._id, gl_entry_ref: entry.entry_ref, gl_posted_at: new Date() } },
  );
  return entry;
}

// Reverse a previously-posted payroll period (e.g. an approval was undone).
// Clears the stamp so the period can be re-posted cleanly. Returns the reversal
// entry, or null when the period was never posted.
export async function reversePayrollPeriod(
  db: Db,
  companyId: string | ObjectId,
  period: any,
  { created_by }: { created_by?: string | ObjectId | null } = {},
): Promise<any | null> {
  if (!period?.gl_entry_id) return null;
  const rev = await reverseJournalEntry(db, companyId, period.gl_entry_id, { created_by });
  await db.collection("pay_periods").updateOne(
    { _id: period._id },
    { $set: { gl_reversed_at: new Date() }, $unset: { gl_entry_id: "", gl_entry_ref: "", gl_posted_at: "" } },
  );
  return rev;
}
