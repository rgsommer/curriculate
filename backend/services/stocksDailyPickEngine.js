// backend/services/stocksDailyPickEngine.js
//
// Picks the top N candidates for the forced-daily-pick discipline. Runs
// AT DECISION TIME (weekday morning cron) — no lookahead concern here
// because "now" is genuinely now. The concern the harness protects
// against is not lookahead but SURVIVORSHIP: every pick this engine
// makes gets persisted and tracked to close, even the losers.
//
// Scoring is deterministic + transparent so we can audit later. No
// LLM judgment involved.

import { getTechnicals } from "./stocksTechnicals.js";
import { fetchYahooDaily } from "./stocksDiscoveryScore.js";
import { computeLessons } from "./stocksLessonsLearned.js";
import { getApprovedTickers, themesContainingTicker } from "./stocksThemesService.js";
import { classifyPosition } from "./stocksSleeveEnforcer.js";
import StocksPortfolio from "../models/StocksPortfolio.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";
import StocksDiscoveryCandidate from "../models/StocksDiscoveryCandidate.js";
import StocksDailyPick from "../models/StocksDailyPick.js";

// Per-setup expectancy — surgical kill of losing setup types. The
// engine-wide kill switch (shouldSuppressPicks) either lets all
// picks through or blocks all of them; that lets a proven setup
// (say, ETF trend follow) get suppressed just because a losing
// setup (e.g. pocket pivot) is dragging the aggregate down. This
// finer gate reads closed StocksDailyPick history grouped by
// setupName and returns a Set of setups to REMOVE from generation.
//
// Thresholds: ≥10 closed samples AND (win rate < 30% OR avg PnL
// < -3.0%) → banned until the sample recovers. Sub-sample setups
// (< 10 closed) are given the benefit of the doubt.
const SETUP_BAN_MIN_SAMPLE = 10;
const SETUP_BAN_MAX_HIT_RATE = 30;
const SETUP_BAN_MAX_AVG_PNL = -3.0;
async function computeBannedSetups(email) {
  try {
    const closed = await StocksDailyPick.find({
      email: email.toLowerCase(),
      status: { $in: ["target-hit", "stop-hit", "horizon-exit", "closed-manual"] },
      setupName: { $ne: null },
      pnlPct: { $ne: null },
    }).select("setupName pnlPct").lean();
    const stats = new Map();
    for (const p of closed) {
      const name = String(p.setupName || "").trim();
      if (!name) continue;
      if (!stats.has(name)) stats.set(name, { total: 0, wins: 0, sumPnl: 0 });
      const s = stats.get(name);
      s.total += 1;
      s.sumPnl += p.pnlPct;
      if (p.pnlPct > 0) s.wins += 1;
    }
    const banned = new Set();
    const summary = [];
    for (const [name, s] of stats.entries()) {
      const hitRate = s.total > 0 ? (s.wins / s.total) * 100 : 0;
      const avgPnl = s.total > 0 ? s.sumPnl / s.total : 0;
      const isBanned = s.total >= SETUP_BAN_MIN_SAMPLE
        && (hitRate < SETUP_BAN_MAX_HIT_RATE || avgPnl < SETUP_BAN_MAX_AVG_PNL);
      if (isBanned) banned.add(name);
      summary.push(`${name}=${s.wins}/${s.total} (${hitRate.toFixed(0)}%, avg ${avgPnl.toFixed(1)}%)${isBanned ? " BANNED" : ""}`);
    }
    if (summary.length > 0) {
      console.log(`[pick-engine-per-setup] ${email}: ${summary.join(" · ")}`);
    }
    return banned;
  } catch (e) {
    console.warn("[pick-engine-per-setup] compute failed:", e?.message);
    return new Set();
  }
}

// Kill-switch thresholds for the discretionary pick engine. If the
// user's recent track record shows the engine is destroying capital
// (low hit rate on scored recs, or the mark-to-market average is
// deeply negative), stop emitting NEW picks until performance
// recovers. Rationale: every pick we emit gets executed, sized, and
// tracked to close — a losing engine that keeps emitting is a
// capital-shredder. Silent suppression here is preferable to
// piling more losers into the pool.
//
// Per user directive (Aug 5): "fix the systemic barrier to finding
// wins" — the barrier IS this engine when its expectancy is negative.
// Kill switch is automatic on the metric, not manual, so it takes
// effect the moment the numbers go bad without waiting for a manual
// flip.
const KILL_MIN_HIT_RATE_PCT = 40;    // 30d hit rate must clear this
const KILL_MIN_AVG_PNL_PCT = -1.5;   // 30d avg pnl must clear this
const KILL_MIN_SAMPLE_SIZE = 5;      // need at least this many scored recs to judge
const CANARY_WINDOW_DAYS = 7;        // always let at least 1 pick through per rolling window
const CANARY_MAX_PICKS = 1;          // even when the kill switch is suppressing
async function shouldSuppressPicks(email) {
  try {
    const lessons = await computeLessons(email);
    const t30 = lessons?.trend?.["30d"];
    if (!t30 || t30.total < KILL_MIN_SAMPLE_SIZE) {
      // Not enough data to judge — let the engine run. Once ≥5 scored
      // recs land in the 30d window the metric-based gate takes over.
      return { suppress: false, reason: `sample too small (${t30?.total || 0} < ${KILL_MIN_SAMPLE_SIZE})`, canary: false };
    }
    const failsHitRate = t30.hitRate < KILL_MIN_HIT_RATE_PCT;
    const failsPnl = t30.avgPnl < KILL_MIN_AVG_PNL_PCT;
    if (!failsHitRate && !failsPnl) {
      return { suppress: false, reason: `30d ${t30.wins}/${t30.total} = ${t30.hitRate.toFixed(0)}%, avg ${t30.avgPnl.toFixed(1)}%`, canary: false };
    }
    // Kill switch WOULD fire, but check canary — if we haven't emitted
    // any CANARY-flagged pick in the last CANARY_WINDOW_DAYS days, let
    // ONE through. Rationale: a fully-suppressed engine has no way to
    // close new trades and recover the hit rate, so the gate stays shut
    // forever. Counting only viaCanary===true picks means the canary
    // isn't blocked by pre-kill-switch cron output (from before the
    // kill switch shipped) — those existing docs just sit in the DB
    // and the canary can still fire against a fresh sample.
    const cutoff = new Date(Date.now() - CANARY_WINDOW_DAYS * 86400 * 1000);
    const recentCanaryPicks = await StocksDailyPick.countDocuments({
      email: email.toLowerCase(),
      pickDate: { $gte: cutoff },
      viaCanary: true,
    });
    const suppressReason = failsHitRate
      ? `30d hit rate ${t30.hitRate.toFixed(0)}% < ${KILL_MIN_HIT_RATE_PCT}% floor (${t30.wins}/${t30.total} wins)`
      : `30d avg PnL ${t30.avgPnl.toFixed(1)}% < ${KILL_MIN_AVG_PNL_PCT}% floor`;
    if (recentCanaryPicks < CANARY_MAX_PICKS) {
      return {
        suppress: false,
        canary: true,
        reason: `CANARY: ${suppressReason} would suppress, but ${recentCanaryPicks}/${CANARY_MAX_PICKS} viaCanary picks in last ${CANARY_WINDOW_DAYS}d → letting 1 through to keep sampling. Engine STILL under review — all other gates (SPEC, theme, per-setup ban) remain enforced.`,
      };
    }
    return {
      suppress: true,
      canary: false,
      reason: `${suppressReason}. Canary already fired this window (${recentCanaryPicks}/${CANARY_MAX_PICKS} viaCanary picks in last ${CANARY_WINDOW_DAYS}d).`,
    };
  } catch (e) {
    // Fail-open: if lessons computation errors, don't silently block
    // the engine — that would look identical to legitimate suppression.
    console.warn("[pick-engine-kill-switch] lessons compute failed:", e?.message);
    return { suppress: false, reason: `lessons unavailable (${e?.message})`, canary: false };
  }
}

// Summarise the current pick-engine state for surfacing in §3 Status
// of the briefing. Grok Aug 6 audit — "an external reader can't
// confirm the gates are live from the briefing alone." A one-line
// status makes the invisible visible: kill-switch state, banned
// setup names, count of always-active gates.
//
// Never throws — degrades to { active: [static list], killSwitch:
// "unknown", bannedSetups: [] } on any error.
export async function getPickEngineStatus(email) {
  const alwaysActive = [
    "SPEC-thesisHorizonMonths",
    "SPEC-structuralDriver",
    "per-setup-ban",
    "theme-first",
    "kill-switch",
    "canary",
  ];
  try {
    const [gate, banned] = await Promise.all([
      shouldSuppressPicks(email),
      computeBannedSetups(email),
    ]);
    const killSwitch = gate.suppress ? "SUPPRESSED"
                     : gate.canary   ? "CANARY"
                                     : "CLEAR";
    return {
      active: alwaysActive,
      killSwitch,
      killSwitchReason: gate.reason || "",
      bannedSetups: [...banned],
    };
  } catch (e) {
    console.warn("[pick-engine-status] compute failed:", e?.message);
    return { active: alwaysActive, killSwitch: "UNKNOWN", killSwitchReason: e?.message, bannedSetups: [] };
  }
}

// A small hand-curated universe of large-cap liquid names for cases
// when the user's own portfolio + recent recs give too few candidates.
// Not "the best stocks" — just "always-tradeable defaults" so the cron
// never has to skip a day due to empty universe. Overridden by the
// user's actual portfolio + recent research pool when available.
//
// Mix of US mega-caps + major TSX names. TSX names are suffixed .TO so
// the currency-detection helper picks CAD listings automatically. The
// user's Canadian book (RY.TO, ENB.TO etc.) has been the only
// consistent winner per the trade journal AI analysis — extending the
// universe to include those setups by default so the deterministic
// engine can find repeat opportunities.
const DEFAULT_UNIVERSE = [
  // US mega-caps
  "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "AVGO", "TSLA", "AMD", "NFLX",
  // US index proxies
  "SPY", "QQQ", "IWM",
  // Canadian banks + insurers (the trader's proven winning template)
  "RY.TO", "TD.TO", "BMO.TO", "BNS.TO", "CM.TO", "NA.TO", "MFC.TO", "SLF.TO",
  // Canadian energy + utilities
  "ENB.TO", "TRP.TO", "CNQ.TO", "SU.TO", "FTS.TO", "H.TO",
  // Canadian tech + growth
  "SHOP.TO", "CSU.TO", "BN.TO", "CP.TO",
  // Canadian index proxies
  "XIU.TO", "XIC.TO",
];

// Detect the native currency from the ticker suffix — TSX / TSXV / NEO
// / Canadian NEX listings all trade CAD, everything else defaults USD.
function currencyFromTicker(ticker) {
  return /\.(TO|V|NE|CN)$/i.test(String(ticker || "")) ? "CAD" : "USD";
}
// Compare tickers ignoring exchange suffix so exclude sets built from
// portfolio positions ("RY") match universe entries ("RY.TO").
function normalizeTicker(t) {
  return String(t || "").toUpperCase().replace(/\..*$/, "");
}

function pctBetween(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / a) * 100;
}

// Deterministic composite from OHLC-derived signals only.
//   +Trend: SMA50 above SMA200 & price above SMA50 (0-25)
//   +Momentum: RSI 50-65 sweet spot (0-15)
//   +Volume: RVOL > 1.5 OR pocket pivot OR OBV accumulation (0-15)
//   +Setup: named setup present (VCP/bull flag/coiled spring/inside-day) (0-25)
//   +MTF: aligned up (0-15) — requires opts.includeMultiTimeframe upstream
//   -Kill: RSI > 75 (overbought), price below SMA50 (downtrend) — subtract 30
function scoreCandidate(tech) {
  if (!tech?.ok) return { score: 0, contributors: ["tech unavailable"], contributions: [] };
  let score = 0;
  // Two parallel arrays. `contributors` is the human-readable display
  // string ("trend up (…) +25"). `contributions` is the numeric delta
  // used by the reconciliation audit — no regex parsing of a string
  // that contains embedded percentages. Prior code parsed the first
  // signed number out of the display string ("+5.1" from an inline
  // priceVsSma50 echo) instead of the trailing score delta ("+25"),
  // making the reconciliation math bogus. This fixes the input to the
  // audit — the audit itself lives in briefingAudit.js.
  const contributors = [];
  const contributions = [];
  const add = (pts, why) => {
    score += pts;
    if (pts > 0) contributors.push(`${why} +${pts}`);
    else if (pts < 0) contributors.push(`${why} ${pts}`);
    if (pts !== 0) contributions.push({ label: why, delta: pts });
  };

  // Trend
  if (tech.sma50 && tech.sma200 && tech.last) {
    if (tech.sma50 > tech.sma200 && tech.priceVsSma50 >= 0) add(25, `trend up (SMA50>SMA200, price +${tech.priceVsSma50.toFixed(1)}% > SMA50)`);
    else if (tech.priceVsSma50 >= 0) add(10, `above SMA50 but SMA50<SMA200`);
  }

  // Momentum — soft slope. RSI is a trend measure, not a top-picker
  // (Wilder's original guidance). Prior version hard-killed RSI>75 at
  // −30, which systematically excluded every trend leader (NVDA/PLTR-in-
  // uptrend types typically sit at 75-90 for weeks). Vet audit Aug-28
  // identified this as the single largest anti-winner tax in the code.
  // New curve rewards trend across the full healthy range, tapers only
  // at true blow-off (>92), never punishes trend continuation with a
  // negative delta:
  //   RSI 40-50: +8  (recovering)
  //   RSI 50-65: +15 (sweet spot)
  //   RSI 65-75: +15 (trend continuation)
  //   RSI 75-85: +10 (strong uptrend — the "leader" zone)
  //   RSI 85-92: +5  (extended but still legitimate)
  //   RSI >92:   0   (blow-off risk — neutral, not negative)
  if (tech.rsi14 != null) {
    if (tech.rsi14 >= 40 && tech.rsi14 < 50) add(8, `RSI ${tech.rsi14.toFixed(0)} recovering`);
    else if (tech.rsi14 >= 50 && tech.rsi14 <= 65) add(15, `RSI ${tech.rsi14.toFixed(0)} sweet spot`);
    else if (tech.rsi14 > 65 && tech.rsi14 <= 75) add(15, `RSI ${tech.rsi14.toFixed(0)} trend continuation`);
    else if (tech.rsi14 > 75 && tech.rsi14 <= 85) add(10, `RSI ${tech.rsi14.toFixed(0)} strong uptrend`);
    else if (tech.rsi14 > 85 && tech.rsi14 <= 92) add(5, `RSI ${tech.rsi14.toFixed(0)} extended`);
    // RSI > 92: neutral (no add). Blow-off risk, but no punitive kill —
    // the actual thesis, R/R, and MTF gates below handle timing.
  }

  // Volume
  if (tech.volume?.rvol >= 1.5) add(8, `RVOL ${tech.volume.rvol.toFixed(2)}x`);
  // Pocket-pivot dedup — the volume flag ("today's up-day volume
  // exceeds the prior N-day down-day peak") and the multi-day
  // chart-pattern detector can BOTH label the same event "pocket
  // pivot", which the operator reads as double-counting. When the
  // multi-day detector already named itself "Pocket pivot", suppress
  // the flag's +10 so exactly one contribution is emitted. The
  // multi-day setup below still adds its score.
  const bullSetup = (tech.setups || []).find((s) => s.type === "bullish");
  const bullSetupIsPocketPivot = bullSetup && /pocket\s*pivot/i.test(bullSetup.name || "");
  if (tech.volume?.pocketPivot && !bullSetupIsPocketPivot) add(10, `pocket pivot`);
  if (tech.volume?.obvTrend === "accumulation") add(4, `OBV accumulation`);

  // Setup — take the strongest bullish setup's score contribution
  if (bullSetup) add(Math.min(25, Math.round(bullSetup.score / 4)), `${bullSetup.name} (${bullSetup.score})`);

  // MTF
  if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "up") add(15, `MTF aligned up`);
  else if (tech.mtf?.confluence === "aligned" && tech.mtf.direction === "down") add(-15, `MTF aligned DOWN — killed`);
  else if (tech.mtf?.confluence === "conflicting") add(-5, `MTF conflicting`);

  // Kill: price below SMA50 = downtrend. Halved from -20 to -10 (audit
  // Aug-28): the prior -20 punished the "handle" of every cup-and-handle
  // by 20 pts, often dropping legitimate pullback-to-support entries
  // below minScore. -10 still expresses "below trend is a headwind" but
  // no longer dominates a pick's composite when everything else is right.
  if (tech.priceVsSma50 != null && tech.priceVsSma50 < -3) add(-10, `below SMA50 (${tech.priceVsSma50.toFixed(1)}%)`);

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, contributors, contributions, rawSum: score };
}

async function resolveUniverseForUser(email) {
  const universe = new Set(DEFAULT_UNIVERSE);
  // User's current portfolio positions
  try {
    const p = await StocksPortfolio.findOne({ email }).select({ "positions.ticker": 1, "positions.currency": 1 }).lean();
    for (const pos of p?.positions || []) {
      const t = String(pos.ticker || "").toUpperCase();
      if (t) universe.add(t);
    }
  } catch { /* ignore */ }
  // Recent high-conviction discovery picks (last 60d) — a research-vetted pool
  try {
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const cands = await StocksDiscoveryCandidate.find({ email, scanDate: { $gte: since } }).select({ ticker: 1 }).lean().limit(60);
    for (const c of cands) universe.add(String(c.ticker).toUpperCase());
  } catch { /* ignore */ }
  // Tickers the AI has already recommended in last 90d (fair game — they're
  // known to us and we're not selecting from a broader survivorship-biased set)
  try {
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const recs = await StocksAdviceRec.find({ email, generatedAt: { $gte: since } }).select({ ticker: 1 }).lean().limit(200);
    for (const r of recs) universe.add(String(r.ticker).toUpperCase());
  } catch { /* ignore */ }

  // Broad universe from FMP screener — always on. The curated
  // DEFAULT_UNIVERSE + user holdings + past discovery/rec sets stay
  // in the mix so a broad-load failure never leaves the pick engine
  // with an empty universe. STOCKS_BROAD_UNIVERSE_CAP is a tuning
  // knob (500 default) not an on/off switch.
  // Raised default 500 → 1500 (audit Aug-28). At 500 tickers the algorithm
  // was structurally blind to ~2000 of the ~3000 investable US+CA names —
  // it "cannot discover opportunities it never examines." Stage-2 top-K
  // (30) is unchanged, so per-tick expensive FMP calls stay bounded; only
  // the cheap Stage-1 technical pre-screen widens. Max lifted 2000 → 3000
  // so a power-user override can go broader when investigating.
  const cap = Math.max(100, Math.min(3000, Number(process.env.STOCKS_BROAD_UNIVERSE_CAP) || 1500));
  try {
    const { getBroadUniverse } = await import("./stocksUniverse.js");
    const broad = await getBroadUniverse();
    for (const t of broad.slice(0, cap)) universe.add(t);
    console.log(`[pick-engine-universe] broad universe merged — +${Math.min(cap, broad.length)} tickers (total ${universe.size})`);
  } catch (e) { console.warn("[pick-engine-universe] broad load failed (falling back to curated + user):", e?.message); }

  // Hard cap on final universe. Was 80 in the pre-audit version —
  // that was the exact audit complaint (algorithm can only discover
  // stocks it already knows about). The two-stage pipeline downstream
  // (see generateDailyPicksForUser) prevents the technical scan from
  // becoming too expensive at 500 tickers.
  return [...universe].slice(0, cap);
}

// Pick top N (default 2) — the honest discipline that this feature exists to
// enforce. Returns an array (possibly empty if no candidate scored > 40).
//
// excludeTickers: an array of tickers to skip entirely — used by the daily
// briefing to avoid emitting a fresh BUY pick for something the user
// already holds or just executed via a linked rec. Silent filter (no
// warning) — the pick is simply not a candidate for a NEW entry, though
// the AI's "Signals per holding" section still manages the position.
export async function generateDailyPicksForUser({ email, n = 2, minScore = 40, currency = null, excludeTickers = [] } = {}) {
  // Kill-switch gate. If the discretionary engine has been losing money
  // over the last 30 days, stop feeding new picks — waiting for the
  // user's actual performance to recover before emitting more. Silent
  // return of an empty array; the caller ((briefing / cron)) handles
  // "no picks today" naturally.
  const gate = await shouldSuppressPicks(email);
  if (gate.suppress) {
    console.warn(`[pick-engine-kill-switch] SUPPRESSED for ${email}: ${gate.reason}`);
    return [];
  }
  console.log(`[pick-engine-kill-switch] pass for ${email}: ${gate.reason}`);
  // Canary mode: force n=1 so the sampling stays small while the
  // engine is technically underperforming. When performance
  // recovers (kill switch stops firing), full n is restored.
  if (gate.canary && n > 1) {
    console.log(`[pick-engine-kill-switch] canary mode — capping n from ${n} to 1`);
    n = 1;
  }
  // Per-setup surgical kill — even if the overall engine passes, drop
  // candidates whose setupName has a demonstrably losing history
  // (see computeBannedSetups thresholds).
  const bannedSetups = await computeBannedSetups(email);
  // Theme-first gate for SPEC candidates (Aug 5 overhaul §3). A
  // chart-pattern setup can no longer generate a SPEC pick on its
  // own — the ticker must be a member of at least one enabled
  // structural theme. CORE / SWING / INCOME picks are unaffected;
  // themes only gate the SPEC funnel.
  const approvedThemeTickers = await getApprovedTickers(email);
  const rawUniverse = await resolveUniverseForUser(email);
  // Normalize BOTH sides — exclude sets built from portfolio positions
  // may hold "RY" while the universe carries "RY.TO". Strip exchange
  // suffix on both so they match cleanly.
  const excludeSet = new Set(
    (excludeTickers || []).map(normalizeTicker)
  );
  const universe = rawUniverse.filter((t) => !excludeSet.has(normalizeTicker(t)));
  const scored = [];
  // Tier 2.1 fundamentals-rescue pool — candidates with technical
  // scores in [25, 40) that would otherwise be dropped. Stage 2 runs
  // the multi-factor composite over the top N of these; any that clear
  // FUNDAMENTALS_RESCUE_PROMOTION join the final ranking union.
  const rescueScored = [];
  // Aggregate skip counters so a 500-ticker universe doesn't dump
  // 300+ per-ticker SKIP log lines every tick. Individual reasons
  // are still reachable via STOCKS_PICK_ENGINE_VERBOSE=1 for debug.
  const verbose = process.env.STOCKS_PICK_ENGINE_VERBOSE === "1";
  const skipCounts = { techFail: 0, belowMinScore: 0, bannedSetup: 0, themeGate: 0, specialSituation: 0 };
  const bannedSetupTickers = [];   // captured for the summary log
  const themeGateTickers = [];
  const specialSituationTickers = [];

  for (const ticker of universe) {
    try {
      // Auto-detect currency per ticker so a TSX name like RY.TO fetches
      // its CAD listing (not the US ADR). Explicit `currency` arg still
      // overrides when a caller wants to force it.
      const ccy = currency || currencyFromTicker(ticker);
      const tech = await getTechnicals(ticker, ccy, { includeMultiTimeframe: true });
      if (!tech?.ok || tech.last == null) { skipCounts.techFail++; continue; }
      // Special-situation preflight gate — fail-closed BEFORE technical
      // scoring. If this ticker is party to an active M&A / tender /
      // take-private / delisting, ordinary swing/spec setups no longer
      // price the security (the deal terms do). Drop from the candidate
      // set and attach the situation so the briefing can render it as
      // "SCREENED — ACTIVE M&A" or route to event-driven analysis.
      // Any error here is silent (skipCounts.specialSituation doesn't
      // grow) and the candidate proceeds — the preflight is a gate,
      // not a gatekeeper — the audit blocker downstream catches the
      // case where a specialSituation-tagged pick still reaches BUY.
      try {
        const { getSpecialSituationForTicker } = await import("./stocksSpecialSituations.js");
        const situation = await getSpecialSituationForTicker(ticker);
        if (situation && situation.active) {
          skipCounts.specialSituation = (skipCounts.specialSituation || 0) + 1;
          if (specialSituationTickers.length < 20) specialSituationTickers.push(`${ticker}(${situation.kind}/${situation.status})`);
          if (verbose) console.log(`[pick-engine-special-situation] SKIP ${ticker} — ${situation.kind}/${situation.status} (confidence ${(situation.confidence * 100).toFixed(0)}%)`);
          // Emit a screened stub so renderDailyPicksDeterministic can
          // render the SCREENED — ACTIVE M&A line. Deterministic score
          // is null (not scored) — the SCREENED branch doesn't need it.
          scored.push({
            ticker,
            currency: ccy,
            entryPrice: tech.last,
            targetPrice: null,
            targetSource: null,
            stopPrice: null,
            deterministicScore: null,
            scoreContributors: [],
            scoreContributions: [],
            scoreRawSum: 0,
            setupName: null,
            mtfConfluence: null,
            atr14: tech.atr14 || null,
            specialSituation: situation,   // consumed by the renderer
            rationale: `Special situation: ${situation.kind} status=${situation.status} — ordinary technical scoring skipped.`,
          });
          continue;
        }
      } catch (e) {
        console.warn(`[pick-engine-special-situation] lookup failed for ${ticker}:`, e?.message);
      }
      const { score, contributors, contributions, rawSum } = scoreCandidate(tech);
      // Fundamentals-rescue pool (Tier 2.1, audit Aug-28). Candidates
      // scoring 25-40 on pure technicals used to be dropped as
      // belowMinScore — meaning a pullback name with weak-chart-but-
      // strong-fundamentals never saw the multi-factor composite. Now
      // we PRESERVE them into a rescueScored[] pool; Stage 2 pulls the
      // top-N from there, fetches fundamentals, and any name whose
      // compositeRank clears the promotion threshold gets unioned into
      // the final top-N candidate set. Below 25 is still dropped —
      // 25-40 is the "weak but not broken" band where fundamentals
      // can plausibly rescue a candidate.
      const FUNDAMENTALS_RESCUE_FLOOR = 25;
      if (score < minScore) {
        if (score >= FUNDAMENTALS_RESCUE_FLOOR) {
          // Persist minimally-shaped stub to rescuePool; Stage 2 fills
          // in the fundamentals pass.
          rescueScored.push({
            ticker,
            currency: ccy,
            deterministicScore: score,
            scoreContributors: contributors,
            scoreContributions: contributions,
            scoreRawSum: rawSum,
            entryPrice: tech.last,
            atr14: tech.atr14 || null,
            setupName: (tech.setups || []).find(s => s.type === "bullish")?.name || null,
            mtfConfluence: tech.mtf?.confluence || null,
            _rescueOrigin: true, // marker so the union step knows to guard the promotion threshold
          });
        }
        skipCounts.belowMinScore++;
        continue;
      }
      const bullSetup = (tech.setups || []).find((s) => s.type === "bullish");
      // Per-setup surgical kill — drop candidates whose detected setup
      // is in the user's banned set (proven losing history over ≥10
      // closed samples).
      if (bullSetup?.name && bannedSetups.has(bullSetup.name)) {
        skipCounts.bannedSetup++;
        if (bannedSetupTickers.length < 20) bannedSetupTickers.push(`${ticker}(${bullSetup.name})`);
        if (verbose) console.log(`[pick-engine-per-setup] SKIP ${ticker} — setup "${bullSetup.name}" is banned`);
        continue;
      }
      // Theme-first gate — SPEC candidates must be members of an
      // approved theme. CORE / SWING / INCOME pass through
      // untouched. Ticker classifier decides the sleeve so no AI
      // declaration needed. baseTicker() strips exchange suffixes
      // so XIU.TO and XIU collapse to the same theme lookup.
      const sleeve = classifyPosition({ ticker });
      if (sleeve === "spec") {
        const baseCandidate = String(ticker).toUpperCase().replace(/\..*$/, "").replace(/[^A-Z0-9]/g, "");
        if (!approvedThemeTickers.has(baseCandidate)) {
          skipCounts.themeGate++;
          if (themeGateTickers.length < 20) themeGateTickers.push(ticker);
          if (verbose) console.log(`[pick-engine-theme-gate] SKIP ${ticker} — not a member of any enabled theme (SPEC only via themes)`);
          continue;
        }
      }
      // Target derivation — pick the source that matches the price's
      // relationship to the prior swing, not "max(last*1.02, swingHigh)"
      // which anchored to an already-broken resistance and produced
      // tight +2% targets on breakouts (KXS.TO composite 88, target
      // +2%, R/R 0.24:1 → SCREENED even though it was a legitimate
      // strong setup). The correct logic:
      //   - pullback / consolidation (last < swingHigh): target = swingHigh
      //     (first meaningful resistance).
      //   - breakout (last >= swingHigh AND swingLow known): target =
      //     last + (swingHigh - swingLow) — the measured move projected
      //     from the current breakout level.
      //   - no fib data: target = last + 2*ATR (fallback).
      // The R/R gate downstream still rejects picks whose real target
      // doesn't clear 1.5:1 — this fix produces the real target, not
      // a manufactured one.
      const fib = tech.fib || {};
      const swingHigh = Number.isFinite(fib.swingHigh) ? fib.swingHigh : null;
      const swingLow = Number.isFinite(fib.swingLow) ? fib.swingLow : null;
      let target, targetSource;
      if (swingHigh && tech.last < swingHigh) {
        // Pullback / consolidation — first resistance is the swing high.
        target = swingHigh;
        targetSource = "swing-high";
      } else if (swingHigh && swingLow && tech.last >= swingHigh && swingHigh > swingLow) {
        // Breakout — measured move projected from the current breakout
        // price. This preserves the technical meaning: a pattern with
        // range R projects R above the breakout point.
        const range = swingHigh - swingLow;
        target = tech.last + range;
        targetSource = "measured-move";
      } else if (tech.atr14 != null && tech.atr14 > 0) {
        target = tech.last + 2 * tech.atr14;
        targetSource = "atr-2x";
      } else {
        target = tech.last * 1.08;
        targetSource = "pct-floor";
      }
      const stop = tech.suggested25AtrStop != null && tech.suggested25AtrStop > 0
        ? tech.suggested25AtrStop
        : tech.last * 0.94;
      // Compute watchTrigger — the specific PRICE at which a WATCH tier
      // would flip to a viable BUY. If no such price exists (target and
      // stop structure can never satisfy R/R ≥ 1.5), we return null and
      // the tier assignment downstream refuses to say WATCH.
      // Math: at trigger price T (a pullback below last), assume the same
      // target and same stop-percent structure applies. R/R at T is
      //   (target − T) / (T − stop) ≥ 1.5
      // solving for T: T ≤ (target + 1.5*stop) / 2.5. If that price is
      // above the current stop (positive downside) and below the current
      // last (a real pullback), it's a valid WATCH trigger.
      let watchTrigger = null;
      if (Number.isFinite(target) && Number.isFinite(stop) && stop > 0 && target > stop) {
        const T = (target + 1.5 * stop) / 2.5;
        if (Number.isFinite(T) && T > stop && T < tech.last) {
          watchTrigger = {
            price: T,
            why: `pullback to ≤$${T.toFixed(2)} while target/stop structure holds`,
          };
        }
      }
      scored.push({
        ticker,
        currency: ccy,
        entryPrice: tech.last,
        targetPrice: target,
        targetSource,
        stopPrice: stop,
        deterministicScore: score,
        scoreContributors: contributors,
        // scoreContributions / scoreRawSum: numeric-delta pair the
        // reconciliation audit consumes. Never parse the string.
        scoreContributions: contributions,
        scoreRawSum: rawSum,
        setupName: bullSetup?.name || null,
        mtfConfluence: tech.mtf?.confluence || null,
        atr14: tech.atr14,
        watchTrigger,
        rationale: (() => {
          // Show ALL contributors (positive AND negative) so the operator
          // can trace how we got to the composite. rawSum here comes from
          // the numeric-delta array — not a regex over the display text —
          // so the "[clamped: …]" marker only fires when the sum truly
          // deviates from the reported score (real clamp at 0 or 100),
          // not when the display string embeds a stray percentage.
          const clampedNote = Math.abs(rawSum - score) > 0.5
            ? ` [clamped: raw ${rawSum >= 0 ? "+" : ""}${Math.round(rawSum)}, capped at ${score}]`
            : "";
          return `Composite ${score}: ${contributors.join(" · ")}${clampedNote}`;
        })(),
      });
    } catch { /* skip this ticker this tick */ }
  }

  // Single aggregate skip summary — replaces the per-ticker SKIP spam
  // that used to fire hundreds of times per tick once the universe
  // opened up to 500+ names. Set STOCKS_PICK_ENGINE_VERBOSE=1 to see
  // per-ticker reasons back in the log.
  const skipTotal = skipCounts.techFail + skipCounts.belowMinScore + skipCounts.bannedSetup + skipCounts.themeGate + (skipCounts.specialSituation || 0);
  const skipParts = [
    `tech-fail=${skipCounts.techFail}`,
    `below-minScore(${minScore})=${skipCounts.belowMinScore}`,
    `banned-setup=${skipCounts.bannedSetup}`,
    `SPEC-theme-gate=${skipCounts.themeGate}`,
    `special-situation=${skipCounts.specialSituation || 0}`,
  ].join(" · ");
  const sampleParts = [];
  if (skipCounts.bannedSetup > 0 && bannedSetupTickers.length) {
    sampleParts.push(`banned-setup sample: ${bannedSetupTickers.slice(0, 8).join(", ")}${bannedSetupTickers.length > 8 ? "…" : ""}`);
  }
  if (skipCounts.themeGate > 0 && themeGateTickers.length) {
    sampleParts.push(`theme-gate sample: ${themeGateTickers.slice(0, 8).join(", ")}${themeGateTickers.length > 8 ? "…" : ""}`);
  }
  console.log(`[pick-engine] scan complete — universe=${universe.length} scored=${scored.length} skipped=${skipTotal} (${skipParts})`);
  if (sampleParts.length) console.log(`[pick-engine]   ${sampleParts.join(" | ")}`);

  scored.sort((a, b) => b.deterministicScore - a.deterministicScore);

  // Two-stage ranking — always on. Stage 1 (above) is the fast
  // technical pre-screen scanned over the whole (possibly broad)
  // universe. Stage 2 (below) applies the multi-factor composite
  // (technical + fundamentals + growth + estimate revisions + relative
  // strength + insider) to the top MULTI_FACTOR_TOP_K candidates, then
  // re-ranks the final picks on the composite. This caps expensive
  // FMP calls at ~30 tickers per tick regardless of universe size.
  //
  // The daily-pick output is now driven by the composite. Stage 2 runs
  // unconditionally so the algorithm the UI backtest promises is the
  // same one the production pick engine uses.
  const MULTI_FACTOR_TOP_K = Math.max(10, Math.min(60, Number(process.env.STOCKS_MULTI_FACTOR_TOP_K) || 30));
  let top;
  if (scored.length > 0) {
    const stage2Input = scored.slice(0, MULTI_FACTOR_TOP_K);
    const [{ getFundamentals }, mfMod, growthMod, insiderMod] = await Promise.all([
      import("./stocksFundamentals.js"),
      import("./stocksMultiFactorScore.js"),
      import("./stocksGrowthRevisions.js"),
      import("./stocksInsiderSignals.js"),
    ]);
    const { computeMultiFactorScore, computeRelativeStrengthFromBars } = mfMod;
    const { getGrowth, getEstimateRevisions } = growthMod;
    const { getRecentInsiderSignals, getInsiderClusterVelocity } = insiderMod;

    // Load benchmark bars once, reused across the top-K.
    let spyBars = null, xicBars = null;
    try {
      spyBars = await fetchYahooDaily("SPY", "1y");
      xicBars = await fetchYahooDaily("XIC.TO", "1y");
    } catch { /* fall back to no-RS */ }

    // Insider signals: one batch query for the whole top-K rather than
    // per-ticker Mongo hits inside the loop. Bucket by ticker so per-
    // candidate lookup is O(1) below.
    // Tier 2.2 (audit Aug-28): also fetch cluster velocity in parallel
    // (window-over-window comparison) so scoreInsider can reward
    // accelerating conviction and penalize cooling clusters.
    const stage2Bases = stage2Input.map(c => String(c.ticker).replace(/\..*$/, ""));
    let insiderByBase = new Map();
    try {
      const [signals, velocityMap] = await Promise.all([
        getRecentInsiderSignals(stage2Bases, { days: 30, limit: 60 }),
        getInsiderClusterVelocity(stage2Bases, { windowDays: 30 }).catch(() => new Map()),
      ]);
      for (const s of signals || []) {
        const b = String(s.ticker || "").toUpperCase().replace(/\..*$/, "");
        const prev = insiderByBase.get(b) || { clusterBuy: false, clusterSell: false };
        if (s.kind === "cluster_buy") prev.clusterBuy = true;
        if (s.kind === "cluster_sell") prev.clusterSell = true;
        insiderByBase.set(b, prev);
      }
      // Fold velocity into the same bucket. Tickers with no clusters
      // but positive velocity still get a scoreable object so
      // scoreInsider can express the trend.
      for (const [base, vel] of velocityMap) {
        const prev = insiderByBase.get(base) || { clusterBuy: false, clusterSell: false };
        prev.velocityDeltaPct = vel.velocityDeltaPct;
        prev.velocityRecentScore = vel.recentScore;
        prev.velocityPriorScore = vel.priorScore;
        insiderByBase.set(base, prev);
      }
    } catch (e) { console.warn("[pick-engine-multi-factor] insider batch failed:", e?.message); }

    // Parallelize per-candidate fetches with a small concurrency cap so
    // the top-K composite doesn't sequentially wait on 30× fundamentals.
    const CONC = 5;
    for (let i = 0; i < stage2Input.length; i += CONC) {
      const slice = stage2Input.slice(i, i + CONC);
      await Promise.all(slice.map(async (cand) => {
        try {
          const ccy = cand.currency || "USD";
          const bench = ccy === "CAD" ? xicBars : spyBars;
          const base = String(cand.ticker).replace(/\..*$/, "");
          const [tickerBars, fundamentals, growth, revisions] = await Promise.all([
            fetchYahooDaily(cand.ticker, "1y").catch(() => null),
            getFundamentals(cand.ticker, ccy).catch(() => null),
            getGrowth(cand.ticker).catch(() => null),
            getEstimateRevisions(cand.ticker).catch(() => null),
          ]);
          const rs = (tickerBars && bench)
            ? computeRelativeStrengthFromBars(tickerBars, bench)
            : { ok: false };
          const insider = insiderByBase.get(base) || null;
          const composite = computeMultiFactorScore({
            technicalScore: cand.deterministicScore,
            fundamentals,
            growth,        // wired: revenue YoY + accel + EPS YoY (FMP quarterly income)
            revisions,     // wired: 4w change in analyst consensus target (day-snapshot Mongo)
            rs,
            insider,       // wired: cluster_buy / cluster_sell from insider-signals collection
          });
          cand.multiFactorScore = composite.score;
          cand.multiFactorContributors = composite.contributors;
          cand.factorBreakdown = Object.fromEntries(
            Object.entries(composite.factors).map(([k, v]) => [k, v.score])
          );
          // The composite IS the primary rank now. Preserve the pure
          // technical score in a side field for auditability + backtest
          // comparisons, but let compositeRank drive selection.
          cand.compositeRank = composite.score;
          // ── Tier 3.1: Quality-Compounder archetype bump ────────
          // A candidate that meets 4-of-5 durability tests (high ROE,
          // FCF conversion, low leverage, margin durability, positive
          // revenue) gets a +5 composite bump so genuine compounders
          // outrank momentum-only picks with weaker fundamentals.
          try {
            const { evaluateCompounderForPick } = await import("./stocksQualityCompounder.js");
            const evalResult = evaluateCompounderForPick({ fundamentals, growth });
            if (evalResult.bumped) {
              cand.qualityCompounderBadge = evalResult.badge;
              cand.qualityCompounderReasons = evalResult.reasons;
              cand.compositeRankPreCompounder = cand.compositeRank;
              cand.compositeRank = Math.min(100, cand.compositeRank + evalResult.bumpAmount);
            }
          } catch { /* soft-fail — don't break stage 2 on compounder issue */ }
        } catch (e) {
          console.warn(`[pick-engine-multi-factor] ${cand.ticker} skipped:`, e?.message);
        }
      }));
    }
    // ── Tier 2.1: Fundamentals-rescue pass ──────────────────────
    // Take the top-K by technical from rescueScored[] (the 25-40 band),
    // fetch fundamentals with the same composite, and any candidate
    // whose compositeRank clears the promotion threshold gets unioned
    // into stage2Input for the final rerank. This is the audit's fix
    // for "a pullback name with weak technicals but 80% revenue growth
    // never gets fundamentals scored." Bounded at RESCUE_TOP_K so FMP
    // calls stay capped (main K + rescue K = ~45 per tick worst case).
    const RESCUE_TOP_K = Math.max(5, Math.min(30, Number(process.env.STOCKS_RESCUE_TOP_K) || 15));
    const FUNDAMENTALS_RESCUE_PROMOTION = 60; // multi-factor composite ≥ 60 to promote
    rescueScored.sort((a, b) => b.deterministicScore - a.deterministicScore);
    const rescueInput = rescueScored.slice(0, RESCUE_TOP_K);
    const rescueBases = rescueInput.map(c => String(c.ticker).replace(/\..*$/, ""));
    let rescueInsiderByBase = new Map();
    try {
      const rSignals = await getRecentInsiderSignals(rescueBases, { days: 30, limit: 40 });
      for (const s of rSignals || []) {
        const b = String(s.ticker || "").toUpperCase().replace(/\..*$/, "");
        const prev = rescueInsiderByBase.get(b) || { clusterBuy: false, clusterSell: false };
        if (s.kind === "cluster_buy") prev.clusterBuy = true;
        if (s.kind === "cluster_sell") prev.clusterSell = true;
        rescueInsiderByBase.set(b, prev);
      }
    } catch { /* soft-fail */ }
    for (let i = 0; i < rescueInput.length; i += CONC) {
      const slice = rescueInput.slice(i, i + CONC);
      await Promise.all(slice.map(async (cand) => {
        try {
          const ccy = cand.currency || "USD";
          const bench = ccy === "CAD" ? xicBars : spyBars;
          const base = String(cand.ticker).replace(/\..*$/, "");
          const [tickerBars, fundamentals, growth, revisions] = await Promise.all([
            fetchYahooDaily(cand.ticker, "1y").catch(() => null),
            getFundamentals(cand.ticker, ccy).catch(() => null),
            getGrowth(cand.ticker).catch(() => null),
            getEstimateRevisions(cand.ticker).catch(() => null),
          ]);
          const rs = (tickerBars && bench)
            ? computeRelativeStrengthFromBars(tickerBars, bench) : { ok: false };
          const insider = rescueInsiderByBase.get(base) || null;
          const composite = computeMultiFactorScore({
            technicalScore: cand.deterministicScore,
            fundamentals, growth, revisions, rs, insider,
          });
          cand.multiFactorScore = composite.score;
          cand.multiFactorContributors = composite.contributors;
          cand.factorBreakdown = Object.fromEntries(
            Object.entries(composite.factors).map(([k, v]) => [k, v.score])
          );
          cand.compositeRank = composite.score;
        } catch (e) {
          console.warn(`[pick-engine-rescue] ${cand.ticker} skipped:`, e?.message);
        }
      }));
    }
    // Promote rescue candidates that cleared the fundamentals bar.
    // These lack the full pick shape (targetPrice/stopPrice/watchTrigger
    // — Stage 1 skipped them) so give them a minimal target/stop from
    // ATR fallback so downstream code doesn't crash on null.
    const promoted = rescueInput.filter(c => (c.compositeRank ?? 0) >= FUNDAMENTALS_RESCUE_PROMOTION);
    for (const p of promoted) {
      if (!p.targetPrice) p.targetPrice = p.entryPrice + (p.atr14 || p.entryPrice * 0.04) * 2;
      if (!p.stopPrice) p.stopPrice = p.entryPrice - (p.atr14 || p.entryPrice * 0.03) * 1.5;
      if (!p.targetSource) p.targetSource = "atr-2x";
      if (!p.rationale) {
        p.rationale = `Fundamentals-rescue: technical composite ${p.deterministicScore} but multi-factor composite ${p.compositeRank}. ${p.multiFactorContributors?.slice(0, 3).join(" · ") || ""}`;
      }
    }
    if (promoted.length > 0) {
      console.log(`[pick-engine-rescue] promoted ${promoted.length}/${rescueInput.length} fundamentals-rescue candidates: ${promoted.map(p => `${p.ticker}(tech ${p.deterministicScore}→comp ${p.compositeRank})`).join(", ")}`);
    }

    // ── Tier 3.1: Fresh-news catalyst bump ─────────────────────
    // Audit Aug-28: FMP news is a paid feed that was never wired to
    // the daily pick engine (only surfaced on the News tab). A ticker
    // with material news in the last 3 days is a legitimate short-term
    // catalyst signal. We apply a small +5 bonus that stacks with the
    // external adjustment but stays below the "genuine composite
    // strength" tier.
    try {
      const { getTickerNews } = await import("./stocksNews.js");
      const NEWS_CONC = 4;
      const NEWS_LOOKBACK_DAYS = 3;
      const NEWS_BUMP = 5;
      const compForNews = [...stage2Input, ...promoted];
      const cutoff = Date.now() - NEWS_LOOKBACK_DAYS * 86400 * 1000;
      for (let i = 0; i < compForNews.length; i += NEWS_CONC) {
        const slice = compForNews.slice(i, i + NEWS_CONC);
        await Promise.all(slice.map(async (cand) => {
          try {
            const news = await getTickerNews(cand.ticker, cand.currency || "USD", { limit: 5 });
            const fresh = (news || []).filter(n => {
              const t = n.publishedAt ? new Date(n.publishedAt).getTime() : 0;
              return t >= cutoff;
            });
            cand.freshNewsCount = fresh.length;
            cand.freshNewsHeadlines = fresh.slice(0, 3).map(n => n.title).filter(Boolean);
            if (fresh.length > 0 && Number.isFinite(cand.compositeRank)) {
              cand.newsCatalystBump = NEWS_BUMP;
              cand.compositeRankPreNews = cand.compositeRank;
              cand.compositeRank = Math.min(100, cand.compositeRank + NEWS_BUMP);
            }
          } catch { /* soft-fail per ticker */ }
        }));
      }
    } catch (e) {
      console.warn("[pick-engine-news] catalyst bump failed:", e?.message);
    }

    // ── Tier 2.1: External adjustment applied to compositeRank ──
    // Previously the external nomination adjustment was rendered as
    // display text only ("base 76 + external +5 = enhanced 81") but did
    // not shift `top` selection. Now it modifies compositeRank so a
    // ticker with insider cluster + institutional new-position + sell-
    // side upgrade can actually pass another ticker in the final rank.
    // Cap: +5 max (already enforced by getExternalConvictionForTicker's
    // EXTERNAL_ADJUSTMENT_CAP). We add it to compositeRank with a hard
    // ceiling of 100 so external can't inflate a mediocre base past a
    // strong genuine composite.
    const combined = [...stage2Input, ...promoted];
    try {
      const { getExternalConvictionForTicker } = await import("./stocksExternalNominations.js");
      // Parallelize the lookups — each is a small Mongo read.
      const EXT_CONC = 6;
      for (let i = 0; i < combined.length; i += EXT_CONC) {
        const slice = combined.slice(i, i + EXT_CONC);
        await Promise.all(slice.map(async (cand) => {
          try {
            if (cand.compositeRank == null) return;
            const conviction = await getExternalConvictionForTicker(cand.ticker, {
              currency: cand.currency || "USD",
              baseComposite: cand.compositeRank,
            });
            cand.baseCompositeRank = cand.compositeRank;
            cand.externalAdjustment = conviction?.externalAdjustment || 0;
            cand.externalConvictionScore = conviction?.externalConvictionScore || 0;
            cand.compositeRank = Math.min(100, cand.baseCompositeRank + cand.externalAdjustment);
          } catch { /* soft-fail — leave compositeRank unchanged */ }
        }));
      }
    } catch (e) {
      console.warn("[pick-engine-external] adjustment pass failed:", e?.message);
    }

    // Re-rank on multi-factor composite (now includes external
    // adjustment). Fallback (rare) is technical.
    combined.sort((a, b) => (b.compositeRank ?? b.deterministicScore) - (a.compositeRank ?? a.deterministicScore));
    top = combined.slice(0, n);
    console.log(`[pick-engine-multi-factor] scored ${stage2Input.length} technical + ${rescueInput.length} rescue (${promoted.length} promoted), external adjustment applied, final top ${top.length}`);
  } else {
    top = [];
  }

  // Tag each pick with viaCanary so the persist site can flag it in
  // Mongo. The canary window counter (shouldSuppressPicks) reads this
  // to avoid old pre-kill-switch cron picks holding the canary shut.
  if (gate.canary) {
    for (const p of top) p.viaCanary = true;
  }
  return top;
}

export { scoreCandidate }; // exported for Test B reuse
