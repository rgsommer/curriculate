# "What Am I?" Task Type — Implementation Plan

**Status:** Design doc — review/edit before code is written.
**Goal:** A deduction-game task type where students see progressively narrower clues and decide when to commit to an answer. The earlier they commit (with fewer clues revealed), the more points they earn. Works solo, intra-team, and inter-team.

---

## 1. The hook in one paragraph

Students see a card that says **"What am I?"** and a single vague clue. They can either **submit an answer** or **request another clue**. Each additional clue narrows the possibilities — and lowers the point ceiling. The strategic tension between "guess now for max points" and "stay safe with one more clue" is the entire game. Clues must reinforce *understanding*, not look like dictionary entries.

---

## 2. Where it slots into the existing system

- **Task type ID:** `"what-am-i"` in `shared/taskTypes.js`.
- **Shell + AI generator branch:** in `backend/controllers/sharedTasksetController.js` (`TASK_SHELLS`) and the validation branch in `validateAiTask`.
- **Sanitizer:** add to `backend/controllers/sanitizeTaskShape.js` (promote `answer`, `clues[]`, `difficulty`, `mode`, `scoring`).
- **Schema:** existing `config: Mixed` + `items: [Mixed]` on `TaskSchema` already supports this — no schema changes needed.
- **Renderer:** `student-app/src/components/tasks/types/WhatAmITask.jsx` (new); add `case "what-am-i"` to `TaskRunner.jsx`.
- **Live mode coordination:** uses the existing `submitAnswer` / `roomState` socket flow; only one new socket event for "reveal next clue" (server-authoritative point ceiling).
- **Quest Mode hook (v2):** "What Am I?" makes an excellent **resource acquisition challenge** inside a quest — see §11.

---

## 3. Task data shape

Stored as a normal Task in `TaskSet.tasks[]`:

```js
{
  taskId: "wai-1",
  taskType: "what-am-i",
  title: "What Am I? — Confederation",
  prompt: "Identify the historical figure or event.",
  timeMinutes: 5,
  points: 10,                    // top of the decay curve
  config: {
    answer: "Lord Durham's Report",
    acceptableAnswers: [          // for fuzzy matching
      "durham report",
      "lord durham report",
      "the durham report"
    ],
    clues: [
      { level: 1, text: "My recommendations helped shape responsible government in Canada." },
      { level: 2, text: "I was written after rebellions in two colonies." },
      { level: 3, text: "I am attributed to a British nobleman sent on a fact-finding mission in 1838." },
      { level: 4, text: "My author's name shares its origin with a city in northern England." }
    ],
    difficulty: "medium",       // easy | medium | hard | expert
    mode: "solo",               // solo | intra-team | inter-team | duel | survival | escape
    scoring: {
      perClueCurve: [10, 8, 6, 4, 2],   // index 0 = 0 clues revealed, etc.
      streakMultiplier: 1.1,
      speedBonusMax: 3,
      noClueBonus: 2
    },
    penalties: {
      wrongAnswer: "lockout",   // lockout | reveal-clue | point-deduction | steal-allowed
      lockoutMs: 8000,
      pointDeduction: 0
    },
    timers: {
      perClueMs: 0,             // 0 = student-paced
      hardTimeoutMs: 90000      // round force-ends
    },
    allowSteal: false,
    bonusRules: {},
    media: {                    // optional rich clues
      images: [],               // [{ level, url, blur: 0-100 }]
      audio: []
    }
  }
}
```

**Conventions:**
- `clues.length` is the maximum reveal depth; `perClueCurve` should be `clues.length + 1` long (so index 0 = "no clues revealed yet, just the title prompt", index N = "all N clues revealed").
- `acceptableAnswers` is lower-cased substrings; the matcher also normalizes whitespace + punctuation + does Levenshtein ≤ 2 on the first match attempt.
- `mode` is *intent metadata*; it's also overridable per-session by the teacher (LiveSession panel).

---

## 4. Modes — what's in MVP vs deferred

| Mode | In MVP? | Notes |
|---|---|---|
| **Solo** | ✅ | One device, one student. Per-task points decay curve. The simplest path. |
| **Intra-team** | ✅ | Whole team huddles over the device. Single submission counts. Same scoring as solo. |
| **Inter-team** | ✅ | All teams see the same clues simultaneously; first correct submission locks the answer. Other teams can still submit for reduced points until clue N+1 reveals. |
| **Duel** | ⏸ v2 | One player per team, 3-2-1 countdown, fastest-correct wins. Needs a new "duel lobby" UI. |
| **Survival** | ⏸ v2 | Wrong answers eliminate. Needs a per-task elimination tracker. |
| **Escape Room** | ⏸ v3 | Correct answer reveals a password / unlocks the next station. Tightly coupled to the (not-yet-built) escape sequence runtime. |

MVP defaults to **inter-team** when run inside a multi-team room, **solo** in practice/demo mode. The teacher can flip a per-task `forceMode` from the LiveSession panel.

---

## 5. Clue reveal — server-authoritative

The point ceiling **must** be set by the server, not the client, because:
- Inter-team mode requires the same "current clue level" for everyone.
- A student can otherwise inspect React state and inflate their score.

**Sockets (per task):**
```
client → server:  whatAmI:revealClue   { roomCode, teamId, taskId }
server → client:  whatAmI:clueRevealed { taskId, newLevel, pointCeiling }
client → server:  whatAmI:submit        { roomCode, teamId, taskId, answer }
server → client:  whatAmI:result        { correct, pointsAwarded, correctAnswer, lockoutUntil }
```

Server keeps an in-memory per-task state:

```js
room.whatAmIState[taskId] = {
  cluesRevealedByTeam: { [teamId]: 0 },   // inter-team: max across teams optionally shared
  globalClueLevel: 0,                     // inter-team only; max revealed by any team
  firstCorrectTeamId: null,
  attempts: { [teamId]: 0 }
};
```

**Steal logic (when `allowSteal: true`, default off in MVP):** if a team submits wrong, other teams have a 5-second window to submit at 50% of their current ceiling, before the room moves on.

---

## 6. Answer matching

In `backend/services/whatAmIMatcher.js` (new):

```js
function isAcceptable(submission, config) {
  const norm = s => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  const sub = norm(submission);
  const candidates = [config.answer, ...(config.acceptableAnswers || [])].map(norm);

  // Exact match
  if (candidates.includes(sub)) return { ok: true, strategy: "exact" };

  // Substring (catches "durham report" matching "lord durham's report")
  if (candidates.some(c => sub.includes(c) || c.includes(sub))) {
    return { ok: true, strategy: "substring" };
  }

  // Fuzzy on the shortest candidate
  const shortest = candidates.reduce((a, b) => (a.length < b.length ? a : b));
  if (levenshtein(sub, shortest) <= 2) return { ok: true, strategy: "fuzzy" };

  return { ok: false };
}
```

For long phrase answers (>20 chars), we apply substring to keyword tokens; for short ones we lean fuzzy. Existing scoring infra (`gradingFlavors`) is not invoked — this is keyword/fuzzy, not LLM.

---

## 7. Point computation

```js
function computePoints({ cluesRevealed, totalClues, scoring, isStealer, isFirst, hadStreak }) {
  const curve = scoring?.perClueCurve || defaultCurve(totalClues);
  let pts = curve[Math.min(cluesRevealed, curve.length - 1)] ?? 1;
  if (cluesRevealed === 0 && scoring?.noClueBonus) pts += scoring.noClueBonus;
  if (isStealer) pts = Math.floor(pts * 0.5);
  if (isFirst && scoring?.firstBonus) pts += scoring.firstBonus;
  if (hadStreak && scoring?.streakMultiplier) pts = Math.floor(pts * scoring.streakMultiplier);
  return Math.max(1, pts);
}

function defaultCurve(totalClues) {
  // 10, 8, 6, 4, 2, 1 …
  const base = [10, 8, 6, 4, 2];
  while (base.length < totalClues + 1) base.push(Math.max(1, base[base.length - 1] - 1));
  return base;
}
```

The curve is overridable per-task via `config.scoring.perClueCurve`.

---

## 8. Renderer — `WhatAmITask.jsx`

`student-app/src/components/tasks/types/WhatAmITask.jsx`. State shape:

```js
const [revealedClues, setRevealedClues] = useState(0);   // mirrors server
const [pointCeiling, setPointCeiling]   = useState(curve[0]);
const [answer, setAnswer]               = useState("");
const [lockoutUntil, setLockoutUntil]   = useState(0);
const [feedback, setFeedback]           = useState(null);
```

Layout (top → bottom):

1. **Big title**: "What am I?" + the prompt subtitle.
2. **Clue stack**: revealed clues as cards; new ones slide in. The next-up card is dimmed with a "Reveal next clue" button overlay.
3. **Points panel**: current ceiling, with a soft animation when it ticks down.
4. **Answer input + Submit button**. Disabled during lockout (countdown shown).
5. **Inter-team mode add-on**: small live feed — "Team Red is on clue 2", "Team Blue submitted" (no answer leaked).

Image/audio clues (v1.5): render inside the clue card. Blur level → CSS `filter: blur(Npx)` based on `clue.blur`.

---

## 9. AI generation prompt

In `mainTasksetController.js` (or a dedicated prompt file later), add a generator branch:

```
You are generating a "What Am I?" deduction task for grade {grade}, subject {subject}.
Pick a concept from this list: {topics}.
Output JSON with:
- answer: the concept name
- acceptableAnswers: 2-4 common variant phrasings
- clues: 4 clues, level 1..4, progressing from broad → precise
- difficulty: {difficulty}

CRITICAL RULES:
- Clue 1 must NOT mention the answer's name or any obvious near-synonym.
- Clue 1 must focus on PURPOSE, EFFECT, or CONCEPTUAL IDENTITY ("My recommendations shaped…").
- Clues must NOT read like dictionary definitions.
- Clue 4 may name a closely associated thing (e.g. the author's family) but not the answer itself.
- For history: prefer impact and consequences over dates and names.
- For science: prefer mechanism and function over taxonomy.
- For Bible: prefer actions and relationships over geneaology.
```

A validation pass (`validateAiTask`) rejects:
- Any clue that contains a substring of `answer` (case-insensitive, after normalizing punctuation).
- `clues.length < 3` or `clues.length > 6`.
- Missing `acceptableAnswers`.

Failures trigger a single AI repair attempt, falling back to a deterministic safe shell from `TASK_SHELLS`.

---

## 10. Teacher controls (LiveSession panel)

In `teacher-app/src/pages/LiveSession.jsx`, when the current task is `what-am-i`:

- **Force reveal next clue** (for everyone) — emits `whatAmI:teacherReveal`.
- **Freeze answer submissions** — toggles a `frozen: true` flag.
- **Skip to next task**.
- **Award bonus points to a team** — leverages the existing `addBonusSubmission` helper.

Out of MVP scope (deferred to v2): trigger duel mode mid-task, override mode, live per-team accuracy chart.

---

## 11. Quest Mode synergy (cross-reference)

When `QUEST_MODE_PLAN.md` ships, "What Am I?" becomes a natural **non-coin acquisition challenge** for a resource. A resource definition could say:

```js
{
  id: "navigationChart",
  acquisitionOptions: [
    { type: "coins", amount: 25 },
    { type: "what-am-i", taskRef: "wai-historical-explorer" }
  ]
}
```

When the team taps "Acquire with What-Am-I challenge", the WhatAmI runner mounts as a modal; a correct answer triggers a `quest:acquireResource` server call.

No work in this plan needs to happen for that to be possible — the WhatAmI task type just needs to be standalone-runnable, which is already the design here. ✅

---

## 12. MVP build order

1. **Type plumbing** — `taskTypes.js`, `TASK_SHELLS`, sanitize + validate branch. Round-trip a hand-crafted task. *Verifiable: task saves and loads.*
2. **Renderer (solo mode only)** — `WhatAmITask.jsx`, mounted from `TaskRunner.jsx`. Reveal-clue tracked client-side first. *Verifiable: practice/demo plays end-to-end.*
3. **Matcher + scoring** — `whatAmIMatcher.js`, point computation, lockout-on-wrong. *Verifiable: practice tests across exact/fuzzy/substring.*
4. **Server-authoritative reveal + sockets** — move ceiling to server; add `whatAmI:revealClue` + `whatAmI:submit`. *Verifiable: inter-team test with two devices.*
5. **AI generator branch** — prompt + validate + repair. *Verifiable: generated taskset produces ≥3 quality WhatAmI tasks across grades.*
6. **Teacher controls** — force-reveal + freeze + skip in LiveSession. *Verifiable: teacher can rescue a stuck class.*
7. **Demo mode entry** — add to `student-app/src/DemoMode.jsx` so testers can practice without joining a real room.

Stop here for v1.

Deferred to v2: duel mode, survival mode, image/audio clues, steal system, escape-room hook, contribution rating per team member.

---

## 13. File touchpoints summary

| File | Change |
|---|---|
| `shared/taskTypes.js` | Add `WHAT_AM_I = "what-am-i"` + `TASK_TYPE_META["what-am-i"]` |
| `backend/controllers/sharedTasksetController.js` | Add `what-am-i` to `TASK_SHELLS` + `validateAiTask` branch |
| `backend/controllers/sanitizeTaskShape.js` | Promote `answer`, `clues`, `difficulty`, `mode`, `scoring` into `config` |
| `backend/controllers/mainTasksetController.js` | AI prompt branch for what-am-i (only when type appears in plan) |
| `backend/services/whatAmIMatcher.js` | **NEW** — answer matching |
| `backend/index.js` | Register `whatAmI:revealClue`, `whatAmI:submit`, `whatAmI:teacherReveal` |
| `student-app/src/components/tasks/types/WhatAmITask.jsx` | **NEW** — student renderer |
| `student-app/src/components/tasks/TaskRunner.jsx` | Add `case "what-am-i"` |
| `student-app/src/DemoMode.jsx` | Add a sample what-am-i task to the demo pool |
| `teacher-app/src/pages/LiveSession.jsx` | "Force reveal" + "Freeze" buttons when current task is what-am-i |

~6 file edits + 2 new files for MVP. Smaller than Quest Mode.

---

## 14. Open questions for you to weigh in on

1. **Inter-team vs Solo default in a multi-team room.** I'm defaulting to **inter-team** (race to answer). Alternative: **intra-team** (each team plays independently, no race). Inter-team is more dramatic but penalizes slow teams.
2. **Wrong-answer penalty default.** I'm defaulting to `"lockout"` for 8 seconds. Alternatives: auto-reveal a clue (gentler), 50% point deduction (sharper). Spec lists all three.
3. **Steal system in MVP?** I have it `allowSteal: false` by default. If you want it ON by default, I'll add the 5-second steal window to commit #4.
4. **AI generation: 1 clue at a time or all clues upfront?** I'm doing all clues upfront in one AI call (simpler, faster). Alternative: lazy generation per reveal (more expensive but allows adaptive difficulty based on team performance). Upfront is the MVP move; lazy can come later if needed.
5. **Answer input UX.** Free-text input vs autocomplete from a hidden word list. Free-text is what the spec implies and matches the "feel like a real deduction" goal. Confirm?
6. **Visible point ceiling — countdown or step-down?** Smooth countdown ("10 → 8" animation) vs hard step ("now worth 8"). I'd default to a brief 400ms animation. Confirm?

Once these are settled, I'll start commit #1 of §12.
