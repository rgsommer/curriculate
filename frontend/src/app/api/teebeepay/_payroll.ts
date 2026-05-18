// frontend/src/app/api/teebeepay/_payroll.ts
//
// Server-side payroll calculation engine. Mirrors the logic from pngpay/
// (which is the spec) but lives natively in the Next.js API surface so
// every approval recomputes consistently.
function r2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function periodsPerYear(interval: string) {
  return interval === "weekly" ? 52 : interval === "monthly" ? 12 : 26;
}

const ALLOWANCES = [
  "housing_allowance", "vehicle_allowance", "fuel_allowance", "meals_allowance",
  "school_fees_allowance", "leave_fares_allowance", "electricity_allowance",
  "gas_allowance", "phone_allowance", "airfares_allowance", "extra_allowance",
];

function computeBase(emp: any, hours: number, rules: any, company: any) {
  if (emp.pay_type === "salary") {
    if (!hours || hours <= 0) return { base: 0, overtime: 0 };
    const fte = (emp.fte_pct == null ? 100 : emp.fte_pct) / 100;
    const base = (emp.annual_salary / periodsPerYear(company.pay_interval)) * fte;
    return { base: r2(base), overtime: 0 };
  }
  const rate = emp.hourly_rate || 0;
  let ot = 0, regular = hours;
  if (rules.overtime?.enabled && hours > rules.overtime.threshold_hours) {
    ot = (hours - rules.overtime.threshold_hours) * rate * rules.overtime.rate_multiplier;
    regular = rules.overtime.threshold_hours;
  }
  return { base: r2(regular * rate), overtime: r2(ot) };
}

function sumAllowances(emp: any) {
  let total = 0;
  const lines: any[] = [];
  for (const f of ALLOWANCES) {
    const v = Number(emp[f]) || 0;
    if (v > 0) { total += v; lines.push({ name: f.replace(/_allowance$/, "").replace(/_/g, " "), amount: r2(v) }); }
  }
  return { total: r2(total), lines };
}

function sumStanding(emp: any) {
  const preTax: any[] = [], postTax: any[] = [];
  let preTaxTotal = 0, postTaxTotal = 0;
  const addPre = (name: string, v: any) => { v = Number(v) || 0; if (v > 0) { preTax.push({ name, amount: r2(v) }); preTaxTotal += v; } };
  const addPost = (name: string, v: any) => { v = Number(v) || 0; if (v > 0) { postTax.push({ name, amount: r2(v) }); postTaxTotal += v; } };
  addPre("Salary sacrifice", emp.salary_sacrifice);
  addPre("NCSL voluntary",   emp.ncsl_voluntary);
  addPost("Savings",         emp.savings_deduction);
  addPost("Education",       emp.education_deduction);
  addPost("Christmas",       emp.christmas_bonus);
  addPost("Loan repayment",  emp.loan_repayment);
  return { preTax, postTax, preTaxTotal: r2(preTaxTotal), postTaxTotal: r2(postTaxTotal) };
}

function computeSwt(taxable: number, brackets: any[]) {
  if (taxable <= 0) return 0;
  let remaining = taxable, prevCap = 0, tax = 0;
  for (const b of brackets) {
    const cap = b.up_to == null ? Infinity : b.up_to;
    const band = Math.max(0, Math.min(remaining, cap - prevCap));
    tax += band * b.rate;
    remaining -= band; prevCap = cap;
    if (remaining <= 0) break;
  }
  return r2(tax);
}

function applyDependantRebate(tax: number, deps: number, rules: any, periodsPerYr: number) {
  if (Array.isArray(rules.dependent_rebate_annual)) {
    const idx = Math.min(Math.max(deps || 0, 0), rules.dependent_rebate_annual.length - 1);
    const cfg = rules.dependent_rebate_annual[idx];
    const annualTax = tax * periodsPerYr;
    const annualRebate = Math.max(cfg.floor || 0, Math.min((cfg.pct || 0) * annualTax, cfg.ceiling || 0));
    return Math.max(0, r2(tax - annualRebate / periodsPerYr));
  }
  return tax;
}

function chooseBrackets(emp: any, rules: any) {
  if (emp.residency_status === "non_resident" && rules.swt_brackets_non_resident) return rules.swt_brackets_non_resident;
  if (emp.declaration_lodged === false && rules.swt_brackets_no_declaration) return rules.swt_brackets_no_declaration;
  return rules.swt_brackets || [];
}

export function calculate(emp: any, entry: any, rules: any, company: any) {
  const hours = Number(entry.hours) || 0;
  const advance = Number(entry.cash_advance) || 0;
  const { base, overtime } = computeBase(emp, hours, rules, company);
  const worked = hours > 0;
  const allowances = worked ? sumAllowances(emp) : { total: 0, lines: [] };
  const gross = r2(base + overtime + allowances.total);
  const standing = worked ? sumStanding(emp) : { preTax: [], postTax: [], preTaxTotal: 0, postTaxTotal: 0 };

  let nasfundEmployee = 0, nasfundEmployer = 0;
  if (worked && rules.nasfund?.enabled && gross >= (rules.nasfund.min_gross_for_contribution || 0)) {
    const mandatory = rules.nasfund.employee_rate || 0;
    const extra = (Number(emp.nas_extra_pct) || 0) / 100;
    nasfundEmployee = r2(gross * (mandatory + extra));
    nasfundEmployer = r2(gross * (rules.nasfund.employer_rate || 0));
  }

  const taxable = Math.max(0, gross - standing.preTaxTotal - nasfundEmployee);
  let tax = computeSwt(taxable, chooseBrackets(emp, rules));
  tax = applyDependantRebate(tax, emp.dependents || 0, rules, periodsPerYear(company.pay_interval));

  const net = r2(gross - standing.preTaxTotal - nasfundEmployee - tax - standing.postTaxTotal - advance);
  return {
    gross, tax, nasfund: nasfundEmployee,
    other_deductions: r2(standing.preTaxTotal + standing.postTaxTotal + advance),
    net,
    breakdown: {
      hours, base, overtime,
      allowance_lines: allowances.lines, allowance_total: allowances.total,
      gross, pre_tax_deductions: standing.preTax, pre_tax_total: standing.preTaxTotal,
      taxable, tax,
      nasfund_employee: nasfundEmployee, nasfund_employer: nasfundEmployer,
      post_tax_deductions: standing.postTax, post_tax_total: standing.postTaxTotal,
      cash_advance: advance, net,
    },
  };
}
