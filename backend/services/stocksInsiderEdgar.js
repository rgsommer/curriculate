// backend/services/stocksInsiderEdgar.js
//
// Real insider-trading signal pulled straight from SEC EDGAR Form 4 filings —
// no AI guessing required. This is the kind of "smart-money" signal hedge
// funds pay alt-data vendors for; EDGAR is free, public, and authoritative.
//
// Pipeline per ticker:
//   1. Resolve ticker → CIK via the SEC's company_tickers.json (cached).
//   2. Pull the company's recent filings from data.sec.gov submissions API.
//   3. Filter to Form 4 (statement of changes in beneficial ownership) within
//      the lookback window, fetch each filing's XML, parse: filer, role,
//      transaction code (P=open-market buy, S=sell, A=award/grant, etc),
//      shares, price, date.
//   4. Derive a 0-100 score from cluster buys, senior-role buys, post-drop
//      buys, and the magnitude of net buying.
//
// SEC requires a polite User-Agent identifying you (name + email). Set
// SEC_USER_AGENT in env. Without it we send a sensible default but SEC may
// rate-limit or block. Their rate limit is ~10 req/s; we add small delays.

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";
const TICKER_CIK_CACHE = { fetchedAt: 0, byTicker: null };
const TICKER_CIK_TTL_MS = 24 * 60 * 60 * 1000;
const INSIDER_CACHE = new Map(); // ticker → { fetchedAt, data }
const INSIDER_TTL_MS = 12 * 60 * 60 * 1000;

function ua() {
  return process.env.SEC_USER_AGENT || "Curriculate Stocks Research noreply@curriculate.net";
}

async function secFetch(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": ua(), Accept: "application/json" } });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") || "";
    return ct.includes("json") ? await r.json() : await r.text();
  } catch { return null; } finally { clearTimeout(tid); }
}

// Resolve ticker → 10-digit zero-padded CIK. The map is ~10k entries; cache 24h.
async function resolveCik(ticker) {
  const now = Date.now();
  if (!TICKER_CIK_CACHE.byTicker || now - TICKER_CIK_CACHE.fetchedAt > TICKER_CIK_TTL_MS) {
    const j = await secFetch(`${SEC_BASE}/files/company_tickers.json`);
    if (j && typeof j === "object") {
      const map = {};
      for (const k of Object.keys(j)) {
        const row = j[k];
        if (row?.ticker) map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
      }
      TICKER_CIK_CACHE.byTicker = map;
      TICKER_CIK_CACHE.fetchedAt = now;
    }
  }
  return TICKER_CIK_CACHE.byTicker?.[String(ticker || "").toUpperCase().replace(/\.+$/, "")] || null;
}

// ── Minimal Form-4 XML extractor (regex-based, defensive) ─────────────
// SEC's Form 4 XML is small and stable; full XML parsers add a dep without
// meaningful benefit here. We extract only what's needed for the signal.
function extractValue(blob, tag) {
  const m = blob.match(new RegExp(`<${tag}>[\\s\\S]*?<value>([\\s\\S]*?)</value>`, "i"));
  return m ? m[1].trim() : null;
}
function extractInner(blob, tag) {
  const m = blob.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}
function extractAll(blob, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let m;
  while ((m = re.exec(blob)) !== null) out.push(m[1]);
  return out;
}

function parseForm4Xml(xml) {
  if (!xml || typeof xml !== "string") return null;
  // Reporter
  const ownerBlock = extractInner(xml, "reportingOwner") || "";
  const filerName = extractValue(ownerBlock, "rptOwnerName") || extractInner(ownerBlock, "rptOwnerName") || "";
  const rel = extractInner(ownerBlock, "reportingOwnerRelationship") || "";
  const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(rel);
  const isOfficer = /<isOfficer>\s*(1|true)\s*<\/isOfficer>/i.test(rel);
  const isTenPctOwner = /<isTenPercentOwner>\s*(1|true)\s*<\/isTenPercentOwner>/i.test(rel);
  const officerTitle = (rel.match(/<officerTitle>([\s\S]*?)<\/officerTitle>/i) || [, ""])[1].trim();

  const transactions = [];
  // Non-derivative (open-market shares) — the high-signal one
  for (const tBlock of extractAll(xml, "nonDerivativeTransaction")) {
    const date = extractValue(tBlock, "transactionDate");
    const code = (tBlock.match(/<transactionCode>([A-Z])<\/transactionCode>/i) || [, ""])[1];
    const shares = parseFloat(extractValue(tBlock, "transactionShares") || "");
    const price = parseFloat(extractValue(tBlock, "transactionPricePerShare") || "");
    const ad = extractValue(tBlock, "transactionAcquiredDisposedCode");
    if (date && code && Number.isFinite(shares) && shares > 0) {
      transactions.push({
        date, code, shares,
        price: Number.isFinite(price) ? price : null,
        acquired: ad === "A",
        derivative: false,
      });
    }
  }
  return { filerName: String(filerName).trim(), isDirector, isOfficer, isTenPctOwner, officerTitle, transactions };
}

// Build the per-ticker insider signal — the function called by the engine.
// Returns null when EDGAR can't help (delisted, foreign ADR with no CIK, etc).
export async function getInsiderEdgarSignal(ticker, opts = {}) {
  const tk = String(ticker || "").toUpperCase().replace(/\.+$/, "");
  const cached = INSIDER_CACHE.get(tk);
  if (cached && Date.now() - cached.fetchedAt < INSIDER_TTL_MS) return cached.data;

  const result = { ok: false, ticker: tk, score: null, summary: "", contributors: [], details: null, flags: [] };
  try {
    const cik = await resolveCik(tk);
    if (!cik) { result.flags.push("No CIK for ticker (foreign ADR or non-US listing)"); INSIDER_CACHE.set(tk, { fetchedAt: Date.now(), data: result }); return result; }
    const sub = await secFetch(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`);
    if (!sub?.filings?.recent) { result.flags.push("EDGAR submissions unavailable"); INSIDER_CACHE.set(tk, { fetchedAt: Date.now(), data: result }); return result; }

    const lookbackDays = Number.isFinite(opts.lookbackDays) ? opts.lookbackDays : 90;
    const cutoff = new Date(Date.now() - lookbackDays * 86400 * 1000);
    const cikNoPad = String(parseInt(cik, 10));

    const rec = sub.filings.recent;
    const forms = rec.form || [];
    const dates = rec.filingDate || [];
    const accs = rec.accessionNumber || [];
    const docs = rec.primaryDocument || [];
    const candidates = [];
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== "4") continue;
      const d = dates[i] ? new Date(dates[i]) : null;
      if (!d || d < cutoff) continue;
      candidates.push({ accession: accs[i], filingDate: dates[i], doc: docs[i] });
    }
    // Bound work — newest first, cap at 30 most recent Form 4s.
    candidates.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));
    const work = candidates.slice(0, 30);

    const parsed = [];
    for (const c of work) {
      if (!c.accession || !c.doc) continue;
      const accNoDash = String(c.accession).replace(/-/g, "");
      const xml = await secFetch(`${SEC_BASE}/Archives/edgar/data/${cikNoPad}/${accNoDash}/${c.doc}`);
      const f = parseForm4Xml(typeof xml === "string" ? xml : "");
      if (f) parsed.push({ filingDate: c.filingDate, ...f });
      // Stay polite — small spacing between SEC fetches
      await new Promise((r) => setTimeout(r, 60));
    }

    // Aggregate signals
    const last30 = new Date(Date.now() - 30 * 86400 * 1000);
    let buyDollars30 = 0, buyShares30 = 0;
    let sellDollars30 = 0;
    const buyers30 = new Set();
    let cfoCeoBuy = false, directorBuyCount = 0;
    const recentBuys = [];
    for (const f of parsed) {
      const txDate = f.transactions[0]?.date ? new Date(f.transactions[0].date) : new Date(f.filingDate);
      const within30 = txDate >= last30;
      for (const t of f.transactions) {
        const dollars = (t.price && t.shares) ? t.price * t.shares : 0;
        if (t.code === "P" && t.acquired) {
          if (within30) {
            buyDollars30 += dollars;
            buyShares30 += t.shares;
            if (f.filerName) buyers30.add(f.filerName);
            const titleU = (f.officerTitle || "").toUpperCase();
            if (/CFO|CEO|CHIEF EXECUTIVE|CHIEF FINANCIAL/.test(titleU)) cfoCeoBuy = true;
            if (f.isDirector) directorBuyCount++;
            recentBuys.push({ filer: f.filerName, title: f.officerTitle || (f.isDirector ? "Director" : f.isTenPctOwner ? "10% owner" : "Insider"), shares: t.shares, dollars, date: t.date });
          }
        } else if (t.code === "S" && !t.acquired && within30) {
          sellDollars30 += dollars;
        }
      }
    }

    // Scoring (0-100)
    let score = 0;
    const add = (pts, label) => { score += pts; result.contributors.push(`${label} → +${pts}`); };
    if (buyDollars30 >= 5_000_000) add(30, `Open-market insider buying $${(buyDollars30 / 1e6).toFixed(1)}M (30d)`);
    else if (buyDollars30 >= 1_000_000) add(20, `Insider buying $${(buyDollars30 / 1e6).toFixed(2)}M (30d)`);
    else if (buyDollars30 >= 100_000) add(10, `Insider buying $${Math.round(buyDollars30 / 1000)}k (30d)`);
    if (buyers30.size >= 3) add(25, `Cluster: ${buyers30.size} distinct insiders buying`);
    else if (buyers30.size === 2) add(15, `2 distinct insiders buying`);
    else if (buyers30.size === 1) add(5, `1 insider buying`);
    if (cfoCeoBuy) add(20, "CFO/CEO bought open market");
    if (directorBuyCount >= 2) add(10, `${directorBuyCount} directors bought`);
    // Penalty for heavier selling than buying
    if (sellDollars30 > buyDollars30 * 2 && buyDollars30 < 100_000) {
      const pen = Math.min(15, Math.round(15 * Math.min(1, sellDollars30 / 1e7)));
      score -= pen; result.contributors.push(`Net insider selling $${(sellDollars30 / 1e6).toFixed(1)}M → −${pen}`);
    }
    score = Math.max(0, Math.min(100, Math.round(score)));

    const summary = parsed.length === 0
      ? "EDGAR: no Form 4 filings in lookback window"
      : `EDGAR: ${parsed.length} Form 4 filings (${lookbackDays}d). Last 30d open-market buys: $${(buyDollars30 / 1e6).toFixed(2)}M across ${buyers30.size} insider${buyers30.size === 1 ? "" : "s"}${cfoCeoBuy ? " (incl. CFO/CEO)" : ""}; sells: $${(sellDollars30 / 1e6).toFixed(2)}M.`;

    result.ok = true;
    result.score = score;
    result.summary = summary;
    result.details = {
      cik, lookbackDays,
      filingsCount: parsed.length,
      buyDollars30d: Math.round(buyDollars30),
      buyShares30d: Math.round(buyShares30),
      sellDollars30d: Math.round(sellDollars30),
      distinctBuyers30d: buyers30.size,
      cfoCeoBuy,
      directorBuyCount,
      recentBuys: recentBuys.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6),
    };
    INSIDER_CACHE.set(tk, { fetchedAt: Date.now(), data: result });
    return result;
  } catch (e) {
    result.flags.push(`EDGAR error: ${e?.message || e}`);
    INSIDER_CACHE.set(tk, { fetchedAt: Date.now(), data: result });
    return result;
  }
}
