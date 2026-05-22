# "Current Events Connection" Dynamic Task — Implementation Plan

**Status:** Design doc — review/edit before any code is written.
**Key constraint:** This task is **rendered LIVE at runtime**, not stored. The fresh news event must be from the past 1–7 days, fetched at session-launch time. Stale events would defeat the purpose.

---

## 0. Decisions locked in

These were the open questions in §17; user-confirmed answers, treated as binding:

1. **News fetch strategy:** **WebSearch** (live web search), not curated RSS. The RSS source-list approach in §5a is now Plan B fallback only.
2. **Default region:** the teacher's country (added to teacher profile if missing), **but prefer world news** over hyper-local news.
3. **Worldview profile lives on the teacher profile** (`User.profile.worldviewProfile`). Per-task override is still allowed but not the primary surface.
4. **Cache TTL:** 12 hours.
5. **Fallback rule:** **never skip the task**. If the country-specific search yields nothing safe, broaden to world news; if still nothing, fall back to evergreen pool. Skipping is no longer a tier.
6. **Christian worldview:** the **event itself does NOT need to be a Christian topic.** Worldview profile affects only the *framing, reflection questions, and tone* of the generated activity — the underlying news event can be on any safe topic (science, environment, archaeology, space, etc.).
7. **Publisher exclusion list (new requirement, ref §6c below):** these publishers are filtered out by domain regardless of how they appear in search results: **CBC, BBC, CBS, MSNBC, NPR, CNN.** The list is configurable in `backend/config/currentEventsExcludedPublishers.js` so it can be edited without a deploy.

---

## 1. One-paragraph framing

Unlike every other Curriculate task (which is generated once at taskset creation and persisted), Current Events tasks are **placeholder shells** at creation time and **fully resolved at session launch**. When a teacher starts a session that includes a current-events task, the server fetches a recent news event matching the lesson topic + worldview profile, runs an AI generation pass to produce the task JSON, and ships it to students. **The same task can produce wildly different content across sessions** — that's the whole point.

---

## 2. The architecture problem

This task type breaks the assumption every other task type makes: that `task.config` is static. We need:

1. **A persistent shell** stored on the taskset that captures "this is a current-events task, with these parameters."
2. **A runtime resolver** that hydrates the shell into a full task at session launch.
3. **A safety pipeline** that's tighter than usual because we're pulling content from the live web.
4. **Caching** so a teacher rerunning the same session within hours doesn't get a different story each time (jarring).
5. **A fallback** for when fetching fails or no usable story exists.

This is similar to how a "Daily Word of the Day" widget works — schema knows it's "today's word," but today's word is computed at view time.

---

## 3. Data shape

### 3a. The persistent shell (stored on the taskset)

```js
{
  taskId: "ce-1",
  taskType: "current-events",
  title: "Current Events: This Week's Connection",
  prompt: "Loading today's story…",     // placeholder shown until resolved
  timeMinutes: 12,
  config: {
    // Inputs that drive runtime generation:
    lessonTopic: "Plate tectonics",
    subject: "Earth Science",
    gradeLevel: 7,
    region: "Canada",                    // teacher's region, prefer regional stories
    worldviewProfile: "christian" | "secular" | "general",
    studentInstructionsStyle: "casual" | "formal" | "discussion-led",
    activityLengthMinutes: 12,

    // Topic categories to prefer (from spec safe list):
    preferredCategories: [
      "science", "technology", "environment", "education",
      "humanitarian", "archaeology", "economics", "media-literacy",
      "ethics", "innovation", "space", "health", "cultural"
    ],

    // Cache control
    cacheKey: null,                       // populated after first resolution
    cachedFor: 6 * 60 * 60 * 1000,        // 6 hours

    // Will be populated at runtime:
    resolved: null
    // resolved: {
    //   title, currentEventHeadline, eventSummary, connectionToLesson,
    //   studentTask, discussionQuestions: [...], extensionActivity,
    //   teacherNotes, estimatedMinutes,
    //   sourceUrl, sourceName, fetchedAt
    // }
  }
}
```

### 3b. Runtime resolution cache

```js
// backend/models/CurrentEventsCache.js — NEW
{
  cacheKey: String,           // hash(lessonTopic + subject + grade + region + worldview + dateBucket)
  resolved: Mixed,            // the full task JSON
  fetchedAt: Date,
  expiresAt: Date,            // fetchedAt + 6h
  sourceUrl: String,
  fallbackUsed: Boolean
}
```

`dateBucket` here is the current calendar day in the teacher's timezone — keeps a teacher running the same session twice in one day from getting two different stories.

---

## 4. The runtime resolution pipeline

```
teacher:launchNextTask → if task.taskType === "current-events":
  ┌─ 1. Compute cacheKey
  ├─ 2. Check cache; if fresh hit → use it
  ├─ 3. Fetch news (see §5)
  ├─ 4. Filter for safety (see §6)
  ├─ 5. AI-generate task JSON from the chosen story (see §7)
  ├─ 6. Validate (see §8)
  ├─ 7. Cache + ship to clients
  └─ on any failure → fall back (see §9)
```

Time budget: ≤4 seconds from teacher click to task on student devices. Beyond that, students see "Loading…" too long. If the pipeline can't finish in 4s, we serve a stale-but-recent cached story (≤48h old) or the fallback.

---

## 5. News fetching strategy

### 5a. Primary path — WebSearch

Per the locked-in decision (§0.1), the primary fetch path is **live web search**, not curated RSS. Implementation uses the same backend WebSearch infrastructure that powers other live-data features in Curriculate.

```js
// backend/services/currentEventsFetcher.js
import { runWebSearch } from "../services/webSearch.js";   // existing infra
import { EXCLUDED_PUBLISHERS } from "../config/currentEventsExcludedPublishers.js";

async function fetchRecentStories({ topic, subject, region, preferredCategories, days = 7, prefer = "world" }) {
  // Build TWO queries: a country-scoped one, and a world one. We prefer world per §0.2.
  const categoryHint = preferredCategories.slice(0, 4).join(" OR ");
  const recencyHint = `past ${days} days`;
  const baseQuery = `${topic} ${subject} ${categoryHint} news ${recencyHint}`;

  const queries = prefer === "world"
    ? [{ scope: "world", q: `${baseQuery} world` }, { scope: "country", q: `${baseQuery} ${region || ""}` }]
    : [{ scope: "country", q: `${baseQuery} ${region || ""}` }, { scope: "world", q: `${baseQuery} world` }];

  const results = [];
  for (const { scope, q } of queries) {
    if (results.filter((r) => withinDays(r.publishedAt, days)).length >= 8) break; // enough candidates
    try {
      const hits = await runWebSearch({ query: q, count: 10, freshness: `d${days}` });
      results.push(...hits.map((h) => ({ ...h, scope })));
    } catch { /* swallow per-query errors */ }
  }

  return results
    .filter((r) => !isExcludedPublisher(r.url))             // §6c publisher block
    .filter((r) => withinDays(r.publishedAt, days))
    .sort((a, b) => relevanceScore(b, { topic, subject }) - relevanceScore(a, { topic, subject }));
}
```

### 5b. Region preference — country default, world preferred

Per §0.2: search the teacher's country **secondarily**; prefer world news first. This means a Canadian teacher's grade-7 plate-tectonics lesson is more likely to surface a Japan earthquake story than a Canadian flooding story — which is the intended behavior. The country scope is the safety net.

If the teacher's country isn't on the User profile, we add a one-time prompt at session launch and persist it.

### 5c. Plan B — curated RSS fallback (deferred)

The curated RSS list from the previous design lives behind a flag (`USE_CURATED_RSS_FALLBACK=true`) for one-click rollback if WebSearch turns out to be too noisy. Out of scope for MVP build but kept in the codebase for resilience. **The RSS list, if ever enabled, must also respect the publisher exclusion list in §6c.**

---

## 6. Safety filtering

The spec's safety rules are clear: no graphic violence, no explicit content, no partisan political framing, no inflammatory culture-war content, no conspiracy theories, no extremist topics, no disturbing tragedy details.

### 6c. Publisher exclusion list (locked in §0.7)

Before any safety pass, every candidate story URL is checked against an explicit publisher exclusion list. If the URL's hostname (or any parent domain) matches an entry, the story is dropped silently and we move on.

```js
// backend/config/currentEventsExcludedPublishers.js
//
// Domains explicitly excluded from Current Events sourcing.
// This list is configurable per product-owner decision; edit and ship without a deploy via env override.
//
// Current entries (May 2026):
export const EXCLUDED_PUBLISHERS = [
  "cbc.ca",
  "bbc.com",
  "bbc.co.uk",
  "cbsnews.com",
  "cbs.com",
  "msnbc.com",
  "nbcnews.com",   // sister property to MSNBC — included for completeness
  "npr.org",
  "cnn.com",
];

// Optional env override: comma-separated additions / removals at boot.
// CURRENT_EVENTS_EXCLUDED_PUBLISHERS_ADD="example.com,foo.net"
// CURRENT_EVENTS_EXCLUDED_PUBLISHERS_REMOVE="bbc.co.uk"
```

```js
// helper
export function isExcludedPublisher(url) {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return EXCLUDED_PUBLISHERS.some((d) =>
      host === d || host.endsWith(`.${d}`)
    );
  } catch { return false; }
}
```

This check runs **before** the safety-classifier pass below, so we don't waste LLM calls scoring stories from blocked publishers.

### 6a. Two-pass filter

**Pass 1: Source-level pre-filter.** Stories from a curated source list are already ~95% safe. We further filter the *titles* with a regex banlist + a small LLM classifier:

```js
const BAN_PATTERNS = [
  /\b(killed|murder|shooting|massacre|war crime|attack)\b/i,
  /\b(abortion|trans rights|defund|woke|MAGA|antifa)\b/i,    // partisan-flagged
  /\b(conspiracy|deep state|stolen election)\b/i,
];
```

**Pass 2: LLM safety check** on the body text of the candidate story (cheap Haiku call):

```
Is this article appropriate for a {gradeLevel} classroom?
- Contains graphic violence? (yes/no)
- Politically partisan? (yes/no)
- Sexual content? (yes/no)
- Conspiracy/extremism? (yes/no)
- Centered on tragedy in a way that may disturb minors? (yes/no)
- Suitable for ages {ageRange}? (yes/no)
Return JSON with these fields + a 1-sentence rationale.
```

If any flag returns yes, drop the story and try the next-best.

### 6b. Per-grade gating

| Grade Band | Tragedy threshold | Complexity ceiling |
|---|---|---|
| 3–5 | Strict (no death/illness focus) | Simple vocabulary |
| 6–8 | Moderate | Middle vocabulary |
| 9–12 | Adult-appropriate (still no graphic detail) | Adult vocabulary |

---

## 7. AI generation prompt

Once a safe story is picked, generate the task JSON:

```
You are generating a "Current Events Connection" task for a {gradeLevel} {subject} class.

LESSON TOPIC: {lessonTopic}

CHOSEN STORY:
  Headline: {headline}
  Source:   {source}
  Date:     {pubDate}
  Summary:  {first ~500 chars of body}

WORLDVIEW PROFILE: {worldviewProfile}
  {if christian: "Naturally incorporate themes like truth, wisdom, compassion, justice, stewardship, human dignity, integrity, discernment, responsibility, humility, or community when relevant. Do NOT force Bible verses unnaturally. Do NOT preach. Maintain educational credibility."}
  {if secular:  "Frame discussion in terms of empirical reasoning, civic responsibility, and ethical reflection. Avoid religious framing."}
  {if general:  "Stay neutral; let students bring their own framing."}

OUTPUT JSON:
{
  "title": "",                       // short, hook-style
  "currentEventHeadline": "",        // a rewritten teaser (NOT the source headline verbatim)
  "eventSummary": "",                // 2-4 sentences, age-appropriate
  "connectionToLesson": "",          // explicit link to the lesson topic
  "studentTask": "",                 // concrete, actionable, 1-2 sentences
  "discussionQuestions": [],         // 3-5 questions that PROVOKE thinking, not recall
  "extensionActivity": "",           // optional deeper dive for fast finishers
  "teacherNotes": "",                // 1-3 sentences of context the teacher should know
  "estimatedMinutes": 0
}

RULES:
- Vocabulary must match Grade {gradeLevel}.
- Avoid sounding like a textbook.
- Discussion questions must require synthesis, not recall.
- Be hopeful and intellectually honest about hard topics.
- Cite the source by name in `teacherNotes` so the teacher can verify.
```

### 7a. Worldview switches

The prompt is templated per `worldviewProfile`. The "christian" variant is the spec's marquee case; we ship with it explicitly supported. We can add "jewish", "muslim", "secular", "general" later — same prompt skeleton, swap the values clause.

---

## 8. Validation

`validateResolvedCurrentEvents(resolved, source, gradeLevel)`:
- All 9 fields present and non-empty.
- `eventSummary.length` between 100 and 800 chars.
- `discussionQuestions.length` between 3 and 5.
- No banned phrases in any field (per §6a banlist).
- Grade-level lexile check (heuristic word count + syllable check).
- `teacherNotes` mentions the source.

Failure → one repair attempt → fallback story.

---

## 9. Fallback strategy

Per §0.5 the task is **never skipped**. The pipeline must always produce content. The tiers are:

1. **Country-scoped recent search hit** (within `days` window, after publisher exclusion + safety pass).
2. **World-scoped recent search hit** (broaden scope — same window, same filters). Per §0.2 this is also the *preferred* path when both succeed.
3. **Stale-but-recent cached story** (≤48h, same topic key).
4. **Pre-baked evergreen story.** A small library of timeless connections stored in `backend/data/currentEventsEvergreen.json`. Maintained manually; tied to common subjects.
5. **Last-resort generic evergreen.** A handful of grade-band-appropriate civic/science evergreen tasks that don't even need a lesson-topic match, used only if everything above fails.

The pipeline cascades through these in order; the FIRST tier to produce a valid resolved task wins. There is no "skip" outcome.

The teacher LiveSession panel shows a small indicator describing which tier resolved the task ("World news", "Evergreen", etc.), so they know what they're looking at.

---

## 10. Backend touchpoints

| File | Change |
|---|---|
| `shared/taskTypes.js` | `CURRENT_EVENTS = "current-events"` + `TASK_TYPE_META["current-events"]` |
| `backend/controllers/sharedTasksetController.js` | Shell that stores ONLY the inputs (no resolved content) |
| `backend/config/currentEventsSources.js` | **NEW** — curated RSS source list |
| `backend/data/currentEventsEvergreen.json` | **NEW** — fallback library |
| `backend/services/currentEventsFetcher.js` | **NEW** — RSS fetch + rank |
| `backend/services/currentEventsSafetyFilter.js` | **NEW** — two-pass filter |
| `backend/services/currentEventsResolver.js` | **NEW** — pipeline orchestration |
| `backend/models/CurrentEventsCache.js` | **NEW** — cache collection |
| `backend/index.js` | In `teacher:launchNextTask`, detect `current-events` and resolve before broadcasting. Add `currentEvents:teacherForceRefresh` for manual refresh. |

## 11. Frontend touchpoints

| File | Change |
|---|---|
| `student-app/src/components/tasks/types/CurrentEventsTask.jsx` | **NEW** — renders the resolved task |
| `student-app/src/components/tasks/TaskRunner.jsx` | `case "current-events"` |
| `student-app/src/components/tasks/types/CurrentEventsLoading.jsx` | **NEW** — friendly loading state while pipeline runs |
| `student-app/src/DemoMode.jsx` | Demo uses an evergreen story to avoid live fetching during practice |
| `teacher-app/src/pages/LiveSession.jsx` | "Refresh current event" button + source indicator when fallback used |
| `teacher-app/src/pages/AiTasksetGenerator.jsx` | Worldview profile picker + region/topic fields (or reuse existing teacher profile) |

---

## 12. Worldview profile — locked in: per-teacher profile (§0.3)

The worldview profile lives on the teacher's profile as `User.profile.worldviewProfile`. Per-task override stays available but isn't a primary surface.

Important clarification from §0.6: **the worldview profile does NOT constrain the event itself.** A teacher with `worldviewProfile === "christian"` can absolutely get a Current Events task about plate tectonics or a new space telescope — the event itself can come from any safe topic. The worldview profile only shapes the *generated discussion questions, framing, and tone*. For Christian framing this means weaving in themes like stewardship, wisdom, discernment, etc., where naturally relevant — without forcing scripture into stories where it doesn't fit.

Initial profiles to ship:
- `general` (default)
- `secular`
- `christian` (spec marquee)

Future: `jewish`, `muslim`, `multifaith`, etc. — add behind a feature flag once we hear the demand.

---

## 13. The "is this a real or fake news source" problem

Curated sources mitigate this, but some RSS feeds republish sponsored content as news. Two safeguards:

1. **Source banlist** in `currentEventsSources.js` excludes known content farms.
2. **`teacherNotes` always includes the source name** — the teacher can spot-check.

If we ever expand to broader news APIs, we'd need a credibility-scoring layer (NewsGuard-like). Not in MVP.

---

## 14. MVP build order

1. **Task type plumbing + persistent shell** — store inputs only, no resolved data. *Verifiable: shell saves and loads with placeholder prompt.*
2. **RSS fetcher** — pull from 5–6 sources, parse, filter by date. *Verifiable: command-line invocation returns recent stories.*
3. **Safety filter** — banlist regex + Haiku safety classifier. *Verifiable: a curated set of dummy stories — safe + unsafe — get correctly classified.*
4. **Resolver pipeline** — fetch → filter → rank → generate → validate → cache. *Verifiable: end-to-end CLI run produces valid task JSON.*
5. **Wire into `teacher:launchNextTask`.** *Verifiable: launching a current-events task in a session produces a resolved task on student devices within 4s.*
6. **Student renderer** — `CurrentEventsTask.jsx` + `CurrentEventsLoading.jsx`. *Verifiable: end-to-end student experience.*
7. **Christian worldview prompt** — make the worldview-switch real. *Verifiable: same story, two profiles → meaningfully different `discussionQuestions`.*
8. **Fallback library** — 20–30 evergreen stories across common subjects. *Verifiable: simulated fetch failure produces an evergreen task.*
9. **Teacher refresh + source indicator.** *Verifiable: teacher can manually re-resolve.*
10. **Demo mode** — uses a baked evergreen task. *Verifiable: testers can practice.*

Stop here for v1. v2: news-API integration as a second source, NewsGuard-style credibility scoring, additional worldview profiles, regional source weighting per teacher's country.

---

## 15. Cost considerations

Per resolution: ~1 WebSearch call + ~1 LLM safety classifier call + ~1 LLM generation call ≈ low single-digit cents per resolution worst-case. With the **12-hour cache** (locked in §0.4), a school running this 5×/week per teacher is comfortably under a dollar per teacher per year. Negligible.

WebSearch latency is the main budget — keep total time-to-task under the 4-second budget in §4 by:
- Issuing both queries (world + country) in parallel.
- Aborting search early once 8 in-window candidates are available.
- Reusing the cached resolved task across teacher refreshes within 12 hours.

---

## 16. How this stacks with the other systems

- **Quest Mode / Escape Room / Whodunnit:** current-events tasks award coins/keys like any other task. No special handling.
- **Worldview profile is a separate Curriculate-wide concept** that affects only this task type for now, but could later affect Bible/ministry references in Careers, Whodunnit narrative framing, etc. Worth keeping the field generic.

---

## 17. Open questions for you to weigh in on

1. **News source strategy.** I'm proposing curated RSS (Option A in §5a) for MVP. Want to use a paid news API instead, or web search?
2. **Default region.** Default `region` to teacher's country (which we don't currently capture per teacher). Should we add a country field to the teacher profile, or default to "Canada" since most users are Canadian?
3. **Worldview profile location.** Per §12 — per-teacher default with per-task override (my recommendation), or per-task only?
4. **Cache TTL.** I picked 6 hours. Want longer (a full school day) or shorter (every fetch = fresh)?
5. **Fallback tolerance.** I have 3 fallback tiers. Should "no story available" ever skip the task, or should it always serve an evergreen? Skipping is honest; serving evergreen keeps the lesson plan intact.
6. **Christian worldview wording.** I have specific values in the prompt skeleton (truth, wisdom, compassion, justice, stewardship, human dignity, integrity, discernment, responsibility, humility, community). Want to edit this list before I bake it in?

Once these are settled, I'll start commit #1 of §14.
