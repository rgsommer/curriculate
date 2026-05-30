// PNG tax computation engine — deterministic, side-effect-free.
//
// Mirrors the philosophy of the GL and audit-planning engines: every figure is
// computed in one tested place so every screen (and the printed return) agrees.
//
// Covers the three returns a PNG SME firm files most often:
//   1. Company Income Tax (CIT) — accounting profit → tax adjustments →
//      taxable income → tax @ company rate → less credits → payable/refund.
//   2. Individual Income Tax    — salary/business income through the resident
//      marginal brackets (the same scale that drives fortnightly SWT).
//   3. GST return               — output tax less input tax → net GST.
//
// Rates are PNG IRC statutory rates. Kept as named constants so a rate change
// is a one-line edit, never scattered through the UI.

export type TaxType = "cit" | "individual" | "gst";

export const COMPANY_RATE_RESIDENT = 0.30;     // resident company
export const COMPANY_RATE_NONRESIDENT = 0.48;  // non-resident company branch
export const GST_RATE = 0.10;

export function companyRate(resident: boolean): number {
  return resident ? COMPANY_RATE_RESIDENT : COMPANY_RATE_NONRESIDENT;
}

function r2(n: any): number { return Math.round((Number(n) || 0) * 100) / 100; }
function clampPos(n: any): number { const v = Number(n) || 0; return v > 0 ? v : 0; }

/* ─────────────────────────── Resident individual scale ─────────────────────
   PNG resident individual annual marginal rates (K). The fortnightly SWT
   tables are this same scale ÷ 26, so the annual computation here is the
   single source of truth. */
export interface Bracket { upTo: number | null; rate: number; }
export const INDIVIDUAL_BRACKETS: Bracket[] = [
  { upTo: 12_500,  rate: 0.00 },
  { upTo: 20_000,  rate: 0.22 },
  { upTo: 33_000,  rate: 0.30 },
  { upTo: 70_000,  rate: 0.35 },
  { upTo: 250_000, rate: 0.40 },
  { upTo: null,    rate: 0.42 },
];

export interface IndividualResult {
  taxable_income: number;
  tax: number;
  bands: { from: number; to: number | null; rate: number; taxed: number; tax: number }[];
  average_rate: number;   // tax / taxable, as a fraction
  marginal_rate: number;  // rate of the top band the income reaches
}

export function computeIndividualTax(taxableIncome: number): IndividualResult {
  const taxable = clampPos(taxableIncome);
  let lower = 0;
  let tax = 0;
  let marginal = 0;
  const bands: IndividualResult["bands"] = [];
  for (const b of INDIVIDUAL_BRACKETS) {
    const ceiling = b.upTo == null ? Infinity : b.upTo;
    if (taxable <= lower) break;
    const taxedHere = Math.min(taxable, ceiling) - lower;
    const taxHere = taxedHere * b.rate;
    if (taxedHere > 0) {
      bands.push({ from: lower, to: b.upTo, rate: b.rate, taxed: r2(taxedHere), tax: r2(taxHere) });
      tax += taxHere;
      marginal = b.rate;
    }
    lower = ceiling;
    if (taxable <= ceiling) break;
  }
  return {
    taxable_income: r2(taxable),
    tax: r2(tax),
    bands,
    average_rate: taxable > 0 ? r2((tax / taxable) * 100) / 100 : 0,
    marginal_rate: marginal,
  };
}

/* ───────────────────────────── Company income tax ──────────────────────────
   A CIT computation is accounting profit reconciled to taxable income:
     accounting profit
       + non-deductible items (accounting depreciation, entertainment,
         fines/penalties, donations over the cap, accounting provisions…)
       − further deductions (tax depreciation, prior-year losses utilised…)
     = taxable income
     × company rate
       − credits (provisional tax instalments, foreign tax credit, dividend
         WHT credits)
     = tax payable / (refundable) */

export type AdjustmentKind = "add_back" | "deduction";
export interface Adjustment {
  label: string;
  amount: number;
  kind: AdjustmentKind;
}

// The add-backs / deductions a PNG SME return almost always touches. The UI
// offers these as one-click rows so a preparer starts from a real checklist
// rather than a blank table.
export const STANDARD_ADJUSTMENTS: { label: string; kind: AdjustmentKind; hint: string }[] = [
  { label: "Accounting depreciation (added back)", kind: "add_back", hint: "Book depreciation is non-deductible; tax depreciation is claimed separately." },
  { label: "Entertainment (non-deductible)",        kind: "add_back", hint: "Client entertainment is non-deductible under the Income Tax Act." },
  { label: "Fines & penalties",                     kind: "add_back", hint: "Statutory fines and penalties are never deductible." },
  { label: "Donations over the allowable cap",      kind: "add_back", hint: "Only gifts to approved bodies within the cap are deductible." },
  { label: "Accounting provisions (general)",       kind: "add_back", hint: "General/unspecific provisions are added back until incurred." },
  { label: "Tax depreciation (capital allowance)",  kind: "deduction", hint: "Diminishing-value / prime-cost allowance per the depreciation schedule." },
  { label: "Prior-year tax losses utilised",        kind: "deduction", hint: "Carried-forward losses applied against this year's income." },
];

export type CreditKind = "provisional" | "foreign" | "dividend_wht" | "other";
export interface TaxCredit {
  label: string;
  amount: number;
  kind: CreditKind;
}

export interface CitInput {
  accounting_profit: number;
  resident?: boolean;            // default true → 30%
  adjustments?: Adjustment[];
  credits?: TaxCredit[];
}

export interface CitResult {
  accounting_profit: number;
  resident: boolean;
  rate: number;
  total_add_backs: number;
  total_deductions: number;
  taxable_income: number;        // floored at 0
  gross_tax: number;
  total_credits: number;
  tax_payable: number;           // positive = owed to IRC
  refund_due: number;            // positive = refundable to taxpayer
  adjustments: Adjustment[];
  credits: TaxCredit[];
}

export function computeCIT(input: CitInput): CitResult {
  const resident = input.resident !== false;
  const rate = companyRate(resident);
  const adjustments = (input.adjustments || []).map((a) => ({
    label: String(a.label || "").trim() || "Adjustment",
    amount: r2(Math.abs(Number(a.amount) || 0)),
    kind: a.kind === "deduction" ? "deduction" as const : "add_back" as const,
  }));
  const credits = (input.credits || []).map((c) => ({
    label: String(c.label || "").trim() || "Credit",
    amount: r2(Math.abs(Number(c.amount) || 0)),
    kind: (["provisional", "foreign", "dividend_wht", "other"].includes(c.kind) ? c.kind : "other") as CreditKind,
  }));

  const total_add_backs = r2(adjustments.filter((a) => a.kind === "add_back").reduce((s, a) => s + a.amount, 0));
  const total_deductions = r2(adjustments.filter((a) => a.kind === "deduction").reduce((s, a) => s + a.amount, 0));
  const profit = Number(input.accounting_profit) || 0;
  const taxable_income = r2(Math.max(0, profit + total_add_backs - total_deductions));
  const gross_tax = r2(taxable_income * rate);
  const total_credits = r2(credits.reduce((s, c) => s + c.amount, 0));
  const net = r2(gross_tax - total_credits);

  return {
    accounting_profit: r2(profit),
    resident, rate,
    total_add_backs, total_deductions,
    taxable_income, gross_tax, total_credits,
    tax_payable: net > 0 ? net : 0,
    refund_due: net < 0 ? r2(-net) : 0,
    adjustments, credits,
  };
}

/* ─────────────────────────────────── GST ───────────────────────────────────
   Output tax (on taxable sales) less input tax (on creditable purchases).
   Positive net = remit to IRC; negative = refund/carry-forward credit. */
export interface GstInput {
  taxable_sales: number;       // GST-exclusive value of standard-rated sales
  output_tax?: number;         // override; otherwise sales × 10%
  creditable_purchases: number;
  input_tax?: number;          // override; otherwise purchases × 10%
}
export interface GstResult {
  taxable_sales: number;
  output_tax: number;
  creditable_purchases: number;
  input_tax: number;
  net_gst: number;             // positive = payable
  refund_due: number;          // positive = refundable
}
export function computeGST(input: GstInput): GstResult {
  const sales = clampPos(input.taxable_sales);
  const purchases = clampPos(input.creditable_purchases);
  const output = input.output_tax != null ? r2(input.output_tax) : r2(sales * GST_RATE);
  const inputTax = input.input_tax != null ? r2(input.input_tax) : r2(purchases * GST_RATE);
  const net = r2(output - inputTax);
  return {
    taxable_sales: r2(sales),
    output_tax: output,
    creditable_purchases: r2(purchases),
    input_tax: inputTax,
    net_gst: net > 0 ? net : 0,
    refund_due: net < 0 ? r2(-net) : 0,
  };
}

/* ─────────────────────────── Return-record helpers ─────────────────────────
   Workflow + lifecycle shared by every return type, mirroring the audit
   working-paper sign-off ladder: draft → prepared → reviewed → filed. */
export type ReturnStatus = "draft" | "prepared" | "reviewed" | "filed";
export const RETURN_STATUSES: ReturnStatus[] = ["draft", "prepared", "reviewed", "filed"];

export const TAX_TYPE_LABELS: Record<TaxType, string> = {
  cit: "Company Income Tax",
  individual: "Individual Income Tax",
  gst: "GST return",
};

export function isTaxType(s: any): s is TaxType {
  return s === "cit" || s === "individual" || s === "gst";
}

// Recompute a return's result from whatever inputs are stored on it.
export function computeReturn(type: TaxType, inputs: any): any {
  if (type === "cit") return computeCIT(inputs || {});
  if (type === "individual") return computeIndividualTax(Number(inputs?.taxable_income) || 0);
  return computeGST(inputs || { taxable_sales: 0, creditable_purchases: 0 });
}

// Serialise a stored return row into the API/UI shape (computes result live).
export function shapeReturn(r: any): any {
  const type: TaxType = r.tax_type;
  return {
    id: r._id.toString(),
    taxpayer_name: r.taxpayer_name,
    tin: r.tin || null,
    tax_type: type,
    type_label: TAX_TYPE_LABELS[type] || type,
    period: r.period || null,
    fy_end: r.fy_end || null,
    status: r.status || "draft",
    prepared_by: r.prepared_by || null, prepared_at: r.prepared_at || null,
    reviewed_by: r.reviewed_by || null, reviewed_at: r.reviewed_at || null,
    filed_by: r.filed_by || null, filed_at: r.filed_at || null,
    irc_reference: r.irc_reference || null,
    notes: r.notes || null,
    inputs: r.inputs || null,
    result: r.inputs ? computeReturn(type, r.inputs) : null,
    created_at: r.created_at, updated_at: r.updated_at || null,
  };
}
