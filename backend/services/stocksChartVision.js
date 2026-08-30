// backend/services/stocksChartVision.js
//
// Chart vision AI — the AI-native edge nobody in retail tooling does well.
// Renders a ticker's 6mo price chart via QuickChart.io, fetches the PNG,
// base64-encodes it, and sends to Claude Haiku with vision so the model
// SEES the chart the way a human chartist does (gaps, wick structure,
// consolidation shape, hidden divergences).
//
// Deterministic technicals give us the numbers; vision AI gives us the
// gestalt. Both together beat either alone.
//
// Cost per call: one Haiku vision call (~$0.005) + one QuickChart HTTP
// call (free tier). Suitable for enrichment on high-conviction picks —
// too expensive to run per holding on every briefing.

import { fetchDailyOhlcForBacktest } from "./stocksTechnicals.js";

const MODEL = process.env.STOCKS_CHART_VISION_MODEL || "claude-haiku-4-5";
const QUICKCHART = "https://quickchart.io/chart";

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

// Build a Chart.js config that QuickChart accepts. Line chart with a
// filled area, a 50-day SMA, and dashed lines at the recent high/low —
// keeps the visual compact and readable at 800×400.
function buildChartConfig(points, ticker) {
  const N = Math.min(points.length, 132); // ~6mo of trading days
  const slice = points.slice(-N);
  const labels = slice.map((p) => new Date(p.t * 1000).toISOString().slice(0, 10));
  const closes = slice.map((p) => p.close);
  // SMA50 across the visible window (falls off the left edge naturally)
  const sma50 = closes.map((_, i) => {
    if (i < 49) return null;
    const win = closes.slice(i - 49, i + 1);
    return win.reduce((a, b) => a + b, 0) / 50;
  });
  const high = Math.max(...closes);
  const low = Math.min(...closes);
  return {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${ticker} close`,
          data: closes,
          borderColor: "#0f172a",
          backgroundColor: "rgba(15, 23, 42, 0.08)",
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
        },
        {
          label: "SMA50",
          data: sma50,
          borderColor: "#dc2626",
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
        {
          label: `High $${high.toFixed(2)}`,
          data: closes.map(() => high),
          borderColor: "#16a34a",
          borderDash: [6, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
        {
          label: `Low $${low.toFixed(2)}`,
          data: closes.map(() => low),
          borderColor: "#dc2626",
          borderDash: [6, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
        },
      ],
    },
    options: {
      plugins: {
        title: { display: true, text: `${ticker} · daily close · last ${N} sessions` },
        legend: { display: true, position: "top" },
      },
      scales: {
        y: { title: { display: true, text: "Price" } },
        x: { ticks: { maxTicksLimit: 8 } },
      },
    },
  };
}

// ─── Chart-vision veto helper (Tier 3.2 audit Aug-28) ────────────
// Given a chart-vision analysis result, decide whether the chart
// contradicts a bullish thesis strongly enough to VETO a BUY tier.
// The veto reads three fields:
//   • trendStage: "stage-3 top" or "stage-4 decline" → strong bearish
//   • conviction: "low" → weak — combine with divergences for veto
//   • patterns: contains bearish shapes ("head-and-shoulders",
//     "descending triangle", "double top") → bearish
// Returns { veto: bool, reason: string, softWarning: bool }.
// veto=true means block BUY. softWarning=true means annotate but ship.
export function chartVisionVetoVerdict(analysis) {
  if (!analysis) return { veto: false, reason: null, softWarning: false };
  const stage = String(analysis.trendStage || "").toLowerCase();
  const conviction = String(analysis.conviction || "").toLowerCase();
  const patterns = (analysis.patterns || []).map(p => String(p).toLowerCase());
  const bearishPatterns = ["head-and-shoulders", "head and shoulders", "descending triangle", "double top", "rising wedge", "stage-4"];
  const hasBearishPattern = patterns.some(p => bearishPatterns.some(b => p.includes(b)));

  // Hard veto: stage-3/4 OR bearish pattern with low conviction
  if (stage.includes("stage-3") || stage.includes("stage-4")) {
    return { veto: true, softWarning: false,
      reason: `Chart shows ${stage} — trend is topping or declining. BUY inappropriate.` };
  }
  if (hasBearishPattern && conviction === "low") {
    return { veto: true, softWarning: false,
      reason: `Chart shows ${patterns.filter(p => bearishPatterns.some(b => p.includes(b))).join(", ")} with low conviction.` };
  }
  // Soft warning: low conviction alone, or bearish pattern with medium
  // conviction — annotate but don't block
  if (conviction === "low") {
    return { veto: false, softWarning: true,
      reason: `Chart vision conviction low: ${analysis.convictionReason || "no strong setup visible"}.` };
  }
  if (hasBearishPattern) {
    return { veto: false, softWarning: true,
      reason: `Chart shows bearish pattern: ${patterns.filter(p => bearishPatterns.some(b => p.includes(b))).join(", ")}.` };
  }
  return { veto: false, softWarning: false, reason: null };
}

export async function getChartVisionAnalysis(ticker, currency = "USD") {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  let bars;
  try {
    const { points } = await fetchDailyOhlcForBacktest(ticker, currency, 200);
    if (!points || points.length < 30) return null;
    bars = points;
  } catch { return null; }

  const config = buildChartConfig(bars, ticker);
  const url = `${QUICKCHART}?width=800&height=400&format=png&c=${encodeURIComponent(JSON.stringify(config))}`;
  let base64;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const buf = await r.arrayBuffer();
    base64 = Buffer.from(buf).toString("base64");
  } catch { return null; }

  const prompt = `You are a professional chartist looking at a daily close chart of ${ticker} over ~6 months, with the SMA50 overlaid in red and the visible-window high/low as dashed lines.

Analyze what you SEE (not what the numbers alone would tell you):

1. **Named patterns visible** — VCP, bull flag, cup-and-handle, ascending base, descending triangle, head-and-shoulders, coiled spring, etc. Only cite one if it is genuinely visible in the shape.
2. **Trend structure** — clear uptrend / downtrend / range / stage-1 base / stage-2 markup / stage-3 top / stage-4 decline (Weinstein).
3. **Support / resistance zones** — approximate $ levels where the chart shows repeated bounces or rejections. Read from the visible axis.
4. **Hidden divergences** — is the SMA50 above/below the price and by how much? Any obvious lower-highs on price vs same on SMA?
5. **Gestalt** — one sentence: what a floor trader would say about this chart at a glance.
6. **Conviction on the setup** — high / medium / low, with a one-line reason.

Return ONLY this JSON (no prose, no code fences):
{
  "patterns": ["pattern1", "pattern2"],
  "trendStage": "stage-2 markup" | "stage-1 base" | ...,
  "supportLevels": ["$X", "$Y"],
  "resistanceLevels": ["$X", "$Y"],
  "smaRelationship": "price N% above/below SMA50 — expanding/contracting gap",
  "divergences": "1 sentence or 'none material'",
  "gestalt": "1 sentence — what a floor trader sees",
  "conviction": "high" | "medium" | "low",
  "convictionReason": "1 line"
}`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
            { type: "text", text: prompt },
          ],
        }],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text = j?.content?.[0]?.text || "";
    const parsed = extractJson(text);
    if (!parsed) return null;
    return {
      patterns: Array.isArray(parsed.patterns) ? parsed.patterns.slice(0, 5).map(String) : [],
      trendStage: String(parsed.trendStage || "").slice(0, 60),
      supportLevels: Array.isArray(parsed.supportLevels) ? parsed.supportLevels.slice(0, 4).map(String) : [],
      resistanceLevels: Array.isArray(parsed.resistanceLevels) ? parsed.resistanceLevels.slice(0, 4).map(String) : [],
      smaRelationship: String(parsed.smaRelationship || "").slice(0, 200),
      divergences: String(parsed.divergences || "").slice(0, 200),
      gestalt: String(parsed.gestalt || "").slice(0, 300),
      conviction: ["high", "medium", "low"].includes(parsed.conviction) ? parsed.conviction : "medium",
      convictionReason: String(parsed.convictionReason || "").slice(0, 200),
      chartUrl: url,
      analyzedAt: new Date(),
    };
  } catch (e) {
    console.warn(`[chart-vision] ${ticker} failed: ${e?.message}`);
    return null;
  }
}
