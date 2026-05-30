// Per-audit-type document checklist. Each slot is a logical "thing we need"
// (Trial balance, GL export, etc.). Clients upload one or more files into
// each slot. Some are required, some optional. The client portal renders
// these as a checklist with progress bars; the admin view shows what's in.

export interface ChecklistItem {
  slot: string;          // stable id e.g. "trial_balance"
  label: string;         // shown to client
  description: string;   // hint
  formats: string;       // accepted formats hint
  required: boolean;
}

const BASE: ChecklistItem[] = [
  { slot: "trial_balance",        label: "Trial balance (year-end)",
    description: "Year-end trial balance with debit/credit columns. Accounting software export preferred.",
    formats: "XLSX, XLS, CSV", required: true },
  { slot: "general_ledger",       label: "General ledger export",
    description: "All transactions for the year, account-by-account. Most accounting packages can export this.",
    formats: "XLSX, CSV", required: true },
  { slot: "bank_statements",      label: "Bank statements (all accounts, all months)",
    description: "Every bank account, every month of the fiscal year. PDFs from internet banking are fine.",
    formats: "PDF, CSV", required: true },
  { slot: "bank_reconciliations", label: "Bank reconciliations",
    description: "Your monthly bank rec workbooks, if you maintain them.",
    formats: "XLSX, PDF", required: false },
  { slot: "prior_year_financials", label: "Prior-year audited financial statements",
    description: "Last year's signed audit report — needed for opening balances and comparatives.",
    formats: "PDF", required: true },
];

const PAYROLL_ITEMS: ChecklistItem[] = [
  { slot: "payroll_register",     label: "Payroll register (annual summary)",
    description: "Per-employee annual gross, SWT, NASFund, net pay. If you're on TeebeePay we already have this.",
    formats: "XLSX, PDF", required: true },
  { slot: "irc_swt_evidence",     label: "IRC SWT remittance evidence",
    description: "IRC receipts for each month's SWT remittance.",
    formats: "PDF", required: false },
  { slot: "nasfund_evidence",     label: "NASFund / NCSL remittance evidence",
    description: "NASFund receipts for each month's contribution.",
    formats: "PDF", required: false },
];

const COMPLIANCE_ITEMS: ChecklistItem[] = [
  { slot: "tax_returns",          label: "Prior tax returns (last 2 years)",
    description: "Income tax returns, GST returns, withholding tax returns.",
    formats: "PDF", required: true },
  { slot: "ipa_filings",          label: "IPA filings (annual returns, share register)",
    description: "Latest IPA annual return; current share register; director changes.",
    formats: "PDF", required: false },
];

const ASSETS_ITEMS: ChecklistItem[] = [
  { slot: "fixed_asset_register", label: "Fixed-asset register",
    description: "Asset listing with cost, depreciation, NBV, additions and disposals during the year.",
    formats: "XLSX, PDF", required: true },
  { slot: "inventory_listing",    label: "Inventory listing (year-end)",
    description: "Stocktake report at year-end with quantities, unit costs, total value.",
    formats: "XLSX, PDF", required: false },
];

const GOVERNANCE_ITEMS: ChecklistItem[] = [
  { slot: "board_minutes",        label: "Board / shareholder minutes",
    description: "Minutes of meetings during the audit year. Helps identify related-party transactions and key decisions.",
    formats: "PDF, DOCX", required: false },
  { slot: "management_accounts",  label: "Monthly management accounts",
    description: "Internal P&L and balance sheet for each month of the year.",
    formats: "XLSX, PDF", required: false },
];

const DONOR_ITEMS: ChecklistItem[] = [
  { slot: "donor_agreement",      label: "Donor / grant agreement",
    description: "Signed grant agreement with budget and reporting requirements.",
    formats: "PDF", required: true },
  { slot: "donor_budget_actual",  label: "Budget vs. actual report",
    description: "Project-coded actual spend against the approved donor budget.",
    formats: "XLSX, PDF", required: true },
];

const LANDOWNER_ITEMS: ChecklistItem[] = [
  { slot: "lo_directives",        label: "Landowner directives / royalty distributions",
    description: "Royalty payments to ILGs/clans; distribution registers.",
    formats: "PDF, XLSX", required: true },
  { slot: "unit_trust_register",  label: "Unit trust beneficiary register",
    description: "Current beneficiary listing and distribution history.",
    formats: "XLSX, PDF", required: false },
];

export function checklistForAuditType(type: string): ChecklistItem[] {
  switch (type) {
    case "statutory":
      return [...BASE, ...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS, ...ASSETS_ITEMS, ...GOVERNANCE_ITEMS];
    case "readiness":
      // Audit-readiness review is lighter — same base but most items optional
      return [...BASE, ...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS].map((it) =>
        it.slot === "trial_balance" || it.slot === "general_ledger" ? it : { ...it, required: false });
    case "tax":
      return [...BASE.slice(0, 3), ...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS];
    case "compliance":
      return [...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS,
        { slot: "ncsl_reg",       label: "NCSL employer registration certificate",
          description: "NASFund / NCSL registration document.", formats: "PDF", required: true }];
    case "donor_fund":
      return [...BASE, ...DONOR_ITEMS, ...PAYROLL_ITEMS, ...GOVERNANCE_ITEMS];
    case "landowner":
      return [...BASE, ...LANDOWNER_ITEMS, ...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS, ...ASSETS_ITEMS, ...GOVERNANCE_ITEMS];
    case "other":
    default:
      return [...BASE, ...PAYROLL_ITEMS, ...COMPLIANCE_ITEMS, ...ASSETS_ITEMS];
  }
}
