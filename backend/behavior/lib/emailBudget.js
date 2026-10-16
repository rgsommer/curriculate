// backend/behavior/lib/emailBudget.js
//
// The Resend account (100 emails/day on the free plan) is shared by every app on
// this backend AND the website — so low-priority bulk emails (teacher nudges,
// monthly summaries) must not eat the quota that notices, consequence messages,
// white slips and invites need. Before a bulk batch, ask the budget:
//   • emailsSentToday(): the ACCOUNT's sends since UTC midnight (Resend API).
//   • bulkBudget(n): can n more go out and still leave the reserve? (default:
//     limit 100, reserve 40 → bulk only while ≤60 have been used).
//   • lightestWeekday(): the weekday (Mon–Fri) with the least traffic over the
//     last 3 weeks — the day to schedule bulk sends.
// Env: RESEND_DAILY_LIMIT (100), EMAIL_BULK_RESERVE (40).

const API = "https://api.resend.com/emails";
const DAY_MS = 24 * 60 * 60 * 1000;
const SCHOOL_TZ = process.env.SCHOOL_TZ || "America/Toronto";

async function listSince(since, { maxPages = 25 } = {}) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null; // not on Resend → no shared quota to protect
  const out = [];
  let after = "";
  for (let page = 0; page < maxPages; page++) {
    const url = `${API}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Resend list failed (${res.status})`);
    const body = await res.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    let reachedOlder = false;
    for (const e of rows) {
      const t = new Date(String(e.created_at || "").replace(" ", "T").replace(/\+00$/, "Z"));
      if (isNaN(t.getTime())) continue;
      if (t < since) { reachedOlder = true; continue; }
      out.push(t);
    }
    if (reachedOlder || !body?.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return out;
}

let todayCache = { at: 0, day: "", n: 0 };
export async function emailsSentToday() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (todayCache.day === day && Date.now() - todayCache.at < 5 * 60 * 1000) return todayCache.n;
  const since = new Date(`${day}T00:00:00Z`);
  const list = await listSince(since);
  if (list === null) return null;
  todayCache = { at: Date.now(), day, n: list.length };
  return list.length;
}

/** Can a bulk batch of n emails go out today and still leave the reserve? */
export async function bulkBudget(n) {
  const limit = Number(process.env.RESEND_DAILY_LIMIT) || 100;
  const reserve = Number(process.env.EMAIL_BULK_RESERVE ?? 40);
  let sent;
  try { sent = await emailsSentToday(); }
  catch (e) {
    // Can't read usage: only let a small batch through.
    console.warn("[emailBudget] usage check failed:", e?.message || e);
    return { ok: n <= 10, sent: null, available: null, limit, reserve };
  }
  if (sent === null) return { ok: true, sent: null, available: null, limit, reserve }; // not on Resend
  const available = Math.max(0, limit - reserve - sent);
  return { ok: n <= available, sent, available, limit, reserve };
}

let lightCache = { at: 0, day: 4 };
/** Lightest school weekday (1=Mon … 5=Fri) by average sends over 3 weeks; default Thursday. */
export async function lightestWeekday() {
  if (Date.now() - lightCache.at < 12 * 60 * 60 * 1000) return lightCache.day;
  try {
    const since = new Date(Date.now() - 21 * DAY_MS);
    const list = await listSince(since, { maxPages: 25 });
    if (!list || !list.length) { lightCache = { at: Date.now(), day: 4 }; return 4; }
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, weekday: "short" });
    const idx = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
    const totals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const t of list) { const d = idx[fmt.format(t)]; if (d) totals[d] += 1; }
    // Ties → later in the week (closer to the original Thursday slot).
    const day = Number(Object.entries(totals).sort((a, b) => a[1] - b[1] || Number(b[0]) - Number(a[0]))[0][0]);
    lightCache = { at: Date.now(), day };
    return day;
  } catch (e) {
    console.warn("[emailBudget] lightest-day check failed:", e?.message || e);
    return lightCache.day || 4;
  }
}

/** Today's weekday in school time (0=Sun … 6=Sat). */
export function schoolWeekday(d = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, weekday: "short" }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[s];
}

/**
 * Who used the shared quota: the account's sends over the last `hours`, grouped
 * by sender and by subject "shape" (digits/names collapsed so per-person subjects
 * group together). Recipient addresses are never returned.
 */
export async function emailBreakdown(hours = 24) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = [];
  let after = "";
  for (let page = 0; page < 30; page++) {
    const res = await fetch(`${API}?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Resend list failed (${res.status})`);
    const body = await res.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    let older = false;
    for (const e of data) {
      const t = new Date(String(e.created_at || "").replace(" ", "T").replace(/\+00$/, "Z"));
      if (isNaN(t.getTime())) continue;
      if (t < since) { older = true; continue; }
      rows.push({ at: t, from: String(e.from || ""), subject: String(e.subject || "") });
    }
    if (older || !body?.has_more || !data.length) break;
    after = data[data.length - 1].id;
  }
  const shape = (s) => s.replace(/\d+/g, "#").replace(/—\s*[^—]+$/, "— …").slice(0, 70);
  const bySender = {}, bySubject = {}, byHour = {};
  for (const r of rows) {
    bySender[r.from] = (bySender[r.from] || 0) + 1;
    const k = `${r.from.replace(/.*<|>.*/g, "")} | ${shape(r.subject)}`;
    bySubject[k] = (bySubject[k] || 0) + 1;
    const h = new Intl.DateTimeFormat("en-CA", { timeZone: SCHOOL_TZ, hour: "2-digit", hour12: false }).format(r.at);
    byHour[h] = (byHour[h] || 0) + 1;
  }
  const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ key: k, count: v }));
  return { hours, total: rows.length, bySender: top(bySender, 15), bySubject: top(bySubject, 30), byHour: Object.fromEntries(Object.entries(byHour).sort()) };
}
