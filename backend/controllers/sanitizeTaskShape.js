// backend/controllers/sanitizeTaskShape.js
// Canonical task-shape sanitizer — imported by both mainTasksetController and sharedTasksetController.
// All AI-output cleanup / normalization for specific task types lives here.

import { TASK_TYPES } from "../../shared/taskTypes.js";

// ── String distance helpers for peer-editing word-index repair ──
function _commonPrefixLen(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function _editDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  // Optimized for short strings (words)
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b[i - 1] === a[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[b.length][a.length];
}

// Task-shape sanitizer
// Key rule: Multiple Choice & Physical Multiple Choice must NOT use config.items.
// Promote config.items -> top-level items[] if needed, then delete config.items.
// This reduces avoidable regeneration attempts.
// ------------------------------------------------------------
export function sanitizeTaskShapeByType(type, task) {
  if (!task || typeof task !== "object") return task;
  const t = { ...task };

  if (type === TASK_TYPES.MULTIPLE_CHOICE || type === TASK_TYPES.PHYSICAL_MULTIPLE_CHOICE) {
    const cfg = t.config && typeof t.config === "object" ? { ...t.config } : null;

    if ((!Array.isArray(t.items) || t.items.length === 0) && Array.isArray(cfg?.items) && cfg.items.length > 0) {
      t.items = cfg.items;
    }

    if (cfg && "items" in cfg) delete cfg.items;

    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  // ── BRAIN_SPARK_NOTES: promote notes from config ──
  if (type === TASK_TYPES.BRAIN_SPARK_NOTES) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : null;

    if (!t.notes && _isObj(cfg?.notes)) {
      t.notes = cfg.notes;
      delete cfg.notes;
    }
    if (!t.notes && _isObj(cfg?.content)) {
      t.notes = cfg.content;
      delete cfg.content;
    }

    // Strip stale config.bullets — frontend reads from config.notes, not config.bullets
    if (cfg && Array.isArray(cfg.bullets)) {
      delete cfg.bullets;
    }

    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }

    // If we got 2-level mainPoints, optionally promote to 3-level sections
    if (t.notes && typeof t.notes === "object") {
      const mp = Array.isArray(t.notes.mainPoints) ? t.notes.mainPoints : [];
      t.notes.mainPoints = mp.map((m) => {
        if (!m || typeof m !== "object") return m;
        if (Array.isArray(m.sections) && m.sections.length) return m;
        if (Array.isArray(m.bullets) && m.bullets.length) {
          return { ...m, sections: [{ title: "Key details", bullets: m.bullets }] };
        }
        return m;
      });
    }
  }

  // ── VENNSORT: Build correctAnswer from item category data if missing ──
  if (type === TASK_TYPES.VENNSORT) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    const cats = Array.isArray(cfg.categories) ? cfg.categories : [];
    const items = Array.isArray(cfg.items) ? cfg.items : [];
    const hasCA = t.correctAnswer && typeof t.correctAnswer === "object" && Object.keys(t.correctAnswer).length > 0;

    if (cats.length === 0 && Array.isArray(t.categories) && t.categories.length >= 2) {
      cfg.categories = t.categories;
    }
    if (items.length === 0 && Array.isArray(t.items) && t.items.length >= 5) {
      cfg.items = t.items;
    }
    if (!t.config || typeof t.config !== "object") t.config = {};
    if (cfg.categories) t.config.categories = cfg.categories;
    if (cfg.items) t.config.items = cfg.items;

    const finalCats = Array.isArray(t.config.categories) ? t.config.categories : [];
    const finalItems = Array.isArray(t.config.items) ? t.config.items : [];

    if (!hasCA && finalItems.length > 0 && finalCats.length >= 2) {
      const built = {};
      for (let i = 0; i < finalItems.length; i++) {
        const it = finalItems[i];
        if (!it || typeof it !== "object") continue;
        const itemId = it.id || it.itemId || `item-${i}-${(it.text || it.label || it.name || "").replace(/\s+/g, "")}`;
        if (!it.id) it.id = itemId;

        let assignedCats = null;
        if (Array.isArray(it.categories) && it.categories.length > 0) assignedCats = it.categories;
        else if (Array.isArray(it.correctCategories) && it.correctCategories.length > 0) assignedCats = it.correctCategories;
        else if (typeof it.category === "string" && it.category) assignedCats = [it.category];
        else if (typeof it.correctCategory === "string" && it.correctCategory) assignedCats = [it.correctCategory];
        else if (typeof it.placement === "string" && it.placement) {
          if (it.placement.toLowerCase() === "both" && finalCats.length === 2) assignedCats = [...finalCats];
          else assignedCats = [it.placement];
        }
        else if (typeof it.region === "string" && it.region) assignedCats = [it.region];
        else if (typeof it.zone === "string" && it.zone) assignedCats = [it.zone];
        else if (Array.isArray(it.belongsTo) && it.belongsTo.length > 0) assignedCats = it.belongsTo;

        if (assignedCats && assignedCats.length > 0) {
          const validCats = assignedCats.filter((c) =>
            finalCats.some((fc) => {
              const fcStr = typeof fc === "string" ? fc : fc?.label || fc?.name || "";
              return fcStr.toLowerCase() === String(c).toLowerCase();
            })
          );
          const canonicalCats = validCats.map((c) => {
            const match = finalCats.find((fc) => {
              const fcStr = typeof fc === "string" ? fc : fc?.label || fc?.name || "";
              return fcStr.toLowerCase() === String(c).toLowerCase();
            });
            return typeof match === "string" ? match : match?.label || match?.name || String(c);
          });
          if (canonicalCats.length > 0) built[itemId] = canonicalCats;
        }
      }

      if (Object.keys(built).length >= 5) {
        t.correctAnswer = built;
        console.log(`[sanitize] Built vennsort correctAnswer from item data (${Object.keys(built).length} entries)`);
      }
    }

    // Truncate long item text
    const truncItems = Array.isArray(t.config?.items) ? t.config.items : [];
    if (truncItems.length > 0) {
      t.config.items = truncItems.map((it) => {
        if (!it || typeof it !== "object") return it;
        const text = String(it.text || "").trim();
        if (text.length > 80) return { ...it, text: text.slice(0, 77) + "..." };
        return it;
      });
    }
  }

  // ── Script Play: coerce common AI shapes into lines[] ──
  if (type === TASK_TYPES.SCRIPT_PLAY) {
    const flattenObj = (l) => {
      if (typeof l === "string") return [l.trim()];
      if (l && typeof l === "object") {
        const speaker = String(l.speaker || l.character || l.name || l.role || "").trim();
        const innerLines = Array.isArray(l.lines) ? l.lines : Array.isArray(l.dialogue) ? l.dialogue : null;
        if (innerLines && innerLines.length) {
          return innerLines.map((il) => {
            const txt = String(typeof il === "string" ? il : il?.text || il?.line || il?.say || "").trim();
            return txt ? (speaker ? `${speaker}: ${txt}` : txt) : "";
          }).filter(Boolean);
        }
        const text = String(l.text || l.line || l.say || l.dialogue || "").trim();
        if (!text) return [];
        return [speaker ? `${speaker}: ${text}` : text];
      }
      return [];
    };

    let lines =
      (Array.isArray(t.lines) && t.lines.length && t.lines) ||
      (Array.isArray(t.config?.lines) && t.config.lines.length && t.config.lines) ||
      (Array.isArray(t.dialogue) && t.dialogue.length && t.dialogue) ||
      (Array.isArray(t.config?.dialogue) && t.config.dialogue.length && t.config.dialogue) ||
      (Array.isArray(t.config?.beats) && t.config.beats.length && t.config.beats) ||
      (Array.isArray(t.beats) && t.beats.length && t.beats) ||
      (Array.isArray(t.scenes) && t.scenes.length && t.scenes) ||
      (Array.isArray(t.config?.scenes) && t.config.scenes.length && t.config.scenes) ||
      null;

    if (!lines) {
      const blob = String(t.script || t.config?.script || t.text || t.config?.text || "").trim();
      if (blob) lines = blob.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }

    if (lines) {
      lines = lines.flatMap(flattenObj).filter(Boolean);
      t.lines = lines;
      if (t.config && typeof t.config === "object") t.config.lines = lines;
    }
  }

  // ── FAKE_OUT: deduplicate options, fix correctIndex/correctOption mismatches ──
  if (type === TASK_TYPES.FAKE_OUT) {
    const rounds = Array.isArray(t.config?.rounds) ? t.config.rounds : Array.isArray(t.rounds) ? t.rounds : [];
    const cleanedRounds = rounds.map((r) => {
      if (!r || typeof r !== "object") return r;
      const round = { ...r };
      if (Array.isArray(round.options)) {
        // Deduplicate options (case-insensitive), preserving order
        const seen = new Set();
        round.options = round.options
          .map((o) => String(o || "").trim())
          .filter(Boolean)
          .filter((o) => {
            const key = o.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        // Contract: options must be exactly 3 strings that do NOT include jokeOption.
        // The normalizer inserts jokeOption at jokeIndex later, making 4 for gameplay.
        // AI frequently puts the jokeOption inside options — strip it out first.
        const jokeOpt = String(round.jokeOption || "").trim().toLowerCase();
        if (jokeOpt) {
          round.options = round.options.filter((o) => o.toLowerCase() !== jokeOpt);
        }

        // Trim to exactly 3 options if AI generated more (keep correctOption)
        if (round.options.length > 3) {
          const correctOpt = String(round.correctOption || "").trim().toLowerCase();
          const keep = new Set();
          round.options.forEach((o, i) => {
            if (o.toLowerCase() === correctOpt) keep.add(i);
          });
          for (let i = 0; i < round.options.length && keep.size < 3; i++) {
            if (!keep.has(i)) keep.add(i);
          }
          round.options = round.options.filter((_, i) => keep.has(i));
        }

        // Fix correctOption / correctIndex consistency
        const correctOpt = String(round.correctOption || "").trim();
        if (correctOpt) {
          const idx = round.options.findIndex((o) => o.toLowerCase() === correctOpt.toLowerCase());
          if (idx >= 0) round.correctIndex = idx;
        }
      }
      return round;
    });
    // Fix monotone correctIndex — if all rounds have the same correctIndex, rotate them
    if (cleanedRounds.length >= 3) {
      const indices = cleanedRounds.map((r) => r.correctIndex);
      const allSame = indices.every((i) => i === indices[0]);
      if (allSame) {
        const positions = [0, 1, 2]; // cycle through available positions
        cleanedRounds.forEach((r, i) => {
          if (!Array.isArray(r.options) || r.options.length < 2) return;
          const newIdx = positions[i % positions.length];
          if (newIdx >= r.options.length) return; // safety
          if (newIdx !== r.correctIndex) {
            // Swap the option at newIdx with the correct option
            const oldIdx = r.correctIndex;
            if (oldIdx >= 0 && oldIdx < r.options.length) {
              [r.options[oldIdx], r.options[newIdx]] = [r.options[newIdx], r.options[oldIdx]];
              r.correctIndex = newIdx;
              if (r.correctOption) {
                // correctOption text stays the same, just index changed
              }
            }
          }
        });
        console.log(`[sanitize] Rotated monotone FAKE_OUT correctIndex across ${cleanedRounds.length} rounds`);
      }
    }

    if (t.config && typeof t.config === "object") t.config.rounds = cleanedRounds;
    if (Array.isArray(t.rounds)) t.rounds = cleanedRounds;
  }

  // ── HANGMAN_DUEL: strip non-alpha words from wordsByStation ──
  if (type === TASK_TYPES.HANGMAN_DUEL) {
    const isAlpha = (w) => /^[A-Za-z]{3,14}$/.test(w);
    const wbs = Array.isArray(t.wordsByStation) ? t.wordsByStation : Array.isArray(t.config?.wordsByStation) ? t.config.wordsByStation : null;
    if (wbs) {
      const cleaned = wbs
        .map((entry) => {
          if (!entry || typeof entry !== "object") return entry;
          const w = String(entry.word || "").trim();
          if (!isAlpha(w)) {
            const stripped = w.replace(/[^A-Za-z]/g, "");
            if (isAlpha(stripped)) return { ...entry, word: stripped };
            return null;
          }
          return entry;
        })
        .filter(Boolean);
      if (cleaned.length > 0) {
        t.wordsByStation = cleaned;
        if (t.config && typeof t.config === "object") t.config.wordsByStation = cleaned;
      }
    }
  }

  // ── PET_FEEDING: promote goodFoods/badFoods from config to root ──
  if (type === TASK_TYPES.PET_FEEDING) {
    if (!Array.isArray(t.goodFoods) || t.goodFoods.length === 0) {
      if (Array.isArray(t.config?.goodFoods) && t.config.goodFoods.length > 0) {
        t.goodFoods = t.config.goodFoods;
      }
    }
    if (!Array.isArray(t.badFoods) || t.badFoods.length === 0) {
      if (Array.isArray(t.config?.badFoods) && t.config.badFoods.length > 0) {
        t.badFoods = t.config.badFoods;
      }
    }
  }

  // ── MAD_DASH_SEQUENCE: normalize correctOrder to integers + auto-scramble ──
  if (type === TASK_TYPES.MAD_DASH_SEQUENCE) {
    const items = Array.isArray(t.config?.items) ? t.config.items : Array.isArray(t.items) ? t.items : [];
    let order = t.config?.correctOrder || t.correctOrder;

    // Normalize to integers
    if (Array.isArray(order)) {
      order = order.map((v) => parseInt(v, 10)).filter((v) => Number.isFinite(v));
    }

    // Auto-scramble: AI naturally lists items in correct order (correctOrder = [0,1,2,...]).
    // We shuffle the items array and compute the inverse mapping for correctOrder.
    if (Array.isArray(order) && items.length >= 3 && order.length === items.length) {
      const isTrivial = order.every((v, i) => v === i);
      if (isTrivial) {
        // Fisher-Yates shuffle of indices
        const indices = items.map((_, i) => i);
        for (let i = indices.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j], indices[i]];
        }
        // Ensure it's actually shuffled (not accidentally identity)
        if (indices.every((v, i) => v === i)) {
          [indices[0], indices[1]] = [indices[1], indices[0]];
        }
        // Reorder items according to shuffled indices
        const shuffledItems = indices.map((i) => items[i]);
        // correctOrder[scrambledPos] = originalPos, but we need:
        // "what position in the scrambled list does the i-th correct item occupy?"
        // inverseMap[originalIdx] = scrambledIdx
        const inverseMap = new Array(items.length);
        indices.forEach((origIdx, scrambledIdx) => { inverseMap[origIdx] = scrambledIdx; });
        // correctOrder = the order to read scrambled items to get the original sequence
        // i.e. [inverseMap[0], inverseMap[1], ...] tells us: "correct item 0 is at scrambled position X"
        const newOrder = items.map((_, origIdx) => inverseMap[origIdx]);

        if (t.config && typeof t.config === "object") {
          t.config.items = shuffledItems;
          t.config.correctOrder = newOrder;
        }
        if (Array.isArray(t.items)) t.items = shuffledItems;
        if (Array.isArray(t.correctOrder)) t.correctOrder = newOrder;
        console.log(`[sanitize] Auto-scrambled MAD_DASH_SEQUENCE items (was trivial [0,1,2,...])`);
        order = newOrder; // update for the assignment below
      }
    }

    // Assign normalized order
    if (Array.isArray(order) && order.length > 0) {
      if (t.config && typeof t.config === "object") t.config.correctOrder = order;
      if (Array.isArray(t.correctOrder)) t.correctOrder = order;
    }
  }

  // ── MIND_MAPPER: promote config.structure → structure, config.items → items ──
  if (type === TASK_TYPES.MIND_MAPPER) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};

    // Promote structure from config if missing at top level
    if (!t.structure && cfg.structure && typeof cfg.structure === "object") {
      t.structure = cfg.structure;
    }
    // Also check organizerStructure
    if (!t.structure && cfg.organizerStructure && typeof cfg.organizerStructure === "object") {
      t.structure = cfg.organizerStructure;
    }

    // Promote items from config if missing at top level
    if ((!Array.isArray(t.items) || t.items.length === 0) && Array.isArray(cfg.items) && cfg.items.length > 0) {
      t.items = cfg.items;
    }

    // Promote organizerType
    if (!t.organizerType && cfg.organizerType) {
      t.organizerType = cfg.organizerType;
    }
    // Default organizerType if missing
    if (!t.organizerType) {
      t.organizerType = "mind-map";
    }

    // Detect placeholder items like "Concept 1", "Concept 2", etc.
    const _isPlaceholder = (it) => {
      const text = typeof it === "string" ? it : it?.text ?? it?.label ?? "";
      return /^(concept|item|term|word|answer|option|placeholder)\s*\d+$/i.test(String(text).trim());
    };

    if (Array.isArray(t.items) && t.items.some(_isPlaceholder)) {
      // If config.items has real content, auto-fix by promoting it
      if (Array.isArray(cfg.items) && cfg.items.length > 0 && !cfg.items.some(_isPlaceholder)) {
        // config.items may be flat strings (freeform) or objects (template) — normalize
        t.items = cfg.items.map((it, i) => {
          if (typeof it === "object" && it !== null) return it;
          return { text: String(it), correctIndex: i };
        });
      } else {
        // No good fallback — flag for AI repair
        t._validationError = "items[] contains placeholder text like 'Concept 1' — must use real vocabulary terms from the subject matter";
      }
    }
  }

  // ── BODY_BREAK / MOTION_MISSION: force movement flag ──
  if (type === TASK_TYPES.BODY_BREAK || type === TASK_TYPES.MOTION_MISSION) {
    t.movement = true;
    if (t.config && typeof t.config === "object") t.config.movement = true;
  }

  // ── SPEECH_RECOGNITION / PRONUNCIATION: promote config.referenceText to root ──
  if (type === TASK_TYPES.SPEECH_RECOGNITION || type === TASK_TYPES.PRONUNCIATION) {
    if (!t.referenceText && t.config?.referenceText) {
      t.referenceText = t.config.referenceText;
    }
    if (!t.referenceText && Array.isArray(t.config?.phrases) && t.config.phrases.length > 0) {
      t.referenceText = t.config.phrases
        .map((p) => (typeof p === "string" ? p : p?.target || p?.text || ""))
        .filter(Boolean)
        .join(". ");
    }
  }

  // ── ROLE_PLAY_DECK: auto-fill empty goal/constraint from role description ──
  if (type === TASK_TYPES.ROLE_PLAY_DECK) {
    const roles = Array.isArray(t.config?.roles) ? t.config.roles : [];
    if (roles.length > 0) {
      t.config.roles = roles.map((r) => {
        if (!r || typeof r !== "object") return r;
        const role = { ...r };
        const desc = String(role.role || role.description || "").trim();
        const chars = Array.isArray(role.characteristics) ? role.characteristics : [];

        if (!String(role.goal || "").trim()) {
          // Synthesize goal from description or first characteristic
          if (desc) {
            role.goal = desc;
          } else if (chars.length > 0) {
            role.goal = String(chars[0] || "").trim();
          }
        }
        if (!String(role.constraint || "").trim()) {
          // Synthesize constraint from last characteristic or a generic one
          if (chars.length >= 2) {
            role.constraint = String(chars[chars.length - 1] || "").trim();
          } else if (desc) {
            role.constraint = "Must stay in character and support the group discussion";
          }
        }
        return role;
      });
      console.log(`[sanitize] Auto-filled ROLE_PLAY_DECK goal/constraint from role data`);
    }
  }

  // ── ART_VIEW: ensure config defaults ──
  if (type === TASK_TYPES.ART_VIEW) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    if (!cfg.viewingSeconds || typeof cfg.viewingSeconds !== "number") cfg.viewingSeconds = 60;
    if (!cfg.responseSeconds || typeof cfg.responseSeconds !== "number") cfg.responseSeconds = 120;
    if (!cfg.minObservations || typeof cfg.minObservations !== "number") cfg.minObservations = 5;
    // Clamp to valid ranges
    cfg.viewingSeconds = Math.max(10, Math.min(300, cfg.viewingSeconds));
    cfg.responseSeconds = Math.max(30, Math.min(600, cfg.responseSeconds));
    cfg.minObservations = Math.max(1, Math.min(20, cfg.minObservations));
    t.config = cfg;
  }

  // ── HISTORICAL_DOC: ensure config defaults ──
  if (type === TASK_TYPES.HISTORICAL_DOC) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    if (!cfg.viewingSeconds || typeof cfg.viewingSeconds !== "number") cfg.viewingSeconds = 90;
    if (!cfg.responseSeconds || typeof cfg.responseSeconds !== "number") cfg.responseSeconds = 150;
    if (!Array.isArray(cfg.analysisPrompts) || cfg.analysisPrompts.length === 0) {
      cfg.analysisPrompts = [
        "What is the main purpose or message of this document?",
        "Who was the intended audience?",
        "What was the historical significance of this document at the time?",
      ];
    }
    // Clamp to valid ranges
    cfg.viewingSeconds = Math.max(10, Math.min(300, cfg.viewingSeconds));
    cfg.responseSeconds = Math.max(30, Math.min(600, cfg.responseSeconds));
    t.config = cfg;
  }

  // ── Flashcards Race: auto-deduplicate answers ──
  if (type === TASK_TYPES.FLASHCARDS_RACE) {
    const items = Array.isArray(t.items) ? t.items
      : Array.isArray(t.config?.items) ? t.config.items : null;
    if (items && items.length > 0) {
      const seen = new Set();
      const deduped = [];
      for (const it of items) {
        const key = String(it?.answer || "").trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(it);
      }
      if (deduped.length < items.length) {
        if (Array.isArray(t.items)) t.items = deduped;
        else if (t.config) t.config.items = deduped;
      }
    }
  }

  // ── Brain Blitz: auto-fix clue/answer swaps, strip Jeopardy prefix, dedup, drop bad clues ──
  if (type === TASK_TYPES.JEOPARDY) {
    const clues = Array.isArray(t.clues) ? t.clues
      : Array.isArray(t.config?.clues) ? t.config.clues : null;

    if (clues) {
      const fixed = [];
      const seenAnswers = new Set();

      for (const c of clues) {
        if (typeof c === "string") { fixed.push(c); continue; }
        if (!c || typeof c !== "object") continue;

        let clueText = String(c.clue || c.prompt || "").trim();
        let answer = String(c.answer || c.correctAnswer || c.solution || "").trim();

        // Swap if the answer looks like a sentence and the clue looks like a short word
        if (answer.length > 40 && clueText.length <= 40 && clueText.split(/\s+/).length <= 5) {
          [clueText, answer] = [answer, clueText];
        }

        // Truncate answer to first meaningful chunk if it contains a question
        if (answer.includes("?") || answer.includes(".")) {
          const firstWord = answer.split(/[?.!,;:]/)[0].trim();
          if (firstWord.length >= 2 && firstWord.length <= 40) {
            answer = firstWord;
          }
        }

        // Drop clues where answer is still too long (>60 chars) — unsalvageable
        if (answer.length > 60) continue;

        // Dedup: skip clues with duplicate answers (case-insensitive)
        const answerKey = answer.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seenAnswers.has(answerKey)) continue;
        seenAnswers.add(answerKey);

        fixed.push({ clue: clueText, answer });
      }
      t.clues = fixed;
    }
  }

  // ── PEER EDITING ──
  if (type === TASK_TYPES.PEER_EDITING) {
    // Promote config fields to top level if AI nested them
    const cfg = t.config && typeof t.config === "object" ? t.config : null;
    if (!t.passage && cfg?.passage) { t.passage = cfg.passage; delete cfg.passage; }
    if (!t.errors && cfg?.errors) { t.errors = cfg.errors; delete cfg.errors; }
    if (!t.mode && cfg?.mode) { t.mode = cfg.mode; delete cfg.mode; }

    // Normalize errors array
    if (Array.isArray(t.errors)) {
      t.errors = t.errors
        .filter((e) => e && typeof e === "object")
        .map((e) => ({
          wordIndex: typeof e.wordIndex === "number" ? e.wordIndex : parseInt(e.wordIndex, 10) || 0,
          type: ["typo", "grammar", "logic", "punctuation", "delete", "insert"].includes(e.type) ? e.type : "typo",
          correct: e.correct || e.replacement || e.fix || null,
          _originalWord: e.word || e.original || e.originalWord || null,
        }));
    }

    // ── AUTO-REPAIR word indices ──
    // LLMs frequently miscounted 0-based indices. If the error references a word in the passage
    // that doesn't look like the error (e.g., index 4 should be "proccess" but the word at 4 is "by"),
    // try to find the actual word nearby by fuzzy matching the error's correct replacement or _originalWord.
    if (typeof t.passage === "string" && Array.isArray(t.errors) && t.errors.length > 0) {
      const words = t.passage.split(/\s+/);
      const strip = (w) => (w || "").replace(/[.,;:!?"'()[\]{}]/g, "").toLowerCase();

      for (const err of t.errors) {
        const atIdx = strip(words[err.wordIndex] || "");
        const correctStripped = strip(err.correct);
        const originalStripped = strip(err._originalWord);

        // If the word at the claimed index is ALREADY the correct word, or is missing,
        // the index is probably wrong — search for a word that looks like the error.
        const looksCorrectAlready = atIdx === correctStripped;
        const indexOutOfRange = err.wordIndex < 0 || err.wordIndex >= words.length;

        if (looksCorrectAlready || indexOutOfRange) {
          // Try to find the erroneous word by looking for a word that is NOT the correct one
          // but is close (off-by-one or small edit distance). Search near the claimed index first.
          let found = false;

          // If the AI provided the original (erroneous) word, look for it directly
          if (originalStripped) {
            for (let i = 0; i < words.length; i++) {
              if (strip(words[i]) === originalStripped) {
                err.wordIndex = i;
                found = true;
                break;
              }
            }
          }

          // If no _originalWord, try finding a word that's similar to the correct word but misspelled
          if (!found && correctStripped) {
            // Look for near-matches: words within edit distance 1-3 of the correct word
            let bestIdx = -1;
            let bestDist = 999;
            for (let i = 0; i < words.length; i++) {
              const w = strip(words[i]);
              if (w === correctStripped) continue; // skip exact matches (already correct)
              if (w.length === 0) continue;
              // Simple heuristic: if the word starts with the same 2+ chars and is similar length
              const lenDiff = Math.abs(w.length - correctStripped.length);
              const commonPrefix = _commonPrefixLen(w, correctStripped);
              if (commonPrefix >= 2 && lenDiff <= 3) {
                const d = _editDistance(w, correctStripped);
                if (d <= 3 && d < bestDist) {
                  bestDist = d;
                  bestIdx = i;
                }
              }
            }
            if (bestIdx >= 0) {
              err.wordIndex = bestIdx;
              found = true;
            }
          }
        }

        // Clean up helper field
        delete err._originalWord;
      }

      // Deduplicate: if two errors point to the same wordIndex, keep only the first
      const seen = new Set();
      t.errors = t.errors.filter((e) => {
        if (seen.has(e.wordIndex)) return false;
        seen.add(e.wordIndex);
        return true;
      });
    }

    // Default mode
    if (!["on-screen", "paper", "timed"].includes(t.mode)) t.mode = "on-screen";

    // Strip empty config
    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  // ── INTERVIEW ──
  if (type === TASK_TYPES.INTERVIEW) {
    const cfg = t.config && typeof t.config === "object" ? t.config : null;

    // Promote config.candidates to top level if AI nested them
    if (!Array.isArray(t.candidates) && Array.isArray(cfg?.candidates)) {
      t.candidates = cfg.candidates;
      delete cfg.candidates;
    }

    // Promote config.minTurns / maxTurns
    if (typeof t.minTurns === "undefined" && cfg?.minTurns) { t.minTurns = cfg.minTurns; delete cfg.minTurns; }
    if (typeof t.maxTurns === "undefined" && cfg?.maxTurns) { t.maxTurns = cfg.maxTurns; delete cfg.maxTurns; }

    // Normalize candidates array
    if (Array.isArray(t.candidates)) {
      t.candidates = t.candidates
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          name: String(c.name || c.characterName || "").trim(),
          era: String(c.era || c.timePeriod || "").trim(),
          description: String(c.description || c.bio || c.desc || "").trim(),
          greeting: String(c.greeting || c.intro || c.openingLine || "").trim(),
          systemPrompt: String(c.systemPrompt || c.system || c.persona || "").trim(),
        }));
    }

    // Ensure numeric turn bounds
    t.minTurns = typeof t.minTurns === "number" ? t.minTurns : parseInt(t.minTurns, 10) || 3;
    t.maxTurns = typeof t.maxTurns === "number" ? t.maxTurns : parseInt(t.maxTurns, 10) || 5;
    if (t.minTurns < 2) t.minTurns = 2;
    if (t.maxTurns < t.minTurns) t.maxTurns = t.minTurns + 2;

    // Strip empty config
    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  // ── CLOZE ──
  if (type === TASK_TYPES.CLOZE) {
    const cfg = t.config && typeof t.config === "object" ? t.config : null;

    // Promote config fields to top level if AI nested them
    if (!t.passage && cfg?.passage) { t.passage = cfg.passage; delete cfg.passage; }
    if (!Array.isArray(t.blanks) && Array.isArray(cfg?.blanks)) { t.blanks = cfg.blanks; delete cfg.blanks; }
    if (!Array.isArray(t.distractors) && Array.isArray(cfg?.distractors)) { t.distractors = cfg.distractors; delete cfg.distractors; }

    // Also accept "text" as passage alias
    if (!t.passage && t.text) { t.passage = t.text; delete t.text; }

    // Normalize blanks array — accept various AI output shapes
    if (Array.isArray(t.blanks)) {
      t.blanks = t.blanks
        .filter((b) => b != null)
        .map((b) => {
          if (typeof b === "string") return { answer: b.trim() };
          if (typeof b === "object") return { answer: String(b.answer || b.word || b.text || "").trim() };
          return { answer: String(b).trim() };
        })
        .filter((b) => b.answer.length > 0);
    }

    // Normalize distractors — can be strings or objects
    if (Array.isArray(t.distractors)) {
      t.distractors = t.distractors
        .map((d) => typeof d === "string" ? d.trim() : String(d?.word || d?.text || d || "").trim())
        .filter(Boolean);
    } else {
      t.distractors = [];
    }

    // Strip empty config
    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  // ── TEACH-BACK ──
  if (type === TASK_TYPES.TEACH_BACK) {
    const cfg = t.config && typeof t.config === "object" ? t.config : null;

    // Promote config fields to top level
    if (!Array.isArray(t.concepts) && Array.isArray(cfg?.concepts)) { t.concepts = cfg.concepts; delete cfg.concepts; }
    if (!t.targetAge && cfg?.targetAge) { t.targetAge = cfg.targetAge; delete cfg.targetAge; }
    if (!t.rubric && cfg?.rubric) { t.rubric = cfg.rubric; delete cfg.rubric; }

    // Also accept target_age, targetAudience as aliases
    if (!t.targetAge && t.target_age) { t.targetAge = t.target_age; delete t.target_age; }
    if (!t.targetAge && t.targetAudience) { t.targetAge = t.targetAudience; delete t.targetAudience; }

    // Normalize concepts — must be array of strings
    if (Array.isArray(t.concepts)) {
      t.concepts = t.concepts
        .map((c) => {
          if (typeof c === "string") return c.trim();
          if (typeof c === "object" && c) return String(c.name || c.concept || c.label || c.text || "").trim();
          return String(c || "").trim();
        })
        .filter(Boolean);
    }

    // Ensure targetAge is a string
    if (t.targetAge && typeof t.targetAge !== "string") {
      t.targetAge = String(t.targetAge);
    }

    if (cfg) {
      const keys = Object.keys(cfg).filter((k) => cfg[k] !== undefined);
      if (keys.length === 0) delete t.config;
      else t.config = cfg;
    }
  }

  return t;
}

export default sanitizeTaskShapeByType;
