# Educational Escape Room Engine + Progressive Puzzle Reveal — Implementation Plan

**Status:** Design doc — review/edit before any code is written.
**Scope:** Sections 4 + 4a of your spec combined. The Progressive Puzzle Reveal system is treated as a sub-system of the Escape Room engine because it shares all the same primitives (locks, unlocks, fragment inventory).

---

## 1. One-paragraph framing

An Escape Room is a **mode that wraps a taskset**, where solving curriculum tasks **unlocks locks**, each lock gates one or more downstream tasks/areas/clues, and the room is "escaped" when the final lock opens. Progressive Puzzle Reveal is the **visual layer** of that same system — instead of just a "✅ unlocked" tick, students see image fragments, cipher digits, and map pieces accumulate, building anticipation toward a final synthesis puzzle.

Activation rule: a taskset becomes an escape room iff `taskset.escapeRoomConfig != null`. Without that field, none of the new logic runs.

---

## 2. The mental model — locks, keys, fragments

The engine is built on three primitives:

| Primitive | What it is | Examples |
|---|---|---|
| **Lock** | A gate that hides downstream content until a condition is met. | "Need the Library Code", "3 keys", "Confederation password". |
| **Key** | An item granted by completing a task or hitting a milestone. | Blue Key, Library Code = "1867". |
| **Fragment** | A visual chunk of a final puzzle, earned over time. | 1/9 of an image, 1 digit of a 4-digit code, 1 of 6 cipher wheel rings. |

Locks consume keys; fragments accumulate toward a final puzzle that **itself acts as the room's exit lock**. Everything else (modes, narrative, duels, hidden tasks) is decoration on top of this core.

---

## 3. Modes — what's in MVP

| Mode | In MVP? | Notes |
|---|---|---|
| **Linear** | ✅ | Tasks complete in order; each one's completion is the key to the next. Simplest. Defaults for younger grades. |
| **Multi-path** | ✅ | "Final lock needs 3 keys; any 3 of the 5 available." DAG-based unlock; we already have this expressiveness if we model locks with a `requires: { keys: [...], minCount }`. |
| **Open World** | ⏸ v2 | Free roam between stations, hidden tasks scattered. Needs a station map UI we don't have. |
| **Competitive** | ⏸ v2 | Teams race the same room. Needs per-team room state forking. |
| **Whole-class cooperative** | ⏸ v2 | Single shared lock list across all teams. Adds a class-wide socket channel. |
| **Hybrid physical-digital** | ✅ (passive support) | We already have QR scans, station codes, and movement-required tasks — those become lock keys for free. No new mode-specific code; the engine just respects task `displayKey` as a "scan this station to earn the key" trigger. |

MVP delivers Linear + Multi-path + passive Hybrid. v2 adds Open World, Competitive, Whole-class.

---

## 4. Data model

### 4a. `EscapeRoomConfig` (lives on TaskSet)

```js
// backend/models/TaskSet.js — additive field on TaskSetSchema
escapeRoomConfig: { type: Schema.Types.Mixed, default: null }
```

Shape:

```js
{
  enabled: true,
  mode: "linear" | "multi-path",
  difficulty: "easy" | "medium" | "hard" | "expert",
  theme: "spy" | "archaeologist" | "biblical-journey" | "...",  // narrative pack
  narrativeTermsUsed: ["Confederation", "Loyalists", "Responsible Government"],

  // The list of locks. Order is presentation order, NOT execution order
  // (execution is governed by `requires`).
  locks: [
    {
      id: "lock-1",
      title: "The Library Door",
      narrativeText: "A heavy oak door blocks the way. A keypad glows beside it.",
      requires: { keys: ["library-code"] },        // simple form
      unlocks: { tasks: ["task-3", "task-4"], fragments: ["map-piece-1"] },
      hint: "Lord Durham's report was written in what year?",
      type: "password" | "key-list" | "evidence-chain" | "synthesis" | "scan",
    },
    {
      id: "final-lock",
      title: "The Vault",
      requires: { fragments: ["map-piece-1", "map-piece-2", "map-piece-3", "map-piece-4"] },
      unlocks: { roomCompleted: true },
      type: "synthesis"
    }
  ],

  // The list of keys (granted by tasks)
  keys: [
    {
      id: "library-code",
      name: "Library Code",
      grantedBy: { taskId: "task-2" },              // when this task is completed
      // OR
      // grantedBy: { type: "scan", stationCode: "RED-STATION" }
      narrativeText: "You found a slip of paper: 1867."
    }
  ],

  // Visual fragment definitions
  fragments: [
    {
      id: "map-piece-1",
      type: "image-tile",
      assetUrl: "...",              // optional; AI-generated for theme if absent
      gridPos: { row: 0, col: 0 },  // for image-puzzle layout
      narrativeText: "A tattered corner of an old map."
    },
    {
      id: "code-digit-1",
      type: "cipher-digit",
      revealValue: "1",             // hidden until earned
      position: 0
    }
  ],

  // Hidden + bonus tasks (already supported by the Quest Mode plan's schema
  // additions; reused here)
  hiddenTaskTriggers: [
    { taskId: "secret-task-1", revealedBy: { scanStationCode: "BLACKLIGHT-CLUE" } }
  ],

  narrativeBeats: [
    { trigger: "lock-1-opened", text: "You hear footsteps echoing far away…" },
    { trigger: "fragment-3-earned", text: "The map is taking shape." },
    { trigger: "room-completed", text: "The vault door swings open. You escaped." }
  ]
}
```

### 4b. `EscapeRoomTeamState` (per team, per room)

```js
// backend/models/EscapeRoomTeamState.js — NEW collection
{
  roomCode: String,         // session room code
  teamId: String,
  tasksetId: ObjectId,

  keysEarned:       [String],   // ["library-code", "vault-key"]
  fragmentsEarned:  [String],   // ["map-piece-1", "code-digit-1"]
  locksOpened:      [String],
  hintsUsed:        Number,
  narrativeBeatsDelivered: [String],   // dedupe so each beat triggers once

  // Progressive Puzzle Reveal cached state — the final puzzle assembly
  finalPuzzleState: Mixed,      // free-form, depends on lock type

  // Bookkeeping
  startedAt: Date,
  completedAt: Date,
  escapeTimeMs: Number
}
```

---

## 5. Generator changes

**File:** `backend/controllers/mainTasksetController.js`. New branch when the teacher selects "Escape Room" mode in `AiTasksetGenerator.jsx`.

### 5a. Generation flow

1. Generate the core taskset as today (`coreCount = Math.ceil(durationMinutes / 5)`).
2. Generate `escapeRoomConfig` from a dedicated prompt that takes the **same `narrativeTerms` array** the teacher entered.
3. Wire each generated lock's `requires` to specific tasks. For Linear: lock_N requires lock_{N-1}-completed. For Multi-path: pick K of N keys to require for the final lock, leaving the rest as optional/redundant paths.
4. Generate 2 bonus + 1 hidden task as in the Quest Mode plan (these systems share the bonus/hidden infrastructure).
5. Persist with `escapeRoomConfig`.

### 5b. AI prompt for `escapeRoomConfig`

The prompt MUST include the curriculum terms verbatim and require the AI to weave them into the narrative. Reject + repair if the generated `narrative` or `lock.hint` text contains zero of the input terms.

```
Generate an escape room config for a {gradeLevel} {subject} class using the theme: {theme}.

CURRICULUM TERMS — these MUST appear in the narrative and puzzles:
{narrativeTerms}

Output JSON matching this exact shape:
{ enabled, mode, difficulty, theme, narrativeTermsUsed: [...],
  locks: [{ id, title, narrativeText, requires, unlocks, hint, type }],
  keys:  [{ id, name, grantedBy, narrativeText }],
  fragments: [...],
  narrativeBeats: [...] }

RULES:
- Each lock's hint MUST be a CURRICULUM question, not a riddle disconnected from the lesson.
- Lock 1 should be solvable from the lesson basics.
- Final lock should require synthesis of MULTIPLE terms.
- Theme metaphors only — never violence, never targeting students.
- Every curriculum term must appear at least once in EITHER hint, narrativeText, or fragment narrativeText.
```

### 5c. Validation

`validateEscapeRoomConfig(config, inputTerms)`:
- Every lock has at least one entry in `requires`.
- Every `requires.keys[i]` exists in `keys[]`.
- Every `requires.fragments[i]` exists in `fragments[]`.
- Every key's `grantedBy.taskId` exists in `tasks[]` OR has a valid scan/event trigger.
- `narrativeTermsUsed` ⊆ `inputTerms` AND ≥ 80% of `inputTerms` were used.
- Detect dead-ends: every key MUST be reachable, every lock MUST be openable.
- Detect cycles in the DAG.

A single repair attempt on failure, falling back to a deterministic single-lock skeleton.

---

## 6. Progressive Puzzle Reveal (the 4a sub-system)

This is **purely a renderer + state aggregation layer** on top of the lock/key/fragment model — no separate data structures.

### 6a. Fragment types

| Type | Renderer | Final synthesis |
|---|---|---|
| `image-tile` | 3×3 (or N×M) grid; tiles fade in as earned. Final lock asks: "Click the tiles in scrambled order to assemble the map." | Drag/tap puzzle assembly. |
| `cipher-digit` | A digit box that's a blurred `?` until earned; flips to reveal the digit. Final lock asks: "Enter the 4-digit code." | PIN entry. |
| `cipher-wheel-ring` | Concentric ring of a cipher wheel; each ring is one fragment. Final lock: "Align the wheel to spell the password." | Rotational alignment puzzle. |
| `evidence-card` | A card pinned to a corkboard. Final lock asks: "Which person committed the act? Combine the evidence." | Multi-select / matching. |
| `timeline-event` | A point on a timeline. Final lock: "Drag all events into chronological order." | Sequence. |
| `password-segment` | A letter or word. Final lock: "Assemble the password." | Anagram-like assembly. |

These are all rendered by a single `<FinalPuzzle />` React component that switches on `lock.type` for the final lock. Earlier fragments just dim/blur progressively as they're earned.

### 6b. Visual progression states

For any fragment, four visual states:

1. **Hidden** — totally absent from layout (silhouette spot if image-tile).
2. **Discovered** — opaque tile slot, big "?" overlay, soft glow.
3. **Revealed** — full clarity, animated sweep-in (300ms blur → clear).
4. **Used** — placed in the final synthesis area.

Transition triggers: `quest:fragmentEarned` socket event → state 2 → state 3 with a celebratory micro-animation.

### 6c. Anti-brute-force

The final synthesis puzzle's correct answer is NOT shipped to the client. Instead:
- Each fragment ships its `revealValue` only AFTER it's earned (server checks).
- The final submission is sent to the server, which validates against the lock's hidden `requires.synthesisAnswer` (or a deterministic function over earned fragments).

For image-tile assembly: the validation is "all 9 tiles in correct grid positions" — verifiable client-side since each tile's `gridPos` is known. For cipher synthesis: server validates the final entered string.

---

## 7. Backend touchpoints

| File | Change |
|---|---|
| `shared/taskTypes.js` | No new task type — escape room is a *mode*, not a task. (Optional: add `ESCAPE_INTRO` for the intro task, but reusable as MOOD_CHECKIN with a flag.) |
| `backend/models/TaskSet.js` | Add `escapeRoomConfig: Mixed`. |
| `backend/models/EscapeRoomTeamState.js` | **NEW** — per §4b. |
| `backend/services/escapeRoom.js` | **NEW** — central state engine: `evaluateLocks(state, config)`, `grantKey(state, keyId)`, `grantFragment(state, fragmentId)`, `attemptUnlock(state, lockId, submission)`. |
| `backend/controllers/mainTasksetController.js` | New `mode: "escape-room"` branch in generator. |
| `backend/controllers/escapeRoomGenerator.js` | **NEW** — the AI prompt + validate/repair pipeline for `escapeRoomConfig`. |
| `backend/index.js` | Hook into `student:submitAnswer`: after award, call `escapeRoom.onTaskCompleted(roomCode, teamId, taskId)` which checks `keys[].grantedBy.taskId` and grants matching keys. Register `escape:requestState`, `escape:attemptUnlock`, `escape:useHint`, `escape:teacherEvent`. |

## 8. Frontend touchpoints — student app

| File | Change |
|---|---|
| `student-app/src/components/escape/EscapeRoomHud.jsx` | **NEW** — top bar: keys earned, fragments earned, room progress %, current narrative beat. |
| `student-app/src/components/escape/FinalPuzzle.jsx` | **NEW** — renders the final lock's synthesis UI (switches by type). |
| `student-app/src/components/escape/FragmentTile.jsx` | **NEW** — single fragment visual state machine. |
| `student-app/src/components/escape/LockDoor.jsx` | **NEW** — current lock display, hint button, attempt input. |
| `student-app/src/StudentApp.jsx` | Mount `<EscapeRoomHud />` when `room.tasksetDoc.escapeRoomConfig?.enabled`. |
| `student-app/src/components/tasks/TaskRunner.jsx` | After a task awards, dispatch a fragment-earn animation if applicable. |
| `student-app/src/DemoMode.jsx` | Add a baked sample escape room for testers. |

## 9. Frontend touchpoints — teacher app

| File | Change |
|---|---|
| `teacher-app/src/pages/AiTasksetGenerator.jsx` | New "Escape Room" mode toggle + narrative theme picker (+ narrative terms textarea — same field that's already used for vocab/topics). |
| `teacher-app/src/pages/LiveSession.jsx` | Mount `<EscapeRoomConsole />` panel when `tasksetDoc.escapeRoomConfig?.enabled`. |
| `teacher-app/src/components/escape/EscapeRoomConsole.jsx` | **NEW** — per-team table: keys, fragments, current lock, hints used, escape status. Manual "Grant key/fragment" + "Trigger narrative event" buttons. |

---

## 10. New sockets

```
client → server:  escape:requestState     { roomCode, teamId }
client → server:  escape:attemptUnlock    { roomCode, teamId, lockId, submission }
client → server:  escape:useHint          { roomCode, teamId, lockId }
client → server:  escape:requestFragment  { roomCode, teamId, fragmentId }   // returns revealValue if earned
server → client:  escape:stateUpdated     (full team state)
server → client:  escape:fragmentEarned   (celebratory event)
server → client:  escape:lockOpened       (narrative beat + unlock contents)
server → client:  escape:narrativeBeat    (story announcement)
server → teacher: escape:teamUpdated      (broadcast)
teacher → server: escape:teacherEvent     { type: "grant-key"|"grant-fragment"|"open-lock"|"announce", ... }
```

---

## 11. AI Narrator system

In MVP this is **scripted narrative beats fired by state transitions** (per §4a `narrativeBeats[]`). Not a live LLM call.

In v2 we can add a `escape:liveNarrate(stateSnapshot)` socket that calls a small LLM with a tight prompt to riff on current team status ("Team Red is struggling with lock 2; offer encouragement"). Deferred because:
- Latency budget is tight in live sessions.
- Cost per session would balloon.
- Scripted beats covers 80% of the dramatic value.

---

## 12. MVP build order

1. **Config schema + state model** — add `escapeRoomConfig` field; create `EscapeRoomTeamState` model; round-trip a hand-crafted config. *Verifiable: a teacher-edited JSON config survives a save/load.*
2. **Engine: lock evaluator + key/fragment grants** — `backend/services/escapeRoom.js`; hook into task-completion in `index.js`. Console.log every state transition. *Verifiable: simulated taskset → state log shows keys flowing in.*
3. **Student HUD (read-only)** — `<EscapeRoomHud />` + `<FragmentTile />`; renders state but no interaction. *Verifiable: visual on phone.*
4. **Final puzzle (one type: cipher-digit)** — `<FinalPuzzle />` for cipher-digit only; PIN entry; server validation. *Verifiable: complete a 4-task escape room with PIN as final lock.*
5. **AI generator** — `escapeRoomGenerator.js` prompt + validator + repair; integrate into `mainTasksetController.js`. *Verifiable: teacher-generated escape room saves with valid config 95%+ of the time.*
6. **Teacher console** — `<EscapeRoomConsole />`; per-team table; manual grants; narrative event triggers. *Verifiable: teacher rescues a stuck team mid-room.*
7. **Second + third final-puzzle types** — image-tile assembly + password-segment anagram. *Verifiable: each is solvable + validates server-side.*
8. **Demo mode** — bake one full sample into `student-app/src/DemoMode.jsx`. *Verifiable: testers can play a complete escape room without joining a real room.*

v1 ship after step 8. v2 picks up: open-world mode, competitive forking, whole-class shared state, live AI narrator, additional fragment types (timeline, evidence-card, cipher-wheel), QR-station hidden triggers.

---

## 13. How this stacks with the other proposed systems

These five systems (Quest, What Am I?, Escape Room, Whodunnit, Hole-in-One) overlap heavily. I'm modelling them as **layers**, not parallel features:

```
  Whodunnit                ←  identity mystery layer (lives on top of any session)
       |
  Escape Room              ←  lock/key/fragment progression overlay
       |
  Quest Mode               ←  coin/resource economy overlay
       |
  Tasks                    ←  the base unit (multiple-choice, what-am-i, hole-in-one, …)
```

Specifically:
- **What Am I?** and **Hole in One** are *task types* — they slot into a taskset like any other task. Either system above can use them as the "unlock-this-lock" challenge.
- **Quest Mode**, **Escape Room**, and **Whodunnit** are *layered overlays* — each is null/off unless its config is present on the taskset (or session). Multiple layers can be active at once. The most expressive form is `tasks + quest economy + escape room locks + whodunnit hidden role` — a "spy mission" full stack.
- They share infrastructure: bonus/hidden task fields (introduced in Quest Mode plan, reused everywhere); the curriculum-term-driven AI generation prompt (introduced in Escape Room plan, reusable for What Am I? and Whodunnit clues).

I'd recommend building in this order:
1. **Quest Mode** (foundational economy + bonus/hidden task infrastructure)
2. **What Am I?** (simplest standalone task; tests the bonus/hidden mechanics in a vacuum)
3. **Escape Room Engine** (uses Quest Mode's bonus/hidden plumbing; adds lock/key/fragment vocabulary)
4. **Whodunnit** (sits on top of all three; uses real gameplay events for clues)
5. **Hole in One** (independent task type; consumes Quest Mode's resource system for rails/balls/powerups)

That's the dependency DAG. Each piece can ship independently, but later ones get more powerful when earlier ones exist.

---

## 14. Open questions for you to weigh in on

1. **Linear vs Multi-path for the default generator output.** Spec says spec; I'd default to **multi-path with N=3, requires=2 keys** for Grades 5+, **linear** for Grades 3-4. Confirm?
2. **Curriculum term coverage threshold.** I picked 80% in §5c. Stricter (100%) makes generation more likely to fail/retry; looser (50%) admits weaker thematic ties.
3. **How long a typical escape room runs.** Spec doesn't pin it. I'm assuming **same time budget as today's tasksets** (durationMinutes drives task count; escape room just reshapes the same N tasks into a graph). Alternative: escape rooms are explicitly longer (e.g., 60-minute default vs 30-minute default). Confirm?
4. **Hint cost.** Should hints cost coins/points, be free, or rate-limited? I'd default to **free but rate-limited (1 hint per lock per 2 minutes)** — escape rooms get frustrating without hints, but free unlimited hints kill the game.
5. **Failure penalty.** When a team enters the wrong synthesis code, what happens? I'd default to **30-second lockout + a free hint reveal**. Alternatives: point deduction, harder retries, or no penalty.
6. **Whose narrative theme picker is canonical?** I'm putting it in `AiTasksetGenerator.jsx` as a dropdown. Spec lists ~11 themes. Should this be free-text (AI picks the closest), a dropdown, or both?
7. **Progressive Puzzle Reveal MVP fragment type.** I'm proposing **cipher-digit** first because it's the simplest to render and validate. Confirm that's the right starting point, or do you want image-tile first (more visually impressive but trickier validation)?

Once these are settled, I'll start commit #1 of §12.
