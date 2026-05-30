// Audit planning engine — materiality, risk register, and working-paper program.
//
// Deterministic, side-effect-free helpers (the DB layer lives in the route
// handlers). Mirrors the philosophy of the GL engine: the numbers are computed
// in one tested place so every screen agrees.
//
// Three planning artefacts per engagement:
//   1. Materiality   — planning / performance / clearly-trivial thresholds,
//                      derived from a benchmark (revenue, total assets, PBT…).
//   2. Risk register — assertion-level risks with likelihood × impact → rating
//                      and a planned response. Seeded per audit type.
//   3. Working papers — the audit file index (lead schedules + procedures) with
//                      preparer → reviewer → partner sign-off. Seeded per type.

/* ───────────────────────────── Materiality ─────────────────────────────── */

export type BenchmarkKey =
  | "revenue" | "total_assets" | "pbt" | "gross_profit" | "total_expenses" | "net_assets";

export interface Benchmark {
  key: BenchmarkKey;
  label: string;
  // Conventional planning-materiality range for this benchmark (percent).
  pctLow: number;
  pctHigh: number;
  note: string;
}

// Classic ISA 320 benchmark ranges. A for-profit trading entity usually keys
// off revenue or PBT; an asset-heavy or not-for-profit entity off total assets.
export const BENCHMARKS: Benchmark[] = [
  { key: "pbt",            label: "Profit before tax",   pctLow: 5,   pctHigh: 10,  note: "Most common for profit-oriented entities with stable earnings." },
  { key: "revenue",       label: "Revenue / turnover",  pctLow: 0.5, pctHigh: 1,   note: "Use when profit is volatile, marginal, or break-even." },
  { key: "gross_profit",  label: "Gross profit",        pctLow: 1,   pctHigh: 2,   note: "Useful where revenue is large but margins thin." },
  { key: "total_assets",  label: "Total assets",        pctLow: 1,   pctHigh: 2,   note: "Asset-heavy entities, investment vehicles, unit trusts." },
  { key: "net_assets",    label: "Net assets / equity", pctLow: 2,   pctHigh: 5,   note: "Holding entities and funds where equity is the key measure." },
  { key: "total_expenses",label: "Total expenditure",   pctLow: 0.5, pctHigh: 1,   note: "Not-for-profits and donor-funded entities (expenditure-driven)." },
];

export function benchmarkFor(key: string): Benchmark {
  return BENCHMARKS.find((b) => b.key === key) || BENCHMARKS[0];
}

export interface MaterialityInput {
  benchmark: BenchmarkKey;
  benchmark_amount: number;   // the figure the percentage is applied to
  pct: number;                // planning-materiality % of the benchmark
  performance_pct?: number;   // performance materiality as % of planning (default 75)
  trivial_pct?: number;       // clearly-trivial threshold as % of planning (default 5)
}

export interface MaterialityResult extends MaterialityInput {
  performance_pct: number;
  trivial_pct: number;
  planning_materiality: number;
  performance_materiality: number;
  clearly_trivial: number;
  in_range: boolean;          // is pct within the benchmark's conventional band?
}

function r2(n: any): number { return Math.round((Number(n) || 0) * 100) / 100; }

export function computeMateriality(input: MaterialityInput): MaterialityResult {
  const performance_pct = input.performance_pct ?? 75;
  const trivial_pct = input.trivial_pct ?? 5;
  const amount = Number(input.benchmark_amount) || 0;
  const pct = Number(input.pct) || 0;
  const planning = r2(Math.abs(amount) * (pct / 100));
  const b = benchmarkFor(input.benchmark);
  return {
    benchmark: input.benchmark,
    benchmark_amount: r2(amount),
    pct,
    performance_pct,
    trivial_pct,
    planning_materiality: planning,
    performance_materiality: r2(planning * (performance_pct / 100)),
    clearly_trivial: r2(planning * (trivial_pct / 100)),
    in_range: pct >= b.pctLow && pct <= b.pctHigh,
  };
}

/* ───────────────────────────── Risk register ───────────────────────────── */

export interface SeedRisk {
  code: string;
  area: string;            // financial-statement area
  assertion: string;       // primary assertion at risk
  description: string;
  likelihood: 1 | 2 | 3;   // 1 low, 2 medium, 3 high
  impact: 1 | 2 | 3;
  response: string;        // planned audit response
}

// likelihood × impact → 1..9. 1-2 low, 3-4 medium, 6-9 high.
export function riskRating(likelihood: number, impact: number): "low" | "medium" | "high" {
  const s = (Number(likelihood) || 0) * (Number(impact) || 0);
  if (s >= 6) return "high";
  if (s >= 3) return "medium";
  return "low";
}

const COMMON_RISKS: SeedRisk[] = [
  { code: "REV_RECOG", area: "Revenue", assertion: "Occurrence / cut-off",
    description: "Revenue recognised in the wrong period or not occurring (ISA 240 presumed fraud risk).",
    likelihood: 3, impact: 3, response: "Cut-off testing either side of year-end; substantive analytical review of monthly revenue; test a sample to source documents." },
  { code: "MGT_OVERRIDE", area: "Journals / controls", assertion: "All",
    description: "Management override of controls via manual journals (ISA 240 presumed risk on every audit).",
    likelihood: 2, impact: 3, response: "Test journal entries — large, round, weekend, and unusual-account postings; review estimates for bias; understand significant unusual transactions." },
  { code: "GOING_CONCERN", area: "Going concern", assertion: "Presentation",
    description: "Ability to continue as a going concern for 12 months from sign-off.",
    likelihood: 2, impact: 3, response: "Obtain cash-flow forecast and assess assumptions; review post-year-end management accounts; consider net-asset and liquidity position." },
  { code: "EXPENSE_COMPLETE", area: "Expenses / payables", assertion: "Completeness",
    description: "Unrecorded liabilities and expenses (understatement to flatter the result).",
    likelihood: 2, impact: 2, response: "Search for unrecorded liabilities; review post-year-end payments; supplier statement reconciliations." },
];

const PAYROLL_RISK: SeedRisk = {
  code: "PAYROLL_COMPLIANCE", area: "Payroll / statutory", assertion: "Accuracy / compliance",
  description: "SWT and NASFund/NCSL calculated, withheld and remitted correctly and on time.",
  likelihood: 2, impact: 2, response: "Recompute SWT and NASFund on a sample; agree remittances to IRC/NASFund receipts; reconcile to TeebeePay records where available.",
};

const TYPE_RISKS: Record<string, SeedRisk[]> = {
  donor_fund: [{
    code: "DONOR_RESTRICTION", area: "Grant income", assertion: "Compliance / classification",
    description: "Grant funds spent outside the donor agreement's budget or restrictions.",
    likelihood: 2, impact: 3, response: "Agree expenditure to approved budget lines; test restricted-fund movements; confirm reporting obligations met.",
  }],
  landowner: [{
    code: "ROYALTY_DISTRIBUTION", area: "Royalty distributions", assertion: "Occurrence / accuracy",
    description: "Royalty and benefit distributions to ILGs/clans recorded inaccurately or to wrong beneficiaries.",
    likelihood: 3, impact: 3, response: "Agree distributions to directives and beneficiary register; recompute allocations; test a sample to payment evidence.",
  }],
  compliance: [],
};

export function seedRisksForType(type: string): SeedRisk[] {
  const risks = [...COMMON_RISKS];
  if (["statutory", "compliance", "tax", "donor_fund", "landowner", "other", "readiness"].includes(type)) {
    risks.push(PAYROLL_RISK);
  }
  if (TYPE_RISKS[type]) risks.push(...TYPE_RISKS[type]);
  return risks;
}

/* ─────────────────────────── Working-paper program ─────────────────────── */

export type WpStatus = "not_started" | "in_progress" | "prepared" | "reviewed" | "signed_off";
export const WP_STATUSES: WpStatus[] = ["not_started", "in_progress", "prepared", "reviewed", "signed_off"];

export interface SeedWorkpaper {
  ref: string;          // file index reference, e.g. "A", "B1"
  section: string;      // grouping
  title: string;
  procedures: string[]; // checklist of audit procedures
}

// A compact but real audit-file index: planning, then a lead schedule per major
// FSA, then completion. Refs follow the classic alphabetical filing convention.
const BASE_PROGRAM: SeedWorkpaper[] = [
  { ref: "A", section: "Planning", title: "Engagement acceptance & independence",
    procedures: ["Confirm independence and competence", "Sign engagement letter", "Assess client integrity / AML"] },
  { ref: "B", section: "Planning", title: "Risk assessment & materiality",
    procedures: ["Document understanding of the entity", "Complete risk register", "Set materiality", "Prepare audit strategy memo"] },
  { ref: "C", section: "Cash & bank", title: "Bank and cash lead schedule",
    procedures: ["Obtain bank confirmations", "Agree to reconciliations", "Test outstanding items", "Cut-off of receipts/payments"] },
  { ref: "D", section: "Receivables", title: "Trade receivables lead schedule",
    procedures: ["Aged listing agrees to GL", "Circularise / alternative procedures", "Assess provision for doubtful debts", "Sales cut-off"] },
  { ref: "E", section: "Inventory", title: "Inventory lead schedule",
    procedures: ["Attend / review stocktake", "Test costing and NRV", "Cut-off of goods in/out"] },
  { ref: "F", section: "Fixed assets", title: "PPE lead schedule",
    procedures: ["Agree register to GL", "Test additions to invoice", "Recompute depreciation", "Verify existence of a sample"] },
  { ref: "G", section: "Payables", title: "Trade payables & accruals lead schedule",
    procedures: ["Agree listing to GL", "Search for unrecorded liabilities", "Supplier statement reconciliations"] },
  { ref: "H", section: "Payroll & statutory", title: "Payroll lead schedule",
    procedures: ["Recompute gross-to-net on a sample", "Agree SWT/NASFund remittances", "Reconcile to register"] },
  { ref: "J", section: "Revenue & expenditure", title: "P&L analytical review",
    procedures: ["Month-by-month analytical review", "Investigate variances > materiality", "Test revenue cut-off"] },
  { ref: "X", section: "Completion", title: "Completion & review",
    procedures: ["Subsequent events review", "Going concern assessment", "Final analytical review", "Summary of unadjusted misstatements", "Partner review & sign-off"] },
];

const DONOR_WP: SeedWorkpaper = {
  ref: "K", section: "Grant compliance", title: "Donor fund compliance",
  procedures: ["Agree income to grant agreement", "Test expenditure to approved budget", "Confirm restricted-fund treatment", "Check donor reporting submitted"],
};
const LANDOWNER_WP: SeedWorkpaper = {
  ref: "L", section: "Distributions", title: "Royalty / benefit distributions",
  procedures: ["Agree to landowner directives", "Recompute beneficiary allocations", "Test distributions to payment evidence"],
};

export function seedWorkpapersForType(type: string): SeedWorkpaper[] {
  const program = [...BASE_PROGRAM];
  if (type === "donor_fund") program.splice(program.length - 1, 0, DONOR_WP);
  if (type === "landowner") program.splice(program.length - 1, 0, LANDOWNER_WP);
  if (type === "compliance" || type === "tax") {
    // Lighter scope — drop inventory/receivables-heavy schedules.
    return program.filter((w) => !["D", "E", "F"].includes(w.ref));
  }
  return program;
}
