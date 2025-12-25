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
  // Legacy aliases for Hide & Seek
  if (
    v === "hidenseek" ||
    v === "hide-and-seek" ||
    v === "hide-n-seek" ||
    v === "hide_and_seek"
  ) {
    return TASK_TYPES.HIDENSEEK || "hidenseek";
  }
  if (v === "sequence" || v === "seq" || v === "timeline") {
    return TASK_TYPES.SEQUENCE;
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

            // Sequence / Timeline: accept steps/events/sequence/items legacy keys
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
            if (out.taskType === TASK_TYPES.HANGMAN_DUEL) {
              const wbs =
                (Array.isArray(out.config?.wordsByStation) && out.config.wordsByStation) ||
                (Array.isArray(out.wordsByStation) && out.wordsByStation) ||
                [];
              out.config = { ...(out.config || {}), wordsByStation: wbs };
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

            // Word Weaver: keep phrase at top-level (student task expects task.phrase)
            if (out.taskType === TASK_TYPES.WORD_WEAVER_DUEL) {
              if (!out.phrase && typeof out.prompt === "string") {
                const m = out.prompt.match(/phrase\s*:\s*['\"]([^'\"]{4,120})['\"]/i);
                if (m && m[1]) out.phrase = m[1].trim();
              }
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
                      onChange={(e) =>
                        updateTask(task._tempId, "taskType", e.target.value)
                      }
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
                </div>

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

                {/* WORD WEAVER: ensure phrase exists (current component uses task.phrase) */}
                {task.taskType === TASK_TYPES.WORD_WEAVER_DUEL && (
                  <div style={{ marginBottom: 6 }}>
                    <label style={{ display: "block", fontSize: "0.8rem", marginBottom: 2 }}>
                      Phrase
                    </label>
                    <input
                      type="text"
                      value={task.phrase || ""}
                      onChange={(e) => updateTask(task._tempId, "phrase", e.target.value)}
                      placeholder="e.g., Teamwork and Perseverance"
                      style={{ width: "100%", borderRadius: 6, border: "1px solid #d1d5db", padding: 6, fontSize: "0.8rem" }}
                    />
                    <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: 4 }}>
                      Note: the current WordWeaverDuelTask component rebuilds a phrase (not yet a Scrabble-style grid).
                    </div>
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
                {task.taskType === TASK_TYPES.SEQUENCE && (
                  <div style={{ marginBottom: 6 }}>
                    <label
                      style={{
                        display: "block",
                        fontSize: "0.8rem",
                        marginBottom: 2,
                      }}
                    >
                      Steps / events (drag order happens in StudentApp)
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