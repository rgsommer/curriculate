// backend/services/stocks13F.js
//
// Curated 13F institutional-whale tracking. Every quarter, US
// institutional investment managers with $100M+ AUM must file
// Form 13F-HR within 45 days of quarter-end, listing every long US
// equity position ≥ 10,000 shares or $200k in market value.
//
// The 45-day lag means these are STRUCTURAL context (what a real
// whale has been building), not timing signals — Berkshire may
// already have exited the position by the time we see it. The
// briefing formatter frames the data accordingly.
//
// Data source: SEC EDGAR (no API key). We hit the submissions
// endpoint per whale, find their most recent 13F-HR, download the
// informationtable.xml, parse holdings, resolve CUSIPs → tickers
// via FMP where possible, diff vs the same whale's prior 13F to
// mark new positions + % share changes, then persist.
//
// Fail-open EVERYWHERE — SEC down, FMP down, whale returned no 13F,
// XML malformed: skip that whale and continue. The daily briefing
// runs whether or not 13F data is fresh.

import StocksInstitutional13F from "../models/StocksInstitutional13F.js";

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA_BASE = "https://data.sec.gov";
const FMP_BASE = "https://financialmodelingprep.com";

// SEC rate limit is ~10/sec. 100ms between requests keeps us
// comfortably below and matches the delay used by the Form 4 sync.
const SEC_FETCH_DELAY_MS = 100;

// Curated whale list — deep-value, high-signal shops whose 13Fs are
// worth reading. CIK is the 10-digit zero-padded SEC identifier.
// Start small; expand only when a name proves it moves markets.
export const WHALES = [
  { cik: "0001067983", name: "Berkshire Hathaway" },
  { cik: "0001061768", name: "Baupost Group (Klarman)" },
  { cik: "0001336528", name: "Pershing Square (Ackman)" },
  { cik: "0001040273", name: "Third Point (Loeb)" },
  { cik: "0001536411", name: "Duquesne Family Office (Druckenmiller)" },
  { cik: "0001649339", name: "Scion Asset Management (Burry)" },
  { cik: "0001079114", name: "Greenlight Capital (Einhorn)" },
  { cik: "0001656456", name: "Appaloosa (Tepper)" },
  { cik: "0001135730", name: "Coatue Management" },
  { cik: "0001167483", name: "Tiger Global Management" },
  { cik: "0000921669", name: "Icahn Capital" },
  { cik: "0001697748", name: "ARK Investment Management (Wood)" },
  { cik: "0001037389", name: "Renaissance Technologies" },
  { cik: "0001350694", name: "Bridgewater Associates" },
  { cik: "0001179392", name: "Two Sigma Investments" },
];

function ua() {
  return process.env.SEC_USER_AGENT || "Curriculate Stocks Research contact@curriculate.net";
}

async function secFetch(url) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 15000);
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

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// FMP CUSIP → ticker resolver. Optional — missing key or fetch failure
// leaves ticker as null (raw CUSIP + company name still usable in the
// briefing block).
async function resolveCusipToTicker(cusip) {
  const key = process.env.FMP_API_KEY;
  if (!key || !cusip) return null;
  try {
    const url = `${FMP_BASE}/api/v3/cusip/${encodeURIComponent(cusip)}?apikey=${encodeURIComponent(key)}`;
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(tid);
    if (!r.ok) return null;
    const body = await r.json();
    const row = Array.isArray(body) ? body[0] : body;
    return row?.ticker ? String(row.ticker).toUpperCase() : null;
  } catch {
    return null;
  }
}

// Find the informationtable.xml file inside a 13F filing directory
// via the accession-level index.json. The file's exact name varies
// (usually `informationtable.xml`, sometimes `<accession>-informationtable.xml`
// or `<accession>-form13fInfoTable.xml`) so we scan the file list.
async function findInformationTableUrl(cikNoPad, accession) {
  const accNoDash = String(accession).replace(/-/g, "");
  const indexUrl = `${SEC_BASE}/Archives/edgar/data/${cikNoPad}/${accNoDash}/index.json`;
  const r = await secFetch(indexUrl);
  if (!r.ok || !r.body?.directory?.item) return null;
  const items = r.body.directory.item;
  // Prefer files whose name contains "informationtable" or "infotable"
  // (case-insensitive) and end in .xml. Some old filings only have the
  // primary submission text file with the table inlined — those we skip.
  const match = items.find(it => {
    const n = String(it?.name || "").toLowerCase();
    return n.endsWith(".xml") && (n.includes("informationtable") || n.includes("infotable") || n.includes("form13finfotable"));
  });
  if (!match) return null;
  return `${SEC_BASE}/Archives/edgar/data/${cikNoPad}/${accNoDash}/${match.name}`;
}

// Minimal, defensive XML → holdings extractor. 13F informationtable is
// a repeated `<infoTable>` (or `<ns1:infoTable>` — SEC namespaces vary)
// with `<nameOfIssuer>`, `<cusip>`, `<value>` (thousands of USD),
// `<shrsOrPrnAmt><sshPrnamt>` (shares). Regex-based on purpose — the
// docs are tiny and a full XML parser would introduce a dep for one file.
function parseInformationTableXml(xml) {
  if (!xml || typeof xml !== "string") return [];
  const out = [];
  // Match both plain and namespaced infoTable tags.
  const blockRe = /<(?:\w+:)?infoTable\b[^>]*>([\s\S]*?)<\/(?:\w+:)?infoTable>/gi;
  let m;
  while ((m = blockRe.exec(xml))) {
    const blob = m[1];
    const nameOfIssuer = pickTag(blob, "nameOfIssuer");
    const cusip = pickTag(blob, "cusip");
    const valueThousands = Number(pickTag(blob, "value")) || 0;
    // Shares can be `<shrsOrPrnAmt><sshPrnamt>N</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt>`.
    // Some filers include the sshPrnamtType=PRN (principal amount for bonds) — we
    // only want SH; if the type is present and not SH, skip the row.
    const sshBlock = pickTag(blob, "shrsOrPrnAmt") || blob;
    const shares = Number(pickTag(sshBlock, "sshPrnamt")) || 0;
    const kind = String(pickTag(sshBlock, "sshPrnamtType") || "SH").toUpperCase();
    if (kind && kind !== "SH") continue;
    if (!cusip) continue;
    out.push({
      cusip: String(cusip).trim().toUpperCase(),
      companyName: String(nameOfIssuer || "").trim(),
      sharesHeld: shares,
      // valueThousands is in thousands of dollars (SEC convention).
      valueUsd: valueThousands * 1000,
    });
  }
  return out;
}

function pickTag(blob, tag) {
  if (!blob) return "";
  const re = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i");
  const m = blob.match(re);
  return m ? m[1].trim() : "";
}

// Merge duplicate CUSIPs (same issuer reported across multiple rows —
// happens when a filer breaks out share classes or is registered in
// multiple sub-funds). Sum shares + value; keep first company name.
function collapseByCusip(rows) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.cusip);
    if (!cur) map.set(r.cusip, { ...r });
    else {
      cur.sharesHeld += r.sharesHeld;
      cur.valueUsd += r.valueUsd;
    }
  }
  return [...map.values()];
}

// Diff a new quarter's holdings against the same whale's prior filing.
// Returns the new list with each row marked with isNewPosition and
// changePct. Missing priorDoc → all rows are treated as brand-new
// (isNewPosition=true, changePct=null) since we have no baseline.
function markDeltas(newHoldings, priorDoc) {
  const priorByCusip = new Map();
  if (priorDoc?.holdings) {
    for (const h of priorDoc.holdings) priorByCusip.set(h.cusip, h);
  }
  return newHoldings.map(h => {
    const prior = priorByCusip.get(h.cusip);
    if (!prior) return { ...h, isNewPosition: true, changePct: null };
    const priorShares = Number(prior.sharesHeld) || 0;
    if (priorShares <= 0) return { ...h, isNewPosition: true, changePct: null };
    const changePct = ((h.sharesHeld - priorShares) / priorShares) * 100;
    return { ...h, isNewPosition: false, changePct: Number.isFinite(changePct) ? changePct : null };
  });
}

// Fetch the whale's submissions history, find the most recent 13F-HR
// we haven't persisted yet, download + parse + save. Returns a small
// result object; never throws (fail-open).
export async function syncWhale({ cik, name, resolveTickers = true }) {
  if (!cik || !name) return { ok: false, reason: "missing_input" };
  const cikPadded = String(cik).padStart(10, "0");
  const cikNoPad = String(parseInt(cikPadded, 10));

  const subRes = await secFetch(`${SEC_DATA_BASE}/submissions/CIK${cikPadded}.json`);
  if (!subRes.ok || !subRes.body?.filings?.recent) {
    return { ok: false, cik: cikPadded, name, reason: subRes.reason || "no_submissions" };
  }
  const rec = subRes.body.filings.recent;
  const forms = rec.form || [];
  const dates = rec.filingDate || [];
  const accs = rec.accessionNumber || [];
  const reports = rec.reportDate || [];

  // Collect all 13F-HR filings sorted newest-first.
  const filings = [];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] !== "13F-HR") continue;
    if (!accs[i]) continue;
    filings.push({
      accession: accs[i],
      filingDate: dates[i] || null,
      quarterEnd: reports[i] || null,
    });
  }
  filings.sort((a, b) => (a.filingDate < b.filingDate ? 1 : -1));

  if (filings.length === 0) {
    return { ok: false, cik: cikPadded, name, reason: "no_13f_filings" };
  }

  const latest = filings[0];
  if (!latest.quarterEnd) {
    return { ok: false, cik: cikPadded, name, reason: "missing_quarter_end" };
  }

  // Already persisted?
  const existing = await StocksInstitutional13F.findOne({
    cik: cikPadded,
    quarterEnd: new Date(latest.quarterEnd),
  }).select({ accessionNumber: 1 }).lean();
  if (existing) {
    return { ok: true, cik: cikPadded, name, reason: "already_persisted", accession: existing.accessionNumber };
  }

  await delay(SEC_FETCH_DELAY_MS);

  const infoTableUrl = await findInformationTableUrl(cikNoPad, latest.accession);
  if (!infoTableUrl) {
    return { ok: false, cik: cikPadded, name, reason: "no_information_table" };
  }

  await delay(SEC_FETCH_DELAY_MS);

  const xmlRes = await secFetch(infoTableUrl);
  if (!xmlRes.ok) {
    return { ok: false, cik: cikPadded, name, reason: xmlRes.reason || "xml_fetch_failed" };
  }

  const rawHoldings = collapseByCusip(parseInformationTableXml(
    typeof xmlRes.body === "string" ? xmlRes.body : ""
  ));
  if (rawHoldings.length === 0) {
    return { ok: false, cik: cikPadded, name, reason: "no_holdings_parsed" };
  }

  // Resolve tickers (best-effort). Serial with a tiny delay to avoid
  // hammering FMP; failure → ticker stays null.
  if (resolveTickers) {
    for (const h of rawHoldings) {
      h.ticker = await resolveCusipToTicker(h.cusip);
    }
  }

  // Compute deltas vs prior quarter.
  const prior = await StocksInstitutional13F.findOne({
    cik: cikPadded,
    quarterEnd: { $lt: new Date(latest.quarterEnd) },
  }).sort({ quarterEnd: -1 }).lean();
  const marked = markDeltas(rawHoldings, prior);

  try {
    await StocksInstitutional13F.create({
      cik: cikPadded,
      whaleName: name,
      quarterEnd: new Date(latest.quarterEnd),
      filedAt: new Date(latest.filingDate || Date.now()),
      accessionNumber: latest.accession,
      holdings: marked,
      fetchedAt: new Date(),
    });
  } catch (e) {
    if (e?.code === 11000) return { ok: true, cik: cikPadded, name, reason: "dup_key" };
    return { ok: false, cik: cikPadded, name, reason: e?.message || "persist_failed" };
  }

  return {
    ok: true,
    cik: cikPadded,
    name,
    quarterEnd: latest.quarterEnd,
    accession: latest.accession,
    holdingsCount: marked.length,
    newPositions: marked.filter(h => h.isNewPosition).length,
  };
}

// Load the freshest available 13F for every whale. Returns an array
// sorted by quarterEnd desc — the formatter picks the most recent
// quarter and cites moves from it.
export async function getLatestWhaleFilings() {
  const rows = await StocksInstitutional13F.find({}).sort({ quarterEnd: -1 }).lean();
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (seen.has(r.cik)) continue;
    seen.add(r.cik);
    out.push(r);
  }
  return out;
}

// Build the briefing block from stored 13Fs. Filters to changes ≥ 20%,
// new positions, and full liquidations. Caps at 15 lines to avoid
// bloating the prompt.
export function format13FBlock(latestFilings) {
  if (!Array.isArray(latestFilings) || latestFilings.length === 0) return "";
  // Group by quarter — the header cites the quarter and the 45-day
  // lag advisory once, so a mixed-quarter dataset still reads clean.
  const quarters = new Map(); // yyyy-mm-dd → count
  for (const f of latestFilings) {
    const q = f.quarterEnd ? new Date(f.quarterEnd).toISOString().slice(0, 10) : "";
    if (q) quarters.set(q, (quarters.get(q) || 0) + 1);
  }
  const dominantQuarter = [...quarters.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const lines = [];
  for (const f of latestFilings) {
    const whale = f.whaleName;
    const rows = Array.isArray(f.holdings) ? f.holdings : [];
    // Sort by value desc so the biggest moves surface first.
    const sorted = [...rows].sort((a, b) => (b.valueUsd || 0) - (a.valueUsd || 0));
    for (const h of sorted) {
      if (lines.length >= 15) break;
      const label = h.ticker ? h.ticker : (h.companyName || h.cusip);
      const shares = Number(h.sharesHeld) || 0;
      const valUsd = Number(h.valueUsd) || 0;
      const valStr = formatUsd(valUsd);
      const sharesStr = formatShares(shares);
      if (h.isNewPosition) {
        lines.push(`- ${whale} added NEW position: ${label} ${sharesStr} sh (${valStr})`);
      } else if (Number.isFinite(h.changePct) && Math.abs(h.changePct) >= 20) {
        const dir = h.changePct >= 0 ? "increased" : "trimmed";
        const sign = h.changePct >= 0 ? "+" : "";
        lines.push(`- ${whale} ${dir} ${label} ${sign}${h.changePct.toFixed(0)}% to ${sharesStr} sh (${valStr})`);
      }
    }
    if (lines.length >= 15) break;
  }

  if (lines.length === 0) return "";

  const header = `INSTITUTIONAL 13F MOVES (last completed quarter${dominantQuarter ? `, ~${dominantQuarter}` : ""}, whales tracked):`;
  const footer = `NOTE: 13F data has a 45-day filing lag. These are positions as of quarter-end — the whale may have already exited by now. Treat as CONTEXT for structural theses, NOT as timing signals.`;
  return `\n${header}\n${lines.join("\n")}\n${footer}\n`;
}

function formatUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return "$0";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}

function formatShares(n) {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return `${Math.round(n)}`;
}
