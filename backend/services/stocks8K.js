// backend/services/stocks8K.js
//
// SEC 8-K material-events feed. 8-K is the "something happened right now"
// filing — M&A announced, earnings released, exec resigned, bankruptcy,
// changes in shell company status. Fires within hours of the event and
// is often the FIRST public disclosure. Real swing-trade catalyst source.
//
// Data source: SEC EDGAR submissions API (free, authoritative, no auth).
// For each ticker → CIK → submissions.json → filter to form=8-K rows
// within lookback → extract itemNumbers directly from the "items" field.
//
// Item numbers map to standardized categories (Item 1.01 = Material
// Definitive Agreement, 2.02 = Earnings Release, 5.02 = Officer Changes,
// 8.01 = Other Material Events, etc.). See ITEM_LABELS below.

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";
const TICKER_CIK_CACHE = { fetchedAt: 0, byTicker: null };
const TICKER_CIK_TTL_MS = 24 * 60 * 60 * 1000;
const SUB_CACHE = new Map(); // cik → {fetchedAt, submissions}
const SUB_TTL_MS = 10 * 60 * 1000; // 10min — 8-Ks appear near-real-time

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
  return TICKER_CIK_CACHE.byTicker?.[String(ticker || "").toUpperCase().replace(/\..*$/, "")] || null;
}

// Item number → human label. Kept short; the SEC's official list is longer
// but these cover ~95% of what actually gets filed on 8-K.
const ITEM_LABELS = {
  "1.01": "Material Definitive Agreement (M&A, big contract signed)",
  "1.02": "Termination of Material Definitive Agreement",
  "1.03": "Bankruptcy or Receivership",
  "2.01": "Completion of Acquisition or Disposition of Assets",
  "2.02": "Results of Operations & Financial Condition (earnings)",
  "2.03": "Creation of a Direct Financial Obligation",
  "2.04": "Triggering Events That Accelerate a Direct Financial Obligation",
  "2.05": "Costs Associated with Exit or Disposal Activities (layoffs)",
  "2.06": "Material Impairments",
  "3.01": "Notice of Delisting or Failure to Satisfy Listing Rule",
  "3.02": "Unregistered Sales of Equity Securities",
  "3.03": "Material Modification to Rights of Security Holders",
  "4.01": "Changes in Registrant's Certifying Accountant (auditor change)",
  "4.02": "Non-Reliance on Previously Issued Financial Statements (restatement)",
  "5.01": "Changes in Control of Registrant",
  "5.02": "Departure/Election/Appointment of Directors or Officers",
  "5.03": "Amendments to Articles of Incorporation or Bylaws",
  "5.04": "Temporary Suspension of Trading Under Registrant's Employee Benefit Plans",
  "5.07": "Submission of Matters to a Vote of Security Holders",
  "5.08": "Shareholder Director Nominations",
  "7.01": "Regulation FD Disclosure",
  "8.01": "Other Events (material events not fitting elsewhere)",
  "9.01": "Financial Statements and Exhibits",
};

// Items that meaningfully move stocks — email-triggering signal set.
const HIGH_SIGNAL_ITEMS = new Set([
  "1.01", "1.02", "1.03", "2.01", "2.02", "2.05", "2.06",
  "3.01", "4.01", "4.02", "5.01", "5.02", "8.01",
]);

export function classifyItems(itemNumbers) {
  const labels = itemNumbers.map((n) => ITEM_LABELS[n] || `Item ${n}`);
  const highSignal = itemNumbers.some((n) => HIGH_SIGNAL_ITEMS.has(n));
  return { labels, highSignal };
}

// Fetch recent 8-K filings for one ticker. Returns [] on any error.
// Each row: {accessionNumber, filedAt, itemNumbers, primaryDocument, url}.
export async function getRecent8Ks(ticker, sinceDate = null) {
  const cik = await resolveCik(ticker);
  if (!cik) return [];
  const now = Date.now();
  let sub = SUB_CACHE.get(cik);
  if (!sub || now - sub.fetchedAt > SUB_TTL_MS) {
    const j = await secFetch(`${SEC_DATA_BASE}/submissions/CIK${cik}.json`);
    if (!j?.filings?.recent) return [];
    sub = { fetchedAt: now, submissions: j };
    SUB_CACHE.set(cik, sub);
  }
  const rec = sub.submissions.filings.recent;
  const forms = rec.form || [];
  const dates = rec.filingDate || [];
  const accns = rec.accessionNumber || [];
  const items = rec.items || [];
  const docs = rec.primaryDocument || [];
  const out = [];
  const cutoff = sinceDate ? new Date(sinceDate).getTime() : 0;
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== "8-K") continue;
    const filedAt = new Date(dates[i]);
    if (cutoff && filedAt.getTime() < cutoff) continue;
    const itemNumbers = String(items[i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const accn = accns[i];
    const accnNoDash = accn?.replace(/-/g, "");
    const primary = docs[i] || "";
    const cikNoLead = String(parseInt(cik, 10));
    const url = accn && primary
      ? `${SEC_BASE}/Archives/edgar/data/${cikNoLead}/${accnNoDash}/${primary}`
      : (accn ? `${SEC_BASE}/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K&dateb=&owner=include&count=10` : "");
    out.push({
      cik,
      accessionNumber: accn,
      filedAt,
      itemNumbers,
      primaryDocument: primary,
      url,
    });
  }
  return out.sort((a, b) => b.filedAt - a.filedAt);
}
