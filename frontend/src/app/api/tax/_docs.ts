// Supporting-document checklist + filename classifier for tax returns.
// Mirrors the audit checklist/classifier pattern: each tax type asks for a
// tailored set of documents, and an uploaded file is auto-filed into the right
// slot by its name (deterministic keyword scoring — no model call).

export interface TaxDocItem { slot: string; label: string; required: boolean; formats: string; }

const PRIOR: TaxDocItem  = { slot: "prior_return",       label: "Prior-year return / IRC assessment", required: false, formats: "PDF" };
const BANK: TaxDocItem   = { slot: "bank_statements",    label: "Bank statements",                    required: false, formats: "PDF, CSV" };

const CIT_ITEMS: TaxDocItem[] = [
  { slot: "financial_statements",  label: "Financial statements (P&L, balance sheet)", required: true,  formats: "PDF, XLSX" },
  { slot: "trial_balance",         label: "Trial balance",                              required: false, formats: "XLSX, CSV" },
  { slot: "adjustments_workpaper", label: "Tax adjustments / computation workpaper",     required: false, formats: "XLSX, PDF" },
  { slot: "depreciation_schedule", label: "Fixed-asset / depreciation schedule",         required: false, formats: "XLSX, PDF" },
  { slot: "provisional_tax",       label: "Provisional tax / instalment receipts",       required: false, formats: "PDF" },
  PRIOR, BANK,
];
const INDIVIDUAL_ITEMS: TaxDocItem[] = [
  { slot: "salary_summary",     label: "Salary / wages summary (Form S, payment summary)", required: true,  formats: "PDF" },
  { slot: "other_income",       label: "Other income evidence (rent, dividends, interest)", required: false, formats: "PDF" },
  { slot: "deductions_evidence", label: "Deduction evidence (donations, etc.)",             required: false, formats: "PDF" },
  PRIOR, BANK,
];
const GST_ITEMS: TaxDocItem[] = [
  { slot: "sales_ledger",     label: "Sales ledger / output-tax workings",      required: true,  formats: "XLSX, CSV" },
  { slot: "purchases_ledger", label: "Purchases ledger / input-tax workings",   required: true,  formats: "XLSX, CSV" },
  { slot: "gst_invoices",     label: "Tax invoices (sample)",                   required: false, formats: "PDF" },
  PRIOR, BANK,
];

export function checklistForTaxType(type: string): TaxDocItem[] {
  if (type === "cit") return CIT_ITEMS;
  if (type === "individual") return INDIVIDUAL_ITEMS;
  if (type === "gst") return GST_ITEMS;
  return [PRIOR, BANK];
}

// [slot, [[keyword, weight], ...]] — specific phrases score high, short tokens low.
const SIGNALS: Array<[string, Array<[string, number]>]> = [
  ["financial_statements",  [["financial statements", 6], ["financial statement", 6], ["financials", 5], ["profit and loss", 5], ["profit & loss", 5], ["balance sheet", 4], ["income statement", 5], ["p&l", 4]]],
  ["trial_balance",         [["trial balance", 6], ["trialbalance", 6], [" tb ", 3]]],
  ["adjustments_workpaper", [["tax computation", 6], ["adjustment", 5], ["add-back", 5], ["addback", 5], ["workpaper", 4], ["work paper", 4]]],
  ["depreciation_schedule", [["depreciation", 6], ["fixed asset", 6], ["asset register", 5]]],
  ["provisional_tax",       [["provisional", 6], ["instalment", 5], ["installment", 5]]],
  ["salary_summary",        [["payment summary", 6], ["form s", 5], ["salary summary", 6], ["payg", 4], ["salary", 3], ["wages", 3]]],
  ["other_income",          [["rental income", 6], ["dividend", 5], ["interest income", 6], ["other income", 6], ["rent", 3]]],
  ["deductions_evidence",   [["donation", 5], ["deduction", 5], ["receipt", 3]]],
  ["sales_ledger",          [["sales ledger", 6], ["output tax", 6], ["sales", 3], ["revenue ledger", 5]]],
  ["purchases_ledger",      [["purchases ledger", 6], ["purchase ledger", 6], ["input tax", 6], ["expense ledger", 5], ["purchases", 3]]],
  ["gst_invoices",          [["tax invoice", 6], ["invoice", 3]]],
  ["prior_return",          [["prior year", 6], ["prior-year", 6], ["assessment", 5], ["last year", 4], ["prior return", 6]]],
  ["bank_statements",       [["bank statement", 6], ["bank stmt", 5], ["bank stmts", 5], ["bsp", 3]]],
];

export function classifyTaxSlot(filename: string, allowedSlots?: string[]): { slot: string; score: number } {
  const name = " " + String(filename || "").toLowerCase().replace(/[._\-/\\]+/g, " ").replace(/\s+/g, " ") + " ";
  const allow = allowedSlots && allowedSlots.length ? new Set(allowedSlots) : null;
  let best = { slot: "other", score: 0 };
  for (const [slot, kws] of SIGNALS) {
    if (allow && !allow.has(slot)) continue;
    let s = 0;
    for (const [kw, w] of kws) if (name.includes(kw)) s += w;
    if (s > best.score) best = { slot, score: s };
  }
  return best;
}
