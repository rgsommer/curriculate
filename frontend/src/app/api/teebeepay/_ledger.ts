// General Ledger engine — the double-entry spine of the accounting platform.
//
// Ported from the original Express build (pngpay/src/ledger.js) into the
// Next.js / TeebeePay data layer. Every financial event ultimately posts a
// balanced *journal entry* (total debits === total credits) into the
// `journal_entries` collection. Account balances and every report (Trial
// Balance, Balance Sheet, Income Statement) are *derived* from posted entries —
// nothing is stored twice.
//
// Multi-tenant: every document carries `company_id`. Money is plain numbers
// rounded to 2dp via round2() at each boundary so float dust never unbalances
// an entry.
import type { Db } from "mongodb";
import { ObjectId } from "./_auth";

function oid(v: string | ObjectId): ObjectId {
  return v instanceof ObjectId ? v : new ObjectId(String(v));
}

// A 'reversed' entry is still a real posted entry — its reversal offsets it, so
// BOTH must be counted (you never delete in double-entry, you post an
// offsetting entry). Only 'draft' entries are excluded from balances.
export const LEDGER_STATUSES = ["posted", "reversed"];

export function round2(n: any): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

// asset/expense increase with a DEBIT; liability/equity/revenue with a CREDIT.
// Contra accounts flip this and carry an explicit normal_balance in the seed.
export function defaultNormalBalance(type: string): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

type CoaSeed = {
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  system?: boolean;
  contra?: boolean;
  normal_balance?: "debit" | "credit";
};

// Default Chart of Accounts seeded for every company. Classic SME numbering:
// 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx revenue, 5xxx COGS,
// 6xxx operating expenses. system:true → structural control account (cannot be
// deleted). contra:true → balance sits on the opposite side of its type.
export const DEFAULT_COA: CoaSeed[] = [
  // Assets
  { code: "1000", name: "Cash on Hand", type: "asset", subtype: "cash" },
  { code: "1010", name: "Bank — Operating", type: "asset", subtype: "bank" },
  { code: "1100", name: "Accounts Receivable", type: "asset", subtype: "accounts_receivable", system: true },
  { code: "1200", name: "Inventory", type: "asset", subtype: "inventory" },
  { code: "1400", name: "Prepaid Expenses", type: "asset", subtype: "current_asset" },
  { code: "1500", name: "Equipment", type: "asset", subtype: "fixed_asset" },
  { code: "1510", name: "Furniture & Fixtures", type: "asset", subtype: "fixed_asset" },
  { code: "1590", name: "Accumulated Depreciation", type: "asset", subtype: "fixed_asset", contra: true, normal_balance: "credit" },

  // Liabilities
  { code: "2000", name: "Accounts Payable", type: "liability", subtype: "accounts_payable", system: true },
  { code: "2100", name: "GST/VAT Payable", type: "liability", subtype: "tax" },
  { code: "2200", name: "Wages Payable", type: "liability", subtype: "current_liability" },
  { code: "2210", name: "PAYE / SWT Payable", type: "liability", subtype: "tax" },
  { code: "2220", name: "Nasfund Payable", type: "liability", subtype: "tax" },
  { code: "2300", name: "Credit Card", type: "liability", subtype: "current_liability" },
  { code: "2500", name: "Loans Payable", type: "liability", subtype: "long_term_liability" },

  // Equity
  { code: "3000", name: "Owner's Capital", type: "equity", subtype: "equity" },
  { code: "3100", name: "Owner's Drawings", type: "equity", subtype: "equity", contra: true, normal_balance: "debit" },
  { code: "3900", name: "Retained Earnings", type: "equity", subtype: "retained_earnings", system: true },

  // Revenue
  { code: "4000", name: "Sales Revenue", type: "revenue", subtype: "income" },
  { code: "4100", name: "Service Revenue", type: "revenue", subtype: "income" },
  { code: "4900", name: "Other Income", type: "revenue", subtype: "other_income" },

  // Cost of goods sold
  { code: "5000", name: "Cost of Goods Sold", type: "expense", subtype: "cogs" },

  // Operating expenses
  { code: "6000", name: "Salaries & Wages", type: "expense", subtype: "expense" },
  { code: "6010", name: "Payroll Taxes", type: "expense", subtype: "expense" },
  { code: "6100", name: "Rent", type: "expense", subtype: "expense" },
  { code: "6200", name: "Utilities", type: "expense", subtype: "expense" },
  { code: "6300", name: "Office Supplies", type: "expense", subtype: "expense" },
  { code: "6400", name: "Bank Fees", type: "expense", subtype: "expense" },
  { code: "6500", name: "Depreciation Expense", type: "expense", subtype: "expense" },
  { code: "6600", name: "Marketing & Advertising", type: "expense", subtype: "expense" },
  { code: "6900", name: "Miscellaneous Expense", type: "expense", subtype: "expense" },
];

// Find an account by code for a company, creating it if absent. Posting modules
// (payroll, AR…) use this so a journal can always resolve its control accounts
// even if the company's chart was customised.
export async function ensureAccount(
  db: Db,
  companyId: string | ObjectId,
  { code, name, type, subtype = null, system = true }: { code: string; name: string; type: AccountType; subtype?: string | null; system?: boolean },
) {
  const cid = oid(companyId);
  const found = await db.collection("accounts").findOne({ company_id: cid, code });
  if (found) return found;
  const doc: any = {
    company_id: cid, code, name, type, subtype,
    normal_balance: defaultNormalBalance(type),
    contra: false, is_system: !!system, is_active: true,
    description: null, created_at: new Date(),
  };
  try {
    const r = await db.collection("accounts").insertOne(doc);
    doc._id = r.insertedId;
    return doc;
  } catch {
    // Lost a race on the unique (company_id, code) index — re-read.
    return db.collection("accounts").findOne({ company_id: cid, code });
  }
}

// Seed the default chart of accounts for a company (idempotent — skips codes
// that already exist). Returns the number of accounts inserted.
export async function seedChartOfAccounts(db: Db, companyId: string | ObjectId): Promise<number> {
  const cid = oid(companyId);
  const existing = await db.collection("accounts").find({ company_id: cid }).project({ code: 1 }).toArray();
  const have = new Set(existing.map((a: any) => a.code));
  const docs = DEFAULT_COA.filter((a) => !have.has(a.code)).map((a) => ({
    company_id: cid,
    code: a.code,
    name: a.name,
    type: a.type,
    subtype: a.subtype || null,
    normal_balance: a.normal_balance || defaultNormalBalance(a.type),
    contra: !!a.contra,
    is_system: !!a.system,
    is_active: true,
    description: null,
    created_at: new Date(),
  }));
  if (docs.length) await db.collection("accounts").insertMany(docs);
  return docs.length;
}

export type RawLine = {
  account_id?: string | ObjectId | null;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  debit?: any;
  credit?: any;
};

export type ValidationResult = {
  ok: boolean;
  errors: string[];
  total_debit: number;
  total_credit: number;
  lines: any[];
};

// A valid entry has >= 2 non-empty lines, every line is debit XOR credit, and
// debits === credits.
export function validateEntry(rawLines: RawLine[]): ValidationResult {
  const errors: string[] = [];
  const lines = (rawLines || [])
    .map((l) => ({
      account_id: l.account_id ? String(l.account_id) : null,
      account_code: l.account_code || null,
      account_name: l.account_name || null,
      description: (l.description || "").trim() || null,
      debit: round2(l.debit),
      credit: round2(l.credit),
    }))
    .filter((l) => l.account_id && (l.debit !== 0 || l.credit !== 0));

  if (lines.length < 2) errors.push("A journal entry needs at least two lines.");

  lines.forEach((l, i) => {
    if (l.debit < 0 || l.credit < 0) errors.push(`Line ${i + 1}: amounts cannot be negative.`);
    if (l.debit > 0 && l.credit > 0) errors.push(`Line ${i + 1}: a line is either a debit or a credit, not both.`);
  });

  const total_debit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const total_credit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (total_debit !== total_credit) {
    errors.push(`Entry is out of balance: debits ${total_debit.toFixed(2)} ≠ credits ${total_credit.toFixed(2)}.`);
  }
  if (total_debit === 0) errors.push("Entry total is zero.");

  return { ok: errors.length === 0, errors, total_debit, total_credit, lines };
}

// Per-company sequential entry number (JE-00001, …) via a counters doc.
export async function nextEntryNo(db: Db, companyId: string | ObjectId): Promise<number> {
  const cid = oid(companyId);
  const res: any = await db.collection("gl_counters").findOneAndUpdate(
    { company_id: cid, name: "journal_entry" },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" },
  );
  return (res && (res.value ? res.value.seq : res.seq)) || 1;
}

// Post a journal entry. Validates, resolves each line's account_id to its
// code/name (and verifies tenant ownership), stamps a sequential entry number.
export async function postJournalEntry(
  db: Db,
  companyId: string | ObjectId,
  { date, memo, reference, source = "manual", lines, created_by, reverses = null }:
    { date?: string; memo?: string; reference?: string; source?: string; lines: RawLine[]; created_by?: string | ObjectId | null; reverses?: string | ObjectId | null },
) {
  const cid = oid(companyId);
  const v = validateEntry(lines);
  if (!v.ok) { const e: any = new Error(v.errors.join(" ")); e.validation = v.errors; throw e; }

  // Enrich lines with account code/name and verify each account belongs to this
  // company (tenant isolation — never trust an account_id from a form).
  const ids = Array.from(new Set(v.lines.map((l) => l.account_id))).map(oid).filter(Boolean);
  const accts = await db.collection("accounts").find({ _id: { $in: ids }, company_id: cid }).toArray();
  const byId = new Map(accts.map((a: any) => [a._id.toString(), a]));
  for (const l of v.lines) {
    const a: any = byId.get(l.account_id as string);
    if (!a) throw new Error("A selected account does not belong to this company.");
    l.account_id = a._id;
    l.account_code = a.code;
    l.account_name = a.name;
  }

  const seq = await nextEntryNo(db, cid);
  const now = new Date();
  const doc: any = {
    company_id: cid,
    entry_no: seq,
    entry_ref: "JE-" + String(seq).padStart(5, "0"),
    date: date || now.toISOString().slice(0, 10),
    memo: (memo || "").trim() || null,
    reference: (reference || "").trim() || null,
    source,
    status: "posted",
    lines: v.lines,
    total_debit: v.total_debit,
    total_credit: v.total_credit,
    reverses: reverses ? oid(reverses) : null,
    reversed_by: null,
    created_by: created_by ? oid(created_by) : null,
    created_at: now,
    posted_at: now,
  };
  const r = await db.collection("journal_entries").insertOne(doc);
  doc._id = r.insertedId;
  return doc;
}

// Reverse a posted entry: post a mirror entry (debits/credits swapped) and link
// the two. Guarded by reversed_by so an entry can't be reversed twice.
export async function reverseJournalEntry(
  db: Db,
  companyId: string | ObjectId,
  entryId: string | ObjectId,
  { date, created_by }: { date?: string; created_by?: string | ObjectId | null } = {},
) {
  const cid = oid(companyId);
  const orig: any = await db.collection("journal_entries").findOne({ _id: oid(entryId), company_id: cid });
  if (!orig) throw new Error("Entry not found.");
  if (orig.status !== "posted") throw new Error("Only posted entries can be reversed.");
  if (orig.reversed_by) throw new Error("This entry has already been reversed.");

  const swapped = orig.lines.map((l: any) => ({
    account_id: l.account_id,
    description: l.description,
    debit: l.credit,
    credit: l.debit,
  }));
  const rev = await postJournalEntry(db, cid, {
    date: date || new Date().toISOString().slice(0, 10),
    memo: `Reversal of ${orig.entry_ref}` + (orig.memo ? ` — ${orig.memo}` : ""),
    reference: orig.reference,
    source: orig.source,
    lines: swapped,
    created_by,
    reverses: orig._id,
  });
  await db.collection("journal_entries").updateOne(
    { _id: orig._id },
    { $set: { status: "reversed", reversed_by: rev._id } },
  );
  return rev;
}

// Aggregate all posted (+ reversed) journal lines into per-account debit/credit
// totals, optionally bounded by date. Returns a Map keyed by account_id string.
export async function accountTotals(
  db: Db,
  companyId: string | ObjectId,
  { from = null, asOf = null }: { from?: string | null; asOf?: string | null } = {},
): Promise<Map<string, { debit: number; credit: number }>> {
  const cid = oid(companyId);
  const match: any = { company_id: cid, status: { $in: LEDGER_STATUSES } };
  if (from || asOf) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (asOf) match.date.$lte = asOf;
  }
  const rows = await db.collection("journal_entries").aggregate([
    { $match: match },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.account_id", debit: { $sum: "$lines.debit" }, credit: { $sum: "$lines.credit" } } },
  ]).toArray();
  const map = new Map<string, { debit: number; credit: number }>();
  for (const r of rows as any[]) {
    map.set(r._id.toString(), { debit: round2(r.debit), credit: round2(r.credit) });
  }
  return map;
}

export function naturalBalance(account: any, totals?: { debit: number; credit: number }): number {
  const d = totals ? totals.debit : 0;
  const c = totals ? totals.credit : 0;
  return account.normal_balance === "debit" ? round2(d - c) : round2(c - d);
}

// A contra account (Accumulated Depreciation, Owner's Drawings, Sales Returns…)
// sits on the opposite side of its parent section, so its contribution to a
// section subtotal — and its displayed amount — is negated. Reports must use
// this, NOT naturalBalance(), when rolling accounts into assets/liabilities/
// equity/revenue/expense totals, or the balance sheet won't balance.
export function signedBalance(account: any, totals?: { debit: number; credit: number }): number {
  const nb = naturalBalance(account, totals);
  return account.contra ? round2(-nb) : nb;
}

// Trial balance: every account with activity, in debit-column / credit-column form.
export async function trialBalance(db: Db, companyId: string | ObjectId, asOf: string | null = null) {
  const cid = oid(companyId);
  const accounts = await db.collection("accounts").find({ company_id: cid }).sort({ code: 1 }).toArray();
  const totals = await accountTotals(db, cid, { asOf });
  const rows: any[] = [];
  let td = 0, tc = 0;
  for (const a of accounts as any[]) {
    const t = totals.get(a._id.toString());
    if (!t) continue; // omit accounts with no activity
    const net = round2(t.debit - t.credit);
    const debit = net > 0 ? net : 0;
    const credit = net < 0 ? -net : 0;
    if (debit === 0 && credit === 0) continue;
    rows.push({ id: a._id.toString(), code: a.code, name: a.name, type: a.type, debit, credit });
    td = round2(td + debit); tc = round2(tc + credit);
  }
  return { rows, total_debit: td, total_credit: tc, balanced: td === tc };
}

// Income statement for a date range: grouped revenue / COGS / expenses + net income.
export async function incomeStatement(db: Db, companyId: string | ObjectId, from: string, to: string) {
  const cid = oid(companyId);
  const accounts = await db.collection("accounts")
    .find({ company_id: cid, type: { $in: ["revenue", "expense"] } }).sort({ code: 1 }).toArray();
  const totals = await accountTotals(db, cid, { from, asOf: to });

  const revenue: any[] = [], cogs: any[] = [], expenses: any[] = [];
  let totalRevenue = 0, totalCogs = 0, totalExpense = 0;
  for (const a of accounts as any[]) {
    const bal = signedBalance(a, totals.get(a._id.toString()));
    if (bal === 0) continue;
    const row = { code: a.code, name: a.name, amount: bal };
    if (a.type === "revenue") { revenue.push(row); totalRevenue = round2(totalRevenue + bal); }
    else if (a.subtype === "cogs") { cogs.push(row); totalCogs = round2(totalCogs + bal); }
    else { expenses.push(row); totalExpense = round2(totalExpense + bal); }
  }
  const grossProfit = round2(totalRevenue - totalCogs);
  const netIncome = round2(grossProfit - totalExpense);
  return { from, to, revenue, cogs, expenses, totalRevenue, totalCogs, grossProfit, totalExpense, netIncome };
}

// Balance sheet as of a date. Equity carries a derived "Current Earnings" line
// (revenue − expenses to date) so Assets == Liabilities + Equity holds even
// before a period close folds earnings into Retained Earnings.
export async function balanceSheet(db: Db, companyId: string | ObjectId, asOf: string) {
  const cid = oid(companyId);
  const accounts = await db.collection("accounts").find({ company_id: cid }).sort({ code: 1 }).toArray();
  const totals = await accountTotals(db, cid, { asOf });

  const assets: any[] = [], liabilities: any[] = [], equity: any[] = [];
  let totalAssets = 0, totalLiabilities = 0, totalEquity = 0;
  let earnings = 0;

  for (const a of accounts as any[]) {
    const bal = signedBalance(a, totals.get(a._id.toString()));
    if (a.type === "asset") { if (bal !== 0) { assets.push({ code: a.code, name: a.name, amount: bal }); totalAssets = round2(totalAssets + bal); } }
    else if (a.type === "liability") { if (bal !== 0) { liabilities.push({ code: a.code, name: a.name, amount: bal }); totalLiabilities = round2(totalLiabilities + bal); } }
    else if (a.type === "equity") { if (bal !== 0) { equity.push({ code: a.code, name: a.name, amount: bal }); totalEquity = round2(totalEquity + bal); } }
    else if (a.type === "revenue") { earnings = round2(earnings + bal); }
    else if (a.type === "expense") { earnings = round2(earnings - bal); }
  }
  equity.push({ code: "", name: "Current Earnings (undistributed)", amount: earnings, derived: true });
  totalEquity = round2(totalEquity + earnings);

  const totalLiabEquity = round2(totalLiabilities + totalEquity);
  return {
    asOf, assets, liabilities, equity,
    totalAssets, totalLiabilities, totalEquity, totalLiabEquity,
    balanced: totalAssets === totalLiabEquity,
    difference: round2(totalAssets - totalLiabEquity),
  };
}
