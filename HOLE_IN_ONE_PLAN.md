# "Hole in One" Task Type — Implementation Plan

**Status:** Design doc — review/edit before any code is written.
**Type:** New task type (`taskType: "hole-in-one"`), not an overlay. Plays standalone but composes beautifully with Quest Mode (rails/balls are quest resources) and Escape Room (sinking the ball = key/fragment grant).

---

## 1. One-paragraph framing

A team's device is the board. Tilt the phone to roll a ball into a hole. The default course is **intentionally too hard** — students need to answer curriculum questions to **earn guide rails, bumpers, and balls**, which they place on the board before each tilt attempt. A rotating "tilter" (one student per turn) actually does the tilting. **The curriculum funds the physics.**

---

## 2. Where it slots in

- **Task type ID:** `"hole-in-one"` in `shared/taskTypes.js`.
- **Shell + AI generator:** `backend/controllers/sharedTasksetController.js → TASK_SHELLS` + validation branch.
- **Renderer:** `student-app/src/components/tasks/types/HoleInOneTask.jsx` (new). Add `case "hole-in-one"` to `TaskRunner.jsx`.
- **Physics:** simple custom 2D physics loop (60fps `requestAnimationFrame`), no external library needed for MVP. Matter.js can be a v2 swap-in if jitter becomes a problem.
- **Tilt input:** `DeviceOrientationEvent` (`event.beta` = forward/back tilt, `event.gamma` = left/right). iOS requires `DeviceOrientationEvent.requestPermission()`. Fallback: WASD/arrow keys + on-screen joystick.

---

## 3. Data shape

```js
{
  taskId: "hio-1",
  taskType: "hole-in-one",
  title: "Roll the Cannonball Home",
  prompt: "Guide the cannonball into the fort. Earn rails by answering questions.",
  timeMinutes: 10,
  config: {
    mode: "team-coop",   // team-coop | inter-team-race | class-boss | survival | escape | duel

    board: {
      theme: "fort-defense",                   // narrative skin
      width: 12,                                // grid units
      height: 18,
      gridSize: 20,                             // pixels per grid unit
      startPosition: { x: 1, y: 1 },
      holePosition:  { x: 10, y: 16, radius: 1 },
      obstacles: [
        { type: "wall", x: 4, y: 5, w: 4, h: 1 },
        { type: "gap",  x: 0, y: 10, w: 5, h: 2 },     // ball falls off
        { type: "trap", x: 8, y: 8, behavior: "reset" }
      ]
    },

    resources: {
      startingCoins: 0,
      startingBalls: 1,                         // free first ball
      startingRails: { straight: 2, curved: 0 },
      startingBumpers: 0,
      startingPowerups: []
    },

    economy: {
      ballCost: 2,
      straightRailCost: 3,
      curvedRailCost: 5,
      bumperCost: 4,
      slowZoneCost: 6,
      checkpointCost: 8,
      extraAttemptCost: 2,
      powerupCost: 10
    },

    // Curriculum questions players can answer for resources
    questionBank: [
      { id: "q1", prompt: "What year was Confederation?", correctAnswer: "1867", reward: { coins: 5 } },
      { id: "q2", prompt: "What does 'Responsible Government' mean?", reward: { rails: { straight: 1 } }, type: "short-answer" },
      // ... 8-15 questions per task
    ],

    tilter: {
      mode: "rotation" | "free-choice" | "random" | "teacher-selected",
      currentPlayerId: null,
      history: []
    },

    scoring: {
      playPoints: 1,       // for attempting
      successPoints: 10,   // for sinking
      speedBonus: { enabled: true, fastestSeconds: 5, maxBonus: 5 },
      noCheckpointBonus: 3,
      fewerRailsBonus: { perRailSavedUnder: 5, points: 2 }
    },

    physics: {
      gravity: 0.4,
      friction: 0.97,
      bounciness: 0.6,
      ballRadius: 0.5
    },

    controls: {
      tiltEnabled: true,
      fallbackControls: true,
      sensitivity: 1.0,
      smoothing: 0.85,
      requireiOSPermission: true
    }
  }
}
```

---

## 4. Game loop — three phases

### Phase A: **Earn** (curriculum)

The team works through `config.questionBank`. Each correct answer credits `reward.coins` or directly grants `reward.rails`. Wrong answers earn nothing (default) or partial coins (configurable).

A simple `<EarnPhase />` view shows the question list + their resource panel (current coins, rails, bumpers, balls).

### Phase B: **Build** (planning)

Team taps "Start Building" → switches to the board view with their inventory in a side dock. Drag-and-drop rails onto the grid:
- Tap-to-rotate (90° steps).
- Snap to grid cells.
- Collide with each other (can't overlap).
- Can be removed (refund? configurable — default: no refund).
- Bumpers, slow zones, checkpoints are draggable too.

UI affordance: a **ghost** preview of where the rail will land while dragging.

### Phase C: **Tilt** (execution)

1. Modal prompts: "Who's the tilter?"
   - Mode `rotation`: the next player who hasn't tilted yet is pre-selected; team confirms.
   - Mode `free-choice`: team picks from list.
   - Mode `random`: server picks; team must hand the device to that student.
   - Mode `teacher-selected`: teacher picks via LiveSession.
2. iOS permission prompt if needed (`DeviceOrientationEvent.requestPermission()`).
3. 3-2-1 countdown.
4. Tilt phase: physics loop runs; ball rolls based on tilt vector × gravity.
5. End: ball-in-hole → success; ball falls off → fail. Team gets +1 play / +10 success.
6. If failed and `balls > 0`: option to retry (deducts a ball). Else back to Phase A.

Loop until ball sinks OR time runs out.

---

## 5. Physics — keep it simple

```js
// Inside requestAnimationFrame loop
function step() {
  // 1. Apply tilt as constant acceleration
  ball.vx += tilt.gamma * config.physics.gravity * 0.01;
  ball.vy += tilt.beta  * config.physics.gravity * 0.01;

  // 2. Friction
  ball.vx *= config.physics.friction;
  ball.vy *= config.physics.friction;

  // 3. Update position
  ball.x += ball.vx;
  ball.y += ball.vy;

  // 4. Collision pass — AABB vs rails/walls/bumpers; circle vs hole/gap
  for (const obj of board.objects) {
    if (collides(ball, obj)) resolveCollision(ball, obj);
  }

  // 5. Termination check
  if (inHole(ball, board.holePosition)) onSuccess();
  else if (inGap(ball, board.obstacles))   onFail();
  else requestAnimationFrame(step);
}
```

Smoothing: keep a 6-tick rolling average of tilt input to dampen jitter.

Predictability check: on mobile, sample the device's accelerometer at 30Hz minimum. If ≤20Hz, warn the user; sub-20Hz makes the game frustrating.

### 5a. Fallback (desktop / no tilt)

- Arrow keys / WASD: adds a fixed velocity in the pressed direction each frame.
- On-screen joystick: virtual analog stick at bottom-center. Drag to set the tilt vector.

Same `tilt` object feeds the physics loop regardless of source.

---

## 6. Modes

| Mode | Scope | MVP? |
|---|---|---|
| **Team Cooperative** | One team, one board, one shared run. | ✅ |
| **Inter-Team Race** | All teams play in parallel; first sink wins extra points. | ✅ |
| **Class Boss** | One giant shared board; all teams contribute rails. Per-team coordinated placement, one final tilt. | ⏸ v2 |
| **Survival** | Limited balls, must keep earning. | ✅ (config flip) |
| **Escape Room** | Sinking the ball grants a key/fragment in the active escape room. | ⏸ v2 (depends on Escape Room layer) |
| **Duel** | One tilter per team, same board, race to sink. | ⏸ v2 |

MVP: Team Coop + Inter-Team Race + Survival (just a config). v2: Class Boss, Escape integration, Duel.

---

## 7. Tilter rotation — fairness mechanics

Spec emphasizes that one student shouldn't dominate. We enforce this gently:

- Mode `rotation` is the default. Server tracks `tilter.history`; next tilter is the player who hasn't tilted in the most rounds (FIFO).
- "Skip tilter" option: 1 per game, team consensus required (button asks "All teammates tap to confirm skip" with a 3-tap requirement on the shared device).
- Teacher override always available via LiveSession.
- Per-task bonus: `+5 if every team member tilted at least once by the end`.

This last bonus is the strongest fairness lever — it directly rewards rotation without naming/shaming anyone.

---

## 8. AI generation

When the teacher's lesson topic is provided, the AI generates:

1. A theme skin (`fort-defense`, `electron-through-circuit`, `cargo-cart-through-mountains`, `biblical-journey`, etc.).
2. A board layout (start, hole, 2–4 obstacles, 0–2 gaps) calibrated to the requested difficulty.
3. A `questionBank` of 8–15 curriculum questions matched to grade level + subject.
4. A theme-appropriate prompt + success message.

Prompt skeleton:

```
Generate a Hole-in-One task for {gradeLevel} {subject} on the topic: {topic}.
Theme: pick from spy/cannonball/electron/cargo/biblical/etc that best fits the topic.

Output JSON for `config` (see schema).

RULES:
- The board MUST be difficult without rails (path requires at least 2 rails to be solvable).
- The questionBank MUST have 8-15 questions, all on the lesson topic.
- Question rewards should balance: ~70% coin rewards, ~30% direct rail/ball rewards.
- Default to MEDIUM difficulty unless specified.
```

Validation: board solvability check (A* path with rails, see §10).

---

## 9. Backend touchpoints

| File | Change |
|---|---|
| `shared/taskTypes.js` | `HOLE_IN_ONE = "hole-in-one"` + `TASK_TYPE_META` entry (intraTeamEnabled: true, interTeamEnabled: true, movement: false) |
| `backend/controllers/sharedTasksetController.js` | `TASK_SHELLS["hole-in-one"]` + `validateAiTask` branch |
| `backend/controllers/sanitizeTaskShape.js` | Promote board/economy/scoring/tilter fields into `config` |
| `backend/controllers/holeInOneGenerator.js` | **NEW** — AI prompt + board generator + solvability validator |
| `backend/services/holeInOneSolvability.js` | **NEW** — A* path checker to ensure boards are solvable with the rails being awarded |
| `backend/index.js` | Sockets: `hio:purchaseResource`, `hio:placeRail`, `hio:startTilt`, `hio:tiltResult`, `hio:teacherSelectTilter` |

## 10. Frontend touchpoints

| File | Change |
|---|---|
| `student-app/src/components/tasks/types/HoleInOneTask.jsx` | **NEW** — top-level component (mounts EarnPhase, BuildPhase, TiltPhase) |
| `student-app/src/components/holeinone/EarnPhase.jsx` | **NEW** — question runner |
| `student-app/src/components/holeinone/BuildPhase.jsx` | **NEW** — drag-and-drop board editor |
| `student-app/src/components/holeinone/TiltPhase.jsx` | **NEW** — physics + tilt input + countdown |
| `student-app/src/components/holeinone/InventoryDock.jsx` | **NEW** — shared dock used by Build + Tilt phases |
| `student-app/src/components/holeinone/TilterPicker.jsx` | **NEW** — "who's tilting?" modal |
| `student-app/src/hooks/useDeviceTilt.js` | **NEW** — wraps `DeviceOrientationEvent` + fallback joystick + smoothing |
| `student-app/src/utils/holeInOnePhysics.js` | **NEW** — physics step + collision math |
| `student-app/src/components/tasks/TaskRunner.jsx` | `case "hole-in-one"` |
| `student-app/src/DemoMode.jsx` | One sample task |
| `teacher-app/src/pages/LiveSession.jsx` | When current task is hole-in-one: live per-team progress + manual tilter override |

---

## 11. Sockets

```
client → server:  hio:purchaseResource   { roomCode, teamId, taskId, resource, qty }
client → server:  hio:placeRail          { roomCode, teamId, taskId, rail, gridPos, rotation }
client → server:  hio:startTilt          { roomCode, teamId, taskId, tilterId }
client → server:  hio:tiltResult         { roomCode, teamId, taskId, success, ballsRemaining, elapsedMs }
client → server:  hio:answerQuestion     { roomCode, teamId, taskId, questionId, answer }

server → client:  hio:resourceGranted    { coins, rails, ... }
server → client:  hio:tilterSelected     { playerId, playerName }
server → teacher: hio:teamUpdated        (live progress for LiveSession)
```

Validation is server-side for `hio:purchaseResource` (does the team have enough coins?) and `hio:answerQuestion` (is the answer correct? — fuzzy match for short-answer, exact for MC).

Tilt physics runs **client-side** for latency. The server only sees the final result (`hio:tiltResult`). For cheating concerns: tilt is fundamentally a team performance task, not a single-player score — cheating gains a team 9 points; the upside isn't worth defending against in MVP.

---

## 12. MVP build order

1. **Task type plumbing** — taskTypes.js, shell, sanitize. Round-trip a hand-crafted task. *Verifiable: hand-built hole-in-one task saves and loads.*
2. **`useDeviceTilt` hook + fallback joystick** — standalone, with a debug viewer. *Verifiable: a numeric tilt vector responds to phone tilt and keyboard.*
3. **TiltPhase MVP** — render a board, drop a ball, apply tilt → physics → sink/fall. No questions, no rails yet. *Verifiable: ball moves predictably; sinking + falling both detected.*
4. **InventoryDock + BuildPhase** — drag rails onto board, collide check, save layout. *Verifiable: build a course, persist its layout, replay.*
5. **EarnPhase + question rewards** — answer questions, gain coins/rails, can buy more. *Verifiable: end-to-end loop: earn → build → tilt → score → earn more.*
6. **TilterPicker + rotation logic** — rotation, free-choice, random. *Verifiable: every teammate is forced to tilt at least once over a session.*
7. **AI board generator + solvability validator** — generate a course from a lesson topic; verify it's solvable with the rails being offered. *Verifiable: 90% of AI-generated boards pass the solvability check.*
8. **Teacher LiveSession integration** — per-team status, manual tilter override. *Verifiable: teacher can intervene mid-game.*
9. **Demo mode entry.** *Verifiable: testers play without joining a session.*

Stop here for v1. v2: Class Boss mode, Duel mode, Escape Room integration, powerups (slow-mo, gravity freeze, magnetic pull).

---

## 13. Edge cases + gotchas

1. **iOS 13+ tilt permission gate.** Requires a user-gesture-triggered `DeviceOrientationEvent.requestPermission()`. Build a "Tap to enable tilt" button that the tilter must press in the TilterPicker modal. Cache the permission state per session.
2. **Browsers without DeviceOrientation.** Detect; show only fallback joystick.
3. **Landscape vs portrait.** Default orientation: portrait. Lock the board's coordinate system to portrait so tilting the device while playing doesn't disorient. Show a "rotate your phone to portrait" toast if landscape detected.
4. **Slow devices (Chromebooks).** Physics @ 60fps may chug. Adaptive timestep: target 60fps, fall back to 30fps if frame time > 25ms.
5. **Ball escapes the board via numerical error.** Hard wall clamp: any ball with `x < 0` or `x > board.width` is reset to nearest valid position with velocity reflected.
6. **Two tilters at once.** Lock: when a tilter is mid-roll, all other devices on the team show "Watching — tilter is rolling" and can't dispatch tilt input.

---

## 14. How this stacks with the other systems

- **Quest Mode**: hole-in-one's `economy` IS the Quest Mode coin economy when both are active. Replace the local coin field with reads from `TeamQuestState.coins`.
- **Escape Room**: completing a hole-in-one task is a valid `keys[].grantedBy`. Sinking the ball grants the key.
- **What Am I?**: a clue gateway — instead of answering a question for a rail, answer a What Am I? challenge.
- **Whodunnit**: the tilter's identity is logged → could become a clue source (movement-style clue: "the suspect was the tilter at 14:23").

---

## 15. Open questions for you to weigh in on

1. **Default tilter mode.** I'd default to **rotation** for the fairness reasons in §7. Confirm?
2. **Refund policy on removing a placed rail.** Default: **no refund** (forces deliberation). Alternative: 50% refund within 30 seconds.
3. **Ball physics tunables.** I set `gravity: 0.4, friction: 0.97, bounciness: 0.6` from gut feel. These will need iteration during testing. Want me to expose them as teacher-tunable, or hardcode for now?
4. **Question diversity in questionBank.** I said 8–15 questions. Too few = grinds; too many = bloats payload. Sweet spot? I'd default to **10**.
5. **Time limit per task.** Default `timeMinutes: 10`. Some teams will need 20; others 5. Should this auto-extend if a team is mid-Build, or hard-stop?
6. **Cheating posture.** Tilt physics is client-side — easy to fake. I'm comfortable with that for MVP (low stakes, team mode). Confirm you're OK with deferring server-side validation to v2?

Once these are settled, I'll start commit #1 of §12.
