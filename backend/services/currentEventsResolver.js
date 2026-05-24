// backend/services/currentEventsResolver.js
//
// Runtime resolver for the "current-events" task type.
// See CURRENT_EVENTS_PLAN.md §0 for the locked-in decisions; the highlights:
//   - Source strategy: Anthropic's web_search tool (live search, no curated RSS)
//   - Region: teacher's country, but PREFER world stories
//   - Worldview profile: shapes framing only, NEVER the underlying event topic
//   - Cache: 12 hours per resolution key
//   - Fallback cascade: country → world → 48h stale cache → evergreen library — never skip
//   - Publisher exclusion: CBC, BBC, CBS, MSNBC, NPR, CNN (configurable via env)
//
// Returns:
//   {
//     ok: true,
//     resolved: { title, currentEventHeadline, eventSummary, connectionToLesson,
//                 studentTask, discussionQuestions: [...], extensionActivity,
//                 teacherNotes, estimatedMinutes,
//                 sourceUrl, sourceName, fetchedAt, fallbackTier }
//   }
//   OR { ok: false, error }
import crypto from "node:crypto";
import { EXCLUDED_PUBLISHERS, isExcludedPublisher } from "../config/currentEventsExcludedPublishers.js";

// ── In-memory cache. Key = sha(topic+subject+grade+region+worldview+dateBucket) ──
const _cache = new Map();              // key -> { resolved, expiresAt }
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function _cacheKey({ lessonTopic, subject, gradeLevel, region, worldviewProfile, dateBucket }) {
  const s = JSON.stringify({ lessonTopic, subject, gradeLevel, region, worldviewProfile, dateBucket });
  return crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function _todayBucket() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

const CHRISTIAN_VALUES = [
  "truth", "wisdom", "compassion", "justice", "stewardship", "human dignity",
  "integrity", "discernment", "responsibility", "humility", "community",
];

const SAFE_CATEGORIES_DEFAULT = [
  "science", "environment", "education", "archaeology", "space", "health",
  "cultural developments", "humanitarian efforts", "innovation",
];

function _buildPrompt({ lessonTopic, subject, gradeLevel, region = "Canada", worldviewProfile = "general", preferredCategories, prefer = "world" }) {
  const cats = (Array.isArray(preferredCategories) && preferredCategories.length > 0 ? preferredCategories : SAFE_CATEGORIES_DEFAULT).join(", ");

  let worldviewBlock = "";
  if (worldviewProfile === "christian") {
    worldviewBlock = `
WORLDVIEW: christian
- The EVENT itself need not be a Christian topic.
- The framing and reflection questions may naturally weave in themes such as: ${CHRISTIAN_VALUES.join(", ")}, where genuinely relevant.
- Do NOT force scripture or preach. Maintain educational credibility.
- Reflection questions should invite thoughtful moral reflection, not push a doctrinal point.`;
  } else if (worldviewProfile === "secular") {
    worldviewBlock = `
WORLDVIEW: secular
- Frame discussion in terms of empirical reasoning, civic responsibility, and ethical reflection.
- Avoid religious framing or terminology.`;
  } else {
    worldviewBlock = `
WORLDVIEW: general
- Stay neutral; let students bring their own moral framing.`;
  }

  return `You are generating a "Current Events Connection" classroom task. USE THE web_search TOOL.

LESSON TOPIC: ${lessonTopic || "(general)"}
SUBJECT: ${subject || "General"}
GRADE: ${gradeLevel || 7}
REGION: ${region}
${worldviewBlock}

SEARCH STRATEGY:
- USE THE web_search TOOL FIRST AND ALWAYS. Do NOT invent a story. The output must describe a real, verifiable news article you found in search results.
- Prefer WORLD news (international scope) over hyper-local stories.
- The teacher's country is ${region}, but country-scoped stories are the secondary path.
- Search for news from the PAST 7 DAYS related to the lesson topic.
- Prefer story categories: ${cats}.
- If web_search returns nothing usable, return an error response shape: { "noStory": true, "reason": "<short reason>" } — do NOT fabricate a story.

CONTENT BAR (HARD):
- eventSummary MUST describe what actually happened in the real article — names, places, and dates from the source.
- It must NOT read like AI prose; it must read like a summary of a wire story. Imagine a sub-editor with deadline pressure.
- sourceUrl MUST be the real article URL you fetched. sourceName MUST be the publisher you saw in search results.

PUBLISHER RULES (HARD):
The following publishers are EXCLUDED. Do NOT use any story whose URL hostname matches any of these domains:
${EXCLUDED_PUBLISHERS.map((d) => `  - ${d}`).join("\n")}

SAFETY RULES (HARD):
Drop the story and pick a different one if any of these apply:
- Graphic violence, war atrocities, mass casualties focused on gore
- Sexual content or romantic gossip
- Highly partisan US/UK political framing (left vs right culture war)
- Conspiracy theories / fringe sources
- Extremist or radicalization-adjacent content
- Tragedy details inappropriate for grade ${gradeLevel || 7}

OUTPUT: return EXACTLY this JSON shape (no markdown, no commentary):
{
  "title": "<short, hook-style task title>",
  "currentEventHeadline": "<your rewritten teaser — NOT the source headline verbatim>",
  "eventSummary": "<2-4 sentences, grade-${gradeLevel || 7} appropriate>",
  "connectionToLesson": "<explicit link to '${lessonTopic}'>",
  "studentTask": "<one concrete, actionable thing students do>",
  "discussionQuestions": ["<3-5 questions that PROVOKE thinking, not recall>"],
  "extensionActivity": "<optional deeper dive>",
  "teacherNotes": "<1-3 sentences of context + cite the source by name>",
  "estimatedMinutes": <integer>,
  "sourceUrl": "<full URL of the chosen story>",
  "sourceName": "<publisher name>"
}`;
}

// The web_search tool sometimes wraps text in citation markup like
// <cite index="21-3">…</cite> — strip the tags (keep the inner text) so the
// student app doesn't render raw markup (tester: "formatting issues").
function _stripCitations(s) {
  return String(s == null ? "" : s)
    .replace(/<\/?cite\b[^>]*>/gi, "")
    .replace(/\[\s*\d+(?:[-,]\d+)*\s*\]/g, "") // bare [21-3] style refs
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function _normalizeResolved(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const r = { ...parsed };
  for (const field of ["title", "currentEventHeadline", "eventSummary", "connectionToLesson", "studentTask", "extensionActivity", "teacherNotes", "sourceUrl", "sourceName"]) {
    if (r[field] != null && typeof r[field] !== "string") r[field] = String(r[field]);
    if (typeof r[field] === "string") r[field] = _stripCitations(r[field]);
  }
  if (!Array.isArray(r.discussionQuestions)) r.discussionQuestions = [];
  r.discussionQuestions = r.discussionQuestions.filter((q) => typeof q === "string" && q.trim()).map(_stripCitations).slice(0, 5);
  if (!Number.isFinite(Number(r.estimatedMinutes))) r.estimatedMinutes = 12;
  r.fetchedAt = new Date().toISOString();
  return r;
}

function _validate(resolved) {
  if (!resolved) return { ok: false, reason: "empty" };
  const required = ["eventSummary", "connectionToLesson", "studentTask", "teacherNotes"];
  for (const f of required) {
    if (typeof resolved[f] !== "string" || resolved[f].trim().length < 5) return { ok: false, reason: `missing/short: ${f}` };
  }
  if (!Array.isArray(resolved.discussionQuestions) || resolved.discussionQuestions.length < 3) {
    return { ok: false, reason: "needs 3+ discussion questions" };
  }
  if (resolved.sourceUrl && isExcludedPublisher(resolved.sourceUrl)) {
    return { ok: false, reason: `excluded publisher: ${resolved.sourceUrl}` };
  }
  // Grade-appropriateness heuristic: super-long summaries are usually a sign the model wrote textbook-style.
  if (resolved.eventSummary.length > 1200) return { ok: false, reason: "summary too long" };
  return { ok: true };
}

async function _callClaudeWithWebSearch(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.CURRENT_EVENTS_MODEL || "claude-sonnet-4-5",
      max_tokens: 1800,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) {
    const err = await r.text().catch(() => "");
    throw new Error(`Anthropic ${r.status}: ${err.slice(0, 200)}`);
  }
  const j = await r.json();
  const text = (j?.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  // Extract the JSON block (may be wrapped in prose despite our instructions)
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in response");
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch (e) {
    // Sometimes the model wraps in code fences and leaves trailing prose — try harder
    const cleaned = m[0].replace(/^[^{]*/, "").replace(/[^}]*$/, "");
    parsed = JSON.parse(cleaned);
  }
  return parsed;
}

// ── Evergreen library — picked when live fetch + cache all fail. ──
// Loaded lazily once, then reused across resolutions.
let _evergreenLibrary = null;
async function _loadEvergreen() {
  if (_evergreenLibrary) return _evergreenLibrary;
  try {
    const fs = await import("node:fs/promises");
    const url = await import("node:url");
    const dirname = url.fileURLToPath(new URL(".", import.meta.url));
    const raw = await fs.readFile(`${dirname}/../data/currentEventsEvergreen.json`, "utf8");
    _evergreenLibrary = JSON.parse(raw);
    return _evergreenLibrary;
  } catch (e) {
    console.warn("[currentEvents] evergreen library load failed:", e?.message);
    _evergreenLibrary = [];
    return _evergreenLibrary;
  }
}

function _gradeBandFor(gradeLevel) {
  const g = Number(gradeLevel) || 7;
  if (g <= 5) return "3-5";
  if (g <= 8) return "6-8";
  return "9-12";
}

function _pickEvergreen(library, { subject, gradeLevel }) {
  if (!Array.isArray(library) || library.length === 0) return null;
  const subjectLc = String(subject || "general").toLowerCase();
  const band = _gradeBandFor(gradeLevel);

  // Priority: subject + grade match → subject match → general → first
  const subjectAndGrade = library.find((e) => e.gradeBand === band && (e.subjects || []).some((s) => subjectLc.includes(s) || s.includes(subjectLc)));
  if (subjectAndGrade) return { ...subjectAndGrade, fallbackTier: "evergreen-subject-grade" };

  const subjectOnly = library.find((e) => (e.subjects || []).some((s) => subjectLc.includes(s) || s.includes(subjectLc)));
  if (subjectOnly) return { ...subjectOnly, fallbackTier: "evergreen-subject" };

  const general = library.find((e) => (e.subjects || []).includes("general"));
  if (general) return { ...general, fallbackTier: "evergreen-general" };

  return { ...library[0], fallbackTier: "evergreen-first" };
}

// Last-resort skeleton if even the library can't be loaded.
const EVERGREEN_SKELETON = {
  title: "Curiosity Beyond the Classroom",
  currentEventHeadline: "Scientists keep finding surprises in places we thought we knew.",
  eventSummary: "Curiosity + careful observation + willingness to revisit assumptions — that's how most discoveries happen.",
  connectionToLesson: "Today's lesson is one more chance to ask: what's the assumption I haven't questioned yet?",
  studentTask: "In pairs, name one 'common knowledge' fact from this lesson. List ONE reason it might still be incomplete.",
  discussionQuestions: [
    "What's the difference between 'something we don't know' and 'something we got wrong'?",
    "Whose curiosity counted in this lesson — and whose was ignored?",
    "If today's lesson turned out to be partly mistaken, how would we find out?",
  ],
  extensionActivity: "Write a 3-sentence note to a scientist or thinker who would have loved this lesson.",
  teacherNotes: "Curriculate evergreen library — skeleton fallback.",
  estimatedMinutes: 12,
  sourceUrl: "",
  sourceName: "Curriculate evergreen library",
  fallbackTier: "evergreen-skeleton",
};

async function _readPersistentCache(key) {
  try {
    const CurrentEventsCache = (await import("../models/CurrentEventsCache.js")).default;
    const doc = await CurrentEventsCache.findOne({ cacheKey: key });
    if (!doc) return null;
    if (doc.expiresAt && new Date(doc.expiresAt).getTime() > Date.now()) {
      return { resolved: doc.resolved, expiresAt: new Date(doc.expiresAt).getTime() };
    }
    return null;
  } catch {
    return null;
  }
}

async function _writePersistentCache(key, resolved) {
  try {
    const CurrentEventsCache = (await import("../models/CurrentEventsCache.js")).default;
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await CurrentEventsCache.findOneAndUpdate(
      { cacheKey: key },
      { cacheKey: key, resolved, fetchedAt: new Date(), expiresAt, sourceUrl: resolved?.sourceUrl || "", fallbackTier: resolved?.fallbackTier || "" },
      { upsert: true },
    );
  } catch (e) {
    // Persistence failure is non-fatal — the in-memory cache still works
    console.warn("[currentEvents] persist cache failed:", e?.message);
  }
}

/**
 * Public entry point: resolve a current-events task at session-launch time.
 *
 * @param {Object} input
 * @param {string} input.lessonTopic
 * @param {string} input.subject
 * @param {number} input.gradeLevel
 * @param {string} input.region            teacher's country (default "Canada" per PLAN §0.2)
 * @param {"general"|"secular"|"christian"} input.worldviewProfile
 * @param {string[]} [input.preferredCategories]
 * @param {boolean} [input.forceRefresh]    bypass cache and re-resolve fresh
 * @returns {Promise<{ ok:true, resolved:Object } | { ok:false, error:string }>}
 */
export async function resolveCurrentEvents(input) {
  const region = input?.region || "Canada";
  const worldviewProfile = input?.worldviewProfile || "general";
  const dateBucket = _todayBucket();
  const key = _cacheKey({ ...input, region, worldviewProfile, dateBucket });

  // Force refresh path — used by teacher "refresh" button
  if (!input?.forceRefresh) {
    // 1. In-memory cache
    const hit = _cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { ok: true, resolved: { ...hit.resolved, fromCache: "memory" } };
    }
    // 2. Persistent Mongo cache (survives restarts)
    const persistent = await _readPersistentCache(key);
    if (persistent) {
      _cache.set(key, persistent);  // warm in-memory
      return { ok: true, resolved: { ...persistent.resolved, fromCache: "mongo" } };
    }
  }

  // Try: world-preferred fetch
  for (const prefer of ["world", "country"]) {
    try {
      const prompt = _buildPrompt({ ...input, region, worldviewProfile, prefer });
      const parsed = await _callClaudeWithWebSearch(prompt);
      const resolved = _normalizeResolved(parsed);
      const validation = _validate(resolved);
      if (validation.ok) {
        resolved.fallbackTier = prefer === "world" ? "world-news" : "country-news";
        _cache.set(key, { resolved, expiresAt: Date.now() + CACHE_TTL_MS });
        // Fire-and-forget persistent cache write
        _writePersistentCache(key, resolved);
        return { ok: true, resolved };
      } else {
        console.warn(`[currentEvents] ${prefer} pass invalid: ${validation.reason}`);
      }
    } catch (e) {
      console.warn(`[currentEvents] ${prefer} fetch error: ${e?.message}`);
    }
  }

  // Stale cache (≤48h)
  const stale = _cache.get(key);
  if (stale && stale.resolved) {
    return { ok: true, resolved: { ...stale.resolved, fallbackTier: "stale-cache" } };
  }

  // Evergreen final fallback — never skip. Library is indexed by subject + grade band.
  try {
    const library = await _loadEvergreen();
    const picked = _pickEvergreen(library, { subject: input?.subject, gradeLevel: input?.gradeLevel });
    if (picked) {
      return {
        ok: true,
        resolved: {
          ...picked,
          lessonTopic: input?.lessonTopic,
          fetchedAt: new Date().toISOString(),
        },
      };
    }
  } catch (e) {
    console.warn("[currentEvents] evergreen pick failed:", e?.message);
  }
  return { ok: true, resolved: { ...EVERGREEN_SKELETON, lessonTopic: input?.lessonTopic, fetchedAt: new Date().toISOString() } };
}

export default { resolveCurrentEvents, EXCLUDED_PUBLISHERS };
