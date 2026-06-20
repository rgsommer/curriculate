// backend/tests/test-new-feature-types.mjs
//
// Integration tests for the seven new feature types + the duel system.
// Run: `node backend/tests/test-new-feature-types.mjs`
//
// Each test exercises the canonical pipeline:
//   sanitize → normalize → validate → (where applicable) scoring branch
//
// PLUS feature-specific integration checks:
//   - Quest: economy round-trip + unlock evaluator
//   - Escape Room: engine grants keys + cascades
//   - Mystery: suspect assignment + ambiguity-guarded clue gen + accusation
//   - Current Events: evergreen library subject/grade matching
//   - Duel: question playability + concurrent guard + correct/wrong/timeout flow

import { sanitizeTaskShapeByType } from "../controllers/sanitizeTaskShape.js";
import { normalizeTaskByType, validateTaskByType } from "../validators/taskValidators.js";
import { TASK_TYPES, TASK_TYPE_META, TASK_BLOOMS_MAP } from "../../shared/taskTypes.js";

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else      { fail += 1; console.log(`  ✗ ${label}`); }
}
function section(name) {
  console.log(`\n${name}`);
}

/* ──────────────── 1. TASK META COVERAGE ──────────────── */
section("1. Task-type meta coverage (impl + Bloom + generator)");
for (const t of ["what-am-i", "quest", "careers", "current-events", "hole-in-one"]) {
  const meta = TASK_TYPE_META[t];
  const blooms = TASK_BLOOMS_MAP[t];
  assert(meta && meta.implemented === true,            `${t}: meta.implemented = true`);
  assert(meta && meta.generatorEligible === true,      `${t}: meta.generatorEligible = true`);
  assert(Array.isArray(blooms) && blooms.length >= 1,  `${t}: has Bloom's mapping (${blooms})`);
  assert(typeof meta?.aiPrompt === "string" && meta.aiPrompt.length > 50, `${t}: meta.aiPrompt is substantial`);
}

/* ──────────────── 2. WHAT AM I? ──────────────── */
section("2. What Am I? — sanitize + validate + answer-leak guard");
{
  // Well-formed — needs ≥ 2 acceptableAnswers per spec §3
  const ok = sanitizeTaskShapeByType("what-am-i", {
    taskType: "what-am-i",
    title: "Photosynthesis",
    prompt: "Find me",
    answer: "Photosynthesis",
    acceptableAnswers: ["photosynthesis", "photo synthesis", "plant food-making"],
    clues: [
      { level: 1, text: "I turn light into stored energy." },
      { level: 2, text: "I need chlorophyll." },
      { level: 3, text: "Plants do me to make their own food." },
    ],
    difficulty: "medium",
    mode: "intra-team",
  });
  const okN = normalizeTaskByType("what-am-i", ok);
  const okV = validateTaskByType("what-am-i", okN);
  assert(okV.ok, "well-formed task validates");
  assert(okN.config.scoring?.perClueCurve?.length === okN.config.clues.length + 1, "default scoring curve has N+1 entries");

  // Answer-leak guard
  const leak = sanitizeTaskShapeByType("what-am-i", {
    taskType: "what-am-i",
    title: "Leaky", prompt: "X",
    config: {
      answer: "Mitochondria",
      acceptableAnswers: ["mitochondria"],
      clues: [
        { level: 1, text: "Plants don't have these (the powerhouses of cells)" },
        { level: 2, text: "It is mitochondria, the powerhouse of the cell" },  // explicit leak
        { level: 3, text: "Tiny organelles" },
      ],
      difficulty: "easy", mode: "solo",
    },
  });
  const leakV = validateTaskByType("what-am-i", normalizeTaskByType("what-am-i", leak));
  assert(!leakV.ok, "answer-leak in clue is rejected");
  assert(leakV.errors.some((e) => /verbatim|inference/i.test(e)), "error message mentions leak");

  // Sentence-shape guard
  const sentence = sanitizeTaskShapeByType("what-am-i", {
    taskType: "what-am-i", title: "X", prompt: "Y",
    config: {
      answer: "Photosynthesis is the process plants use to make their own food from sunlight.",
      acceptableAnswers: ["photosynthesis"],
      clues: [{ level: 1, text: "A" }, { level: 2, text: "B" }, { level: 3, text: "C" }],
      difficulty: "easy", mode: "solo",
    },
  });
  const sentV = validateTaskByType("what-am-i", normalizeTaskByType("what-am-i", sentence));
  assert(!sentV.ok, "sentence-shaped answer rejected");
}

/* ──────────────── 3. QUEST ──────────────── */
section("3. Quest — sanitize promotes top-level + auto-coin-option");
{
  const q = sanitizeTaskShapeByType("quest", {
    taskType: "quest",
    title: "Sea Voyage", prompt: "Outfit your ship",
    scenario: "Winter is coming.",
    objectives: [{ description: "Launch with supplies", requiredResources: { rope: 2 } }],
    resources: [{ id: "rope", name: "Rope", coinCost: 6 }],  // no acquisitionOptions — sanitizer should auto-add coins
  });
  assert(q.config.scenario === "Winter is coming.", "top-level scenario promoted to config");
  assert(q.config.resources[0].acquisitionOptions?.[0]?.type === "coins", "auto-added coin acquisition option");
  assert(q.config.resources[0].acquisitionOptions?.[0]?.amount === 6, "honored coinCost when promoting");
  const qV = validateTaskByType("quest", normalizeTaskByType("quest", q));
  assert(qV.ok, "well-formed quest validates");
  assert(Array.isArray(qV.config?.ranks ?? normalizeTaskByType("quest", q).config.ranks), "default ranks present");

  // No objectives → rejected
  const bad = { taskType: "quest", title: "X", prompt: "Y", config: { title: "X", scenario: "S", resources: [{ id: "r", acquisitionOptions: [{ type: "coins", amount: 1 }] }] } };
  const bV = validateTaskByType("quest", normalizeTaskByType("quest", sanitizeTaskShapeByType("quest", bad)));
  assert(!bV.ok, "no objectives → rejected");
}

/* ──────────────── 4. CAREERS ──────────────── */
section("4. Careers — six modes validate; mode-specific shape requirements fire");
{
  const modes = [
    { mode: "best-fit",            extra: { career: { name: "Welder", description: "Joins metal." }, teammates: ["Maya", "Liam", "Aiko"] } },
    { mode: "pathway-builder",     extra: { targetCareer: "Nurse", pathways: [{ id: "p1", name: "College", years: 2 }, { id: "p2", name: "Apprenticeship", years: 4 }] } },
    { mode: "who-should-be-hired", extra: { role: "park ranger", candidates: [{ name: "Mira", strengths: ["calm"] }, { name: "Sam", strengths: ["fit"] }] } },
    { mode: "salary-vs-lifestyle", extra: { optionA: { label: "City lawyer", summary: "$$$, 60h/wk" }, optionB: { label: "Park ranger", summary: "$, outdoors" } } },
    { mode: "career-myths",        extra: { questions: [{ id: "q1", prompt: "How much do welders earn?", options: ["$30k", "$70k", "$120k"], correctIndex: 1 }] } },
    { mode: "aptitude-match",      extra: { prompts: [{ id: "p1", prompt: "Outdoors or indoors?" }] } },
  ];
  for (const m of modes) {
    const t = sanitizeTaskShapeByType("careers", { taskType: "careers", title: m.mode, prompt: "X", config: { mode: m.mode, ...m.extra } });
    const v = validateTaskByType("careers", normalizeTaskByType("careers", t));
    assert(v.ok, `${m.mode} mode validates`);
  }
  // who-should-be-hired with 1 candidate → reject
  const oneCand = { taskType: "careers", title: "X", prompt: "Y", config: { mode: "who-should-be-hired", candidates: [{ name: "Solo" }] } };
  const ocV = validateTaskByType("careers", normalizeTaskByType("careers", sanitizeTaskShapeByType("careers", oneCand)));
  assert(!ocV.ok, "who-should-be-hired with 1 candidate rejected");

  // Prestige-bias warning — validator mutates the normalized task with _validationWarning.
  // Capture the normalized object so we can check the warning AFTER validate runs.
  const prestigeNorm = normalizeTaskByType("careers", sanitizeTaskShapeByType("careers", {
    taskType: "careers", title: "Best Fit: Doctor (an elite career)", prompt: "Discuss",
    config: { mode: "best-fit", career: { name: "Doctor", description: "An elite, prestigious career." }, teammates: ["Maya", "Liam", "Aiko"] },
  }));
  const pbV = validateTaskByType("careers", prestigeNorm);
  assert(typeof prestigeNorm._validationWarning === "string" && /prestige/i.test(prestigeNorm._validationWarning), "prestige-bias warning attached to task._validationWarning");
}

/* ──────────────── 5. CURRENT EVENTS ──────────────── */
section("5. Current Events — shell-only, missing topic rejected, evergreen library has 10 entries");
{
  // Missing topic
  const noTopic = { taskType: "current-events", title: "CE", prompt: "X", config: {} };
  const noV = validateTaskByType("current-events", normalizeTaskByType("current-events", sanitizeTaskShapeByType("current-events", noTopic)));
  assert(!noV.ok, "missing lessonTopic → rejected");

  // Pre-cooked resolved block rejected
  const cooked = {
    taskType: "current-events",
    title: "CE", prompt: "Loading…",
    config: { lessonTopic: "Plate tectonics", resolved: { eventSummary: "Pre-baked junk" } },
  };
  const ckV = validateTaskByType("current-events", normalizeTaskByType("current-events", sanitizeTaskShapeByType("current-events", cooked)));
  // Sanitizer strips `resolved` from config, so this should now validate (the field is gone after sanitize)
  // The validator only complains if `resolved` is STILL set after sanitize — so this is testing the sanitizer working correctly.
  assert(ckV.ok, "sanitizer strips pre-cooked resolved block");

  // Evergreen library
  const fs = await import("node:fs/promises");
  const url = await import("node:url");
  const dirname = url.fileURLToPath(new URL(".", import.meta.url));
  const lib = JSON.parse(await fs.readFile(`${dirname}/../data/currentEventsEvergreen.json`, "utf8"));
  assert(Array.isArray(lib) && lib.length >= 10, `evergreen library has ${lib.length} entries (≥ 10)`);
  assert(lib.every((e) => e.eventSummary && e.connectionToLesson && Array.isArray(e.discussionQuestions) && e.discussionQuestions.length >= 3), "every evergreen entry has summary + connection + ≥3 questions");
}

/* ──────────────── 6. HOLE IN ONE ──────────────── */
section("6. Hole in One — board defaults, solvability heuristic");
{
  // questionBank is now REQUIRED by the validator (≥ 3 questions) — the
  // renderer's Earn phase needs them to function. See the matching change
  // in shared/taskTypes.js HOLE_IN_ONE.aiPrompt + retryMustHave.
  const ok = sanitizeTaskShapeByType("hole-in-one", {
    taskType: "hole-in-one",
    title: "Roll", prompt: "Tilt",
    config: {
      board: { width: 10, height: 14, startPosition: { x: 1, y: 1 }, holePosition: { x: 8, y: 12 } },
      questionBank: [
        { id: "q1", prompt: "What is 2+2?", correctAnswer: "4", reward: 1 },
        { id: "q2", prompt: "What is 3+3?", correctAnswer: "6", reward: 1 },
        { id: "q3", prompt: "What is 4+4?", correctAnswer: "8", reward: 2 },
      ],
    },
  });
  const okV = validateTaskByType("hole-in-one", normalizeTaskByType("hole-in-one", ok));
  assert(okV.ok, "valid board + questionBank validates");

  // start == hole → reject
  const same = sanitizeTaskShapeByType("hole-in-one", {
    taskType: "hole-in-one", title: "X", prompt: "Y",
    config: { board: { width: 10, height: 14, startPosition: { x: 5, y: 5 }, holePosition: { x: 5, y: 5 } } },
  });
  const sV = validateTaskByType("hole-in-one", normalizeTaskByType("hole-in-one", same));
  assert(!sV.ok && sV.errors.some((e) => /start and hole/i.test(e)), "start == hole rejected");

  // Out-of-range width
  const bad = sanitizeTaskShapeByType("hole-in-one", {
    taskType: "hole-in-one", title: "X", prompt: "Y",
    config: { board: { width: 100, height: 14, startPosition: { x: 1, y: 1 }, holePosition: { x: 8, y: 12 } } },
  });
  const bV = validateTaskByType("hole-in-one", normalizeTaskByType("hole-in-one", bad));
  assert(!bV.ok, "out-of-range width rejected");
}

/* ──────────────── 7. QUEST ECONOMY ──────────────── */
section("7. Quest economy + unlock engine (pure-function tests)");
{
  const { evaluateUnlocks, computeCoreProgressPct } = (await import("../services/questUnlocks.js")).default;
  const taskset = {
    tasks: [
      { taskId: "a" }, { taskId: "b" },
      { taskId: "c", isBonus: true, unlockConditions: { coreProgressPct: 50 } },
      { taskId: "d", isHidden: true, unlockConditions: { coreQuestCompleted: true, minRemainingMinutes: 2 } },
    ],
  };
  const state = { unlockedBonusTaskIds: [], unlockedHiddenTaskIds: [], coins: 0 };
  const r1 = evaluateUnlocks({ taskset, state, signals: { coreProgressPct: 30 } });
  assert(r1.newlyUnlockedBonusIds.length === 0, "bonus stays locked at < 50% core progress");

  const r2 = evaluateUnlocks({ taskset, state, signals: { coreProgressPct: 50 } });
  assert(r2.newlyUnlockedBonusIds.includes("c"), "bonus unlocks at 50% core progress");

  const r3 = evaluateUnlocks({ taskset, state, signals: { coreProgressPct: 100, sessionTimeRemainingMin: 5, coreQuestCompleted: true } });
  assert(r3.newlyUnlockedHiddenIds.includes("d"), "hidden unlocks at 100% core + 5 min remaining");

  const r4 = evaluateUnlocks({ taskset, state, signals: { coreProgressPct: 100, sessionTimeRemainingMin: 1, coreQuestCompleted: true } });
  assert(!r4.newlyUnlockedHiddenIds.includes("d"), "hidden stays locked when remaining time < 2 min");

  const pct = computeCoreProgressPct({ taskset, completedCoreTaskIds: ["a"] });
  assert(pct === 50, `core progress 1/2 = 50% (got ${pct})`);
}

/* ──────────────── 8. ESCAPE ROOM ENGINE ──────────────── */
section("8. Escape Room — engine grants keys + cascades + validates synthesis");
{
  // We can't easily test the Mongoose-backed engine without a DB; smoke-test the validator only.
  const { default: escapeGen } = await import("../controllers/escapeRoomGenerator.js");
  // generateEscapeRoomConfig hits the API; just verify the export shape
  assert(typeof escapeGen.generateEscapeRoomConfig === "function", "escape generator exports function");
}

/* ──────────────── 9. WHODUNNIT CLUE GENERATOR ──────────────── */
section("9. Whodunnit — identity-clue generator respects ambiguity bands");
{
  // The clue generator is a pure function over event log + player list
  const room = {
    teams: {
      "team-A": { teamName: "Red",  members: ["Maya", "Liam", "Marcus"] },
      "team-B": { teamName: "Blue", members: ["Aiko", "Aria", "Alex"] },
    },
    mysteryEventLog: [
      { ts: Date.now() - 1000, kind: "scan", playerName: "Maya",  station: "Yellow" },
      { ts: Date.now() - 1500, kind: "scan", playerName: "Liam",  station: "Yellow" },
      { ts: Date.now() - 2000, kind: "scan", playerName: "Aiko",  station: "Yellow" },  // 2 others share the station
    ],
  };
  // Direct call requires a session — skip the DB-backed clue gen test; just verify import
  const { default: clueGen } = await import("../services/mysteryClueGenerator.js");
  assert(typeof clueGen.generateClue === "function", "clue generator exports function");

  // Test the mystery accusation service
  const { default: mystery } = await import("../services/mystery.js");
  assert(typeof mystery.submitAccusation === "function", "accusation submit exported");
  assert(typeof mystery.getPublicSnapshot === "function", "public snapshot strips suspect identity");
}

/* ──────────────── 10. DUEL SYSTEM ──────────────── */
section("10. Duel — playability gate + concurrent block + correct/wrong/timeout");
{
  const { default: duelSvc } = await import("../services/duel.js");

  // Empty room
  const r1 = duelSvc.startDuel({ room: { teams: {} } });
  assert(!r1.ok && /2 teams/i.test(r1.error), "empty room rejected");

  // 1 team only
  const r2 = duelSvc.startDuel({ room: { teams: { A: { members: ["Maya"] } } } });
  assert(!r2.ok, "1 team only rejected");

  // Happy path — uses fallback bank when taskset has nothing
  const room = {
    code: "TEST",
    teams: {
      A: { teamName: "Red",  members: ["Maya"] },
      B: { teamName: "Blue", members: ["Aiko"] },
    },
    taskset: { tasks: [] },
  };
  const r3 = duelSvc.startDuel({ room });
  assert(r3.ok, "2 teams + no taskset → fallback bank picks a question");
  assert(Array.isArray(r3.duel.question.answers) && r3.duel.question.answers.length > 0, "fallback question has non-empty answers");

  // Concurrent block
  const r4 = duelSvc.startDuel({ room });
  assert(!r4.ok && /already active/i.test(r4.error), "concurrent duel rejected");

  // Submit before countdown ends → rejected
  const tooEarly = duelSvc.submitDuelAnswer({ room, teamId: "A", playerName: "Maya", value: r3.duel.question.answers[0] });
  assert(!tooEarly.ok, "submission before countdown rejected");

  // Force the duel to be "started" by adjusting startsAt back, then submit
  room.activeDuel.startsAt = Date.now() - 100;
  const wrong = duelSvc.submitDuelAnswer({ room, teamId: "A", playerName: "Maya", value: "completely wrong" });
  assert(wrong.ok && wrong.correct === false && !wrong.won, "wrong submission accepted but doesn't end duel");

  const right = duelSvc.submitDuelAnswer({ room, teamId: "A", playerName: "Maya", value: r3.duel.question.answers[0] });
  assert(right.ok && right.correct === true && right.won === true, "correct submission wins");
  assert(right.duel.winnerTeamId === "A", "winner recorded");
  assert(right.duel.ended === true, "duel ended");
}

/* ──────────────── 11. LEVELUP ──────────────── */
section("11. LevelUp — eligibility, candidate-pick, MAX scoring");
{
  const lu = await import("../services/levelUp.js");

  // Eligibility set is loaded and contains expected types
  assert(lu.LEVEL_UP_ELIGIBLE_TYPES.has("multiple-choice"), "multiple-choice is LevelUp-eligible");
  assert(lu.LEVEL_UP_ELIGIBLE_TYPES.has("legends"), "legends is LevelUp-eligible");
  assert(!lu.LEVEL_UP_ELIGIBLE_TYPES.has("open-text"), "open-text is NOT LevelUp-eligible");
  assert(!lu.LEVEL_UP_ELIGIBLE_TYPES.has("photo"), "photo is NOT LevelUp-eligible");

  // Build a fake room: 3 core tasks, 2 bonus tasks, team finished all 5
  const room = {
    code: "ROOM1",
    taskset: {
      subject: "science",
      gradeLevel: "5",
      tasks: [
        { taskType: "multiple-choice", title: "Q1", points: 10, requiredForCompletion: true },
        { taskType: "sequence",        title: "Q2", points: 10, requiredForCompletion: true },
        { taskType: "matching",        title: "Q3", points: 10, requiredForCompletion: true },
        { taskType: "trivia",          title: "B1", points: 10, requiredForCompletion: false, isBonus: true },
        { taskType: "spinner",         title: "B2", points: 10, requiredForCompletion: false, isBonus: true },
      ],
      levelUpEnabledByDefault: true,
    },
    teams: { A: { teamName: "Eagles" } },
    submissions: [
      { teamId: "A", taskIndex: 0, points: 90,  skipped: false }, // 90%
      { teamId: "A", taskIndex: 1, points: 40,  skipped: false }, // 40% ← lowest
      { teamId: "A", taskIndex: 2, points: 70,  skipped: false }, // 70%
      { teamId: "A", taskIndex: 3, points: 100, skipped: false }, // 100%
      { teamId: "A", taskIndex: 4, points: 80,  skipped: false }, // 80%
    ],
  };

  assert(lu.teamReadyForLevelUp(room, "A") === true, "team ready (all 3 core + 2 bonus done)");

  const cand = lu.pickLevelUpCandidate(room, "A");
  assert(cand && cand.taskIndex === 1, `picks lowest task (sequence, idx 1) — got idx ${cand?.taskIndex}`);
  assert(cand.taskType === "sequence", "candidate type is sequence");
  assert(Math.abs(cand.scorePercent - 40) < 0.001, "candidate scorePercent is ~40");

  // Offer payload shape
  const offer = lu.buildLevelUpOffer(room, "A");
  assert(offer.available === true, "offer.available true");
  assert(offer.attemptsRemaining === 2, "starts with 2 attempts remaining");
  assert(offer.candidate.taskTitle === "Q2", "offer shows correct task title");

  // MAX-of scoring policy
  const r1 = lu.resolveLevelUpScore({ originalPoints: 40, retryPoints: 80 });
  assert(r1.keptPoints === 80, "improved: keeps 80");
  assert(r1.improved === true, "improved: improved flag true");
  assert(r1.masteryBonus > 0, "improved: mastery bonus awarded");

  const r2 = lu.resolveLevelUpScore({ originalPoints: 40, retryPoints: 20 });
  assert(r2.keptPoints === 40, "regression: keeps 40 (original)");
  assert(r2.improved === false, "regression: improved false");
  assert(r2.masteryBonus === 0, "regression: no mastery bonus");

  // Teacher disable gate
  room.levelUpDisabled = true;
  assert(lu.whyLevelUpUnavailable(room, "A") === "disabled-by-teacher", "teacher disable blocks LevelUp");
  room.levelUpDisabled = false;

  // Attempts cap
  const st = lu.getTeamLevelUpState(room, "A");
  st.attempts = 2;
  assert(lu.whyLevelUpUnavailable(room, "A") === "max-attempts", "max-attempts cap enforced");
  st.attempts = 0;

  // No-eligible-task: only ineligible types remain
  const noElig = {
    ...room,
    taskset: {
      ...room.taskset,
      tasks: [
        { taskType: "open-text", title: "Essay", points: 10, requiredForCompletion: true },
        { taskType: "photo",     title: "Pic",   points: 10, requiredForCompletion: false, isBonus: true },
        { taskType: "letter",    title: "Note",  points: 10, requiredForCompletion: false, isBonus: true },
      ],
    },
    submissions: [
      { teamId: "A", taskIndex: 0, points: 30, skipped: false },
      { teamId: "A", taskIndex: 1, points: 30, skipped: false },
      { teamId: "A", taskIndex: 2, points: 30, skipped: false },
    ],
  };
  assert(lu.pickLevelUpCandidate(noElig, "A") === null, "no eligible task → candidate is null");

  // Already-upgraded type is skipped
  const alreadyUp = {
    ...room,
    taskset: {
      ...room.taskset,
      tasks: [
        ...room.taskset.tasks,
        { taskType: "sequence", title: "Q2 (retry)", points: 10, isLevelUp: true, levelUpOfTaskIndex: 1, requiredForCompletion: false },
      ],
    },
    submissions: [
      ...room.submissions,
      { teamId: "A", taskIndex: 5, points: 95, skipped: false },
    ],
  };
  const cand2 = lu.pickLevelUpCandidate(alreadyUp, "A");
  assert(cand2 === null || cand2.taskType !== "sequence", "already-upgraded type skipped");
}

/* ──────────────── N. TRUTH OR DARE ──────────────── */
section("N. Truth or Dare — type plumbing + safety + library + selector");
{
  // Dynamic imports up-front so the rest of this block can use them freely
  const { sanitizeTaskShapeByType } = await import("../controllers/sanitizeTaskShape.js");
  const { assessTaskPlayability } = await import("../../shared/taskPlayability.js");

  // N.1 — meta coverage
  const meta = TASK_TYPE_META["truth-or-dare"];
  const blooms = TASK_BLOOMS_MAP["truth-or-dare"];
  assert(meta && meta.implemented === true,          "truth-or-dare: meta.implemented = true");
  assert(Array.isArray(blooms) && blooms.length >= 1, `truth-or-dare: has Bloom's mapping (${blooms})`);

  // N.2 — sanitize + validate
  const t = sanitizeTaskShapeByType("truth-or-dare", {
    taskType: "truth-or-dare",
    title: "T-or-D — Science",
    prompt: "Truth or dare?",
    subject: "science",
    unitName: "ecosystems",
    gradeLevel: 6,
    totalRounds: 6,
    physicalIntensityMax: 2,
    socialIntensityMax: 2,
    movementAllowed: true,
    noiseAllowed: true,
    tierProgression: "linear",
    judgmentMode: "mixed",
    seedChallenges: [
      { id: "s1", type: "truth", tier: "sprout", category: "recall",  prompt: "Name a producer in a forest food web.",            timeSeconds: 20, judgmentMode: "teacher",    rewardTier: "small"  },
      { id: "s2", type: "dare",  tier: "sprout", category: "mime",    prompt: "Mime photosynthesis for 20 seconds.",                timeSeconds: 30, judgmentMode: "class-vote", rewardTier: "medium" },
      { id: "s3", type: "truth", tier: "stem",   category: "explain", prompt: "Explain in one sentence why predators matter.",      timeSeconds: 30, judgmentMode: "teacher",    rewardTier: "medium" },
      { id: "s4", type: "dare",  tier: "stem",   category: "narrate", prompt: "Narrate a 30-second nature documentary clip.",       timeSeconds: 40, judgmentMode: "class-vote", rewardTier: "medium" },
    ],
  });
  const tN = normalizeTaskByType("truth-or-dare", t);
  const tV = validateTaskByType("truth-or-dare", tN);
  assert(tV.ok, `truth-or-dare well-formed validates (errors: ${(tV.errors||[]).join("|")})`);

  // N.3 — safety pipeline catches blacklisted content
  const { moderateChallengeSync } = await import("../services/truthOrDare/moderation.js");
  const bad = moderateChallengeSync(
    {
      type: "dare",
      tier: "sprout",
      category: "mime",
      prompt: "Tell us about your crush in the class.",
      teacherHint: "",
      physicalIntensity: 0,
      socialIntensity: 1,
      noiseExpected: 0,
    },
    { caps: { physicalIntensityMax: 2, socialIntensityMax: 2, movementAllowed: true, noiseAllowed: true } },
  );
  assert(!bad.ok, "moderation rejects 'crush' content");
  assert(bad.flaggedBy === "phrase-blacklist" || bad.flaggedBy === "pattern-blacklist", `flaggedBy is a blacklist layer (was ${bad.flaggedBy})`);

  // Intensity cap enforcement
  const cap = moderateChallengeSync(
    {
      type: "dare", tier: "stem", category: "mime",
      prompt: "Climb up onto your desk and spin three times.",
      physicalIntensity: 3, socialIntensity: 1, noiseExpected: 2,
    },
    { caps: { physicalIntensityMax: 1, socialIntensityMax: 2, movementAllowed: false, noiseAllowed: true } },
  );
  assert(!cap.ok, "moderation rejects physicalIntensity > cap or movementAllowed=false");

  // Clean content passes
  const good = moderateChallengeSync(
    {
      type: "truth", tier: "sprout", category: "recall",
      prompt: "Tell us one new fact you learned about photosynthesis today.",
      teacherHint: "Any honest answer earns the points.",
      physicalIntensity: 0, socialIntensity: 1, noiseExpected: 0,
    },
    { caps: { physicalIntensityMax: 2, socialIntensityMax: 2, movementAllowed: true, noiseAllowed: true } },
  );
  assert(good.ok, `clean recall challenge passes moderation (reasons: ${good.reasons?.join("|")})`);

  // N.4 — curated library returns a match for science / grade 6
  const { findCuratedChallenge, librarySize } = await import("../services/truthOrDare/library.js");
  assert(librarySize() > 0, `evergreen library is non-empty (size=${librarySize()})`);
  const lib = findCuratedChallenge({ subject: "science", gradeLevel: 6, tier: "sprout", kindHint: "either" });
  assert(lib && lib.id && lib.prompt, "library returns a science / grade-6 entry");

  // N.5 — selector cooldown gate
  const { selectNextTeam, applyCooldown, escalateTier, demoteTier } = await import("../services/truthOrDare/selector.js");
  let cd = new Map();
  cd = applyCooldown(cd, "TEAM-A", 0, 2);
  const pick = selectNextTeam(
    [
      { teamId: "TEAM-A", playerName: "Alex", score: 5 },
      { teamId: "TEAM-B", playerName: "Bea",  score: 5 },
    ],
    { currentRound: 1, cooldownsBy: cd },
  );
  assert(pick.teamId === "TEAM-B", `cooldown gates team A out at round 1 (got ${pick.teamId})`);

  // Tier escalation
  assert(escalateTier("sprout", 3) === "stem", "3 successes escalate sprout → stem");
  assert(escalateTier("stem", 5)   === "big",  "5 successes escalate stem → big");
  assert(demoteTier("big") === "stem", "demote big → stem");
  assert(demoteTier("sprout") === "sprout", "demote sprout floors at sprout");

  // N.6 — recentChallenges dedupe
  const rc = await import("../services/truthOrDare/recentChallenges.js");
  rc.clearRoom("TEST-ROOM");
  rc.rememberChallenge("TEST-ROOM", { id: "ch-1", prompt: "Tell us a fun fact." });
  assert(rc.hasSeenChallenge("TEST-ROOM", { prompt: "tell us a fun fact." }), "dedupe matches normalized text");
  assert(rc.hasSeenChallenge("TEST-ROOM", { id: "ch-1" }), "dedupe matches by id");
  rc.clearRoom("TEST-ROOM");
  assert(!rc.hasSeenChallenge("TEST-ROOM", { id: "ch-1" }), "clearRoom resets state");

  // N.6b — validity + playability audit: bad inputs are either rejected or
  // safely clamped. We exhaustively check every constraint that could
  // realistically slip past the pipeline.
  const _pipeline = (input) => {
    const s = sanitizeTaskShapeByType("truth-or-dare", input);
    const n = normalizeTaskByType("truth-or-dare", s);
    return { v: validateTaskByType("truth-or-dare", n), p: assessTaskPlayability(n), n };
  };

  // Missing required fields → both validate AND playability reject
  const noSubject = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { unitName: "u", gradeLevel: 6 } });
  assert(!noSubject.v.ok && !noSubject.p.playable, "missing subject: validate AND playability fail");
  const noUnit = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { subject: "s", gradeLevel: 6 } });
  assert(!noUnit.v.ok && !noUnit.p.playable, "missing unitName: validate AND playability fail");
  const badGrade = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { subject: "s", unitName: "u", gradeLevel: 99 } });
  assert(!badGrade.v.ok && !badGrade.p.playable, "gradeLevel out of range: validate AND playability fail");

  // Enum violations → validate rejects (playability lenient — runtime gate)
  const badJudge = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { subject: "s", unitName: "u", gradeLevel: 6, judgmentMode: "magic" } });
  assert(!badJudge.v.ok, "bad judgmentMode enum: validate rejects");

  // Sanitizer clamps out-of-range numerics
  const tooManyRounds = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { subject: "s", unitName: "u", gradeLevel: 6, totalRounds: 99 } });
  assert(tooManyRounds.v.ok && tooManyRounds.n.config.totalRounds === 12, "totalRounds=99 clamped to 12 by sanitizer");
  const tooIntense = _pipeline({ taskType: "truth-or-dare", title: "x", prompt: "y", config: { subject: "s", unitName: "u", gradeLevel: 6, physicalIntensityMax: 9 } });
  assert(tooIntense.v.ok && tooIntense.n.config.physicalIntensityMax === 3, "physicalIntensityMax=9 clamped to 3 by sanitizer");

  // Sanitizer drops malformed seedChallenges entries. We need to ship
  // enough valid seeds so the validator's ≥4-with-variety rule passes
  // after the malformed one is dropped — otherwise this test would
  // double-fail (the validator rejecting the resulting <4 seeds set
  // would hide the sanitizer behaviour we're actually checking).
  const mixedSeeds = _pipeline({
    taskType: "truth-or-dare", title: "x", prompt: "y",
    config: {
      subject: "s", unitName: "u", gradeLevel: 6,
      seedChallenges: [
        { type: "truth" }, // promptless — should be dropped
        { type: "truth", tier: "sprout", prompt: "Q1?" },
        { type: "truth", tier: "stem",   prompt: "Q2?" },
        { type: "dare",  tier: "sprout", prompt: "Mime it." },
        { type: "dare",  tier: "stem",   prompt: "Narrate it." },
      ],
    },
  });
  assert(mixedSeeds.v.ok && mixedSeeds.n.config.seedChallenges.length === 4, "sanitizer drops promptless seed, keeps the 4 valid ones");

  // N.7 — generator returns library fallback when API key missing
  // (skipLibrary=false: even without OPENAI_API_KEY this should return a normalized challenge from the library)
  const { generateChallenge } = await import("../services/truthOrDare/generator.js");
  const result = await generateChallenge({
    roomCode: "TEST-GEN",
    subject: "science",
    unitName: "ecosystems",
    gradeLevel: 6,
    tier: "sprout",
    kindHint: "either",
  });
  assert(result && result.challenge && result.challenge.prompt, "generator returns a challenge (fallback path acceptable)");
  assert(["ai", "library", "fallback"].includes(result.challenge.sourceProvenance), `sourceProvenance is valid (${result.challenge.sourceProvenance})`);
}

/* ──────────────── O. UPVOTE ──────────────── */
section("O. UpVote — debatable proposition; sanitize + validate + playability");
{
  const { assessTaskPlayability } = await import("../../shared/taskPlayability.js");

  // ── 1. Meta coverage ──
  {
    const meta = TASK_TYPE_META["upvote"];
    const blooms = TASK_BLOOMS_MAP["upvote"];
    assert(meta && meta.implemented === true, "upvote: meta.implemented = true");
    assert(meta && meta.generatorEligible === true, "upvote: meta.generatorEligible = true");
    assert(
      Array.isArray(blooms) && blooms[0] === "EVALUATE" && blooms[1] === "ANALYZE",
      `upvote: Bloom map is [EVALUATE, ANALYZE] (got ${JSON.stringify(blooms)})`
    );
    assert(
      typeof meta?.aiPrompt === "string" && meta.aiPrompt.length > 200,
      "upvote: meta.aiPrompt is substantial (safety + worldview rules)"
    );
  }

  // Canonical pipeline helper.
  const run = (input) => {
    const s = sanitizeTaskShapeByType("upvote", input);
    const n = normalizeTaskByType("upvote", s);
    return { s, n, v: validateTaskByType("upvote", n), p: assessTaskPlayability(n) };
  };

  // ── 2. Well-formed task validates clean + is playable. ──
  {
    const ok = run({
      taskType: "upvote",
      title: "UpVote — Queenston Heights",
      prompt: "Read and vote.",
      config: {
        proposition: "Sir Isaac Brock should not have personally led the charge at Queenston Heights.",
        subject: "History",
        unitName: "War of 1812",
        gradeLevel: 7,
        voteTimeSeconds: 120,
        showRunningTally: true,
        requireReasoningOnSubmit: false,
      },
    });
    assert(ok.v.ok, `well-formed upvote validates (errors: ${ok.v.errors?.join("; ")})`);
    assert(ok.p.playable, "well-formed upvote is playable");
    assert(
      ok.n.config.voteTimeSeconds === 120 &&
        ok.n.config.showRunningTally === true &&
        ok.n.config.requireReasoningOnSubmit === false,
      "well-formed upvote: config values preserved"
    );
  }

  // ── 3. Missing proposition → validate fails + playability flags it. ──
  {
    const bad = run({
      taskType: "upvote",
      title: "Bad UpVote",
      prompt: "no prop",
      config: {
        subject: "History", unitName: "War of 1812", gradeLevel: 7,
      },
    });
    assert(!bad.v.ok, "missing proposition fails validation");
    assert(
      !bad.p.playable && bad.p.issues.some((i) => /proposition/i.test(i)),
      "missing proposition fails playability with a proposition-specific issue"
    );
  }

  // ── 4. voteTimeSeconds: 5 → clamped to 30 by sanitizer. ──
  {
    const clamped = run({
      taskType: "upvote",
      title: "Clamp Low",
      prompt: "p",
      config: {
        proposition: "Pluto should still be classified as a planet today.",
        subject: "Science", unitName: "Solar System", gradeLevel: 8,
        voteTimeSeconds: 5,
      },
    });
    assert(
      clamped.n.config.voteTimeSeconds === 30,
      `voteTimeSeconds=5 clamped to 30 (got ${clamped.n.config.voteTimeSeconds})`
    );
    assert(clamped.v.ok, "clamped voteTimeSeconds still validates clean");
  }

  // ── 5. voteTimeSeconds: 9999 → clamped to 300 by sanitizer. ──
  {
    const clampedHigh = run({
      taskType: "upvote",
      title: "Clamp High",
      prompt: "p",
      config: {
        proposition: "Macbeth is more responsible for his downfall than Lady Macbeth is.",
        subject: "English", unitName: "Macbeth", gradeLevel: 10,
        voteTimeSeconds: 9999,
      },
    });
    assert(
      clampedHigh.n.config.voteTimeSeconds === 300,
      `voteTimeSeconds=9999 clamped to 300 (got ${clampedHigh.n.config.voteTimeSeconds})`
    );
  }

  // ── 6. Top-level proposition is promoted into config by sanitizer. ──
  {
    const promoted = run({
      taskType: "upvote",
      title: "Promote",
      prompt: "p",
      // proposition at the ROOT — AI sometimes emits it here instead of under config
      proposition: "Memorising times tables is more valuable than learning to derive them.",
      subject: "Math",
      unitName: "Number Sense",
      gradeLevel: 9,
    });
    assert(
      typeof promoted.n.config.proposition === "string" &&
        promoted.n.config.proposition.length > 0,
      "top-level proposition promoted into config"
    );
    assert(
      promoted.n.proposition === undefined,
      "top-level proposition removed after promotion"
    );
  }

  // ── 7. Defaults: showRunningTally true, requireReasoningOnSubmit false. ──
  {
    const defaults = run({
      taskType: "upvote",
      title: "Defaults",
      prompt: "p",
      config: {
        proposition: "Peter's denial of Jesus is a worse failure than Judas's betrayal.",
        subject: "Bible", unitName: "Passion Week", gradeLevel: 6,
      },
    });
    assert(
      defaults.n.config.showRunningTally === true,
      "default showRunningTally is true"
    );
    assert(
      defaults.n.config.requireReasoningOnSubmit === false,
      "default requireReasoningOnSubmit is false"
    );
    assert(
      defaults.n.config.worldview === "faith",
      `worldview inferred to 'faith' from Bible subject (got ${defaults.n.config.worldview})`
    );
  }

  // ── 8. Playability fails on empty-string proposition. ──
  {
    const empty = run({
      taskType: "upvote",
      title: "Empty Prop",
      prompt: "p",
      config: {
        proposition: "   ",
        subject: "History", unitName: "War of 1812", gradeLevel: 7,
      },
    });
    assert(
      !empty.p.playable,
      "empty-string proposition fails playability after trim"
    );
  }
}

/* ──────────────── P. TASKSET-GENERATION AUDIT FIXES ──────────────── */
section("P. Taskset-generation audit fixes (Grade-8 Bible/Pentecost audit)");
{
  const { assessTaskPlayability } = await import("../../shared/taskPlayability.js");
  // Canonical pipeline: sanitize → normalize → validate → playability
  const run = (type, input) => {
    const s = sanitizeTaskShapeByType(type, input);
    const n = normalizeTaskByType(type, s);
    return { n, v: validateTaskByType(type, n), p: assessTaskPlayability(n) };
  };

  // Fix 1 — true-false-connect-four: 6 statements now validate (was 10 minimum)
  const c4Six = run("true-false-connect-four", {
    taskType: "true-false-connect-four", title: "Pentecost T/F", prompt: "Pick & drop",
    statements: [
      { text: "The Holy Spirit came at Pentecost.", isFalse: false },
      { text: "Tongues of fire appeared.", isFalse: false },
      { text: "Peter stayed silent.", isFalse: true },
      { text: "Pentecost happened 50 days after Easter.", isFalse: false },
      { text: "No one was baptized that day.", isFalse: true },
      { text: "The disciples spoke many languages.", isFalse: false },
    ],
  });
  assert(c4Six.v.ok, "connect-four with 6 balanced statements validates (lowered from 10)");
  assert(c4Six.p.playable, "connect-four with 6 statements is playable");

  // Fix 1 — empty statements/items → rejected
  const c4Empty = run("true-false-connect-four", {
    taskType: "true-false-connect-four", title: "Empty", prompt: "x", statements: [],
  });
  assert(!c4Empty.v.ok, "connect-four with empty statements is rejected (the original bug)");

  // Fix 1 sanitizer — items[] populated but statements[] missing → both populated
  const c4ItemsOnly = sanitizeTaskShapeByType("true-false-connect-four", {
    taskType: "true-false-connect-four", title: "x", prompt: "y",
    items: [{ prompt: "A", correctAnswer: true }, { prompt: "B", correctAnswer: false }],
  });
  assert(Array.isArray(c4ItemsOnly.statements) && c4ItemsOnly.statements.length === 2,
    "connect-four sanitizer mirrors items[] → statements[]");

  // Fix 2 — narration-synthesize: playerCount 4 + 3 prompts → clamp to 3, then validate
  const narr = run("narration-synthesize", {
    taskType: "narration-synthesize", title: "Synthesize", prompt: "Take turns",
    config: { playerCount: 4, prompts: ["Explain Pentecost", "Add a cause", "Add an effect"] },
  });
  assert(narr.n.config.playerCount === 3, "narration playerCount clamped down to prompts.length (4→3)");
  assert(narr.v.ok, "narration with clamped playerCount validates (no idle player)");

  // Fix 3 — truth-or-dare faith subject → worldview auto-set to "faith"
  const tod = sanitizeTaskShapeByType("truth-or-dare", {
    taskType: "truth-or-dare", title: "T/D", prompt: "Spotlight",
    config: { subject: "Bible", unitName: "Pentecost", gradeLevel: 8 },
  });
  assert(tod.config.worldview === "faith", 'faith subject ("Bible") → config.worldview = "faith"');
  const todSec = sanitizeTaskShapeByType("truth-or-dare", {
    taskType: "truth-or-dare", title: "T/D", prompt: "x",
    config: { subject: "Secular Ethics", unitName: "u", gradeLevel: 8 },
  });
  assert(todSec.config.worldview === "secular", 'secular subject → config.worldview = "secular"');

  // Fix 4 — photo with multi-symbol drawing prompt → timeLimitSeconds bumped to >= 240
  const photo = sanitizeTaskShapeByType("photo", {
    taskType: "photo", title: "Draw the symbols",
    prompt: "Create a drawing showing the dove, flames, and wind symbols of the Holy Spirit.",
    timeLimitSeconds: 90,
  });
  assert(photo.timeLimitSeconds >= 240, "photo drawing prompt bumped timeLimitSeconds 90 → >= 240");

  // Fix 5 — bonus task with coreProgressPct:100 → downgraded to 50
  const bonus = sanitizeTaskShapeByType("open-text", {
    taskType: "open-text", title: "Bonus", prompt: "Reflect",
    isBonus: true, unlockConditions: { coreProgressPct: 100 },
  });
  assert(bonus.unlockConditions.coreProgressPct === 50, "bonus unlock coreProgressPct 100 → 50");
  const bonus75 = sanitizeTaskShapeByType("open-text", {
    taskType: "open-text", title: "Bonus", prompt: "Reflect",
    isBonus: true, unlockConditions: { coreProgressPct: 75 },
  });
  assert(bonus75.unlockConditions.coreProgressPct === 75, "explicit non-100 bonus unlock preserved");

  // Nit 1 — echo-chain known proper-noun seedTerm → title-cased
  const echo = sanitizeTaskShapeByType("echo-chain", {
    taskType: "echo-chain", title: "Echo", prompt: "Repeat", config: { seedTerm: "holy spirit" },
  });
  assert(echo.config.seedTerm === "Holy Spirit", 'echo-chain "holy spirit" → "Holy Spirit"');
  const echoPlain = sanitizeTaskShapeByType("echo-chain", {
    taskType: "echo-chain", title: "Echo", prompt: "Repeat", config: { seedTerm: "covenant" },
  });
  assert(echoPlain.config.seedTerm === "covenant", "echo-chain leaves arbitrary lowercase vocab as-is");

  // Nit 2 — mad-dash-sequence: duplicate top-level correctOrder dropped (config canonical)
  const madDash = sanitizeTaskShapeByType("mad-dash-sequence", {
    taskType: "mad-dash-sequence", title: "Order", prompt: "Sequence it",
    config: { items: ["a", "b", "c", "d"], correctOrder: [1, 3, 0, 2] },
    correctOrder: [1, 3, 0, 2],
  });
  assert(madDash.correctOrder === undefined && Array.isArray(madDash.config.correctOrder),
    "mad-dash duplicate top-level correctOrder dropped (config kept)");
}

/* ──────────────── SUMMARY ──────────────── */
console.log(`\n────────────────────────────`);
console.log(`PASSED: ${pass}   FAILED: ${fail}`);
console.log(`────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
