// backend/services/stocksThemesService.js
//
// Theme-first discovery gate. A candidate can only surface as a SPEC
// idea if its ticker is a member of at least one ENABLED theme in the
// user's theme list. Themes are seeded with sensible defaults on
// first access so a new user gets the gate active immediately without
// configuration.

import StocksThemes from "../models/StocksThemes.js";

// Default seed. Kept short and specific — not "the whole market
// bucketed", just a handful of durable structural bets where a
// multi-quarter thesis is defensible. User can edit any of these
// or add their own via the API / settings page.
const DEFAULT_THEMES = [
  {
    name: "AI Infrastructure",
    description:
      "Multi-year AI compute buildout — chip design, packaging, memory, networking, data-center power and cooling. Secular capex cycle by hyperscalers with multi-year visibility.",
    tickers: [
      "NVDA", "AMD", "TSM", "ASML", "AVGO", "MRVL", "ANET",
      "SMCI", "DELL", "VRT", "PWR", "ETN", "ELV", "CEG",
      "ORCL", "SNOW", "PLTR", "CRWD", "ARM", "MU", "AMAT", "LRCX", "KLAC",
    ],
    keywords: ["ai infrastructure", "hyperscaler", "data center", "gpu", "accelerator", "compute buildout"],
    enabled: true,
  },
  {
    name: "Canadian Energy Infrastructure",
    description:
      "Long-lived Canadian midstream and pipeline assets — TSA cash flows, regulated rate bases, sustained supply-side discipline post-COVID. Multi-decade tailwind from North-American energy security + LNG export capacity.",
    tickers: ["ENB", "TRP", "PPL", "KEY", "ALA", "GEI", "SES", "TOU", "AAV", "WCP"],
    keywords: ["pipeline", "midstream", "lng", "energy infrastructure", "regulated utility"],
    enabled: true,
  },
  {
    name: "High-Quality Canadian Compounders",
    description:
      "Canadian names with high ROIC, durable competitive advantages, disciplined capital allocation, and long compounding runways. Insurance, financials, and industrials with proven cycle-through capability.",
    tickers: [
      "BN", "BAM", "TRI", "FFH", "ATZ", "GSY", "EQB", "DOL",
      "CSU", "WSP", "TIH", "BYD", "SU", "IFC", "L", "MFC", "SLF",
    ],
    keywords: ["compounder", "high roic", "capital allocation", "moat", "cash flow"],
    enabled: true,
  },
  {
    name: "Energy Transition & Electrification",
    description:
      "Multi-decade shift to electrification, grid modernization, renewables, and battery infrastructure. Policy tailwind (IRA, CHIPS-like grid acts) plus real supply-side constraints on transformers, grid components, and metals.",
    tickers: [
      "FSLR", "ENPH", "NEE", "AWK", "AGCO", "ETN", "ALB", "LIT", "ICLN",
      "TT", "CARR", "GNRC", "PWR", "MYR", "AY",
    ],
    keywords: ["energy transition", "electrification", "grid modernization", "renewables", "battery"],
    enabled: true,
  },
  {
    name: "US Financials (Rate-Cycle Leverage)",
    description:
      "Diversified US banks + capital-markets platforms benefiting from steepening yield curve, sustained loan-growth reacceleration, and normalizing NIMs. High-quality franchises with disciplined credit cultures.",
    tickers: [
      "JPM", "BAC", "WFC", "C", "GS", "MS", "BLK", "SCHW", "AMP",
      "PGR", "TRV", "BX", "KKR", "APO", "V", "MA", "SPGI", "MCO",
    ],
    keywords: ["bank", "capital markets", "credit cycle", "net interest margin", "yield curve", "insurance"],
    enabled: true,
  },
  {
    name: "US Healthcare Innovation",
    description:
      "Structural US healthcare demand from an aging population plus a durable pricing power in device / diagnostic leaders and platform pharma with long patent tails. GLP-1 supply constraints, oncology pipeline maturation, minimally-invasive procedure adoption.",
    tickers: [
      "LLY", "NVO", "UNH", "ABBV", "MRK", "TMO", "DHR", "ISRG",
      "SYK", "BSX", "MDT", "VRTX", "REGN", "ELV",
    ],
    keywords: ["glp-1", "oncology", "medical device", "aging population", "healthcare demand"],
    enabled: true,
  },
  {
    name: "Semiconductor Cycle",
    description:
      "Broad semiconductor cycle recovery + AI-driven leg — memory (HBM), advanced packaging, wafer-fab equipment (WFE), and analog/foundry. Multi-year supply-demand tightness driven by hyperscaler capex + reshoring.",
    tickers: [
      "TSM", "ASML", "AMAT", "LRCX", "KLAC", "MU", "MRVL", "AVGO",
      "ADI", "TXN", "NXPI", "MCHP", "ON",
    ],
    keywords: ["semiconductor", "wafer fab", "foundry", "hbm", "advanced packaging", "chip cycle"],
    enabled: true,
  },
  {
    name: "Defence & Security",
    description:
      "Multi-year defence spend acceleration — NATO reset, US budget shifts to munitions replenishment and missile-defence, allied procurement cycles. Long-cycle contracts with visible backlogs.",
    tickers: ["LMT", "RTX", "NOC", "GD", "LDOS", "HII", "TXT", "BA.TO"],
    keywords: ["defence", "defense", "missile", "munitions", "nato", "military spending"],
    enabled: true,
  },
  {
    name: "Uranium & Nuclear Renaissance",
    description:
      "Structural uranium supply deficit — new reactor builds (SMRs), grid decarbonization, restarts of idle capacity. Multi-year price re-rating with contracted utility demand ramping into 2027–2030.",
    tickers: ["CCJ", "URA", "URNM", "SMR", "NNE", "BWXT", "LEU"],
    keywords: ["uranium", "nuclear", "smr", "small modular reactor", "reactor", "yellowcake"],
    enabled: true,
  },
  {
    name: "Copper & Critical Minerals",
    description:
      "Structural copper deficit vs electrification + AI-data-center demand. Long lead times on new mines (7–10 years) + declining ore grades keep the incentive price rising. Also lithium, nickel, rare earths where supply is Western-security constrained.",
    tickers: ["FCX", "SCCO", "TECK", "BHP", "RIO", "IVN.TO", "ERO.TO", "ALB", "MP"],
    keywords: ["copper", "critical mineral", "lithium", "rare earth", "mining", "ore grade"],
    enabled: true,
  },
];

// Strip exchange suffix for membership comparison. XIU.TO and XIU
// hit the same bucket; RY (US ADR) and RY.TO (TSX listing) collapse
// to the same base ticker.
export function baseTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
}

// Fetch (and seed on first access) the user's themes document. Never
// throws — falls back to the default seed in memory if the DB write
// fails, so the pick engine keeps working.
//
// Idempotent merge: on every fetch, add any DEFAULT_THEMES the user
// doesn't already have (by name). Lets us expand the seed list
// (added US Financials / Healthcare / Semis / Defence / Uranium /
// Copper etc after the initial 4-theme seed) and have existing
// users pick them up automatically. User-edited themes are never
// overwritten — only NEW theme names get appended.
export async function getOrSeedThemesForUser(email) {
  const key = String(email || "").toLowerCase();
  if (!key) return { themes: DEFAULT_THEMES };
  try {
    let doc = await StocksThemes.findOne({ email: key });
    if (!doc) {
      doc = await StocksThemes.create({ email: key, themes: DEFAULT_THEMES });
      console.log(`[themes] seeded ${DEFAULT_THEMES.length} default themes for ${key}`);
      return { themes: doc.themes || [] };
    }
    // Merge in any default theme name the user doesn't have yet.
    const existingNames = new Set((doc.themes || []).map(t => String(t?.name || "").toLowerCase()));
    const missing = DEFAULT_THEMES.filter(t => !existingNames.has(String(t.name).toLowerCase()));
    if (missing.length > 0) {
      doc.themes.push(...missing);
      await doc.save();
      console.log(`[themes] merged ${missing.length} new default theme(s) for ${key}: ${missing.map(t => t.name).join(", ")}`);
    }
    return { themes: doc.themes || [] };
  } catch (e) {
    console.warn(`[themes] fetch/seed failed for ${key}: ${e?.message}. Falling back to in-memory defaults.`);
    return { themes: DEFAULT_THEMES };
  }
}

// Build a Set of all base tickers approved across enabled themes.
export async function getApprovedTickers(email) {
  const { themes } = await getOrSeedThemesForUser(email);
  const approved = new Set();
  for (const t of (themes || [])) {
    if (!t?.enabled) continue;
    for (const tk of (t.tickers || [])) {
      const b = baseTicker(tk);
      if (b) approved.add(b);
    }
  }
  return approved;
}

// Return the theme name(s) a ticker belongs to (for tagging / audit).
// Empty array = ticker is not in any enabled theme.
export async function themesContainingTicker(email, ticker) {
  const base = baseTicker(ticker);
  if (!base) return [];
  const { themes } = await getOrSeedThemesForUser(email);
  const hits = [];
  for (const t of (themes || [])) {
    if (!t?.enabled) continue;
    for (const tk of (t.tickers || [])) {
      if (baseTicker(tk) === base) { hits.push(t.name); break; }
    }
  }
  return hits;
}

// Convenience for the pick engine — returns boolean membership.
export async function isTickerInApprovedTheme(email, ticker) {
  const hits = await themesContainingTicker(email, ticker);
  return hits.length > 0;
}
