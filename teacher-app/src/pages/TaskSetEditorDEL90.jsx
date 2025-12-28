// teacher-app/src/pages/TaskSetEditor.jsx
import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  TASK_TYPES,
  TASK_TYPE_META,
  IMPLEMENTED_TASK_TYPES,
} from "../../../shared/taskTypes.js";

import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "http://localhost:10000";

// Normalize any legacy values coming from older tasksets
function normalizeTaskType(raw) {
  if (!raw) return TASK_TYPES.SHORT_ANSWER;
  const v = String(raw).toLowerCase().replace(/_/g, "-").trim();

  if (v === "mc" || v === "multiple-choice" || v === TASK_TYPES.MULTIPLE_CHOICE) {
    return TASK_TYPES.MULTIPLE_CHOICE;
  }
  if (
    v === "tf" ||
    v === "true-false" ||
    v === "true_false" ||
    v === TASK_TYPES.TRUE_FALSE
  ) {
    return TASK_TYPES.TRUE_FALSE;
  }
  if (v === "short-answer" || v === "short_answer" || v === "sa") {
    return TASK_TYPES.SHORT_ANSWER;
  }
  if (v === "sort") {
    return TASK_TYPES.SORT;
  }
    if (v === "matching" || v === "match" || v === "connect" || v === "matching-task") {
    return TASK_TYPES.MATCHING;
  }
// Legacy aliases for Hide & Seek
  if (
    v === "hidenseek" ||
    v === "hide-and-seek" ||
    v === "hide-n-seek" ||
    v === "hide_and_seek"
  ) {
    return TASK_TYPES.HIDENSEEK || "hidenseek";
  }
  if (v === "sequence" || v === "seq") {
    return TASK_TYPES.SEQUENCE;
  }
  if (v === "timeline" || v === "time-line") {
    return TASK_TYPES.TIMELINE;
  }

  // Echo Chain aliases
  if (v === "echochain" || v === "echo-chain" || v === "echo_chain") {
    return TASK_TYPES.ECHO_CHAIN || "echo-chain";
  }

// Narration Synthesize aliases
if (
  v === "narrationsynthesize" ||
  v === "narration-synthesize" ||
  v === "narration_synthesize" ||
  v === "narration synthesize"
) {
  return TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize";
}


// Script Play aliases
if (
  v === "scriptplay" ||
  v === "script-play" ||
  v === "script_play" ||
  v === "script play" ||
  v === "script"
) {
  return TASK_TYPES.SCRIPT_PLAY || "script-play";
}
  if (v === "photo" || v === "photo-evidence") {
    return TASK_TYPES.PHOTO;
  }
  if (v === "make-and-snap" || v === "make_snap") {
    return TASK_TYPES.MAKE_AND_SNAP;
  }
  if (v === "body-break" || v === "body_break") {
    return TASK_TYPES.BODY_BREAK;
  }
  if (v === TASK_TYPES.JEOPARDY || v === "jeopardy" || v === "brain-blitz") {
    return TASK_TYPES.JEOPARDY;
  }


  if (
    v === TASK_TYPES.BRAIN_SPARK_NOTES ||
    v === "brain-spark-notes" ||
    v === "brain spark notes" ||
    v === "brain-spark" ||
    v === "spark-notes" ||
    v === "spark notes"
  ) {
    return TASK_TYPES.BRAIN_SPARK_NOTES;
  }

  if (
    v === TASK_TYPES.MIND_MAPPER ||
    v === "mind-mapper" ||
    v === "mind mapper" ||
    v === "mind-map" ||
    v === "mind map" ||
    v === "concept-map" ||
    v === "concept map"
  ) {
    return TASK_TYPES.MIND_MAPPER;
  }

  // Fallback: if we know this type, keep it, otherwise default to short answer
  if (Object.values(TASK_TYPES).includes(v)) return v;
  return TASK_TYPES.SHORT_ANSWER;
}

function categoryLabelFor(typeValue) {
  const meta = TASK_TYPE_META[typeValue];
  if (!meta?.category) return "other";
  return meta.category;
}

function prettyCategory(typeValue) {
  const cat = categoryLabelFor(typeValue);
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function playModeLabel(typeValue) {
  const meta = TASK_TYPE_META[typeValue] || {};
  const intra = meta.intraTeamEnabled === true;
  const inter = meta.interTeamEnabled === true;

  if (inter && intra) return "inter + intra";
  if (inter) return "inter-team";
  if (intra) return "intra-team";
  return "solo";
}

export default function TaskSetEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tasks, setTasks] = useState([]);
  const [displays, setDisplays] = useState([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // AI word-bank metadata (used vs unused terms)
  const [aiWordBank, setAiWordBank] = useState([]);
  const [aiWordsUsed, setAiWordsUsed] = useState([]);
  const [aiWordsUnused, setAiWordsUnused] = useState([]);

  const userId = localStorage.getItem("userId");
  const token = localStorage.getItem("token");

  // Load existing taskset (edit mode)
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/tasksets/${id}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(async (res) => {
        const text = await res.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error("Server returned invalid JSON while loading set");
        }
        if (!res.ok) {
          throw new Error(data?.error || "Failed to load task set");
        }
        return data;
      })
      .then((data) => {
        setName(data.name || "");
        setDescription(data.description || "");
        setDisplays(data.displays || []);
        setTasks(
          (data.tasks || []).map((t, idx) => {
            const taskType = normalizeTaskType(t.taskType || t.task_type);

            // Base shape
            const out = {
              ...t,
              taskType,
              timeLimitSeconds: t.timeLimitSeconds ?? t.time_limit ?? null,
              displayKey: t.displayKey || "",
              correctAnswer: t.correctAnswer ?? null,
              aiScoringRequired:
                typeof t.aiScoringRequired === "boolean"
                  ? t.aiScoringRequired
                  : !(t.correctAnswer !== undefined && t.correctAnswer !== null),
              config: t.config && typeof t.config === "object" ? t.config : {},
              items: Array.isArray(t.items) ? t.items : [],
              _tempId: Math.random().toString(36).slice(2),
              orderIndex: t.orderIndex ?? idx,
            };

            // ---- Type-specific display normalization (editor-only) ----

            // Echo Chain: ensure config defaults so editor can render controls
            if (out.taskType === (TASK_TYPES.ECHO_CHAIN || "echo-chain")) {
              const cfg = out.config && typeof out.config === "object" ? out.config : {};
              const seedTerm =
                String(cfg.seedTerm ?? out.seedTerm ?? "").trim() ||
                // best-effort: pull a single word from the prompt, if present
                (typeof out.prompt === "string"
                  ? (out.prompt.match(/“([^”]{2,40})”/)?.[1] || out.prompt.match(/"([^"]{2,40})"/)?.[1] || "")
                  : "");
              out.config = {
                ...cfg,
                seedTerm: seedTerm || cfg.seedTerm || "",
                perTurnSeconds:
                  Number.isFinite(Number(cfg.perTurnSeconds)) && Number(cfg.perTurnSeconds) > 0
                    ? Number(cfg.perTurnSeconds)
                    : 10,
                maxChainLength:
                  Number.isFinite(Number(cfg.maxChainLength)) && Number(cfg.maxChainLength) > 0
                    ? Number(cfg.maxChainLength)
                    : 30,
                pointsPerCorrectAdd:
                  Number.isFinite(Number(cfg.pointsPerCorrectAdd)) && Number(cfg.pointsPerCorrectAdd) >= 0
                    ? Number(cfg.pointsPerCorrectAdd)
                    : 1,
                rotationBonusPoints:
                  Number.isFinite(Number(cfg.rotationBonusPoints)) && Number(cfg.rotationBonusPoints) >= 0
                    ? Number(cfg.rotationBonusPoints)
                    : 5,
                requireVocabOnly: cfg.requireVocabOnly === true,
              };
            }

// Narration Synthesize: normalize config so editor can render controls
if (out.taskType === (TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize")) {
  const cfg = out.config && typeof out.config === "object" ? out.config : {};
  const playerCount =
    Number.isFinite(Number(cfg.playerCount)) && Number(cfg.playerCount) > 0
      ? Number(cfg.playerCount)
      : Number.isFinite(Number(out.playerCount)) && Number(out.playerCount) > 0
      ? Number(out.playerCount)
      : 4;

  const perTurnSeconds =
    Number.isFinite(Number(cfg.perTurnSeconds)) && Number(cfg.perTurnSeconds) >= 0
      ? Number(cfg.perTurnSeconds)
      : Number.isFinite(Number(out.perTurnSeconds)) && Number(out.perTurnSeconds) >= 0
      ? Number(out.perTurnSeconds)
      : 60;

  const ratingScaleRaw =
    cfg.ratingScale && typeof cfg.ratingScale === "object"
      ? cfg.ratingScale
      : out.ratingScale && typeof out.ratingScale === "object"
      ? out.ratingScale
      : null;

  const ratingScale = {
    min: Number.isFinite(Number(ratingScaleRaw?.min)) ? Number(ratingScaleRaw.min) : 1,
    max: Number.isFinite(Number(ratingScaleRaw?.max)) ? Number(ratingScaleRaw.max) : 5,
    label: String(ratingScaleRaw?.label || "Clarity / Accuracy / Quality").trim(),
  };

  const rawPrompts =
    (Array.isArray(cfg.prompts) && cfg.prompts) ||
    (Array.isArray(out.prompts) && out.prompts) ||
    (Array.isArray(out.items) && out.items) ||
    [];

  const prompts = (Array.isArray(rawPrompts) ? rawPrompts : []).map((p, i) => {
    if (typeof p === "string") return { id: `p${i + 1}`, concept: "", prompt: p };
    if (p && typeof p === "object") {
      return {
        id: String(p.id ?? p._id ?? `p${i + 1}`),
        concept: String(p.concept ?? p.topic ?? p.term ?? "").trim(),
        prompt: String(p.prompt ?? p.text ?? p.question ?? "").trim(),
      };
    }
    return { id: `p${i + 1}`, concept: "", prompt: "" };
  });

  out.config = {
    ...cfg,
    playerCount,
    prompts,
    perTurnSeconds,
    ratingScale,
  };
}


// Script Play: normalize config so editor can render controls
if (out.taskType === (TASK_TYPES.SCRIPT_PLAY || "script-play")) {
  const cfg = out.config && typeof out.config === "object" ? out.config : {};
  const rawRoles =
    (Array.isArray(cfg.roles) && cfg.roles) ||
    (Array.isArray(out.roles) && out.roles) ||
    [];
  const roles = (Array.isArray(rawRoles) ? rawRoles : []).map((r, i) => {
    if (typeof r === "string") return { id: `r${i + 1}`, name: r };
    if (r && typeof r === "object") {
      return {
        id: String(r.id ?? r._id ?? `r${i + 1}`),
        name: String(r.name ?? r.role ?? r.speaker ?? `Role ${i + 1}`).trim(),
      };
    }
    return { id: `r${i + 1}`, name: `Role ${i + 1}` };
  });

  const rawLines =
    (Array.isArray(cfg.lines) && cfg.lines) ||
    (Array.isArray(cfg.script) && cfg.script) ||
    (Array.isArray(out.lines) && out.lines) ||
    (Array.isArray(out.script) && out.script) ||
    [];

  const lines = (Array.isArray(rawLines) ? rawLines : []).map((ln, i) => {
    if (typeof ln === "string") {
      return {
        id: `l${i + 1}`,
        speaker: "",
        text: ln,
        stage: "",
        tone: "",
      };
    }
    if (ln && typeof ln === "object") {
      return {
        id: String(ln.id ?? ln._id ?? `l${i + 1}`),
        speaker: String(ln.speaker ?? ln.role ?? ln.character ?? "").trim(),
        text: String(ln.text ?? ln.line ?? ln.dialogue ?? "").trim(),
        stage: String(ln.stage ?? ln.stageDirection ?? ln.stageDirections ?? "").trim(),
        tone: String(ln.tone ?? ln.toneCue ?? "").trim(),
      };
    }
    return { id: `l${i + 1}`, speaker: "", text: "", stage: "", tone: "" };
  });

  out.config = {
    ...cfg,
    sceneTitle: String(cfg.sceneTitle ?? out.sceneTitle ?? "").trim(),
    contextBefore: String(cfg.contextBefore ?? out.contextBefore ?? "").trim(),
    contextAfter: String(cfg.contextAfter ?? out.contextAfter ?? "").trim(),
    roles,
    lines,
  };
}

            // BrainBlitz / Jeopardy: accept clues from several legacy shapes
            if (out.taskType === TASK_TYPES.JEOPARDY) {
              const cfgClues = Array.isArray(out.config?.clues) ? out.config.clues : [];
              const itemClues = Array.isArray(out.items) ? out.items : [];
              const raw = Array.isArray(out.clues) ? out.clues : (cfgClues.length ? cfgClues : itemClues);

              out.clues = (Array.isArray(raw) ? raw : [])
                .map((cl, i) => {
                  if (typeof cl === "string") return { clue: cl, answer: "" };
                  if (cl && typeof cl === "object") {
                    return {
                      clue: String(cl.clue ?? cl.prompt ?? cl.question ?? cl.text ?? `Clue ${i + 1}`),
                      answer: String(cl.answer ?? cl.correctAnswer ?? ""),
                    };
                  }
                  return { clue: `Clue ${i + 1}`, answer: "" };
                });
            }

            // Sort: accept categories/items legacy keys
            if (out.taskType === TASK_TYPES.SORT) {
              const buckets =
                (Array.isArray(out.config?.buckets) && out.config.buckets) ||
                (Array.isArray(out.config?.categories) && out.config.categories) ||
                (Array.isArray(out.buckets) && out.buckets) ||
                (Array.isArray(out.categories) && out.categories) ||
                [];
              const items =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.config?.sortItems) && out.config.sortItems) ||
                (Array.isArray(out.sortItems) && out.sortItems) ||
                [];
              out.config = { ...out.config, buckets, items };
            }

            
            // Matching: accept left/right/pairs legacy keys and normalize to { leftItems, rightItems, correctMatches }
            if (out.taskType === TASK_TYPES.MATCHING) {
              // Prefer canonical shape
              const leftItems =
                (Array.isArray(out.leftItems) && out.leftItems) ||
                (Array.isArray(out.config?.leftItems) && out.config.leftItems) ||
                [];
              const rightItems =
                (Array.isArray(out.rightItems) && out.rightItems) ||
                (Array.isArray(out.config?.rightItems) && out.config.rightItems) ||
                [];

              // If pairs[] provided, derive left/right/mapping
              const pairs =
                (Array.isArray(out.pairs) && out.pairs) ||
                (Array.isArray(out.items) && out.items) ||
                (Array.isArray(out.config?.pairs) && out.config.pairs) ||
                (Array.isArray(out.config?.items) && out.config.items) ||
                [];

              let finalLeft = leftItems;
              let finalRight = rightItems;
              let mapping =
                (out.correctMatches && typeof out.correctMatches === "object" && out.correctMatches) ||
                (out.correctMapping && typeof out.correctMapping === "object" && out.correctMapping) ||
                (out.correctAnswer && typeof out.correctAnswer === "object" && out.correctAnswer) ||
                (out.config?.correctMatches && typeof out.config.correctMatches === "object" && out.config.correctMatches) ||
                (out.config?.correctMapping && typeof out.config.correctMapping === "object" && out.config.correctMapping) ||
                {};

              if ((!finalLeft?.length || !finalRight?.length) && pairs?.length) {
                const l = [];
                const r = [];
                const mapp = {};
                pairs.forEach((p, i) => {
                  const leftId = String(p.leftId || p.left?.id || p.left?.key || `L${i + 1}`);
                  const rightId = String(p.rightId || p.right?.id || p.right?.key || `R${i + 1}`);
                  const leftText = String(p.leftLabel || p.leftText || p.left?.label || p.left?.text || p.left || `Left ${i + 1}`);
                  const rightText = String(p.rightLabel || p.rightText || p.right?.label || p.right?.text || p.right || `Right ${i + 1}`);
                  l.push({ id: leftId, text: leftText });
                  r.push({ id: rightId, text: rightText });
                  mapp[leftId] = rightId;
                });
                finalLeft = l;
                finalRight = r;
                if (!Object.keys(mapping || {}).length) mapping = mapp;
              }

              out.leftItems = (finalLeft || []).map((it, i) => ({
                id: String(it?.id || it?._id || it?.key || `L${i + 1}`),
                text: String(it?.text || it?.label || it?.title || `Left ${i + 1}`),
              }));
              out.rightItems = (finalRight || []).map((it, i) => ({
                id: String(it?.id || it?._id || it?.key || `R${i + 1}`),
                text: String(it?.text || it?.label || it?.title || `Right ${i + 1}`),
              }));
              out.correctMatches = mapping && typeof mapping === "object" ? mapping : {};
              // keep also in config for legacy consumers
              out.config = { ...out.config, leftItems: out.leftItems, rightItems: out.rightItems, correctMatches: out.correctMatches };
            }
// Sequence: accept steps/events/sequence/items legacy keys
            if (out.taskType === TASK_TYPES.SEQUENCE) {
              const seq =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.config?.steps) && out.config.steps) ||
                (Array.isArray(out.config?.events) && out.config.events) ||
                (Array.isArray(out.config?.sequence) && out.config.sequence) ||
                (Array.isArray(out.items) && out.items) ||
                (Array.isArray(out.steps) && out.steps) ||
                (Array.isArray(out.events) && out.events) ||
                (Array.isArray(out.options) && out.options) ||
                [];
              out.config = { ...out.config, items: seq };
            }

            
            // Timeline: accept steps/events/sequence/items legacy keys
            if (out.taskType === TASK_TYPES.TIMELINE) {
              const seq =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.config?.steps) && out.config.steps) ||
                (Array.isArray(out.config?.events) && out.config.events) ||
                (Array.isArray(out.config?.sequence) && out.config.sequence) ||
                (Array.isArray(out.items) && out.items) ||
                (Array.isArray(out.steps) && out.steps) ||
                (Array.isArray(out.events) && out.events) ||
                (Array.isArray(out.options) && out.options) ||
                [];
              out.config = { ...out.config, items: seq };
              // if timeline items are plain strings, wrap into { id, text }
              if (Array.isArray(out.config.items)) {
                out.config.items = out.config.items.map((it, i) => {
                  if (typeof it === "string") return { id: `event-${i + 1}`, text: it };
                  if (it && typeof it === "object") {
                    const id = String(it.id || it._id || it.key || `event-${i + 1}`);
                    const text = String(it.text || it.label || it.title || it.name || `Event ${i + 1}`);
                    const year = it.year ?? it.date ?? it.when ?? "";
                    return year ? { ...it, id, text, year } : { ...it, id, text };
                  }
                  return { id: `event-${i + 1}`, text: `Event ${i + 1}` };
                });
              }
            }

// True/False: ensure options exist for single-item edit
            if (out.taskType === TASK_TYPES.TRUE_FALSE) {
              out.options = Array.isArray(out.options) && out.options.length ? out.options : ["True", "False"];
              if (out.correctAnswer === null || out.correctAnswer === undefined) out.correctAnswer = 0;
            }


            // Flashcards: normalize config.items so editor (and student task) can render the list
            if (out.taskType === TASK_TYPES.FLASHCARDS) {
              const rawCards =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.items) && out.items) ||
                (Array.isArray(out.cards) && out.cards) ||
                [];
              const items = (Array.isArray(rawCards) ? rawCards : [])
                .map((c, i) => {
                  if (typeof c === "string") return { question: c, answer: "" };
                  if (c && typeof c === "object") {
                    return {
                      question: String(c.question ?? c.q ?? c.prompt ?? `Card ${i + 1}`),
                      answer: String(c.answer ?? c.a ?? c.response ?? ""),
                    };
                  }
                  return { question: `Card ${i + 1}`, answer: "" };
                })
                .filter((c) => (c.question || "").trim().length > 0);
              out.config = { ...(out.config || {}), items };
            }

            // Hangman Duel: normalize wordsByStation so editor shows the word list
            // Fake Out: normalize config for editor + student task UI (oral bluffing game)
            if (out.taskType === TASK_TYPES.FAKE_OUT) {
              const cfg = out.config && typeof out.config === "object" ? out.config : {};
              const playerCount =
                Number.isFinite(Number(cfg.playerCount)) && Number(cfg.playerCount) > 0
                  ? Number(cfg.playerCount)
                  : Number.isFinite(Number(out.playerCount)) && Number(out.playerCount) > 0
                  ? Number(out.playerCount)
                  : 4;

              const rawNames =
                (Array.isArray(cfg.playerNames) && cfg.playerNames) ||
                (Array.isArray(out.playerNames) && out.playerNames) ||
                [];
              const playerNames =
                rawNames.length > 0
                  ? rawNames.map((n, i) => String(n || `Player ${i + 1}`))
                  : Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);

              const rawRounds =
                (Array.isArray(cfg.rounds) && cfg.rounds) ||
                (Array.isArray(out.rounds) && out.rounds) ||
                (Array.isArray(out.items) && out.items) ||
                [];

              const rounds = (Array.isArray(rawRounds) ? rawRounds : []).map((r, i) => {
                if (typeof r === "string") {
                  return {
                    id: `r${i + 1}`,
                    statement: r,
                    options: ["", "", "", ""],
                    correctIndex: 0,
                  };
                }
                const rr = r && typeof r === "object" ? r : {};
                const rawOpts =
                  (Array.isArray(rr.options) && rr.options) ||
                  (Array.isArray(rr.choices) && rr.choices) ||
                  [];
                const opts = (Array.isArray(rawOpts) ? rawOpts : []).map((o) => String(o ?? "")).slice(0, 4);
                while (opts.length < 4) opts.push("");

                // Correct index should point to one of the first 3 "plausible" choices.
                const ciRaw = Number.isFinite(Number(rr.correctIndex))
                  ? Number(rr.correctIndex)
                  : Number.isFinite(Number(rr.correctAnswerIndex))
                  ? Number(rr.correctAnswerIndex)
                  : Number.isFinite(Number(rr.correctAnswer))
                  ? Number(rr.correctAnswer)
                  : 0;
                const correctIndex = ciRaw >= 0 && ciRaw <= 2 ? ciRaw : 0;

                return {
                  id: String(rr.id ?? rr._id ?? `r${i + 1}`),
                  statement: String(rr.statement ?? rr.prompt ?? rr.text ?? "").trim(),
                  options: opts,
                  correctIndex,
                };
              });

              out.config = {
                ...cfg,
                playerCount,
                playerNames,
                rounds,
                // Optional scoring knobs (safe defaults)
                pointsPerCorrect: Number.isFinite(Number(cfg.pointsPerCorrect)) ? Number(cfg.pointsPerCorrect) : 10,
                readerBonusPerFooled:
                  Number.isFinite(Number(cfg.readerBonusPerFooled)) ? Number(cfg.readerBonusPerFooled) : 2,
              };
            }


            if (out.taskType === TASK_TYPES.HANGMAN_DUEL) {
              const wbs =
                (Array.isArray(out.config?.wordsByStation) && out.config.wordsByStation) ||
                (Array.isArray(out.wordsByStation) && out.wordsByStation) ||
                [];
              out.config = { ...(out.config || {}), wordsByStation: wbs };
            }

            // True/False Tic-Tac-Toe: normalize statements (supports either task.statements or config.statementSets[0])
            if (out.taskType === TASK_TYPES.TRUE_FALSE_TICTACTOE) {
              const cfg = out.config && typeof out.config === "object" ? out.config : {};
              const sets = Array.isArray(cfg.statementSets) ? cfg.statementSets : [];
              const rawStatements =
                (Array.isArray(out.statements) && out.statements) ||
                (Array.isArray(cfg.statements) && cfg.statements) ||
                (Array.isArray(sets[0]) && sets[0]) ||
                [];
              out.statements = (Array.isArray(rawStatements) ? rawStatements : []).map((s, i) => ({
                text: String(s?.text ?? s?.statement ?? s ?? "").trim(),
                isFalse: s?.isFalse === true || s?.isFalse === "true" || s?.truth === false || s?.truthiness === "false",
              })).filter((s) => s.text);
              // keep a canonical home in config for multi-round support
              out.config = { ...cfg, statementSets: sets.length ? sets : (out.statements.length ? [out.statements] : []) };
            }

            // Pronunciation: normalize referenceText/accentOptions
            if (out.taskType === TASK_TYPES.PRONUNCIATION) {
              const cfg = out.config && typeof out.config === "object" ? out.config : {};
              const accentOptionsRaw =
                (Array.isArray(out.accentOptions) && out.accentOptions) ||
                (Array.isArray(cfg.accentOptions) && cfg.accentOptions) ||
                ["american", "canadian", "british", "neutral"];
              const accentOptions = (Array.isArray(accentOptionsRaw) ? accentOptionsRaw : [])
                .map((a) => String(a || "").trim().toLowerCase())
                .filter(Boolean);
              const referenceText = String(out.referenceText ?? cfg.referenceText ?? out.prompt ?? "").trim();
              const phonetic = String(out.phonetic ?? cfg.phonetic ?? "").trim();
              const languageCode = String(out.languageCode ?? cfg.languageCode ?? out.language ?? cfg.language ?? "en-US").trim();
              const targetAccent = String(out.targetAccent ?? cfg.targetAccent ?? (accentOptions[0] || "american")).trim().toLowerCase();
              out.referenceText = referenceText;
              out.phonetic = phonetic || undefined;
              out.languageCode = languageCode;
              out.accentOptions = accentOptions;
              out.targetAccent = targetAccent;
              out.config = { ...cfg, referenceText, phonetic: phonetic || undefined, languageCode, accentOptions, targetAccent };
            }

            // Speech Recognition: normalize languageCode/referenceText
            if (out.taskType === TASK_TYPES.SPEECH_RECOGNITION) {
              const cfg = out.config && typeof out.config === "object" ? out.config : {};
              const languageCode = String(out.languageCode ?? cfg.languageCode ?? out.language ?? cfg.language ?? "en-US").trim();
              const referenceText = String(out.referenceText ?? cfg.referenceText ?? "").trim();
              out.languageCode = languageCode;
              out.referenceText = referenceText || undefined;
              out.config = { ...cfg, languageCode, referenceText: referenceText || undefined };
              // default time for oral answers if missing
              if (!Number.isFinite(Number(out.timeLimitSeconds)) || Number(out.timeLimitSeconds) <= 0) {
                out.timeLimitSeconds = 60;
              }
            }


            // Pet Feeding: normalize pack so editor + student task stay in sync
            if (out.taskType === TASK_TYPES.PET_FEEDING) {
              const prevCfg = out.config && typeof out.config === "object" ? out.config : {};
              const pack = String(out.pack ?? prevCfg.pack ?? "classic").trim() || "classic";
              const pointsAwardedRaw = out.pointsAwarded ?? prevCfg.pointsAwarded;
              const pointsAwarded =
                Number.isFinite(Number(pointsAwardedRaw)) ? Number(pointsAwardedRaw) : undefined;

              out.pack = pack;
              if (pointsAwarded !== undefined) out.pointsAwarded = pointsAwarded;
              out.config = { ...prevCfg, pack, ...(pointsAwarded !== undefined ? { pointsAwarded } : {}) };
            }
            // VennSort: normalize items + correctAnswer so editor can show/check category membership
            if (out.taskType === TASK_TYPES.VENNSORT) {
              const categories =
                (Array.isArray(out.config?.categories) && out.config.categories) ||
                (Array.isArray(out.categories) && out.categories) ||
                [];
              const rawItems =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.items) && out.items) ||
                [];
              const items = rawItems.map((it, idx) => {
                if (typeof it === "string") return { id: String(idx + 1), text: it };
                if (it && typeof it === "object") {
                  return {
                    id: String(it.id ?? it._id ?? idx + 1),
                    text: String(it.text ?? it.label ?? it.value ?? `Item ${idx + 1}`),
                  };
                }
                return { id: String(idx + 1), text: `Item ${idx + 1}` };
              });
              const ca =
                (out.correctAnswer && typeof out.correctAnswer === "object" ? out.correctAnswer : null) ||
                (out.config?.correctAnswer && typeof out.config.correctAnswer === "object" ? out.config.correctAnswer : null) ||
                {};
              out.correctAnswer = ca;
              out.config = { ...(out.config || {}), categories, items, correctAnswer: ca };
            }

            // DiffDetective: normalize the two texts/definitions if provided in config
            if (out.taskType === TASK_TYPES.DIFF_DETECTIVE) {
              const a = String(out.config?.textA ?? out.config?.leftText ?? out.textA ?? out.leftText ?? "").trim();
              const b = String(out.config?.textB ?? out.config?.rightText ?? out.textB ?? out.rightText ?? "").trim();
              if (a || b) {
                out.config = { ...(out.config || {}), textA: a, textB: b };
              }
            }

            // Flashcards: ensure config.items exists
            if (out.taskType === TASK_TYPES.FLASHCARDS) {
              const raw =
                (Array.isArray(out.config?.items) && out.config.items) ||
                (Array.isArray(out.items) && out.items) ||
                [];
              const items = raw
                .filter(Boolean)
                .map((c, i) => {
                  if (typeof c === "string") {
                    const parts = c.split("|").map((p) => p.trim());
                    return {
                      question: String(parts[0] || `Card ${i + 1}`).replace(/^q\s*:\s*/i, "").trim(),
                      answer: String(parts[1] || "").replace(/^a\s*:\s*/i, "").trim(),
                    };
                  }
                  if (c && typeof c === "object") {
                    return {
                      question: String(c.question ?? c.q ?? c.front ?? "").trim(),
                      answer: String(c.answer ?? c.a ?? c.back ?? "").trim(),
                    };
                  }
                  return { question: `Card ${i + 1}`, answer: "" };
                })
                .filter((c) => c.question && c.answer);
              out.config = { ...out.config, items };
            }

            // Hangman Duel: keep wordsByStation in config (editor uses it)
            if (out.taskType === TASK_TYPES.HANGMAN_DUEL) {
              const wbs =
                (Array.isArray(out.config?.wordsByStation) && out.config.wordsByStation) ||
                (Array.isArray(out.wordsByStation) && out.wordsByStation) ||
                [];
              out.config = { ...out.config, wordsByStation: wbs };
            }

            // Word Weaver: normalize legacy/AI variants into the schema expected by student + editor UIs.
            if (out.taskType === TASK_TYPES.WORD_WEAVER_DUEL) {
              // Preferred "scrabble" mode: out.words (array of 5–10 words) + optional gridSize/allowRotate.
              const words =
                (Array.isArray(out.words) && out.words) ||
                (Array.isArray(out.config?.words) && out.config.words) ||
                (Array.isArray(out.config?.wordBank) && out.config.wordBank) ||
                (Array.isArray(out.wordBank) && out.wordBank) ||
                [];

              if (words.length) out.words = words.filter(Boolean).map((w) => String(w).trim()).filter(Boolean);

              // Mode inference: if words exist assume scrabble unless explicitly set.
              if (!out.mode) out.mode = out.words && out.words.length ? "scrabble" : "phrase";

              // Phrase mode: keep phrase at top-level (student task expects task.phrase).
              if (!out.phrase && typeof out.prompt === "string") {
                const m = out.prompt.match(/phrase\s*:\s*['\"]([^'\"]{4,160})['\"]/i);
                if (m && m[1]) out.phrase = m[1].trim();
              }

              // If AI stuffed a phrase into `phrase` but also provided `words`, keep both.
              // Grid knobs may come either top-level or config.
              const gridSize = Number(out.gridSize ?? out.config?.gridSize);
              if (!Number.isNaN(gridSize) && gridSize > 0) out.gridSize = Math.min(15, Math.max(8, Math.floor(gridSize)));

              const allowRotate =
                typeof out.allowRotate === "boolean"
                  ? out.allowRotate
                  : typeof out.config?.allowRotate === "boolean"
                    ? out.config.allowRotate
                    : true;
              out.allowRotate = allowRotate;
            }

            // Diff Detective: ensure config.textA/textB exist
            if (out.taskType === TASK_TYPES.DIFF_DETECTIVE) {
              const textA = String(out.config?.textA ?? out.textA ?? out.config?.a ?? out.a ?? "").trim();
              const textB = String(out.config?.textB ?? out.textB ?? out.config?.b ?? out.b ?? "").trim();
              out.config = { ...out.config, textA, textB };
            }

            // VennSort: ensure config.correctAnswer mirrors task.correctAnswer
            if (out.taskType === TASK_TYPES.VENNSORT) {
              const ca =
                (out.correctAnswer && typeof out.correctAnswer === "object" && out.correctAnswer) ||
                (out.config?.correctAnswer && typeof out.config.correctAnswer === "object" && out.config.correctAnswer) ||
                {};
              out.correctAnswer = ca;
              out.config = { ...out.config, correctAnswer: ca };
            }

            return out;
          })
        );

        const meta = data.meta || {};
        const sourceConfig = meta.sourceConfig || {};
        setAiWordBank(sourceConfig.aiWordBank || []);
        setAiWordsUsed(sourceConfig.aiWordsUsed || []);
        setAiWordsUnused(sourceConfig.aiWordsUnused || []);
      })
      .catch((err) => {
        console.error("TaskSetEditor load error:", err);
        setError(err.message || "Failed to load task set");
      })
      .finally(() => setLoading(false));
  }, [id, token]);

  const addDisplay = () => {
    setDisplays((prev) => [
      ...prev,
      {
        key: `display-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: "",
        description: "",
        stationColor: "",
        notesForTeacher: "",
        imageUrl: "",
      },
    ]);
  };

  const updateDisplay = (index, field, value) => {
    setDisplays((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeDisplay = (index) => {
    setDisplays((prevDisplays) => {
      const displayToRemove = prevDisplays[index];
      const keyToRemove = displayToRemove?.key;
      if (keyToRemove) {
        setTasks((prevTasks) =>
          prevTasks.map((t) =>
            t.displayKey === keyToRemove ? { ...t, displayKey: "" } : t
          )
        );
      }
      return prevDisplays.filter((_, i) => i !== index);
    });
  };

  const addTask = () => {
    setTasks((prev) => [
      ...prev,
      {
        _tempId: Math.random().toString(36).slice(2),
        title: "",
        prompt: "",
        taskType: TASK_TYPES.MULTIPLE_CHOICE,
        options: [],
        correctAnswer: null,
        aiScoringRequired: true, // until there's a correctAnswer, assume AI or manual scoring
        timeLimitSeconds: 60,
        points: 10,
        displayKey: "",
      },
    ]);
  };

  const updateTask = (tempId, field, value) => {
    setTasks((prev) =>
      prev.map((t) =>
        t._tempId === tempId ? { ...t, [field]: value } : t
      )
    );
  };

  const handleTaskTypeChange = (tempId, nextTypeRaw) => {
    const nextType = normalizeTaskType(nextTypeRaw);

    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;

        const meta = TASK_TYPE_META[nextType] || {};
        const base = { ...t, taskType: nextType };

        // Reset common type-specific fields to avoid schema drift when switching types.
        // Keep title / prompt / points / time / displayKey.
        const resetObjectiveFields = () => {
          base.correctAnswer = null;
          base.options = Array.isArray(base.options) ? base.options : [];
        };

        if (nextType === TASK_TYPES.TRUE_FALSE) {
          // Allow both single and multi-item: default to multi-item editor pattern.
          base.options = ["True", "False"];
          base.correctAnswer = 0;

          const prevItems = Array.isArray(t.items) ? t.items : [];
          base.items =
            prevItems.length > 0
              ? prevItems.map((it, idx) => ({
                  id: String(it?.id ?? `tf${idx + 1}`),
                  prompt: String(it?.prompt ?? ""),
                  options: ["True", "False"],
                  correctAnswer:
                    typeof it?.correctAnswer === "number" ? it.correctAnswer : 0,
                }))
              : [
                  {
                    id: "tf1",
                    prompt: "",
                    options: ["True", "False"],
                    correctAnswer: 0,
                  },
                ];

          // No extra config needed
          return base;
        }

        if (nextType === TASK_TYPES.SHORT_ANSWER) {
          base.options = [];
          base.correctAnswer =
            typeof t.correctAnswer === "string" ? t.correctAnswer : "";

          const prevItems = Array.isArray(t.items) ? t.items : [];
          base.items =
            prevItems.length > 0
              ? prevItems.map((it, idx) => ({
                  id: String(it?.id ?? `sa${idx + 1}`),
                  prompt: String(it?.prompt ?? ""),
                  correctAnswer:
                    typeof it?.correctAnswer === "string" ? it.correctAnswer : "",
                  acceptableAnswers: Array.isArray(it?.acceptableAnswers)
                    ? it.acceptableAnswers
                    : undefined,
                }))
              : [
                  {
                    id: "sa1",
                    prompt: "",
                    correctAnswer: "",
                  },
                ];

          // Short answer is objective, but we usually still want AI as a sanity-check.
          if (typeof base.aiScoringRequired !== "boolean") base.aiScoringRequired = true;
          return base;
        }


        if (nextType === TASK_TYPES.TRUE_FALSE_TICTACTOE) {
          // Tic-tac-toe statements list
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined;
          const prevStatements = Array.isArray(t.statements) ? t.statements : [];
          base.statements =
            prevStatements.length
              ? prevStatements.map((s) => ({
                  text: String(s?.text ?? s ?? "").trim(),
                  isFalse: s?.isFalse === true,
                }))
              : [
                  { text: "", isFalse: false },
                  { text: "", isFalse: true },
                  { text: "", isFalse: false },
                  { text: "", isFalse: true },
                  { text: "", isFalse: false },
                  { text: "", isFalse: true },
                  { text: "", isFalse: false },
                  { text: "", isFalse: true },
                  { text: "", isFalse: false },
                ];
          base.config = { ...(t.config || {}), statementSets: [base.statements] };
          base.aiScoringRequired = false;
          base.timeLimitSeconds = Number.isFinite(Number(t.timeLimitSeconds)) ? t.timeLimitSeconds : 180;
          return base;
        }

        if (nextType === TASK_TYPES.PRONUNCIATION) {
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined;
          base.referenceText = String(t.referenceText ?? t.prompt ?? "").trim();
          base.phonetic = String(t.phonetic ?? "").trim() || undefined;
          base.languageCode = String(t.languageCode ?? "en-US");
          base.accentOptions = Array.isArray(t.accentOptions) ? t.accentOptions : ["american", "canadian", "british", "neutral"];
          base.targetAccent = String(t.targetAccent ?? base.accentOptions?.[0] ?? "american");
          base.config = {
            ...(t.config || {}),
            referenceText: base.referenceText,
            phonetic: base.phonetic,
            languageCode: base.languageCode,
            accentOptions: base.accentOptions,
            targetAccent: base.targetAccent,
          };
          base.aiScoringRequired = true;
          base.timeLimitSeconds = Number.isFinite(Number(t.timeLimitSeconds)) ? t.timeLimitSeconds : 60;
          return base;
        }

        if (nextType === TASK_TYPES.SPEECH_RECOGNITION) {
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined;
          base.referenceText = String(t.referenceText ?? "").trim();
          base.languageCode = String(t.languageCode ?? "en-US");
          base.config = { ...(t.config || {}), referenceText: base.referenceText, languageCode: base.languageCode };
          base.aiScoringRequired = true;
          base.timeLimitSeconds = Number.isFinite(Number(t.timeLimitSeconds)) ? t.timeLimitSeconds : 60;
          return base;
        }

        if (nextType === TASK_TYPES.MULTI_PLAYER_FEEDBACK) {
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined;
          base.aiScoringRequired = false;
          base.timeLimitSeconds = 0;
          base.config = { ...(t.config || {}) };
          return base;
        }

        if (nextType === TASK_TYPES.RECORD_AUDIO) {
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined;
          base.aiScoringRequired = false;
          base.timeLimitSeconds = 0;
          base.config = { ...(t.config || {}) };
          return base;
        }
        if (nextType === TASK_TYPES.OPEN_TEXT) {
          base.options = [];
          base.correctAnswer = null;
          base.items = undefined; // single prompt by design

          const prevSettings =
            t.settings && typeof t.settings === "object" ? t.settings : {};
          const gradeLevel = Number(prevSettings.gradeLevel) || 8;
          const difficulty = String(prevSettings.difficulty || "MEDIUM").toUpperCase();

          const computedMinWords =
            difficulty === "HARD"
              ? gradeLevel * 3
              : difficulty === "MEDIUM"
              ? gradeLevel * 2
              : 0;

          base.settings = {
            ...prevSettings,
            gradeLevel,
            difficulty,
            minWords:
              Number.isFinite(Number(prevSettings.minWords)) && Number(prevSettings.minWords) >= 0
                ? Number(prevSettings.minWords)
                : computedMinWords,
            language: prevSettings.language || "en-US",
          };

          base.rubricFocus = Array.isArray(t.rubricFocus) && t.rubricFocus.length
            ? t.rubricFocus
            : ["clarity", "accuracy", "reasoning", "evidence"];

          // Open-text is AI-scored / rubric by default.
          base.aiScoringRequired = true;
          return base;
        }

        // Default: follow metadata if available
        resetObjectiveFields();
        if (meta.hasOptions === true) {
          // Leave options as-is; some tasks manage options inside config/items.
          base.options = Array.isArray(t.options) ? t.options : [];
        } else {
          base.options = [];
        }

        // If the type isn't objective, don't carry correctAnswer across.
        if (meta.objectiveScoring !== true) {
          base.correctAnswer = null;
        }


        if (nextType === TASK_TYPES.PET_FEEDING) {
          base.options = [];
          base.correctAnswer = null;
          delete base.items;

          const prevCfg = t.config && typeof t.config === "object" ? t.config : {};
          const pack = String(t.pack ?? prevCfg.pack ?? "classic").trim() || "classic";
          base.pack = pack;
          base.config = { ...prevCfg, pack };
          // Usually completion/bonus only
          if (typeof base.aiScoringRequired !== "boolean") base.aiScoringRequired = false;
          return base;
        }


        if (nextType === TASK_TYPES.BRAIN_SPARK_NOTES) {
          // Notes model: title + bullets; no objective correctAnswer/options
          base.options = [];
          base.correctAnswer = null;
          delete base.items;

          const prevBullets = Array.isArray(t.bullets) ? t.bullets : [];
          base.bullets =
            prevBullets.length > 0
              ? prevBullets.map((b) => String(b ?? "").trim()).filter(Boolean).slice(0, 12)
              : ["", "", "", ""];
          base.aiScoringRequired =
            typeof t.aiScoringRequired === "boolean"
              ? t.aiScoringRequired
              : typeof meta.defaultAiScoringRequired === "boolean"
                ? meta.defaultAiScoringRequired
                : true;

          return base;
        }

        if (nextType === TASK_TYPES.MIND_MAPPER) {
          // Organizer template + ideas bank
          base.options = [];
          base.correctAnswer = null;

          const prevItems = Array.isArray(t.items) ? t.items : [];
          base.items =
            prevItems.length > 0
              ? prevItems
                  .map((it) => {
                    if (typeof it === "string") return it.trim();
                    return String(it?.text ?? it?.label ?? it?.name ?? "").trim();
                  })
                  .filter(Boolean)
                  .slice(0, 10)
              : ["", "", "", "", "", ""];

          base.organizerType =
            typeof t.organizerType === "string" && t.organizerType.trim()
              ? t.organizerType.trim()
              : "mind-map";

          base.aiScoringRequired =
            typeof t.aiScoringRequired === "boolean"
              ? t.aiScoringRequired
              : typeof meta.defaultAiScoringRequired === "boolean"
                ? meta.defaultAiScoringRequired
                : true;

          return base;
        }

        return base;
      })
    );
  };

  const moveTask = (tempId, direction) => {
    setTasks((prev) => {
      const idx = prev.findIndex((t) => t._tempId === tempId);
      if (idx === -1) return prev;

      const newIndex = direction === "up" ? idx - 1 : idx + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;

      const copy = [...prev];
      const [removed] = copy.splice(idx, 1);
      copy.splice(newIndex, 0, removed);
      return copy;
    });
  };

  const removeTask = (tempId) => {
    setTasks((prev) => prev.filter((t) => t._tempId !== tempId));
  };

  const updateOption = (tempId, index, value) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options[index] = value;
        return { ...t, options };
      })
    );
  };

  const updateSortConfig = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevConfig =
          t.config && typeof t.config === "object" ? t.config : {};
        const nextConfig = updater(prevConfig);
        return { ...t, config: nextConfig };
      })
    );
  };

  const updateSequenceConfig = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevConfig =
          t.config && typeof t.config === "object" ? t.config : {};
        const nextConfig = updater(prevConfig);
        return { ...t, config: nextConfig };
      })
    );
  };

  const updateGenericConfig = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevConfig = t.config && typeof t.config === "object" ? t.config : {};
        const nextConfig = updater(prevConfig);
        return { ...t, config: nextConfig };
      })
    );
  };

  const updateTaskItems = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevItems = Array.isArray(t.items) ? t.items : [];
        const nextItems = updater(prevItems);
        return { ...t, items: nextItems };
      })
    );
  };

  const updateJeopardyClues = (tempId, updater) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const prevClues = Array.isArray(t.clues) ? t.clues : [];
        const nextClues = updater(prevClues);
        return { ...t, clues: nextClues };
      })
    );
  };

  const addOption = (tempId) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options.push("");
        return { ...t, options };
      })
    );
  };

  const removeOption = (tempId, index) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t._tempId !== tempId) return t;
        const options = Array.isArray(t.options) ? [...t.options] : [];
        options.splice(index, 1);

        let nextCorrect = t.correctAnswer;
        if (typeof nextCorrect === "number") {
          if (nextCorrect === index) {
            nextCorrect = null;
          } else if (nextCorrect > index) {
            nextCorrect = nextCorrect - 1;
          }
        }

        return { ...t, options, correctAnswer: nextCorrect };
      })
    );
  };

  const handleSave = async () => {
    if (!name.trim()) {
      alert("Task set name is required.");
      return;
    }

    if (!tasks.length) {
      alert("Add at least one task before saving.");
      return;
    }

    const cleanTasks = tasks.map((t, index) => {
      const normalizedType = normalizeTaskType(t.taskType);

      // Preserve any extra fields on the task, but strip editor-only keys
      const base = { ...t };
      delete base._tempId;
      delete base.orderIndex;

      // Normalize correctAnswer
      let correctAnswer = base.correctAnswer ?? null;
      if (normalizedType === TASK_TYPES.MULTIPLE_CHOICE || normalizedType === TASK_TYPES.TRUE_FALSE) {
        // For MC/TF, correctAnswer should be a valid index into options
        if (!Array.isArray(base.options) || base.options.length === 0) {
          correctAnswer = null;
        } else if (
          typeof correctAnswer !== "number" ||
          correctAnswer < 0 ||
          correctAnswer >= base.options.length
        ) {
          // If the index is out of range, drop it
          correctAnswer = null;
        }
      } else if (normalizedType === TASK_TYPES.SHORT_ANSWER) {
        if (
          typeof correctAnswer === "string" &&
          correctAnswer.trim().length === 0
        ) {
          correctAnswer = null;
        }
      } else if (normalizedType === TASK_TYPES.OPEN_TEXT) {
        // Open-text is rubric / AI scored: no objective correctAnswer
        correctAnswer = null;
        base.options = [];
        delete base.items;

        const s = base.settings && typeof base.settings === "object" ? base.settings : {};
        const gradeLevel = Number(s.gradeLevel) || 8;
        const difficulty = String(s.difficulty || base.difficulty || "MEDIUM").toUpperCase();
        const computedMinWords =
          difficulty === "HARD" ? gradeLevel * 3 : difficulty === "MEDIUM" ? gradeLevel * 2 : 0;

        base.settings = {
          ...s,
          gradeLevel,
          difficulty,
          minWords:
            Number.isFinite(Number(s.minWords)) && Number(s.minWords) >= 0
              ? Number(s.minWords)
              : computedMinWords,
          language: s.language || "en-US",
        };

        base.rubricFocus =
          Array.isArray(base.rubricFocus) && base.rubricFocus.length
            ? base.rubricFocus
            : ["clarity", "accuracy", "reasoning", "evidence"];

      } else if (normalizedType === TASK_TYPES.BRAIN_SPARK_NOTES) {
        // Notes model (AI scored): no objective correctAnswer/options
        correctAnswer = null;
        base.options = [];
        delete base.items;

        const rawBullets = Array.isArray(base.bullets) ? base.bullets : [];
        base.bullets = rawBullets
          .map((b) => String(b ?? "").trim())
          .filter(Boolean)
          .slice(0, 12);

        // Keep AI scoring on by default for this task family
        if (typeof base.aiScoringRequired !== "boolean") base.aiScoringRequired = true;
      } else if (normalizedType === TASK_TYPES.MIND_MAPPER) {
        // Organizer (AI scored): no objective correctAnswer/options
        correctAnswer = null;
        base.options = [];

        const rawItems = Array.isArray(base.items) ? base.items : [];
        base.items = rawItems
          .map((it) => {
            if (typeof it === "string") return it.trim();
            return String(it?.text ?? it?.label ?? it?.name ?? "").trim();
          })
          .filter(Boolean)
          .slice(0, 12);

        base.organizerType =
          typeof base.organizerType === "string" && base.organizerType.trim()
            ? base.organizerType.trim()
            : "mind-map";

        if (typeof base.aiScoringRequired !== "boolean") base.aiScoringRequired = true;
      } else {
        // Allow objective mapping-style answers for certain types
        if (normalizedType === TASK_TYPES.VENNSORT) {
          correctAnswer =
            base.correctAnswer && typeof base.correctAnswer === "object" ? base.correctAnswer :
            base.config?.correctAnswer && typeof base.config.correctAnswer === "object" ? base.config.correctAnswer :
            {};
        } else {
          // Non-objective types shouldn't carry a correctAnswer
          correctAnswer = null;
        }
      }

      // --- BrainBlitz / Jeopardy: persist clues into config.clues (so they survive save/load) ---
      if (normalizedType === TASK_TYPES.JEOPARDY) {
        const rawClues =
          Array.isArray(t.clues) ? t.clues :
          Array.isArray(t.config?.clues) ? t.config.clues :
          Array.isArray(t.items) ? t.items :
          [];

        const normalizedClues = (Array.isArray(rawClues) ? rawClues : [])
          .map((c, i) => {
            if (typeof c === "string") return { clue: c.trim(), answer: "" };
            if (c && typeof c === "object") {
              const clueText = String(c.clue ?? c.prompt ?? c.question ?? c.text ?? "").trim();
              const ansText = String(c.answer ?? c.correctAnswer ?? "").trim();
              return { clue: clueText, answer: ansText };
            }
            return { clue: "", answer: "" };
          })
          .filter((c) => c.clue && c.clue.trim().length > 0);

        const prevCfg = base.config && typeof base.config === "object" ? base.config : {};
        base.config = { ...prevCfg, clues: normalizedClues };

        // Optional cleanup: keep clues in ONE place only
        delete base.clues;

        // Jeopardy/BrainBlitz shouldn't be using options/correctAnswer
        base.options = [];
        base.correctAnswer = null;
      }


// --- Script Play: persist roles/lines into config (structured performance script) ---
if (normalizedType === (TASK_TYPES.SCRIPT_PLAY || "script-play")) {
  const prevCfg = base.config && typeof base.config === "object" ? base.config : {};

  const roles = Array.isArray(prevCfg.roles) ? prevCfg.roles : (Array.isArray(base.roles) ? base.roles : []);
  const lines = Array.isArray(prevCfg.lines) ? prevCfg.lines : (Array.isArray(base.lines) ? base.lines : []);

  const cleanRoles = (Array.isArray(roles) ? roles : [])
    .map((r, i) => {
      if (typeof r === "string") return { id: `r${i + 1}`, name: r.trim() };
      if (r && typeof r === "object") {
        return { id: String(r.id ?? r._id ?? `r${i + 1}`), name: String(r.name ?? r.role ?? r.speaker ?? "").trim() };
      }
      return { id: `r${i + 1}`, name: "" };
    })
    .filter((r) => (r.name || "").trim().length > 0);

  const cleanLines = (Array.isArray(lines) ? lines : [])
    .map((ln, i) => {
      if (typeof ln === "string") {
        return { id: `l${i + 1}`, speaker: "", text: ln.trim(), stage: "", tone: "" };
      }
      if (ln && typeof ln === "object") {
        return {
          id: String(ln.id ?? ln._id ?? `l${i + 1}`),
          speaker: String(ln.speaker ?? ln.role ?? ln.character ?? "").trim(),
          text: String(ln.text ?? ln.line ?? ln.dialogue ?? "").trim(),
          stage: String(ln.stage ?? ln.stageDirection ?? ln.stageDirections ?? "").trim(),
          tone: String(ln.tone ?? ln.toneCue ?? "").trim(),
        };
      }
      return { id: `l${i + 1}`, speaker: "", text: "", stage: "", tone: "" };
    })
    .filter((ln) => (ln.text || "").trim().length > 0);

  base.config = {
    ...prevCfg,
    sceneTitle: String(prevCfg.sceneTitle ?? base.sceneTitle ?? "").trim(),
    contextBefore: String(prevCfg.contextBefore ?? base.contextBefore ?? "").trim(),
    contextAfter: String(prevCfg.contextAfter ?? base.contextAfter ?? "").trim(),
    roles: cleanRoles,
    lines: cleanLines,
  };

  // ScriptPlay is performance / rubric / fun points: don't carry objective correctAnswer
  base.correctAnswer = null;
  base.options = [];
}

      // Infer aiScoringRequired if not explicitly set.
      // We want objective tasks (MC, TF, Sort, Sequence, etc.) to be scored
      // rule-based without calling the AI model, while non-objective types
      // (OpenText, HideNSeek, PhotoJournal, etc.) may use AI / rubric scoring.
      const meta = TASK_TYPE_META[normalizedType] || {};
      const objective = meta.objectiveScoring === true;

      let aiScoringRequired = base.aiScoringRequired;
      if (typeof aiScoringRequired !== "boolean") {
        if (objective) {
          // Objective types can be auto-scored without AI.
          aiScoringRequired = false;
        } else if (typeof meta.defaultAiScoringRequired === "boolean") {
          aiScoringRequired = meta.defaultAiScoringRequired;
        } else {
          // Fallback: require AI unless we clearly have a direct correctAnswer.
          aiScoringRequired = !(
            correctAnswer !== null && correctAnswer !== undefined
          );
        }
      }

      return {
        ...base,
        title: (t.title || "").trim() || `Task ${index + 1}`,
        prompt: (t.prompt || "").trim(),
        taskType: normalizedType,
        options: Array.isArray(t.options)
          ? t.options.filter((o) => String(o).trim().length > 0)
          : [],
        correctAnswer,
        aiScoringRequired,
        timeLimitSeconds:
          typeof t.timeLimitSeconds === "number" && t.timeLimitSeconds > 0
            ? t.timeLimitSeconds
            : 60,
        points:
          typeof t.points === "number" && t.points > 0 ? t.points : 10,
        order: index,
      };
    });

    setSaving(true);
    setError(null);

    try {
      const url = id
        ? `${API_BASE}/api/tasksets/${id}`
        : `${API_BASE}/api/tasksets`;
      const method = id ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          tasks: cleanTasks,
          displays,
          ownerId: userId || null,
          meta: {
            sourceConfig: {
              aiWordBank,
              aiWordsUsed,
              aiWordsUnused,
            },
          },
        }),
      });

      const text = await res.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("Server returned invalid JSON while saving set");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save task set");
      }

      const newId = data._id || data.id || id;
      alert("Task set saved.");
      navigate(`/tasksets/${newId}`);
    } catch (err) {
      console.error("TaskSetEditor save error:", err);
      setError(err.message || "Failed to save task set");
    } finally {
      setSaving(false);
    }
  };

  // Navigate back to AI generator with unused words prefilled
  const handleCreateFromUnused = () => {
    if (!aiWordsUnused.length) return;
    navigate("/ai-generator", {
      state: {
        prefillWordList: aiWordsUnused,
        fromTasksetId: id || null,
      },
    });
  };

  // ---------- Shared styles ----------
  const wrapperStyle = {
    padding: 24,
    maxWidth: 960,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const cardStyle = {
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: 12,
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  };

  const btnBase = {
    padding: "6px 12px",
    borderRadius: 999,
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
    border: "1px solid transparent",
  };

  const blueButton = {
    ...btnBase,
    background: "#2563eb",
    color: "#ffffff",
    borderColor: "#2563eb",
  };

  const grayButton = {
    ...btnBase,
    background: "#ffffff",
    color: "#111827",
    borderColor: "#d1d5db",
  };

  const greenButton = {
    ...btnBase,
    background: "#059669",
    color: "#ffffff",
    borderColor: "#047857",
  };

  const redTextButton = {
    border: "none",
    background: "transparent",
    color: "#b91c1c",
    fontSize: "0.75rem",
    cursor: "pointer",
  };

  if (loading) {
    return (
      <div style={wrapperStyle}>
        <p>Loading task set…</p>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          marginBottom: 16,
        }}
      >
        <h1
          style={{
            margin: 0,
            fontSize: "1.3rem",
            fontWeight: 600,
          }}
        >
          {id ? "Edit Task Set" : "New Task Set"}
        </h1>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button
            type="button"
            onClick={() => navigate("/tasksets")}
            style={grayButton}
          >
            Back to list
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            style={{
              ...blueButton,
              opacity: saving ? 0.7 : 1,
              cursor: saving ? "wait" : "pointer",
            }}
          >
            {saving ? "Saving…" : "Save task set"}
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 8,
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "0.85rem",
          }}
        >
          {error}
        </div>
      )}

      {/* Name & description */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
            Task set name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: 8,
              fontSize: "0.9rem",
            }}
          />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
            Description (for you)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              padding: 8,
              fontSize: "0.85rem",
              resize: "vertical",
            }}
          />
        </div>
      </div>

      {/* Displays panel ... (unchanged) */}
      {/* ... you already had this section; keeping as-is for brevity */}

      {/* TASKS PANEL */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Tasks
          </h2>
          <button type="button" onClick={addTask} style={grayButton}>
            + Add task
          </button>
        </div>
        {tasks.length === 0 ? (
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "#6b7280",
            }}
          >
            No tasks yet. Add at least one to save this set.
          </p>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {tasks.map((task, index) => (
              <div
                key={task._tempId}
                style={{
                  borderRadius: 8,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                  padding: 8,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.9rem",
                      fontWeight: 600,
                    }}
                  >
                    Task {index + 1}{" "}
                    <span
                      style={{
                        fontSize: "0.75rem",
                        color: "#6b7280",
                      }}
                    >
                      {prettyCategory(task.taskType)} •{" "}
                      {TASK_TYPE_META[task.taskType]?.label ||
                        task.taskType}{" "}
                      <span style={{ color: "#9ca3af" }}>
                        · {playModeLabel(task.taskType)}
                      </span>
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 4,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => moveTask(task._tempId, "up")}
                      style={{
                        ...grayButton,
                        padding: "2px 8px",
                        fontSize: "0.7rem",
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveTask(task._tempId, "down")}
                      style={{
                        ...grayButton,
                        padding: "2px 8px",
                        fontSize: "0.7rem",
                      }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(task._tempId)}
                      style={redTextButton}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  {/* Title */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Title
                    </label>
                    <input
                      type="text"
                      value={task.title || ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "title", e.target.value)
                      }
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>

                  {/* Task type */}
                  <div>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Task type
                    </label>
                    <select
                      value={task.taskType}
                      onChange={(e) => handleTaskTypeChange(task._tempId, e.target.value)}
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    >
                      {IMPLEMENTED_TASK_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {TASK_TYPE_META[type]?.label || type}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Points & time */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                      gap: 6,
                    }}
                  >
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.8rem",
                          marginBottom: 2,
                        }}
                      >
                        Points
                      </label>
                      <input
                        type="number"
                        value={task.points ?? 10}
                        onChange={(e) =>
                          updateTask(
                            task._tempId,
                            "points",
                            Number(e.target.value)
                          )
                        }
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                        }}
                      />
                    </div>
                    <div>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.8rem",
                          marginBottom: 2,
                        }}
                      >
                        Time (sec)
                      </label>
                      <input
                        type="number"
                        value={task.timeLimitSeconds ?? 60}
                        onChange={(e) =>
                          updateTask(
                            task._tempId,
                            "timeLimitSeconds",
                            Number(e.target.value)
                          )
                        }
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Prompt */}
                <div style={{ marginBottom: 6 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: "0.8rem",
                      marginBottom: 2,
                    }}
                  >
                    Prompt (student instructions)
                  </label>
                  <textarea
                    value={task.prompt || ""}
                    onChange={(e) =>
                      updateTask(task._tempId, "prompt", e.target.value)
                    }
                    rows={3}
                    style={{
                      width: "100%",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      padding: 6,
                      fontSize: "0.8rem",
                      resize: "vertical",
                    }}
                  />



                {/* Brain Spark Notes (bullets) */}
                {task.taskType === TASK_TYPES.BRAIN_SPARK_NOTES && (() => {
                  const bullets = Array.isArray(task.bullets) ? task.bullets : [];
                  const text = bullets.join("\n");
                  const setBulletsFromText = (val) => {
                    const next = String(val || "")
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 12);
                    updateTask(task._tempId, "bullets", next);
                  };

                  return (
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                        Bullets (one per line)
                      </label>
                      <textarea
                        value={text}
                        onChange={(e) => setBulletsFromText(e.target.value)}
                        rows={6}
                        placeholder={"Definition/jot-note 1\nDefinition/jot-note 2\n..."}
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                          resize: "vertical",
                        }}
                      />
                      <div style={{ fontSize: "0.75rem", opacity: 0.8, marginTop: 4 }}>
                        Tip: keep bullets concise (definitions/jot-notes). Grades 8+ can use more bullets.
                      </div>
                    </div>
                  );
                })()}

                {/* Mind Mapper (organizer + items) */}
                {task.taskType === TASK_TYPES.MIND_MAPPER && (() => {
                  const items = Array.isArray(task.items) ? task.items : [];
                  const text = items
                    .map((it) => (typeof it === "string" ? it : String(it?.text ?? it?.label ?? it?.name ?? "")))
                    .join("\n");

                  const setItemsFromText = (val) => {
                    const next = String(val || "")
                      .split(/\r?\n/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .slice(0, 12);
                    updateTask(task._tempId, "items", next);
                  };

                  const organizerType = typeof task.organizerType === "string" ? task.organizerType : "mind-map";
                  const setOrganizerType = (val) => updateTask(task._tempId, "organizerType", val);

                  return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                            Organizer Type
                          </label>
                          <select
                            value={organizerType}
                            onChange={(e) => setOrganizerType(e.target.value)}
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          >
                            <option value="mind-map">Mind Map</option>
                            <option value="concept-web">Concept Web</option>
                            <option value="hierarchy">Hierarchy</option>
                            <option value="fishbone">Fishbone</option>
                            <option value="flow">Flow</option>
                          </select>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
                          <div style={{ fontSize: "0.75rem", opacity: 0.8 }}>
                            Items = 5–7 ideas (one per line). Use Prompt as the central concept.
                          </div>
                        </div>
                      </div>

                      <label style={{ display: "block", fontSize: "0.8rem", margin: "8px 0 2px" }}>
                        Ideas / Labels (one per line)
                      </label>
                      <textarea
                        value={text}
                        onChange={(e) => setItemsFromText(e.target.value)}
                        rows={6}
                        placeholder={"Idea 1\nIdea 2\n..."}
                        style={{
                          width: "100%",
                          borderRadius: 6,
                          border: "1px solid #d1d5db",
                          padding: 6,
                          fontSize: "0.8rem",
                          resize: "vertical",
                        }}
                      />
                    </div>
                  );
                })()}

                {/* Open-text response settings */}
                {task.taskType === TASK_TYPES.OPEN_TEXT && (() => {
                  const s = task.settings && typeof task.settings === "object" ? task.settings : {};
                  const gradeLevel = Number(s.gradeLevel) || 8;
                  const difficulty = String(s.difficulty || "MEDIUM").toUpperCase();

                  const computedMinWords =
                    difficulty === "HARD" ? gradeLevel * 3 : difficulty === "MEDIUM" ? gradeLevel * 2 : 0;

                  const minWords = Number.isFinite(Number(s.minWords)) ? Number(s.minWords) : computedMinWords;

                  const rubricDefaults = ["clarity", "accuracy", "reasoning", "evidence"];
                  const rubric = Array.isArray(task.rubricFocus) && task.rubricFocus.length
                    ? task.rubricFocus
                    : rubricDefaults;

                  const toggleRubric = (key) => {
                    const set = new Set(rubric);
                    if (set.has(key)) set.delete(key);
                    else set.add(key);
                    const next = Array.from(set);
                    updateTask(task._tempId, "rubricFocus", next.length ? next : rubricDefaults);
                  };

                  const updateSettings = (partial) => {
                    const next = { ...s, ...partial };
                    updateTask(task._tempId, "settings", next);
                  };

                  return (
                    <div
                      style={{
                        marginBottom: 10,
                        border: "1px solid rgba(99,102,241,0.25)",
                        background: "rgba(99,102,241,0.06)",
                        borderRadius: 12,
                        padding: 12,
                      }}
                    >
                      <div style={{ fontWeight: 800, fontSize: "0.9rem", marginBottom: 8 }}>
                        Response expectations (Open-text)
                      </div>

                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                            Grade level (for word-count rule)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={gradeLevel}
                            onChange={(e) => {
                              const nextGrade = Number(e.target.value) || 8;
                              const nextComputed =
                                difficulty === "HARD"
                                  ? nextGrade * 3
                                  : difficulty === "MEDIUM"
                                  ? nextGrade * 2
                                  : 0;
                              updateSettings({ gradeLevel: nextGrade, minWords: nextComputed });
                            }}
                            style={{
                              width: "100%",
                              borderRadius: 10,
                              border: "1px solid rgba(99,102,241,0.25)",
                              padding: 10,
                              fontSize: "0.9rem",
                            }}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                            Difficulty (controls minimum)
                          </label>
                          <select
                            value={difficulty}
                            onChange={(e) => {
                              const nextDiff = String(e.target.value || "MEDIUM").toUpperCase();
                              const nextComputed =
                                nextDiff === "HARD"
                                  ? gradeLevel * 3
                                  : nextDiff === "MEDIUM"
                                  ? gradeLevel * 2
                                  : 0;
                              updateSettings({ difficulty: nextDiff, minWords: nextComputed });
                            }}
                            style={{
                              width: "100%",
                              borderRadius: 10,
                              border: "1px solid rgba(99,102,241,0.25)",
                              padding: 10,
                              fontSize: "0.9rem",
                              background: "#fff",
                            }}
                          >
                            <option value="EASY">EASY</option>
                            <option value="MEDIUM">MEDIUM</option>
                            <option value="HARD">HARD</option>
                          </select>
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                            Minimum words
                          </label>
                          <input
                            type="number"
                            min={0}
                            value={minWords}
                            onChange={(e) => updateSettings({ minWords: Number(e.target.value) || 0 })}
                            style={{
                              width: "100%",
                              borderRadius: 10,
                              border: "1px solid rgba(99,102,241,0.25)",
                              padding: 10,
                              fontSize: "0.9rem",
                            }}
                          />
                          <div style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 4 }}>
                            Auto rule: MEDIUM = 2×grade, HARD = 3×grade, EASY = 0.
                          </div>
                        </div>
                      </div>

                      <div style={{ height: 10 }} />

                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                        <div style={{ fontSize: "0.78rem", color: "#374151", fontWeight: 700 }}>
                          AI rubric focus:
                        </div>
                        {["clarity", "accuracy", "reasoning", "evidence"].map((k) => (
                          <label
                            key={k}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: "0.78rem",
                              background: "#ffffff",
                              border: "1px solid rgba(99,102,241,0.18)",
                              borderRadius: 999,
                              padding: "5px 10px",
                              cursor: "pointer",
                              userSelect: "none",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={rubric.includes(k)}
                              onChange={() => toggleRubric(k)}
                            />
                            {k}
                          </label>
                        ))}
                      </div>

                      <div style={{ marginTop: 10, fontSize: "0.76rem", color: "#4b5563" }}>
                        Tip: keep the prompt specific (what to explain, cite, compare, or justify) so students write more than one-liners.
                      </div>
                    </div>
                  );
                })()}


                {/* ROLE PLAY DECK: Friendly config editor */}
                {task.taskType === TASK_TYPES.ROLE_PLAY_DECK && (() => {
                  const cfg = task.config && typeof task.config === "object" ? task.config : {};
                  const mode = String(cfg.mode || "choose");
                  const scenario = String(cfg.scenario || task.prompt || "");
                  const playerCount = cfg.playerCount ?? "";
                  const roles = Array.isArray(cfg.roles) ? cfg.roles : [];

                  const updateCfg = (partial) => {
                    const next = { ...cfg, ...partial };
                    updateTask(task._tempId, "config", next);
                    // Keep prompt aligned to scenario if prompt is empty (nice UX)
                    if ((!task.prompt || !task.prompt.trim()) && typeof partial.scenario === "string") {
                      updateTask(task._tempId, "prompt", partial.scenario);
                    }
                  };

                  const updateRole = (i, field, value) => {
                    const nextRoles = roles.map((r, idx) => {
                      if (idx !== i) return r;
                      const base = r && typeof r === "object" ? r : {};
                      return { ...base, [field]: value };
                    });
                    updateCfg({ roles: nextRoles });
                  };

                  const removeRole = (i) => {
                    const nextRoles = roles.filter((_, idx) => idx !== i);
                    updateCfg({ roles: nextRoles });
                  };

                  const addRole = () => {
                    const nextRoles = [
                      ...roles,
                      { name: `Character ${roles.length + 1}`, role: "Role", traits: ["Respectful", "Honest"] },
                    ];
                    updateCfg({ roles: nextRoles });
                  };

                  return (
                    <div
                      style={{
                        marginBottom: 10,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(99,102,241,0.25)",
                        background: "rgba(99,102,241,0.06)",
                      }}
                    >
                      <div style={{ fontWeight: 800, marginBottom: 6 }}>
                        🎭 Role Play Deck settings
                      </div>

                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr",
                          gap: 10,
                          alignItems: "start",
                          marginBottom: 8,
                        }}
                      >
                        <div>
                          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                            Mode
                          </label>
                          <select
                            value={mode}
                            onChange={(e) => updateCfg({ mode: e.target.value })}
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.85rem",
                              background: "#fff",
                            }}
                          >
                            <option value="choose">Choose (students pick Mystery/Classic)</option>
                            <option value="mystery">Mystery (hidden role cards)</option>
                            <option value="classic">Classic (open role cards)</option>
                          </select>
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                            Player count (optional)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={8}
                            value={playerCount}
                            onChange={(e) =>
                              updateCfg({
                                playerCount: e.target.value === "" ? undefined : Number(e.target.value),
                              })
                            }
                            placeholder="Auto (uses team size)"
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.85rem",
                            }}
                          />
                          <div style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 4 }}>
                            Leave blank to auto-use the team&apos;s member count.
                          </div>
                        </div>
                      </div>

                      <div style={{ marginBottom: 10 }}>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                          Scenario (shown to the team)
                        </label>
                        <textarea
                          value={scenario}
                          onChange={(e) => updateCfg({ scenario: e.target.value })}
                          rows={3}
                          placeholder="Describe the subject-linked scenario to role-play…"
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 6,
                            fontSize: "0.85rem",
                            resize: "vertical",
                          }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800 }}>Role cards</div>
                        <button
                          type="button"
                          onClick={addRole}
                          style={{
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: "#fff",
                            padding: "6px 10px",
                            borderRadius: 999,
                            cursor: "pointer",
                            fontWeight: 800,
                            fontSize: "0.8rem",
                          }}
                        >
                          + Add role card
                        </button>
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {roles.length === 0 ? (
                          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                            No role cards yet. Add 3–6 cards so the AI/task generator has good variety.
                          </div>
                        ) : (
                          roles.map((r, i) => {
                            const rr = r && typeof r === "object" ? r : {};
                            const traits = Array.isArray(rr.traits)
                              ? rr.traits
                              : Array.isArray(rr.characteristics)
                              ? rr.characteristics
                              : typeof rr.traits === "string"
                              ? rr.traits.split(",").map((x) => x.trim()).filter(Boolean)
                              : [];
                            return (
                              <div
                                key={i}
                                style={{
                                  border: "1px solid rgba(0,0,0,0.12)",
                                  background: "#fff",
                                  borderRadius: 10,
                                  padding: 10,
                                }}
                              >
                                <div
                                  style={{
                                    display: "grid",
                                    gridTemplateColumns: "1fr 1fr auto",
                                    gap: 8,
                                    alignItems: "center",
                                  }}
                                >
                                  <div>
                                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                                      Name
                                    </label>
                                    <input
                                      type="text"
                                      value={rr.name || ""}
                                      onChange={(e) => updateRole(i, "name", e.target.value)}
                                      placeholder="e.g., Captain Elise"
                                      style={{
                                        width: "100%",
                                        borderRadius: 6,
                                        border: "1px solid #d1d5db",
                                        padding: 6,
                                        fontSize: "0.85rem",
                                      }}
                                    />
                                  </div>

                                  <div>
                                    <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                                      Role
                                    </label>
                                    <input
                                      type="text"
                                      value={rr.role || ""}
                                      onChange={(e) => updateRole(i, "role", e.target.value)}
                                      placeholder="e.g., Peace negotiator"
                                      style={{
                                        width: "100%",
                                        borderRadius: 6,
                                        border: "1px solid #d1d5db",
                                        padding: 6,
                                        fontSize: "0.85rem",
                                      }}
                                    />
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => removeRole(i)}
                                    title="Remove role card"
                                    style={{
                                      border: "1px solid rgba(0,0,0,0.15)",
                                      background: "rgba(239,68,68,0.10)",
                                      color: "#991b1b",
                                      padding: "6px 10px",
                                      borderRadius: 999,
                                      cursor: "pointer",
                                      fontWeight: 900,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>

                                <div style={{ marginTop: 8 }}>
                                  <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                                    Traits (comma-separated)
                                  </label>
                                  <input
                                    type="text"
                                    value={traits.join(", ")}
                                    onChange={(e) =>
                                      updateRole(
                                        i,
                                        "traits",
                                        e.target.value
                                          .split(",")
                                          .map((x) => x.trim())
                                          .filter(Boolean)
                                      )
                                    }
                                    placeholder="e.g., courageous, patient, fair-minded"
                                    style={{
                                      width: "100%",
                                      borderRadius: 6,
                                      border: "1px solid #d1d5db",
                                      padding: 6,
                                      fontSize: "0.85rem",
                                    }}
                                  />
                                  <div style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 4 }}>
                                    These should be morally appropriate character traits.
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>

                      <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#6b7280" }}>
                        Tip: For AI generation, the model can also create role cards. This editor is mainly for hand-crafted
                        tasks and quick clean-up.
                      </div>
                    </div>
                  );
                })()}
                </div>

                {/* FAKE OUT: oral bluffing game editor */}
                {task.taskType === TASK_TYPES.FAKE_OUT && (() => {
                  const cfg = task.config && typeof task.config === "object" ? task.config : {};
                  const playerCount = Number(cfg.playerCount ?? 4);
                  const playerNames = Array.isArray(cfg.playerNames) ? cfg.playerNames : Array.from({ length: playerCount }, (_, i) => `Player ${i + 1}`);
                  const rounds = Array.isArray(cfg.rounds) ? cfg.rounds : [];

                  const updateCfg = (partial) => {
                    updateTask(task._tempId, "config", { ...cfg, ...partial });
                  };

                  const normalizeOptions = (opts) => {
                    const out = (Array.isArray(opts) ? opts : []).map((x) => String(x ?? "")).slice(0, 4);
                    while (out.length < 4) out.push("");
                    return out;
                  };

                  const updateRound = (idx, partial) => {
                    const next = rounds.map((r, i) => {
                      if (i !== idx) return r;
                      const rr = r && typeof r === "object" ? r : {};
                      const merged = { ...rr, ...partial };
                      merged.options = normalizeOptions(merged.options ?? rr.options);
                      // Force correctIndex to be within 0..2 (the 4th is the obvious joke)
                      const ci = Number(merged.correctIndex ?? 0);
                      merged.correctIndex = Number.isFinite(ci) && ci >= 0 && ci <= 2 ? ci : 0;
                      return merged;
                    });
                    updateCfg({ rounds: next });
                  };

                  const addRound = () => {
                    const next = [
                      ...rounds,
                      {
                        id: `r${rounds.length + 1}`,
                        statement: "",
                        options: ["", "", "", ""],
                        correctIndex: 0,
                      },
                    ];
                    updateCfg({ rounds: next });
                  };

                  const removeRound = (idx) => {
                    const next = rounds.filter((_, i) => i !== idx);
                    updateCfg({ rounds: next });
                  };

                  return (
                    <div
                      style={{
                        marginBottom: 10,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(37,99,235,0.22)",
                        background:
                          "linear-gradient(180deg, rgba(239,246,255,0.85), rgba(255,255,255,0.98))",
                        boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                        <div>
                          <div style={{ fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
                            <span
                              style={{
                                width: 28,
                                height: 28,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                borderRadius: 999,
                                background: "rgba(37,99,235,0.10)",
                                border: "1px solid rgba(37,99,235,0.22)",
                                fontSize: "0.95rem",
                              }}
                            >
                              🃏
                            </span>
                            Fake Out settings
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>
                            Turn-based oral reading + listening. One correct definition, two plausible fakes, plus one hilarious obvious joke option.
                          </div>
                        </div>

                        <span
                          style={{
                            fontSize: "0.72rem",
                            color: "#1d4ed8",
                            background: "rgba(37,99,235,0.10)",
                            border: "1px solid rgba(37,99,235,0.18)",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontWeight: 700,
                          }}
                        >
                          🗣️ read + vote
                        </span>
                      </div>

                      <div style={{ height: 10 }} />

                      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
                        <div>
                          <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                            Player count (intra-team)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={12}
                            value={Number.isFinite(playerCount) ? playerCount : 4}
                            onChange={(e) => {
                              const nextCount = Math.max(1, Number(e.target.value || 1));
                              const nextNames = Array.from({ length: nextCount }, (_, i) => String(playerNames[i] || `Player ${i + 1}`));
                              updateCfg({ playerCount: nextCount, playerNames: nextNames });
                            }}
                            style={{
                              width: "100%",
                              borderRadius: 10,
                              border: "1px solid rgba(37,99,235,0.22)",
                              padding: 10,
                              fontSize: "0.9rem",
                            }}
                          />
                          <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
                            Names are optional; student UI can also infer names from team members.
                          </div>
                        </div>

                        <div>
                          <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                            Scoring (optional)
                          </label>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <div>
                              <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 2 }}>Points per correct vote</div>
                              <input
                                type="number"
                                min={0}
                                value={Number(cfg.pointsPerCorrect ?? 10)}
                                onChange={(e) => updateCfg({ pointsPerCorrect: Number(e.target.value) })}
                                style={{
                                  width: "100%",
                                  borderRadius: 10,
                                  border: "1px solid rgba(37,99,235,0.22)",
                                  padding: 10,
                                  fontSize: "0.9rem",
                                }}
                              />
                            </div>
                            <div>
                              <div style={{ fontSize: "0.72rem", color: "#6b7280", marginBottom: 2 }}>Reader bonus / fooled voter</div>
                              <input
                                type="number"
                                min={0}
                                value={Number(cfg.readerBonusPerFooled ?? 2)}
                                onChange={(e) => updateCfg({ readerBonusPerFooled: Number(e.target.value) })}
                                style={{
                                  width: "100%",
                                  borderRadius: 10,
                                  border: "1px solid rgba(37,99,235,0.22)",
                                  padding: 10,
                                  fontSize: "0.9rem",
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div style={{ height: 10 }} />

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 800 }}>Rounds</div>
                        <button
                          type="button"
                          onClick={addRound}
                          style={{
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: "#fff",
                            padding: "6px 10px",
                            borderRadius: 999,
                            cursor: "pointer",
                            fontWeight: 800,
                            fontSize: "0.8rem",
                          }}
                        >
                          + Add round
                        </button>
                      </div>

                      <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                        {rounds.length === 0 ? (
                          <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                            No rounds yet. Add 3–8 rounds for a lively game.
                          </div>
                        ) : (
                          rounds.map((r, rIdx) => {
                            const rr = r && typeof r === "object" ? r : {};
                            const opts = normalizeOptions(rr.options);
                            const ci = Number.isFinite(Number(rr.correctIndex)) ? Number(rr.correctIndex) : 0;

                            return (
                              <div
                                key={rr.id || rIdx}
                                style={{
                                  border: "1px solid rgba(37,99,235,0.18)",
                                  background: "#fff",
                                  borderRadius: 12,
                                  padding: 12,
                                }}
                              >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                                  <div style={{ fontSize: "0.85rem", fontWeight: 800 }}>Round {rIdx + 1}</div>
                                  <button type="button" onClick={() => removeRound(rIdx)} style={redTextButton}>
                                    Remove
                                  </button>
                                </div>

                                <div style={{ height: 8 }} />

                                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 4 }}>
                                  Statement to read aloud (prompt stem)
                                </label>
                                <textarea
                                  rows={2}
                                  value={String(rr.statement || "")}
                                  onChange={(e) => updateRound(rIdx, { statement: e.target.value })}
                                  placeholder='e.g., "The definition of magnetism is…"'
                                  style={{
                                    width: "100%",
                                    borderRadius: 10,
                                    border: "1px solid rgba(37,99,235,0.22)",
                                    padding: 10,
                                    fontSize: "0.9rem",
                                    resize: "vertical",
                                  }}
                                />

                                <div style={{ height: 10 }} />

                                <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>
                                  Options (1 correct, 2 plausible fakes, 1 hilarious obvious joke). Correct must be one of the first 3.
                                </div>

                                <div style={{ display: "grid", gap: 8 }}>
                                  {opts.map((opt, oIdx) => {
                                    const isJoke = oIdx === 3;
                                    return (
                                      <div
                                        key={oIdx}
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "auto 1fr auto",
                                          gap: 8,
                                          alignItems: "center",
                                          padding: 10,
                                          borderRadius: 12,
                                          border: "1px solid rgba(0,0,0,0.10)",
                                          background: isJoke ? "rgba(245,158,11,0.08)" : "rgba(37,99,235,0.05)",
                                        }}
                                      >
                                        <div style={{ fontWeight: 900, width: 22 }}>{String.fromCharCode(65 + oIdx)}</div>
                                        <input
                                          type="text"
                                          value={opt}
                                          onChange={(e) => {
                                            const nextOpts = [...opts];
                                            nextOpts[oIdx] = e.target.value;
                                            updateRound(rIdx, { options: nextOpts });
                                          }}
                                          placeholder={isJoke ? "Hilarious, obviously wrong option…" : `Option ${oIdx + 1}`}
                                          style={{
                                            width: "100%",
                                            borderRadius: 10,
                                            border: "1px solid rgba(0,0,0,0.12)",
                                            padding: 10,
                                            fontSize: "0.9rem",
                                            background: "#fff",
                                          }}
                                        />
                                        {oIdx < 3 ? (
                                          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8rem", fontWeight: 800 }}>
                                            <input
                                              type="radio"
                                              name={`fakeout-correct-${task._tempId}-${rIdx}`}
                                              checked={ci === oIdx}
                                              onChange={() => updateRound(rIdx, { correctIndex: oIdx })}
                                            />
                                            Correct
                                          </label>
                                        ) : (
                                          <span style={{ fontSize: "0.78rem", color: "#92400e", fontWeight: 800 }}>
                                            Joke
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })()}


                {/* TRUE/FALSE: correct answer (single-question) */}
                {task.taskType === TASK_TYPES.TRUE_FALSE &&
                  (!Array.isArray(task.items) || task.items.length === 0) && (
                    <div style={{ marginBottom: 6 }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "0.8rem",
                          marginBottom: 2,
                        }}
                      >
                        Correct answer
                      </label>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.85rem" }}>
                          <input
                            type="radio"
                            name={`tf-correct-${task._tempId}`}
                            checked={task.correctAnswer === 0}
                            onChange={() => updateTask(task._tempId, "correctAnswer", 0)}
                          />
                          True
                        </label>
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.85rem" }}>
                          <input
                            type="radio"
                            name={`tf-correct-${task._tempId}`}
                            checked={task.correctAnswer === 1}
                            onChange={() => updateTask(task._tempId, "correctAnswer", 1)}
                          />
                          False
                        </label>
                      </div>
                    </div>
                  )}

                {/* JEOPARDY / BRAIN BLITZ: Clues editor */}
                {task.taskType === TASK_TYPES.JEOPARDY && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      BrainBlitz / Jeopardy clues
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.clues) ? task.clues : (Array.isArray(task.config?.clues) ? task.config.clues : [])).map((cl, i) => (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            // Clue word should be the smaller box; answer (optional) larger.
                            gridTemplateColumns: "1fr 2fr auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <input
                            type="text"
                            value={cl?.clue || ""}
                            onChange={(e) =>
                              updateJeopardyClues(task._tempId, (prev) => {
                                const copy = [...prev];
                                copy[i] = { ...(copy[i] || {}), clue: e.target.value };
                                return copy;
                              })
                            }
                            placeholder={`Clue ${i + 1}`}
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />

                          <input
                            type="text"
                            value={cl?.answer || ""}
                            onChange={(e) =>
                              updateJeopardyClues(task._tempId, (prev) => {
                                const copy = [...prev];
                                copy[i] = { ...(copy[i] || {}), answer: e.target.value };
                                return copy;
                              })
                            }
                            placeholder="Answer (optional)"
                            style={{
                              width: "100%",
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              updateJeopardyClues(task._tempId, (prev) => {
                                const copy = [...prev];
                                copy.splice(i, 1);
                                return copy;
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          updateJeopardyClues(task._tempId, (prev) => [
                            ...prev,
                            { clue: "", answer: "" },
                          ])
                        }
                        style={grayButton}
                      >
                        + Add clue
                      </button>

                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Student BrainBlitz uses <code>task.clues</code>.
                      </div>
                    </div>
                  </div>
                )}

                
                {/* PET FEEDING: pack selector */}
                {task.taskType === TASK_TYPES.PET_FEEDING && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Pet Feeding options
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Pack / Theme</div>
                        <select
                          value={task.pack || task.config?.pack || "classic"}
                          onChange={(e) => {
                            const pack = e.target.value;
                            updateTask(task._tempId, "pack", pack);
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, pack }));
                          }}
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        >
                          <option value="classic">Classic</option>
                          <option value="farm">Farm</option>
                          <option value="ocean">Ocean</option>
                          <option value="dino">Dino</option>
                          <option value="fantasy">Fantasy</option>
                        </select>
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Points awarded (optional)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.pointsAwarded ?? task.config?.pointsAwarded)) ? Number(task.pointsAwarded ?? task.config?.pointsAwarded) : ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            const n = v === "" ? undefined : Number(v);
                            updateTask(task._tempId, "pointsAwarded", Number.isFinite(n) ? n : undefined);
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, pointsAwarded: Number.isFinite(n) ? n : undefined }));
                          }}
                          placeholder="(leave blank for default)"
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#6b7280" }}>
                      Student task reads <code>task.pack</code>. We also mirror it into <code>task.config.pack</code> for legacy safety.
                    </div>
                  </div>
                )}

                {/* BRAINSTORM BATTLE: quick config */}
                {task.taskType === TASK_TYPES.BRAINSTORM_BATTLE && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Brainstorm Battle options
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Idea slots</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.ideaSlots)) ? Number(task.config.ideaSlots) : ""}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              ideaSlots: e.target.value === "" ? undefined : Math.max(4, Math.min(20, Number(e.target.value))),
                            }))
                          }
                          placeholder="8–12"
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 18 }}>
                        <input
                          type="checkbox"
                          checked={!!task.config?.enableVoting}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, enableVoting: e.target.checked }))
                          }
                        />
                        <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Enable voting</span>
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Seed topic (optional)</div>
                        <input
                          type="text"
                          value={task.config?.seedTopic || ""}
                          onChange={(e) => updateGenericConfig(task._tempId, (prev) => ({ ...prev, seedTopic: e.target.value }))}
                          placeholder="e.g., Causes of Confederation"
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#6b7280" }}>
                      Prompt is the main on-screen instruction. Use it to set the brainstorm direction.
                    </div>
                  </div>
                )}

                {/* COLLABORATION: prompt + rubric helpers */}
                {task.taskType === TASK_TYPES.COLLABORATION && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Collaboration options
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Minimum words (optional)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.minWords)) ? Number(task.config.minWords) : ""}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              minWords: e.target.value === "" ? undefined : Math.max(0, Number(e.target.value)),
                            }))
                          }
                          placeholder="e.g., 40"
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 18 }}>
                        <input
                          type="checkbox"
                          checked={task.config?.bonusComparisonEnabled !== false}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              bonusComparisonEnabled: e.target.checked,
                            }))
                          }
                        />
                        <span style={{ fontSize: "0.85rem", fontWeight: 700 }}>Enable “better answer” bonus</span>
                      </div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Rubric (optional)</div>
                      <textarea
                        value={task.config?.rubric || ""}
                        onChange={(e) => updateGenericConfig(task._tempId, (prev) => ({ ...prev, rubric: e.target.value }))}
                        placeholder="Quality criteria (clarity, evidence, reasoning, engagement, etc.)"
                        rows={3}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem", resize: "vertical" }}
                      />
                    </div>
                  </div>
                )}

                {/* LIVE DEBATE: topics + timing helpers */}
                {task.taskType === TASK_TYPES.LIVE_DEBATE && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Live Debate options
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Prep (sec)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.prepSeconds)) ? Number(task.config.prepSeconds) : 300}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, prepSeconds: Math.max(0, Number(e.target.value)) }))
                          }
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Per speaker (sec)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.perSpeakerSeconds)) ? Number(task.config.perSpeakerSeconds) : 135}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, perSpeakerSeconds: Math.max(30, Number(e.target.value)) }))
                          }
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Grace (sec)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.graceSeconds)) ? Number(task.config.graceSeconds) : 15}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, graceSeconds: Math.max(0, Number(e.target.value)) }))
                          }
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Min (sec)</div>
                        <input
                          type="number"
                          value={Number.isFinite(Number(task.config?.minSeconds)) ? Number(task.config.minSeconds) : 105}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({ ...prev, minSeconds: Math.max(0, Number(e.target.value)) }))
                          }
                          style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Topics (one per line)</div>
                      <textarea
                        value={Array.isArray(task.config?.topics) ? task.config.topics.join("\n") : (task.config?.topicsText || "")}
                        onChange={(e) => {
                          const lines = e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
                          updateGenericConfig(task._tempId, (prev) => ({ ...prev, topics: lines, topicsText: e.target.value }));
                        }}
                        placeholder="e.g., Should homework be banned?\nIs technology making us smarter?"
                        rows={4}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem", resize: "vertical" }}
                      />
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Rubric (optional)</div>
                      <textarea
                        value={task.config?.rubric || ""}
                        onChange={(e) => updateGenericConfig(task._tempId, (prev) => ({ ...prev, rubric: e.target.value }))}
                        placeholder="Scoring criteria for AI (evidence, structure, rebuttal, respect, etc.)"
                        rows={3}
                        style={{ width: "100%", borderRadius: 8, border: "1px solid #d1d5db", padding: 8, fontSize: "0.85rem", resize: "vertical" }}
                      />
                    </div>
                  </div>
                )}


                {/* FLASHCARDS: cards editor */}
                {task.taskType === TASK_TYPES.FLASHCARDS && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Flashcards
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.config?.items) ? task.config.items : []).map((card, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            value={card?.question || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items[i] = { ...(items[i] || {}), question: e.target.value };
                                return { ...prev, items };
                              })
                            }
                            placeholder={`Question ${i + 1}`}
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <input
                            type="text"
                            value={card?.answer || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items[i] = { ...(items[i] || {}), answer: e.target.value };
                                return { ...prev, items };
                              })
                            }
                            placeholder="Answer"
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items.splice(i, 1);
                                return { ...prev, items };
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          updateGenericConfig(task._tempId, (prev) => {
                            const items = Array.isArray(prev.items) ? [...prev.items] : [];
                            items.push({ question: "", answer: "" });
                            return { ...prev, items };
                          })
                        }
                        style={grayButton}
                      >
                        + Add card
                      </button>

                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Student Flashcards uses <code>task.config.items</code>.
                      </div>
                    </div>
                  </div>
                )}

                {/* FLASHCARDS RACE: deck editor + race settings */}
                {task.taskType === TASK_TYPES.FLASHCARDS_RACE && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Flashcards Race
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginBottom: 10 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>
                          Seconds per card
                        </div>
                        <input
                          type="number"
                          min={5}
                          max={120}
                          value={Number(task.config?.secondsPerCard ?? 20)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              secondsPerCard: Number(e.target.value || 20),
                            }))
                          }
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>
                          Player count (optional)
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={4}
                          value={task.config?.playerCount === undefined || task.config?.playerCount === null ? "" : Number(task.config.playerCount)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => {
                              const raw = String(e.target.value || "").trim();
                              if (!raw) {
                                const { playerCount, ...rest } = prev || {};
                                return rest;
                              }
                              return { ...prev, playerCount: Number(raw) };
                            })
                          }
                          placeholder="(auto)"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>
                          Points: correct
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Number(task.config?.points?.correct ?? 10)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              points: { ...(prev?.points || {}), correct: Number(e.target.value || 10) },
                            }))
                          }
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>
                          Points: first buzz bonus
                        </div>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={Number(task.config?.points?.firstBuzzBonus ?? 5)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              points: { ...(prev?.points || {}), firstBuzzBonus: Number(e.target.value || 5) },
                            }))
                          }
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                        />
                      </div>
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem", marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={task.config?.interTeam !== false}
                        onChange={(e) =>
                          updateGenericConfig(task._tempId, (prev) => ({
                            ...prev,
                            // per spec this mode is inter-team by design
                            interTeam: e.target.checked,
                          }))
                        }
                      />
                      <span>Inter-team competition enabled</span>
                      <span style={{ fontSize: "0.72rem", color: "#6b7280" }}>
                        (Recommended: ON; this mode is designed for inter-team play)
                      </span>
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.config?.items) ? task.config.items : []).map((card, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            value={card?.question || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items[i] = { ...(items[i] || {}), question: e.target.value };
                                return { ...prev, items };
                              })
                            }
                            placeholder={`Question ${i + 1}`}
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <input
                            type="text"
                            value={card?.answer || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items[i] = { ...(items[i] || {}), answer: e.target.value };
                                return { ...prev, items };
                              })
                            }
                            placeholder="Answer"
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                items.splice(i, 1);
                                return { ...prev, items };
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          updateGenericConfig(task._tempId, (prev) => {
                            const items = Array.isArray(prev.items) ? [...prev.items] : [];
                            items.push({ question: "", answer: "" });
                            return { ...prev, items };
                          })
                        }
                        style={grayButton}
                      >
                        + Add card
                      </button>

                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Student FlashcardsRace uses <code>task.config.items</code> and <code>task.config.secondsPerCard</code>.
                      </div>
                    </div>
                  </div>
                )}

                {/* HANGMAN DUEL: show/edit wordsByStation */}
                {task.taskType === TASK_TYPES.HANGMAN_DUEL && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Hangman words (per station)
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.config?.wordsByStation) ? task.config.wordsByStation : []).map((w, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            value={w?.word || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const wordsByStation = Array.isArray(prev.wordsByStation) ? [...prev.wordsByStation] : [];
                                wordsByStation[i] = { ...(wordsByStation[i] || {}), word: e.target.value };
                                return { ...prev, wordsByStation };
                              })
                            }
                            placeholder={`WORD ${i + 1}`}
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                          />
                          <input
                            type="text"
                            value={w?.hint || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const wordsByStation = Array.isArray(prev.wordsByStation) ? [...prev.wordsByStation] : [];
                                wordsByStation[i] = { ...(wordsByStation[i] || {}), hint: e.target.value };
                                return { ...prev, wordsByStation };
                              })
                            }
                            placeholder="Hint"
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const wordsByStation = Array.isArray(prev.wordsByStation) ? [...prev.wordsByStation] : [];
                                wordsByStation.splice(i, 1);
                                return { ...prev, wordsByStation };
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          updateGenericConfig(task._tempId, (prev) => {
                            const wordsByStation = Array.isArray(prev.wordsByStation) ? [...prev.wordsByStation] : [];
                            wordsByStation.push({ word: "", hint: "" });
                            return { ...prev, wordsByStation };
                          })
                        }
                        style={grayButton}
                      >
                        + Add station word
                      </button>
                    </div>
                  </div>
                )}


                {/* TRUE/FALSE TIC-TAC-TOE: edit statements */}
                {task.taskType === TASK_TYPES.TRUE_FALSE_TICTACTOE && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Statements (mark which are FALSE)
                    </label>
                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 8 }}>
                      Students are assigned TRUE or FALSE and race to claim squares by placing statements that match their role’s truthiness.
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.statements) ? task.statements : []).map((s, i) => (
                        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 6, alignItems: "center" }}>
                          <input
                            type="text"
                            value={s?.text || ""}
                            onChange={(e) =>
                              (() => {
                              const next = (Array.isArray(task.statements) ? task.statements : []).map((x, idx) => idx === i ? { ...(x || {}), text: e.target.value } : x);
                              updateTask(task._tempId, "statements", next);
                              updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), statementSets: [next] }));
                            })()
                            }
                            placeholder={`Statement ${i + 1}`}
                            style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.8rem" }}>
                            <input
                              type="checkbox"
                              checked={!!s?.isFalse}
                              onChange={(e) =>
                                (() => {
                                const next = (Array.isArray(task.statements) ? task.statements : []).map((x, idx) => idx === i ? { ...(x || {}), isFalse: e.target.checked } : x);
                                updateTask(task._tempId, "statements", next);
                                updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), statementSets: [next] }));
                              })()
                              }
                            />
                            <span>FALSE</span>
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              (() => {
                              const next = (Array.isArray(task.statements) ? task.statements : []).filter((_, idx) => idx !== i);
                              updateTask(task._tempId, "statements", next);
                              updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), statementSets: [next] }));
                            })()
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}

                      <button
                        type="button"
                        onClick={() =>
                          (() => {
                          const next = [...(Array.isArray(task.statements) ? task.statements : []), { text: "", isFalse: false }];
                          updateTask(task._tempId, "statements", next);
                          updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), statementSets: [next] }));
                        })()
                        }
                        style={grayButton}
                      >
                        + Add statement
                      </button>

                      <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                        Saved as <code>task.statements</code> (and mirrored into <code>task.config.statementSets[0]</code>).
                      </div>
                    </div>
                  </div>
                )}

                {/* PRONUNCIATION: edit referenceText/accent options */}
                {task.taskType === TASK_TYPES.PRONUNCIATION && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Pronunciation settings
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Reference text (what they should say)</div>
                        <input
                          type="text"
                          value={task.referenceText || task.config?.referenceText || ""}
                          onChange={(e) => {
                            updateTask(task._tempId, "referenceText", e.target.value);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), referenceText: e.target.value }));
                          }}
                          placeholder="e.g., Photosynthesis requires sunlight."
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Language code</div>
                        <input
                          type="text"
                          value={task.languageCode || task.config?.languageCode || "en-US"}
                          onChange={(e) => {
                            updateTask(task._tempId, "languageCode", e.target.value);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), languageCode: e.target.value }));
                          }}
                          placeholder="en-US"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Phonetic hint (optional)</div>
                      <input
                        type="text"
                        value={task.phonetic || task.config?.phonetic || ""}
                        onChange={(e) => {
                          updateTask(task._tempId, "phonetic", e.target.value);
                          updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), phonetic: e.target.value }));
                        }}
                        placeholder="e.g., foe-toh-SIN-thuh-sis"
                        style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>Accent options (comma-separated)</div>
                        <input
                          type="text"
                          value={(Array.isArray(task.accentOptions) ? task.accentOptions : task.config?.accentOptions || []).join(", ")}
                          onChange={(e) => {
                            const arr = e.target.value.split(/[,]+/).map((x) => x.trim()).filter(Boolean);
                            updateTask(task._tempId, "accentOptions", arr);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), accentOptions: arr }));
                          }}
                          placeholder="american, canadian, british, neutral"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>Default accent</div>
                        <input
                          type="text"
                          value={task.targetAccent || task.config?.targetAccent || ""}
                          onChange={(e) => {
                            updateTask(task._tempId, "targetAccent", e.target.value);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), targetAccent: e.target.value }));
                          }}
                          placeholder="american"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* SPEECH RECOGNITION: edit prompt/referenceText/language */}
                {task.taskType === TASK_TYPES.SPEECH_RECOGNITION && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Speech recognition settings
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 220px", gap: 8, marginBottom: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Reference text (optional)</div>
                        <input
                          type="text"
                          value={task.referenceText || task.config?.referenceText || ""}
                          onChange={(e) => {
                            updateTask(task._tempId, "referenceText", e.target.value);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), referenceText: e.target.value }));
                          }}
                          placeholder="(leave blank if it’s an open-ended question)"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                      </div>

                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Language code</div>
                        <input
                          type="text"
                          value={task.languageCode || task.config?.languageCode || "en-US"}
                          onChange={(e) => {
                            updateTask(task._tempId, "languageCode", e.target.value);
                            updateGenericConfig(task._tempId, (prev) => ({ ...(prev || {}), languageCode: e.target.value }));
                          }}
                          placeholder="en-US"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                        />
                      </div>
                    </div>

                    <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>
                      Student UI uses browser speech recognition; languageCode should be a BCP‑47 code (e.g., en-US, fr-CA).
                    </div>
                  </div>
                )}

                {/* MULTI-PLAYER FEEDBACK: no special schema, but show note */}
                {task.taskType === TASK_TYPES.MULTI_PLAYER_FEEDBACK && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10, fontSize: "0.8rem", color: "#374151" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Multi-player Feedback (closer)</div>
                    <div style={{ color: "#6b7280" }}>
                      This is a reflection/feedback closer (emoji rating + optional comment). It typically has no timer and is not AI-generated.
                    </div>
                  </div>
                )}

                {/* RECORD AUDIO: no special schema, but show note */}
                {task.taskType === TASK_TYPES.RECORD_AUDIO && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10, fontSize: "0.8rem", color: "#374151" }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>Record Audio (teacher-reviewed)</div>
                    <div style={{ color: "#6b7280" }}>
                      Students record an oral response. The teacher reviews the audio later. Prompt text is shown in the student UI.
                    </div>
                  </div>
                )}

                {/* WORD WEAVER: Scrabble-style "words on grid" OR legacy phrase rebuild */}
                {task.taskType === TASK_TYPES.WORD_WEAVER_DUEL && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <div style={{ flex: "0 0 auto" }}>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                          Mode
                        </label>
                        <select
                          value={task.mode || (Array.isArray(task.words) && task.words.length ? "scrabble" : "phrase")}
                          onChange={(e) => updateTask(task._tempId, "mode", e.target.value)}
                          style={{ borderRadius: 6, border: "1px solid #d1d5db", padding: "6px 8px", fontSize: "0.85rem" }}
                        >
                          <option value="scrabble">Scrabble Grid (words on grid)</option>
                          <option value="phrase">Phrase Rebuild (legacy)</option>
                        </select>
                      </div>

                      <div style={{ flex: "0 0 auto" }}>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                          Grid Size
                        </label>
                        <input
                          type="number"
                          min={8}
                          max={15}
                          value={Number(task.gridSize ?? 11)}
                          onChange={(e) => updateTask(task._tempId, "gridSize", Number(e.target.value))}
                          style={{ width: 90, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                      </div>

                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", marginTop: 18 }}>
                        <input
                          type="checkbox"
                          checked={typeof task.allowRotate === "boolean" ? task.allowRotate : true}
                          onChange={(e) => updateTask(task._tempId, "allowRotate", e.target.checked)}
                        />
                        Allow Rotate
                      </label>
                    </div>

                    {(task.mode || (Array.isArray(task.words) && task.words.length ? "scrabble" : "phrase")) === "scrabble" ? (
                      <div>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                          Word Bank (5–10 words, one per line)
                        </label>
                        <textarea
                          value={Array.isArray(task.words) ? task.words.join("\n") : ""}
                          onChange={(e) =>
                            updateTask(
                              task._tempId,
                              "words",
                              e.target.value
                                .split(/\r?\n/)
                                .map((s) => s.trim())
                                .filter(Boolean)
                                .slice(0, 20)
                            )
                          }
                          placeholder={"e.g.\nphotosynthesis\nchlorophyll\nenergy\ncarbon\noxygen"}
                          rows={6}
                          style={{
                            width: "100%",
                            borderRadius: 6,
                            border: "1px solid #d1d5db",
                            padding: 8,
                            fontSize: "0.85rem",
                            resize: "vertical",
                          }}
                        />
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 4 }}>
                          Students take turns placing whole words on a grid. Score is based on word length and intersections.
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                          Phrase
                        </label>
                        <input
                          type="text"
                          value={task.phrase || ""}
                          onChange={(e) => updateTask(task._tempId, "phrase", e.target.value)}
                          placeholder="e.g., Teamwork and Perseverance"
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                        />
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 4 }}>
                          Legacy mode: students rebuild the phrase from a word bank.
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* DIFF DETECTIVE: two texts */}
                {task.taskType === TASK_TYPES.DIFF_DETECTIVE && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      Diff Detective texts
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Text A</div>
                        <textarea
                          rows={5}
                          value={task.config?.textA || ""}
                          onChange={(e) => updateGenericConfig(task._tempId, (prev) => ({ ...prev, textA: e.target.value }))}
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem", resize: "vertical" }}
                        />
                      </div>
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 2 }}>Text B</div>
                        <textarea
                          rows={5}
                          value={task.config?.textB || ""}
                          onChange={(e) => updateGenericConfig(task._tempId, (prev) => ({ ...prev, textB: e.target.value }))}
                          style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem", resize: "vertical" }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                
                {/* MYSTERY CLUES (digital memory / end-of-set recall) */}
                {(task.taskType === (TASK_TYPES.MYSTERY_CLUES || "mystery-clues") ||
                  task.taskType === (TASK_TYPES.PHYSICAL_MYSTERY_CLUES || "physical-mystery-clues")) && (
                  <div
                    style={{
                      marginBottom: 6,
                      border: "1px solid #e5e7eb",
                      background: "#ffffff",
                      borderRadius: 10,
                      padding: 10,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>
                        🧠 Mystery Clue Cards
                      </div>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.85rem" }}>
                        <input
                          type="checkbox"
                          checked={!!task.isFinal}
                          onChange={(e) => updateTask(task._tempId, "isFinal", e.target.checked)}
                        />
                        Final recall round (isFinal)
                      </label>
                    </div>

                    <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#6b7280" }}>
                      Non-final tasks can reveal <code>clues</code> for ~8 seconds. The final task becomes the recall
                      challenge where students must pick exactly the revealed cards.
                    </div>

                    {!task.isFinal ? (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                          Clues to reveal on this task (one per line, emojis or short words)
                        </label>
                        <textarea
                          rows={3}
                          value={Array.isArray(task.clues) ? task.clues.join("\n") : ""}
                          onChange={(e) => {
                            const next = (e.target.value || "")
                              .split(/[\n,;]+/)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            updateTask(task._tempId, "clues", next);
                          }}
                          placeholder={"🍎\n🐱\n🚀"}
                          style={{
                            width: "100%",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            padding: 8,
                            fontSize: "0.85rem",
                            resize: "vertical",
                          }}
                        />
                      </div>
                    ) : (
                      <div style={{ marginTop: 10 }}>
                        <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                          Revealed clues for the final round (optional; if empty, backend/session may populate)
                        </label>
                        <textarea
                          rows={3}
                          value={Array.isArray(task.revealedClues) ? task.revealedClues.join("\n") : ""}
                          onChange={(e) => {
                            const next = (e.target.value || "")
                              .split(/[\n,;]+/)
                              .map((s) => s.trim())
                              .filter(Boolean);
                            updateTask(task._tempId, "revealedClues", next);
                          }}
                          placeholder={"🍎\n🐱\n🚀 (all revealed across the set)"}
                          style={{
                            width: "100%",
                            borderRadius: 8,
                            border: "1px solid #d1d5db",
                            padding: 8,
                            fontSize: "0.85rem",
                            resize: "vertical",
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

{/* VENNSORT: categories + membership checkboxes */}
                {task.taskType === TASK_TYPES.VENNSORT && (
                  <div style={{ marginBottom: 6, border: "1px solid #e5e7eb", background: "#ffffff", borderRadius: 10, padding: 10 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 6 }}>
                      VennSort setup
                    </label>

                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 4 }}>Categories (2–3)</div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        {(Array.isArray(task.config?.categories) ? task.config.categories : []).map((c, i) => (
                          <input
                            key={i}
                            type="text"
                            value={c || ""}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => {
                                const categories = Array.isArray(prev.categories) ? [...prev.categories] : [];
                                categories[i] = e.target.value;
                                return { ...prev, categories };
                              })
                            }
                            placeholder={`Category ${i + 1}`}
                            style={{ width: 180, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                          />
                        ))}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {(Array.isArray(task.config?.items) ? task.config.items : []).map((it, i) => {
                        const id = String(it?.id || `item-${i + 1}`);
                        const categories = Array.isArray(task.config?.categories) ? task.config.categories : [];
                        const selected = (task.correctAnswer && typeof task.correctAnswer === "object" ? task.correctAnswer : {})[id] || [];

                        return (
                          <div key={id} style={{ border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                              <input
                                type="text"
                                value={it?.text || ""}
                                onChange={(e) =>
                                  updateGenericConfig(task._tempId, (prev) => {
                                    const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                    items[i] = { ...(items[i] || {}), id, text: e.target.value };
                                    return { ...prev, items };
                                  })
                                }
                                placeholder={`Item ${i + 1}`}
                                style={{ flex: 1, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  // remove item + any correctAnswer entry
                                  updateGenericConfig(task._tempId, (prev) => {
                                    const items = Array.isArray(prev.items) ? [...prev.items] : [];
                                    items.splice(i, 1);
                                    return { ...prev, items };
                                  });
                                  updateTask(task._tempId, "correctAnswer", (prev) => prev); // no-op safeguard
                                }}
                                style={redTextButton}
                              >
                                Remove
                              </button>
                            </div>

                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                              {categories.map((cat) => (
                                <label key={cat} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.8rem" }}>
                                  <input
                                    type="checkbox"
                                    checked={selected.includes(cat)}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? Array.from(new Set([...selected, cat]))
                                        : selected.filter((x) => x !== cat);

                                      const nextMap = {
                                        ...(task.correctAnswer && typeof task.correctAnswer === "object" ? task.correctAnswer : {}),
                                        [id]: next,
                                      };
                                      updateTask(task._tempId, "correctAnswer", nextMap);
                                      updateGenericConfig(task._tempId, (prev) => ({ ...prev, correctAnswer: nextMap }));
                                    }}
                                  />
                                  {cat}
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* NARRATION SYNTHESIZE: config editor */}
{task.taskType === (TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize") && (
  <div
    style={{
      marginBottom: 6,
      border: "1px solid rgba(14,116,144,0.25)",
      background:
        "linear-gradient(180deg, rgba(224,242,254,0.65), rgba(255,255,255,0.95))",
      borderRadius: 12,
      padding: 12,
      boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              background: "rgba(14,116,144,0.12)",
              border: "1px solid rgba(14,116,144,0.25)",
              fontSize: "0.95rem",
            }}
          >
            🎙️
          </span>
          Narration Synthesize settings
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>
          Turn-based oral teach-back. Intra-team only. One concept prompt per player + peer rating slider.
        </div>
      </div>

      <span
        style={{
          fontSize: "0.72rem",
          color: "#0e7490",
          background: "rgba(14,116,144,0.10)",
          border: "1px solid rgba(14,116,144,0.20)",
          padding: "4px 10px",
          borderRadius: 999,
          fontWeight: 700,
        }}
      >
        🗣️ speak + rate
      </span>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.5fr)", gap: 10 }}>
      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Player count (prompts should match)
        </label>
        <input
          type="number"
          min={2}
          max={12}
          value={Number(task.config?.playerCount ?? 4)}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              playerCount: Number(e.target.value),
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(14,116,144,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
      </div>

      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Turn timer (sec)
        </label>
        <input
          type="number"
          min={0}
          value={Number(task.config?.perTurnSeconds ?? 60)}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              perTurnSeconds: Number(e.target.value),
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(14,116,144,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>Set 0 to disable.</div>
      </div>

      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Rating slider label
        </label>
        <input
          type="text"
          value={String(task.config?.ratingScale?.label ?? "Clarity / Accuracy / Quality")}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              ratingScale: {
                ...(prev.ratingScale && typeof prev.ratingScale === "object" ? prev.ratingScale : {}),
                label: e.target.value,
              },
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(14,116,144,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
      </div>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>Rating min</label>
        <input
          type="number"
          value={Number(task.config?.ratingScale?.min ?? 1)}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              ratingScale: {
                ...(prev.ratingScale && typeof prev.ratingScale === "object" ? prev.ratingScale : {}),
                min: Number(e.target.value),
              },
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(14,116,144,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
      </div>
      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>Rating max</label>
        <input
          type="number"
          value={Number(task.config?.ratingScale?.max ?? 5)}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              ratingScale: {
                ...(prev.ratingScale && typeof prev.ratingScale === "object" ? prev.ratingScale : {}),
                max: Number(e.target.value),
              },
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(14,116,144,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
      </div>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 6 }}>
      Player prompts (one per player)
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {(Array.isArray(task.config?.prompts) ? task.config.prompts : []).map((p, i) => (
        <div
          key={p?.id || i}
          style={{
            border: "1px solid rgba(14,116,144,0.18)",
            background: "#ffffff",
            borderRadius: 10,
            padding: 10,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Prompt {i + 1}</div>
            <button
              type="button"
              onClick={() =>
                updateGenericConfig(task._tempId, (prev) => {
                  const prompts = Array.isArray(prev.prompts) ? [...prev.prompts] : [];
                  prompts.splice(i, 1);
                  return { ...prev, prompts };
                })
              }
              style={redTextButton}
            >
              Remove
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 8 }}>
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Concept (short label)</label>
              <input
                type="text"
                value={p?.concept || ""}
                onChange={(e) =>
                  updateGenericConfig(task._tempId, (prev) => {
                    const prompts = Array.isArray(prev.prompts) ? [...prev.prompts] : [];
                    const cur = prompts[i] && typeof prompts[i] === "object" ? { ...prompts[i] } : {};
                    prompts[i] = { id: cur.id || `p${i + 1}`, ...cur, concept: e.target.value };
                    return { ...prev, prompts };
                  })
                }
                placeholder="e.g., Photosynthesis"
                style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(14,116,144,0.25)", padding: 10, fontSize: "0.9rem" }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Player prompt (read aloud)</label>
              <textarea
                rows={2}
                value={p?.prompt || ""}
                onChange={(e) =>
                  updateGenericConfig(task._tempId, (prev) => {
                    const prompts = Array.isArray(prev.prompts) ? [...prev.prompts] : [];
                    const cur = prompts[i] && typeof prompts[i] === "object" ? { ...prompts[i] } : {};
                    prompts[i] = { id: cur.id || `p${i + 1}`, ...cur, prompt: e.target.value };
                    return { ...prev, prompts };
                  })
                }
                placeholder="Explain this concept/process in your own words to your teammates…"
                style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(14,116,144,0.25)", padding: 10, fontSize: "0.9rem", resize: "vertical" }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={() =>
          updateGenericConfig(task._tempId, (prev) => {
            const prompts = Array.isArray(prev.prompts) ? [...prev.prompts] : [];
            prompts.push({ id: `p${prompts.length + 1}`, concept: "", prompt: "" });
            return { ...prev, prompts };
          })
        }
        style={grayButton}
      >
        + Add prompt
      </button>
    </div>
  </div>
)}



{/* SCRIPT PLAY: structured script editor (intra-team performance) */}
{task.taskType === (TASK_TYPES.SCRIPT_PLAY || "script-play") && (
  <div
    style={{
      marginBottom: 6,
      border: "1px solid rgba(245,158,11,0.25)",
      background:
        "linear-gradient(180deg, rgba(255,247,237,0.75), rgba(255,255,255,0.95))",
      borderRadius: 12,
      padding: 12,
      boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
      <div>
        <div style={{ fontSize: "0.9rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 28,
              height: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              background: "rgba(245,158,11,0.14)",
              border: "1px solid rgba(245,158,11,0.25)",
              fontSize: "0.95rem",
            }}
          >
            🎭
          </span>
          Script Play settings
        </div>
        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>
          Intra-team only. Pass the device from speaker to speaker. Each line can include a tone cue and stage direction.
        </div>
      </div>

      <span
        style={{
          fontSize: "0.72rem",
          color: "#92400e",
          background: "rgba(245,158,11,0.10)",
          border: "1px solid rgba(245,158,11,0.18)",
          padding: "4px 10px",
          borderRadius: 999,
          fontWeight: 700,
        }}
      >
        🎬 perform + read
      </span>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Scene title (optional)
        </label>
        <input
          type="text"
          value={String(task.config?.sceneTitle ?? "")}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              sceneTitle: e.target.value,
            }))
          }
          placeholder="e.g., 'The Council at Jerusalem'"
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
      </div>

      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Optional bonus points (performance)
        </label>
        <input
          type="number"
          min={0}
          value={Number(task.config?.expressiveBonusPoints ?? 0)}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              expressiveBonusPoints: Number(e.target.value),
            }))
          }
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.25)",
            padding: 10,
            fontSize: "0.9rem",
          }}
        />
        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
          Purely a scoring hint; your student ScriptPlay UI can decide how to use it.
        </div>
      </div>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Context before (shown briefly)
        </label>
        <textarea
          rows={3}
          value={String(task.config?.contextBefore ?? "")}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              contextBefore: e.target.value,
            }))
          }
          placeholder="1–2 lines: where we are in the story, what's happening…"
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.25)",
            padding: 10,
            fontSize: "0.9rem",
            resize: "vertical",
          }}
        />
      </div>

      <div>
        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
          Context after (shown briefly)
        </label>
        <textarea
          rows={3}
          value={String(task.config?.contextAfter ?? "")}
          onChange={(e) =>
            updateGenericConfig(task._tempId, (prev) => ({
              ...prev,
              contextAfter: e.target.value,
            }))
          }
          placeholder="1–2 lines: what happens next…"
          style={{
            width: "100%",
            borderRadius: 10,
            border: "1px solid rgba(245,158,11,0.25)",
            padding: 10,
            fontSize: "0.9rem",
            resize: "vertical",
          }}
        />
      </div>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 6 }}>
      Roles / speakers
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {(Array.isArray(task.config?.roles) ? task.config.roles : []).map((r, i) => (
        <div key={r?.id || i} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            value={String(r?.name ?? "")}
            onChange={(e) =>
              updateGenericConfig(task._tempId, (prev) => {
                const roles = Array.isArray(prev.roles) ? [...prev.roles] : [];
                roles[i] = { ...(roles[i] || {}), id: String(roles[i]?.id || `r${i + 1}`), name: e.target.value };
                return { ...prev, roles };
              })
            }
            placeholder={`Role ${i + 1} (e.g., Narrator)`}
            style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)", padding: 10, fontSize: "0.9rem" }}
          />
          <button
            type="button"
            onClick={() =>
              updateGenericConfig(task._tempId, (prev) => {
                const roles = Array.isArray(prev.roles) ? [...prev.roles] : [];
                roles.splice(i, 1);
                return { ...prev, roles };
              })
            }
            style={redTextButton}
          >
            Remove
          </button>
        </div>
      ))}
    </div>

    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={() =>
          updateGenericConfig(task._tempId, (prev) => {
            const roles = Array.isArray(prev.roles) ? [...prev.roles] : [];
            roles.push({ id: `r${roles.length + 1}`, name: "" });
            return { ...prev, roles };
          })
        }
        style={grayButton}
      >
        + Add role
      </button>
    </div>

    <div style={{ height: 10 }} />

    <div style={{ fontSize: "0.8rem", fontWeight: 700, marginBottom: 6 }}>
      Script lines
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {(Array.isArray(task.config?.lines) ? task.config.lines : []).map((ln, i) => {
        const roles = Array.isArray(task.config?.roles) ? task.config.roles : [];
        const roleNames = roles.map((r) => String(r?.name || "").trim()).filter(Boolean);

        return (
          <div
            key={ln?.id || i}
            style={{
              border: "1px solid rgba(245,158,11,0.18)",
              background: "#ffffff",
              borderRadius: 10,
              padding: 10,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>Line {i + 1}</div>
              <button
                type="button"
                onClick={() =>
                  updateGenericConfig(task._tempId, (prev) => {
                    const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
                    lines.splice(i, 1);
                    return { ...prev, lines };
                  })
                }
                style={redTextButton}
              >
                Remove
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Speaker</label>
                <input
                  list={`scriptplay-roles-${task._tempId}`}
                  value={String(ln?.speaker ?? "")}
                  onChange={(e) =>
                    updateGenericConfig(task._tempId, (prev) => {
                      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
                      lines[i] = { ...(lines[i] || {}), id: String(lines[i]?.id || `l${i + 1}`), speaker: e.target.value };
                      return { ...prev, lines };
                    })
                  }
                  placeholder="Pick or type a role"
                  style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)", padding: 10, fontSize: "0.9rem" }}
                />
                <datalist id={`scriptplay-roles-${task._tempId}`}>
                  {roleNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Tone cue (optional)</label>
                <input
                  type="text"
                  value={String(ln?.tone ?? "")}
                  onChange={(e) =>
                    updateGenericConfig(task._tempId, (prev) => {
                      const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
                      lines[i] = { ...(lines[i] || {}), id: String(lines[i]?.id || `l${i + 1}`), tone: e.target.value };
                      return { ...prev, lines };
                    })
                  }
                  placeholder="e.g., 'whisper', 'excited', 'serious'"
                  style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)", padding: 10, fontSize: "0.9rem" }}
                />
              </div>
            </div>

            <div style={{ height: 8 }} />

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Line text</label>
              <textarea
                rows={2}
                value={String(ln?.text ?? "")}
                onChange={(e) =>
                  updateGenericConfig(task._tempId, (prev) => {
                    const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
                    lines[i] = { ...(lines[i] || {}), id: String(lines[i]?.id || `l${i + 1}`), text: e.target.value };
                    return { ...prev, lines };
                  })
                }
                placeholder="What the speaker says…"
                style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)", padding: 10, fontSize: "0.9rem", resize: "vertical" }}
              />
            </div>

            <div style={{ height: 8 }} />

            <div>
              <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>Stage direction (optional)</label>
              <input
                type="text"
                value={String(ln?.stage ?? "")}
                onChange={(e) =>
                  updateGenericConfig(task._tempId, (prev) => {
                    const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
                    lines[i] = { ...(lines[i] || {}), id: String(lines[i]?.id || `l${i + 1}`), stage: e.target.value };
                    return { ...prev, lines };
                  })
                }
                placeholder="e.g., '(points to the map)', '(steps back)'"
                style={{ width: "100%", borderRadius: 10, border: "1px solid rgba(245,158,11,0.25)", padding: 10, fontSize: "0.9rem" }}
              />
            </div>
          </div>
        );
      })}
    </div>

    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={() =>
          updateGenericConfig(task._tempId, (prev) => {
            const lines = Array.isArray(prev.lines) ? [...prev.lines] : [];
            lines.push({ id: `l${lines.length + 1}`, speaker: "", text: "", stage: "", tone: "" });
            return { ...prev, lines };
          })
        }
        style={grayButton}
      >
        + Add line
      </button>
    </div>

    <div style={{ marginTop: 8, fontSize: "0.75rem", color: "#6b7280" }}>
      Student ScriptPlay UI reads <code>task.config.roles</code> + <code>task.config.lines</code>.
    </div>
  </div>
)}

{/* Multi-part items editor (MC / TF / Short Answer) */}
                {/* ECHO CHAIN: config editor */}
                {task.taskType === (TASK_TYPES.ECHO_CHAIN || "echo-chain") && (
                  <div
                    style={{
                      marginBottom: 6,
                      border: "1px solid #ddd6fe",
                      background: "linear-gradient(180deg, rgba(237,233,254,0.65), rgba(255,255,255,0.95))",
                      borderRadius: 12,
                      padding: 12,
                      boxShadow: "0 1px 2px rgba(15,23,42,0.06)",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: "0.9rem", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                          <span
                            style={{
                              width: 28,
                              height: 28,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              borderRadius: 999,
                              background: "rgba(109,40,217,0.12)",
                              border: "1px solid rgba(109,40,217,0.25)",
                              fontSize: "0.95rem",
                            }}
                          >
                            🔁
                          </span>
                          Echo Chain settings
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 2 }}>
                          Oral memory-chain game. Intra-team only. Great for retrieval practice + listening accuracy.
                        </div>
                      </div>

                      <span
                        style={{
                          fontSize: "0.72rem",
                          color: "#4c1d95",
                          background: "rgba(109,40,217,0.10)",
                          border: "1px solid rgba(109,40,217,0.20)",
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontWeight: 700,
                        }}
                      >
                        🗣️ speak + listen
                      </span>
                    </div>

                    <div style={{ height: 10 }} />

                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) repeat(3, minmax(0, 1fr))", gap: 10 }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                          Starting seed term (what the AI starts the chain with)
                        </label>
                        <input
                          type="text"
                          value={task.config?.seedTerm || ""}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              seedTerm: e.target.value,
                            }))
                          }
                          placeholder="e.g., photosynthesis"
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(109,40,217,0.25)",
                            padding: 10,
                            fontSize: "0.9rem",
                            boxShadow: "inset 0 1px 2px rgba(15,23,42,0.05)",
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                          Turn timer (sec)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={Number(task.config?.perTurnSeconds ?? 10)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              perTurnSeconds: Number(e.target.value),
                            }))
                          }
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(109,40,217,0.25)",
                            padding: 10,
                            fontSize: "0.9rem",
                          }}
                        />
                        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
                          Set 0 to disable.
                        </div>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                          Points / correct add
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={Number(task.config?.pointsPerCorrectAdd ?? 1)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              pointsPerCorrectAdd: Number(e.target.value),
                            }))
                          }
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(109,40,217,0.25)",
                            padding: 10,
                            fontSize: "0.9rem",
                          }}
                        />
                        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
                          Scales by chain length.
                        </div>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                          Rotation bonus
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={Number(task.config?.rotationBonusPoints ?? 5)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              rotationBonusPoints: Number(e.target.value),
                            }))
                          }
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(109,40,217,0.25)",
                            padding: 10,
                            fontSize: "0.9rem",
                          }}
                        />
                        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
                          Awarded for a full rotation.
                        </div>
                      </div>
                    </div>

                    <div style={{ height: 10 }} />

                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10 }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.78rem", marginBottom: 4 }}>
                          Max chain length (optional cap)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={Number(task.config?.maxChainLength ?? 30)}
                          onChange={(e) =>
                            updateGenericConfig(task._tempId, (prev) => ({
                              ...prev,
                              maxChainLength: Number(e.target.value),
                            }))
                          }
                          style={{
                            width: "100%",
                            borderRadius: 10,
                            border: "1px solid rgba(109,40,217,0.25)",
                            padding: 10,
                            fontSize: "0.9rem",
                          }}
                        />
                        <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: 2 }}>
                          Set 0 for “no cap”.
                        </div>
                      </div>

                      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            cursor: "pointer",
                            fontSize: "0.85rem",
                            color: "#111827",
                            userSelect: "none",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={task.config?.requireVocabOnly === true}
                            onChange={(e) =>
                              updateGenericConfig(task._tempId, (prev) => ({
                                ...prev,
                                requireVocabOnly: e.target.checked,
                              }))
                            }
                          />
                          Require additions to come from the AI word bank
                        </label>
                        <div style={{ fontSize: "0.72rem", color: "#6b7280", marginTop: 4 }}>
                          Helps keep the chain tightly on-topic (great for review days).
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {[TASK_TYPES.MULTIPLE_CHOICE, TASK_TYPES.TRUE_FALSE, TASK_TYPES.SHORT_ANSWER].includes(task.taskType) && (
                  <div style={{ marginBottom: 6, border: "1px solid #bfdbfe", background: "#eff6ff", borderRadius: 10, padding: 10 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Multi-part questions
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {(Array.isArray(task.items) ? task.items : []).map((it, itemIdx) => {
                        const itemOptions =
                          task.taskType === TASK_TYPES.TRUE_FALSE
                            ? ["True", "False"]
                            : Array.isArray(it?.options)
                            ? it.options
                            : [];

                        return (
                          <div
                            key={it?.id || itemIdx}
                            style={{
                              border: "1px solid #e5e7eb",
                              background: "#ffffff",
                              borderRadius: 8,
                              padding: 8,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                gap: 8,
                                marginBottom: 6,
                              }}
                            >
                              <div style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                                Item {itemIdx + 1}
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  updateTaskItems(task._tempId, (prev) => {
                                    const copy = [...prev];
                                    copy.splice(itemIdx, 1);
                                    return copy;
                                  })
                                }
                                style={redTextButton}
                              >
                                Remove item
                              </button>
                            </div>

                            <div style={{ marginBottom: 6 }}>
                              <label
                                style={{
                                  display: "block",
                                  fontSize: "0.75rem",
                                  marginBottom: 2,
                                }}
                              >
                                Prompt
                              </label>
                              <textarea
                                rows={2}
                                value={it?.prompt || ""}
                                onChange={(e) =>
                                  updateTaskItems(task._tempId, (prev) => {
                                    const copy = [...prev];
                                    copy[itemIdx] = { ...(copy[itemIdx] || {}), prompt: e.target.value };
                                    return copy;
                                  })
                                }
                                style={{
                                  width: "100%",
                                  borderRadius: 6,
                                  border: "1px solid #d1d5db",
                                  padding: 6,
                                  fontSize: "0.8rem",
                                  resize: "vertical",
                                }}
                              />
                            </div>

                            {(task.taskType === TASK_TYPES.MULTIPLE_CHOICE ||
                              task.taskType === TASK_TYPES.TRUE_FALSE) && (
                              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                <label
                                  style={{
                                    display: "block",
                                    fontSize: "0.75rem",
                                    marginBottom: 2,
                                  }}
                                >
                                  Options
                                </label>

                                {itemOptions.map((opt, optIdx) => (
                                  <div
                                    key={optIdx}
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 6,
                                    }}
                                  >
                                    <input
                                      type="text"
                                      value={opt}
                                      disabled={task.taskType === TASK_TYPES.TRUE_FALSE}
                                      onChange={(e) => {
                                        if (task.taskType !== TASK_TYPES.MULTIPLE_CHOICE) return;
                                        updateTaskItems(task._tempId, (prev) => {
                                          const copy = [...prev];
                                          const item = { ...(copy[itemIdx] || {}) };
                                          const nextOpts = Array.isArray(item.options) ? [...item.options] : [];
                                          nextOpts[optIdx] = e.target.value;
                                          item.options = nextOpts;
                                          copy[itemIdx] = item;
                                          return copy;
                                        });
                                      }}
                                      style={{
                                        flex: 1,
                                        borderRadius: 6,
                                        border: "1px solid #d1d5db",
                                        padding: 6,
                                        fontSize: "0.8rem",
                                        opacity: task.taskType === TASK_TYPES.TRUE_FALSE ? 0.8 : 1,
                                      }}
                                    />

                                    <label
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        fontSize: "0.75rem",
                                      }}
                                    >
                                      <input
                                        type="radio"
                                        name={`correct-item-${task._tempId}-${itemIdx}`}
                                        checked={it?.correctAnswer === optIdx}
                                        onChange={() =>
                                          updateTaskItems(task._tempId, (prev) => {
                                            const copy = [...prev];
                                            copy[itemIdx] = {
                                              ...(copy[itemIdx] || {}),
                                              correctAnswer: optIdx,
                                            };
                                            return copy;
                                          })
                                        }
                                      />
                                      Correct
                                    </label>
                                  </div>
                                ))}

                                {task.taskType === TASK_TYPES.MULTIPLE_CHOICE && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateTaskItems(task._tempId, (prev) => {
                                        const copy = [...prev];
                                        const item = { ...(copy[itemIdx] || {}) };
                                        const nextOpts = Array.isArray(item.options) ? [...item.options] : [];
                                        nextOpts.push("");
                                        item.options = nextOpts;
                                        copy[itemIdx] = item;
                                        return copy;
                                      })
                                    }
                                    style={grayButton}
                                  >
                                    + Add option
                                  </button>
                                )}
                              </div>
                            )}

                            {task.taskType === TASK_TYPES.SHORT_ANSWER && (
                              <div style={{ marginTop: 6 }}>
                                <label
                                  style={{
                                    display: "block",
                                    fontSize: "0.75rem",
                                    marginBottom: 2,
                                  }}
                                >
                                  Reference answer (optional)
                                </label>
                                <input
                                  type="text"
                                  value={it?.correctAnswer || ""}
                                  onChange={(e) =>
                                    updateTaskItems(task._tempId, (prev) => {
                                      const copy = [...prev];
                                      copy[itemIdx] = {
                                        ...(copy[itemIdx] || {}),
                                        correctAnswer: e.target.value,
                                      };
                                      return copy;
                                    })
                                  }
                                  placeholder="Optional model answer"
                                  style={{
                                    width: "100%",
                                    borderRadius: 6,
                                    border: "1px solid #d1d5db",
                                    padding: 6,
                                    fontSize: "0.8rem",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        );
                      })}

                      <button
                        type="button"
                        onClick={() =>
                          updateTaskItems(task._tempId, (prev) => {
                            const next = Array.isArray(prev) ? [...prev] : [];
                            if (task.taskType === TASK_TYPES.TRUE_FALSE) {
                              next.push({
                                id: `tf${next.length + 1}`,
                                prompt: "",
                                options: ["True", "False"],
                                correctAnswer: 0,
                              });
                            } else if (task.taskType === TASK_TYPES.MULTIPLE_CHOICE) {
                              next.push({
                                id: `q${next.length + 1}`,
                                prompt: "",
                                options: ["Option A", "Option B"],
                                correctAnswer: 0,
                              });
                            } else {
                              next.push({
                                id: `sa${next.length + 1}`,
                                prompt: "",
                                correctAnswer: "",
                              });
                            }
                            return next;
                          })
                        }
                        style={grayButton}
                      >
                        + Add item
                      </button>
                    </div>
                  </div>
                )}

                {/* Hide & Seek specific config */}
                {task.taskType === TASK_TYPES.HIDENSEEK && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Page / location students must find
                    </label>
                    <input
                      type="text"
                      value={task.config?.pageReference || ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "config", {
                          ...(task.config && typeof task.config === "object"
                            ? task.config
                            : {}),
                          pageReference: e.target.value,
                        })
                      }
                      placeholder="e.g., Textbook p. 142, paragraph 3"
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                )}
                {task.taskType === TASK_TYPES.HIDENSEEK && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Teacher reference answer – why is this important?
                    </label>
                    <textarea
                      value={task.config?.referenceAnswer || ""}
                      onChange={(e) =>
                        updateTask(task._tempId, "config", {
                          ...(task.config && typeof task.config === "object"
                            ? task.config
                            : {}),
                          referenceAnswer: e.target.value,
                        })
                      }
                      rows={3}
                      placeholder="Write the model explanation you’d like AI to compare student answers to."
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                        resize: "vertical",
                      }}
                    />
                    <div
                      style={{
                        marginTop: 4,
                        fontSize: "0.7rem",
                        color: "#6b7280",
                      }}
                    >
                      If you leave this blank, you can still review answers manually. When filled in, AI can help
                      compare student explanations to your model answer.
                    </div>
                  </div>
                )}

                {/* SEQUENCE / TIMELINE: Items (steps) */}
                {(task.taskType === TASK_TYPES.SEQUENCE || task.taskType === TASK_TYPES.TIMELINE) && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      {task.taskType === TASK_TYPES.TIMELINE ? "Timeline events (drag order happens in StudentApp)" : "Steps / events (drag order happens in StudentApp)"}
                    </label>

                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {(Array.isArray(task.config?.items) ? task.config.items : []).map((it, i) => {
                        const text =
                          typeof it === "string"
                            ? it
                            : it && typeof it === "object"
                            ? it.text || it.label || it.name || it.prompt || ""
                            : "";
                        return (
                          <div
                            key={i}
                            style={{ display: "flex", alignItems: "center", gap: 6 }}
                          >
                            <input
                              type="text"
                              value={text}
                              onChange={(e) =>
                                updateSequenceConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items) ? [...cfg.items] : [];
                                  const prev = items[i];
                                  if (typeof prev === "string") items[i] = e.target.value;
                                  else items[i] = { ...(prev && typeof prev === "object" ? prev : {}), text: e.target.value };
                                  return { ...cfg, items };
                                })
                              }
                              placeholder={`Step ${i + 1}`}
                              style={{
                                flex: 1,
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: 6,
                                fontSize: "0.8rem",
                              }}
                            />
                            {task.taskType === TASK_TYPES.TIMELINE && (
                              <input
                                type="text"
                                value={
                                  it && typeof it === "object" && (it.year ?? it.date ?? it.when)
                                    ? String(it.year ?? it.date ?? it.when)
                                    : ""
                                }
                                onChange={(e) =>
                                  updateGenericConfig(task._tempId, (prevCfg) => {
                                    const items = Array.isArray(prevCfg.items) ? [...prevCfg.items] : [];
                                    const prevItem = items[i];
                                    const base =
                                      typeof prevItem === "string"
                                        ? { id: `event-${i + 1}`, text: prevItem }
                                        : prevItem && typeof prevItem === "object"
                                        ? prevItem
                                        : { id: `event-${i + 1}`, text: "" };
                                    items[i] = { ...base, year: e.target.value };
                                    return { ...prevCfg, items };
                                  })
                                }
                                placeholder="Year"
                                style={{
                                  width: 110,
                                  borderRadius: 6,
                                  border: "1px solid #d1d5db",
                                  padding: 6,
                                  fontSize: "0.85rem",
                                }}
                              />
                            )}
<button
                              type="button"
                              onClick={() =>
                                updateSequenceConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items) ? [...cfg.items] : [];
                                  items.splice(i, 1);
                                  return { ...cfg, items };
                                })
                              }
                              style={{
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: "6px 10px",
                                fontSize: "0.8rem",
                                cursor: "pointer",
                                background: "white",
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    <div style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() =>
                          updateSequenceConfig(task._tempId, (cfg) => {
                            const items = Array.isArray(cfg.items) ? [...cfg.items] : [];
                            items.push({ text: "" });
                            return { ...cfg, items };
                          })
                        }
                        style={{
                          borderRadius: 8,
                          border: "1px solid #d1d5db",
                          padding: "6px 10px",
                          fontSize: "0.8rem",
                          cursor: "pointer",
                          background: "white",
                        }}
                      >
                        + Add step
                      </button>
                    </div>
                  </div>
                )}


                {/* MATCHING: Left/Right columns + mapping */}
                {task.taskType === TASK_TYPES.MATCHING && (
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Matching pairs (connect left → right)
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      {/* Left column */}
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>Left items (5–7)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {(Array.isArray(task.leftItems) ? task.leftItems : []).map((it, i) => (
                            <div key={String(it?.id || i)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="text"
                                value={it?.text || ""}
                                onChange={(e) =>
                                  updateTaskField(task._tempId, (prev) => {
                                    const leftItems = Array.isArray(prev.leftItems) ? [...prev.leftItems] : [];
                                    const id = String(leftItems[i]?.id || it?.id || `L${i + 1}`);
                                    leftItems[i] = { ...(leftItems[i] || {}), id, text: e.target.value };
                                    return { ...prev, leftItems };
                                  })
                                }
                                placeholder={`Left ${i + 1}`}
                                style={{ flex: 1, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateTaskField(task._tempId, (prev) => {
                                    const leftItems = Array.isArray(prev.leftItems) ? [...prev.leftItems] : [];
                                    const removed = leftItems.splice(i, 1);
                                    const rid = String(removed?.[0]?.id || "");
                                    const correctMatches =
                                      prev.correctMatches && typeof prev.correctMatches === "object" ? { ...prev.correctMatches } : {};
                                    if (rid && correctMatches[rid]) delete correctMatches[rid];
                                    return { ...prev, leftItems, correctMatches };
                                  })
                                }
                                style={{ border: "1px solid #e5e7eb", background: "white", borderRadius: 6, padding: "6px 8px", cursor: "pointer" }}
                                title="Remove"
                              >
                                −
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              updateTaskField(task._tempId, (prev) => {
                                const leftItems = Array.isArray(prev.leftItems) ? [...prev.leftItems] : [];
                                leftItems.push({ id: `L${leftItems.length + 1}`, text: "" });
                                return { ...prev, leftItems };
                              })
                            }
                            style={{ border: "1px solid #e5e7eb", background: "white", borderRadius: 8, padding: "6px 10px", cursor: "pointer", alignSelf: "flex-start" }}
                          >
                            + Add left
                          </button>
                        </div>
                      </div>

                      {/* Right column */}
                      <div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>Right items (5–7)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {(Array.isArray(task.rightItems) ? task.rightItems : []).map((it, i) => (
                            <div key={String(it?.id || i)} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                              <input
                                type="text"
                                value={it?.text || ""}
                                onChange={(e) =>
                                  updateTaskField(task._tempId, (prev) => {
                                    const rightItems = Array.isArray(prev.rightItems) ? [...prev.rightItems] : [];
                                    const id = String(rightItems[i]?.id || it?.id || `R${i + 1}`);
                                    rightItems[i] = { ...(rightItems[i] || {}), id, text: e.target.value };
                                    return { ...prev, rightItems };
                                  })
                                }
                                placeholder={`Right ${i + 1}`}
                                style={{ flex: 1, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem" }}
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateTaskField(task._tempId, (prev) => {
                                    const rightItems = Array.isArray(prev.rightItems) ? [...prev.rightItems] : [];
                                    const removed = rightItems.splice(i, 1);
                                    const removedId = String(removed?.[0]?.id || "");
                                    // Remove any left->removed mapping
                                    const correctMatches =
                                      prev.correctMatches && typeof prev.correctMatches === "object" ? { ...prev.correctMatches } : {};
                                    if (removedId) {
                                      Object.keys(correctMatches).forEach((k) => {
                                        if (correctMatches[k] === removedId) delete correctMatches[k];
                                      });
                                    }
                                    return { ...prev, rightItems, correctMatches };
                                  })
                                }
                                style={{ border: "1px solid #e5e7eb", background: "white", borderRadius: 6, padding: "6px 8px", cursor: "pointer" }}
                                title="Remove"
                              >
                                −
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() =>
                              updateTaskField(task._tempId, (prev) => {
                                const rightItems = Array.isArray(prev.rightItems) ? [...prev.rightItems] : [];
                                rightItems.push({ id: `R${rightItems.length + 1}`, text: "" });
                                return { ...prev, rightItems };
                              })
                            }
                            style={{ border: "1px solid #e5e7eb", background: "white", borderRadius: 8, padding: "6px 10px", cursor: "pointer", alignSelf: "flex-start" }}
                          >
                            + Add right
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Mapping */}
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginBottom: 6 }}>Correct mapping (left → right)</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {(Array.isArray(task.leftItems) ? task.leftItems : []).map((l, i) => {
                          const leftId = String(l?.id || `L${i + 1}`);
                          const rightId =
                            task.correctMatches && typeof task.correctMatches === "object" ? task.correctMatches[leftId] : "";
                          const rights = Array.isArray(task.rightItems) ? task.rightItems : [];
                          return (
                            <div key={leftId} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                              <div style={{ width: 180, fontSize: "0.85rem", color: "#111827" }}>{l?.text || `Left ${i + 1}`}</div>
                              <select
                                value={rightId || ""}
                                onChange={(e) =>
                                  updateTaskField(task._tempId, (prev) => {
                                    const correctMatches =
                                      prev.correctMatches && typeof prev.correctMatches === "object" ? { ...prev.correctMatches } : {};
                                    const chosen = e.target.value;
                                    // enforce one-to-one: remove any other left that maps to chosen
                                    Object.keys(correctMatches).forEach((k) => {
                                      if (k !== leftId && correctMatches[k] === chosen) delete correctMatches[k];
                                    });
                                    if (chosen) correctMatches[leftId] = chosen;
                                    else delete correctMatches[leftId];
                                    return { ...prev, correctMatches };
                                  })
                                }
                                style={{ flex: 1, borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.85rem", background: "white" }}
                              >
                                <option value="">Select match…</option>
                                {rights.map((r, j) => (
                                  <option key={String(r?.id || j)} value={String(r?.id || `R${j + 1}`)}>
                                    {r?.text || `Right ${j + 1}`}
                                  </option>
                                ))}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 6 }}>
                        Tip: Keep left/right lists the same length. Each right item should be used once.
                      </div>
                    </div>
                  </div>
                )}

{/* SORT: Categories / buckets */}
                {task.taskType === TASK_TYPES.SORT && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Categories / buckets
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {(Array.isArray(task.config?.buckets)
                        ? task.config.buckets
                        : []
                      ).map((bucketLabel, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <input
                            type="text"
                            value={bucketLabel || ""}
                            onChange={(e) =>
                              updateSortConfig(task._tempId, (cfg) => {
                                const buckets = Array.isArray(cfg.buckets)
                                  ? [...cfg.buckets]
                                  : [];
                                buckets[i] = e.target.value;
                                return { ...cfg, buckets };
                              })
                            }
                            placeholder={`Category ${i + 1}`}
                            style={{
                              flex: 1,
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              updateSortConfig(task._tempId, (cfg) => {
                                const buckets = Array.isArray(cfg.buckets)
                                  ? [...cfg.buckets]
                                  : [];
                                const items = Array.isArray(cfg.items)
                                  ? [...cfg.items]
                                  : [];
                                if (i < buckets.length) {
                                  buckets.splice(i, 1);
                                  // Fix any items pointing at this bucket
                                  const nextItems = items.map((it) => {
                                    if (it.bucketIndex === i) {
                                      return { ...it, bucketIndex: null };
                                    }
                                    if (
                                      typeof it.bucketIndex === "number" &&
                                      it.bucketIndex > i
                                    ) {
                                      return {
                                        ...it,
                                        bucketIndex: it.bucketIndex - 1,
                                      };
                                    }
                                    return it;
                                  });
                                  return { ...cfg, buckets, items: nextItems };
                                }
                                return cfg;
                              })
                            }
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          updateSortConfig(task._tempId, (cfg) => {
                            const buckets = Array.isArray(cfg.buckets)
                              ? [...cfg.buckets]
                              : [];
                            buckets.push(`Category ${buckets.length + 1}`);
                            return { ...cfg, buckets };
                          })
                        }
                        style={grayButton}
                      >
                        + Add category
                      </button>
                    </div>
                  </div>
                )}

                {/* SORT: Items to sort */}
                {false && task.taskType === TASK_TYPES.SORT && (
                  <pre style={{ fontSize: "0.7rem", background: "#eef2ff", padding: 4 }}>
                    {JSON.stringify(task.config, null, 2)}
                  </pre>
                )}
                {task.taskType === TASK_TYPES.SORT && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Items to sort
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {(Array.isArray(task.config?.items)
                        ? task.config.items
                        : []
                      ).map((item, idx) => {
                        const buckets = Array.isArray(task.config?.buckets)
                          ? task.config.buckets
                          : [];
                        const currentIndex =
                          typeof item.bucketIndex === "number"
                            ? item.bucketIndex
                            : "";
                        return (
                          <div
                            key={idx}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <input
                              type="text"
                              value={item.text || ""}
                              onChange={(e) =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  items[idx] = {
                                    ...(items[idx] || {}),
                                    text: e.target.value,
                                  };
                                  return { ...cfg, items };
                                })
                              }
                              placeholder={`Item ${idx + 1}`}
                              style={{
                                flex: 2,
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: 6,
                                fontSize: "0.8rem",
                              }}
                            />
                            <select
                              value={currentIndex}
                              onChange={(e) =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  const nextIndex =
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value);
                                  items[idx] = {
                                    ...(items[idx] || {}),
                                    bucketIndex: nextIndex,
                                  };
                                  return { ...cfg, items };
                                })
                              }
                              style={{
                                flex: 1,
                                borderRadius: 6,
                                border: "1px solid #d1d5db",
                                padding: 6,
                                fontSize: "0.8rem",
                              }}
                            >
                              <option value="">
                                — Select category —
                              </option>
                              {buckets.map((bLabel, bIdx) => (
                                <option key={bIdx} value={bIdx}>
                                  {bLabel || `Category ${bIdx + 1}`}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() =>
                                updateSortConfig(task._tempId, (cfg) => {
                                  const items = Array.isArray(cfg.items)
                                    ? [...cfg.items]
                                    : [];
                                  if (idx < items.length) {
                                    items.splice(idx, 1);
                                  }
                                  return { ...cfg, items };
                                })
                              }
                              style={redTextButton}
                            >
                              ✕
                            </button>
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() =>
                          updateSortConfig(task._tempId, (cfg) => {
                            const items = Array.isArray(cfg.items)
                              ? [...cfg.items]
                              : [];
                            const buckets = Array.isArray(cfg.buckets)
                              ? cfg.buckets
                              : [];
                            items.push({
                              text: "",
                              bucketIndex: buckets.length > 0 ? 0 : null,
                            });
                            return { ...cfg, items };
                          })
                        }
                        style={grayButton}
                      >
                        + Add item
                      </button>
                    </div>
                  </div>
                )}

                {/* Options area for MC / sort / sequence */}
                {[
                  TASK_TYPES.MULTIPLE_CHOICE,
                ].includes(task.taskType) && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Options
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {(task.options || []).map((opt, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <input
                            type="text"
                            value={opt}
                            onChange={(e) =>
                              updateOption(task._tempId, i, e.target.value)
                            }
                            style={{
                              flex: 1,
                              borderRadius: 6,
                              border: "1px solid #d1d5db",
                              padding: 6,
                              fontSize: "0.8rem",
                            }}
                          />
                          {task.taskType === TASK_TYPES.MULTIPLE_CHOICE && (
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: "0.7rem",
                              }}
                            >
                              <input
                                type="radio"
                                name={`correct-${task._tempId}`}
                                checked={task.correctAnswer === i}
                                onChange={() =>
                                  updateTask(
                                    task._tempId,
                                    "correctAnswer",
                                    i
                                  )
                                }
                              />
                              Correct
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => removeOption(task._tempId, i)}
                            style={redTextButton}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => addOption(task._tempId)}
                        style={grayButton}
                      >
                        + Add option
                      </button>
                    </div>
                  </div>
                )}

                {/* For short-answer, allow reference answer text */}
                {task.taskType === TASK_TYPES.SHORT_ANSWER && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Reference answer (for auto-scoring)
                    </label>
                    <input
                      type="text"
                      value={task.correctAnswer || ""}
                      onChange={(e) =>
                        updateTask(
                          task._tempId,
                          "correctAnswer",
                          e.target.value
                        )
                      }
                      placeholder="e.g., 'Photosynthesis', 'Abraham Lincoln'"
                      style={{
                        width: "100%",
                        borderRadius: 6,
                        border: "1px solid #d1d5db",
                        padding: 6,
                        fontSize: "0.8rem",
                      }}
                    />
                  </div>
                )}

                {/* Simple readout of scoring mode */}
                <div
                  style={{
                    marginTop: 4,
                    fontSize: "0.75rem",
                    color: "#6b7280",
                  }}
                >
                  {(() => {
                    const meta = TASK_TYPE_META[task.taskType] || {};
                    const objective = meta.objectiveScoring === true;

                    // 1) Purely objective tasks (MC, TF, Sort, Sequence, etc.)
                    if (objective && task.aiScoringRequired === false) {
                      return "Scoring mode: Automatic (objective rule-based – no AI needed)";
                    }

                    // 2) Short-answer style with explicit reference answer
                    if (
                      task.correctAnswer !== null &&
                      task.correctAnswer !== undefined &&
                      task.aiScoringRequired === false
                    ) {
                      return "Scoring mode: Automatic (based on reference answer – no AI needed)";
                    }

                    // 3) Hide & Seek with teacher reference answer (AI will compare student explanation)
                    if (
                      task.taskType === TASK_TYPES.HIDENSEEK &&
                      task.config &&
                      typeof task.config.referenceAnswer === "string" &&
                      task.config.referenceAnswer.trim().length > 0
                    ) {
                      return "Scoring mode: AI-assisted (Hide & Seek explanation compared with your reference answer)";
                    }

                    // 4) Everything else falls back to AI / manual scoring
                    return "Scoring mode: AI / manual scoring (no objective answer configured)";
                  })()}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Word-bank / AI metadata card, etc. – unchanged from your existing version */}
      {/* Optional button to create from unused words */}
      {aiWordsUnused.length > 0 && (
        <div style={cardStyle}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <h3
                style={{
                  margin: 0,
                  fontSize: "0.95rem",
                  fontWeight: 600,
                }}
              >
                AI word bank
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.8rem",
                  color: "#6b7280",
                }}
              >
                You still have unused words from the original AI generation.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateFromUnused}
              style={greenButton}
            >
              New AI set from unused words
            </button>
          </div>
        </div>
      )}
    </div>
  );
}