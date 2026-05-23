# Truth or Dare — Design Doc

A complete production-ready design for the **Truth or Dare** task system inside
Curriculate. Dual-form: a standalone task type (`taskType: "truth-or-dare"`) and
a taskset overlay that can inject Truth-or-Dare moments randomly during play.

Companion doc to: QUEST_MODE_PLAN.md, WHODUNNIT_PLAN.md, ESCAPE_ROOM_PLAN.md,
CURRENT_EVENTS_PLAN.md, CAREERS_TASK_PLAN.md, HOLE_IN_ONE_PLAN.md,
WHAT_AM_I_TASK_PLAN.md, LEVEL_UP_PLAN.md.

---

## 1. Vision Overview

Truth or Dare is the **classroom energy multiplier**. Once or twice during a
session — or as a focused 10-minute task — the room stops, the spotlight
randomizer spins, a student or team is chosen, and the AI delivers a curated
challenge: a content-aware Truth question or a school-safe, embodied Dare.

The system exists at the intersection of:

- **Curriculum reinforcement** (every Truth question reaches into the lesson
  topic; every Dare embodies a concept)
- **Oral communication** practice in a low-stakes, high-fun frame
- **Improv / creative thinking** — students argue, persuade, embody, mime
- **Movement breaks** — Dares optionally get bodies up and moving
- **Social bonding** — the spotlight rotates, audience laughs together, no
  one is humiliated
- **Strategic gameplay** — Pass tokens, Double Dare risk/reward, Steal
  mechanics, audience voting bonuses
- **Classroom energy management** — the teacher can dial intensity up or
  down in real time

Pedagogically, Truth or Dare is the most powerful single tool in the
Curriculate catalogue for **engaging the half of the class that doesn't
shine on quizzes**. A shy student who can mime "the water cycle" with
their hands gets the same applause as the kid who can recite the definition.

The headline emotional design goal: **every student leaves at least one
session this year saying "remember when Maria had to convince us she was
Cleopatra?"** The system creates **memorable classroom moments**.

### Non-goals

- Romantic / personal-disclosure questions of any kind
- "Eat this", "touch that", "race to the door" physical dares
- Anything that could be screenshot-quoted as bullying
- Anything that requires individual property (phones, food, hats, etc.)
- Anything where the answer can be "I don't know" with no fallback

---

## 2. Gameplay Architecture

### Two surfaces

1. **Standalone task** — `taskType: "truth-or-dare"`. Teachers add this
   to a taskset (or it appears in the AI-generated mix). A standalone
   instance runs for ~6–10 minutes, ~5–8 rounds, with a coherent topic.

2. **Overlay injection** — `tasksetSettings.truthOrDareEnabled: true`.
   During any regular taskset, the engine probabilistically injects a
   Truth-or-Dare interruption. Frequency: configurable (default ~every
   8–12 minutes of session time, max 3 per session). Triggered by:
   - Time-since-last-injection threshold
   - Engagement dip (silent room, slow submissions)
   - Score parity moments (good time for a comeback mechanic)
   - Teacher manual trigger ("Inject Truth or Dare now")

### Round flow (single round)

```
┌─────────────────────────────────────────────────────────┐
│  STAGE 1: SPOTLIGHT RANDOMIZATION (3.5s)                │
│  - All player avatars cycle on screen in a slot-machine │
│    blur; drum-roll sound; suspense music                │
│  - Final stop animation with confetti pop               │
│  - Result: chosen player/team highlighted               │
├─────────────────────────────────────────────────────────┤
│  STAGE 2: CHOICE (10s countdown)                        │
│  - Selected player sees giant TRUTH | DARE buttons       │
│  - Optional: DOUBLE DARE (red) and PASS (grey)          │
│  - Other teams see "Maria is choosing..." with timer    │
│  - If countdown expires → random 50/50 truth/dare       │
├─────────────────────────────────────────────────────────┤
│  STAGE 3: CHALLENGE REVEAL (5s slide-in)                │
│  - AI-generated challenge text dramatic-reveals         │
│  - For DARE: visual cue (icon, mime/move emoji)         │
│  - For TRUTH: subject tag + difficulty stars            │
│  - Per-challenge time limit (15s–90s, AI-suggested)     │
├─────────────────────────────────────────────────────────┤
│  STAGE 4: PERFORMANCE (variable, 15–90s)                │
│  - Player executes; visible timer counts down           │
│  - Audience views with reaction emoji panel             │
│  - "Steal" button enabled for other teams (60% cost)    │
│  - Teacher can override (skip, force complete, redo)    │
├─────────────────────────────────────────────────────────┤
│  STAGE 5: JUDGMENT (8s)                                 │
│  - Class votes via emoji reactions: 🔥 🙂 🤔            │
│  - OR teacher single-tap: ✓ Pass | ↻ Try Again | ✗     │
│  - For Truth: AI-aided correctness check (if objective) │
│  - For Dare: pure audience/teacher judgment             │
├─────────────────────────────────────────────────────────┤
│  STAGE 6: REWARD + COOLDOWN (4s)                        │
│  - Points + coins + occasional special item             │
│  - "Maria can't be selected again for 3 rounds"         │
│  - Continue button → next round (or back to taskset)    │
└─────────────────────────────────────────────────────────┘
```

### Random selection — fair, suspenseful, cooldown-aware

The randomizer is **weighted**, not pure random:

- **Cooldown weight: 0** for players selected in the last 2 rounds
- **Engagement balance**: students who haven't participated in this session
  get a +2× weight bump
- **Score-parity bonus**: trailing teams get a small +1.3× weight
- **Teacher override**: teacher can tap any avatar to lock in a selection
- **Quiet-class detection**: if classroom mic samples show 30+ seconds of
  silence, weight shifts toward known-extroverted students (from prior
  audience reactions) to break the ice

The spotlight animation is **always at least 2.5s** even when the result is
pre-determined — suspense is the product.

### Suspense mechanics

- **Drumroll**: pre-randomized 2.5s of suspense audio (`/sounds/drumroll.mp3`)
- **Slot-machine UI**: avatars blur-cycle behind a "viewfinder" frame
- **Heartbeat haptic**: on mobile devices, gentle vibration patterns
- **Audience anticipation pulse**: subtle background pulse animation
- **Teacher tease**: optional "Looking for someone who…" lead-in line
  generated by AI (e.g. "Looking for someone brave enough to mime
  photosynthesis…")

### Voting mechanics

Three judgment paths, configurable per-session:

1. **Class vote** (default for Dares): every non-performer taps one of
   3 emoji within an 8s window. Majority wins. Threshold: 50% of present
   teams.
2. **Teacher judgment** (default for Truths with subjective answers): single
   tap pass/fail/retry. Faster, no audience-bias risk.
3. **AI verdict** (default for Truths with objective answers): GPT-4o-mini
   checks the spoken/typed answer against the question's `acceptableAnswers`
   list. Falls back to class vote on uncertainty.

### Steal mechanics

If the selected team chooses **Pass** or fails the challenge, the steal
window opens for 10s. Any other team can press their team-color steal button
to take the dare/truth for themselves at a discount (worth 60% of original
points but no penalty if they fail). Builds engagement and recovery paths.

### Challenge escalation

Three difficulty levels: **🌱 Sprout · 🌿 Stem · 🌳 Big**.

- Each team starts at Sprout.
- After 3 successful challenges, the next selection auto-escalates to Stem.
- Big-tier challenges unlock per-team after 5 successes.
- Failing or Passing demotes one tier (gently — keeps it learnable).
- Visual: a small leaf-grow animation when escalation triggers.

### Cooldown systems

- **Per-player**: 2 rounds before re-selectable
- **Per-team**: 1 round before re-selectable
- **Per-challenge-text**: same exact challenge can't repeat within 50 rounds
  (hashed text stored in MongoDB)
- **Per-category**: each of the ~12 challenge categories (e.g. "Mime",
  "Persuade", "Recall fact", "Defend a position") has a per-session
  appearance cap of 3 so the variety stays high

### Anti-repeat systems

A bloom filter (`backend/services/truthOrDare/recentChallenges.js`) backed by
Redis stores the last 1000 challenge-hashes per (gradeLevel, subject) tuple.
The AI generator passes the bloom filter as a "avoid these prompt themes"
hint. Anti-repeat is content-aware (similar-meaning challenges, not just
exact-text matches).

---

## 3. AI Generation System

### Architecture

```
              ┌──────────────────────────────┐
              │  TruthOrDareGenerator        │
              │  (backend/services/truthOrDare/│
              │   generator.js)              │
              └──┬───────────────────────────┘
                 │
                 ▼
   ┌─────────────────────────────────────────────────┐
   │ 1. Build classroom profile                      │
   │    - gradeLevel, subject, unit, recentTopic     │
   │    - worldview (secular / general / faith)      │
   │    - physicalIntensity, socialIntensity         │
   │    - movementAllowed, noiseAllowed              │
   │    - timeBudgetSeconds                          │
   │    - tier (sprout / stem / big)                 │
   │    - history: last N challenges to avoid        │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 2. Compose prompt (templates below)             │
   │    - System: persona + safety rails             │
   │    - User: structured request with constraints  │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 3. LLM call (gpt-4o-mini)                       │
   │    - Response format: structured JSON           │
   │    - Temperature: 0.85 (high creativity)        │
   │    - Max tokens: 600                            │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 4. Validate JSON shape (validator.js)           │
   │    - required: type, prompt, timeSeconds, ...   │
   │    - one-shot retry on schema fail              │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 5. Safety pass (moderation.js)                  │
   │    - Pattern blacklist (regex)                  │
   │    - Category whitelist (must match one)        │
   │    - Length / readability gates                 │
   │    - OPENAI moderation API call (fast)          │
   │    - On fail: retry with stricter prompt OR     │
   │      fall back to curated library entry         │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 6. Bloom-filter dedupe                          │
   │    - hash(text, type) checked against recent    │
   │    - If hit: retry up to 2× then fallback       │
   └──┬──────────────────────────────────────────────┘
      │
      ▼
   ┌─────────────────────────────────────────────────┐
   │ 7. Cache & ship                                 │
   │    - Cache by (gradeLevel, subject, tier) for   │
   │      5 minutes to absorb burst requests         │
   │    - Persist to PromptUsageLog for analytics    │
   └─────────────────────────────────────────────────┘
```

### Prompt templates

**System prompt** (truth-or-dare-system.md):

```
You are the Truth or Dare master for a North American classroom of
{{gradeLevel}}-graders studying {{subject}} (current unit:
{{unitName}}). Your job is to generate ONE Truth or Dare challenge
as a JSON object.

ABSOLUTE NO-FLY ZONE:
- No romance, dating, attraction, crushes, marriage, "do you like X."
- No personal disclosure (family income, religion, mental health,
  sexuality, addresses, photos of self).
- No physical contact with other students (no touching, no proximity).
- No food, drink, or putting anything in mouths.
- No standing on furniture, leaving the classroom, or any movement
  beyond a meter from one's desk unless movementAllowed=true.
- No singling out one student's appearance, accent, grades, or family.
- No "embarrassing" framing — every challenge must have a path to
  GLORY, not shame.
- No politics, no religion, no celebrity drama, no sexual content,
  no current-event tragedy, no joke topics with consent or harm
  themes.

WORLDVIEW: {{worldview}} — {{worldviewGuidance}}

VOICE: Warm, playful, slightly theatrical. Think enthusiastic camp
counselor. NEVER snide. NEVER condescending. The challenge should
sound like an invitation, not a punishment.

EVERY TRUTH must be answerable from {{subject}}/{{unitName}} content
the class has been studying OR a universal-knowledge question a
{{gradeLevel}}-grader could reasonably answer.

EVERY DARE must:
1. Be doable in <={{timeBudgetSeconds}}s from a student's seat (unless
   movementAllowed=true).
2. Embody, perform, or relate to {{subject}}/{{unitName}} content.
3. Give the performer a clear path to look brilliant.
4. Be at most 1 sentence of instruction.

OUTPUT — JSON ONLY, no commentary, no markdown:
{
  "type": "truth" | "dare",
  "tier": "sprout" | "stem" | "big",
  "category": "recall" | "explain" | "defend" | "mime" | "persuade" |
              "roleplay" | "improv" | "draw" | "narrate" | "compose" |
              "reflect" | "predict",
  "prompt": "the challenge text shown to the student",
  "teacherHint": "1-sentence tip for the teacher on what to look for",
  "timeSeconds": 15-90,
  "physicalIntensity": 0-3,
  "socialIntensity": 0-3,
  "noiseExpected": 0-3,
  "acceptableAnswers": ["short", "key", "phrases"] | null,
  "judgmentMode": "ai" | "teacher" | "class-vote",
  "rewardTier": "small" | "medium" | "large"
}
```

**User prompt** (per-call):

```
TIER: {{tier}}
KIND_HINT: {{kindHint}}  // "truth" | "dare" | "either"
RECENT_CATEGORIES_TO_AVOID: {{recentCategories}}
RECENT_PROMPT_THEMES_TO_AVOID: {{recentThemes}}
CLASSROOM_PROFILE:
  - movementAllowed: {{movementAllowed}}
  - noiseAllowed: {{noiseAllowed}}
  - physicalIntensityMax: {{physicalIntensityMax}}
  - socialIntensityMax: {{socialIntensityMax}}
  - timeBudgetSeconds: {{timeBudgetSeconds}}
  - currentTopic: {{currentTopic}}
  - sessionEnergy: {{sessionEnergy}}  // "low" | "neutral" | "high"

Give me ONE challenge.
```

### Subject-aware variants

For each subject, the system rotates between **content-direct** prompts
("Name three causes of the French Revolution") and **content-embodied**
prompts ("Mime the formation of a sedimentary rock for 30 seconds").

Per-subject category weighting lives in
`shared/truthOrDareSubjectMatrix.js` (similar to the existing
`taskTypes.js#TASK_TYPE_FIT_BY_SUBJECT`). Example:

```js
{
  science: { mime: 0.9, narrate: 0.8, predict: 0.8, defend: 0.7, ... },
  english: { roleplay: 0.95, persuade: 0.9, improv: 0.9, compose: 0.8 },
  math: { explain: 0.95, defend: 0.85, predict: 0.7, mime: 0.4 },
  history: { roleplay: 0.95, defend: 0.9, narrate: 0.85, reflect: 0.7 },
  arts: { mime: 0.95, draw: 0.95, compose: 0.85, improv: 0.9 },
  health: { reflect: 0.9, predict: 0.7, persuade: 0.6, mime: 0.5 },
  // …
}
```

### Retry / fallback strategy

1. **Schema fail** → one retry with explicit "your last output had X
   field missing" added.
2. **Safety fail** → one retry with "tone down — your last suggestion
   triggered the safety filter for {{category}}" added. If second retry
   fails, fall back to the **curated library** (see §3 below).
3. **Bloom filter dedupe hit** → retry up to twice with the conflicting
   theme excluded.
4. **All retries exhausted** → use the curated library entry matched on
   (gradeLevel, subject, tier, category).

### Curated fallback library

`backend/data/truthOrDareEvergreen.json` ships ~300 hand-vetted entries
spanning grades 3–12 and 12 subjects. Each entry has the exact same JSON
shape as AI output and has been through manual safety review. This is
the **never-fail** path: even with no network / no OpenAI key / a
catastrophic moderation false-positive cycle, the game keeps running.

The library is also seeded into the AI-generation prompt as few-shot
examples (3 per call) to anchor tone.

### Sample AI prompts (system + user, fully rendered)

#### Example 1 — Grade 7 / Science / Water Cycle / Dare / Stem tier

System: (above template rendered)

User:
```
TIER: stem
KIND_HINT: dare
RECENT_CATEGORIES_TO_AVOID: ["mime", "narrate"]
RECENT_PROMPT_THEMES_TO_AVOID: ["evaporation gestures", "cloud formation"]
CLASSROOM_PROFILE:
  - movementAllowed: true
  - noiseAllowed: true
  - physicalIntensityMax: 2
  - socialIntensityMax: 2
  - timeBudgetSeconds: 45
  - currentTopic: "Water Cycle — condensation"
  - sessionEnergy: "neutral"

Give me ONE challenge.
```

Expected output:
```json
{
  "type": "dare",
  "tier": "stem",
  "category": "roleplay",
  "prompt": "You are a single water droplet on a long journey. In 30 seconds, narrate your trip from the ocean to a raincloud — out loud, including at least 3 stages. Bonus laughs for accents.",
  "teacherHint": "Listen for: evaporation, transpiration, or wind transport mentioned by name.",
  "timeSeconds": 45,
  "physicalIntensity": 1,
  "socialIntensity": 2,
  "noiseExpected": 2,
  "acceptableAnswers": ["evaporation", "transpiration", "rising air", "cooling", "condensation"],
  "judgmentMode": "class-vote",
  "rewardTier": "medium"
}
```

#### Example 2 — Grade 4 / Math / Fractions / Truth / Sprout tier

```json
{
  "type": "truth",
  "tier": "sprout",
  "category": "recall",
  "prompt": "If you cut a pizza into 8 equal slices and eat 3, what fraction did you eat and what fraction is left?",
  "teacherHint": "Acceptable forms: 3/8 eaten, 5/8 left, or equivalent reductions.",
  "timeSeconds": 20,
  "physicalIntensity": 0,
  "socialIntensity": 0,
  "noiseExpected": 0,
  "acceptableAnswers": ["3/8 and 5/8", "three eighths eaten five eighths left", "5/8 remains"],
  "judgmentMode": "ai",
  "rewardTier": "small"
}
```

#### Example 3 — Grade 10 / History / French Revolution / Dare / Big tier

```json
{
  "type": "dare",
  "tier": "big",
  "category": "roleplay",
  "prompt": "Defend the storming of the Bastille from Louis XVI's perspective. You have 60 seconds — stay in character, use 'I, the king' once, and concede ONE point your peasants got right.",
  "teacherHint": "Listen for: fiscal crisis, food prices, OR loss of legitimacy — any one earns full credit.",
  "timeSeconds": 60,
  "physicalIntensity": 0,
  "socialIntensity": 3,
  "noiseExpected": 1,
  "acceptableAnswers": null,
  "judgmentMode": "teacher",
  "rewardTier": "large"
}
```

### Sample generated truths and dares (curated library excerpts)

A non-exhaustive flavor pass across the catalogue:

**Truths (curriculum-direct):**
- "Without looking at notes, name three of the four chambers of the heart."
- "Explain in one sentence why the British colonies wanted to break from Britain."
- "What's the difference between weather and climate?"

**Truths (improv/reflection):**
- "Tell us about a time something in this unit reminded you of real life."
- "If you could ask one question of [historical figure from the unit], what would it be?"
- "What's the thing you understand best in this unit, and what's the thing you wish was clearer?"

**Dares (mime/embody):**
- "Mime the journey of a sound wave from your friend's mouth to your ear, in 25 seconds."
- "In 30 seconds, become a single muscle fiber contracting. We'll guess which type."
- "Draw a circuit on the board WITH YOUR EYES CLOSED. The class will judge."

**Dares (perform/persuade):**
- "Convince us in 45 seconds that a triangle is the strongest shape — for engineers."
- "Be a defense lawyer for Macbeth. You have 60 seconds to argue mitigating circumstances."
- "Pitch the periodic table to a 5-year-old. 30 seconds. Use one toy as a metaphor."

**Double Dares (higher risk/reward):**
- "Same as the dare above, but in 15 seconds. And in a stage whisper."
- "Pick a teammate to do the dare WITH you. You both pass or both fail."
- "Add ONE constraint of your own. If the class agrees it makes it harder, +50% points."

---

## 4. Safety & Moderation

### The blacklist

`backend/services/truthOrDare/safetyPatterns.js` exports a long, versioned
list of regex patterns and forbidden phrase fragments. Any AI-generated
prompt or teacher-injected prompt that matches gets **rejected before
display**. Categories:

- Romance/dating/attraction
- Sexual content
- Personal disclosure (family income, mental health, addresses, religion,
  sexuality, immigration status, grades)
- Substance references (alcohol, drugs, vaping)
- Violence / weapons
- Self-harm references
- Body image / weight / appearance
- Touching another student
- Eating, drinking, mouth contact
- Furniture-climbing, classroom-leaving
- Single-student singling-out by name unless the SELECTED student
- Political extremism / partisanship
- Religious mockery
- Cultural mockery
- Specific real-people mockery
- "Embarrassing", "humiliating", "shameful" framing words
- Property-required dares (phones, food, hats, etc.)
- Camera-required dares unless cameraEnabled=true
- Mic-required dares unless micEnabled=true and noiseAllowed=true

### The moderation pipeline

```
AI / Teacher / Library output
         │
         ▼
 ┌──────────────────────┐
 │  Layer 1: Pattern    │   reject any blacklist hit
 │  regex blacklist     │
 └────┬─────────────────┘
      │
      ▼
 ┌──────────────────────┐
 │  Layer 2: Category   │   prompt must classify into one of 12
 │  whitelist           │   approved categories
 └────┬─────────────────┘
      │
      ▼
 ┌──────────────────────┐
 │  Layer 3: OpenAI     │   omni-moderation check; threshold tuned
 │  moderation API      │   conservatively for schools
 └────┬─────────────────┘
      │
      ▼
 ┌──────────────────────┐
 │  Layer 4: Readability│   reading-level appropriate for grade?
 │  grade-band check    │   FK or smog rough estimate
 └────┬─────────────────┘
      │
      ▼
 ┌──────────────────────┐
 │  Layer 5: Time/      │   physical/social/noise intensity ≤ teacher caps?
 │  intensity gates     │
 └────┬─────────────────┘
      │
      ▼
   APPROVED → show to student
   FAILED   → retry once, then fall back to curated library
```

### Teacher override tools

- **One-tap reject + re-roll**: Teacher sees the AI's challenge in the
  teacher console 1.5s before students see it. Tap ❌ within that window to
  silently swap it for another. The student never sees the rejected one.
- **Pre-vetted topic skip list**: Teacher can mark categories
  ("political", "personal disclosure proxies") as off-limits per session.
- **Mid-round abort**: Teacher hits Space to mark the challenge as
  "skipped, no points either way" and immediately rolls a new one.
- **Custom-injected challenge**: Teacher types their own challenge into
  the console; it still passes the safety pipeline before display.

### "Safe Classroom" mode

Toggleable per-session. When on:
- Tier capped at "stem" (no "big")
- Categories restricted to recall, explain, predict, reflect, mime
- All judgmentMode = "teacher" (no class-vote)
- timeSeconds capped at 30
- noiseExpected capped at 1
- physicalIntensity capped at 1
- "Pass" tokens infinite
- Teacher pre-approval required on every challenge

This is the school-board-presentable default for new teachers and for
substitute teachers.

### Age-appropriateness system

Grade-band tunings in `truthOrDareGradeBands.js`:

- **Grades K–2**: Only sprout tier, only mime/draw/narrate, 15s max,
  no debate, no defend, all judgments by teacher
- **Grades 3–5**: Sprout + stem, all categories, 30s max, class-vote
  enabled
- **Grades 6–8**: Full catalogue, 60s max, double-dare unlocked
- **Grades 9–12**: Full catalogue + Big tier, 90s max, audience sabotage
  mechanic unlocked

Each grade band has its own moderation strictness (younger = stricter
language and topic guards).

### Why this is robust

The pipeline is **belt + suspenders**: even if the AI model is jailbroken
or a teacher's custom-injected challenge tries to weaponize the system,
the pattern blacklist + OpenAI moderation API + teacher 1.5s peek window
provides three independent failure modes. The curated library is the
always-on safety net.

---

## 5. UX/UI

### Student view — phone / Chromebook

Pre-spotlight:
```
┌───────────────────────────────────────────┐
│  ✨ TRUTH OR DARE — Round 3 of 5  ✨      │
│                                           │
│       [spinning slot-machine of avatars]  │
│       🎲 🎲 🎲 🎲 🎲 🎲 🎲                │
│                                           │
│           Spinning the wheel…              │
│              (drumroll)                   │
└───────────────────────────────────────────┘
```

If selected (you're up):
```
┌───────────────────────────────────────────┐
│  🌟 YOU'RE UP, MARIA 🌟                   │
│                                           │
│       Choose your fate:                    │
│                                           │
│   ┌────────────┐  ┌────────────┐         │
│   │   TRUTH    │  │    DARE    │         │
│   │   📖       │  │    🎭      │         │
│   │  +10 pts   │  │  +20 pts   │         │
│   └────────────┘  └────────────┘         │
│                                           │
│   ┌────────────────────────────┐         │
│   │   DOUBLE DARE — 🔥 +40    │         │
│   └────────────────────────────┘         │
│                                           │
│   [ Pass — costs 1 token (you have 2) ]  │
│                                           │
│   ⏱  10 seconds to pick…                  │
└───────────────────────────────────────────┘
```

If you're audience:
```
┌───────────────────────────────────────────┐
│  Maria is picking… 🎭                     │
│                                           │
│   Choose your reaction (vote later):       │
│                                           │
│   🔥  Nailed it                            │
│   🙂  Good try                             │
│   🤔  Hmm                                  │
│                                           │
│   ⏱  Vote opens after she performs        │
└───────────────────────────────────────────┘
```

### Teacher console

```
┌─────────────────────────────────────────────────────────┐
│  🎯 Truth or Dare Console                                │
├─────────────────────────────────────────────────────────┤
│  Status: Round 3 / Maria selected                       │
│                                                          │
│  AI's challenge (peek: 1.5s, students still loading):   │
│  ┌────────────────────────────────────────────────────┐ │
│  │ "Mime the water cycle in 30 seconds. Include       │ │
│  │  evaporation, condensation, and precipitation."   │ │
│  │  category: mime  tier: stem  time: 30s            │ │
│  └────────────────────────────────────────────────────┘ │
│  [ ✓ Approve ]  [ ↻ Re-roll ]  [ ✏ Edit ]              │
│                                                          │
│  Quick controls:                                         │
│  [ Skip this round ]  [ Force win ]  [ Force redo ]    │
│                                                          │
│  Session settings (sticky):                              │
│  Physical intensity: ●●○○  (max 2)                      │
│  Social intensity:   ●●○○  (max 2)                      │
│  Movement allowed:   [✓]    Noise allowed: [✓]         │
│  Safe Classroom:     [ ]                                │
│  Inject frequency:   every 10 min                       │
│                                                          │
│  [ Manual inject NOW ]  [ End Truth-or-Dare overlay ]   │
└─────────────────────────────────────────────────────────┘
```

### Projector view (classroom display)

The presenter device shows a maximized, dramatic version: huge avatar
spotlight, large readable challenge text, big timer ring, audience reaction
emoji aggregates as colored bubbles flowing in from the bottom.

### Reveal animations

- **Spotlight stop**: 3.5s slot-machine cycle slowing exponentially to a
  stop with a 1.2× scale-pop on the selected avatar
- **Truth vs Dare reveal**: a coin-flip animation (300ms) that lands on
  the side the player chose, then unfolds into the challenge card
- **Challenge slide-in**: 400ms slide-from-right with subtle parallax;
  category icon stamps in 100ms behind the text
- **Audience reactions**: emoji bubble float-up animation; reactions
  cluster by emoji
- **Verdict**: ✓ uses a green checkmark draw-in animation (PathLength
  SVG stroke); ✗ uses a red shake; the points number counts up

### Celebration effects

- Confetti burst on Pass (any tier)
- Confetti + screen-shake on Big tier Pass
- Sparkle trail on the points number
- Audio: `/sounds/tod-pass.mp3` (cheer), `/sounds/tod-fail.mp3` (gentle
  trombone — never harsh)

### Accessibility-aware UI

- Reduced-motion mode disables spotlight blur and shake (uses fades only)
- High-contrast mode swaps the gradient backgrounds for solid colors
- Screen-reader announces "Maria is selected. She chose Truth. The
  challenge is: …" with proper aria-live regions
- All emoji reactions have text labels for screen-reader users
- Color is never the only signal (✓ has shape + color)

---

## 6. Technical Architecture

### Frontend component hierarchy

```
TruthOrDareTask (renderer)
├── PreRoundCard
│   ├── EnergyDial
│   └── PlayerSpotlightWheel   (the slot-machine randomizer)
├── ChoicePhase
│   ├── TruthButton
│   ├── DareButton
│   ├── DoubleDareButton
│   └── PassTokenButton
├── ChallengeCard
│   ├── CategoryBadge
│   ├── TierIndicator
│   ├── PromptText
│   ├── TimerRing
│   └── PerformerCues          (mime/narrate visual cues)
├── PerformingHud
│   ├── TimerRing
│   ├── StealButton            (shown to non-selected teams)
│   └── AudienceReactionStrip
├── JudgmentPanel
│   ├── ClassVoteBar           (when judgmentMode = class-vote)
│   ├── TeacherVerdictControls (when judgmentMode = teacher)
│   └── AiVerdictCard          (when judgmentMode = ai)
├── RewardReveal
│   ├── PointsCounter
│   ├── CoinPop
│   ├── SpecialItemCard        (rare drops)
│   └── ContinueButton
└── RoundResultLog             (small history rail at the side)

TruthOrDareTeacherConsole (separate component on teacher LiveSession)
├── PeekWindow
├── OverrideControls
├── SessionSettingsPanel
└── ManualInjectComposer
```

### Backend services

```
backend/services/truthOrDare/
├── generator.js              // LLM call + retry loop
├── moderation.js             // 5-layer safety pipeline
├── safetyPatterns.js         // regex blacklist (versioned)
├── recentChallenges.js       // bloom filter / dedupe
├── verdictAi.js              // optional AI judging for Truth answers
├── selector.js               // weighted-random player selection
├── orchestrator.js           // round-state machine
└── analytics.js              // event recording

backend/controllers/
└── truthOrDareController.js  // socket handler dispatcher

backend/routes/
└── truthOrDare.js            // REST: get history, teacher settings
```

### State machine

The round is a finite-state machine kept on the server in
`room.truthOrDareState`:

```
IDLE
  └─ teacher:tod:start ───→ SELECTING
        └─ randomizer done ───→ CHOOSING
              └─ player picks ───→ REVEALING
                    └─ animation done ───→ PERFORMING
                          ├─ timer expires
                          ├─ player taps Done
                          └─ teacher force-completes
                          ───→ JUDGING
                                └─ verdict ───→ REWARDING
                                      └─ continue ───→ COOLDOWN
                                            └─ next round ───→ SELECTING
                                            └─ task ends   ───→ IDLE
```

### State flow + caching

- Server is the single source of truth for round state
- All transitions broadcast to room via socket events
- Player choice locked server-side once received (5s grace for late retries)
- Round transitions are idempotent — duplicate teacher:next clicks ignored
- 5-minute LRU cache on AI-generated challenges keyed by
  (gradeLevel, subject, tier, category, recentHashesShort)

### AI generation queue

A per-room rolling buffer pre-generates the next 1–2 challenges in the
background so the next round's reveal is instant. Falls back gracefully if
the queue empties (loading spinner; usually <800ms to fresh-generate).

### Telemetry

Every state transition emits a telemetry event to `TruthOrDareAnalytics`
(see §11).

---

## 7. Database Schemas

```js
// backend/models/TruthOrDareSession.js
const TruthOrDareSessionSchema = new Schema({
  roomCode: { type: String, index: true, required: true },
  tasksetId: { type: ObjectId, ref: "TaskSet" },
  taskIndex: { type: Number },        // null if overlay
  mode: { type: String, enum: [
    "individual", "team", "duel", "lightning", "historical-roleplay",
    "debate-dare", "mystery-spy", "whole-class", "teacher-injection",
    "silent", "stationary", "movement",
  ], default: "individual" },
  startedAt: { type: Date, default: Date.now },
  endedAt:   { type: Date, default: null },
  // Per-session config snapshot
  config: {
    physicalIntensityMax: { type: Number, default: 2 },
    socialIntensityMax:   { type: Number, default: 2 },
    movementAllowed:      { type: Boolean, default: true },
    noiseAllowed:         { type: Boolean, default: true },
    safeClassroomMode:    { type: Boolean, default: false },
    cameraEnabled:        { type: Boolean, default: false },
    micEnabled:           { type: Boolean, default: true },
    injectionFrequencyMin:{ type: Number, default: 10 },
    maxInjectionsPerSession: { type: Number, default: 3 },
    gradeBand:            { type: String, default: "" },
    worldview:            { type: String, default: "general" },
  },
  rounds: [{ type: ObjectId, ref: "TruthOrDareRound" }],
  totalRounds:  { type: Number, default: 0 },
  passesUsed:   { type: Map, of: Number, default: {} },  // teamId → count
  cooldownsBy:  { type: Map, of: Number, default: {} }, // teamId → unlockAt round
}, { timestamps: true });

TruthOrDareSessionSchema.index({ roomCode: 1, startedAt: -1 });

// backend/models/TruthOrDareRound.js
const TruthOrDareRoundSchema = new Schema({
  sessionId:   { type: ObjectId, ref: "TruthOrDareSession", index: true },
  roomCode:    { type: String, index: true },
  roundIndex:  { type: Number, required: true },
  selectedTeamId: { type: String, required: true },
  selectedPlayerName: { type: String, default: "" },
  promptHash:  { type: String, index: true },  // for dedupe
  choice:      { type: String, enum: ["truth", "dare", "double-dare", "pass"] },
  challenge: {
    type:       { type: String, enum: ["truth", "dare"] },
    tier:       { type: String, enum: ["sprout", "stem", "big"] },
    category:   { type: String },
    prompt:     { type: String },
    teacherHint:{ type: String },
    timeSeconds:{ type: Number },
    physicalIntensity:{ type: Number },
    socialIntensity:  { type: Number },
    noiseExpected:    { type: Number },
    acceptableAnswers:{ type: [String], default: [] },
    judgmentMode:{ type: String, enum: ["ai", "teacher", "class-vote"] },
    rewardTier:  { type: String, enum: ["small", "medium", "large"] },
    sourceProvenance: { type: String, enum: ["ai", "library", "teacher-injected"] },
    moderationVersion:{ type: String, default: "v1" },
  },
  // Performance + outcome
  performStartedAt: { type: Date },
  performEndedAt:   { type: Date },
  performDurationMs:{ type: Number },
  verdict:       { type: String, enum: ["pass", "fail", "retry", "skip"], default: null },
  verdictBy:     { type: String, enum: ["ai", "teacher", "class-vote", "auto"] },
  votes:         { type: Map, of: String, default: {} }, // teamId → emoji
  stealAttemptedBy: { type: String, default: "" },
  stealVerdict:  { type: String, enum: ["pass", "fail", null], default: null },
  pointsAwarded: { type: Number, default: 0 },
  coinsAwarded:  { type: Number, default: 0 },
  specialItem:   { type: String, default: "" },  // e.g. "shield", "clue"
  flagged:       { type: Boolean, default: false },
  flagReason:    { type: String, default: "" },
}, { timestamps: true });

TruthOrDareRoundSchema.index({ promptHash: 1, createdAt: -1 });

// backend/models/TruthOrDareTeacherProfile.js
// Sticky per-teacher preferences carried between sessions.
const TruthOrDareTeacherProfileSchema = new Schema({
  teacherId: { type: String, unique: true, index: true, required: true },
  defaults: {
    physicalIntensityMax: { type: Number, default: 2 },
    socialIntensityMax:   { type: Number, default: 2 },
    movementAllowed:      { type: Boolean, default: true },
    noiseAllowed:         { type: Boolean, default: true },
    safeClassroomMode:    { type: Boolean, default: false },
    injectionFrequencyMin:{ type: Number, default: 10 },
    preferredCategories:  { type: [String], default: [] },
    bannedCategories:     { type: [String], default: [] },
    worldview:            { type: String, default: "general" },
    customSafetyAddendum: { type: String, default: "" },
  },
  totalSessions: { type: Number, default: 0 },
  totalRounds:   { type: Number, default: 0 },
  flaggedRounds: { type: Number, default: 0 },
}, { timestamps: true });

// backend/models/TruthOrDareAnalytics.js
const TruthOrDareAnalyticsSchema = new Schema({
  roomCode: { type: String, index: true },
  sessionId: { type: ObjectId, ref: "TruthOrDareSession" },
  event: { type: String, enum: [
    "round-start", "selection-locked", "choice-made", "challenge-revealed",
    "perform-started", "perform-ended", "verdict", "audience-reaction",
    "steal-attempted", "teacher-override", "safety-flag", "moderation-retry",
    "moderation-fallback",
  ] },
  payload: { type: Mixed, default: {} },
  ts: { type: Date, default: Date.now, index: true },
});

TruthOrDareAnalyticsSchema.index({ event: 1, ts: -1 });
```

---

## 8. Socket Flow

### Server → Client events

| Event | Payload | Notes |
|---|---|---|
| `tod:state` | `{ phase, round, selectedTeamId, … }` | Full snapshot, fired on every transition |
| `tod:spotlight:spin` | `{ candidateTeamIds, durationMs }` | Triggers slot-machine animation |
| `tod:spotlight:land` | `{ teamId, playerName }` | Final selection |
| `tod:challenge:ready` | `{ challenge }` | Teacher peek (1.5s) before student broadcast |
| `tod:challenge:reveal` | `{ challenge, startsAt }` | Public reveal |
| `tod:perform:tick` | `{ msRemaining }` | 1Hz timer |
| `tod:audience:reaction` | `{ teamId, emoji }` | Real-time emoji float |
| `tod:steal:open` | `{ windowMs }` | Steal button enables |
| `tod:steal:locked` | `{ teamId }` | First steal wins |
| `tod:verdict` | `{ result, awardedPoints, awardedCoins, specialItem }` | Round resolved |
| `tod:cooldown:set` | `{ teamId, cooldownRounds }` | Cooldown update |
| `tod:session:end` | `{ summary }` | Overlay/standalone done |

### Client → Server events

| Event | Payload | Sender |
|---|---|---|
| `tod:teacher:start` | `{ roomCode, mode, configOverrides }` | Teacher |
| `tod:teacher:peek-decision` | `{ roundIndex, action: "approve"|"reroll"|"edit", newText? }` | Teacher |
| `tod:teacher:override` | `{ roundIndex, action: "skip"|"force-pass"|"force-fail"|"force-redo" }` | Teacher |
| `tod:teacher:inject` | `{ challenge }` | Teacher (manual entry, still moderated) |
| `tod:teacher:config` | `{ ...configDelta }` | Teacher (mid-session change) |
| `tod:player:choice` | `{ choice: "truth"|"dare"|"double-dare"|"pass" }` | Selected team |
| `tod:player:done` | `{ }` | Selected team taps Done early |
| `tod:audience:react` | `{ emoji }` | Any non-selected team |
| `tod:audience:vote` | `{ verdict: "pass"|"fail"|"retry" }` | Any non-selected team (only in class-vote mode) |
| `tod:steal:request` | `{ }` | Any non-selected team during steal window |

### Sequence diagram — happy path

```
Teacher                  Server                  Selected Team       Audience
   │  tod:teacher:start    │                          │                  │
   │ ────────────────────► │                          │                  │
   │                       │ build classroom profile  │                  │
   │                       │ pre-gen challenge        │                  │
   │                       │                          │                  │
   │                       │ tod:state(SELECTING)     │                  │
   │                       │ ─────────────────────────►                  │
   │                       │ ─────────────────────────┼─────────────────►│
   │                       │ tod:spotlight:spin       │                  │
   │                       │ ─────────────────────────►                  │
   │                       │ ─────────────────────────┼─────────────────►│
   │                       │  ⏱ 3.5s                  │                  │
   │                       │ tod:spotlight:land(Maria)│                  │
   │                       │ ─────────────────────────►                  │
   │                       │ ─────────────────────────┼─────────────────►│
   │  tod:challenge:ready  │                          │                  │
   │ ◄──────────────────── │                          │                  │
   │  ⏱ 1.5s peek          │                          │                  │
   │ tod:teacher:peek      │                          │                  │
   │ (approve)             │                          │                  │
   │ ────────────────────► │                          │                  │
   │                       │ tod:challenge:reveal     │                  │
   │                       │ ─────────────────────────►                  │
   │                       │ ─────────────────────────┼─────────────────►│
   │                       │                          │ choose truth/dare│
   │                       │ ◄────────────────────────│                  │
   │                       │ tod:state(PERFORMING)    │                  │
   │                       │ ─────────────────────────► ◄ timer ticks    │
   │                       │                          │ done/timer expires
   │                       │ ◄────────────────────────│                  │
   │                       │ class-vote opens         │                  │
   │                       │ ─────────────────────────┼─────────────────►│
   │                       │                          │  audience reacts │
   │                       │ ◄────────────────────────┼──────────────────│
   │                       │ tod:verdict              │                  │
   │                       │ ─────────────────────────►                  │
   │                       │ ─────────────────────────┼─────────────────►│
```

---

## 9. Educational Strategy

### What's actually being trained

Truth or Dare is a wrapper around **eight Bloom-aligned cognitive skills**,
none of which require sitting still and writing:

| Skill | How T-or-D trains it |
|---|---|
| **Retrieval practice** | Truth questions; recall tier prompts |
| **Application** | "Mime photosynthesis" forces translation from definition to mental model |
| **Analysis** | "Defend X" forces evaluating evidence under social pressure |
| **Synthesis** | Roleplay categories blend content + character + tone |
| **Evaluation** | Audience voting trains judgment of arguments |
| **Communication** | Every Dare is an oral or physical presentation |
| **Confidence** | Repeated low-stakes performance reduces speech anxiety |
| **Improvisation** | Categories like persuade, predict, defend require thinking on feet |

### Hidden objectives

Most students will not consciously notice they are doing retrieval practice
when they mime the water cycle. That's the design. The
"learning-disguised-as-fun" principle.

Three specific hidden objectives:

1. **Distributed practice over time**: spaced over a unit, T-or-D rounds
   surface every key term in the textbook within 3–5 sessions. The system
   tracks which terms have been hit and weights underused ones higher.
2. **Public processing**: students who can answer in private but freeze
   when called on get reps. The Pass token + Steal mechanic give them an
   out without humiliation.
3. **Social leveling**: strong oral students get to shine; quiet strong
   readers get the mime/draw lane.

### Bloom mapping

```js
TASK_BLOOMS_MAP["truth-or-dare"] = ["APPLY", "ANALYZE", "REMEMBER"];
```

(APPLY because of embodied performance; ANALYZE for defend/persuade
categories; REMEMBER because Truth categories are direct retrieval.)

### Reflection beat

After 3 rounds, the system auto-injects a 20-second "reflection beat":
the AI asks the class one short whole-class question — "What's one
thing you remember from those last three challenges?" Quick whole-class
chorus, then back to the next round. Cements retention.

---

## 10. Accessibility

### Shy students

- **Pass tokens**: every student starts with 2 (configurable). A pass
  costs nothing socially.
- **Whisper mode**: any Dare can be performed to one teammate at the
  back instead of the whole class; rewards halved but no audience
  pressure.
- **Anonymous text-only mode**: the selected student can type their
  answer into the projector instead of speaking. The class still votes,
  but on the typed answer.
- **Substitute mode**: if a student declines, an audience member with
  the highest engagement score that round gets the steal automatically.

### Neurodivergent students

- **Reduced-motion mode**: spotlight animation becomes a fade; drumroll
  becomes a single bell sound
- **Predictable structure**: every round follows the same 6-stage flow;
  the timing of each stage is shown in a small UI strip
- **Sensory caps**: noiseExpected and physicalIntensity sliders allow
  capping; teachers can build a "calm classroom" profile
- **Choice signals**: every action has redundant visual + text + icon

### Speech limitations

- **Sign / write fallback**: any Truth can be answered via the typing
  textbox; any Dare can be performed as drawing on the device
- **AI lip-reading mode (future)**: with camera enabled, a future
  beta path could caption the student's spoken answer in real time

### Mobility limitations

- **All Dares have a seated variant**: when movementAllowed=false, the
  AI is told "no standing, no walking, no large arm movements" — Dares
  default to verbal/seated-mime/draw/face-only
- **Wheelchair-aware**: nothing in the catalogue assumes standing; the
  prompt explicitly says "from your seat"

### English language learners

- **Bilingual prompt mode**: the AI can produce the prompt in English +
  the student's home language (Spanish, Mandarin, Arabic, French, etc.)
  side by side. Teacher toggles per-student
- **Simpler-language pass**: the prompt can be regenerated at a lower
  reading level on demand (one tap)
- **Drawing/miming categories preferred**: when ELL flag is on, the
  AI weights toward non-language-heavy categories

### Low-noise classrooms

- **Silent mode**: all Dares converted to drawing/writing/mime; no
  oral performance. Steal mechanic still works
- **Noise threshold integration**: the existing noise sensor can
  auto-engage Silent mode if the room exceeds a noise threshold (gentle
  feedback that brings volume down)

### Camera-disabled environments

- **No-camera mode**: any Dares that imply being filmed are filtered
  out at moderation. Steal/audience reactions still work via taps
- **Audio-only reactions**: the audience can react with a small set of
  sound buttons (cheer, hmm, laugh) instead of emoji on screen

### Cooperative mode

For very young grades or first-time players: instead of selecting one
student/team, the **whole class** does the challenge together. The
verdict is whether ≥75% of the class participated visibly. Zero
spotlight pressure. Used to warm up cold rooms.

---

## 11. Analytics

### Per-event tracking

Every transition writes a `TruthOrDareAnalytics` doc. Aggregations
power both the teacher dashboard and Curriculate's product analytics.

### Engagement metrics

- **Participation rate** = `# rounds where audience emoji count >
  0.5 × team count`
- **Performer-completion rate** = `# rounds with verdict ≠ skip and
  performDurationMs > 0.6 × timeSeconds`
- **Laughter proxy** = `# audience reactions with 🔥 or 😂 emoji /
  total reactions`
- **Energy curve** = rolling 3-round average of reactions/round; lets
  the teacher see when the class peaks

### Hesitation metrics

- **Choice latency** = time from challenge-revealed → choice-made;
  higher = more deliberation, useful for finding tier mismatches
- **Pass rate per tier** = passes / total selections at tier; high pass
  rate at sprout = tier too hard or social anxiety
- **Steal attempt rate** = steals / passes; high = audience hungry for
  participation

### Challenge effectiveness

- **Per-prompt success rate** (hash-keyed): pass rate of any specific
  generated prompt
- **Per-category success rate**: which categories work in which
  subjects
- **Per-tier success rate**: are we calibrated right at each tier?
- **Repeat-tolerance**: how many times can a similar prompt appear
  before fatigue?

### Replayability metric

- **Distinct-prompts-per-session** / `totalRounds` — should hover at 1.0
- **Same-topic-prompt-distance** — average # rounds between two
  prompts touching the same unit topic; want > 2

### Safety metrics

- **Moderation-flag rate**: flagged-by-pipeline / generated
- **Teacher-override rate**: per-session count of re-rolls; high =
  pipeline isn't tuned for that classroom yet
- **Library-fallback rate**: fallback uses / total challenges; high
  = LLM is misbehaving on that grade/subject

### Dashboards

- **Teacher dashboard** (`/teacher/truth-or-dare/insights`): per-class
  energy curves, top-loved categories, students who haven't been
  spotlit in N sessions (re-engagement nudge)
- **Admin dashboard** (`/admin/truth-or-dare/health`): aggregate
  moderation rates, fallback rates, latency, OpenAI cost per session
- **Per-prompt page**: pulls the top 50 most-used + the top 20 most-flagged
  prompts; lets us tune the library

### Privacy

All analytics events strip student names; only the team-id and
session-id are retained beyond the room lifetime. No event ever
contains the student's verbatim spoken answer (only the AI verdict
boolean, never the raw text).

---

## 12. Advanced Modes

### 1. Individual

Default. Spotlight picks one player, audience reacts/votes.

### 2. Team

Spotlight picks a team; the team picks their own performer (or rotates
within the team). Used for shyer classrooms or where teams want
strategic captain-selection.

### 3. Random Duel

Spotlight picks **two** teams. Both get the same challenge; class votes
which performed better. Winner takes 70% of pot, loser takes 30%
(participation reward — no zeros).

### 4. Lightning Round

10 sprout-tier challenges in 5 minutes. No spotlight animation between
rounds — just rapid-fire. Used as a session warmup.

### 5. Historical Roleplay

All Dares are roleplay-category, all set in the current unit's
historical period. Teacher pre-loads 4 characters and the AI binds
prompts to those characters. Builds toward a unit-end "Hall of Fame"
where students vote on best portrayal.

### 6. Debate Dare

Every challenge is a `defend` category with a position assigned 50/50.
Students argue both sides over multiple rounds; aggregate score is the
team's debate rating for the unit.

### 7. Mystery / Spy Mode

Hidden mission overlay. One randomly-chosen student per round gets a
secret personal challenge in addition to the public one (e.g. "Sneak the
word 'photosynthesis' into your answer without anyone catching on. If
they catch you, no penalty. If you do it cleanly, +50 pts.") The
audience tries to catch the secret mission. Compounds with Whodunnit
overlay if both enabled.

### 8. Whole-Class Mode

The class collectively gets a single challenge ("Choreograph a 20-second
mime of how a bill becomes a law"). Teacher votes overall; everyone wins
or loses together. Used to build classroom cohesion.

### 9. Teacher Injection Mode

Teacher writes their own challenges into a queue at the start of class.
Spotlight selects from teacher-injected pool first, AI-generated only as
filler. Used for teachers who have specific recall priorities for the
day.

### 10. Silent / Classroom-safe Mode

All Dares converted to drawing/writing/text. No audible reactions —
audience reacts via emoji only. Used during exam weeks or in
quiet-required environments (libraries, neighboring quiet rooms).

### 11. Stationary / Desktop Mode

Students at desks, no movement. All Dares are face/voice-only or
typing/drawing. Auto-engaged if `movementAllowed=false` in the session
config.

### 12. Movement Mode

The high-energy default. Dares can include "stand and pose", "act out
across the front of the room", "physically demonstrate". physicalIntensity
caps still apply.

### Cross-mode interactions

- **Quest + T-or-D**: T-or-D wins can drop quest resources/coins
- **Escape Room + T-or-D**: T-or-D wins can grant hint tokens
- **Whodunnit + T-or-D**: the secret-suspect player can use a T-or-D round
  to plant a clue (mystery-spy mode synergy)
- **LevelUp + T-or-D**: a player whose lowest score was a Truth-or-Dare
  round can request a T-or-D LevelUp round to redeem

---

## 13. Example Sessions

### Session A — Grade 5 Science, Water Cycle unit, Friday afternoon

Mrs. Patel enables the overlay on her normal taskset. Settings: physical
intensity 2, social intensity 2, movement allowed, noise allowed,
inject every 10 minutes.

**Minute 12** — first injection fires after a Sort task.

Spotlight spins → Diego (Team Comets).

Diego picks DARE.

Challenge: *"Mime the water cycle in 30 seconds. Include evaporation,
condensation, and precipitation. Bonus laughs for accents."* (Stem
tier, mime category)

Diego stands at his desk, waves his arms upward (evaporation), pretends
to gather in the air (condensation), and "rains" his fingers down
(precipitation). Audience erupts. Mrs. Patel taps ✓. +25 pts to Comets.

Class noise spikes, mic picks up 80dB → noise threshold gently nudges
session into silent reactions for 60 seconds (one of the cross-system
features).

**Minute 24** — second injection.

Spotlight → Team Falcons.

Falcons picks TRUTH.

Challenge: *"In one sentence, explain why puddles disappear after a sunny
afternoon."* (Sprout, recall)

Captain answers "the sun makes the water turn into invisible vapor and
go into the air." AI verdict checks for "evaporation" or "vapor" — pass.
+10 pts.

**Minute 39** — third injection.

Spotlight → Maria (already picked once, cooldown skips her) → re-spins
→ Team Eagles.

Eagles picks DARE.

Challenge: *"You are a single water droplet on a long journey. In 30
seconds, narrate your trip from the ocean to a raincloud — out loud,
including at least 3 stages. Bonus laughs for accents."* (Stem, roleplay)

Their captain Alex does an exaggerated French accent: "I am Pierre,
zee droplet, and I am evaporating! Now I am condensing! Magnifique!"
Class loses it. Mrs. Patel: ✓. +25 pts.

Session ends with the regular taskset finishing 5 minutes later. T-or-D
fired 3 times in 47 minutes. Engagement rate 100%. No moderation flags.
Mrs. Patel's mid-session settings sliders never touched.

### Session B — Grade 9 History, Salem Witch Trials, debate-dare mode

Mr. Chen runs the standalone task at the end of a 2-week unit. Sets
mode = `debate-dare`, ranks = Big tier unlocked.

Round 1 — Spotlight → Team Hawks. They pick DARE (no truth in debate-dare).

Challenge: *"Defend the accusers. You have 60 seconds. Use 1 piece of
context that wasn't fear. The class votes."*

Their speaker, Aisha, argues that property disputes and family rivalries
were a factor — a sharp point. Audience votes 68% pass.

Round 2 — Spotlight → Team Wolves. DARE.

Challenge: *"Defend the accused. You have 60 seconds. Acknowledge one
weak argument the accusers made and dismantle it."*

Their speaker frames the spectral evidence problem precisely. 82% pass.

Continues for 8 rounds. Final aggregate Hawks 410 / Wolves 480. Wolves
unlock the "Debate Champion" badge. Mr. Chen exports the round log to
inform his end-of-unit essay rubric.

### Session C — Grade 3 Math, fractions, silent classroom mode

Substitute teacher, library-adjacent classroom. Sets safeClassroomMode +
silent mode + noiseAllowed=false.

All Dares converted to whiteboard-draw category. Truth questions still
spoken at conversational volume.

8 rounds in 12 minutes. No moderation flags. No noise complaints. The
sub leaves a glowing note for the regular teacher.

---

## 14. Edge Cases

### "Student disconnects mid-perform"

If the selected team's primary device disconnects during PERFORMING,
the server holds the round in a 15s grace state. If they reconnect, the
timer resumes. If not, the round auto-skips to JUDGING with `verdict =
skip`, no points either way, no cooldown applied, and the round repeats
(new spotlight, fresh challenge).

### "Teacher leaves mid-round"

Teacher disconnection triggers a 30s grace. If they don't return, the
round auto-completes with whatever judgment mode applies (class-vote or
AI) — never blocked indefinitely on teacher input.

### "AI returns malformed JSON"

The validator catches it. One auto-retry with "your last response wasn't
valid JSON" appended. If second attempt also fails, instant fallback to
curated library matched on (gradeLevel, subject, tier).

### "Same challenge appears twice in one session"

Bloom filter dedupe prevents identical text within 50 rounds. If a near-
duplicate slips through (semantic similarity ≥ 0.85 via embeddings,
optional v2 feature), the round is regenerated silently.

### "Class refuses to vote"

If after 8s the audience has <33% participation in voting, the system
defaults to TEACHER verdict mode. Avoids deadlocks.

### "Student picks Pass but has no tokens left"

Pass button is disabled. Tooltip explains the cooldown. If they really
need out, teacher can override (skip the round, no penalty).

### "Bad word in spoken answer (caught by speech-to-text)"

If the speech-to-text optional path is on and a profanity is detected,
the AI verdict skips the bad-word section in display but still scores
the rest. Teacher gets a small notice in the console; no class-wide
exposure.

### "Steal race condition — two teams tap at the same moment"

Server uses the first arrival timestamp; ties broken by smaller
`teamId`. Loser sees a friendly "Beat by 47ms — next time!"

### "Network blip during reveal"

The challenge JSON is sent with `tod:challenge:reveal` AND also embedded
in the next `tod:state` snapshot, so any reconnecting client gets the
challenge on rejoin without losing their place.

### "Teacher injects a borderline challenge"

It still passes the moderation pipeline. If it fails, the teacher sees a
clear "this prompt was blocked because: <category>" and can edit. We
never let through a teacher-supplied prompt that fails the safety
pipeline — even if the teacher overrides explicitly.

### "Same student gets unlucky three times in a row"

Cooldown weights prevent it. If somehow it happens (rare, with small
classes), the system forces a re-roll once a player has been spotlight
in 2 of the last 4 rounds.

### "Empty classroom — teacher is testing alone"

Detect `teams.size === 1`. Run a self-tour mode: AI demos a Truth, a
Dare, and a Double Dare, with the "audience" being the teacher only.
No selection, no voting — pure preview.

### "OpenAI API down"

Generator fails over to curated library 100%. Frontend shows "Running
in offline mode — limited prompt variety" subtly in the teacher
console. No student-facing degradation.

---

## 15. Full Implementation Plan

### Phase 0 — Foundation (3–4 days)

- [ ] Plan doc reviewed (this file)
- [ ] `shared/taskTypes.js`: add `TRUTH_OR_DARE: "truth-or-dare"`,
  `TASK_BLOOMS_MAP`, `TASK_TYPE_META`, `TASK_SHELLS` builder
- [ ] `backend/validators/taskValidators.js`: validation case
- [ ] `backend/controllers/sanitizeTaskShape.js`: normalize case
- [ ] `shared/taskPlayability.js`: playability case
- [ ] `shared/taskTypes.js`: subject-fit matrix entry

### Phase 1 — Safety pipeline + curated library (4–5 days)

- [ ] `backend/services/truthOrDare/safetyPatterns.js` v1 (versioned)
- [ ] `backend/services/truthOrDare/moderation.js`: 5-layer pipeline
- [ ] `backend/data/truthOrDareEvergreen.json`: 300 hand-vetted entries
  (12 subjects × 5 categories × 5 grade-bands, roughly)
- [ ] `backend/services/truthOrDare/recentChallenges.js`: bloom filter
- [ ] Unit tests for each safety layer; ~30 test cases per layer

### Phase 2 — AI generator (2–3 days)

- [ ] `backend/services/truthOrDare/generator.js`: prompt assembly +
  LLM call + retry loop
- [ ] System prompt template + user prompt template
- [ ] Schema validator (5 retries → fallback)
- [ ] Subject matrix integration
- [ ] Per-grade-band tunings
- [ ] Caching layer (5-minute LRU)

### Phase 3 — Round state machine + sockets (3–4 days)

- [ ] `backend/services/truthOrDare/orchestrator.js`: state machine
- [ ] `backend/services/truthOrDare/selector.js`: weighted-random picker
- [ ] Socket events server-side (all listed in §8)
- [ ] `TruthOrDareSession` + `TruthOrDareRound` schemas
- [ ] Pre-generation queue (next round prepped in background)

### Phase 4 — Student renderer (4–5 days)

- [ ] `student-app/src/components/tasks/types/TruthOrDareTask.jsx` —
  full component hierarchy from §6
- [ ] PlayerSpotlightWheel (slot-machine randomizer animation)
- [ ] ChoicePhase + ChallengeCard + PerformingHud + JudgmentPanel +
  RewardReveal sub-components
- [ ] Audio: drumroll, victory, gentle-fail, pop, sparkle
- [ ] Reduced-motion + high-contrast variants
- [ ] Register in `TaskRunner.jsx`
- [ ] Demo entry in `student-app/src/demoTasks.js`

### Phase 5 — Teacher console (3 days)

- [ ] `teacher-app/src/pages/LiveSession.jsx`: TruthOrDareTeacherConsole
  panel — peek window, override controls, settings sliders, manual
  inject composer
- [ ] Reuse the existing fixed-position bottom-right console pattern
  from Quest/Whodunnit/WhatAmI (no sidebar collision)
- [ ] Gate visibility on `taskset.truthOrDareEnabled === true || todActive`
- [ ] Session-defaults pull from `TruthOrDareTeacherProfile`

### Phase 6 — Overlay injection engine (2 days)

- [ ] Mid-session injection scheduler in `backend/index.js` (or a
  dedicated `services/truthOrDare/scheduler.js`)
- [ ] Triggers: time-since-last, engagement dip detection, score parity,
  teacher manual
- [ ] Insertion logic that pauses the current task, runs T-or-D, then
  resumes (similar to the duel mechanic's interrupt pattern)
- [ ] Per-taskset config field `truthOrDareEnabled` + frequency

### Phase 7 — Modes implementation (4 days)

- [ ] Individual + Team + Duel (default trio) — built into the core
- [ ] Lightning Round — time-compressed loop, no spotlight animation
- [ ] Historical Roleplay — character pre-load + prompt binding
- [ ] Debate Dare — defend-only category lock + position assignment
- [ ] Mystery/Spy — secret-mission overlay (synergy with Whodunnit)
- [ ] Whole-Class — single shared challenge, majority verdict
- [ ] Teacher Injection — queue-first selection priority
- [ ] Silent / Stationary / Movement — mode flags that retune the
  AI prompt + filter dare categories

### Phase 8 — Cross-system integration (2 days)

- [ ] Quest economy: T-or-D pass = +N coins
- [ ] Escape Room: T-or-D pass = +1 hint token
- [ ] Whodunnit: spy-mode T-or-D rounds count as accusation evidence
- [ ] LevelUp: T-or-D rounds can be LevelUp candidates
- [ ] Duel: T-or-D mode = `duel`-style alternative when score parity
  triggers

### Phase 9 — Analytics dashboards (3 days)

- [ ] `TruthOrDareAnalytics` writes
- [ ] Teacher insights page (`/teacher/truth-or-dare/insights`)
- [ ] Admin health page (`/admin/truth-or-dare/health`)
- [ ] Per-prompt detail page (top 50 used + top 20 flagged)
- [ ] CSV/XLSX export

### Phase 10 — Accessibility verification (2 days)

- [ ] Screen-reader pass; aria-live correctness verified
- [ ] Reduced-motion compliance check
- [ ] Keyboard-only navigation through entire flow
- [ ] High-contrast palette validation
- [ ] Bilingual prompt mode (ES/ZH/AR/FR side-by-side rendering)
- [ ] Silent mode + No-camera mode end-to-end tested
- [ ] Cooperative whole-class mode end-to-end tested

### Phase 11 — Testing (3 days)

- [ ] Unit tests: validator, sanitizer, moderation pipeline, selector,
  scoring (extend `backend/tests/test-new-feature-types.mjs`)
- [ ] Integration test: full round from socket trigger → verdict
- [ ] Safety regression suite: 200 attempted-jailbreak prompts, all must
  be caught by the pipeline
- [ ] Load test: 30 concurrent rooms running T-or-D simultaneously
- [ ] OpenAI cost-per-session budget verified

### Phase 12 — Soft launch (1 week)

- [ ] Enable for 3 friendly pilot classrooms across grade bands
- [ ] Daily review of flagged rounds + teacher feedback
- [ ] Tune subject matrix + safety patterns based on real data
- [ ] Iterate on curated library based on what AI doesn't cover well

### Phase 13 — Public launch

- [ ] Feature page section on `/features` with sample-round walkthrough
- [ ] Pedagogy page update: add T-or-D to Bloom's coverage matrix
- [ ] Sample-sessions page snapshot
- [ ] Teacher onboarding tooltip on first use
- [ ] Demoset includes T-or-D in the gen rotation

### Estimated total

**~30–35 engineering days** end-to-end. Could compress to ~20 days with
parallel work on Phase 1 (safety) and Phase 4 (student UI) since
they touch different files.

### Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Moderation false-positives kill engagement | medium | Curated library fallback; teacher peek + override |
| Moderation false-negatives create a viral safety incident | low (mitigated) | 5-layer pipeline; OpenAI moderation API; manual library review; teacher peek |
| OpenAI cost spikes per-session | medium | Pre-generation queue + 5-min cache; curated library default for stable subjects |
| Cooldown logic feels unfair in small classes | medium | Configurable cooldown windows; fallback to non-cooldown weighting in <6-team classes |
| Audience-vote bullying / popularity contests | medium | Teacher-judgment default in any class flagged via teacher profile; reaction-only mode (no scoring vote) for sensitive classes |
| Mic / camera permission friction | high | Every mode has a silent / text-only path that doesn't need either |
| Latency on AI generation breaking the round flow | medium | Pre-generation queue; loading-state UX; curated library instant-path |

---

## Companion appendix — file checklist for review

```
shared/taskTypes.js                            (modified)
shared/taskPlayability.js                      (modified)
backend/validators/taskValidators.js           (modified)
backend/controllers/sanitizeTaskShape.js       (modified)
backend/controllers/mainTasksetController.js   (modified: eligible-pool)
backend/controllers/truthOrDareController.js   (new)
backend/services/truthOrDare/generator.js      (new)
backend/services/truthOrDare/moderation.js     (new)
backend/services/truthOrDare/safetyPatterns.js (new)
backend/services/truthOrDare/recentChallenges.js (new)
backend/services/truthOrDare/verdictAi.js      (new)
backend/services/truthOrDare/selector.js       (new)
backend/services/truthOrDare/orchestrator.js   (new)
backend/services/truthOrDare/scheduler.js      (new)
backend/services/truthOrDare/analytics.js      (new)
backend/data/truthOrDareEvergreen.json         (new — ~300 entries)
backend/models/TruthOrDareSession.js           (new)
backend/models/TruthOrDareRound.js             (new)
backend/models/TruthOrDareTeacherProfile.js    (new)
backend/models/TruthOrDareAnalytics.js         (new)
backend/routes/truthOrDare.js                  (new)
backend/index.js                               (modified: route mount + socket handlers + scheduler tick)
backend/tests/test-new-feature-types.mjs       (modified: T-or-D suite)

student-app/src/components/tasks/types/TruthOrDareTask.jsx  (new)
student-app/src/components/tasks/types/truth-or-dare/*       (new: subcomponents)
student-app/src/components/tasks/TaskRunner.jsx              (modified: register case)
student-app/src/demoTasks.js                                 (modified: demo entry)
student-app/public/sounds/tod-*.mp3                          (new: 6 audio assets)

teacher-app/src/pages/LiveSession.jsx                        (modified: console)
teacher-app/src/components/truthOrDare/*                     (new: console UI)

frontend/src/app/features/page.tsx                           (modified: section)
frontend/src/app/pedagogy/page.tsx                           (modified: Bloom's mapping)
frontend/src/app/sample-sessions/page.tsx                    (modified: T-or-D snapshot)
```

---

This doc is the contract. Implementation should follow the phases in
order with the safety pipeline + curated library completed before any
AI generation goes live to students. The single hardest engineering
problem is the safety pipeline; the single hardest design problem is
the spotlight-suspense UX. Both must be production-quality at launch.
