// backend/services/stocksPortfolioHealth.js
//
// Structural health snapshot for the /stocks Health tab. Reads a
// portfolio's positions + cash and returns a pure-data digest:
//
//   • allocations    — every held position with CAD value, % of book,
//                      sleeve, currency, account, unrealized P/L%
//   • sleeves        — from computeSleeveBalance (CORE/SWING/INCOME/SPEC)
//   • cash           — CAD + USD across accounts, % of book
//   • concentrations — positions ≥ 15% of book (warn) or ≥ 20% (breach)
//   • overlaps       — flags when two held ETFs track heavily-overlapping
//                      indexes, OR when a held single-name is a top
//                      constituent of a held broad ETF
//   • sectorExposure — sector weight across held positions (via
//                      SECTOR_MAP in stocksSectorRotation service)
//   • deductions     — accumulated point deductions with reasons
//   • healthScore    — 0-10, deterministic; separate from any AI opinion
//
// No opinions here — the AI narrative endpoint layers commentary
// on top of this. Deterministic scoring means the same portfolio
// always gets the same score independent of Claude's temperature.

import { classifyPosition, computeSleeveBalance } from "./stocksSleeveEnforcer.js";
import { analyzeTaxPlacement } from "./stocksTaxPlacement.js";

// Known ETF families that overlap heavily. Groups are transitive —
// holding two members of the same group is a redundancy flag.
const OVERLAP_GROUPS = [
  {
    label: "US total market / S&P 500 core",
    members: new Set(["VTI", "VOO", "SPY", "IVV", "SPTM", "ITOT", "SPLG"]),
    note: "VOO/SPY/IVV = S&P 500; VTI/ITOT/SPTM = total US market (S&P 500 + mid/small). Holding two adds cost, not diversification.",
  },
  {
    label: "US Nasdaq / large-cap tech",
    members: new Set(["QQQ", "QQQM", "XLK", "VGT", "FTEC", "IYW"]),
    note: "QQQ/QQQM = Nasdaq 100; XLK/VGT/FTEC/IYW = US tech sector. Heavy top-holding overlap (AAPL, MSFT, NVDA).",
  },
  {
    label: "US small cap",
    members: new Set(["IWM", "VB", "IJR", "IWO", "IWN", "SCHA"]),
    note: "All track US small-cap (Russell 2000 or similar). Holding two overlaps ~80%.",
  },
  {
    label: "Canadian broad equity",
    members: new Set(["XIC", "XIU", "VCE", "VCN", "ZCN", "HXCN", "FLCD"]),
    note: "XIU = TSX 60; XIC/VCN = TSX Composite; VCE = Cdn broad. Top-10 holdings overlap heavily.",
  },
  {
    label: "Global all-equity one-ticket",
    members: new Set(["XEQT", "VEQT", "ZEQT", "XAW", "VXC", "HGRO"]),
    note: "All are broad global equity funds; each already owns US large-cap + Canadian broad + international. Owning one alongside VOO/XIU is double-dipping on the same exposure.",
  },
  {
    label: "Emerging markets",
    members: new Set(["VWO", "EEM", "IEMG", "SCHE", "XEC"]),
    note: "All broad EM funds; ~90% overlap.",
  },
];

// When one of these single-name tickers is held ALONGSIDE any of the
// listed broad ETFs, flag as "already owned via the ETF". Weight is the
// APPROX top-holding weight in the ETF (informational, not exact).
const SINGLE_NAME_IN_ETF = [
  { ticker: "AAPL", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM", "XLK", "VGT"], approxEtfWeight: 6.5 },
  { ticker: "MSFT", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM", "XLK", "VGT"], approxEtfWeight: 6.5 },
  { ticker: "NVDA", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM", "XLK", "VGT"], approxEtfWeight: 6.0 },
  { ticker: "AMZN", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM"], approxEtfWeight: 3.5 },
  { ticker: "GOOGL", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM"], approxEtfWeight: 2.0 },
  { ticker: "GOOG", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM"], approxEtfWeight: 2.0 },
  { ticker: "META", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM"], approxEtfWeight: 2.5 },
  { ticker: "TSLA", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM"], approxEtfWeight: 1.8 },
  { ticker: "AVGO", inEtfs: ["VOO", "SPY", "IVV", "VTI", "QQQ", "QQQM", "XLK", "VGT"], approxEtfWeight: 1.9 },
  { ticker: "BRK.B", inEtfs: ["VOO", "SPY", "IVV", "VTI"], approxEtfWeight: 1.7 },
  // Canadian singles held inside XIU/XIC/XEQT
  { ticker: "RY", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 7.5 },
  { ticker: "TD", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 5.5 },
  { ticker: "BNS", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 2.5 },
  { ticker: "BMO", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 3.5 },
  { ticker: "CM",  inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 2.0 },
  { ticker: "ENB", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 4.5 },
  { ticker: "CNQ", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 3.0 },
  { ticker: "SU",  inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 1.8 },
  { ticker: "TRI", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 1.7 },
  { ticker: "SHOP", inEtfs: ["XIU", "XIC", "VCN", "XEQT", "VEQT"], approxEtfWeight: 4.5 },
];

// Very rough sector map — enough to compute a sector-exposure summary
// without loading the full sector-rotation service (which pulls FMP
// price series). Missing tickers fall into "Unclassified".
const SECTOR_MAP = new Map(Object.entries({
  // US large-cap tech
  AAPL: "Technology", MSFT: "Technology", NVDA: "Technology", GOOGL: "Communication Services",
  GOOG: "Communication Services", META: "Communication Services", AMZN: "Consumer Discretionary",
  TSLA: "Consumer Discretionary", AVGO: "Technology", ORCL: "Technology", CRM: "Technology",
  // US healthcare / staples / financials
  JNJ: "Healthcare", PFE: "Healthcare", MRK: "Healthcare", UNH: "Healthcare", LLY: "Healthcare",
  PG: "Consumer Staples", KO: "Consumer Staples", PEP: "Consumer Staples", WMT: "Consumer Staples",
  JPM: "Financials", BAC: "Financials", WFC: "Financials", BRK: "Financials", V: "Financials",
  MA: "Financials", GS: "Financials",
  // US energy / industrials
  XOM: "Energy", CVX: "Energy", COP: "Energy", SLB: "Energy",
  BA: "Industrials", CAT: "Industrials", GE: "Industrials", HON: "Industrials",
  // Cdn banks + energy + telecom
  RY: "Financials", TD: "Financials", BNS: "Financials", BMO: "Financials", CM: "Financials", NA: "Financials",
  ENB: "Energy", TRP: "Energy", CNQ: "Energy", SU: "Energy", CVE: "Energy", IMO: "Energy",
  BCE: "Communication Services", T: "Communication Services", RCI: "Communication Services",
  SHOP: "Technology", TRI: "Industrials", CP: "Industrials", CNR: "Industrials",
  // Speculative / meme
  DJT: "Communication Services", GME: "Consumer Discretionary", AMC: "Communication Services",
  MARA: "Financials", COIN: "Financials", HOOD: "Financials",
  // Broad ETFs deliberately absent — they're multi-sector by definition.
  // Sector-specific ETFs get a home:
  XLK: "Technology", VGT: "Technology", FTEC: "Technology",
  XLF: "Financials", VFH: "Financials",
  XLE: "Energy", VDE: "Energy",
  XLV: "Healthcare", VHT: "Healthcare",
  XLP: "Consumer Staples", VDC: "Consumer Staples",
  XLY: "Consumer Discretionary", VCR: "Consumer Discretionary",
  XLI: "Industrials", VIS: "Industrials",
  XLU: "Utilities", VPU: "Utilities",
  XLC: "Communication Services", VOX: "Communication Services",
  XLB: "Materials", VAW: "Materials",
  XLRE: "Real Estate", VNQ: "Real Estate",
}));

const BROAD_ETFS = new Set([
  ...OVERLAP_GROUPS.flatMap(g => [...g.members]),
]);

function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

function positionValueCad(p, fx) {
  if (!p || !(p.qty > 0)) return 0;
  if (Number.isFinite(p.priceCad)) return p.priceCad * p.qty;
  if (Number.isFinite(p.priceUsd)) return p.priceUsd * p.qty * fx;
  return 0;
}

function positionPnlPct(p) {
  if (!p || !(p.qty > 0)) return null;
  const ccy = p.ccy || "USD";
  const px = ccy === "USD" ? p.priceUsd : p.priceCad;
  const basis = p.avgCost ?? p.costBasis;
  if (!Number.isFinite(px) || !Number.isFinite(basis) || basis <= 0) return null;
  return ((px - basis) / basis) * 100;
}

export function computePortfolioHealth(profile) {
  const positions = (profile?.positions || []).filter(p => p?.ticker && (p.qty > 0));
  const accounts = profile?.accounts || [];
  const fx = profile?.fxUsdCad || 1.37;

  // Cash across accounts (positive-only for deployable purposes; report
  // both raw and deployable so the AI can see negative debit balances).
  let cashCadRaw = 0, cashUsdRaw = 0, cashCadDeployable = 0, cashUsdDeployable = 0;
  for (const a of accounts) {
    cashCadRaw += a?.cashCad || 0;
    cashUsdRaw += a?.cashUsd || 0;
    cashCadDeployable += Math.max(0, a?.cashCad || 0);
    cashUsdDeployable += Math.max(0, a?.cashUsd || 0);
  }
  const cashCadEquiv = cashCadRaw + cashUsdRaw * fx;

  // Sleeve balance (reuse the enforcer so numbers match the briefing).
  const sleeveBalance = computeSleeveBalance(positions, fx, profile?.sleeveTargets || null);
  const bookEquityCad = sleeveBalance?.book || 0;
  const bookTotalCad = bookEquityCad + cashCadEquiv;

  // Allocations — one row per position, sorted by CAD desc.
  const allocations = positions.map(p => {
    const cadValue = positionValueCad(p, fx);
    const acct = accounts.find(a => String(a.id) === String(p.acct));
    return {
      ticker: p.ticker,
      base: baseTicker(p.ticker),
      account: acct?.name || p.acct || "",
      currency: p.ccy || "USD",
      qty: p.qty,
      priceUsd: p.priceUsd || null,
      priceCad: p.priceCad || null,
      basis: p.avgCost ?? p.costBasis ?? null,
      cadValue,
      pctOfBook: bookTotalCad > 0 ? (cadValue / bookTotalCad) * 100 : 0,
      sleeve: classifyPosition(p),
      pnlPct: positionPnlPct(p),
    };
  }).sort((a, b) => b.cadValue - a.cadValue);

  // Concentration warnings — positions above 15% (warn) / 20% (breach).
  // Aggregate same-base-ticker holdings across accounts before flagging
  // (RY in RRSP + RY in Non-Spousal is one exposure).
  const byBase = new Map();
  for (const a of allocations) {
    const prev = byBase.get(a.base) || { base: a.base, cadValue: 0, tickers: new Set(), sleeves: new Set() };
    prev.cadValue += a.cadValue;
    prev.tickers.add(a.ticker);
    prev.sleeves.add(a.sleeve);
    byBase.set(a.base, prev);
  }
  const concentrations = [];
  for (const [base, agg] of byBase) {
    const pct = bookTotalCad > 0 ? (agg.cadValue / bookTotalCad) * 100 : 0;
    if (pct >= 15) {
      concentrations.push({
        base,
        tickers: [...agg.tickers],
        sleeves: [...agg.sleeves],
        pctOfBook: pct,
        cadValue: agg.cadValue,
        severity: pct >= 20 ? "breach" : "warn",
      });
    }
  }
  concentrations.sort((a, b) => b.pctOfBook - a.pctOfBook);

  // Overlap detection — ETF-of-ETFs + single-name in broad ETF.
  const heldBaseSet = new Set([...byBase.keys()]);
  const overlaps = [];
  for (const group of OVERLAP_GROUPS) {
    const held = [...group.members].filter(m => heldBaseSet.has(m));
    if (held.length >= 2) {
      const totalPct = held.reduce((s, m) => {
        const agg = byBase.get(m);
        return s + (agg && bookTotalCad > 0 ? (agg.cadValue / bookTotalCad) * 100 : 0);
      }, 0);
      overlaps.push({
        kind: "etf-family",
        label: group.label,
        held,
        totalPctOfBook: totalPct,
        note: group.note,
      });
    }
  }
  for (const rule of SINGLE_NAME_IN_ETF) {
    if (!heldBaseSet.has(rule.ticker)) continue;
    const heldEtfs = rule.inEtfs.filter(e => heldBaseSet.has(e));
    if (heldEtfs.length === 0) continue;
    const singleAgg = byBase.get(rule.ticker);
    const etfAgg = heldEtfs.reduce((s, e) => s + (byBase.get(e)?.cadValue || 0), 0);
    const etfExposureCad = etfAgg * (rule.approxEtfWeight / 100);
    const impliedPct = bookTotalCad > 0 ? (etfExposureCad / bookTotalCad) * 100 : 0;
    overlaps.push({
      kind: "single-in-etf",
      ticker: rule.ticker,
      heldInEtfs: heldEtfs,
      singleNamePctOfBook: bookTotalCad > 0 ? (singleAgg.cadValue / bookTotalCad) * 100 : 0,
      impliedEtfExposurePctOfBook: impliedPct,
      approxEtfWeight: rule.approxEtfWeight,
      note: `${rule.ticker} is ~${rule.approxEtfWeight}% of ${heldEtfs.join(" / ")}. You own it directly PLUS via the ETF(s) — adds ~${impliedPct.toFixed(1)}pp of hidden exposure.`,
    });
  }

  // Sector exposure — broad ETFs get "Multi-sector (broad ETF)" bucket
  // rather than being classified as a single sector, since assigning them
  // to any one sector would misrepresent the exposure.
  const sectorTotals = new Map();
  for (const a of allocations) {
    let sector;
    if (BROAD_ETFS.has(a.base)) sector = "Multi-sector (broad ETF)";
    else sector = SECTOR_MAP.get(a.base) || "Unclassified";
    sectorTotals.set(sector, (sectorTotals.get(sector) || 0) + a.cadValue);
  }
  const sectorExposure = [...sectorTotals.entries()]
    .map(([sector, cad]) => ({
      sector,
      cadValue: cad,
      pctOfBook: bookTotalCad > 0 ? (cad / bookTotalCad) * 100 : 0,
    }))
    .sort((a, b) => b.cadValue - a.cadValue);

  // Deterministic health score — walk sleeve targets, concentration,
  // overlaps, and cash cap. Each deduction is transparent so the UI
  // can list them ("−1.5 CORE 12.5pp underweight", etc).
  const deductions = [];
  let score = 10;
  if (sleeveBalance?.actualPct) {
    const coreGap = (sleeveBalance.targets?.core || 0) - sleeveBalance.actualPct.core;
    const specOver = sleeveBalance.actualPct.spec - (sleeveBalance.targets?.spec || 0);
    if (coreGap > 5) {
      const d = Math.min(2.5, coreGap / 10);
      deductions.push({ reason: `CORE ${coreGap.toFixed(1)}pp underweight`, points: -d });
      score -= d;
    }
    if (specOver > 2) {
      const d = Math.min(2.5, specOver / 4);
      deductions.push({ reason: `SPEC ${specOver.toFixed(1)}pp over target`, points: -d });
      score -= d;
    }
  }
  for (const c of concentrations) {
    if (c.severity === "breach") {
      deductions.push({ reason: `${c.base} concentration ${c.pctOfBook.toFixed(1)}% (breach)`, points: -1.5 });
      score -= 1.5;
    } else {
      deductions.push({ reason: `${c.base} concentration ${c.pctOfBook.toFixed(1)}% (warn)`, points: -0.75 });
      score -= 0.75;
    }
  }
  if (overlaps.some(o => o.kind === "etf-family")) {
    deductions.push({ reason: `${overlaps.filter(o => o.kind === "etf-family").length} broad-ETF overlap group(s) held`, points: -0.75 });
    score -= 0.75;
  }
  if (overlaps.filter(o => o.kind === "single-in-etf").length >= 3) {
    deductions.push({ reason: `${overlaps.filter(o => o.kind === "single-in-etf").length} single-names duplicated via broad ETFs`, points: -0.5 });
    score -= 0.5;
  }
  const cashPct = bookTotalCad > 0 ? (cashCadEquiv / bookTotalCad) * 100 : 0;
  if (cashPct > 15) {
    const d = Math.min(1.5, (cashPct - 15) / 10);
    deductions.push({ reason: `Cash ${cashPct.toFixed(1)}% of book (drag)`, points: -d });
    score -= d;
  }
  if (cashCadRaw < 0 || cashUsdRaw < 0) {
    deductions.push({ reason: `Debit cash balance in one or more accounts`, points: -0.5 });
    score -= 0.5;
  }
  // Tax placement — US-dividend / US-ETF positions in the wrong
  // account. Only "warn"-severity items count against the score
  // (recoverable-via-FTC "info" items are noted but not penalized).
  const taxPlacement = analyzeTaxPlacement(positions, accounts, { fxUsdCad: fx });
  const warnPlacements = taxPlacement.flagged.filter(f => f.severity === "warn");
  if (warnPlacements.length > 0) {
    const dragBps = bookTotalCad > 0
      ? (warnPlacements.reduce((s, f) => s + f.annualDragCad, 0) / bookTotalCad) * 10000
      : 0;
    // Small deduction proportional to book-level drag, capped so a
    // single misplaced $500 KO position doesn't move the needle
    // more than a broken sleeve target.
    const d = Math.min(1.0, dragBps / 20); // 20 bps drag → 1.0 point
    if (d >= 0.1) {
      deductions.push({
        reason: `${warnPlacements.length} US-dividend/ETF position(s) in TFSA — ~${dragBps.toFixed(0)}bps annual drag from unrecoverable US withholding`,
        points: -d,
      });
      score -= d;
    }
  }
  score = Math.max(0, Math.round(score * 10) / 10);

  return {
    generatedAt: new Date(),
    bookEquityCad,
    bookTotalCad,
    cash: {
      cadRaw: cashCadRaw, usdRaw: cashUsdRaw,
      cadDeployable: cashCadDeployable, usdDeployable: cashUsdDeployable,
      cadEquivTotal: cashCadEquiv,
      pctOfBook: cashPct,
    },
    fxUsdCad: fx,
    allocations,
    sleeves: sleeveBalance,
    concentrations,
    overlaps,
    sectorExposure,
    taxPlacement,
    deductions,
    healthScore: score,
    positionCount: allocations.length,
    accountCount: accounts.length,
  };
}
