// ===========================================================================
//  PAYROLL CALCULATION ENGINE
//  ---------------------------------------------------------------------------
//  Richard: this is the file you adjust when tax/deduction rules change.
//  The function `calculate()` at the bottom is the only entry point used by
//  the rest of the app. Everything above it is data + helpers you can edit.
//
//  How the rules flow:
//    1. Each company has a tax_rules row containing a JSON blob (see
//       DEFAULT_PNG_RULES below for the shape).
//    2. The Tax Rules tab in the UI edits that JSON. Changing it does not
//       require a code deploy.
//    3. If you need a *new kind* of deduction (e.g. union dues), add a
//       handler in `applyCustomDeductions()` below.
//
//  The pay-period interval (weekly / fortnightly / monthly) is on the
//  company row. The tax brackets are quoted PER PAY PERIOD because PNG SWT
//  tables are themselves fortnightly. If you change the interval, also
//  update the bracket values OR scale them with the `bracket_interval`
//  setting.
// ===========================================================================

// --- DEFAULT RULES FOR A NEW COMPANY ---------------------------------------
// Used by scripts/seed.js when you create a company. Editable per company
// later from the Tax Rules tab.
//
// Source for default PNG SWT brackets: PNG Internal Revenue Commission
// Salary or Wages Tax tables (fortnightly, declared, single).
// These ARE approximate and change with government budgets — please confirm
// against the current IRC tables before going live, and edit in the UI.
const DEFAULT_PNG_RULES = {
  bracket_interval: 'fortnightly',
  currency: 'PGK',

  // Stamp recording when these defaults were last cross-checked against
  // primary sources. Update when you next verify and review the brackets.
  verified_at: '2026-05-17',
  source: 'PwC Worldwide Tax Summaries (last reviewed 16 June 2025) + PNG IRC SWT tables effective 1 Jan 2023. Resident brackets unchanged since 2023 Budget.',

  // ----- RESIDENT (Table A — declaration lodged) ----------------------------
  // Quoted per fortnight (PNG IRC publishes fortnightly tables):
  //   0      – 20,000  @  0%     (0          – 769.23/fn)
  //   20,001 – 33,000  @ 30%     (769.24     – 1,269.23/fn)
  //   33,001 – 70,000  @ 35%     (1,269.24   – 2,692.31/fn)
  //   70,001 – 250,000 @ 40%     (2,692.32   – 9,615.38/fn)
  //   250,001+         @ 42%     (9,615.39+/fn)
  swt_brackets: [
    { up_to:   769.23, rate: 0.00 },
    { up_to:  1269.23, rate: 0.30 },
    { up_to:  2692.31, rate: 0.35 },
    { up_to:  9615.38, rate: 0.40 },
    { up_to:    null,  rate: 0.42 },
  ],

  // ----- RESIDENT, DECLARATION NOT LODGED (Table B) -------------------------
  // No tax-free threshold; tax applied at the marginal rate from the first
  // kina earned.
  swt_brackets_no_declaration: [
    { up_to:  1269.23, rate: 0.22 },
    { up_to:  2692.31, rate: 0.35 },
    { up_to:  9615.38, rate: 0.40 },
    { up_to:    null,  rate: 0.42 },
  ],

  // ----- NON-RESIDENT (Table C) — staying <183 days in PNG ------------------
  // Annual: 0–20k @ 22, then 30/35/40/42.
  swt_brackets_non_resident: [
    { up_to:   769.23, rate: 0.22 },
    { up_to:  1269.23, rate: 0.30 },
    { up_to:  2692.31, rate: 0.35 },
    { up_to:  9615.38, rate: 0.40 },
    { up_to:    null,  rate: 0.42 },
  ],

  // ----- DEPENDANT REBATE (per legacy PNGPay spec, IRC-compliant) -----------
  // Annual formula:
  //   1 dep : Max(K45,  Min(15% × annual_tax, K450))
  //   2 dep : Max(K75,  Min(25% × annual_tax, K750))
  //   3+ dep: Max(K105, Min(35% × annual_tax, K1050))
  // The engine applies this against annualised tax, then scales back to the
  // pay-period interval. See applyDependentRebate() below.
  dependent_rebate_annual: [
    { floor:   0, pct: 0.00, ceiling:    0 }, // 0 deps
    { floor:  45, pct: 0.15, ceiling:  450 }, // 1 dep
    { floor:  75, pct: 0.25, ceiling:  750 }, // 2 deps
    { floor: 105, pct: 0.35, ceiling: 1050 }, // 3+ deps
  ],
  // Kept for legacy callers; replaced by `dependent_rebate_annual`.
  dependent_rebate_per_fortnight: [0, 17.31, 28.85, 40.38],

  // Nasfund / superannuation (employee contribution). Statutory minimum 6%.
  nasfund: {
    enabled: true,
    employee_rate: 0.06,            // deducted from gross
    employer_rate: 0.084,           // shown on stub, not deducted from net
    min_gross_for_contribution: 0,  // some funds exempt below a threshold
  },

  // Free-form extra deductions per company. Each entry is processed in order.
  // type='flat'    -> amount each period
  // type='percent' -> percent of gross
  // type='formula' -> a small expression evaluated against { gross, hours, dependents }
  custom_deductions: [
    // Example:
    // { name: 'Union dues', type: 'flat', amount: 5 },
    // { name: 'Health levy', type: 'percent', rate: 0.005 },
  ],

  // Overtime rules. Hours above `threshold` (per period) are paid at `rate` x base.
  overtime: {
    enabled: false,
    threshold_hours: 80,
    rate_multiplier: 1.5,
  },
};

// ===========================================================================
//  HELPERS
// ===========================================================================

function roundCurrency(n) {
  // PGK uses 2dp. Round half-up to avoid 0.005 silently disappearing.
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Compute base pay from salary or hourly rate (before allowances).
function computeBase(employee, hours, rules, company) {
  if (employee.pay_type === 'salary') {
    if (!hours || hours <= 0) return { base: 0, overtime: 0 };
    const periodsPerYear = periodsPerYearFor(company.pay_interval);
    const fte = (employee.fte_pct == null ? 100 : employee.fte_pct) / 100;
    const base = (employee.annual_salary / periodsPerYear) * fte;
    return { base: roundCurrency(base), overtime: 0 };
  }
  const rate = employee.hourly_rate || 0;
  let ot = 0;
  let regular = hours;
  if (rules.overtime && rules.overtime.enabled) {
    const t = rules.overtime.threshold_hours;
    if (hours > t) { ot = (hours - t) * rate * rules.overtime.rate_multiplier; regular = t; }
  }
  return { base: roundCurrency(regular * rate), overtime: roundCurrency(ot) };
}

// Sum of named standing allowances on the employee record.
// All are *taxable* — PNG IRC treats allowances as part of gross.
const ALLOWANCE_FIELDS = [
  'housing_allowance', 'vehicle_allowance', 'fuel_allowance', 'meals_allowance',
  'school_fees_allowance', 'leave_fares_allowance', 'electricity_allowance',
  'gas_allowance', 'phone_allowance', 'airfares_allowance', 'extra_allowance',
];
function sumAllowances(employee) {
  let total = 0;
  const lines = [];
  for (const f of ALLOWANCE_FIELDS) {
    const v = Number(employee[f]) || 0;
    if (v > 0) { total += v; lines.push({ name: f.replace(/_allowance$/, '').replace(/_/g, ' '), amount: roundCurrency(v) }); }
  }
  return { total: roundCurrency(total), lines };
}

// Standing per-period employee-level deductions split into pre-tax / post-tax.
function sumStandingDeductions(employee) {
  const preTax = [];
  const postTax = [];
  let preTaxTotal = 0, postTaxTotal = 0;
  function addPre(name, v)  { v = Number(v)||0; if (v>0) { preTax.push({name, amount:roundCurrency(v)}); preTaxTotal += v; } }
  function addPost(name, v) { v = Number(v)||0; if (v>0) { postTax.push({name, amount:roundCurrency(v)}); postTaxTotal += v; } }
  addPre ('Salary sacrifice', employee.salary_sacrifice);
  addPre ('NCSL voluntary',  employee.ncsl_voluntary);
  addPost('Savings',          employee.savings_deduction);
  addPost('Education',        employee.education_deduction);
  addPost('Christmas',        employee.christmas_bonus);
  addPost('Loan repayment',   employee.loan_repayment);
  return { preTax, postTax, preTaxTotal: roundCurrency(preTaxTotal), postTaxTotal: roundCurrency(postTaxTotal) };
}

function periodsPerYearFor(interval) {
  switch (interval) {
    case 'weekly':      return 52;
    case 'fortnightly': return 26;
    case 'monthly':     return 12;
    default:            return 26;
  }
}

// Progressive bracket tax on a per-period taxable amount.
function computeSwt(taxable, brackets) {
  if (taxable <= 0) return 0;
  let remaining = taxable;
  let prevCap = 0;
  let tax = 0;
  for (const b of brackets) {
    const cap = b.up_to == null ? Infinity : b.up_to;
    const band = Math.max(0, Math.min(remaining, cap - prevCap));
    tax += band * b.rate;
    remaining -= band;
    prevCap = cap;
    if (remaining <= 0) break;
  }
  return roundCurrency(tax);
}

// Dependant rebate: prefer the IRC formula
//   per-dep rebate = Max(floor, Min(pct × annual_tax, ceiling))   (annual)
// scaled back to the pay-period interval. Falls back to the flat
// fortnightly table if the formula table isn't configured.
function applyDependentRebate(tax, dependents, rules, periodsPerYear) {
  if (rules && Array.isArray(rules.dependent_rebate_annual)) {
    const idx = Math.min(Math.max(dependents || 0, 0), rules.dependent_rebate_annual.length - 1);
    const cfg = rules.dependent_rebate_annual[idx];
    const annualTax = tax * (periodsPerYear || 26);
    const annualRebate = Math.max(cfg.floor || 0, Math.min((cfg.pct || 0) * annualTax, cfg.ceiling || 0));
    const periodRebate = annualRebate / (periodsPerYear || 26);
    return Math.max(0, roundCurrency(tax - periodRebate));
  }
  // Legacy fallback (flat fortnightly table)
  const flatTable = (rules && rules.dependent_rebate_per_fortnight) || [0];
  const i = Math.min(dependents, flatTable.length - 1);
  return Math.max(0, roundCurrency(tax - (flatTable[i] || 0)));
}

// Decide which bracket table to use based on residency + declaration.
function chooseBrackets(employee, rules) {
  if (employee.residency_status === 'non_resident' && rules.swt_brackets_non_resident) {
    return rules.swt_brackets_non_resident;
  }
  if (employee.declaration_lodged === false && rules.swt_brackets_no_declaration) {
    return rules.swt_brackets_no_declaration;
  }
  return rules.swt_brackets || [];
}

function applyCustomDeductions(gross, hours, employee, rules) {
  const lines = [];
  let total = 0;
  for (const d of (rules.custom_deductions || [])) {
    let amt = 0;
    if (d.type === 'flat') amt = Number(d.amount) || 0;
    else if (d.type === 'percent') amt = gross * (Number(d.rate) || 0);
    else if (d.type === 'formula') {
      try {
        // Very small, safe expression: only +-*/ and the named vars.
        // eslint-disable-next-line no-new-func
        amt = Function('gross', 'hours', 'dependents',
          `"use strict"; return (${String(d.formula).replace(/[^0-9+\-*/().a-zA-Z_ ]/g, '')});`
        )(gross, hours, employee.dependents || 0);
        if (!isFinite(amt)) amt = 0;
      } catch { amt = 0; }
    }
    amt = roundCurrency(amt);
    total += amt;
    lines.push({ name: d.name, amount: amt });
  }
  return { total: roundCurrency(total), lines };
}

// ===========================================================================
//  PUBLIC API: calculate(...)
// ===========================================================================
// Inputs:
//   employee:  row from employees table
//   entry:     { hours, cash_advance } from payroll_entries
//   rules:     parsed JSON from tax_rules.data
//   company:   row from companies table
// Output: { gross, tax, nasfund, other_deductions, net, breakdown }
//   `breakdown` is stored verbatim on payroll_entries.calc_breakdown for audit.
function calculate(employee, entry, rules, company) {
  const hours = Number(entry.hours) || 0;
  const advance = Number(entry.cash_advance) || 0;

  const { base, overtime } = computeBase(employee, hours, rules, company);
  // Total gross = base + overtime + sum of named taxable allowances.
  // If hours==0 ("did not work"), allowances are also skipped — they're
  // contingent on working that period.
  const worked = hours > 0;
  const allowances = worked ? sumAllowances(employee) : { total: 0, lines: [] };
  const gross = roundCurrency(base + overtime + allowances.total);

  // Standing employee-level deductions (housing-loan repayments, salary
  // sacrifice, voluntary super, etc.)
  const standing = worked ? sumStandingDeductions(employee) : { preTax: [], postTax: [], preTaxTotal: 0, postTaxTotal: 0 };

  // Nasfund (statutory): mandatory rate of gross. Extra voluntary rate
  // configurable per employee via nas_extra_pct.
  let nasfundEmployee = 0, nasfundEmployer = 0;
  if (worked && rules.nasfund && rules.nasfund.enabled && gross >= (rules.nasfund.min_gross_for_contribution || 0)) {
    const mandatory = rules.nasfund.employee_rate || 0;
    const extra = (Number(employee.nas_extra_pct) || 0) / 100;
    nasfundEmployee = roundCurrency(gross * (mandatory + extra));
    nasfundEmployer = roundCurrency(gross * (rules.nasfund.employer_rate || 0));
  }

  // Taxable income = gross − pre-tax deductions − employee Nasfund.
  const taxable = Math.max(0, gross - standing.preTaxTotal - nasfundEmployee);
  const brackets = chooseBrackets(employee, rules);
  let tax = computeSwt(taxable, brackets);
  tax = applyDependentRebate(tax, employee.dependents || 0, rules,
        periodsPerYearFor(company.pay_interval));

  // Per-company custom deductions (defined in Tax Rules).
  const custom = applyCustomDeductions(gross, hours, employee, rules);

  // Net = gross − pre-tax deductions − Nasfund − tax − post-tax deductions
  //       − custom deductions − cash advance.
  const net = roundCurrency(
    gross - standing.preTaxTotal - nasfundEmployee - tax
          - standing.postTaxTotal - custom.total - advance
  );

  return {
    gross,
    tax,
    nasfund: nasfundEmployee,
    other_deductions: roundCurrency(standing.preTaxTotal + standing.postTaxTotal + custom.total + advance),
    net,
    breakdown: {
      hours,
      base,
      overtime,
      allowance_lines: allowances.lines,
      allowance_total: allowances.total,
      gross,
      pre_tax_deductions: standing.preTax,
      pre_tax_total: standing.preTaxTotal,
      taxable,
      tax,
      nasfund_employee: nasfundEmployee,
      nasfund_employer: nasfundEmployer,
      post_tax_deductions: standing.postTax,
      post_tax_total: standing.postTaxTotal,
      cash_advance: advance,
      custom_lines: custom.lines,
      net,
      rules_snapshot: rules,
    },
  };
}

module.exports = {
  DEFAULT_PNG_RULES,
  calculate,
  ALLOWANCE_FIELDS,
  // exported for tests
  _internal: { computeSwt, computeBase, applyDependentRebate, periodsPerYearFor, sumAllowances, sumStandingDeductions, chooseBrackets },
};
