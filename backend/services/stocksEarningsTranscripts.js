// backend/services/stocksEarningsTranscripts.js
//
// Pulls the most recent earnings-call transcript per holding via FMP. The
// transcript endpoint is a "Premium" FMP feature ($14/mo Starter tier and
// up), so free-tier accounts get either an empty array or a 401/403.
//
// Behaviour:
//   - With paid FMP plan → returns full transcript text per ticker, AI gets
//     ground-truth management commentary to analyze for tone/guidance.
//   - With free FMP plan / no key → returns { ok: false, reason: "paid_tier_required" }
//     and the prompt block surfaces a one-line tip about upgrading + tells
//     the AI to use web_search for transcripts on those tickers instead.
//
// Cache: 7 days (transcripts don't change after they're posted).

const CACHE = new Map(); // ticker → { fetchedAt, data }
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Cap transcript size so we don't blow the AI's context. Most earnings
// calls run 6-12K words. We keep the prepared remarks + early Q&A which is
// where the alpha lives.
const MAX_TRANSCRIPT_CHARS = 4000;

export async function getRecentTranscript(ticker) {
  const now = Date.now();
  const cached = CACHE.get(ticker);
  if (cached && now - cached.fetchedAt < TTL_MS) return cached.data;

  let data;
  if (!process.env.FMP_API_KEY) {
    data = { ok: false, reason: "no_fmp_key" };
  } else {
    try {
      // FMP returns an array of transcripts, most recent first
      const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${encodeURIComponent(ticker)}?apikey=${process.env.FMP_API_KEY}`;
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 10000);
      const r = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);

      if (r.status === 401 || r.status === 403) {
        data = { ok: false, reason: "paid_tier_required" };
      } else if (!r.ok) {
        data = { ok: false, reason: `http_${r.status}` };
      } else {
        const j = await r.json();
        if (!Array.isArray(j) || j.length === 0) {
          // Free-tier FMP often returns "Error Message" object OR empty array
          // for premium endpoints. Treat both as "paid tier needed" since
          // that's the most common cause.
          if (j && typeof j === "object" && j["Error Message"]) {
            data = { ok: false, reason: "paid_tier_required" };
          } else {
            data = { ok: false, reason: "no_transcript_available" };
          }
        } else {
          const latest = j[0];
          const fullContent = String(latest.content || "");
          const content = fullContent.length > MAX_TRANSCRIPT_CHARS
            ? fullContent.slice(0, MAX_TRANSCRIPT_CHARS) + `\n\n[...truncated; full transcript is ${fullContent.length.toLocaleString()} chars]`
            : fullContent;
          data = {
            ok: true,
            year: latest.year,
            quarter: latest.quarter,
            date: latest.date,
            content,
            fullLength: fullContent.length,
          };
        }
      }
    } catch (e) {
      data = { ok: false, reason: e?.message || "fetch_failed" };
    }
  }

  CACHE.set(ticker, { fetchedAt: now, data });
  return data;
}

// Fetch transcripts for top holdings in parallel. Don't fetch all positions —
// FMP transcripts are pricey on premium tier and pointless for tiny holdings.
export async function getTranscriptsForTopHoldings(profile, topN = 6) {
  const tickerWeights = new Map();
  const fx = profile?.fxUsdCad || 1.37;
  for (const p of profile.positions || []) {
    if (!p.qty) continue;
    const price = p.ccy === "USD" ? p.priceUsd : p.priceCad;
    if (!price) continue;
    const cadValue = p.ccy === "USD" ? price * p.qty * fx : price * p.qty;
    tickerWeights.set(p.ticker, (tickerWeights.get(p.ticker) || 0) + cadValue);
  }
  const tickers = [...tickerWeights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([t]) => t);

  const out = {};
  await Promise.all(
    tickers.map(async t => {
      out[t] = await getRecentTranscript(t).catch(() => ({ ok: false, reason: "exception" }));
    })
  );
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// QoQ NLP comparison — pulls the LAST TWO transcripts and diffs the
// management-language signals between them. Captures tone shifts
// (positive ↑ / negative ↓), specificity vs hedging changes, and the
// presence of high-signal phrases (inflection, accelerating, record
// backlog, capacity constrained, pricing power, strategic alternatives,
// raising/lowering guidance). All deterministic — no AI needed.
// ─────────────────────────────────────────────────────────────────────
const ARRAY_CACHE = new Map(); // ticker → { fetchedAt, arr }
const ARRAY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

async function fetchTranscriptArray(ticker) {
  const now = Date.now();
  const cached = ARRAY_CACHE.get(ticker);
  if (cached && now - cached.fetchedAt < ARRAY_TTL_MS) return cached.arr;
  if (!process.env.FMP_API_KEY) { ARRAY_CACHE.set(ticker, { fetchedAt: now, arr: null }); return null; }
  try {
    const url = `https://financialmodelingprep.com/api/v3/earning_call_transcript/${encodeURIComponent(ticker)}?apikey=${process.env.FMP_API_KEY}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 12000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) { ARRAY_CACHE.set(ticker, { fetchedAt: now, arr: null }); return null; }
    const j = await r.json();
    const arr = Array.isArray(j) ? j : null;
    ARRAY_CACHE.set(ticker, { fetchedAt: now, arr });
    return arr;
  } catch { ARRAY_CACHE.set(ticker, { fetchedAt: now, arr: null }); return null; }
}

// Phrase lists. Each phrase is matched case-insensitively as a whole word/phrase.
const POSITIVE_PHRASES = [
  "inflection", "accelerating", "record backlog", "record revenue", "record orders",
  "capacity constrained", "pricing power", "sold out", "demand exceeds", "all-time high",
  "operating leverage", "fcf positive", "raising guidance", "ahead of plan", "ahead of schedule",
  "strong momentum", "exceptional", "robust", "structural tailwind", "share gains",
  "moat", "competitive advantage", "platform", "ecosystem",
];
const NEGATIVE_PHRASES = [
  "headwind", "macro pressure", "challenging environment", "weaker than expected",
  "softness", "delayed", "pushed out", "lowering guidance", "below plan", "pressure on",
  "deteriorating", "uncertain", "navigating", "appropriate measures", "rightsizing",
  "cost discipline", "lower than expected", "strategic alternatives", "going concern",
];
const HEDGING_PHRASES = [
  "approximately", "in the range of", "expect to", "could", "potentially", "we believe",
  "well-positioned", "remain committed", "continue to invest",
];

function countPhrases(text, phrases) {
  const t = " " + text.toLowerCase() + " ";
  const counts = {};
  let total = 0;
  for (const p of phrases) {
    const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    const m = t.match(re);
    const n = m ? m.length : 0;
    if (n > 0) counts[p] = n;
    total += n;
  }
  return { total, counts };
}

function specificityScore(text) {
  // Count of dollar amounts and percentages — proxies for concrete, confident language.
  const dollars = (text.match(/\$\s*[\d,.]+/g) || []).length;
  const percents = (text.match(/\d+(?:\.\d+)?\s*%/g) || []).length;
  return dollars + percents;
}

// Returns { ok, score, summary, contributors, details, flags } for one ticker.
export async function compareTranscriptsQoQ(ticker) {
  const out = { ok: false, ticker, score: null, summary: "", contributors: [], details: null, flags: [] };
  const arr = await fetchTranscriptArray(ticker);
  if (!arr || arr.length < 2) { out.flags.push("fewer than 2 transcripts available"); return out; }
  const latest = arr[0], prior = arr[1];
  const lText = String(latest?.content || "");
  const pText = String(prior?.content || "");
  if (lText.length < 500 || pText.length < 500) { out.flags.push("transcript text too short to compare"); return out; }

  const lPos = countPhrases(lText, POSITIVE_PHRASES);
  const pPos = countPhrases(pText, POSITIVE_PHRASES);
  const lNeg = countPhrases(lText, NEGATIVE_PHRASES);
  const pNeg = countPhrases(pText, NEGATIVE_PHRASES);
  const lHedge = countPhrases(lText, HEDGING_PHRASES);
  const pHedge = countPhrases(pText, HEDGING_PHRASES);
  const lSpec = specificityScore(lText);
  const pSpec = specificityScore(pText);

  // Normalize per 1000 words so call length doesn't distort
  const wc = (t) => Math.max(1, t.split(/\s+/).length);
  const norm = (n, t) => (n / wc(t)) * 1000;
  const dPos = norm(lPos.total, lText) - norm(pPos.total, pText);
  const dNeg = norm(lNeg.total, lText) - norm(pNeg.total, pText);
  const dHedge = norm(lHedge.total, lText) - norm(pHedge.total, pText);
  const dSpec = norm(lSpec, lText) - norm(pSpec, pText);

  // Score 0-100: higher when positive phrases up, negative+hedging down, specificity up.
  let score = 50; // neutral baseline
  const add = (pts, label) => { score += pts; out.contributors.push(`${label} → ${pts >= 0 ? "+" : ""}${pts}`); };
  if (dPos >= 1) add(15, `Positive phrases up ${dPos.toFixed(1)}/1k words`);
  else if (dPos >= 0.3) add(8, `Positive phrases up modestly`);
  else if (dPos <= -1) add(-12, `Positive phrases down ${dPos.toFixed(1)}/1k words`);
  if (dNeg <= -1) add(15, `Negative phrases down ${dNeg.toFixed(1)}/1k words`);
  else if (dNeg >= 1) add(-15, `Negative phrases up ${dNeg.toFixed(1)}/1k words`);
  if (dHedge <= -0.5) add(8, `Less hedging language`);
  else if (dHedge >= 1) add(-10, `More hedging language`);
  if (dSpec >= 2) add(8, `More specific numbers/guidance`);
  else if (dSpec <= -2) add(-8, `Less specific language`);

  // Flag high-signal phrases newly present in latest
  const newlyPresent = [];
  for (const p of POSITIVE_PHRASES) if ((lPos.counts[p] || 0) > 0 && !(pPos.counts[p])) newlyPresent.push(p);
  const newlyAbsent = [];
  for (const p of POSITIVE_PHRASES) if ((pPos.counts[p] || 0) > 0 && !(lPos.counts[p])) newlyAbsent.push(p);
  const newRedFlags = [];
  for (const p of NEGATIVE_PHRASES) if ((lNeg.counts[p] || 0) > 0 && !(pNeg.counts[p])) newRedFlags.push(p);

  if (newlyPresent.length) add(Math.min(10, newlyPresent.length * 3), `New bullish terms: ${newlyPresent.slice(0, 3).join(", ")}`);
  if (newRedFlags.length) add(-Math.min(12, newRedFlags.length * 4), `New cautionary terms: ${newRedFlags.slice(0, 3).join(", ")}`);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const direction = score >= 60 ? "rising" : score <= 40 ? "falling" : "stable";

  out.ok = true;
  out.score = score;
  out.summary = `Transcript Q${prior.quarter}${prior.year}→Q${latest.quarter}${latest.year}: tone ${direction} (score ${score}). Δpositive ${dPos.toFixed(1)}/1k, Δnegative ${dNeg.toFixed(1)}/1k, Δhedging ${dHedge.toFixed(1)}/1k, Δspecificity ${dSpec.toFixed(1)}/1k.`;
  out.details = {
    latest: { quarter: latest.quarter, year: latest.year, date: latest.date },
    prior: { quarter: prior.quarter, year: prior.year, date: prior.date },
    direction,
    deltas: { positive: +dPos.toFixed(2), negative: +dNeg.toFixed(2), hedging: +dHedge.toFixed(2), specificity: +dSpec.toFixed(2) },
    newlyPresent: newlyPresent.slice(0, 6),
    newlyAbsent: newlyAbsent.slice(0, 6),
    newRedFlags: newRedFlags.slice(0, 6),
  };
  return out;
}

export function formatTranscriptsBlock(transcripts) {
  if (!transcripts || Object.keys(transcripts).length === 0) return "";

  const available = [];
  const unavailable = [];
  for (const [ticker, t] of Object.entries(transcripts)) {
    if (t.ok) available.push([ticker, t]);
    else unavailable.push([ticker, t]);
  }

  // Don't render the block at all if there's nothing usable AND no setup tip to surface
  if (available.length === 0 && unavailable.length === 0) return "";

  const lines = [];
  lines.push("EARNINGS TRANSCRIPTS — recent management commentary (analyze for tone shifts, guidance language, anxiety signals):");

  // Available transcripts get rendered in full (truncated to fit context)
  for (const [ticker, t] of available) {
    lines.push("");
    lines.push(`━━━ ${ticker} — Q${t.quarter} ${t.year} earnings call (${t.date}) ━━━`);
    lines.push(t.content);
  }

  // Unavailable tickers: surface the fallback message + paid-tier tip
  if (unavailable.length > 0) {
    const reasonsHit = new Set(unavailable.map(([_, t]) => t.reason));
    const isPaidTierIssue = reasonsHit.has("paid_tier_required") || reasonsHit.has("no_transcript_available");
    const isMissingKey = reasonsHit.has("no_fmp_key");

    lines.push("");
    lines.push("📡 TRANSCRIPT FALLBACK — the following holdings have no pre-fetched transcript:");
    for (const [ticker, t] of unavailable) {
      lines.push(`  ${ticker}: ${t.reason}`);
    }
    if (isPaidTierIssue) {
      lines.push("");
      lines.push("💡 TIP: Earnings transcripts are an FMP Premium feature. Upgrading to FMP Starter ($14/mo) gives this script ground-truth transcripts pre-fetched, so the AI doesn't have to web_search for each call's coverage. The fallback path below still works — it's just slower and less reliable.");
    } else if (isMissingKey) {
      lines.push("");
      lines.push("💡 TIP: Set FMP_API_KEY in environment variables to enable transcript pre-fetch. Free tier is enough for the technicals/fundamentals already running; transcripts need Starter tier ($14/mo).");
    }
    lines.push("");
    lines.push("For tickers in the fallback list, USE web_search to find recent earnings call summaries/transcripts before commenting on their management tone. Search query templates:");
    lines.push("  - \"<TICKER> Q<N> <YEAR> earnings call transcript\"");
    lines.push("  - \"<TICKER> earnings call key takeaways\"");
    lines.push("  - \"<TICKER> guidance Q<N>\"");
    lines.push("Quality is uneven — Seeking Alpha + Motley Fool + Insider Monkey often have summaries. Mark in your output: \"Transcript: pre-fetched\" or \"Transcript: web-search summary\" so the user knows which source backed the call.");
  }

  // Universal analysis instructions
  lines.push("");
  lines.push("How to use transcripts (any source):");
  lines.push("- Note guidance language SHIFTS vs prior quarter: \"expect to grow X-Y%\" (concrete) vs \"remain committed to growth\" (defensive) vs \"continuing to invest\" (cash burn concern).");
  lines.push("- Anxiety flag: when management uses hedging phrases (\"well-positioned\", \"appropriate measures\", \"navigating headwinds\") 5+ times in one call, the underlying number is worse than the headline.");
  lines.push("- Prepared remarks are scripted; Q&A reveals more. Look for spontaneous tone shifts when an analyst presses on a soft spot.");
  lines.push("- Count Q&A bandwidth: if analysts spend 30% of Q&A time on ONE topic (margin compression, customer concentration, regulatory), that's where the market is worried.");
  lines.push("- For each holding with a transcript, in your rec body include a one-line \"Transcript signal:\" with what you found — bullish, neutral, or red flag.");
  return lines.join("\n");
}
