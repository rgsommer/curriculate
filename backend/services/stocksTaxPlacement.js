// backend/services/stocksTaxPlacement.js
//
// Classifies each held position's tax efficiency given its accountType.
// Purely informational — never blocks a trade, never modifies a rec.
// Surfaces flags on Positions view + a new Tax placement section in
// the Health tab so the user can see which holdings are "in the wrong
// account" from a Canada-US tax-treaty standpoint.
//
// Governing rules (Canada-US Tax Treaty Article XVIII(2)(a) +
// Article XXI(2)):
//
//   • US dividends on US-domiciled securities held INSIDE an RRSP or
//     RRIF → EXEMPT from 15% US withholding tax. Full dividend paid.
//   • Same security held in a TFSA / FHSA → 15% US withholding
//     applies AND is NOT recoverable (TFSA doesn't yield a
//     Foreign Tax Credit).
//   • Same security in a taxable non-registered account → 15% US
//     withholding applies but IS recoverable via T1 Foreign Tax
//     Credit. Slight lag, no permanent loss.
//   • Canadian-listed ETF wrappers holding US stocks (XEQT, VFV, XUU,
//     VUN) suffer "Level-2 withholding tax" (L2WHT) — the ETF itself
//     receives US-dividend flow with 15% already deducted. Not
//     recoverable regardless of account. Meaningful drag on the
//     yield component (US equities ~1.3% avg yield → ~0.20% drag).
//
// Practical hierarchy (most → least tax-efficient):
//   1. Direct US-listed high-dividend stock (KO, JNJ, VZ...) in RRSP
//   2. Direct US-listed equity ETF (VOO, VTI, QQQ) in RRSP
//   3. Same US ETF in taxable non-registered (recoverable withholding)
//   4. Same US ETF in TFSA (unrecoverable but small drag on
//      low-yield growth ETFs)
//   5. Canadian-wrapped US ETF (XEQT/VFV) anywhere (L2WHT)
//   6. Direct US high-dividend stock in TFSA (worst — permanently
//      losing ~15% of a ~3% yield = 0.45%/yr on the position value)

// Base-ticker lists — normalized (no .TO suffix, no exchange). Callers
// should baseOf(ticker) before checking. Kept separate from the sleeve
// enforcer's INCOME_TICKERS so future edits to sleeve routing don't
// silently change tax-placement warnings.

// High-yield US dividend stocks. Yield ≥ ~2.5% AND US-domiciled.
// Losing withholding on these hurts most. Curated from what shows up
// in dividend-focused portfolios; deliberately conservative so we
// don't flag every tech name that happens to pay a small dividend.
const US_DIVIDEND_STOCKS = new Set([
  "KO", "PEP", "JNJ", "PG", "MO", "ABBV", "MRK", "XOM", "CVX",
  "O", "VZ", "MMM", "T", "IBM", "PFE", "BMY", "GILD", "LMT", "MCD",
  "SO", "DUK", "D", "NEE", "PM", "PSA", "MAIN", "STAG", "NNN", "SPG",
  "WMT", "KMI", "OKE", "MPC", "PSX", "VLO", "BAC", "WFC", "USB", "PNC",
  "GS", "MS", "BLK", "CVS", "UNM", "AFL", "PRU", "MET", "TROW",
]);

// US-listed broad equity ETFs — direct exposure. Get the treaty
// benefit only when held in RRSP. Yield here is ~1.3% avg so the
// drag in TFSA is real but small (~0.20%/yr).
const US_EQUITY_ETFS_DIRECT = new Set([
  "VOO", "VTI", "QQQ", "SPY", "IVV", "IWM", "VB", "VUG", "VTV",
  "SCHD", "SCHG", "VYM", "VIG", "DGRO", "NOBL",
  "XLK", "XLF", "XLE", "XLV", "XLP", "XLY", "XLI", "XLU", "XLB",
  "XLRE", "XLC", "VGT", "VFH", "VDE", "VHT", "VDC", "VCR", "VIS",
  "VPU", "VAW", "VNQ", "VOX",
]);

// Canadian-wrapped US ETFs (Canadian-listed ETFs whose underlying
// holdings are US or global-with-US securities). Suffer L2WHT
// regardless of account. Informational note only; no severity flag
// (there's no better alternative available in CAD without an FX
// conversion, so the drag is a fact of life, not a mistake).
const CDN_WRAPPED_US_ETFS = new Set([
  "XEQT", "VEQT", "ZEQT", "XAW", "VXC", "HGRO", "HBAL",
  "VFV", "VUN", "XUU", "XSP", "ZSP", "VSP",
  "VUS", "XUH", "ZUE",
]);

// Approximate average dividend yields — used only for the drag-
// estimate math. Deliberately coarse. If we want precision later
// we can pull dividendYield from getFundamentals per ticker.
const APPROX_YIELDS = {
  US_DIVIDEND_STOCK: 0.035, // ~3.5% avg for a curated dividend list
  US_EQUITY_ETF: 0.013,     // ~1.3% avg for broad US equity ETFs
  CDN_WRAPPED_L2WHT_DRAG: 0.002, // ~0.2% annual drag on Cdn-wrapped US
};

const US_WITHHOLDING_RATE = 0.15;

function baseOf(ticker) {
  return String(ticker || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// The core classifier. Returns:
//   { efficient, severity, kind, note, annualDragPct }
//
// severity: null (efficient / non-applicable), "info" (mild drag, no
// better alternative available), or "warn" (meaningful cost, better
// placement exists in another held account).
export function classifyPlacement({ ticker, accountType, currency }) {
  const base = baseOf(ticker);
  if (!base) return { efficient: true, severity: null, kind: null, note: "", annualDragPct: 0 };

  // Only US-domiciled securities have withholding implications.
  // Base heuristic: currency=USD or it appears in one of our US
  // classifications. Canadian securities (RY, XIU, ENB) never trigger
  // — they're either non-dividend or CAD-source dividends with no
  // withholding regardless of account.
  const isUsListedStock = US_DIVIDEND_STOCKS.has(base);
  const isUsListedEtf = US_EQUITY_ETFS_DIRECT.has(base);
  const isCdnWrappedUsEtf = CDN_WRAPPED_US_ETFS.has(base);

  if (!isUsListedStock && !isUsListedEtf && !isCdnWrappedUsEtf) {
    return { efficient: true, severity: null, kind: null, note: "", annualDragPct: 0 };
  }

  // Canadian-wrapped US ETFs: L2WHT applies everywhere. Info-level in
  // RRSP (there's no better alternative in CAD without an FX
  // conversion). Info in taxable + TFSA too — the drag is baked in.
  if (isCdnWrappedUsEtf) {
    return {
      efficient: false,
      severity: "info",
      kind: "cdn-wrapped-l2wht",
      note: `${base} is a Canadian-listed ETF wrapping US equities. The wrapper pays 15% US withholding at the ETF level (Level-2 WHT) which is NOT recoverable regardless of account. Estimated drag ~${(APPROX_YIELDS.CDN_WRAPPED_L2WHT_DRAG * 100).toFixed(2)}%/yr on position value. To eliminate the drag inside an RRSP, hold the equivalent US-listed ETF (e.g. VTI instead of XEQT's US portion) — treaty exempts US-listed direct holdings from withholding in RRSP.`,
      annualDragPct: APPROX_YIELDS.CDN_WRAPPED_L2WHT_DRAG,
    };
  }

  // Direct US-listed stocks / ETFs. Efficiency ranks by account type.
  const inRrsp = accountType === "rrsp" || accountType === "spousal-rrsp" || accountType === "rrif" || accountType === "lira" || accountType === "lif";
  const inTfsaFamily = accountType === "tfsa" || accountType === "fhsa";
  const inTaxable = accountType === "individual" || accountType === "joint" || accountType === "corporate" || accountType === "trust";

  if (inRrsp) {
    // Optimal placement — no drag.
    return { efficient: true, severity: null, kind: null, note: "", annualDragPct: 0 };
  }

  const kind = isUsListedStock ? "us-dividend-stock" : "us-equity-etf";
  const approxYield = isUsListedStock ? APPROX_YIELDS.US_DIVIDEND_STOCK : APPROX_YIELDS.US_EQUITY_ETF;
  const dragPct = approxYield * US_WITHHOLDING_RATE;

  if (inTfsaFamily) {
    // Unrecoverable withholding. Severity depends on yield magnitude:
    // a 3.5% dividend name losing 15% (0.53%/yr drag) matters; a
    // 1.3% broad ETF losing 15% (0.20%/yr) is minor. Both flagged
    // "warn" so the user sees them, but the drag number tells the
    // story.
    return {
      efficient: false,
      severity: "warn",
      kind,
      note: isUsListedStock
        ? `${base} is a US-listed dividend payer (~${(approxYield * 100).toFixed(1)}% yield). In TFSA: 15% US withholding applies AND is NOT recoverable (TFSA doesn't yield a Foreign Tax Credit). Estimated drag ~${(dragPct * 100).toFixed(2)}%/yr. Moving to RRSP eliminates it entirely under the Canada-US tax treaty.`
        : `${base} is a US-listed equity ETF (~${(approxYield * 100).toFixed(1)}% yield). In TFSA: 15% US withholding on the dividend component is NOT recoverable. Estimated drag ~${(dragPct * 100).toFixed(2)}%/yr. RRSP placement removes it via treaty.`,
      annualDragPct: dragPct,
    };
  }

  if (inTaxable) {
    // Recoverable via Foreign Tax Credit on T1. Some friction
    // (mid-year cash drag, need to actually claim it) but not a
    // permanent loss. "info" not "warn".
    return {
      efficient: false,
      severity: "info",
      kind,
      note: `${base} in a taxable non-registered account: 15% US withholding applies but IS recoverable via T1 Foreign Tax Credit at tax time. Slight cash-flow lag, no permanent tax loss. RRSP placement avoids the withholding entirely and skips the FTC-claim step.`,
      annualDragPct: 0, // recoverable → effective drag is zero at year-end
    };
  }

  // accountType unset or "other" — can't judge.
  return { efficient: true, severity: null, kind: null, note: "", annualDragPct: 0 };
}

// Batch helper — takes an array of held positions + the accounts map
// and returns a list of flagged rows plus an aggregate annual-drag
// estimate in CAD. Consumed by the Health tab and Positions view.
export function analyzeTaxPlacement(positions, accounts, { fxUsdCad = 1.37 } = {}) {
  const accountById = new Map((accounts || []).map(a => [a.id, a]));
  const flagged = [];
  let totalDragCad = 0;
  let coverage = { classifiedAccounts: 0, unclassifiedAccounts: 0 };
  const accountTypesSeen = new Set();

  for (const p of (positions || [])) {
    if (!p?.ticker || !(p.qty > 0)) continue;
    const acct = accountById.get(p.acct);
    if (acct?.accountType) accountTypesSeen.add(p.acct);
    const result = classifyPlacement({
      ticker: p.ticker,
      accountType: acct?.accountType || null,
      currency: p.ccy || "USD",
    });
    if (result.severity == null) continue;

    // Compute position value in the trading currency, then in CAD, to
    // estimate the dollar drag. drag% × value = annual cost.
    const ccy = p.ccy || "USD";
    const price = ccy === "USD" ? p.priceUsd : p.priceCad;
    if (!Number.isFinite(price)) continue;
    const valueNative = price * p.qty;
    const valueCad = ccy === "USD" ? valueNative * fxUsdCad : valueNative;
    const dragCad = valueCad * (result.annualDragPct || 0);
    totalDragCad += dragCad;
    flagged.push({
      ticker: p.ticker,
      account: acct?.name || p.acct || "",
      accountId: p.acct,
      accountType: acct?.accountType || null,
      currency: ccy,
      qty: p.qty,
      valueCad,
      severity: result.severity,
      kind: result.kind,
      note: result.note,
      annualDragPct: result.annualDragPct,
      annualDragCad: dragCad,
    });
  }

  for (const a of (accounts || [])) {
    if (a.accountType) coverage.classifiedAccounts++;
    else coverage.unclassifiedAccounts++;
  }

  // Sort warnings first (they cost real money), then info-level, then
  // by CAD drag desc within each bucket.
  flagged.sort((a, b) => {
    const sevRank = { warn: 0, info: 1 };
    if (sevRank[a.severity] !== sevRank[b.severity]) return sevRank[a.severity] - sevRank[b.severity];
    return b.annualDragCad - a.annualDragCad;
  });

  return {
    flagged,
    totalAnnualDragCad: totalDragCad,
    coverage,
  };
}
