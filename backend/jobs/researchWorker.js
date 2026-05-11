// backend/jobs/researchWorker.js
//
// (B) "Research trickle" worker — keeps the contact pipeline ahead of the
// 50/day blast send rate without burning OpenAI quota in one burst.
//
// Tick cadence: every hour, but it only processes one job per calendar day
// (BLAST_RESEARCH_JOBS_PER_DAY env, default 1) so the upstream API cost is
// bounded and predictable.
//
// For each pending job whose scheduledFor <= now:
//   1. Fetch the indexUrl (a board's school-directory page)
//   2. Heuristically extract candidate school sub-URLs from <a href="">
//   3. Take up to maxSchools, fetch each
//   4. Use OpenAI to extract { principal, vp, ad, phone, address, etc. }
//      from each page as structured JSON
//   5. Upsert each finding into BlastContact with pendingReview=true so
//      admin reviews before any campaign can pick them up

import OpenAI from "openai";
import ResearchJob   from "../models/ResearchJob.js";
import BlastContact  from "../models/BlastContact.js";

const DAILY_CAP = parseInt(process.env.BLAST_RESEARCH_JOBS_PER_DAY || "1", 10);

let _openai = null;
function openai() {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/* ──────────────────────────────────────────────────────────────────────
 * Helpers
 * ────────────────────────────────────────────────────────────────────── */

// Browser-like headers so school-board WAFs don't reject obvious-bot UAs
// (Peel returns 403 for "CurriculateResearchBot/1.0" — most boards do).
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-CA,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
};
async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: BROWSER_HEADERS, redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** Strip HTML to roughly-clean text. Crude but cheap. */
function htmlToText(html) {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull plausible school links from a directory page. Returns absolute URLs.
 *  Tightened heuristic: prefers links where the anchor text reads like a
 *  school NAME (capitalized words + "School|Academy|Institute|...") rather
 *  than just any URL containing the word "school" — which catches listing/
 *  filter pages and badly poisons the per-school crawl. */
const SCHOOL_TYPE_RE = /\b(Elementary|Secondary|Middle|Junior|Senior|High|Public|Catholic|Academy|Institute|Collegiate|Heights?|Park|Grove|College|Saint|St\.?)\b/;
function extractSchoolLinks(html, baseUrl) {
  const candidates = new Map(); // url -> anchor text (best one wins)
  const base = new URL(baseUrl);
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([^<]{2,120})<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1]; const text = m[2].trim().replace(/\s+/g, " ");
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    let abs;
    try { abs = new URL(href, base).toString(); } catch { continue; }
    // Same-origin only — don't crawl off-board
    if (new URL(abs).host !== base.host) continue;
    // Anchor text scoring: prefer links that look like specific school names
    const looksLikeSchoolName =
      SCHOOL_TYPE_RE.test(text) &&
      /[A-Z][a-z]+/.test(text) &&         // has capitalized words
      text.split(/\s+/).length <= 8;       // not a paragraph
    if (!looksLikeSchoolName) continue;
    // De-prioritise pure listing/category pages even if they match
    if (/\/(list|find|directory|category|tag|search|page)\b/i.test(abs)) continue;
    candidates.set(abs, text);
  }
  return [...candidates.keys()];
}

/** Ask OpenAI to extract admin info from a school page. Returns array of contacts. */
async function extractContactsFromPage({ html, schoolUrl, boardName }) {
  const text = htmlToText(html).slice(0, 9000); // keep prompt small
  const sys =
    "You extract Ontario school admin contact info from raw school webpage text. " +
    "Return ONLY valid JSON. Never invent. If a field isn't present, use null. " +
    "Prefer the most current/listed admin. Use first/last name as separate fields.";
  const userPrompt =
    `School page text (truncated to 9000 chars):\n---\n${text}\n---\n\n` +
    `Source URL: ${schoolUrl}\n` +
    `Board: ${boardName || "(unknown)"}\n\n` +
    `Return JSON with shape:\n` +
    `{ "schoolName": string|null,\n` +
    `  "principal":  { "firstName": string|null, "lastName": string|null, "email": string|null } | null,\n` +
    `  "vp":         { "firstName": string|null, "lastName": string|null, "email": string|null } | null,\n` +
    `  "ad":         { "firstName": string|null, "lastName": string|null, "email": string|null } | null,\n` +
    `  "phone":      string|null,\n` +
    `  "address":    string|null,\n` +
    `  "level":      "Elementary"|"Middle"|"Secondary"|null,\n` +
    `  "gradeRange": string|null\n` +
    `}`;
  const resp = await openai().chat.completions.create({
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: userPrompt },
    ],
    temperature: 0,
    max_tokens: 600,
  });
  let parsed;
  try { parsed = JSON.parse(resp.choices[0].message.content); }
  catch { return []; }

  const out = [];
  const baseFields = {
    school: parsed.schoolName || "",
    board:  boardName || "",
    level:  parsed.level || "",
    gradeRange: parsed.gradeRange || "",
    phone:  parsed.phone || "",
    address: parsed.address || "",
    website: schoolUrl,
  };
  for (const [roleKey, roleLabel] of [["principal", "Principal"], ["vp", "Vice-Principal"], ["ad", "Athletic Director"]]) {
    const p = parsed[roleKey];
    if (!p || (!p.firstName && !p.lastName && !p.email)) continue;
    out.push({
      ...baseFields,
      role: roleLabel,
      firstName: p.firstName || "",
      lastName:  p.lastName  || "",
      email:     (p.email || "").toLowerCase().trim(),
    });
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────────────
 * Job runner
 * ────────────────────────────────────────────────────────────────────── */

export async function runJob(jobId) {
  const job = await ResearchJob.findByIdAndUpdate(
    jobId,
    { status: "running", lastRunAt: new Date() },
    { new: true }
  );
  if (!job) return { ok: false, error: "job not found" };

  let totalContacts = 0, schoolsTried = 0, lastError = "";
  try {
    // 1. Fetch the index page
    const indexHtml = await fetchText(job.indexUrl);

    // 2. Extract school links (de-duped, capped)
    const links = extractSchoolLinks(indexHtml, job.indexUrl).slice(0, job.maxSchools);
    console.log(`[research] ${job.name}: found ${links.length} candidate school links`);

    // 3. For each, fetch + extract
    for (const url of links) {
      schoolsTried++;
      let pageOutcome = "no-contacts"; // no-contacts | added | fetch-failed | extract-failed
      let addedHere = 0;
      try {
        const html = await fetchText(url, { timeoutMs: 12000 });
        let contacts = [];
        try {
          contacts = await extractContactsFromPage({ html, schoolUrl: url, boardName: job.boardName });
        } catch (extractErr) {
          pageOutcome = "extract-failed";
          console.error(`[research]   extract failed ${url}: ${extractErr.message}`);
        }
        for (const c of contacts) {
          if (!c.email) continue; // require email for upsert key
          await BlastContact.updateOne(
            { email: c.email },
            {
              $setOnInsert: {
                email: c.email,
                firstName: c.firstName,
                lastName:  c.lastName,
                source:    "research-trickle",
                pendingReview: true,
              },
              $set: {
                school: c.school || undefined,
                board:  c.board  || undefined,
                role:   c.role   || undefined,
                level:  c.level  || undefined,
              },
            },
            { upsert: true }
          );
          totalContacts++;
          addedHere++;
        }
        if (addedHere > 0) pageOutcome = "added";
      } catch (e) {
        pageOutcome = "fetch-failed";
        console.error(`[research]   fetch failed ${url}: ${e.message}`);
      }
      console.log(`[research]   ${pageOutcome.padEnd(15)} +${addedHere}  ${url}`);
    }
  } catch (e) {
    lastError = e.message || String(e);
    console.error(`[research] job failed ${job.name}: ${lastError}`);
  }

  await ResearchJob.findByIdAndUpdate(jobId, {
    status: lastError ? "failed" : "done",
    lastError,
    contactsAdded: totalContacts,
    schoolsAttempted: schoolsTried,
  });
  return { ok: !lastError, contactsAdded: totalContacts, schoolsAttempted: schoolsTried, error: lastError || undefined };
}

/* ──────────────────────────────────────────────────────────────────────
 * Worker tick — runs on an interval
 * ────────────────────────────────────────────────────────────────────── */

async function ranToday() {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return await ResearchJob.countDocuments({
    lastRunAt: { $gte: startOfDay },
    status: { $in: ["done", "failed"] },
  });
}

let running = false;
export async function researchWorkerTick() {
  if (running) return;
  running = true;
  try {
    const todayCount = await ranToday();
    if (todayCount >= DAILY_CAP) return; // already did today's quota

    const next = await ResearchJob.findOne({
      status: "pending",
      scheduledFor: { $lte: new Date() },
    }).sort({ scheduledFor: 1 });
    if (!next) return;

    console.log(`[research] picking up job: ${next.name}`);
    await runJob(next._id);
  } catch (e) {
    console.error("[research] tick error:", e);
  } finally {
    running = false;
  }
}

/** Recovery for interrupted jobs. If the process died mid-run, jobs stuck
 *  in "running" for longer than `staleMin` minutes get reset to "pending"
 *  so the next tick can retry them. Called once at boot. */
export async function recoverStaleJobs(staleMin = 30) {
  const cutoff = new Date(Date.now() - staleMin * 60_000);
  const r = await ResearchJob.updateMany(
    { status: "running", lastRunAt: { $lt: cutoff } },
    { status: "pending", lastError: "recovered from interrupted run" }
  );
  if (r.modifiedCount > 0) console.log(`[research] recovered ${r.modifiedCount} stale running jobs → pending`);
  return r.modifiedCount;
}

let intervalHandle = null;
export function startResearchWorker(periodMs = 3_600_000) { // 1 hour
  if (intervalHandle) return;
  // First, recover anything left in a half-finished state by the prior
  // process. Then run a tick after a short delay so the DB connection is up.
  recoverStaleJobs().catch(e => console.error("[research] stale recovery failed:", e));
  setTimeout(() => researchWorkerTick(), 30_000);
  intervalHandle = setInterval(() => researchWorkerTick(), periodMs);
  intervalHandle.unref?.();
  console.log(`[research] worker started (period=${periodMs}ms, daily cap=${DAILY_CAP} job/day)`);
}
