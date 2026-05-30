// Tax-engine smoke test — verifies the deterministic PNG computations.
// Run: node --import ./scripts/ts-resolve.mjs scripts/tax-smoke.ts
import {
  computeCIT, computeIndividualTax, computeGST, companyRate,
} from "../src/app/api/tax/_engine.ts";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, got?: any) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${got !== undefined ? `  (got ${JSON.stringify(got)})` : ""}`); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

console.log("Company income tax");
{
  // Profit 100,000; add back 20,000 depreciation; deduct 12,000 tax depreciation.
  // Taxable = 108,000; tax @30% = 32,400; less 10,000 provisional = 22,400 payable.
  const r = computeCIT({
    accounting_profit: 100_000,
    adjustments: [
      { label: "Acct depreciation", amount: 20_000, kind: "add_back" },
      { label: "Tax depreciation", amount: 12_000, kind: "deduction" },
    ],
    credits: [{ label: "Provisional", amount: 10_000, kind: "provisional" }],
  });
  check("taxable income = 108,000", near(r.taxable_income, 108_000), r.taxable_income);
  check("gross tax = 32,400", near(r.gross_tax, 32_400), r.gross_tax);
  check("tax payable = 22,400", near(r.tax_payable, 22_400), r.tax_payable);
  check("no refund", r.refund_due === 0, r.refund_due);
  check("resident rate 30%", r.rate === 0.30, r.rate);
}
{
  // Loss-making: profit -50,000, no adjustments → taxable floored at 0, no tax.
  const r = computeCIT({ accounting_profit: -50_000 });
  check("loss → taxable floored at 0", r.taxable_income === 0, r.taxable_income);
  check("loss → no tax", r.gross_tax === 0 && r.tax_payable === 0, r);
}
{
  // Credits exceed tax → refund.
  const r = computeCIT({ accounting_profit: 10_000, credits: [{ label: "Prov", amount: 5_000, kind: "provisional" }] });
  // tax = 3,000; credit 5,000 → refund 2,000.
  check("over-credit → refund 2,000", near(r.refund_due, 2_000), r.refund_due);
  check("over-credit → payable 0", r.tax_payable === 0, r.tax_payable);
}
{
  const r = computeCIT({ accounting_profit: 100_000, resident: false });
  check("non-resident rate 48%", r.rate === 0.48, r.rate);
  check("non-resident tax = 48,000", near(r.gross_tax, 48_000), r.gross_tax);
}

console.log("Individual income tax (resident scale)");
{
  // Exactly at the tax-free ceiling.
  check("K12,500 → 0 tax", computeIndividualTax(12_500).tax === 0);
  // K20,000: (20,000-12,500)*22% = 1,650.
  check("K20,000 → 1,650", near(computeIndividualTax(20_000).tax, 1_650), computeIndividualTax(20_000).tax);
  // K33,000: 1,650 + (33,000-20,000)*30% = 1,650 + 3,900 = 5,550.
  check("K33,000 → 5,550", near(computeIndividualTax(33_000).tax, 5_550), computeIndividualTax(33_000).tax);
  // K70,000: 5,550 + (70,000-33,000)*35% = 5,550 + 12,950 = 18,500.
  check("K70,000 → 18,500", near(computeIndividualTax(70_000).tax, 18_500), computeIndividualTax(70_000).tax);
  // K100,000: 18,500 + (100,000-70,000)*40% = 18,500 + 12,000 = 30,500.
  check("K100,000 → 30,500", near(computeIndividualTax(100_000).tax, 30_500), computeIndividualTax(100_000).tax);
  // K300,000: 18,500 + (250,000-70,000)*40% + (300,000-250,000)*42%
  //         = 18,500 + 72,000 + 21,000 = 111,500.
  check("K300,000 → 111,500", near(computeIndividualTax(300_000).tax, 111_500), computeIndividualTax(300_000).tax);
  check("marginal rate at K300k = 42%", computeIndividualTax(300_000).marginal_rate === 0.42);
  check("negative income → 0", computeIndividualTax(-100).tax === 0);
}

console.log("GST");
{
  // Sales 200,000 → output 20,000; purchases 80,000 → input 8,000; net 12,000.
  const r = computeGST({ taxable_sales: 200_000, creditable_purchases: 80_000 });
  check("output tax = 20,000", near(r.output_tax, 20_000), r.output_tax);
  check("input tax = 8,000", near(r.input_tax, 8_000), r.input_tax);
  check("net GST = 12,000 payable", near(r.net_gst, 12_000) && r.refund_due === 0, r);
  // Input-heavy period → refund.
  const r2 = computeGST({ taxable_sales: 50_000, creditable_purchases: 90_000 });
  check("input > output → refund 4,000", near(r2.refund_due, 4_000) && r2.net_gst === 0, r2);
}

console.log("companyRate helper");
check("resident → 0.30", companyRate(true) === 0.30);
check("non-resident → 0.48", companyRate(false) === 0.48);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
