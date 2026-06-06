// shared/taskPlayability.js
import { TASK_TYPES, normalizeTaskType } from "./taskTypes.js";

/**
 * Playability (runtime viability) checks.
 * Returns { playable, issues, normalizedType }.
 *
 * Goal: catch "schema-valid but unusable" tasks before DemoPage/TaskRunner shows
 * "No rounds were provided..." etc.
 */
export function assessTaskPlayability(rawTask) {
  const issues = [];
  const t = rawTask || {};
  const normalizedType = normalizeTaskType(t.taskType || t.type);

  // Small generic requirements (very mild)
  if (!String(t.title || "").trim()) issues.push("missing title");
  if (!String(t.prompt || "").trim()) issues.push("missing prompt");

  // Helpers
  const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

  const getArr = (...paths) => {
    for (const p of paths) {
      const val = p();
      if (Array.isArray(val)) return val;
    }
    return null;
  };

  const arrLen = (...paths) => {
    const a = getArr(...paths);
    return a ? a.length : 0;
  };

  const hasAtLeast = (n, name, ...paths) => {
    const len = arrLen(...paths);
    if (len < n) issues.push(`${name} must have at least ${n} items (got ${len})`);
  };

  const requireNonEmpty = (name, getter) => {
    const v = getter();
    if (!isNonEmptyString(v)) issues.push(`${name} is required`);
  };

  const requireNumber = (name, getter, { min } = {}) => {
    const v = getter();
    if (typeof v !== "number" || Number.isNaN(v)) {
      issues.push(`${name} must be a number`);
      return;
    }
    if (min != null && v < min) issues.push(`${name} must be >= ${min} (got ${v})`);
  };

  // ---- Per-type playability rules ----
  switch (normalizedType) {
    case TASK_TYPES.MAD_DASH: {
      const n = arrLen(() => t.sequence, () => t.items, () => t.config?.sequence, () => t.config?.items);
      if (n < 3) issues.push(`sequence/items must have at least 3 steps (got ${n})`);
      break;
    }

    case TASK_TYPES.MAD_DASH_SEQUENCE: {
      const n = arrLen(() => t.sequence, () => t.items, () => t.config?.sequence, () => t.config?.items, () => t.config?.items);
      if (n < 3) issues.push(`sequence/items must have at least 3 steps (got ${n})`);

      // Require an order key for sequence-scored gameplay
      const order =
        t.config?.correctOrder ??
        t.correctOrder ??
        t.config?.answerKey ??
        t.answerKey ??
        t.config?.correctAnswer ??
        t.correctAnswer;

      if (!order) issues.push("correct order is required (config.correctOrder/correctOrder/answerKey)");
      break;
    }
    // =========================
    // Core Q&A (multi-item)
    // =========================
    case TASK_TYPES.MULTIPLE_CHOICE:
    case TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE: {
      const items = getArr(() => t.items, () => t.config?.items);
      if (!items) {
        issues.push("items[] is required (config.items also accepted)");
        break;
      }
      if (items.length < 1) issues.push(`items[] must have at least 1 item (got ${items.length})`);

      // Light per-item sanity
      for (let i = 0; i < Math.min(items.length, 5); i++) {
        const it = items[i] || {};
        const q = it.question ?? it.prompt ?? it.text;
        if (!isNonEmptyString(q)) issues.push(`items[${i}].question/prompt is required`);
        const opts = Array.isArray(it.options) ? it.options.filter(isNonEmptyString) : [];
        if (opts.length < 2) issues.push(`items[${i}].options must have at least 2 options`);
        const ci = it.correctIndex ?? it.correctAnswer;
        if (!Number.isInteger(ci)) issues.push(`items[${i}].correctIndex/correctAnswer must be an integer`);
      }
      break;
    }

    case TASK_TYPES.ECHO_CHAIN:
      // Component requires config.seedTerm (a single word/phrase to start the chain).
      {
        const seed = t.config?.seedTerm;
        if (!seed || typeof seed !== "string" || !seed.trim()) {
          issues.push("config.seedTerm is required (a word or phrase to start the chain)");
        }
        break;
      }

    case TASK_TYPES.TRUE_FALSE: {
      const statements = getArr(() => t.items, () => t.statements, () => t.config?.items, () => t.config?.statements);
      if (!statements) issues.push("statements/items array required");
      else if (statements.length < 1) issues.push("need at least 1 true/false statement");
      break;
    }

    case TASK_TYPES.SHORT_ANSWER: {
      const items = getArr(() => t.items, () => t.config?.items);
      if (!items) issues.push("items[] is required (config.items also accepted)");
      else if (items.length < 1) issues.push("need at least 1 short-answer item");
      break;
    }

    case TASK_TYPES.READING_COMP: {
      // Your description says: passage + questions, but your runtime might accept simpler.
      // We check for at least some reading content.
      const passage = t.passage ?? t.reading ?? t.text ?? t.config?.passage ?? t.config?.reading ?? t.config?.text;
      if (!isNonEmptyString(passage)) issues.push("reading passage text is required (passage/reading/text)");
      // Optional Qs, but if your UI expects them, enforce >= 1:
      const qs = arrLen(() => t.questions, () => t.items, () => t.config?.questions, () => t.config?.items);
      if (qs < 1) issues.push(`questions/items must have at least 1 (got ${qs})`);
      break;
    }

    // =========================
    // Ordering / classify
    // =========================
    case TASK_TYPES.SORT: {
      hasAtLeast(2, "categories", () => t.categories, () => t.config?.categories);
      hasAtLeast(4, "items", () => t.items, () => t.config?.items);
      const answer = t.correctAnswer ?? t.config?.correctAnswer ?? t.answerKey ?? t.config?.answerKey;
      if (!answer || typeof answer !== "object") issues.push("correctAnswer/answerKey mapping is required");
      break;
    }

    case TASK_TYPES.SEQUENCE:
    case TASK_TYPES.TIMELINE: {
      hasAtLeast(4, "items", () => t.items, () => t.config?.items);
      // Some implementations store correct order separately; allow either.
      const order =
        t.correctOrder ?? t.config?.correctOrder ?? t.correctAnswer ?? t.config?.correctAnswer ?? t.answerKey;
      if (!order) issues.push("correct order is required (correctOrder/correctAnswer/answerKey)");
      break;
    }

    case TASK_TYPES.MATCHING: {
      hasAtLeast(5, "leftItems", () => t.config?.leftItems, () => t.leftItems);
      hasAtLeast(5, "rightItems", () => t.config?.rightItems, () => t.rightItems);
      const m = t.config?.correctMatches ?? t.correctMatches;
      if (!m || typeof m !== "object") issues.push("config.correctMatches is required");
      break;
    }

    case TASK_TYPES.LABELME: {
      hasAtLeast(5, "labels", () => t.labels, () => t.config?.labels);
      hasAtLeast(5, "options", () => t.options, () => t.config?.options);
      // An image OR an imagePrompt (to generate one) is required.
      const hasImg =
        (typeof t.imageUrl === "string" && t.imageUrl.trim()) ||
        (typeof t.config?.imageUrl === "string" && t.config.imageUrl.trim()) ||
        (typeof t.imagePrompt === "string" && t.imagePrompt.trim()) ||
        (typeof t.config?.imagePrompt === "string" && t.config.imagePrompt.trim());
      if (!hasImg) issues.push("imageUrl or imagePrompt is required");
      break;
    }

    case TASK_TYPES.MAPIT: {
      // Renderer needs 3–5 markers with real coords + ≥3 choices that
      // cover every marker's correctAnswer + a viewport. Anything missing
      // makes the map unrenderable; the auto-repair pass uses this to
      // decide whether to regenerate or drop+replace.
      const markers = Array.isArray(t.markers) ? t.markers
        : Array.isArray(t.config?.markers) ? t.config.markers : [];
      const choices = Array.isArray(t.choices) ? t.choices
        : Array.isArray(t.config?.choices) ? t.config.choices : [];
      const map = (t.map && typeof t.map === "object" ? t.map : t.config?.map) || {};

      if (markers.length < 3) {
        issues.push(`markers must have at least 3 entries (got ${markers.length})`);
      } else if (markers.length > 5) {
        issues.push(`markers must have at most 5 entries (got ${markers.length})`);
      } else {
        markers.forEach((m, i) => {
          if (!m || typeof m !== "object") {
            issues.push(`markers[${i}] is not an object`); return;
          }
          const lat = Number(m.lat ?? m.latitude);
          const lng = Number(m.lng ?? m.lon ?? m.longitude);
          if (!Number.isFinite(lat) || lat < -90 || lat > 90) issues.push(`markers[${i}].lat must be a number between -90 and 90`);
          if (!Number.isFinite(lng) || lng < -180 || lng > 180) issues.push(`markers[${i}].lng must be a number between -180 and 180`);
          const ans = String(m.correctAnswer ?? m.label ?? m.answer ?? "").trim();
          if (!ans) issues.push(`markers[${i}] needs a correctAnswer`);
        });
      }

      if (choices.length < 3) {
        issues.push(`choices must have at least 3 entries (got ${choices.length})`);
      }
      // Every marker's correctAnswer must appear in choices.
      if (markers.length && choices.length) {
        const lowerChoices = new Set(
          choices.map((c) => String(typeof c === "string" ? c : (c?.text || c?.label || "")).trim().toLowerCase())
        );
        const missing = markers
          .map((m) => String(m?.correctAnswer ?? m?.label ?? "").trim())
          .filter((a) => a && !lowerChoices.has(a.toLowerCase()));
        if (missing.length) issues.push(`choices[] is missing ${missing.length} marker correctAnswer(s)`);
      }

      const centerLat = Number(map.centerLat ?? map.center?.lat);
      const centerLng = Number(map.centerLng ?? map.center?.lng);
      if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) {
        issues.push("map.centerLat and map.centerLng are required (decimal degrees)");
      }
      break;
    }

    case TASK_TYPES.VENNSORT: {
      hasAtLeast(2, "categories", () => t.categories, () => t.config?.categories);
      hasAtLeast(5, "items", () => t.items, () => t.config?.items);
      const map = t.correctAnswer ?? t.config?.correctAnswer;
      if (!map || typeof map !== "object") issues.push("correctAnswer mapping is required");
      break;
    }

    // =========================
    // Open response / media
    // =========================
    case TASK_TYPES.OPEN_TEXT:
    case TASK_TYPES.PHOTO:
    case TASK_TYPES.MAKE_AND_SNAP:
    case TASK_TYPES.PHOTO_JOURNAL:
    case TASK_TYPES.DRAW:
    case TASK_TYPES.MIME:
    case TASK_TYPES.RECORD_AUDIO:
    case TASK_TYPES.LETTER:
    case TASK_TYPES.CASE_STUDY: {
      // Generally playable if title+prompt exist.
      break;
    }

    // =========================
    // Movement / physical games
    // =========================
    case TASK_TYPES.BODY_BREAK:
    case TASK_TYPES.MOTION_MISSION: {
      // Playable if prompt exists.
      break;
    }

    case TASK_TYPES.MUSICAL_CHAIRS: {
      // Playability (runtime viability) for musical-chairs:
      // Be mild, but ensure the UI won't crash.
      const items = getArr(() => t.items, () => t.config?.items);

      // Allow either config.rounds OR infer rounds from items length.
      const rounds = t.config?.rounds;
      const inferredRounds = Array.isArray(items) ? items.length : 0;

      if (typeof rounds !== "number" || Number.isNaN(rounds)) {
        if (inferredRounds < 1) issues.push("config.rounds is required (or provide items/config.items with at least 1 item)");
      } else if (rounds < 1) {
        issues.push(`config.rounds must be >= 1 (got ${rounds})`);
      }

      if (!items) {
        issues.push("items[] is required (config.items also accepted)");
        break;
      }
      if (items.length < 1) {
        issues.push(`items[] must have at least 1 item (got ${items.length})`);
        break;
      }

      // Light per-item sanity (first few only)
      for (let i = 0; i < Math.min(items.length, 8); i++) {
        const it = items[i] || {};
        if (!isNonEmptyString(it.prompt)) issues.push(`items[${i}].prompt is required`);
        const opts = Array.isArray(it.options) ? it.options.filter(isNonEmptyString) : [];
        if (opts.length < 2) issues.push(`items[${i}].options must have at least 2 options`);
        if (opts.length > 4) issues.push(`items[${i}].options must have at most 4 options`);
        const ca = it.correctAnswer;
        if (!Number.isInteger(ca)) issues.push(`items[${i}].correctAnswer must be an integer`);
        else if (opts.length >= 2 && (ca < 0 || ca >= opts.length)) {
          issues.push(`items[${i}].correctAnswer out of range for options length ${opts.length}`);
        }
      }

      break;
    }

    case TASK_TYPES.HIDENSEEK: {
      // Needs prompt and usually some location hint
      // (keep mild to avoid rejecting good tasks)
      break;
    }

    // =========================
    // Competitive / games
    // =========================
    case TASK_TYPES.JEOPARDY: {
      // NOTE: TASK_TYPES.JEOPARDY is "brain-blitz" in your constants. :contentReference[oaicite:1]{index=1}
      // BrainBlitz runtime seems to expect clues[] (you saw "no clues"). Enforce >= 5.
      hasAtLeast(5, "clues", () => t.clues, () => t.config?.clues);
      break;
    }

    case TASK_TYPES.TRUE_FALSE_TICTACTOE: {
      // Needs at least 9 statements OR statementSets with >= 9
      const set0 = getArr(() => t.statements, () => t.config?.statements);
      const sets = getArr(() => t.config?.statementSets);
      const count = set0 ? set0.length : sets?.[0]?.length || 0;
      if (count < 9) issues.push(`need at least 9 statements (got ${count})`);
      break;
    }

    case TASK_TYPES.TRUE_FALSE_CONNECT_FOUR: {
      // Needs statements for the connect-four grid
      const c4stmts = getArr(() => t.statements, () => t.config?.statements, () => t.items, () => t.config?.items);
      if (!c4stmts || c4stmts.length < 6) issues.push(`need at least 6 statements (got ${c4stmts?.length || 0})`);
      break;
    }

    case TASK_TYPES.FLASHCARDS: {
      hasAtLeast(5, "cards/items", () => t.items, () => t.cards, () => t.config?.items, () => t.config?.cards);
      break;
    }

    case TASK_TYPES.FLASHCARDS_RACE: {
      hasAtLeast(5, "items", () => t.config?.items, () => t.items);
      break;
    }

    case TASK_TYPES.GUESS_WHO: {
      // Component uses config.secretAnswers (array of words for each round)
      const sa = Array.isArray(t.config?.secretAnswers) ? t.config.secretAnswers : [];
      if (sa.length < 2) issues.push(`need at least 2 secretAnswers (got ${sa.length})`);
      break;
    }

    case TASK_TYPES.HANGMAN_DUEL: {
      // You spec wordsByStation[8]
      hasAtLeast(8, "config.wordsByStation", () => t.config?.wordsByStation);
      break;
    }

    case TASK_TYPES.WORD_WEAVER_DUEL: {
      // Needs at least some word list / tiles / targets
      const n = arrLen(() => t.items, () => t.config?.items, () => t.words, () => t.config?.words);
      if (n < 5) issues.push(`need at least 5 words/items (got ${n})`);
      break;
    }

    case TASK_TYPES.DIFF_DETECTIVE: {
      requireNonEmpty("original", () => t.original);
      requireNonEmpty("modified", () => t.modified);
      // Differences optional (AI or teacher review), but if provided must be >= 3
      const d = arrLen(() => t.differences, () => t.config?.differences);
      if (d > 0 && d < 3) issues.push(`differences must have at least 3 entries when provided (got ${d})`);
      break;
    }

    case TASK_TYPES.SPEED_DRAW: {
      requireNonEmpty("word/prompt", () => t.word ?? t.prompt);
      break;
    }

    case TASK_TYPES.PET_FEEDING:
    case TASK_TYPES.TOWER_BUILDER: {
      // Usually just needs prompt; items validated by backend normalizer.
      break;
    }

    // =========================
    // Collaboration / debate
    // =========================
    case TASK_TYPES.COLLABORATION:
    case TASK_TYPES.LIVE_DEBATE:
    case TASK_TYPES.AI_DEBATE_JUDGE:
    case TASK_TYPES.BRAINSTORM_BATTLE: {
      // title+prompt is generally enough; optionally check config fields if you later hard-require them.
      break;
    }

    // =========================
    // Deduction / clue-based
    // =========================
    case TASK_TYPES.MYSTERY_CLUES:
    case TASK_TYPES.PHYSICAL_MYSTERY_CLUES: {
      // requires clues[] at least 2; isFinal true tasks must have bigger set, but keep mild here
      hasAtLeast(2, "clues", () => t.clues, () => t.config?.clues);
      // isFinal should be boolean if present
      if (t.isFinal != null && typeof t.isFinal !== "boolean") issues.push("isFinal must be boolean when provided");
      break;
    }

    case TASK_TYPES.FAKE_OUT: {
      // Runtime needs rounds (you've seen "No rounds were provided...").
      hasAtLeast(1, "config.rounds", () => t.config?.rounds, () => t.rounds);

      const rounds = getArr(() => t.config?.rounds, () => t.rounds) || [];
      for (let i = 0; i < Math.min(rounds.length, 10); i++) {
        const r = rounds[i] || {};
        if (!isNonEmptyString(r.prompt)) issues.push(`rounds[${i}].prompt is required`);

        // Accept 3 (pre-normalization) or 4 (post-normalization: joke inserted into options)
        const opts = Array.isArray(r.options) ? r.options.filter(isNonEmptyString) : [];
        if (opts.length !== 3 && opts.length !== 4) issues.push(`rounds[${i}].options must have 3 or 4 items (got ${opts.length})`);

        if (!Number.isInteger(r.correctIndex)) issues.push(`rounds[${i}].correctIndex must be integer`);
        else if (r.correctIndex < 0 || r.correctIndex > 3) issues.push(`rounds[${i}].correctIndex must be 0..3`);

        if (!isNonEmptyString(r.jokeOption)) issues.push(`rounds[${i}].jokeOption is required`);
        // Only flag jokeOption-in-options for pre-normalization (3 opts); post-normalization (4) expects it there
        else if (opts.length === 3 && opts.includes(r.jokeOption)) issues.push(`rounds[${i}].jokeOption must NOT be in options`);

        if (!Number.isInteger(r.jokeIndex) || ![0, 1, 2, 3].includes(r.jokeIndex)) {
          issues.push(`rounds[${i}].jokeIndex must be 0, 1, 2, or 3`);
        }
      }
      break;
    }

    // =========================
    // Synthesis / “structured” tasks
    // =========================
    case TASK_TYPES.BRAIN_SPARK_NOTES: {
      hasAtLeast(3, "bullets", () => t.bullets, () => t.config?.bullets);
      break;
    }

    case TASK_TYPES.MIND_MAPPER: {
      hasAtLeast(4, "items", () => t.items, () => t.config?.items);

      const s = t.config?.structure ?? t.structure;

      // Accept either array structure OR object structure
      if (Array.isArray(s)) {
        if (s.length < 1) issues.push("config.structure is required");
        else {
          const flat = s.flatMap((x) => (Array.isArray(x) ? x : [x]));
          const hasBlank = flat.some((x) => x === "" || String(x).includes("_____"));
          if (!hasBlank) issues.push("config.structure must include blank slots ('' or '_____')");
        }
      } else if (s && typeof s === "object") {
        const blob = JSON.stringify(s);
        if (!blob.includes("_____") && !blob.includes('""')) {
          issues.push("config.structure must include blank slots ('' or '_____')");
        }
      } else {
        issues.push("config.structure is required");
      }

      break;
    }

    case TASK_TYPES.NARRATION_SYNTHESIZE: {
      requireNumber("config.playerCount", () => t.config?.playerCount, { min: 2 });
      hasAtLeast(2, "config.prompts", () => t.config?.prompts);
      break;
    }

    case TASK_TYPES.ROLE_PLAY_DECK: {
      const roles = getArr(() => t.config?.roles);
      if (!roles || roles.length < 2) issues.push(`config.roles must have at least 2 roles (got ${roles?.length || 0})`);
      requireNonEmpty("config.scenario", () => t.config?.scenario);
      break;
    }

    case TASK_TYPES.SCRIPT_PLAY: {
      // The renderer accepts several shapes: config.scenes[].turns, a flat
      // lines[]/config.lines[], or dialogue[]. Count across all of them so we
      // don't false-flag valid scene-format scripts, and DO flag the truly
      // empty ones — which otherwise fall back to a generic placeholder script
      // ("Alright team — let's start the scene!") that reads as nonsense.
      const sceneArr =
        (Array.isArray(t.config?.scenes) && t.config.scenes) ||
        (Array.isArray(t.scenes) && t.scenes) ||
        [];
      const sceneTurns = sceneArr.reduce(
        (sum, sc) =>
          sum + (Array.isArray(sc?.turns) ? sc.turns.filter((x) => x && (x.line || x.text)).length : 0),
        0
      );
      const flat = arrLen(() => t.lines, () => t.config?.lines, () => t.dialogue, () => t.config?.dialogue);
      const n = Math.max(sceneTurns, flat);
      if (n < 4) issues.push(`script lines/dialogue must have at least 4 lines (got ${n})`);
      break;
    }

    case TASK_TYPES.DRAW_MIME: {
      requireNonEmpty("prompt", () => t.prompt);
      break;
    }

    // =========================
    // Language / speaking
    // =========================
    case TASK_TYPES.PRONUNCIATION: {
      requireNonEmpty("referenceText", () => t.referenceText ?? t.config?.referenceText);
      break;
    }

    case TASK_TYPES.SPEECH_RECOGNITION: {
      // prompt is enough; referenceText optional
      break;
    }

    // =========================
    // Visual observation / primary sources
    // =========================
    case TASK_TYPES.ART_VIEW: {
      // Needs at least imageDescription (imageUrl validated at runtime with fallback)
      const artCfg = t.config || {};
      if (!artCfg.imageUrl && !artCfg.imageDescription) {
        issues.push("art-view requires config.imageUrl or config.imageDescription");
      }
      break;
    }

    case TASK_TYPES.HISTORICAL_DOC: {
      // Needs at least imageDescription (imageUrl validated at runtime with fallback)
      const docCfg = t.config || {};
      if (!docCfg.imageUrl && !docCfg.imageDescription) {
        issues.push("historical-doc requires config.imageUrl or config.imageDescription");
      }
      break;
    }

    // =========================
    // Comic relief / no-score
    // =========================
    case TASK_TYPES.RIDDLE: {
      // Just needs prompt or config.riddle + config.answer
      const riddleText = t.config?.riddle ?? t.prompt;
      if (!isNonEmptyString(riddleText)) issues.push("riddle text is required (config.riddle or prompt)");
      const riddleAnswer = t.config?.answer;
      if (!isNonEmptyString(riddleAnswer)) issues.push("config.answer is required");
      break;
    }

    case TASK_TYPES.TRIVIA: {
      const rounds = t.config?.rounds;
      if (!Array.isArray(rounds) || rounds.length < 1) {
        issues.push("config.rounds must be an array with at least 1 round");
      } else {
        for (let i = 0; i < rounds.length; i++) {
          const r = rounds[i];
          if (!r.mode) issues.push(`round[${i}]: mode is required`);
          if (r.mode === "bluff") {
            if (!Array.isArray(r.facts) || r.facts.length !== 3) issues.push(`round[${i}]: bluff needs exactly 3 facts`);
            if (typeof r.fakeIndex !== "number" || r.fakeIndex < 0 || r.fakeIndex > 2) issues.push(`round[${i}]: fakeIndex must be 0-2`);
          } else if (r.mode === "truefalse") {
            if (!isNonEmptyString(r.statement)) issues.push(`round[${i}]: truefalse needs statement`);
            if (typeof r.answer !== "boolean") issues.push(`round[${i}]: truefalse answer must be boolean`);
          } else if (r.mode === "closerto") {
            if (!isNonEmptyString(r.question)) issues.push(`round[${i}]: closerto needs question`);
            if (!Array.isArray(r.choices) || r.choices.length !== 2) issues.push(`round[${i}]: closerto needs exactly 2 choices`);
            if (typeof r.correctChoice !== "number" || (r.correctChoice !== 0 && r.correctChoice !== 1)) issues.push(`round[${i}]: correctChoice must be 0 or 1`);
          }
        }
      }
      break;
    }

    case TASK_TYPES.SPINNER: {
      const wedges = t.config?.wedges;
      if (!Array.isArray(wedges) || wedges.length < 4) {
        issues.push("config.wedges must be an array with at least 4 wedges");
      } else {
        for (let i = 0; i < wedges.length; i++) {
          const w = wedges[i];
          if (!isNonEmptyString(w.label)) issues.push(`wedge[${i}]: label is required`);
          if (typeof w.points !== "number") issues.push(`wedge[${i}]: points must be a number`);
        }
      }
      break;
    }

    // =========================
    // Demo-only / meta
    // =========================
    case TASK_TYPES.PEER_EDITING: {
      // Peer editing needs passage + errors
      const passage = t.passage || t.text || t.config?.passage || "";
      if (!isNonEmptyString(passage)) issues.push("passage is required");
      else if (passage.trim().length < 20) issues.push("passage must be at least 20 characters");

      const errs = Array.isArray(t.errors) ? t.errors
        : Array.isArray(t.config?.errors) ? t.config.errors : [];
      if (errs.length < 3) issues.push(`errors array must have at least 3 items (got ${errs.length})`);
      break;
    }

    case TASK_TYPES.CLOZE: {
      // Cloze needs a passage with ___ markers and a blanks array
      const passage = t.passage || t.text || t.config?.passage || "";
      if (!isNonEmptyString(passage)) issues.push("passage is required");
      else if (!passage.includes("___")) issues.push("passage must contain at least one ___ blank marker");

      const blanks = Array.isArray(t.blanks) ? t.blanks
        : Array.isArray(t.config?.blanks) ? t.config.blanks : [];
      if (blanks.length < 2) issues.push(`blanks array must have at least 2 entries (got ${blanks.length})`);
      else {
        for (let i = 0; i < blanks.length; i++) {
          const b = blanks[i];
          if (!b || typeof b !== "object") { issues.push(`blank[${i}] must be an object`); continue; }
          if (!isNonEmptyString(b.answer)) issues.push(`blank[${i}]: answer is required`);
        }
      }

      // Verify blank count matches ___ count in passage
      if (isNonEmptyString(passage) && blanks.length > 0) {
        const markerCount = (passage.match(/___/g) || []).length;
        if (markerCount !== blanks.length) {
          issues.push(`passage has ${markerCount} ___ markers but blanks array has ${blanks.length} entries`);
        }
      }
      break;
    }

    case TASK_TYPES.INTERVIEW: {
      // Interview needs candidates array with 2-3 entries, each with name + systemPrompt
      const candidates = Array.isArray(t.candidates) ? t.candidates
        : Array.isArray(t.config?.candidates) ? t.config.candidates : [];
      if (candidates.length < 2) issues.push(`candidates array must have at least 2 entries (got ${candidates.length})`);
      else {
        for (let i = 0; i < candidates.length; i++) {
          const c = candidates[i];
          if (!c || typeof c !== "object") { issues.push(`candidate[${i}] must be an object`); continue; }
          if (!isNonEmptyString(c.name)) issues.push(`candidate[${i}]: name is required`);
          if (!isNonEmptyString(c.systemPrompt)) issues.push(`candidate[${i}]: systemPrompt is required`);
        }
      }
      break;
    }

    case TASK_TYPES.TEACH_BACK: {
      // Teach-back needs concepts array with 3-5 entries and a targetAge
      const concepts = Array.isArray(t.concepts) ? t.concepts
        : Array.isArray(t.config?.concepts) ? t.config.concepts : [];
      if (concepts.length < 3) issues.push(`concepts array must have at least 3 entries (got ${concepts.length})`);
      else if (concepts.length > 5) issues.push(`concepts array should have at most 5 entries (got ${concepts.length})`);
      else {
        for (let i = 0; i < concepts.length; i++) {
          if (!isNonEmptyString(concepts[i])) issues.push(`concept[${i}] must be a non-empty string`);
        }
      }
      const targetAge = t.targetAge || t.config?.targetAge || "";
      if (!isNonEmptyString(targetAge)) issues.push("targetAge is required (e.g. 'a 2nd grader')");
      break;
    }

    case TASK_TYPES.TEAM_SELFIE:
    case TASK_TYPES.TASK_RUNNER:
    case TASK_TYPES.MOOD_CHECKIN:
    case TASK_TYPES.TREASURE_RUNNER:
    case TASK_TYPES.MULTI_PLAYER_FEEDBACK:
    case TASK_TYPES.STORYTELLING: {
      // Always playable with title+prompt
      break;
    }

    // ── New task types added 2026 ────────────────────────────────────
    case TASK_TYPES.WHAT_AM_I: {
      const cfg = t.config || {};
      const answer = cfg.answer || t.answer;
      const clues = Array.isArray(cfg.clues) ? cfg.clues : (Array.isArray(t.clues) ? t.clues : []);
      if (!isNonEmptyString(answer)) issues.push("what-am-i requires config.answer (the secret subject)");
      if (clues.length < 3) issues.push(`what-am-i needs ≥3 clues (got ${clues.length})`);
      break;
    }

    case TASK_TYPES.QUEST: {
      const cfg = t.config || {};
      if (!isNonEmptyString(cfg.title)) issues.push("quest requires config.title (mission name)");
      if (!isNonEmptyString(cfg.scenario)) issues.push("quest requires config.scenario (narrative setup)");
      const objs = Array.isArray(cfg.objectives) ? cfg.objectives : [];
      if (objs.length < 1) issues.push("quest needs ≥1 objective");
      const res = Array.isArray(cfg.resources) ? cfg.resources : [];
      if (res.length < 1) issues.push("quest needs ≥1 resource");
      break;
    }

    case TASK_TYPES.CAREERS: {
      const cfg = t.config || {};
      const allowedModes = ["best-fit", "pathway-builder", "aptitude-match", "salary-vs-lifestyle", "who-should-be-hired", "career-myths"];
      if (!allowedModes.includes(cfg.mode)) {
        issues.push(`careers config.mode must be one of ${allowedModes.join("/")}`);
      }
      // mode-specific minimal payload
      if (cfg.mode === "best-fit" && !cfg.career) issues.push("careers best-fit needs config.career");
      if (cfg.mode === "pathway-builder" && (!Array.isArray(cfg.pathways) || cfg.pathways.length < 2))
        issues.push("careers pathway-builder needs ≥2 pathways");
      if (cfg.mode === "who-should-be-hired" && (!Array.isArray(cfg.candidates) || cfg.candidates.length < 2))
        issues.push("careers who-should-be-hired needs ≥2 candidates");
      if (cfg.mode === "salary-vs-lifestyle" && (!cfg.optionA || !cfg.optionB))
        issues.push("careers salary-vs-lifestyle needs optionA + optionB");
      if (cfg.mode === "career-myths" && (!Array.isArray(cfg.questions) || cfg.questions.length === 0))
        issues.push("careers career-myths needs ≥1 question");
      if (cfg.mode === "aptitude-match" && (!Array.isArray(cfg.prompts) || cfg.prompts.length === 0))
        issues.push("careers aptitude-match needs ≥1 prompt");
      break;
    }

    case TASK_TYPES.CURRENT_EVENTS: {
      const cfg = t.config || {};
      // The persisted task is a shell — `lessonTopic` (or task.topicLabel) is
      // the only required input. Resolver fills the rest at runtime.
      const topic = cfg.lessonTopic || t.topicLabel;
      if (!isNonEmptyString(topic)) {
        issues.push("current-events requires config.lessonTopic (or task.topicLabel)");
      }
      break;
    }

    case TASK_TYPES.HOLE_IN_ONE: {
      const cfg = t.config || {};
      const board = cfg.board || {};
      const w = Number(board.width), h = Number(board.height);
      if (!(w >= 6 && w <= 30)) issues.push(`hole-in-one board.width must be 6-30 (got ${w})`);
      if (!(h >= 6 && h <= 30)) issues.push(`hole-in-one board.height must be 6-30 (got ${h})`);
      if (!board.startPosition || !board.holePosition) {
        issues.push("hole-in-one needs board.startPosition AND board.holePosition");
      }
      if (Array.isArray(cfg.questionBank) && cfg.questionBank.length < 1) {
        issues.push("hole-in-one needs ≥1 question in config.questionBank");
      }
      break;
    }

    case TASK_TYPES.LEGENDS: {
      const cfg = t.config || {};
      const figure = cfg.figure || {};
      if (!isNonEmptyString(figure.name)) issues.push("legends requires config.figure.name");
      if (!isNonEmptyString(figure.portraitUrl)) issues.push("legends requires config.figure.portraitUrl");
      else if (!/^https?:\/\//.test(figure.portraitUrl)) issues.push("legends config.figure.portraitUrl must be http(s)");
      const facts = Array.isArray(cfg.facts) ? cfg.facts : [];
      if (facts.length !== 10) issues.push(`legends requires exactly 10 facts (got ${facts.length})`);
      else {
        const counts = { what: 0, where: 0, why: 0, when: 0, decoy: 0 };
        for (const f of facts) {
          if (counts[f.category] !== undefined) counts[f.category] += 1;
        }
        if (counts.what !== 2)  issues.push(`legends needs exactly 2 'what' facts (got ${counts.what})`);
        if (counts.where !== 2) issues.push(`legends needs exactly 2 'where' facts (got ${counts.where})`);
        if (counts.why !== 2)   issues.push(`legends needs exactly 2 'why' facts (got ${counts.why})`);
        if (counts.when !== 1)  issues.push(`legends needs exactly 1 'when' fact (got ${counts.when})`);
        if (counts.decoy !== 3) issues.push(`legends needs exactly 3 'decoy' facts (got ${counts.decoy})`);
      }
      break;
    }

    case TASK_TYPES.TRUTH_OR_DARE: {
      const cfg = t.config || {};
      if (!isNonEmptyString(cfg.subject)) issues.push("truth-or-dare requires config.subject");
      if (!isNonEmptyString(cfg.unitName)) issues.push("truth-or-dare requires config.unitName");
      const grade = Number(cfg.gradeLevel);
      if (!(grade >= 1 && grade <= 12)) issues.push(`truth-or-dare config.gradeLevel must be 1-12 (got ${cfg.gradeLevel})`);
      break;
    }

    case TASK_TYPES.UPVOTE: {
      const cfg = t.config || {};
      // The proposition is the WHOLE task — without it there's nothing to vote on.
      if (!isNonEmptyString(cfg.proposition)) {
        issues.push("upvote requires config.proposition");
      }
      break;
    }

    default: {
      // Unknown types: only enforce generic title/prompt
      issues.push(`unknown taskType "${t.taskType}" (normalized to "${normalizedType}")`);
      break;
    }
  }

  return {
    playable: issues.length === 0,
    issues,
    normalizedType,
  };
}

/**
 * Convenience: check a whole taskset and return a compact report.
 */
export function auditPlayability(tasks = []) {
  const results = tasks.map((t, idx) => ({ idx, ...assessTaskPlayability(t) }));
  const bad = results.filter((r) => !r.playable);
  return {
    total: results.length,
    playable: results.length - bad.length,
    notPlayable: bad.length,
    bad,
    byType: results.reduce((acc, r) => {
      acc[r.normalizedType] = acc[r.normalizedType] || { total: 0, bad: 0 };
      acc[r.normalizedType].total += 1;
      if (!r.playable) acc[r.normalizedType].bad += 1;
      return acc;
    }, {}),
  };
}