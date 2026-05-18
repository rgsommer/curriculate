// frontend/src/app/api/teebeepay/_iif.ts
//
// QuickBooks IIF (Intuit Interchange Format) journal-entry export.
// Tab-separated. One General Journal entry per pay period:
//   DR  Salaries / Wages         = sum of gross
//   CR  Wages Clearing Account   = sum of net
//   CR  Taxation Clearing        = sum of tax
//   CR  Super Clearing 8.4%+6%   = sum of (employee_nasfund + employer_nasfund)
//   CR  Other Deductions Clearing= sum of other deductions
//   DR  Superannuation Expense   = sum of employer 8.4% (so the employer side appears as an expense)
// Sum of debits = Sum of credits.

function tabEscape(v: any) {
  return String(v ?? "").replace(/\t/g, " ").replace(/\r?\n/g, " ");
}
function ddmmyyyy(s: string) {
  const [y, m, d] = String(s || "").split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

export function buildIif(company: any, period: any, entries: any[]) {
  const memo = `Payroll ${period.period_start} to ${period.period_end} (paid ${period.pay_date})`;
  const date = ddmmyyyy(period.pay_date || period.period_end);

  let totalGross = 0, totalNet = 0, totalTax = 0, totalNasfundEmp = 0, totalNasfundEmpr = 0, totalOther = 0;
  for (const e of entries) {
    totalGross += Number(e.gross) || 0;
    totalNet   += Number(e.net) || 0;
    totalTax   += Number(e.tax) || 0;
    totalNasfundEmp  += Number(e.nasfund) || 0;
    totalNasfundEmpr += Number(e.calc_breakdown?.nasfund_employer || (e.gross || 0) * 0.084);
    totalOther += Number(e.other_deductions) || 0;
  }
  const r2 = (n: number) => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);

  // IIF format: ! lines = column definitions; lines without ! = data.
  const lines: string[][] = [
    // Header
    ["!HDR", "PROD", "VER", "REL", "IIFVER", "DATE", "TIME", "ACCNTNT", "ACCNTNTSPLITTIME"],
    ["HDR",  "TeebeePay", "1.0", "Release 1", "1", date, String(Math.floor(Date.now() / 1000)), "N", "0"],

    // Transaction headers
    ["!TRNS", "TRNSID", "TRNSTYPE", "DATE", "ACCNT", "NAME", "CLASS", "AMOUNT", "DOCNUM", "MEMO", "CLEAR", "TOPRINT", "NAMEISTAXABLE"],
    ["!SPL",  "SPLID",  "TRNSTYPE", "DATE", "ACCNT", "NAME", "CLASS", "AMOUNT", "DOCNUM", "MEMO", "CLEAR", "QNTY", "PRICE", "INVITEM"],
    ["!ENDTRNS"],

    // Single General Journal Entry — DEBITs positive, CREDITs negative
    // First line is TRNS; subsequent lines are SPL.
    ["TRNS",  "1", "GENERAL JOURNAL", date, "Salaries / Wages",                memo, (company.abbreviation || "").slice(0, 31), r2(totalGross),       "", memo, "N", "N", "N"],
    ["SPL",   "2", "GENERAL JOURNAL", date, "Superannuation Expense",          memo, (company.abbreviation || "").slice(0, 31), r2(totalNasfundEmpr), "", memo, "N", "", "", ""],
    ["SPL",   "3", "GENERAL JOURNAL", date, "Wages Clearing Account",          memo, (company.abbreviation || "").slice(0, 31), r2(-totalNet),        "", memo, "N", "", "", ""],
    ["SPL",   "4", "GENERAL JOURNAL", date, "Taxation Clearing",               memo, (company.abbreviation || "").slice(0, 31), r2(-totalTax),        "", memo, "N", "", "", ""],
    ["SPL",   "5", "GENERAL JOURNAL", date, "Super Clearing 8.4% + 6%",        memo, (company.abbreviation || "").slice(0, 31), r2(-(totalNasfundEmp + totalNasfundEmpr)), "", memo, "N", "", "", ""],
    ["SPL",   "6", "GENERAL JOURNAL", date, "Other Deductions Clearing",       memo, (company.abbreviation || "").slice(0, 31), r2(-totalOther),      "", memo, "N", "", "", ""],
    ["ENDTRNS"],
  ];
  return lines.map((row) => row.map(tabEscape).join("\t")).join("\r\n") + "\r\n";
}
