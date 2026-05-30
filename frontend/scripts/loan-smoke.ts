// Loan-scoring smoke test — verifies the deterministic readiness engine.
// Run: node --import ./scripts/ts-resolve.mjs scripts/loan-smoke.ts
import { scoreLoan, annualDebtService, packageProgress, PACKAGE_CHECKLIST } from "../src/app/api/loans/_scoring.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: any) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  (got ${JSON.stringify(got)})` : ""}`); }
}
const near = (a: number, b: number, t = 0.01) => Math.abs(a - b) < t;
const m = (r: any, k: string) => r.metrics.find((x: any) => x.key === k);

console.log("annualDebtService");
{
  // K100,000 @ 0% over 5y → 20,000/yr straight-line.
  check("zero-rate = principal/term", annualDebtService(100_000, 0, 5) === 20_000, annualDebtService(100_000, 0, 5));
  // K100,000 @ 10% over 5y → ~26,379.75/yr.
  check("amortised 100k@10%/5y ≈ 26,379.75", near(annualDebtService(100_000, 10, 5), 26_379.75, 1), annualDebtService(100_000, 10, 5));
  check("zero principal → 0", annualDebtService(0, 10, 5) === 0);
}

console.log("scoreLoan — strong borrower");
{
  const r = scoreLoan({
    current_assets: 300_000, current_liabilities: 150_000, inventory: 50_000,
    total_assets: 1_000_000, total_liabilities: 400_000, total_equity: 600_000,
    revenue: 800_000, net_profit: 120_000, ebitda: 250_000,
    existing_annual_debt_service: 20_000,
    loan_amount: 300_000, interest_rate: 10, term_years: 5, collateral_value: 600_000,
  });
  check("current ratio = 2.0× strong", near(m(r, "current_ratio").value, 2.0) && m(r, "current_ratio").band === "strong", m(r, "current_ratio"));
  check("quick ratio ≈ 1.67× strong", near(m(r, "quick_ratio").value, 1.6667, 0.01) && m(r, "quick_ratio").band === "strong");
  check("debt-to-equity ≈ 0.67× strong", near(m(r, "debt_to_equity").value, 0.6667, 0.01) && m(r, "debt_to_equity").band === "strong");
  check("net margin = 15% strong", near(m(r, "net_margin").value, 0.15) && m(r, "net_margin").band === "strong");
  check("LTV = 50% strong", near(m(r, "ltv").value, 0.5) && m(r, "ltv").band === "strong");
  // total debt service = 20,000 + amortised(300k@10%/5y ≈ 79,139) ≈ 99,139; DSCR = 250k/99,139 ≈ 2.52×
  check("DSCR ≈ 2.52× strong", near(m(r, "dscr").value, 2.52, 0.05) && m(r, "dscr").band === "strong", m(r, "dscr"));
  check("score high → loan-ready", r.score >= 75 && r.band === "ready", r.score);
  check("has strengths, no gaps", r.strengths.length > 0 && r.gaps.length === 0, r.gaps);
}

console.log("scoreLoan — weak borrower");
{
  const r = scoreLoan({
    current_assets: 80_000, current_liabilities: 120_000, inventory: 60_000,
    total_assets: 400_000, total_liabilities: 360_000, total_equity: 40_000,
    revenue: 500_000, net_profit: 5_000, ebitda: 30_000,
    existing_annual_debt_service: 40_000,
    loan_amount: 300_000, interest_rate: 12, term_years: 4, collateral_value: 250_000,
  });
  check("current ratio < 1 weak", m(r, "current_ratio").band === "weak", m(r, "current_ratio").value);
  check("debt-to-equity high weak", m(r, "debt_to_equity").band === "weak", m(r, "debt_to_equity").value);
  check("LTV > 80% weak", m(r, "ltv").band === "weak", m(r, "ltv").value);
  check("DSCR < 1.2 weak", m(r, "dscr").band === "weak", m(r, "dscr").value);
  check("score low → not ready", r.score < 55 && r.band === "not_ready", r.score);
  check("has gaps listed", r.gaps.length > 0, r.gaps.length);
}

console.log("scoreLoan — guards");
{
  // Zero denominators must not throw and band as weak (value null).
  const r = scoreLoan({
    current_assets: 0, current_liabilities: 0, inventory: 0,
    total_assets: 0, total_liabilities: 0, total_equity: 0,
    revenue: 0, net_profit: 0, ebitda: 0, existing_annual_debt_service: 0,
    loan_amount: 100_000, interest_rate: 10, term_years: 5, collateral_value: 0,
  });
  check("all-zero → no throw, score defined", typeof r.score === "number");
  check("null-denominator metrics band weak", m(r, "current_ratio").value === null && m(r, "current_ratio").band === "weak");
  check("score is 0–100", r.score >= 0 && r.score <= 100, r.score);
}

console.log("packageProgress");
{
  const empty = packageProgress({});
  check("empty checklist 0%", empty.done === 0 && empty.pct === 0);
  const full = {}; for (const c of PACKAGE_CHECKLIST) (full as any)[c.key] = true;
  const all = packageProgress(full);
  check("full checklist 100%", all.done === PACKAGE_CHECKLIST.length && all.pct === 100);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
