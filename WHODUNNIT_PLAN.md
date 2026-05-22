# Whodunnit — Live Deduction Layer — Implementation Plan

**Status:** Design doc — review/edit before any code is written.
**Tone constraint (locked in by spec):** spy/saboteur/infiltrator framing. **Never** crime, murder, or violence. Hidden-role player is "the spy" or "the smuggler", not "the criminal."

---

## 1. One-paragraph framing

At the start of a live session, one player is **secretly assigned a hidden role** (Spy, Saboteur, Infiltrator, Smuggler, Double Agent). The class continues playing the normal taskset, but as real gameplay events happen — scans, purchases, movements, trades — the mystery engine generates **truthful clues about the hidden player's actual activity**. Teams spend resources to buy clues and eventually accuse a player. Right accusation = big reward. Wrong = penalty. The mystery is **real, not faked** — every clue references an event that actually happened.

This layer **wraps any session**. It's null/off unless enabled — non-mystery sessions are untouched.

---

## 2. Why this is non-trivial

The hard parts are:
1. **Clue quality.** Clues must be both **true** (actually identify the suspect when combined) and **ambiguous** (multiple students partially match each one). Solving requires combining clues; no single clue should be definitive.
2. **Bias / fairness.** The hidden role MUST feel randomly assigned. It MUST rotate across sessions. It MUST NOT lean on identity markers (name length, team color). And clue framing MUST stay playful, never accusatory.
3. **Anti-targeting.** A student being publicly accused (even falsely) can sting. The accusation UI is the highest-care surface in this whole spec.

These three constraints shape everything below.

---

## 3. Data model

### 3a. `MysterySession` (per live session)

```js
// backend/models/MysterySession.js — NEW
{
  roomCode: String,                // index, unique
  enabled: Boolean,
  themeRole: "spy" | "saboteur" | "infiltrator" | "smuggler" | "double-agent",
  difficulty: "easy" | "medium" | "hard" | "expert",

  suspectPlayerId: String,         // the actually-hidden player
  suspectAssignedAt: Date,

  // Configuration
  cluesReleasedAutomatically: Boolean,   // auto every N minutes, vs teacher-released
  autoClueIntervalMs: Number,
  investigationEconomy: {
    cluePurchaseCost: Number,            // default 20 (in coins or points)
    revealNamePartCost: Number,
    revealMovementCost: Number,
    revealInventoryCost: Number
  },
  accusationConfig: {
    accusationCost: Number,              // default 50
    correctReward: Number,                // default 200
    wrongPenalty: Number,                 // default 30
    maxAccusationsPerTeam: Number,        // default 2
    accusationCooldownMs: Number          // default 5 minutes
  },

  // Live state
  cluesReleased: [ClueRef],                // released to all teams
  cluesPurchasedByTeam: { [teamId]: [ClueRef] },
  accusations: [{ teamId, accusedPlayerId, correct, ts }],

  endedAt: Date,
  ended: Boolean
}
```

### 3b. `MysteryClue` (transient — generated, not pre-defined)

```js
{
  id: String,
  type: "movement" | "identity" | "team" | "visual" | "inventory" | "timing",
  text: String,                            // "The suspect recently scanned at the Yellow station."
  sourceEvent: { kind, eventId, ts },      // the actual gameplay event this clue is derived from
  truth: true,                              // for v1 always true; v2 may inject misinformation in hard mode
  ambiguityCount: Number,                   // how many non-suspect players ALSO satisfy this clue
  releasedAt: Date,
  releasedBy: "auto" | "teacher" | "team-purchase"
}
```

### 3c. `MysteryEventLog` (driven entirely by existing gameplay)

We don't add a new event-source. We **subscribe** to existing socket events and write the relevant ones to a log:

- `student:submitAnswer` → log scan/answer events
- `qr:stationScan` → log station visits
- `quest:acquireResource` → log purchases (if Quest Mode is on)
- `quest:trade` → log inter-team trades (v2 when trade ships)
- `teacher:bumpTeam`, behavior events → log behavioral noise

The log is in-memory per-room (`room.mysteryEventLog = []`) and persisted on session end for audit.

---

## 4. Clue generation engine

**Key insight:** clues are derived **after the fact** from real events. The engine never makes things up.

### 4a. The clue generator runs on a timer

Every `autoClueIntervalMs` (default 90 seconds), the engine:

1. Snapshots the event log since the last clue.
2. Picks the suspect's events that have **non-trivial ambiguity** — i.e., events at least one other player also performed recently.
3. Picks a clue type appropriate to the recent event mix.
4. Phrases the clue using the suspect's actual data, but with deliberate vagueness based on `ambiguityCount`.

Example:

```
Event log shows:
  - suspect (player-7) scanned YELLOW at T-90s
  - players 2, 4, 9 ALSO scanned YELLOW since the last clue

Generator picks: { type: "movement", text: "The suspect recently scanned at the Yellow station.", ambiguityCount: 3 }
```

This gives "Team Red thinks it's player 9, but Team Blue thinks it's player 4" — the deduction is real.

### 4b. Ambiguity-tuned phrasing

Easy mode: clues that 1–2 other students share. Hard mode: clues that 4+ other students share. Expert: clues that intentionally trade specificity for misdirection (e.g., reveal one letter of name from a similar-looking letter set: "the suspect's first name contains an O" when both O and Q satisfy a near-match in cursive).

### 4c. Clue types and their generators

| Type | Generator strategy |
|---|---|
| **Movement** | Pick a station the suspect visited; phrase by station color/name. |
| **Identity** | Hash the suspect's name into a true-but-partial statement (e.g., "the second letter is A", "contains an E", "longer than 5 letters"). Reject if statement uniquely identifies. |
| **Team** | "The suspect is on Team Red." Only fire when there are 3+ players per team. |
| **Visual** | Show the suspect's team selfie or avatar silhouette for 3s. Only if `mysteryAllowVisualClues: true` (teacher toggle). |
| **Inventory** | If Quest Mode is on: "The suspect owns rope right now." |
| **Timing** | "The suspect scanned a station within the last 2 minutes." Useful when the suspect just acted. |

Each generator returns `null` if ambiguity falls below a threshold (1) or above one (6) — we never reveal a uniquely-identifying clue, and we never produce a useless clue.

### 4d. Clue deduplication

The engine never repeats a clue's `text` verbatim. It tracks `cluesReleased[].text` and resamples.

---

## 5. Accusation system — UX is the make-or-break

This is the social-emotional risk surface. Design rules:

1. **Accusations are anonymous to other teams** — only the teacher dashboard shows who-accused-whom. Teammates of the accused never see "Team Red accused you."
2. **Wrong accusations don't broadcast the accused name.** The accusing team learns "Wrong." The class learns "Team Red made a wrong accusation (–30 points)" with no name attached.
3. **Correct accusation reveals the suspect to the whole class** — at this point the game's over for that round and it's a celebratory beat.
4. **Cooldown after a wrong accusation.** A team can't spam-accuse. Default 5-minute cooldown.
5. **Max accusations per team.** Default 2 per session. Forces deliberation.
6. **Accused player is told privately (after the round) what they were "playing."** Even if they weren't the suspect, the system can show "You were innocent — accused but cleared." This frames the role as a fun part of the game, not a stigma.

Spec wording I'm holding to: "feel random, remain playful, rotate naturally." We seed the random with `(sessionId, ts)`; no carryover.

### 5a. Wrong accusation penalty options

- Lose 30 points (default).
- Reveal ONE of the accuser's purchased clues to other teams (creates ripple consequences without harming the accused).
- 5-minute investigation cooldown.

Default: combination of all three. Spec asks for this.

---

## 6. Hidden objectives for the suspect

The suspect (the actual hidden-role player) gets a secret mini-goal on their student device. Examples:

- "Visit 3 stations of different colors."
- "Trade with another team for rope." (Quest Mode integration)
- "Stay on Team A's leaderboard rank" (i.e., don't draw attention via high score).

If they complete the objective without being correctly accused: bonus +100 points and the "Master Spy" badge on the results screen.

These are **non-essential** for the layer to be fun, but they create asymmetric incentives that prevent the suspect from just playing normally.

---

## 7. Integration points

| File | Change |
|---|---|
| `backend/models/MysterySession.js` | **NEW** — per §3a |
| `backend/services/mystery/clueGenerator.js` | **NEW** — clue generation engine |
| `backend/services/mystery/sessionManager.js` | **NEW** — suspect assignment, accusation arbitration |
| `backend/index.js` | Subscribe to existing events (`student:submitAnswer`, `qr:stationScan`, etc.) → push to mystery event log. Add `mystery:enable`, `mystery:purchaseClue`, `mystery:accuse`, `mystery:teacherReleaseClue`, `mystery:teacherReassignSuspect` socket handlers. |
| `teacher-app/src/pages/LiveSession.jsx` | Mount `<MysteryConsole />` when enabled |
| `teacher-app/src/components/mystery/MysteryConsole.jsx` | **NEW** — shows the suspect identity (teacher only), per-team accusation history, manual clue release, suspect reassign |
| `student-app/src/components/mystery/MysteryHud.jsx` | **NEW** — class clue board, team's purchased clues, accusation button |
| `student-app/src/components/mystery/SuspectInbox.jsx` | **NEW** — shown only to the actual suspect; contains their hidden objective |
| `student-app/src/components/mystery/AccusationDialog.jsx` | **NEW** — careful UI per §5 |
| `student-app/src/StudentApp.jsx` | Mount `<MysteryHud />` when `room.mysteryEnabled`. Conditionally mount `<SuspectInbox />` if `room.iAmSuspect` (server tells the suspect's socket, no one else). |

---

## 8. Sockets

```
teacher → server: mystery:enable                { roomCode, config }
teacher → server: mystery:teacherReleaseClue    { roomCode, type }
teacher → server: mystery:teacherReassignSuspect{ roomCode }
team    → server: mystery:purchaseClue          { roomCode, teamId, type }
team    → server: mystery:accuse                { roomCode, teamId, accusedPlayerId }

server → suspect: mystery:youAreSuspect         { themeRole, hiddenObjective }
server → all:     mystery:clueReleased          { clue }
server → team:    mystery:cluePurchased         { clue }
server → all:     mystery:accusationResult      { teamId, correct, penalty?, suspectRevealed? }
server → all:     mystery:gameEnded             { suspectPlayerId, correctAccusations }
```

The suspect socket is the most sensitive: **only the socket belonging to the suspect player ID receives `mystery:youAreSuspect`**. Other team members on the same team get NOTHING about this.

---

## 9. Difficulty calibration

| Difficulty | Suspect-clue ambiguity | Auto-release interval | Clue purchase cost | Allowed clue types |
|---|---|---|---|---|
| Easy | ≤2 others share clue | 60s | 10 coins | movement, team, timing |
| Medium | ≤3 others | 90s | 20 coins | + identity, inventory |
| Hard | ≤5 others | 120s | 40 coins | + visual (blurred), partial identity |
| Expert | ≤6 others | 150s + injected misdirection clue | 60 coins | all types + one false clue per session (v2) |

False clues (`truth: false`) are explicitly v2. They make moderation harder and risk gameplay frustration if introduced before v1 testing.

---

## 10. MVP build order

1. **Suspect assignment + suspect socket** — `mystery:enable` → pick a random player; emit `mystery:youAreSuspect` to that socket only. Show a hidden objective. No clues yet. *Verifiable: only one student sees the spy badge.*
2. **Event log subscriber** — wire existing events into `room.mysteryEventLog`. Console.log on each. *Verifiable: log fills with real events.*
3. **Movement + timing clue generator** — minimum viable clue engine. Auto-release every 90s. *Verifiable: clues appear that match real student scans.*
4. **Clue purchase UI + economy** — `<MysteryHud />` with the clue board + purchase buttons. *Verifiable: team buys a clue, balance decreases, clue appears in their panel.*
5. **Accusation flow** — `<AccusationDialog />` with all §5 safeguards. *Verifiable: right + wrong + cooldown all behave correctly.*
6. **Teacher console** — `<MysteryConsole />`, manual clue release, suspect reassign. *Verifiable: teacher can rescue / reset / observe.*
7. **Identity + team clue generators.** *Verifiable: harder modes produce these.*
8. **Hidden objective for suspect.** *Verifiable: suspect sees their goal; success awards bonus.*

Stop here for v1. v2: visual clues (selfie reveal), inventory clues (depends on Quest Mode), misinformation clues (`truth: false`), multi-suspect mode, hidden-role rotation across rounds.

---

## 11. Safety + anti-toxicity protections

Locked-in constraints — these will be enforced in code and code review:

1. **Theme labels** locked to spy/saboteur/infiltrator/smuggler/double-agent. No "criminal", "murderer", "thief", "betrayer", "rat".
2. **Wrong accusations never name the accused publicly.** §5.
3. **Suspect identity never leaks via socket to non-suspect players.** Server-side check: the suspect's identity field is omitted from any payload sent to a non-teacher socket until the game ends.
4. **No clues based on protected attributes.** The identity-clue generator's allowed property set is hardcoded: first letter of name, name length, team color. Never: ethnicity, gender, looks, friend group, behavior history, grades.
5. **Suspect can opt out.** Add a per-student "I'd rather not play the hidden role" flag in the student profile. The system reassigns if the picked player has this flag. (Spec doesn't ask for this; I think we should add it.)
6. **Teacher kill-switch.** A "Cancel mystery, reveal suspect, refund all clue costs" button. For when the room dynamic gets weird.

---

## 12. How this stacks with the other systems

- **Quest Mode coin balance** is the natural currency for clue purchases + accusation costs. Without Quest Mode, fall back to using session score (deducted on purchase).
- **Escape Room** can use a correct accusation as a key/fragment grant (`grantedBy: { mystery: "accusation-correct" }`).
- **What Am I?** can be a clue-purchase challenge: "answer this curriculum What Am I? to earn a movement clue." Same pattern as Quest Mode's non-coin acquisition.
- Suspect's `hiddenObjective` is just a `Task` in disguise — reuse the existing task runtime.

---

## 13. Open questions for you to weigh in on

1. **Default difficulty.** I'd default to **medium** for general use, **easy** for the first session in a class. Confirm?
2. **Suspect opt-out flag.** Per §11.5 — should we add this to the student profile, or default everyone in?
3. **Cluster of suspects in big classrooms.** In a 30-student class, one suspect makes deduction hard. Spec mentions "multiple hidden roles" as advanced. Should MVP support up to 2 suspects in 25+ student classes, or always exactly 1?
4. **What does the suspect see if they're caught?** I'd default to: a friendly "Caught! Better luck next time." message + a small consolation bonus (10 points) so being the suspect never feels like a net loss. Confirm?
5. **Persistence.** Do you want `MysterySession` records persisted post-game (for the teacher to review later in `/admin`)? I'd say yes — useful for tuning + class debrief.
6. **Whodunnit-only sessions vs always-on overlay.** I'm designing it as a teacher-enable per session toggle. Alternative: every taskset can be flagged "supports mystery layer" and teachers can flip it on at session launch. The latter is more discoverable; let me know which UX you prefer.

Once these are settled, I'll start commit #1 of §10.
