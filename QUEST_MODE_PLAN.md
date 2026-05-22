# Quest Mode — Implementation Plan

**Status:** Design doc — review/edit before code is written.
**Decisions locked in (from clarifying Qs):**

- **Starting slice:** plan doc first (this file).
- **Activation:** auto-activate, always visible. If any task in the taskset has `taskType: "quest"`, the coin/inventory bar shows up from the start of the session.
- **Coin economy:** every completed task awards coins (reuse the existing per-task adaptive points number as the coin amount). No per-type whitelist.

---

## 1. What Quest Mode is (in one sentence)

A live classroom simulation overlay that turns a taskset into an expedition: teams earn **coins** by completing normal academic tasks, **spend** them on resources with prerequisites, and progress through a narrative **quest** with optional **bonus** + **hidden** challenges.

Everything is opt-in per taskset — Quest Mode literally cannot activate without a `quest` task in the taskset, so non-quest tasksets are untouched.

---

## 2. Current architecture we're hooking into

Today the relevant primitives are:

- **`shared/taskTypes.js`** — single source of truth for task type IDs + `TASK_TYPE_META` (which the generator uses to decide what to emit, what each type supports, etc.).
- **`backend/models/TaskSet.js`** — already a Mongoose schema with `tasks: [TaskSchema]`, `config: Mixed`, `meta: Mixed`. Adding a `questConfig` field is cheap.
- **`backend/controllers/mainTasksetController.js`** — generator. Today it computes `numTasks` from `durationMinutes / 5`, builds `eligible` / `userPool` / `guaranteed`, then asks the AI to fill the shells. This is where we'd splice in `coreTasks + bonusTasks + hiddenTasks`.
- **`backend/controllers/sharedTasksetController.js`** — has `generateFromTemplate()` and `validateAiTask()` for shell-based generation. New `quest` shell goes here.
- **`backend/index.js`** — socket layer. `updateTeamScore(room, teamId, points)` (line 1340) and `addBonusSubmission(room, teamId, points, reason, meta)` (line 1357) are the choke points for awarding points. **Coin awards just become a side effect of the same submission flow.**
- **`teacher-app/src/pages/LiveSession.jsx`** — teacher view; this is where the Quest Console (inventories, teacher events, manual grants) lives.
- **`student-app/src/StudentApp.jsx` + `TaskRunner.jsx`** — student device. A new `<QuestHud />` overlay reads from socket state.

The key insight: **a "team score" already exists as `room.teams[teamId].score`**, plus a derived score from `room.submissions[]`. Coins can be **either the same number** (simplest, "score = coins, spend reduces coins") **or a parallel number** (cleaner mental model). I recommend **parallel** — see §5.

---

## 3. Data model changes

### 3a. Task schema — additive fields

These all live inside the existing `TaskSchema` in `backend/models/TaskSet.js`. All optional, all default-falsey, so existing tasksets are unaffected.

```js
// Quest Mode additions to TaskSchema:
isBonus: { type: Boolean, default: false },
isHidden: { type: Boolean, default: false },
requiredForCompletion: { type: Boolean, default: true },
unlockConditions: { type: Schema.Types.Mixed, default: null },
coinReward: { type: Number, default: null },          // override per task; null = use base
resourceReward: { type: Schema.Types.Mixed, default: null }, // e.g. { rope: 2 }
qualityThreshold: { type: Number, default: null },
questEffects: { type: Schema.Types.Mixed, default: null },
```

For `taskType: "quest"`, the existing `config: Mixed` field carries the quest payload:

```js
config: {
  title: "Launch the Sea Expedition",
  scenario: "Your team must prepare a sea voyage before winter…",
  objectives: [
    {
      id: "launch-voyage",
      description: "Launch with adequate supplies.",
      requiredResources: { rope: 10, water: 50, food: 20, navigationChart: 1 }
    }
  ],
  premiumResources: { reinforcedRope: { bonusPoints: 10, replaces: "rope" } },
  resources: [
    {
      id: "rope",
      name: "Rope",
      acquisitionOptions: [
        { type: "coins", amount: 10 },
        { type: "true_false", count: 5, topic: "simple machines" }
      ],
      prerequisites: []
    },
    // …
  ],
  ranks: [
    { id: "completed", label: "Expedition Completed", min: 0 },
    { id: "prepared", label: "Well Prepared", min: 1 },     // bonus tasks
    { id: "master", label: "Master Expedition", min: 2 },
    { id: "legendary", label: "Legendary Voyage", hiddenRequired: true }
  ]
}
```

### 3b. TaskSet schema — additive fields

```js
questModeEnabled: { type: Boolean, default: false }, // derived: any task.taskType === "quest"
questConfig: { type: Schema.Types.Mixed, default: null }, // optional global config
```

### 3c. New collection: `TeamQuestState`

Per-(roomCode, teamId), persisted so a teacher refresh doesn't wipe coins/inventory. Roomcode is fine for v1; teaches will not analyze cross-room.

```js
// backend/models/TeamQuestState.js
const TeamQuestStateSchema = new Schema(
  {
    roomCode: { type: String, index: true, required: true },
    teamId:   { type: String, required: true },
    tasksetId:{ type: Schema.Types.ObjectId, ref: "TaskSet" },

    coins: { type: Number, default: 0 },
    inventory: { type: Map, of: Number, default: {} }, // { rope: 10, water: 50 }

    completedObjectives:    [{ type: String }],
    unlockedBonusTaskIds:   [{ type: String }],
    unlockedHiddenTaskIds:  [{ type: String }],
    completedBonusTaskIds:  [{ type: String }],
    completedHiddenTaskIds: [{ type: String }],

    questRank: { type: String, default: null }, // "completed" | "prepared" | …

    tradeHistory:        { type: [Schema.Types.Mixed], default: [] },
    contributionRecords: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true }
);
TeamQuestStateSchema.index({ roomCode: 1, teamId: 1 }, { unique: true });
```

### 3d. v2 collections (deferred, NOT in MVP)

- `TradeRecord` — peer-to-peer resource sales via QR. v2.
- `ContributionRecord` — fine-grained contribution tags. v2.
- `SellerCredibility` — anti-abuse credibility score. v2.

---

## 4. Generator changes — `coreTasks + 2 bonus + 1 hidden`

**File:** `backend/controllers/mainTasksetController.js`

Today the generator does roughly:

```js
const numTasks = Math.ceil(durationMinutes / 5);
// build eligible pool, ask AI for `numTasks` tasks
```

New behaviour when the request includes `mode: "quest"` (or the teacher checked a "Quest mode" box in `AiTasksetGenerator.jsx`):

```js
const coreCount = Math.ceil(durationMinutes / 5);
const bonusCount = 2;
const hiddenCount = 1;

// 1. Guarantee at least one quest-typed core task (the mission itself)
guaranteed.unshift("quest");

// 2. Ask the AI for coreCount core tasks (same as today)
const coreTasks = await generateCoreTasks({ count: coreCount, ... });

// 3. Ask the AI for `bonusCount` advanced-contract tasks
const bonusTasks = (await generateBonusTasks({ count: bonusCount, theme: questTheme }))
  .map(t => ({ ...t, isBonus: true, requiredForCompletion: false, unlockConditions: { coreProgressPct: 100 } }));

// 4. Ask the AI for `hiddenCount` elite/secret tasks
const hiddenTasks = (await generateHiddenTasks({ count: hiddenCount, theme: questTheme }))
  .map(t => ({
    ...t,
    isHidden: true,
    requiredForCompletion: false,
    unlockConditions: { coreQuestCompleted: true, minRemainingMinutes: 8 }
  }));

const tasks = [...coreTasks, ...bonusTasks, ...hiddenTasks];
await TaskSet.create({ ..., tasks, questModeEnabled: true });
```

Bonus + hidden tasks **DO NOT count toward the 5-minute estimate** — that stays governed by `coreCount`.

### Quest shell

Add to `shared/taskTypes.js`:

```js
QUEST: "quest",
```

Add to `TASK_TYPE_META`:

```js
quest: {
  label: "Quest",
  intraTeamEnabled: true,
  interTeamEnabled: true,
  movement: false,
  scoring: { type: "objective", maxPoints: 30 },
}
```

Add shell to `backend/controllers/sharedTasksetController.js → TASK_SHELLS`:

```js
quest: ({ topic, gradeLevel, subject }) => ({
  taskType: "quest",
  title: "Mission: …",
  prompt: "Your team must …",
  timeMinutes: 15,
  config: {
    title: "",
    scenario: "",
    objectives: [{ id: "obj-1", description: "", requiredResources: {} }],
    resources: [],
    premiumResources: {},
    ranks: [
      { id: "completed", label: "Mission Completed", min: 0 },
      { id: "prepared", label: "Well Prepared", min: 1 },
      { id: "master", label: "Master Mission", min: 2 },
    ],
  },
}),
```

And teach the AI prompt to fill in `scenario` + `objectives.requiredResources` + 3–6 `resources` with `acquisitionOptions` (coin cost, plus 1 alt non-coin option).

---

## 5. Coin economy hook

**Decision:** every completed task awards coins **equal to the task's point award**. Coins are a **parallel counter** on `TeamQuestState`, not a redefinition of score.

Why parallel:
- Spending coins on resources shouldn't lower team score (would feel punishing).
- Score is the public leaderboard; coins are an internal economy.
- We can later "convert" coins → score at the end via quest rank if we want.

**Hook location:** `backend/index.js`, inside the task-submission handler where `updateTeamScore(room, teamId, points)` is called (~line 3880 and adjacent points-award sites). After awarding score, also award coins iff `room.tasksetDoc?.questModeEnabled === true`:

```js
if (room.questModeEnabled) {
  await awardCoins(room.code, teamId, awardedPoints, { reason: "task-complete", taskId });
  io.to(room.code).emit("quest:stateUpdated", await getQuestState(room.code, teamId));
}
```

`awardCoins` is a tiny helper in a new `backend/services/questEconomy.js` that does `findOneAndUpdate({ roomCode, teamId }, { $inc: { coins } })`.

---

## 6. Resource acquisition flow (MVP — coin path only)

Three sockets, all server-validated:

```
student → server:  quest:requestResource    { roomCode, teamId, resourceId, quantity }
server → student:  quest:acquisitionOffer   { acquisitionOptions, prerequisites, missing }
student → server:  quest:acquireResource    { roomCode, teamId, resourceId, quantity, option }
server → student:  quest:stateUpdated       (full state)
server → teacher:  quest:teamUpdated        (broadcast to teacher console)
```

For MVP: only the `{ type: "coins", amount }` option is honored. Other `acquisitionOptions` (true-false challenge, verbal explanation, etc.) appear in the UI but are marked "Coming soon."

**Prerequisite check (server-side):**

```js
function checkPrerequisites(prereqs, inventory) {
  const missing = [];
  for (const p of prereqs || []) {
    if (p.type === "resource") {
      const have = inventory.get(p.resourceId) || 0;
      if (have < p.quantity) {
        if (p.requirementType === "hard") missing.push(p);
      }
    }
  }
  return { ok: missing.length === 0, missing };
}
```

UX rule from spec: never say "denied." Always include `missingMessage`.

---

## 7. Bonus + Hidden unlock logic

Lives in `backend/services/questUnlocks.js`. Runs after every `quest:stateUpdated`.

```js
function evaluateUnlocks(taskset, state, sessionTimeRemainingMin) {
  const coreDone = countCoreDone(taskset, state);
  const coreTotal = countCore(taskset);
  const corePct = coreDone / coreTotal;

  const newUnlocks = [];
  for (const t of taskset.tasks) {
    if (t.isBonus && !state.unlockedBonusTaskIds.includes(t.taskId)) {
      const cond = t.unlockConditions || { coreProgressPct: 80 };
      if (corePct * 100 >= (cond.coreProgressPct ?? 80)) newUnlocks.push(t.taskId);
    }
    if (t.isHidden && !state.unlockedHiddenTaskIds.includes(t.taskId)) {
      const cond = t.unlockConditions || {};
      if (cond.coreQuestCompleted && corePct < 1) continue;
      if (cond.minRemainingMinutes && sessionTimeRemainingMin < cond.minRemainingMinutes) continue;
      if (cond.minCoins && state.coins < cond.minCoins) continue;
      newUnlocks.push(t.taskId);
    }
  }
  return newUnlocks;
}
```

When something unlocks: push to the right list, emit `quest:taskUnlocked` with a celebratory payload (the student app already has confetti/sound infra in `useSoundEffects.js`).

---

## 8. Student UI — `<QuestHud />` component

Lives at `student-app/src/components/quest/QuestHud.jsx`. Mounted from `StudentApp.jsx` when `room.questModeEnabled === true`.

Minimum surface (MVP):

- **Top strip:** coin balance, inventory chips (rope ×3, water ×50…), current mission title.
- **Bottom drawer (collapsed by default):** "Buy supplies" — list of `quest.config.resources` with cost, prerequisites (with `missingMessage` when not met), and a "Buy" button (disabled if insufficient coins).
- **Mission card** (inside `TaskRunner` when the current task is `quest`): scenario, objectives with progress (e.g. `rope 3/10`), Launch button (disabled until requirements met).
- **Bonus chip:** appears with a soft glow when a bonus task unlocks; tap → switches to that task.
- **Hidden chip:** invisible until unlocked, then dramatic reveal.

Out of MVP scope (v2): role assignment cards, seller QR generation, trade history panel, contribution tags.

---

## 9. Teacher UI — `<QuestConsole />` in LiveSession

New panel inside `teacher-app/src/pages/LiveSession.jsx`, only shown when `tasksetDoc.questModeEnabled === true`. Reuses the existing right-rail panel layout.

MVP capabilities:
- **Per-team table:** team name | coins | inventory summary | objectives done | rank.
- **Manual grant:** "+10 coins" / "+1 rope" buttons per team.
- **Unlock control:** "Unlock bonus task" / "Unlock hidden task" override buttons.
- **World events** (v2): storm, supply shortage, market closes. Deferred.

---

## 10. New backend endpoints / sockets

Sockets (preferred, matches existing pattern):
- `quest:requestState` → returns current `TeamQuestState` for the requesting team.
- `quest:requestResource` → returns offer.
- `quest:acquireResource` → validates + deducts + grants + emits update.
- `quest:teacherGrant` → teacher-only; manual adjust.
- `quest:teacherUnlock` → teacher-only; override unlock.
- `quest:stateUpdated` → broadcast (one team).
- `quest:teamUpdated` → broadcast to teacher (all teams).
- `quest:taskUnlocked` → broadcast (one team, celebratory).

REST (for admin / debugging only, not v1):
- `GET /api/tasksets/:id/quest-state?roomCode=…` — list all team states.

---

## 11. File touchpoints summary

| File | Change |
|---|---|
| `shared/taskTypes.js` | Add `QUEST` task type + `TASK_TYPE_META.quest` |
| `backend/controllers/sharedTasksetController.js` | Add `quest` to `TASK_SHELLS` + `validateAiTask` branch |
| `backend/controllers/mainTasksetController.js` | New `coreTasks + 2 bonus + 1 hidden` flow when `mode === "quest"` |
| `backend/models/TaskSet.js` | Add `isBonus`, `isHidden`, `requiredForCompletion`, `unlockConditions`, `coinReward`, `resourceReward`, `qualityThreshold`, `questEffects` on TaskSchema; `questModeEnabled`, `questConfig` on TaskSetSchema |
| `backend/models/TeamQuestState.js` | **NEW** — see §3c |
| `backend/services/questEconomy.js` | **NEW** — `awardCoins`, `spendCoins`, `getQuestState` |
| `backend/services/questUnlocks.js` | **NEW** — `evaluateUnlocks` |
| `backend/index.js` | After every score award, mirror to coins if `questModeEnabled`. Register quest:* socket handlers. |
| `backend/routes/tasksets.js` | (optional) admin route to inspect quest state |
| `teacher-app/src/pages/AiTasksetGenerator.jsx` | New "Quest Mode" checkbox; passes `mode: "quest"` |
| `teacher-app/src/pages/LiveSession.jsx` | Mount `<QuestConsole />` when `tasksetDoc.questModeEnabled` |
| `teacher-app/src/components/quest/QuestConsole.jsx` | **NEW** |
| `student-app/src/StudentApp.jsx` | Mount `<QuestHud />` when room is quest-enabled |
| `student-app/src/components/quest/QuestHud.jsx` | **NEW** |
| `student-app/src/components/tasks/types/QuestTask.jsx` | **NEW** — renders mission card inside TaskRunner |
| `student-app/src/components/tasks/TaskRunner.jsx` | Add `case "quest"` |

~13 file edits + 6 new files for MVP.

---

## 12. MVP build order (suggested commits, each independently testable)

1. **`quest` task type plumbing** — `shared/taskTypes.js`, schema additive fields, sanitize/normalize branch. No UI yet. Tasksets can carry quest tasks but they render as a fallback "open-text" card. *Verifiable: a hand-crafted quest task can be saved and round-trips.*
2. **Generator: `coreTasks + 2 + 1`** — only when `mode: "quest"` arrives from the teacher app. Existing flows untouched. *Verifiable: generating a 45-min quest taskset emits 9 core + 2 bonus + 1 hidden.*
3. **`TeamQuestState` model + `awardCoins` mirror** — on every task completion in a quest-enabled room, increment coins. *Verifiable: complete a normal task, see coin balance climb in Mongo.*
4. **`<QuestHud />` (read-only) + `quest:requestState`** — student device shows coins + inventory + mission card. No buying yet. *Verifiable: visual on phone.*
5. **Resource buying (coin path only)** — `quest:requestResource` / `quest:acquireResource`, prerequisite check, missing-message UI. *Verifiable: spend 10 coins → rope appears in inventory.*
6. **Bonus + hidden unlock logic** — server-side evaluator + celebratory client banner. *Verifiable: hit 80% core → bonus chip glows.*
7. **Teacher `<QuestConsole />`** — per-team table, manual grant, override unlock. *Verifiable: teacher hands out coins, student HUD updates live.*

Stop here for v1 ship. Then iterate on the v2 list.

---

## 13. v2 (out of MVP, but mapped)

- Non-coin acquisition challenges (true-false, verbal explanation, matching). Each becomes a mini-modal that resolves to "approved → grant" or "rejected".
- Peer-to-peer QR resource trades (`TradeRecord`, single-use QR tokens, seller approval flow).
- Team roles (engineer / negotiator / detail specialist) with role-targeted prompts.
- Contribution tags + seller credibility.
- World events (storm, market closes, supply shortage).
- "What Am I?" task type as a candidate **resource acquisition challenge** — clean fit; see `WHAT_AM_I_TASK_PLAN.md`.

---

## 14. Open questions for you to weigh in on

1. **Coin↔Score relationship.** I'm proposing **parallel** (coins separate from team score). The spec is ambiguous. Alternative: coins ARE score, spending reduces score. Parallel is what I'll implement unless you push back.
2. **Coin amount per task.** Same number as the points award (e.g. 10-point task = 10 coins), or a fixed mapping like `5 coins per completed task`? Spec examples use 5/6/8/10, so per-task adaptive is closer.
3. **Hidden task copy.** Spec offers Hidden Challenge / Secret Mission / Elite Contract / Discovery Task. I'll default to **"Hidden Challenge"** unless you have a preference — easy to change later.
4. **Quest theme inputs.** Should the teacher pick a theme (sea voyage / expedition / market / rescue), or does the AI infer from the lesson topic? I'd default to inferring + an optional theme override field.
5. **Persistence on disconnect.** `TeamQuestState` is durable per `(roomCode, teamId)`. Is that the right scope? Or should it be per (sessionId)? Today rooms aren't durable across teacher refresh — quest state would be. *Recommend: keep `roomCode` keyed, it's stable enough for the use case.*
6. **Bonus task unlock threshold.** I picked `coreProgressPct >= 80`. Spec says "after core progress or when a team finishes early." 80% is a guess — could be 100% (only after core done) or 50%. Want it sooner or later?

Once you sign off on these, I'll start commit #1 of §12.
