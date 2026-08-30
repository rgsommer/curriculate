// backend/services/stocksInsiderSignals.js
//
// Ingest SEC Form 4 filings for a list of tickers, persist individual
// transactions, and detect cluster-buy / cluster-sell patterns worth
// surfacing in the daily briefing.
//
// Data source: EDGAR (no API key). SEC requires a User-Agent header
// identifying us — see `ua()` below. Rate limit: SEC allows ~10 req/s;
// we throttle with a small inter-request delay.
//
// Complements existing `stocksInsiderEdgar.js` which does per-request
// scoring without persistence. This service persists raw transactions
// and computes cluster signals so the briefing block can cite specific
// filings + insiders instead of a one-shot score.

import StocksInsiderTransaction from "../models/StocksInsiderTransaction.js";
import StocksInsiderSignal from "../models/StocksInsiderSignal.js";

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";
const TICKER_CIK_CACHE = { fetchedAt: 0, byTicker: null };
const TICKER_CIK_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week per spec

// SEC rate limit is ~10/sec — 60ms between fetches keeps us safely below.
const SEC_FETCH_DELAY_MS = 90;

// Same alias map used elsewhere so brand acronyms → real exchange tickers.
const TICKER_ALIASES = {
  RBC: "RY", ROYAL: "RY", SCOTIA: "BNS", CIBC: "CM",
  ENBRIDGE: "ENB", FORTIS: "FTS", MANULIFE: "MFC",
  GOOGLE: "GOOGL", FACEBOOK: "META", FB: "META",
  SQUARE: "XYZ", SQ: "XYZ",
};

function ua() {
  return process.env.SEC_USER_AGENT || "Curriculate Stocks Research contact@curriculate.net";
}

async function secFetch(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": ua(), Accept: "application/json,text/xml,*/*" },
    });
    if (r.status === 429) return { ok: false, reason: "http_429" };
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const ct = r.headers.get("content-type") || "";
    const body = ct.includes("json") ? await r.json() : await r.text();
    return { ok: true, body };
  } catch (e) {
    return { ok: false, reason: e?.message || "fetch_failed" };
  } finally {
    clearTimeout(tid);
  }
}

// Strip trailing dot / apply alias / drop CAD suffix. EDGAR lists only
// US-listed securities so a CAD suffix (.TO) will always fail — strip
// to the bare US ticker if aliased there (RY.TO → RY works: RY is on NYSE).
function normalizeTickerForEdgar(t) {
  const raw = String(t || "").toUpperCase().replace(/\.+$/, "");
  const stripped = raw.replace(/\.(TO|V|NE|CN)$/, "");
  return TICKER_ALIASES[stripped] || stripped;
}

// Ticker → 10-digit zero-padded CIK. Bulk mapping cached one week.
async function resolveCik(ticker) {
  const now = Date.now();
  if (!TICKER_CIK_CACHE.byTicker || now - TICKER_CIK_CACHE.fetchedAt > TICKER_CIK_TTL_MS) {
    const r = await secFetch(`${SEC_BASE}/files/company_tickers.json`);
    if (r.ok && r.body && typeof r.body === "object") {
      const map = {};
      for (const k of Object.keys(r.body)) {
        const row = r.body[k];
        if (row?.ticker) map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, "0");
      }
      TICKER_CIK_CACHE.byTicker = map;
      TICKER_CIK_CACHE.fetchedAt = now;
    }
  }
  const norm = normalizeTickerForEdgar(ticker);
  return TICKER_CIK_CACHE.byTicker?.[norm] || null;
}

// ── Minimal Form-4 XML extractor (regex, defensive — SEC XML is small) ─
function extractInner(blob, tag) {
  const m = (blob || "").match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? m[1] : null;
}
function extractValue(blob, tag) {
  const inner = extractInner(blob, tag);
  if (!inner) return null;
  const v = inner.match(/<value>([\s\S]*?)<\/value>/i);
  return v ? v[1].trim() : inner.trim();
}
function extractAll(blob, tag) {
  const out = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  let m;
  while ((m = re.exec(blob || "")) !== null) out.push(m[1]);
  return out;
}

function classifyRole({ isDirector, isOfficer, isTenPctOwner, officerTitle }) {
  const title = String(officerTitle || "").toUpperCase();
  if (/CHIEF EXECUTIVE|\bCEO\b/.test(title)) return "CEO";
  if (/CHIEF FINANCIAL|\bCFO\b/.test(title)) return "CFO";
  if (/CHIEF OPERATING|\bCOO\b/.test(title)) return "COO";
  if (/CHIEF TECHNOLOGY|\bCTO\b/.test(title)) return "CTO";
  if (isTenPctOwner) return "10%_holder";
  if (isDirector) return "Director";
  if (isOfficer) return "Officer";
  return "Other";
}

function parseForm4Xml(xml) {
  if (!xml || typeof xml !== "string") return null;
  const ownerBlock = extractInner(xml, "reportingOwner") || "";
  const filerName = extractValue(ownerBlock, "rptOwnerName") || "";
  const rel = extractInner(ownerBlock, "reportingOwnerRelationship") || "";
  const isDirector = /<isDirector>\s*(1|true)\s*<\/isDirector>/i.test(rel);
  const isOfficer = /<isOfficer>\s*(1|true)\s*<\/isOfficer>/i.test(rel);
  const isTenPctOwner = /<isTenPercentOwner>\s*(1|true)\s*<\/isTenPercentOwner>/i.test(rel);
  const officerTitle = (rel.match(/<officerTitle>([\s\S]*?)<\/officerTitle>/i) || [, ""])[1]
    .replace(/<[^>]+>/g, "").trim();

  const role = classifyRole({ isDirector, isOfficer, isTenPctOwner, officerTitle });

  const transactions = [];
  const push = (tBlock, isDerivative) => {
    const date = extractValue(tBlock, "transactionDate");
    const codeMatch = tBlock.match(/<transactionCode>\s*([A-Z])\s*<\/transactionCode>/i);
    const code = codeMatch ? codeMatch[1].toUpperCase() : "";
    const shares = parseFloat(extractValue(tBlock, "transactionShares") || "");
    const price = parseFloat(extractValue(tBlock, "transactionPricePerShare") || "");
    const ad = extractValue(tBlock, "transactionAcquiredDisposedCode");
    if (date && code && Number.isFinite(shares) && shares > 0) {
      transactions.push({
        date, code,
        shares,
        price: Number.isFinite(price) ? price : null,
        acquiredDisposed: ad === "A" ? "A" : ad === "D" ? "D" : null,
        isDerivative,
      });
    }
  };
  for (const b of extractAll(xml, "nonDerivativeTransaction")) push(b, false);
  for (const b of extractAll(xml, "derivativeTransaction")) push(b, true);
  return { filerName: String(filerName).trim(), role, transactions };
}

// Sync one ticker: pull recent Form 4 filings, parse the new ones, persist.
// Returns { ok, ticker, cik, inserted, skipped, reason? }.
export async function syncInsiderForTicker(ticker, { lookbackDays = 45 } = {}) {
  const tk = normalizeTickerForEdgar(ticker);
  if (!tk) return { ok: false, ticker, reason: "empty_ticker" };

  const cik = await resolveCik(tk);
  if (!cik) return { ok: false, ticker: tk, reason: "no_cik" };

  const subRes = await secFetch(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`);
  if (!subRes.ok || !subRes.body?.filings?.recent) {
    return { ok: false, ticker: tk, cik, reason: subRes.reason || "no_submissions" };
  }

  const cikNoPad = String(parseInt(cik, 10));
  const cutoff = new Date(Date.now() - lookbackDays * 86400 * 1000);
  const rec = subRes.body.filings.recent;
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
  candidates.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));

  // Skip filings we've already fully persisted. Existing rows are keyed by
  // accessionNumber; a single accession may produce multiple rows so this
  // is a lightweight duplicate-guard, not a source-of-truth check.
  const knownAccs = new Set(
    (await StocksInsiderTransaction.find(
      { ticker: tk, accessionNumber: { $in: candidates.map(c => c.accession) } },
      { accessionNumber: 1 }
    ).lean()).map(r => r.accessionNumber)
  );

  let inserted = 0, skipped = 0;
  for (const c of candidates) {
    if (!c.accession || !c.doc) { skipped++; continue; }
    if (knownAccs.has(c.accession)) { skipped++; continue; }
    const accNoDash = String(c.accession).replace(/-/g, "");
    const url = `${SEC_BASE}/Archives/edgar/data/${cikNoPad}/${accNoDash}/${c.doc}`;
    const xmlRes = await secFetch(url);
    if (!xmlRes.ok) {
      await new Promise(r => setTimeout(r, SEC_FETCH_DELAY_MS));
      continue;
    }
    const parsed = parseForm4Xml(typeof xmlRes.body === "string" ? xmlRes.body : "");
    if (!parsed) {
      await new Promise(r => setTimeout(r, SEC_FETCH_DELAY_MS));
      continue;
    }
    for (const t of parsed.transactions) {
      const priceUsd = Number.isFinite(t.price) ? t.price : null;
      const doc = {
        ticker: tk,
        cik,
        accessionNumber: c.accession,
        insiderName: parsed.filerName,
        insiderRole: parsed.role,
        transactionCode: t.code,
        sharesTraded: t.shares,
        pricePerShare: priceUsd,
        totalValueUsd: priceUsd != null ? Math.round(priceUsd * t.shares) : 0,
        transactionDate: new Date(t.date),
        filingDate: new Date(c.filingDate),
        isDerivative: t.isDerivative,
        acquiredDisposed: t.acquiredDisposed,
        formUrl: url,
        fetchedAt: new Date(),
      };
      try {
        await StocksInsiderTransaction.create(doc);
        inserted++;
      } catch (e) {
        // Duplicate-key = row already exists; anything else logged but not thrown
        if (e?.code !== 11000) console.warn(`[insider-sync] persist ${tk} warn: ${e?.message}`);
        else skipped++;
      }
    }
    await new Promise(r => setTimeout(r, SEC_FETCH_DELAY_MS));
  }

  return { ok: true, ticker: tk, cik, inserted, skipped };
}

// Role-weight for cluster scoring per spec.
const ROLE_WEIGHT = {
  CEO: 3, CFO: 2, COO: 2, CTO: 2,
  Director: 1, "10%_holder": 2, Officer: 1, Other: 0.5,
};

function isDiscretionaryCode(code, kind) {
  if (kind === "cluster_buy") return code === "P"; // open-market purchase
  if (kind === "cluster_sell") return code === "S"; // ordinary sale, exclude F/M/A
  return false;
}

// Compute cluster signals for one ticker across a rolling window.
// Persists any new signal detected (dedupes by ticker+kind+day).
export async function detectClusters(ticker, { windowDays = 30 } = {}) {
  const tk = normalizeTickerForEdgar(ticker);
  const since = new Date(Date.now() - windowDays * 86400 * 1000);
  const rows = await StocksInsiderTransaction.find({
    ticker: tk,
    transactionDate: { $gte: since },
    isDerivative: false,
  }).lean();

  const detected = [];
  for (const kind of ["cluster_buy", "cluster_sell"]) {
    const relevant = rows.filter(r => isDiscretionaryCode(r.transactionCode, kind)
      // Sales must be A/D correctly signed — sells that are dispositions
      // (D) with code S count; buys (P) that acquired (A) count.
      && (kind === "cluster_buy" ? r.acquiredDisposed !== "D" : r.acquiredDisposed !== "A"));
    if (relevant.length === 0) continue;

    // Dedupe by insider name; compute weighted score
    const byInsider = new Map();
    for (const r of relevant) {
      const key = (r.insiderName || "unknown").toUpperCase();
      const prev = byInsider.get(key) || {
        name: r.insiderName, role: r.insiderRole,
        shares: 0, totalValueUsd: 0, transactionDates: [],
      };
      prev.shares += r.sharesTraded || 0;
      prev.totalValueUsd += r.totalValueUsd || 0;
      prev.transactionDates.push(r.transactionDate);
      byInsider.set(key, prev);
    }
    const insiders = [...byInsider.values()].map(x => ({
      ...x,
      avgPrice: x.shares > 0 ? x.totalValueUsd / x.shares : null,
    }));

    const uniqueCount = insiders.length;
    const weightedScore = insiders.reduce((s, i) => s + (ROLE_WEIGHT[i.role] || 0.5), 0);
    const execCount = insiders.filter(i => ["CEO", "CFO", "COO", "CTO"].includes(i.role)).length;
    const directorCount = insiders.filter(i => i.role === "Director").length;
    const tenPctCount = insiders.filter(i => i.role === "10%_holder").length;

    let emit = false;
    if (kind === "cluster_buy") {
      // spec: ≥3 unique insiders, weighted ≥ 5, ≥1 exec
      emit = uniqueCount >= 3 && weightedScore >= 5 && execCount >= 1;
    } else {
      // sells noisier — require weighted ≥8 AND the F/M codes are already
      // excluded above so what's left is discretionary "S" only.
      emit = uniqueCount >= 3 && weightedScore >= 8;
    }
    if (!emit) continue;

    // Dedupe: one signal per (ticker, kind, YYYY-MM-DD)
    const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
    const existing = await StocksInsiderSignal.findOne({
      ticker: tk, kind,
      detectedAt: { $gte: todayStart },
    }).lean();
    if (existing) { detected.push(existing); continue; }

    const totalShares = insiders.reduce((s, i) => s + i.shares, 0);
    const totalValueUsd = insiders.reduce((s, i) => s + i.totalValueUsd, 0);
    const avgPrice = totalShares > 0 ? totalValueUsd / totalShares : null;

    const doc = await StocksInsiderSignal.create({
      ticker: tk, kind,
      strength: Math.round(weightedScore * 10) / 10,
      uniqueInsiderCount: uniqueCount,
      execCount, directorCount, tenPctCount,
      windowDays,
      insiders: insiders.slice(0, 10),
      totalSharesTraded: totalShares,
      totalValueUsd: Math.round(totalValueUsd),
      avgPricePerShare: avgPrice,
      detectedAt: new Date(),
    });
    detected.push(doc.toObject());
  }
  return detected;
}

// ─── Insider cluster VELOCITY (Tier 2.2 audit Aug-28) ────────────
// Compare weighted-cluster-score in the recent window vs the prior
// window of the same length. Positive velocity = clusters are
// accelerating (recent 30d has more insider conviction than the
// previous 30d) — leading indicator of a management-driven inflection.
//
// Returns Map<base_ticker, { recentScore, priorScore, velocityScore,
// velocityDeltaPct }>. `velocityDeltaPct` is the % change; a delta
// of +100 means the recent window's weighted score is double the
// prior window.
//
// Batched — one Mongo read per ticker (matches the existing
// getRecentInsiderSignals pattern in cost). Called by the pick engine
// stage-2 in parallel with `getRecentInsiderSignals`.
export async function getInsiderClusterVelocity(tickers, { windowDays = 30 } = {}) {
  const uniq = [...new Set((tickers || []).map(normalizeTickerForEdgar).filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const now = Date.now();
  const recentSince = new Date(now - windowDays * 86400 * 1000);
  const priorSince = new Date(now - 2 * windowDays * 86400 * 1000);
  const out = new Map();
  // One aggregation per ticker (parallel with concurrency guard).
  const CONC = 6;
  for (let i = 0; i < uniq.length; i += CONC) {
    const slice = uniq.slice(i, i + CONC);
    await Promise.all(slice.map(async (tk) => {
      try {
        // Pull raw transactions from both windows.
        const rows = await StocksInsiderTransaction.find({
          ticker: tk,
          transactionDate: { $gte: priorSince },
          isDerivative: false,
        }).lean();
        if (!Array.isArray(rows) || rows.length === 0) return;
        // Compute weighted score for each window: sum of role weights
        // over unique buy-side insiders in that window.
        const weightedFor = (from, to) => {
          const relevant = rows.filter(r => {
            const d = new Date(r.transactionDate);
            if (!(d >= from && d < to)) return false;
            if (!isDiscretionaryCode(r.transactionCode, "cluster_buy")) return false;
            if (r.acquiredDisposed === "D") return false;
            return true;
          });
          const byInsider = new Map();
          for (const r of relevant) {
            const key = (r.insiderName || "unknown").toUpperCase();
            const prev = byInsider.get(key) || { role: r.insiderRole };
            byInsider.set(key, prev);
          }
          let score = 0;
          for (const v of byInsider.values()) score += (ROLE_WEIGHT[v.role] || 0.5);
          return { score, count: byInsider.size };
        };
        const recent = weightedFor(recentSince, new Date(now));
        const prior = weightedFor(priorSince, recentSince);
        // Delta as % change. Special cases:
        //   • prior=0 recent>0 → +999 (uncapped-new-signal marker)
        //   • both 0 → skip (no data to report)
        //   • recent<prior → negative velocity (clusters cooling)
        if (recent.score === 0 && prior.score === 0) return;
        const velocityDeltaPct = prior.score > 0
          ? ((recent.score - prior.score) / prior.score) * 100
          : (recent.score > 0 ? 999 : 0);
        const base = String(tk).toUpperCase().replace(/\..*$/, "");
        out.set(base, {
          recentScore: recent.score,
          priorScore: prior.score,
          recentCount: recent.count,
          priorCount: prior.count,
          velocityDeltaPct,
        });
      } catch { /* soft-fail per ticker */ }
    }));
  }
  return out;
}

// Load recent signals for a set of tickers (held + starred), for prompt injection.
export async function getRecentInsiderSignals(tickers, { days = 30, limit = 30 } = {}) {
  const uniq = [...new Set((tickers || []).map(normalizeTickerForEdgar).filter(Boolean))];
  if (uniq.length === 0) return [];
  const since = new Date(Date.now() - days * 86400 * 1000);
  return await StocksInsiderSignal.find({
    ticker: { $in: uniq },
    detectedAt: { $gte: since },
  }).sort({ detectedAt: -1, strength: -1 }).limit(limit).lean();
}

// Also surface "notable but below cluster threshold" activity — a single
// exec buy on a held name is worth noting even if it's not a cluster.
async function getNotableSoloBuys(tickers, { days = 30 } = {}) {
  const uniq = [...new Set((tickers || []).map(normalizeTickerForEdgar).filter(Boolean))];
  if (uniq.length === 0) return [];
  const since = new Date(Date.now() - days * 86400 * 1000);
  const rows = await StocksInsiderTransaction.find({
    ticker: { $in: uniq },
    transactionDate: { $gte: since },
    transactionCode: "P",
    acquiredDisposed: "A",
    isDerivative: false,
    insiderRole: { $in: ["CEO", "CFO", "COO", "CTO", "Director", "10%_holder"] },
  }).sort({ transactionDate: -1 }).limit(60).lean();
  // Group by ticker, take the largest by dollar value
  const byTicker = {};
  for (const r of rows) {
    const t = r.ticker;
    if (!byTicker[t]) byTicker[t] = r;
    else if ((r.totalValueUsd || 0) > (byTicker[t].totalValueUsd || 0)) byTicker[t] = r;
  }
  return Object.values(byTicker);
}

// ─── Prompt-injection formatter ───────────────────────────────────────
// Returns "" when there's nothing to say (never a nag string). Signals
// carry role labels + dollar totals so the AI can cite specifics.
export function formatInsiderSignalsBlock(signals) {
  if (!Array.isArray(signals) || signals.length === 0) return "";

  const clusterBuys = signals.filter(s => s.kind === "cluster_buy");
  const clusterSells = signals.filter(s => s.kind === "cluster_sell");
  const noteBelow = signals.filter(s => s.__solo);

  const lines = [
    `\nINSIDER TRANSACTIONS (SEC Form 4, past 30 days — held names + watchlist):`,
  ];
  for (const s of clusterBuys.slice(0, 8)) {
    const roles = summarizeRoles(s.insiders);
    const valueStr = s.totalValueUsd >= 1e6
      ? `$${(s.totalValueUsd / 1e6).toFixed(2)}M`
      : `$${Math.round(s.totalValueUsd / 1000)}k`;
    const priceStr = s.avgPricePerShare ? ` @ avg $${s.avgPricePerShare.toFixed(2)}` : "";
    lines.push(`  🔥 ${s.ticker} cluster BUY: ${s.uniqueInsiderCount} insiders (${roles}) purchased ${s.totalSharesTraded.toLocaleString()} sh${priceStr} — ${valueStr}. Cluster score: ${s.strength}.`);
  }
  for (const s of clusterSells.slice(0, 8)) {
    const roles = summarizeRoles(s.insiders);
    const valueStr = s.totalValueUsd >= 1e6
      ? `$${(s.totalValueUsd / 1e6).toFixed(2)}M`
      : `$${Math.round(s.totalValueUsd / 1000)}k`;
    lines.push(`  ⚠ ${s.ticker} cluster SELL: ${s.uniqueInsiderCount} insiders (${roles}) sold ${s.totalSharesTraded.toLocaleString()} sh — ${valueStr}. Cluster score: ${s.strength}. Note: some may be 10b5-1 scheduled.`);
  }
  for (const s of noteBelow.slice(0, 5)) {
    const value = s.totalValueUsd ? ` ($${Math.round(s.totalValueUsd / 1000)}k)` : "";
    lines.push(`  · ${s.ticker}: ${s.insiderRole} ${s.insiderName} bought ${s.sharesTraded.toLocaleString()} sh @ $${s.pricePerShare?.toFixed(2) || "?"}${value} (below cluster threshold; noted only).`);
  }
  lines.push(`  How to read: cluster buys (≥3 insiders, exec-weighted score ≥5) are a POSITIVE forward signal historically. Cluster sells rarely as informative — often 10b5-1 diversification.`);
  return lines.join("\n");
}

function summarizeRoles(insiders) {
  const roleCount = {};
  for (const i of insiders || []) roleCount[i.role || "Other"] = (roleCount[i.role || "Other"] || 0) + 1;
  const parts = [];
  for (const [role, n] of Object.entries(roleCount)) {
    parts.push(n > 1 ? `${n} ${role}s` : role);
  }
  return parts.join(", ");
}

// Public helper for the daily-briefing pipeline — resolves the user's
// held tickers + starred watchlist, then loads recent signals + notable
// solo buys and returns a merged array the formatter can render.
export async function getInsiderSignalsForUser(profile) {
  const held = (profile?.positions || []).map(p => normalizeTickerForEdgar(p.ticker)).filter(Boolean);
  let starred = [];
  try {
    const StocksDiscoveryCandidate = (await import("../models/StocksDiscoveryCandidate.js")).default;
    const rows = await StocksDiscoveryCandidate.find({
      email: profile?.email?.toLowerCase(),
      starred: true, dismissed: { $ne: true },
    }).select({ ticker: 1 }).limit(20).lean();
    starred = rows.map(r => normalizeTickerForEdgar(r.ticker));
  } catch { /* watchlist lookup optional */ }
  const tickers = [...new Set([...held, ...starred])];
  if (tickers.length === 0) return [];
  const clusters = await getRecentInsiderSignals(tickers).catch(() => []);
  const clusteredSet = new Set(clusters.map(c => c.ticker));
  const solos = (await getNotableSoloBuys(tickers).catch(() => []))
    .filter(s => !clusteredSet.has(s.ticker))
    .map(s => ({ ...s, __solo: true }));
  return [...clusters, ...solos];
}
