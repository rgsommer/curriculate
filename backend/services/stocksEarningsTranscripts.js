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
