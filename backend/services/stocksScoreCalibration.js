// backend/services/stocksScoreCalibration.js
//
// Score → outcome calibration feedback loop. Reads a user's CLOSED
// daily picks + advice recs, buckets them by (score band, setup type,
// MTF confluence), and computes per-bucket win rate + avg return.
//
// This turns the tool into a "learns YOU" system — the briefing prompt
// gets a compact CALIBRATION block that tells the AI which combinations
// have actually paid off for THIS user, so its recommendations tilt
// toward proven signals and back off unproven ones.
//
// No lookahead — only closed positions (status=target-hit, stop-hit,
// horizon-exit, closed-manual) count.
//
// Minimum sample size per bucket: 5. Below that the win rate is noise
// and we hide the bucket from the AI.

import StocksDailyPick from "../models/StocksDailyPick.js";
import StocksAdviceRec from "../models/StocksAdviceRec.js";

const MIN_BUCKET_N = 5;

// Score bands — matches the composite-score scale from the daily-pick
// engine. 80+ is the "high-conviction" band; <50 is the "weak" band.
function scoreBand(score) {
  const s = Number(score) || 0;
  if (s >= 80) return "80+";
  if (s >= 70) return "70-79";
  if (s >= 60) return "60-69";
  if (s >= 50) return "50-59";
  return "0-49";
}

// Normalize setup names into a small, stable set of categories.
// The daily-pick engine emits e.g. "Minervini VCP", "Bull Flag",
// "Pocket Pivot", "Coiled Spring", "Inside Day", "Cup & Handle".
// We collapse to a lowercase kebab-case token so buckets survive
// small labeling drift.
function normalizeSetup(name) {
  if (!name) return "unnamed";
  const s = String(name).toLowerCase();
  if (s.includes("vcp") || s.includes("volatility contraction")) return "vcp";
  if (s.includes("bull flag") || s.includes("flag")) return "bull-flag";
  if (s.includes("pocket pivot")) return "pocket-pivot";
  if (s.includes("coiled") || s.includes("spring")) return "coiled-spring";
  if (s.includes("inside day") || s.includes("inside bar")) return "inside-day";
  if (s.includes("cup") && s.includes("handle")) return "cup-and-handle";
  if (s.includes("breakout")) return "breakout";
  if (s.includes("pullback")) return "pullback";
  return "other";
}

// MTF verdict → coarse token. Same categories the briefing prompt uses.
function normalizeMtf(mtf) {
  if (!mtf) return "unknown";
  const s = String(mtf).toLowerCase();
  if (s.includes("aligned")) return "aligned";
  if (s.includes("conflict")) return "conflicting";
  return "mixed";
}

// Compute per-bucket stats given a flat array of closed items with
// { score, setup, mtf, pnlPct, days }.
function bucketize(items, keyFn) {
  const groups = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const out = [];
  for (const [k, arr] of groups.entries()) {
    if (arr.length < MIN_BUCKET_N) continue;
    const wins = arr.filter(x => Number(x.pnlPct) > 0).length;
    const avgPnl = arr.reduce((s, x) => s + (Number(x.pnlPct) || 0), 0) / arr.length;
    const avgDays = arr.reduce((s, x) => s + (Number(x.days) || 0), 0) / arr.length;
    out.push({
      key: k,
      n: arr.length,
      wins,
      winRate: wins / arr.length,
      avgPnlPct: avgPnl,
      avgDays,
    });
  }
  // Rank by n desc then win rate desc
  out.sort((a, b) => b.n - a.n || b.winRate - a.winRate);
  return out;
}

export async function computeCalibration(email) {
  if (!email) return null;

  // Closed daily picks — the primary calibration source (deterministic
  // engine, no discretion, one entry per pick per day).
  const closedPicks = await StocksDailyPick.find({
    email,
    status: { $in: ["target-hit", "stop-hit", "horizon-exit", "closed-manual"] },
    pnlPct: { $ne: null },
  }).lean();

  // Closed AI advice recs — supplements calibration with the recs the
  // AI generated but that lived a full lifecycle. We track only BUY recs
  // whose target or stop was actually hit (skip HOLDs and unresolved).
  const closedRecs = await StocksAdviceRec.find({
    email,
    action: "BUY",
    exitLevelsFilledBy: { $exists: true, $ne: null },
  }).lean();

  // Normalize each source into the common { score, setup, mtf, pnlPct, days } shape.
  const pickItems = closedPicks.map(p => {
    const days = p.exitDate && p.pickDate
      ? Math.round((new Date(p.exitDate) - new Date(p.pickDate)) / 86400000)
      : (p.horizonDays || 10);
    return {
      score: p.deterministicScore,
      setup: normalizeSetup(p.setupName),
      mtf: normalizeMtf(p.mtfConfluence),
      pnlPct: p.pnlPct,
      days,
      source: "daily-pick",
    };
  });

  const recItems = closedRecs
    .filter(r => Number.isFinite(r.entryPrice) && (r.exitLevelsFilledBy || r.pnlPct !== null))
    .map(r => {
      const pnl = Number.isFinite(r.pnlPct) ? r.pnlPct : null;
      const days = r.exitLevelsFilledBy && r.generatedAt
        ? Math.round((new Date(r.exitLevelsFilledBy) - new Date(r.generatedAt)) / 86400000)
        : (r.horizonDays || 30);
      return {
        score: null, // ai recs don't carry a deterministic score
        setup: normalizeSetup(r.setupName),
        mtf: normalizeMtf(null),
        pnlPct: pnl,
        days,
        source: "ai-rec",
      };
    })
    .filter(x => x.pnlPct !== null);

  const allItems = [...pickItems, ...recItems];

  // Insufficient closed history — return a null so the briefing block
  // formatter knows to skip the calibration section entirely rather
  // than dilute the prompt with noise.
  if (allItems.length < MIN_BUCKET_N) {
    return {
      email,
      totalClosed: allItems.length,
      byScoreBand: [],
      bySetup: [],
      byMtf: [],
      byScoreBandSetup: [],
      insufficient: true,
    };
  }

  const totalWins = allItems.filter(x => Number(x.pnlPct) > 0).length;
  const avgPnlOverall = allItems.reduce((s, x) => s + (Number(x.pnlPct) || 0), 0) / allItems.length;

  const scoreItems = allItems.filter(x => Number.isFinite(x.score));
  const byScoreBand = bucketize(scoreItems, x => scoreBand(x.score));
  const bySetup = bucketize(allItems, x => x.setup);
  const byMtf = bucketize(allItems, x => x.mtf);
  const byScoreBandSetup = bucketize(scoreItems, x => `${scoreBand(x.score)}·${x.setup}`);

  return {
    email,
    totalClosed: allItems.length,
    overallWinRate: totalWins / allItems.length,
    overallAvgPnlPct: avgPnlOverall,
    byScoreBand,
    bySetup,
    byMtf,
    byScoreBandSetup,
    insufficient: false,
  };
}

export function formatCalibrationBlock(cal) {
  if (!cal) return "";
  if (cal.insufficient) return "";
  const pct = (v) => `${(v * 100).toFixed(0)}%`;
  const signed = (v) => (v >= 0 ? "+" : "") + v.toFixed(1);
  const line = (row, keyLabel) =>
    `  ${keyLabel}: n=${row.n} · win rate ${pct(row.winRate)} · avg P/L ${signed(row.avgPnlPct)}% · avg hold ${Math.round(row.avgDays)}d`;

  const parts = [
    `\nCALIBRATION (this user's closed picks — no lookahead, based on ${cal.totalClosed} closed positions):`,
    `  Baseline: win rate ${pct(cal.overallWinRate)} · avg P/L ${signed(cal.overallAvgPnlPct)}%.`,
  ];

  if (cal.byScoreBand.length) {
    parts.push(`  By deterministic score band:`);
    for (const row of cal.byScoreBand) parts.push(line(row, `Score ${row.key}`));
  }
  if (cal.bySetup.length) {
    parts.push(`  By named setup:`);
    for (const row of cal.bySetup) parts.push(line(row, `Setup ${row.key}`));
  }
  if (cal.byMtf.length) {
    parts.push(`  By MTF confluence:`);
    for (const row of cal.byMtf) parts.push(line(row, `MTF ${row.key}`));
  }
  if (cal.byScoreBandSetup.length) {
    parts.push(`  Score × setup (highest-signal combinations):`);
    for (const row of cal.byScoreBandSetup.slice(0, 8)) parts.push(line(row, row.key));
  }

  parts.push(`\nHow to use this block:`);
  parts.push(`  - Weight recommendations toward bucket combinations with the highest win rate + avg P/L.`);
  parts.push(`  - If a proposed rec matches a bucket with sub-baseline win rate, EITHER downgrade sizing OR skip it in favor of a proven combination.`);
  parts.push(`  - Score bands + setup types that have NO row here are undertested (n<${MIN_BUCKET_N}) — treat as unknown, not proven.`);
  parts.push(`  - Cite the specific bucket when reasoning: "this setup+score has hit ${MIN_BUCKET_N}+ times at Xx win rate — sized full" is a good pattern.`);
  return parts.join("\n");
}
