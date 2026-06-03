// Loan-readiness scoring engine — deterministic, side-effect-free.
//
// Same philosophy as the GL / tax / audit engines: every ratio and the overall
// readiness score are computed in one tested place, so the dashboard, the
// detail screen and the printed financing package always agree.
//
// Given a client's summarised financials plus the facility they're seeking, we
// compute the ratios a PNG lender (BSP, Kina, Westpac, a microfinance) actually
// underwrites on — liquidity, leverage, profitability, debt-service cover and
// loan-to-value — band each against conventional thresholds, and roll them into
// a 0–100 readiness score with concrete strengths and gaps.

export type Band = "strong" | "adequate" | "weak";

function r2(n: any): number { return Math.round((Number(n) || 0) * 100) / 100; }
function num(n: any): number { const v = Number(n); return Number.isFinite(v) ? v : 0; }
function safeDiv(a: number, b: number): number | null { return b === 0 ? null : a / b; }

/* ── inputs ──────────────────────────────────────────────────────────────── */
export interface LoanInput {
  // Balance sheet
  current_assets: number;
  current_liabilities: number;
  inventory: number;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  // Income statement
  revenue: number;
  net_profit: number;
  ebitda: number;                    // proxy for cash available to service debt
  // Existing commitments
  existing_annual_debt_service: number;
  // The proposed facility
  loan_amount: number;
  interest_rate: number;             // annual %, e.g. 9.5
  term_years: number;
  collateral_value: number;
}

/* ── one scored metric ───────────────────────────────────────────────────── */
export interface Metric {
  key: string;
  label: string;
  value: number | null;             // null = not computable (missing denominator)
  display: string;                  // formatted for UI
  band: Band;
  weight: number;                   // contribution weight to the overall score
  benchmark: string;                // human description of the threshold
  higherIsBetter: boolean;
}

// Convert a value + thresholds into a band. For "higher is better" metrics,
// strong ≥ good, adequate ≥ ok, else weak. Inverted when lower is better.
function bandFor(value: number | null, good: number, ok: number, higherIsBetter: boolean): Band {
  if (value == null) return "weak";
  if (higherIsBetter) {
    if (value >= good) return "strong";
    if (value >= ok) return "adequate";
    return "weak";
  } else {
    if (value <= good) return "strong";
    if (value <= ok) return "adequate";
    return "weak";
  }
}

const BAND_SCORE: Record<Band, number> = { strong: 1, adequate: 0.6, weak: 0.2 };

/* ── amortised annual payment for the proposed facility ──────────────────── */
// Standard amortising loan: A = P·r / (1 − (1+r)^−n). Falls back to straight
// principal/term when the rate is zero.
export function annualDebtService(principal: number, annualRatePct: number, termYears: number): number {
  const P = Math.max(0, num(principal));
  const n = Math.max(1, num(termYears));
  const r = Math.max(0, num(annualRatePct)) / 100;
  if (P === 0) return 0;
  if (r === 0) return r2(P / n);
  const a = (P * r) / (1 - Math.pow(1 + r, -n));
  return r2(a);
}

/* ── result ──────────────────────────────────────────────────────────────── */
export interface ScoreResult {
  score: number;                    // 0–100
  band: "ready" | "nearly_ready" | "not_ready";
  metrics: Metric[];
  proposed_annual_debt_service: number;
  total_annual_debt_service: number;
  strengths: string[];
  gaps: string[];
}

export function scoreLoan(input: LoanInput): ScoreResult {
  const ca = num(input.current_assets);
  const cl = num(input.current_liabilities);
  const inv = num(input.inventory);
  const ta = num(input.total_assets);
  const tl = num(input.total_liabilities);
  const te = num(input.total_equity);
  const rev = num(input.revenue);
  const np = num(input.net_profit);
  const ebitda = num(input.ebitda);

  const proposed = annualDebtService(input.loan_amount, input.interest_rate, input.term_years);
  const totalDebtService = r2(num(input.existing_annual_debt_service) + proposed);
  const collateral = num(input.collateral_value);
  const loan = num(input.loan_amount);

  const currentRatio = safeDiv(ca, cl);
  const quickRatio = safeDiv(ca - inv, cl);
  const debtToEquity = safeDiv(tl, te);
  const netMargin = safeDiv(np, rev);          // fraction
  const roa = safeDiv(np, ta);                 // fraction
  const dscr = safeDiv(ebitda, totalDebtService);
  const ltv = safeDiv(loan, collateral);       // fraction

  const pct = (f: number | null) => f == null ? "—" : (f * 100).toFixed(1) + "%";
  const x = (f: number | null) => f == null ? "—" : f.toFixed(2) + "×";

  const metrics: Metric[] = [
    { key: "current_ratio", label: "Current ratio", value: currentRatio, display: x(currentRatio),
      band: bandFor(currentRatio, 1.5, 1.0, true), weight: 15, benchmark: "≥ 1.5× strong, ≥ 1.0× adequate", higherIsBetter: true },
    { key: "quick_ratio", label: "Quick ratio", value: quickRatio, display: x(quickRatio),
      band: bandFor(quickRatio, 1.0, 0.7, true), weight: 10, benchmark: "≥ 1.0× strong, ≥ 0.7× adequate", higherIsBetter: true },
    { key: "debt_to_equity", label: "Debt-to-equity", value: debtToEquity, display: x(debtToEquity),
      band: bandFor(debtToEquity, 1.0, 2.0, false), weight: 20, benchmark: "≤ 1.0× strong, ≤ 2.0× adequate", higherIsBetter: false },
    { key: "net_margin", label: "Net profit margin", value: netMargin, display: pct(netMargin),
      band: bandFor(netMargin, 0.10, 0.03, true), weight: 15, benchmark: "≥ 10% strong, ≥ 3% adequate", higherIsBetter: true },
    { key: "roa", label: "Return on assets", value: roa, display: pct(roa),
      band: bandFor(roa, 0.08, 0.02, true), weight: 10, benchmark: "≥ 8% strong, ≥ 2% adequate", higherIsBetter: true },
    { key: "dscr", label: "Debt-service cover (DSCR)", value: dscr, display: x(dscr),
      band: bandFor(dscr, 1.5, 1.2, true), weight: 20, benchmark: "≥ 1.5× strong, ≥ 1.2× adequate", higherIsBetter: true },
    { key: "ltv", label: "Loan-to-value", value: ltv, display: pct(ltv),
      band: bandFor(ltv, 0.6, 0.8, false), weight: 10, benchmark: "≤ 60% strong, ≤ 80% adequate", higherIsBetter: false },
  ];

  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0);
  const weighted = metrics.reduce((s, m) => s + m.weight * BAND_SCORE[m.band], 0);
  const score = Math.round((weighted / totalWeight) * 100);
  const band: ScoreResult["band"] = score >= 75 ? "ready" : score >= 55 ? "nearly_ready" : "not_ready";

  const strengths = metrics.filter((m) => m.band === "strong").map((m) => `${m.label}: ${m.display}`);
  const gaps = metrics.filter((m) => m.band === "weak")
    .map((m) => `${m.label} ${m.display} — needs ${m.benchmark.split(" strong")[0].replace(/^[≤≥]/, (s) => s === "≤" ? "at most " : "at least ")}`);

  return {
    score, band, metrics,
    proposed_annual_debt_service: proposed,
    total_annual_debt_service: totalDebtService,
    strengths, gaps,
  };
}

/* ── lifecycle ───────────────────────────────────────────────────────────── */
export type LoanStatus = "intake" | "assessed" | "package_ready" | "submitted";
export const LOAN_STATUSES: LoanStatus[] = ["intake", "assessed", "package_ready", "submitted"];

export const PURPOSE_OPTIONS = [
  "Working capital", "Asset / equipment finance", "Commercial property",
  "Business expansion", "Refinance existing debt", "Trade / import finance", "Other",
];

export function isLoanStatus(s: any): s is LoanStatus {
  return LOAN_STATUSES.includes(s);
}

// The documents a PNG lender expects in a complete financing package. Surfaced
// as a checklist so the accountant can tick off package readiness.
export const PACKAGE_CHECKLIST: { key: string; label: string }[] = [
  { key: "financials_3yr", label: "Audited / reviewed financials (3 years)" },
  { key: "management_accounts", label: "Year-to-date management accounts" },
  { key: "cashflow_forecast", label: "12-month cash-flow forecast" },
  { key: "bank_statements", label: "Bank statements (6 months)" },
  { key: "tax_clearance", label: "IRC tax clearance / lodgement proof" },
  { key: "business_registration", label: "IPA business registration & certificate" },
  { key: "collateral_evidence", label: "Collateral valuation / title evidence" },
  { key: "business_plan", label: "Business plan / loan purpose memo" },
];

export function packageProgress(checklist: Record<string, boolean> | null | undefined): { done: number; total: number; pct: number } {
  const total = PACKAGE_CHECKLIST.length;
  const done = PACKAGE_CHECKLIST.filter((c) => checklist?.[c.key]).length;
  return { done, total, pct: Math.round((done / total) * 100) };
}

// Serialise a stored application row into API/UI shape (scores live).
export function shapeApplication(a: any): any {
  const financials = a.financials || null;
  const result = financials ? scoreLoan(financials) : null;
  return {
    id: a._id.toString(),
    business_name: a.business_name,
    contact_name: a.contact_name || null,
    contact_email: a.contact_email || null,
    contact_phone: a.contact_phone || null,
    industry: a.industry || null,
    purpose: a.purpose || null,
    loan_amount: a.loan_amount ?? null,
    term_years: a.term_years ?? null,
    interest_rate: a.interest_rate ?? null,
    lender: a.lender || null,
    status: a.status || "intake",
    financials,
    score: result ? result.score : null,
    score_band: result ? result.band : null,
    result,
    checklist: a.checklist || {},
    package: packageProgress(a.checklist),
    notes: a.notes || null,
    ai_writeup: a.ai_writeup || null,
    assessed_by: a.assessed_by || null, assessed_at: a.assessed_at || null,
    submitted_at: a.submitted_at || null,
    created_at: a.created_at, updated_at: a.updated_at || null,
  };
}
