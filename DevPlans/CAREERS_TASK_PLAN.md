# "Careers" Task Type — Implementation Plan

**Status:** Design doc — review/edit before any code is written.
**Audience:** Grades 6–12, team-based classroom play.
**Tone constraints (locked in by spec):** non-deterministic, no prestige bias, no shaming. Always frame results as exploration, never destiny.

---

## 1. One-paragraph framing

A team-discussion task type designed to make career exploration feel like a live game, not a worksheet. Six game modes — Best Fit, Pathway Builder, Aptitude Match, Salary vs Lifestyle, Who Should Be Hired, Career Myths — each produces fresh AI-generated scenarios and prompts conversation rather than testing facts. Points reward **discussion + justification**, not "right answers." Random events (recession, AI disruption, scholarship offer) keep it replayable.

The flagship goal: students leave saying "I never thought about being a [welder / nurse / missionary / data analyst]" — and feeling that **different people are gifted differently**.

---

## 2. Where it slots in

- **Task type ID:** `"careers"` in `shared/taskTypes.js`.
- **Shell + AI generator:** `backend/controllers/sharedTasksetController.js`; this is a more complex shell than most because of the 6 modes.
- **Renderer:** `student-app/src/components/tasks/types/CareersTask.jsx`. Switches on `config.mode` to mount the right sub-mode component.
- **AI dependency:** every mode is dynamically generated per task; the AI prompt is more careful than usual because of the bias-avoidance rules.

This task slots in like any other — no overlay layer needed.

---

## 3. Data shape

```js
{
  taskId: "careers-1",
  taskType: "careers",
  title: "Best Fit: Welder",
  prompt: "Read the role. Discuss as a team. Who's the best fit, and why?",
  timeMinutes: 8,
  config: {
    mode: "best-fit",
    // | "pathway-builder" | "aptitude-match" | "salary-vs-lifestyle"
    // | "who-should-be-hired" | "career-myths"

    gradeBand: "6-8" | "9-12",
    careerOptions: { /* shape varies by mode — see §4 */ },

    discussion: {
      minDiscussionSeconds: 60,   // can't submit before this
      requireJustification: true, // a free-text "why?" field is mandatory
      maxJustificationChars: 280
    },

    scoring: {
      participation: 1,           // attempt
      justification: 3,           // wrote a justification (not just clicked)
      strong_justification: 5,    // AI-scored justification quality
      consensus_bonus: 2,         // team picked unanimously (where applicable)
      myth_correct: 5,            // career-myths mode only
      pathway_tradeoff: 2,        // pathway-builder: identified a real tradeoff
    },

    randomEvent: null,            // OR { type, message, effect } — see §6
  }
}
```

---

## 4. The six modes

### 4a. Best Fit

**Generated:** one career + role description + 5-7 trait/skill bullets.
**Student UI:** career card, then "Which teammate fits best?" — taps a teammate name. Required free-text "why?" field.
**Scoring:** participation + justification + (AI-scored) strong justification.
**Anti-shame rule:** UI **never** shows "X students picked you" or "X students didn't pick you." Each pick is private to the picker; teacher dashboard aggregates anonymously.

### 4b. Pathway Builder

**Generated:** one target career + 3–5 realistic pathways (apprenticeship, college, university, military, certification, entrepreneurship, self-taught, internship, missions, etc.).
Each pathway has: years, estimated cost range (broad), flexibility score (1–5), employment likelihood (low/med/high), lifestyle notes.
**Student UI:** comparison table; tap a pathway to "explore" it; team must collaboratively pick one as their recommendation + write why.
**Scoring:** participation + justification + `pathway_tradeoff` bonus if their justification mentions ≥2 dimensions (e.g., cost AND flexibility).
**Bias guard:** the costs/years are **ranges**, never precise numbers. Salary ranges are wide (e.g., "$40k–$110k"). Never imply one pathway is "better."

### 4c. Aptitude Match

**Generated:** 6–10 quick prompts ("Do you enjoy solving problems under pressure?", "Would you rather work outdoors or indoors?").
**Student UI:** each teammate answers on their own device (or pass-around if single-device team). After all answers in: AI generates 2–3 "you might enjoy…" career suggestions per person.
**Critical:** results phrased as **non-deterministic** — "You might enjoy", "Some people with similar interests have found", never "You will be" or "You should be."
**Scoring:** participation. No "right answer."
**v2:** the team's combined results can suggest "teams like yours have included" career mixes.

### 4d. Salary vs Lifestyle

**Generated:** one dilemma — "Job A: $90k, big city, 60-hr weeks. Job B: $45k, rural, 35-hr weeks."
**Student UI:** the team debates; each teammate marks their preference; the team submits a consensus + justification.
**Scoring:** participation + justification + consensus bonus.
**Bias guard:** dilemmas are **balanced** — no "obvious right answer." The AI prompt explicitly says: "the dilemma must have a defensible case on both sides; neither side is morally superior."

### 4e. Who Should Be Hired

**Generated:** 3–4 fictional candidates for a role with strengths, weaknesses, experience, personality traits, resume snippets.
**Student UI:** team reviews candidates → picks one for hire + writes why. Optionally: pick separately for "lead", "team fit", "growth potential".
**Scoring:** participation + justification + nuance bonus if the justification names multiple traits.
**Anti-stereotype rule:** AI prompt explicitly bans candidates that pattern-match to a single stereotype (no "the messy creative", no "the rigid engineer"). Each candidate must have at least one trait that cuts against any easy archetype.

### 4f. Career Myths

**Generated:** one career students often misunderstand (trades, farming, nursing, teaching, ministry, software, military, entrepreneurship). 4 multiple-choice questions about income, education, stress, demand.
**Student UI:** team guesses; reveals real range; brief explainer.
**Scoring:** participation + per-correct bonus.
**Education guard:** the "real" data is presented as a range, with a source attribution where reasonable ("based on US BLS 2024 estimates"). Never present a single dollar number as canonical.

---

## 5. Generated content quality bar

The AI prompt is the hardest part of this task type. It must:

1. **Rotate through ALL career categories.** A career-pack rotation tracks recent generations; weight away from over-represented categories.
   - Categories: trades, healthcare, education, arts/creative, technical/engineering, business/entrepreneurship, ministry/service, caregiving, hospitality/food, public safety, agriculture/outdoors, science/research, military, government, manual labor, transportation, sales, social work, legal, finance.
   - Default weighting: roughly equal. Bias correction: if 3 recent tasks have been "white-collar" categories, force the next pick from trades/agriculture/caregiving/ministry.
2. **Use neutral, non-prestige framing.** No "elite job" or "lucrative career." Yes "skilled trade", "essential role", "growing field."
3. **Avoid identity-coding.** No gendered defaults. AI candidates use names from a diverse pool; no name should pattern-match the role's stereotype.
4. **Be honest about challenges.** Each career mentions both strengths *and* tradeoffs. Never sell a career.
5. **Be hopeful but realistic.** Tone: "many people find meaning in this work, and the road can be challenging."

### 5a. Sample prompt skeleton

```
You are generating a "Careers" task for grade band {gradeBand}, mode {mode}.

CAREER POOL (pick ONE):
{careerPool}      — rotated to ensure category diversity

REQUIREMENTS:
- Use neutral framing. Never imply this career is "better" than others.
- Mention realistic challenges AND rewards.
- Salary information must be a range, not a single number.
- For Grades 6-8: simpler language, lighter tone.
- For Grades 9-12: nuanced tradeoffs welcome.
- Never use gendered defaults; never use a name that pattern-matches the role stereotype.

Output JSON: { [mode-specific shape] }
```

### 5b. Validator

`validateCareersTask(config, inputs)`:
- All required mode-specific fields present.
- No prestige language detected (regex against a banlist: "elite", "high-class", "low-class", "menial", "real career", "real job", "just a [career]"…).
- Salary fields use ranges, not point estimates.
- Candidate names pass a basic diversity check (no all-male or all-female fictional candidate sets in `who-should-be-hired`).

Single repair attempt on failure; fall back to a deterministic safe shell.

---

## 6. Random events (replayability)

A small chance per task (~20%) of injecting a randomized **event** that perturbs the discussion:

| Event | Effect on mode |
|---|---|
| **Scholarship Unlocked** | Pathway Builder: one pathway's cost drops to 0 mid-game. |
| **Recession** | Salary vs Lifestyle: high-pay job loses 30% pay; team must re-debate. |
| **AI Disruption** | Career Myths: a "this role is being reshaped by AI in [specific way]" callout. |
| **Industry Boom** | Pathway Builder: one pathway's employment-likelihood jumps to high. |
| **Surprise Mentorship** | Best Fit: "a mentor in this field is available — would the team's pick still hold?" |
| **Relocation Required** | Salary vs Lifestyle: add "you'd have to move to a new city." |

Events appear as a tasteful banner (`<EventBanner />`) with a short message + the rule change. Teams discuss again and can change their answer. Bonus: 2 points to teams that adjust thoughtfully (AI-scored justification).

---

## 7. Anti-toxicity protections

This task is **the most socially sensitive** in the set because it involves peers literally rating each other. Locked-in rules:

1. **Best Fit picks are PRIVATE.** No teammate sees who picked whom. Teacher dashboard aggregates only.
2. **No one is ever "least likely to succeed."** No mode includes a "worst fit" prompt.
3. **Bullying-pattern detection.** If one teammate's name shows up 0 times across multiple Best Fit picks in a session, the teacher dashboard gently flags it ("consider checking in"). Not punitive, just visible to the teacher.
4. **Justification banlist.** Free-text justifications are checked against a banlist of insults/slurs/identity-targeted language; flagged content is hidden from peers + visible only to the teacher.
5. **Opt-out.** A student can flag "I'd rather not be picked in Best Fit" in their profile; their name is silently dropped from pick options for that session.
6. **Diverse pool prompt.** AI prompt explicitly rotates through trades/service/creative as much as STEM/business to fight prestige bias.

---

## 8. Backend touchpoints

| File | Change |
|---|---|
| `shared/taskTypes.js` | `CAREERS = "careers"` + `TASK_TYPE_META` entry |
| `backend/controllers/sharedTasksetController.js` | `TASK_SHELLS["careers"]` + validation branch |
| `backend/controllers/sanitizeTaskShape.js` | Promote mode-specific fields per mode |
| `backend/controllers/careersGenerator.js` | **NEW** — AI prompts (one per mode) + validator + repair |
| `backend/services/careersCategoryRotator.js` | **NEW** — tracks recent categories per (teacher, class) and adjusts pool weights |
| `backend/services/profanityFilter.js` | **NEW** (or reuse existing) — for justification text |
| `backend/index.js` | New events: `careers:submitPick`, `careers:submitJustification`, `careers:triggerEvent` (teacher) |

## 9. Frontend touchpoints

| File | Change |
|---|---|
| `student-app/src/components/tasks/types/CareersTask.jsx` | **NEW** — switches on `config.mode` |
| `student-app/src/components/careers/BestFitMode.jsx` | **NEW** |
| `student-app/src/components/careers/PathwayBuilderMode.jsx` | **NEW** |
| `student-app/src/components/careers/AptitudeMatchMode.jsx` | **NEW** |
| `student-app/src/components/careers/SalaryLifestyleMode.jsx` | **NEW** |
| `student-app/src/components/careers/HiringMode.jsx` | **NEW** |
| `student-app/src/components/careers/MythsMode.jsx` | **NEW** |
| `student-app/src/components/careers/JustificationBox.jsx` | **NEW** — shared, used by all modes |
| `student-app/src/components/careers/EventBanner.jsx` | **NEW** — random event banner |
| `student-app/src/components/tasks/TaskRunner.jsx` | `case "careers"` |
| `student-app/src/DemoMode.jsx` | One sample per mode |
| `teacher-app/src/pages/LiveSession.jsx` | When current task is `careers`: per-team status, manual trigger event, picks-aggregate panel (anonymous) |

---

## 10. Sockets

```
client → server:  careers:submitPick           { roomCode, teamId, playerId, pick, justification }
client → server:  careers:submitJustification  { roomCode, teamId, playerId, text }
client → server:  careers:teamSubmit           { roomCode, teamId, decision, justification }
teacher → server: careers:triggerEvent         { roomCode, eventType }
server → all:     careers:eventTriggered       { eventType, message, ruleChange }
server → teacher: careers:picksAggregate       (anonymous tally)
```

The aggregate going to the teacher is anonymized: "3 picks across team for X" — no who-picked-whom mapping.

---

## 11. AI scoring of justifications

For modes that reward "strong justification" (Best Fit, Pathway Builder, Salary vs Lifestyle, Hiring):

A small Haiku-class model call evaluates the text:
- **Length / specificity** — penalize "because" alone; reward concrete reasoning.
- **Multiple dimensions** — bonus if it mentions ≥2 traits/tradeoffs.
- **Empathy** — for Best Fit, reward justifications that name a teammate's strength (e.g., "Maya stays calm under stress") rather than a stereotype.
- **No bias terms** — penalize identity-targeted language (caught earlier by the profanity filter; this is a finer-grained check).

Score: 1 (basic), 2 (good), 3 (excellent). Map: 1→`participation`, 2→`+ justification`, 3→`+ strong_justification` bonus.

Cost: ~$0.0001 per justification — cheap.

---

## 12. MVP build order

1. **Task type plumbing** — types, shell, sanitize, validate. *Verifiable: hand-built careers task saves and loads.*
2. **Best Fit mode + private picks + justification box.** First mode end-to-end. *Verifiable: team plays Best Fit; picks are private; justifications are saved.*
3. **AI generator (Best Fit only) + category rotator.** *Verifiable: 10 sequential generations cover ≥6 distinct career categories.*
4. **AI justification scorer.** *Verifiable: low- and high-quality justifications get appropriately different scores.*
5. **Pathway Builder mode + Salary vs Lifestyle mode.** *Verifiable: both end-to-end.*
6. **Career Myths mode** (simplest — just MC with reveal). *Verifiable: end-to-end.*
7. **Who Should Be Hired mode.** *Verifiable: end-to-end.*
8. **Aptitude Match mode** (most complex — per-student responses). *Verifiable: each teammate answers individually, AI synthesizes per-person.*
9. **Random events.** *Verifiable: ~20% of tasks trigger an event; teams can revise.*
10. **Teacher LiveSession panel** + anti-toxicity flags. *Verifiable: teacher sees aggregate, gets nudge if a student isn't being picked.*
11. **Demo mode** — one sample per mode in DemoMode.jsx. *Verifiable: testers can practice all modes without joining a session.*

Stop here for v1. v2: opt-out flag in student profile, deeper AI personality match in Aptitude mode, parent-shareable career exploration summary.

---

## 13. Team balancing

Spec asks for team balancing. The lever we have: the AI prompt sees `team.players[]` with anonymized profile data (strengths/interests if collected). The prompt can encourage scenarios that highlight different teammates' strengths over time — e.g., if a team has only had "stress tolerance"-oriented Best Fit prompts, the next one biases toward "creativity" or "empathy."

Concretely: track per-team "trait spotlight history" and rotate.

---

## 14. Edge cases

1. **Single-team room.** No issue — Best Fit etc. all work intra-team.
2. **Team of 1.** Best Fit becomes self-reflection; "Which one of these traits matches you?" — fallback wording.
3. **Pass-around device.** Aptitude Match supports a "Player 1 answers, hand the phone over" flow with name prompts.
4. **Teacher wants to disable a mode** (e.g., no Salary debates for Grade 6). Add per-task generation: `excludeModes: ["salary-vs-lifestyle"]`.
5. **Student profile data is missing.** Aptitude Match defaults to anonymous "Player 1, 2, 3" labeling.

---

## 15. How this stacks with the other systems

- **Quest Mode**: Careers tasks can award coins like any other task. No special handling.
- **Escape Room**: Career-Myths correct answers could be lock keys (curriculum integration).
- **Whodunnit**: Player picks in Best Fit could indirectly serve as movement-clues ("who picked whom" pattern). Skip — too socially fraught; this should stay isolated.
- **Hole in One**: nothing — orthogonal.

The careers task is **deliberately less networked** than the other systems. It works best as a quiet discussion-driven sub-experience within a normal taskset.

---

## 16. Open questions for you to weigh in on

1. **Default mode mix per taskset.** If a teacher generates a "Careers Day" taskset, what's the default mode distribution? I'd suggest **2 Best Fit, 1 Pathway, 1 Salary, 1 Hiring, 1 Myths, 1 Aptitude** for a 7-task set (≈ 35 minutes). Confirm or tune.
2. **AI justification scoring threshold.** I picked 1/2/3 mapped to participation/justification/strong_justification. Want to be stricter (require longer texts) or looser (give the bonus more freely)?
3. **Opt-out flag location.** I'd put it in the student profile (one-time setting per student). Alternative: per-session opt-in at join time. Profile is less friction.
4. **Career categories rotation strictness.** I said "if 3 recent are white-collar, force next to be trades/service/creative." Want stricter (every 2 must rotate categories) or looser (5 in a row OK)?
5. **Display of salary ranges.** Should we attribute ranges to a source (e.g., "BLS 2024") inline, in a footnote, or not at all? I'd default to **footnote on hover** — credible without being preachy.
6. **Career Myths data accuracy.** This mode is the highest factual-accuracy bar. Should I require an explicit citation field for every myth-revelation, validated against a known data source list? More robust but slower to generate.

Once these are settled, I'll start commit #1 of §12.
