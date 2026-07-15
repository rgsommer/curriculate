// backend/services/stocksShortInterest.js
//
// Short interest + squeeze-setup detector. Data pulled from Yahoo
// quoteSummary (defaultKeyStatistics module) — same FINRA source
// FMP would use, free, no quota hit. Updated bimonthly (mid + end
// of month) per FINRA schedule, so 24h cache is more than enough.
//
// Signals emitted:
//   • siPctOfFloat, sharesShort, floatShares  (raw)
//   • dtc (days-to-cover) = sharesShort / avgDailyVolume
//   • momChangePct = change vs prior-month reporting date
//   • squeezeScore 0-100 with contributor list
//   • setupType: "short-squeeze-candidate" | "high-si-warning" | null
//
// Score is composed of documented squeeze mechanics:
//   BASE:   SI > 20% of float → +25; SI > 15% → +15; SI > 10% → +8
//   +DTC:   DTC > 8 → +20; DTC > 5 → +12; DTC > 3 → +6
//   +MOM:   SI rising MoM → +10; falling → 0
//   +TREND: price above SMA50 (uptrend crushing shorts) → +15
//   +VOL:   RVOL > 2 (short cover pressure visible) → +10
//   +FLOAT: floatShares < 50M (tiny float amplifies) → +10
//   KILL:   downtrend AND SI falling → cap score at 30
//           (no squeeze setup when shorts are winning + reducing)

const CACHE = new Map(); // sym → { fetchedAt, data }
const TTL_MS = 24 * 60 * 60 * 1000;
const YAHOO_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary/";

function resolveSymbol(ticker, currency) {
  const t = String(ticker || "").toUpperCase().trim();
  if (t.includes(".")) return t;
  if (currency === "CAD") return `${t}.TO`;
  return t;
}

async function fetchShortInterestRaw(sym) {
  const url = `${YAHOO_URL}${encodeURIComponent(sym)}?modules=defaultKeyStatistics,summaryDetail`;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Curriculate Short Interest)" } });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.quoteSummary?.result?.[0] || null;
  } catch { return null; } finally { clearTimeout(tid); }
}

// Compute the squeeze-setup score given raw short data + optional tech context.
// tech is the OPTIONAL getTechnicals output — used for uptrend / RVOL amplifiers.
function scoreSqueeze({ siPctOfFloat, dtc, momChangePct, floatShares }, tech = null) {
  let score = 0;
  const contributors = [];
  const add = (pts, label) => { score += pts; contributors.push(`${label} → +${pts}`); };

  // Base SI %
  if (siPctOfFloat != null) {
    if (siPctOfFloat >= 20) add(25, `SI ${siPctOfFloat.toFixed(1)}% of float (very high)`);
    else if (siPctOfFloat >= 15) add(15, `SI ${siPctOfFloat.toFixed(1)}% of float (high)`);
    else if (siPctOfFloat >= 10) add(8, `SI ${siPctOfFloat.toFixed(1)}% of float (elevated)`);
  }
  // DTC
  if (dtc != null) {
    if (dtc >= 8) add(20, `DTC ${dtc.toFixed(1)}d — shorts trapped, buy-back takes a week+`);
    else if (dtc >= 5) add(12, `DTC ${dtc.toFixed(1)}d — meaningful cover pressure`);
    else if (dtc >= 3) add(6, `DTC ${dtc.toFixed(1)}d`);
  }
  // MoM change (increasing SI while price rises = fuel; falling = shorts covering)
  if (momChangePct != null) {
    if (momChangePct > 15) add(10, `SI +${momChangePct.toFixed(0)}% vs prior month — shorts adding fuel`);
    else if (momChangePct > 5) add(5, `SI rising +${momChangePct.toFixed(0)}% MoM`);
  }
  // Trend confirming (price above SMA50 = shorts underwater on new positions)
  if (tech?.ok && tech.priceVsSma50 != null && tech.priceVsSma50 > 0) {
    add(15, `Price +${tech.priceVsSma50.toFixed(0)}% above SMA50 (shorts underwater)`);
  }
  // Volume spike showing cover pressure
  if (tech?.volume?.rvol != null && tech.volume.rvol >= 2) {
    add(10, `RVOL ${tech.volume.rvol.toFixed(1)}x — likely cover buying visible`);
  }
  // Tiny float amplifies
  if (floatShares != null && floatShares < 50_000_000) {
    add(10, `Tiny float ${(floatShares / 1e6).toFixed(0)}M — amplifies moves`);
  }

  // Kill switch: downtrend AND SI falling means shorts are winning.
  let killed = false;
  if (tech?.ok && tech.priceVsSma50 != null && tech.priceVsSma50 < -5 && momChangePct != null && momChangePct < 0) {
    if (score > 30) contributors.push(`⚠ KILL: downtrend + shorts covering — not a squeeze setup`);
    score = Math.min(30, score);
    killed = true;
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), contributors, killed };
}

export async function getShortInterest(ticker, currency = null, tech = null) {
  const sym = resolveSymbol(ticker, currency);
  const now = Date.now();
  const cached = CACHE.get(sym);
  if (cached && now - cached.fetchedAt < TTL_MS) {
    // Re-score if tech changed (tech isn't cached with the SI data since
    // getTechnicals has its own cache — cheap to re-score in-memory).
    return { ...cached.data, squeeze: scoreSqueeze(cached.data.raw, tech), _tech: !!tech };
  }

  const summary = await fetchShortInterestRaw(sym);
  if (!summary) {
    const empty = { ok: false, reason: "quoteSummary unavailable" };
    CACHE.set(sym, { fetchedAt: now, data: empty });
    return empty;
  }

  const dks = summary.defaultKeyStatistics || {};
  const sd = summary.summaryDetail || {};
  const num = (v) => (v && typeof v === "object" && Number.isFinite(v.raw) ? v.raw : (Number.isFinite(v) ? v : null));

  const sharesShort = num(dks.sharesShort);
  const sharesShortPriorMonth = num(dks.sharesShortPriorMonth);
  const shortPercentOfFloat = num(dks.shortPercentOfFloat);
  const floatShares = num(dks.floatShares);
  const shortRatio = num(dks.shortRatio); // Yahoo's own DTC
  const dateShortInterest = num(dks.dateShortInterest);
  const avgVolume10day = num(sd.averageDailyVolume10Day) || num(sd.averageVolume10days);

  // If Yahoo doesn't give shortPercentOfFloat directly (they omit it for
  // some symbols), derive it from sharesShort / floatShares.
  const siPct = (shortPercentOfFloat != null && shortPercentOfFloat > 0)
    ? shortPercentOfFloat * 100
    : (sharesShort != null && floatShares != null && floatShares > 0) ? (sharesShort / floatShares) * 100 : null;

  // Derive DTC ourselves if Yahoo doesn't provide.
  const dtc = shortRatio != null && shortRatio > 0
    ? shortRatio
    : (sharesShort != null && avgVolume10day > 0) ? sharesShort / avgVolume10day : null;

  const momChangePct = (sharesShort != null && sharesShortPriorMonth != null && sharesShortPriorMonth > 0)
    ? ((sharesShort - sharesShortPriorMonth) / sharesShortPriorMonth) * 100
    : null;

  const raw = {
    sharesShort, sharesShortPriorMonth, floatShares,
    siPctOfFloat: siPct, dtc, momChangePct,
    reportDate: dateShortInterest ? new Date(dateShortInterest * 1000).toISOString().slice(0, 10) : null,
    avgVolume10day,
  };

  const squeeze = scoreSqueeze(raw, tech);

  // Setup classification for consumers that want a simple label.
  let setupType = null;
  if (!squeeze.killed) {
    if (squeeze.score >= 60) setupType = "short-squeeze-candidate";
    else if (siPct != null && siPct >= 15) setupType = "high-si-warning";
  }

  const data = { ok: true, raw, squeeze, setupType };
  CACHE.set(sym, { fetchedAt: now, data });
  return data;
}

export function formatShortInterestLine(si) {
  if (!si || !si.ok || !si.raw) return null;
  const r = si.raw;
  const parts = [];
  if (r.siPctOfFloat != null) {
    const flag = r.siPctOfFloat >= 20 ? " 🔥" : r.siPctOfFloat >= 15 ? " ⚡" : "";
    parts.push(`SI ${r.siPctOfFloat.toFixed(1)}% of float${flag}`);
  }
  if (r.dtc != null) parts.push(`DTC ${r.dtc.toFixed(1)}d`);
  if (r.momChangePct != null) {
    parts.push(`MoM ${r.momChangePct >= 0 ? "+" : ""}${r.momChangePct.toFixed(0)}%`);
  }
  if (r.floatShares != null) parts.push(`float ${(r.floatShares / 1e6).toFixed(0)}M`);
  if (si.setupType === "short-squeeze-candidate") parts.push(`🎯 SQUEEZE SETUP score ${si.squeeze.score}`);
  else if (si.setupType === "high-si-warning") parts.push(`⚠ high-SI (score ${si.squeeze.score})`);
  if (r.reportDate) parts.push(`as of ${r.reportDate}`);
  return parts.length ? `Short: ${parts.join(" · ")}` : null;
}
