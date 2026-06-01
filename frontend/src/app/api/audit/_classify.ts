// Deterministic document classifier: maps an uploaded file to the most likely
// audit checklist slot from its filename. Pure heuristics — no model call — so
// it's fast, predictable and works offline. Returns { slot: "other", score: 0 }
// when nothing matches, so an unrecognised file is never silently dropped; the
// auditor can reassign it manually.
//
// Keyword weights: specific multi-word phrases score high; short tokens ("tb",
// "gl") score low and only win when nothing more specific matched. Filenames are
// separator-normalised and space-padded so short tokens match on word
// boundaries (".../Protocal_TB_2025.xlsx" → " protocal tb 2025 xlsx ").

// [slot, [[keyword, weight], ...]]
const SIGNALS: Array<[string, Array<[string, number]>]> = [
  ["trial_balance",        [["trial balance", 6], ["trialbalance", 6], [" tb ", 3], ["tb ", 2], [" tb", 2]]],
  ["general_ledger",       [["general ledger", 6], ["generalledger", 6], ["gl detail", 5], ["g l detail", 5], ["ledger", 3], [" gl ", 3], ["gl ", 2], [" gl", 2]]],
  ["bank_reconciliations", [["bank reconciliation", 7], ["bank rec", 6], ["reconciliation", 5], ["recon", 3]]],
  ["bank_statements",      [["bank statement", 6], ["bank stmt", 5], ["statement", 2], ["bsp", 3], ["kina bank", 4], ["westpac", 4], [" anz", 3]]],
  ["prior_year_financials",[["financial statements", 6], ["financial statement", 6], ["financials", 5], ["audited", 5], ["annual report", 5], ["balance sheet", 4], ["profit and loss", 5], ["profit & loss", 5], ["p l statement", 4], ["p&l", 4], ["income statement", 5], ["statement of financial", 5], [" afs ", 3]]],
  ["payroll_register",     [["payroll register", 6], ["payroll", 5], ["pay register", 5], ["salary register", 5], ["wages", 3]]],
  ["irc_swt_evidence",     [["salary or wages tax", 6], ["salary & wages tax", 6], [" swt", 4]]],
  ["nasfund_evidence",     [["nasfund", 6], ["ncsl", 5], ["superannuation", 4]]],
  ["tax_returns",          [["tax return", 6], ["income tax", 5], ["gst return", 6], ["withholding", 4]]],
  ["ipa_filings",          [["annual return", 5], ["share register", 5], [" ipa ", 4]]],
  ["fixed_asset_register", [["fixed asset", 6], ["asset register", 6], ["depreciation", 4], [" far ", 3]]],
  ["inventory_listing",    [["stocktake", 6], ["stock count", 5], ["inventory", 5], ["stock ", 2]]],
  ["board_minutes",        [["board minutes", 7], ["minutes", 5], ["resolution", 4], [" agm", 3], ["board", 2]]],
  ["management_accounts",  [["management account", 6], ["mgmt account", 5], ["monthly accounts", 5]]],
  ["donor_agreement",      [["grant agreement", 7], ["funding agreement", 7], ["donor agreement", 7], ["grant", 3], ["donor", 3]]],
  ["donor_budget_actual",  [["budget vs actual", 7], ["budget vs. actual", 7], ["budget v actual", 7], ["budget", 3], ["actual", 2]]],
  ["lo_directives",        [["royalty", 5], ["distribution", 4], ["directive", 5]]],
  ["unit_trust_register",  [["unit trust", 6], ["beneficiary", 5]]],
  ["ncsl_reg",             [["ncsl registration", 7], ["employer registration", 6]]],
];

export function classifyDocumentSlot(
  filename: string,
  allowedSlots?: string[],
): { slot: string; score: number } {
  const name = " " + String(filename || "").toLowerCase().replace(/[._\-/\\]+/g, " ").replace(/\s+/g, " ") + " ";
  const allow = allowedSlots && allowedSlots.length ? new Set(allowedSlots) : null;
  let best = { slot: "other", score: 0 };
  for (const [slot, kws] of SIGNALS) {
    if (allow && !allow.has(slot)) continue;          // only file into this engagement's checklist
    let s = 0;
    for (const [kw, w] of kws) if (name.includes(kw)) s += w;
    if (s > best.score) best = { slot, score: s };
  }
  return best;
}
