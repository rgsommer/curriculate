// backend/services/stocksIncomeSecurityType.js
//
// P1 HARDENING (2026-09-08) — classify an INCOME sleeve security by
// TYPE so the decision engine can evaluate dividend safety with the
// APPROPRIATE metrics. Rejects the universal
//
//     payout ratio ≥ 65% ⇒ TRIM
//     FCF yield  < 3%   ⇒ TRIM
//
// pattern that mis-classifies banks and REITs.
//
// A bank's "payout ratio" reads high because banks retain capital via
// CET1, not free cash flow. A REIT distributes AFFO; its EPS-based
// payout can be >100% while its AFFO-based payout is comfortably safe.
// Utilities and pipelines carry structurally high payouts against
// regulated, stable cash flow — 80% is normal, not a warning. Applying
// an industrial-company FCF-coverage test to any of them produces
// false SELL/TRIM signals.
//
// Output ∈ { bank | reit | utility | pipeline | telecom | industrial | etf | other }
//
// Classification order:
//   1. Explicit ticker allowlist (fastest, most reliable for our common names)
//   2. FMP sector/industry from getFundamentals output (when provided)
//   3. Suffix / structural heuristics (an "-UN.TO" income trust is a REIT-shaped payout structure)
//   4. Fallback "other"
//
// The classifier is deliberately conservative: an ambiguous ticker
// returns "other", which then triggers the DEFERRED path in the
// decision engine ("data insufficient — cannot select security-type-
// appropriate metrics"). We do NOT default to "industrial" for
// unknown names; that would reintroduce the exact bug this refactor
// eliminates.

export const INCOME_TYPE = {
  BANK: "bank",
  REIT: "reit",
  UTILITY: "utility",
  PIPELINE: "pipeline",
  TELECOM: "telecom",
  INDUSTRIAL: "industrial",
  ETF: "etf",
  OTHER: "other",
};

// Explicit allowlist for the tickers we most commonly hold on the
// INCOME sleeve. Extend as new positions appear. The base-ticker key
// (no exchange suffix) makes matching exchange-agnostic (RY / RY.TO
// resolve identically).
const EXPLICIT = {
  // Canadian banks
  RY: INCOME_TYPE.BANK, TD: INCOME_TYPE.BANK, BMO: INCOME_TYPE.BANK,
  BNS: INCOME_TYPE.BANK, CM: INCOME_TYPE.BANK, NA: INCOME_TYPE.BANK,
  // US financials
  JPM: INCOME_TYPE.BANK, BAC: INCOME_TYPE.BANK, WFC: INCOME_TYPE.BANK,
  C: INCOME_TYPE.BANK, USB: INCOME_TYPE.BANK, PNC: INCOME_TYPE.BANK,
  // Insurers (treat like banks for dividend-safety metric selection —
  // regulatory capital drives payout, not corporate FCF)
  MFC: INCOME_TYPE.BANK, SLF: INCOME_TYPE.BANK, MET: INCOME_TYPE.BANK,
  PRU: INCOME_TYPE.BANK,
  // Pipelines / midstream
  ENB: INCOME_TYPE.PIPELINE, TRP: INCOME_TYPE.PIPELINE,
  PPL: INCOME_TYPE.PIPELINE, KMI: INCOME_TYPE.PIPELINE,
  EPD: INCOME_TYPE.PIPELINE, ET: INCOME_TYPE.PIPELINE,
  MPLX: INCOME_TYPE.PIPELINE, WMB: INCOME_TYPE.PIPELINE,
  // Utilities
  FTS: INCOME_TYPE.UTILITY, EMA: INCOME_TYPE.UTILITY, H: INCOME_TYPE.UTILITY,
  BEP: INCOME_TYPE.UTILITY, BEPC: INCOME_TYPE.UTILITY,
  DUK: INCOME_TYPE.UTILITY, SO: INCOME_TYPE.UTILITY, NEE: INCOME_TYPE.UTILITY,
  D: INCOME_TYPE.UTILITY, AEP: INCOME_TYPE.UTILITY, XEL: INCOME_TYPE.UTILITY,
  // Telecom
  T: INCOME_TYPE.TELECOM,          // AT&T (US) — BCE / T is the TSX ticker for Telus, so context matters
  VZ: INCOME_TYPE.TELECOM, TMUS: INCOME_TYPE.TELECOM, S: INCOME_TYPE.TELECOM,
  BCE: INCOME_TYPE.TELECOM, RCI: INCOME_TYPE.TELECOM, TU: INCOME_TYPE.TELECOM,
  // REITs — commonly held
  O: INCOME_TYPE.REIT, VNQ: INCOME_TYPE.ETF,
  REI: INCOME_TYPE.REIT, // RioCan (REI-UN.TO)
  CAR: INCOME_TYPE.REIT, // CAR.UN
  HR: INCOME_TYPE.REIT,
  SPG: INCOME_TYPE.REIT, PLD: INCOME_TYPE.REIT, PSA: INCOME_TYPE.REIT,
  AMT: INCOME_TYPE.REIT, CCI: INCOME_TYPE.REIT, EQR: INCOME_TYPE.REIT,
  AVB: INCOME_TYPE.REIT, WELL: INCOME_TYPE.REIT,
  // Industrial dividend payers
  JNJ: INCOME_TYPE.INDUSTRIAL, PG: INCOME_TYPE.INDUSTRIAL,
  KO: INCOME_TYPE.INDUSTRIAL, PEP: INCOME_TYPE.INDUSTRIAL,
  MMM: INCOME_TYPE.INDUSTRIAL, MO: INCOME_TYPE.INDUSTRIAL,
  ABBV: INCOME_TYPE.INDUSTRIAL, MRK: INCOME_TYPE.INDUSTRIAL,
  XOM: INCOME_TYPE.INDUSTRIAL, CVX: INCOME_TYPE.INDUSTRIAL,
  IBM: INCOME_TYPE.INDUSTRIAL, TXN: INCOME_TYPE.INDUSTRIAL,
  // Income ETFs
  XDIV: INCOME_TYPE.ETF, VDY: INCOME_TYPE.ETF, XEI: INCOME_TYPE.ETF,
  ZWB: INCOME_TYPE.ETF, ZWE: INCOME_TYPE.ETF,
  SCHD: INCOME_TYPE.ETF, VYM: INCOME_TYPE.ETF, HDV: INCOME_TYPE.ETF,
  DGRO: INCOME_TYPE.ETF, NOBL: INCOME_TYPE.ETF,
};

function baseOf(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/-UN$/, "");
}

// FMP sector → income-type mapping. Only maps sectors we can classify
// with confidence; ambiguous sectors return null so we fall through to
// "other".
function sectorToType(sector, industry) {
  const s = String(sector || "").toLowerCase();
  const i = String(industry || "").toLowerCase();
  if (!s && !i) return null;
  if (s === "financial services" || s === "financials") {
    if (/insurance/.test(i)) return INCOME_TYPE.BANK;   // treated like banks — regulatory capital drives dividend safety
    if (/reit|real estate/.test(i)) return INCOME_TYPE.REIT;
    if (/bank|credit|capital markets/.test(i)) return INCOME_TYPE.BANK;
    return INCOME_TYPE.BANK;
  }
  if (s === "real estate") return INCOME_TYPE.REIT;
  if (s === "utilities") {
    if (/pipeline|gas|midstream/.test(i)) return INCOME_TYPE.PIPELINE;
    return INCOME_TYPE.UTILITY;
  }
  if (s === "energy") {
    if (/pipeline|midstream|storage/.test(i)) return INCOME_TYPE.PIPELINE;
    return INCOME_TYPE.INDUSTRIAL;
  }
  if (s === "communication services") {
    if (/telecom/.test(i)) return INCOME_TYPE.TELECOM;
    return INCOME_TYPE.INDUSTRIAL;
  }
  if (s === "consumer defensive" || s === "consumer staples" ||
      s === "consumer cyclical" || s === "consumer discretionary" ||
      s === "healthcare" || s === "health care" ||
      s === "industrials" || s === "materials" ||
      s === "technology" || s === "basic materials") {
    return INCOME_TYPE.INDUSTRIAL;
  }
  return null;
}

// Structural heuristics from the ticker itself.
function heuristicFromTicker(rawTicker) {
  const u = String(rawTicker || "").toUpperCase();
  // Canadian income trusts / REITs use the .UN suffix convention.
  if (/-UN(\.[A-Z]+)?$/.test(u)) return INCOME_TYPE.REIT;
  // Bank suffix conventions rare — leave to allowlist / sector.
  return null;
}

// Public API — classify a security by type. Second arg `fundamentals`
// is optional; if provided we use the FMP sector/industry to refine.
// Returns one of INCOME_TYPE values; NEVER guesses "industrial" for
// unknown names (would reintroduce the bug).
export function classifyIncomeSecurityType(ticker, fundamentals = null) {
  if (!ticker) return INCOME_TYPE.OTHER;
  const base = baseOf(ticker);
  if (EXPLICIT[base]) return EXPLICIT[base];
  const fromSector = sectorToType(fundamentals?.sector, fundamentals?.industry);
  if (fromSector) return fromSector;
  const fromHeuristic = heuristicFromTicker(ticker);
  if (fromHeuristic) return fromHeuristic;
  return INCOME_TYPE.OTHER;
}
