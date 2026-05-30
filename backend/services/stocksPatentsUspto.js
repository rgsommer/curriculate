// backend/services/stocksPatentsUspto.js
//
// Patent-filing velocity signal from the USPTO PatentsView API (free; rate-
// limited; recently started requiring an API key for higher volumes — set
// PATENTSVIEW_API_KEY if you have one, otherwise we use the unauthenticated
// endpoint with conservative pacing).
//
// Signal: number of granted patents in the last 365 days for an assignee, vs
// the prior 365-day period — accelerating R&D output is a real pre-catalyst
// signal that's invisible to price + news feeds. Score 0-100 reflects activity
// and acceleration. Graceful failure on any unexpected API response.
//
// Notes:
//  - We match by assignee organization NAME (best-effort substring match)
//    because there's no canonical ticker→assignee mapping. Big companies have
//    many subsidiaries — this catches the parent only.
//  - PatentsView grants ≠ filings — grants lag actual R&D by 2-3 years. Still
//    a useful proxy for sustained innovation velocity.

const CACHE = new Map(); // companyName → { fetchedAt, data }
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PV_BASE = "https://search.patentsview.org/api/v1";

function cleanCompanyName(name) {
  if (!name) return "";
  // Strip common corp suffixes for a cleaner assignee match.
  return String(name)
    .replace(/[,\.]/g, "")
    .replace(/\b(inc|incorporated|corp|corporation|ltd|limited|llc|holdings|plc|sa|nv|ag|kk|co)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function pvFetch(body) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  if (process.env.PATENTSVIEW_API_KEY) headers["X-Api-Key"] = process.env.PATENTSVIEW_API_KEY;
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 12000);
  try {
    const r = await fetch(`${PV_BASE}/patent/`, { method: "POST", signal: ctrl.signal, headers, body: JSON.stringify(body) });
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    return { ok: true, json: j };
  } catch (e) {
    return { ok: false, error: e?.message || "fetch_failed" };
  } finally { clearTimeout(tid); }
}

// Count patents whose assignee name CONTAINS the cleaned company name AND
// whose patent_date is on/after `since` (YYYY-MM-DD).
async function countPatentsSince(companyName, since) {
  const q = {
    q: {
      _and: [
        { _contains: { "assignees.assignee_organization": companyName } },
        { _gte: { patent_date: since } },
      ],
    },
    f: ["patent_id", "patent_date"],
    o: { size: 1000 },
  };
  const res = await pvFetch(q);
  if (!res.ok) return { ok: false, reason: res.error || `http_${res.status}` };
  // PatentsView v1 response is typically { patents: [...], total_hits: N } or { error: ... }
  const total = res.json?.total_hits ?? (Array.isArray(res.json?.patents) ? res.json.patents.length : null);
  if (total == null) return { ok: false, reason: "unexpected response shape" };
  return { ok: true, total };
}

// Public entry: return a signal object for a ticker's parent-company patent
// filing velocity. companyName is needed because PatentsView is keyed on the
// org name, not the ticker.
export async function getPatentsSignal(ticker, companyName, opts = {}) {
  const clean = cleanCompanyName(companyName);
  const out = { ok: false, ticker, companyName, cleaned: clean, score: null, summary: "", contributors: [], details: null, flags: [] };
  if (!clean || clean.length < 3) { out.flags.push("company name too short / missing for assignee match"); return out; }

  const cacheKey = clean.toLowerCase();
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return { ...cached.data, ticker };

  // Two windows: last 365d ("recent") and 365d–730d ago ("prior").
  const today = new Date();
  const fmt = (d) => d.toISOString().slice(0, 10);
  const ago = (days) => { const d = new Date(today); d.setDate(d.getDate() - days); return fmt(d); };
  const recentSince = ago(365);
  const priorSince = ago(730);
  const priorEnd = ago(365);

  // Two API calls — bounded.
  const [recentRes, totalRes] = await Promise.all([
    countPatentsSince(clean, recentSince),
    countPatentsSince(clean, priorSince), // total 730d
  ]);

  if (!recentRes.ok || !totalRes.ok) {
    out.flags.push(`PatentsView: ${recentRes.reason || totalRes.reason || "unknown error"}`);
    CACHE.set(cacheKey, { fetchedAt: Date.now(), data: out });
    return out;
  }

  const recent365 = recentRes.total;
  const total730 = totalRes.total;
  const prior365 = Math.max(0, total730 - recent365);

  // Acceleration ratio (>1 = filing pace rising)
  const accel = prior365 > 0 ? (recent365 / prior365) : (recent365 > 0 ? 2 : 1);

  let score = 0;
  const add = (pts, label) => { score += pts; out.contributors.push(`${label} → +${pts}`); };
  if (recent365 >= 100) add(35, `${recent365} grants in last 365d (heavy R&D output)`);
  else if (recent365 >= 30) add(25, `${recent365} grants in last 365d`);
  else if (recent365 >= 10) add(15, `${recent365} grants in last 365d`);
  else if (recent365 >= 3) add(8, `${recent365} grants in last 365d`);
  else if (recent365 === 0) out.contributors.push("No grants found — small assignee or name mismatch");

  if (recent365 > 0) {
    if (accel >= 1.5) add(25, `Filings accelerating ${(accel * 100 - 100).toFixed(0)}% YoY`);
    else if (accel >= 1.1) add(12, `Filings up ${(accel * 100 - 100).toFixed(0)}% YoY`);
    else if (accel <= 0.7) add(-8, `Filings down ${(100 - accel * 100).toFixed(0)}% YoY`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  out.ok = true;
  out.score = score;
  out.summary = `USPTO: ${recent365} grants in last 365d (${prior365} prior 365d, ${accel.toFixed(2)}× pace) for "${clean}".`;
  out.details = { recent365, prior365, total730, accelRatio: +accel.toFixed(2), assigneeQuery: clean };
  CACHE.set(cacheKey, { fetchedAt: Date.now(), data: out });
  return out;
}
