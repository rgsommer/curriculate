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

  // ── BONUS UNLOCK (all types): bonus tasks should open at 50% core progress, not 100% ──
  // A coreProgressPct of 100 means early-finishers never see the bonus until the
  // whole core is done — too late. Downgrade the legacy 100 default to 50.
  if (t.isBonus === true && t.unlockConditions && typeof t.unlockConditions === "object"
      && t.unlockConditions.coreProgressPct === 100) {
    t.unlockConditions = { ...t.unlockConditions, coreProgressPct: 50 };
    console.log(`[sanitize] bonus task unlock downgraded from coreProgressPct:100 → 50 (was opening too late)`);
  }

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
    // Nit: when BOTH config.correctOrder and top-level correctOrder exist, drop
    // the top-level copy (config is canonical). Warn if the two disagree.
    if (Array.isArray(t.config?.correctOrder) && Array.isArray(t.correctOrder)) {
      const a = t.config.correctOrder.map((v) => parseInt(v, 10));
      const b = t.correctOrder.map((v) => parseInt(v, 10));
      const disagree = a.length !== b.length || a.some((v, i) => v !== b[i]);
      if (disagree) {
        console.log(`[sanitize] MAD_DASH_SEQUENCE has conflicting correctOrder (config vs top-level) — keeping config copy: config=[${a}] top=[${b}]`);
      }
      delete t.correctOrder;
    }

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

  // ── TRUE_FALSE_CONNECT_FOUR: keep statements[] and items[] canonical keys in sync ──
  // The validator/normalizer accepts statements OR items; if the AI populated only
  // one of them at the top level, mirror it to the other so normalize never loses data.
  if (type === TASK_TYPES.TRUE_FALSE_CONNECT_FOUR) {
    const hasStatements = Array.isArray(t.statements) && t.statements.length > 0;
    const hasItems = Array.isArray(t.items) && t.items.length > 0;
    if (hasStatements && !hasItems) {
      t.items = t.statements;
    } else if (hasItems && !hasStatements) {
      t.statements = t.items;
    }
  }

  // ── NARRATION_SYNTHESIZE: clamp playerCount DOWN to prompts.length (never idle players) ──
  if (type === TASK_TYPES.NARRATION_SYNTHESIZE) {
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    const promptsRaw =
      (Array.isArray(cfg.prompts) && cfg.prompts) ||
      (Array.isArray(t.prompts) && t.prompts) ||
      (Array.isArray(cfg.items) && cfg.items) ||
      (Array.isArray(t.items) && t.items) ||
      [];

    // Normalize each prompt to {id, concept, prompt} object — the renderer
    // requires these keys. When the AI shipped a bare string, derive a
    // short concept noun from the prompt text rather than emitting
    // "Concept N" (which trips the placeholder-text guardrail).
    const _deriveConcept = (text, idx) => {
      const s = String(text || "").trim();
      // Try "Explain X.…" → X. Falls back to the first noun-ish chunk.
      const explainMatch = s.match(/(?:explain|describe|teach|talk about|tell us about)\s+([^.,;\n]{3,40})/i);
      if (explainMatch) {
        return explainMatch[1].trim().replace(/^(the|a|an)\s+/i, "").slice(0, 60);
      }
      const firstSentence = s.split(/[.,;\n]/)[0] || "";
      const words = firstSentence.split(/\s+/).slice(0, 4).join(" ");
      return words ? words.slice(0, 60) : `Topic ${idx + 1}`;
    };
    const normalized = promptsRaw
      .map((p, i) => {
        if (typeof p === "string") {
          const txt = p.trim();
          if (!txt) return null;
          return { id: `p${i + 1}`, concept: _deriveConcept(txt, i), prompt: txt };
        }
        if (p && typeof p === "object") {
          const promptTxt = String(p.prompt || p.text || "").trim().slice(0, 420);
          if (!promptTxt) return null;
          // If concept is missing or a generic placeholder, derive one.
          let concept = String(p.concept || p.title || "").trim().slice(0, 80);
          if (!concept || /^concept\s*\d+$/i.test(concept) || /^topic\s*\d+$/i.test(concept) || /^item\s*\d+$/i.test(concept)) {
            concept = _deriveConcept(promptTxt, i);
          }
          return { id: String(p.id || `p${i + 1}`), concept, prompt: promptTxt };
        }
        return null;
      })
      .filter(Boolean);

    if (normalized.length > 0) cfg.prompts = normalized;

    // Clamp playerCount to match prompts.length.
    const pc = Number(cfg.playerCount);
    if (normalized.length >= 1 && Number.isFinite(pc) && pc > normalized.length) {
      cfg.playerCount = Math.max(1, normalized.length);
      console.log(`[sanitize] NARRATION_SYNTHESIZE clamped playerCount ${pc} → ${cfg.playerCount} to match prompts.length`);
    } else if (normalized.length >= 1 && !Number.isFinite(pc)) {
      cfg.playerCount = Math.max(2, Math.min(6, normalized.length));
    }

    // Drop fields the renderer ignores — they only confuse AI fix attempts.
    for (const k of ["sourceBullets", "sourcePassage", "passages", "sources"]) {
      if (cfg[k] !== undefined) delete cfg[k];
      if (t[k] !== undefined) delete t[k];
    }
    t.config = cfg;
  }

  // ── PHOTO / MAKE_AND_SNAP: bump time for complex drawing/build prompts ──
  if (type === TASK_TYPES.PHOTO || type === TASK_TYPES.MAKE_AND_SNAP || type === TASK_TYPES.PHOTO_JOURNAL) {
    const prompt = String(t.prompt || "");
    const isComplex = prompt.length > 200 || /drawing|model|build|construct|create|design/i.test(prompt);
    if (isComplex) {
      const current = Number(t.timeLimitSeconds) || 0;
      if (current < 240) {
        t.timeLimitSeconds = 240;
        console.log(`[sanitize] ${type} complex prompt — bumped timeLimitSeconds ${current || "(unset)"} → 240`);
      }
    }
  }

  // ── ECHO_CHAIN: title-case known proper-noun seed phrases ──
  if (type === TASK_TYPES.ECHO_CHAIN) {
    const cfg = t.config && typeof t.config === "object" ? t.config : null;
    const seed = cfg && typeof cfg.seedTerm === "string" ? cfg.seedTerm : null;
    if (seed && /holy spirit|jesus christ|old testament|new testament/i.test(seed)) {
      const titled = seed.replace(/\b\w/g, (c) => c.toUpperCase());
      if (titled !== seed) {
        cfg.seedTerm = titled;
        console.log(`[sanitize] ECHO_CHAIN title-cased proper-noun seedTerm "${seed}" → "${titled}"`);
      }
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
    // Renderer reads { name, role, characteristics[], gender }. Normalize
    // around those fields. Backfill role from goal/constraint if a legacy
    // generation still ships them; backfill characteristics from
    // adjective-ish goal text; default gender to "nonbinary" when missing.
    const cfg = t.config && typeof t.config === "object" ? t.config : {};
    const roles = Array.isArray(cfg.roles) ? cfg.roles : [];
    if (roles.length > 0) {
      cfg.roles = roles.map((r) => {
        if (!r || typeof r !== "object") return r;
        const role = { ...r };
        // role field — fall back to legacy goal/description.
        if (!String(role.role || "").trim()) {
          role.role = String(role.goal || role.description || role.job || "").trim();
        }
        // characteristics: ensure an array of short adjective strings.
        let chars = Array.isArray(role.characteristics)
          ? role.characteristics
          : (typeof role.characteristics === "string"
              ? role.characteristics.split(",")
              : []);
        chars = chars
          .map((c) => String(c || "").trim())
          .filter(Boolean)
          .map((c) => c.slice(0, 40));
        // Backfill from goal/constraint if we still have nothing.
        if (chars.length === 0) {
          const legacy = [role.goal, role.constraint].map((s) => String(s || "").trim()).filter(Boolean);
          if (legacy.length > 0) chars = legacy.slice(0, 3);
        }
        // Clamp to 3-5 traits where possible.
        role.characteristics = chars.slice(0, 5);
        // gender — renderer uses for avatar; pick "nonbinary" as a safe
        // default so the avatar picker never crashes.
        if (!String(role.gender || role.sex || "").trim()) {
          role.gender = "nonbinary";
        }
        // Drop legacy fields the renderer ignores so they don't trip
        // the placeholder-text scanner.
        delete role.goal;
        delete role.constraint;
        return role;
      });
    }
    t.config = cfg;
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

      // Final-state guard: drop errors whose wordIndex now points at the
      // CORRECT word (which would make them un-findable for the student).
      // These are leftovers from auto-repair failures — better to drop and
      // let the validator reject for "too few errors" than ship a task
      // where students can't actually find the marked errors.
      const passageWords = t.passage.split(/\s+/);
      const _strip = (w) => String(w || "").replace(/[.,;:!?"'()[\]{}]/g, "").toLowerCase();
      t.errors = t.errors.filter((e) => {
        if (e.wordIndex < 0 || e.wordIndex >= passageWords.length) return false;
        const atIdx = _strip(passageWords[e.wordIndex]);
        const correct = _strip(e.correct);
        // If the word at the index is already the correct one, this error
        // points at nothing the student can find — drop it.
        if (atIdx && correct && atIdx === correct) return false;
        return true;
      });

      // If too many errors got dropped, signal regeneration.
      if (t.errors.length < 3) {
        t._validationError = `peer-editing wordIndex auto-repair couldn't recover ≥ 3 valid errors — AI must emit the EXACT erroneous word in the "word" field for every error so the index can be verified`;
      }
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

  // ── WHAT_AM_I: promote top-level deduction fields into config ──
  // AI sometimes emits answer/clues/etc at the top level. Canonical home: task.config.
  if (type === TASK_TYPES.WHAT_AM_I) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    // Promote answer
    if (!cfg.answer && typeof t.answer === "string") {
      cfg.answer = t.answer;
      delete t.answer;
    }

    // Promote acceptableAnswers — accept array OR comma-separated string OR alt keys
    let accepted = cfg.acceptableAnswers ?? t.acceptableAnswers ?? cfg.alternateAnswers ?? t.alternateAnswers ?? null;
    if (typeof accepted === "string") {
      accepted = accepted.split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(accepted)) {
      cfg.acceptableAnswers = accepted
        .map((x) => (typeof x === "string" ? x.trim().toLowerCase() : ""))
        .filter(Boolean);
    }
    delete t.acceptableAnswers;
    if ("alternateAnswers" in cfg) delete cfg.alternateAnswers;

    // Promote clues. Accept array of {level,text} OR array of strings OR top-level array.
    let clues = cfg.clues ?? t.clues ?? null;
    if (Array.isArray(clues)) {
      clues = clues
        .map((c, i) => {
          if (typeof c === "string") return { level: i + 1, text: c.trim() };
          if (c && typeof c === "object") {
            const text = typeof c.text === "string" ? c.text.trim() : typeof c.clue === "string" ? c.clue.trim() : "";
            const level = Number.isFinite(Number(c.level)) ? Number(c.level) : i + 1;
            return text ? { level, text } : null;
          }
          return null;
        })
        .filter(Boolean)
        // Re-index levels in monotonic order in case AI emitted out-of-order or duplicate levels
        .map((c, i) => ({ level: i + 1, text: c.text }));
      cfg.clues = clues;
    }
    delete t.clues;

    // Promote difficulty + mode + scoring
    if (!cfg.difficulty && typeof t.difficulty === "string") cfg.difficulty = t.difficulty;
    delete t.difficulty;
    if (!cfg.mode && typeof t.mode === "string") cfg.mode = t.mode;
    delete t.mode;

    // Normalize difficulty enum
    if (typeof cfg.difficulty === "string") {
      const d = cfg.difficulty.trim().toLowerCase();
      cfg.difficulty = ["easy", "medium", "hard", "expert"].includes(d) ? d : "medium";
    } else {
      cfg.difficulty = "medium";
    }

    // Normalize mode enum
    if (typeof cfg.mode === "string") {
      const m = cfg.mode.trim().toLowerCase().replace(/\s+/g, "-");
      cfg.mode = ["solo", "intra-team", "inter-team"].includes(m) ? m : "intra-team";
    } else {
      cfg.mode = "intra-team";
    }

    // Strip any leaked scoring shape coercion
    if (cfg.scoring && typeof cfg.scoring === "object" && !Array.isArray(cfg.scoring)) {
      // Validate perClueCurve if present
      const curve = cfg.scoring.perClueCurve;
      if (Array.isArray(curve)) {
        cfg.scoring.perClueCurve = curve.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0);
        if (cfg.scoring.perClueCurve.length === 0) delete cfg.scoring.perClueCurve;
      }
    }

    t.config = cfg;
  }

  // ── OPEN_TEXT: un-nest prompt:{text,settings}, hoist root-level
  //    settings into config, reject placeholder prompts so the AI is
  //    forced to ship topic-specific content. ──
  if (type === TASK_TYPES.OPEN_TEXT) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    // Un-nest task.prompt = { text, settings } → root prompt(string) + config.
    if (_isObj(t.prompt)) {
      const nested = t.prompt;
      if (typeof nested.text === "string" && nested.text.trim()) {
        t.prompt = nested.text.trim();
      }
      if (_isObj(nested.settings)) {
        for (const k of ["gradeLevel", "difficulty", "minWords", "kind", "words"]) {
          if (cfg[k] === undefined && nested.settings[k] !== undefined) {
            cfg[k] = nested.settings[k];
          }
        }
      }
    }
    // Hoist root-level gradeLevel/difficulty/minWords into config.
    for (const k of ["gradeLevel", "difficulty", "minWords", "kind", "words"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }
    // Normalize difficulty to upper-case canonical form.
    if (typeof cfg.difficulty === "string") {
      const d = cfg.difficulty.trim().toUpperCase();
      cfg.difficulty = ["EASY", "MEDIUM", "HARD"].includes(d) ? d : "MEDIUM";
    }
    // gradeLevel must be numeric.
    if (cfg.gradeLevel != null) {
      const n = Number(cfg.gradeLevel);
      cfg.gradeLevel = Number.isFinite(n) ? Math.max(1, Math.min(12, Math.round(n))) : undefined;
    }
    // minWords clamp.
    if (cfg.minWords != null) {
      const n = Number(cfg.minWords);
      cfg.minWords = Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
    }

    // Reject placeholder prompts — the AI used to ship "Complete the
    // task." here. The validator's _validationError throws regenerate the
    // task with a clear reason.
    const PROMPT_BLOCKLIST = [
      /^\s*complete the task[.!]?\s*$/i,
      /^\s*write your response[.!]?\s*$/i,
      /^\s*answer the question( below)?[.!]?\s*$/i,
      /^\s*respond to the prompt[.!]?\s*$/i,
      /^\s*share your thoughts[.!]?\s*$/i,
    ];
    const p = typeof t.prompt === "string" ? t.prompt.trim() : "";
    if (!p) {
      t._validationError = "open-text: prompt is required (the prompt IS the task — must be a real topic-specific writing instruction)";
    } else if (PROMPT_BLOCKLIST.some((re) => re.test(p))) {
      t._validationError = `open-text: prompt "${p}" is a placeholder. The prompt MUST name the unit topic and pose a real writing question.`;
    } else if (p.split(/\s+/).length < 12) {
      t._validationError = `open-text: prompt too short (${p.split(/\s+/).length} words, need ≥ 12) — write the actual topic-specific writing question.`;
    }

    t.config = cfg;
  }

  // ── SPEED_DRAW: collapse to a single config.word ──
  // The renderer reads `task.word || task.config.word || task.config.prompt`.
  // The AI used to emit items[] / prompts[] arrays because the old aiPrompt
  // said "Create 6-10 prompts"; this sanitizer un-wraps that shape so older
  // generations don't ship a blank canvas.
  if (type === TASK_TYPES.SPEED_DRAW) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    // Promote a root-level "word" to config.word.
    if (!cfg.word && typeof t.word === "string" && t.word.trim()) {
      cfg.word = t.word.trim();
    }
    delete t.word;

    // If the AI shipped items[] / prompts[], pluck the first usable string
    // and use it as config.word. The rest are dropped — Speed Draw is ONE word.
    if (!cfg.word) {
      const candidates = [];
      if (Array.isArray(t.items)) candidates.push(...t.items);
      if (Array.isArray(cfg.items)) candidates.push(...cfg.items);
      if (Array.isArray(t.prompts)) candidates.push(...t.prompts);
      if (Array.isArray(cfg.prompts)) candidates.push(...cfg.prompts);
      for (const c of candidates) {
        const w = typeof c === "string" ? c : (c?.word || c?.text || c?.prompt || "");
        if (typeof w === "string" && w.trim()) { cfg.word = w.trim(); break; }
      }
    }
    delete t.items;
    delete cfg.items;
    delete t.prompts;
    delete cfg.prompts;

    // Defaults / clamps.
    if (cfg.timeLimitSeconds == null) cfg.timeLimitSeconds = 60;
    else {
      const n = Number(cfg.timeLimitSeconds);
      cfg.timeLimitSeconds = Number.isFinite(n) ? Math.max(30, Math.min(120, Math.round(n))) : 60;
    }
    if (typeof cfg.difficulty === "string") {
      const d = cfg.difficulty.trim().toUpperCase();
      cfg.difficulty = ["EASY", "MEDIUM", "HARD"].includes(d) ? d : "MEDIUM";
    } else {
      cfg.difficulty = "MEDIUM";
    }
    // Trim long word fields (renderer puts them on a small badge).
    if (typeof cfg.word === "string" && cfg.word.length > 60) {
      cfg.word = cfg.word.slice(0, 60).trim();
    }
    t.config = cfg;
  }

  // ── CAREERS: promote top-level mode/career/candidates/etc into config ──
  if (type === TASK_TYPES.CAREERS) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};
    // NOTE: "title" is intentionally NOT in this list. The validator
    // requires task.title at the root; promoting it into config and
    // deleting it from the root used to make the AI-emitted title
    // disappear, which then failed validation as "title required".
    for (const k of ["mode", "career", "teammates", "pathways", "candidates", "optionA", "optionB", "questions", "prompts", "role", "targetCareer"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }
    // If the AI nested title under config (legitimate but wrong shape),
    // hoist it BACK to the root rather than dropping it.
    if (!t.title && typeof cfg.title === "string" && cfg.title.trim()) {
      t.title = cfg.title;
      delete cfg.title;
    }
    // Normalize mode enum (case-insensitive, dashes/underscores allowed)
    if (typeof cfg.mode === "string") {
      const m = cfg.mode.trim().toLowerCase().replace(/[_\s]+/g, "-");
      const allowed = ["best-fit", "pathway-builder", "aptitude-match", "salary-vs-lifestyle", "who-should-be-hired", "career-myths"];
      cfg.mode = allowed.includes(m) ? m : "best-fit";
    } else {
      cfg.mode = "best-fit";
    }
    // Ensure career-myths questions[].id are present (renderer uses them as React keys)
    if (cfg.mode === "career-myths" && Array.isArray(cfg.questions)) {
      cfg.questions = cfg.questions.map((q, i) => ({ id: q?.id || `q-${i}`, ...q }));
    }
    if (cfg.mode === "aptitude-match" && Array.isArray(cfg.prompts)) {
      cfg.prompts = cfg.prompts.map((p, i) => ({ id: p?.id || `p-${i}`, ...p }));
    }
    t.config = cfg;
  }

  // ── CURRENT_EVENTS: ensure the shell carries only the resolver inputs ──
  if (type === TASK_TYPES.CURRENT_EVENTS) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};
    for (const k of ["lessonTopic", "subject", "gradeLevel", "region", "worldviewProfile", "preferredCategories"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }
    // Normalize worldview enum
    if (typeof cfg.worldviewProfile === "string") {
      const w = cfg.worldviewProfile.trim().toLowerCase();
      const allowed = ["general", "secular", "christian", "jewish", "muslim", "multifaith"];
      cfg.worldviewProfile = allowed.includes(w) ? w : "general";
    }
    // preferredCategories: accept string or array
    if (typeof cfg.preferredCategories === "string") {
      cfg.preferredCategories = cfg.preferredCategories.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
    }
    // The `resolved` block is filled in at runtime by the resolver — strip any stale value from AI output
    if ("resolved" in cfg) delete cfg.resolved;
    if ("loading" in cfg) delete cfg.loading;
    // Set a default placeholder prompt so the runner shows "Loading…" before resolution
    if (!t.prompt || t.prompt.trim().length < 4) t.prompt = "Loading today's connection to the lesson…";
    t.config = cfg;
  }

  // ── HOLE_IN_ONE: promote board / physics / questionBank / economy into config ──
  if (type === TASK_TYPES.HOLE_IN_ONE) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};
    for (const k of ["board", "physics", "questionBank", "economy", "tilter", "scoring", "controls", "teamMembers", "resources"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }
    // Coerce board defaults — missing critical fields would crash the renderer
    if (!_isObj(cfg.board)) cfg.board = {};
    if (!Number.isFinite(Number(cfg.board.width)))     cfg.board.width = 12;
    if (!Number.isFinite(Number(cfg.board.height)))    cfg.board.height = 18;
    if (!Number.isFinite(Number(cfg.board.gridSize)))  cfg.board.gridSize = 24;
    if (!_isObj(cfg.board.startPosition)) cfg.board.startPosition = { x: 1, y: 1 };
    if (!_isObj(cfg.board.holePosition))  cfg.board.holePosition  = { x: cfg.board.width - 2, y: cfg.board.height - 2, radius: 0.8 };
    if (!Array.isArray(cfg.board.obstacles)) cfg.board.obstacles = [];
    // questionBank items need ids
    if (Array.isArray(cfg.questionBank)) {
      cfg.questionBank = cfg.questionBank
        .filter((q) => q && typeof q === "object" && q.prompt)
        .map((q, i) => ({ id: q.id || `q-${i + 1}`, ...q }));
    }
    t.config = cfg;
  }

  // ── LEGENDS: promote figure + facts; normalize category enum; assign ids ──
  if (type === TASK_TYPES.LEGENDS) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};
    for (const k of ["figure", "facts"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }
    // figure: trim strings + accept portraitUrl variants
    if (_isObj(cfg.figure)) {
      const f = { ...cfg.figure };
      if (typeof f.name === "string") f.name = f.name.trim();
      if (typeof f.era === "string") f.era = f.era.trim();
      if (typeof f.summary === "string") f.summary = f.summary.trim();
      // portraitUrl variants
      if (!f.portraitUrl && typeof f.imageUrl === "string") f.portraitUrl = f.imageUrl;
      if (!f.portraitUrl && typeof f.image === "string") f.portraitUrl = f.image;
      cfg.figure = f;
    }
    // facts: normalize category enum, assign ids, drop empties
    if (Array.isArray(cfg.facts)) {
      const allowed = ["what", "where", "why", "when", "decoy"];
      cfg.facts = cfg.facts
        .map((f, i) => {
          if (!f || typeof f !== "object") return null;
          const text = typeof f.text === "string" ? f.text.trim() : "";
          if (!text) return null;
          const cat = String(f.category || "").trim().toLowerCase();
          return {
            id: typeof f.id === "string" && f.id.trim() ? f.id : `f-${i + 1}`,
            text,
            category: allowed.includes(cat) ? cat : "decoy",
          };
        })
        .filter(Boolean);
    }
    t.config = cfg;
  }

  // ── TRUTH_OR_DARE: promote top-level config + normalize seed challenges ──
  if (type === TASK_TYPES.TRUTH_OR_DARE) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    // Promote top-level fields that should live under config
    for (const k of [
      "subject", "unitName", "gradeLevel",
      "physicalIntensityMax", "socialIntensityMax",
      "movementAllowed", "noiseAllowed",
      "totalRounds", "tierProgression", "judgmentMode", "safeClassroomMode",
      "seedChallenges", "worldview",
    ]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }

    // Infer worldview from subject when unset — a faith subject should not default
    // to "general" (which steers the runtime generator secular/neutral).
    if (!cfg.worldview || typeof cfg.worldview !== "string" || !cfg.worldview.trim()) {
      const subj = String(cfg.subject || "");
      if (/bible|religion|faith|theology|scripture/i.test(subj)) {
        cfg.worldview = "faith";
        console.log(`[sanitize] TRUTH_OR_DARE inferred worldview="faith" from subject "${subj}"`);
      } else if (/secular|atheist|humanist/i.test(subj)) {
        cfg.worldview = "secular";
        console.log(`[sanitize] TRUTH_OR_DARE inferred worldview="secular" from subject "${subj}"`);
      }
    }

    // Defaults
    if (cfg.physicalIntensityMax == null) cfg.physicalIntensityMax = 2;
    if (cfg.socialIntensityMax == null) cfg.socialIntensityMax = 2;
    if (cfg.movementAllowed == null) cfg.movementAllowed = true;
    if (cfg.noiseAllowed == null) cfg.noiseAllowed = true;
    if (cfg.totalRounds == null) cfg.totalRounds = 6;
    if (cfg.tierProgression == null) cfg.tierProgression = "linear";
    if (cfg.judgmentMode == null) cfg.judgmentMode = "mixed";
    if (cfg.safeClassroomMode == null) cfg.safeClassroomMode = false;

    // Coerce numerics
    if (cfg.gradeLevel != null) cfg.gradeLevel = Number(cfg.gradeLevel) || cfg.gradeLevel;
    cfg.physicalIntensityMax = Math.max(0, Math.min(3, Number(cfg.physicalIntensityMax) || 0));
    cfg.socialIntensityMax = Math.max(0, Math.min(3, Number(cfg.socialIntensityMax) || 0));
    cfg.totalRounds = Math.max(3, Math.min(12, Number(cfg.totalRounds) || 6));

    // Normalize seedChallenges (defensive shape only — runtime generator
    // produces the real ones)
    if (Array.isArray(cfg.seedChallenges)) {
      const allowedTypes = ["truth", "dare"];
      const allowedTiers = ["sprout", "stem", "big"];
      const allowedCats = [
        "recall", "explain", "defend", "mime", "persuade", "roleplay",
        "improv", "draw", "narrate", "compose", "reflect", "predict",
      ];
      const allowedJudge = ["ai", "teacher", "class-vote"];
      const allowedReward = ["small", "medium", "large"];

      cfg.seedChallenges = cfg.seedChallenges
        .map((c, i) => {
          if (!c || typeof c !== "object") return null;
          const prompt = typeof c.prompt === "string" ? c.prompt.trim() : "";
          if (!prompt) return null;

          // Accept comma-separated acceptableAnswers string
          let accept = c.acceptableAnswers;
          if (typeof accept === "string") {
            accept = accept.split(",").map((s) => s.trim()).filter(Boolean);
          }
          if (!Array.isArray(accept)) accept = null;

          return {
            id: typeof c.id === "string" && c.id.trim() ? c.id : `seed-${i + 1}`,
            type: allowedTypes.includes(c.type) ? c.type : "truth",
            tier: allowedTiers.includes(c.tier) ? c.tier : "sprout",
            category: allowedCats.includes(c.category) ? c.category : "recall",
            prompt,
            teacherHint: typeof c.teacherHint === "string" ? c.teacherHint.trim() : "",
            timeSeconds: Math.max(15, Math.min(90, Number(c.timeSeconds) || 30)),
            physicalIntensity: Math.max(0, Math.min(3, Number(c.physicalIntensity) || 0)),
            socialIntensity: Math.max(0, Math.min(3, Number(c.socialIntensity) || 1)),
            noiseExpected: Math.max(0, Math.min(3, Number(c.noiseExpected) || 0)),
            acceptableAnswers: accept,
            judgmentMode: allowedJudge.includes(c.judgmentMode) ? c.judgmentMode : "teacher",
            rewardTier: allowedReward.includes(c.rewardTier) ? c.rewardTier : "small",
          };
        })
        .filter(Boolean);
    }

    t.config = cfg;
  }

  // ── UPVOTE: promote top-level vote fields, apply defaults + clamps ──
  if (type === TASK_TYPES.UPVOTE) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    for (const k of [
      "proposition", "subject", "unitName", "gradeLevel",
      "voteTimeSeconds", "showRunningTally", "requireReasoningOnSubmit",
      "worldview",
    ]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }

    // Trim proposition (the playability check fires on empty strings too).
    if (typeof cfg.proposition === "string") {
      cfg.proposition = cfg.proposition.trim();
    }

    // Infer worldview from subject when unset — mirrors Truth or Dare.
    if (!cfg.worldview || typeof cfg.worldview !== "string" || !cfg.worldview.trim()) {
      const subj = String(cfg.subject || "");
      if (/bible|religion|faith|theology|scripture/i.test(subj)) {
        cfg.worldview = "faith";
      } else if (/secular|atheist|humanist/i.test(subj)) {
        cfg.worldview = "secular";
      } else {
        cfg.worldview = "general";
      }
    }

    // Defaults.
    if (cfg.showRunningTally == null) cfg.showRunningTally = true;
    if (cfg.requireReasoningOnSubmit == null) cfg.requireReasoningOnSubmit = false;
    cfg.showRunningTally = !!cfg.showRunningTally;
    cfg.requireReasoningOnSubmit = !!cfg.requireReasoningOnSubmit;

    // Clamp the vote timer to 30-300 (default 120). Anything outside that
    // range almost always means the AI emitted a token rather than seconds.
    {
      const raw = cfg.voteTimeSeconds == null ? 120 : Number(cfg.voteTimeSeconds);
      const v = Number.isFinite(raw) ? raw : 120;
      cfg.voteTimeSeconds = Math.max(30, Math.min(300, Math.round(v)));
    }

    // Coerce gradeLevel numerically if present.
    if (cfg.gradeLevel != null) {
      const n = Number(cfg.gradeLevel);
      if (Number.isFinite(n)) cfg.gradeLevel = n;
    }

    t.config = cfg;
  }

  // ── QUEST: promote top-level mission fields into config ──
  if (type === TASK_TYPES.QUEST) {
    const _isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const cfg = _isObj(t.config) ? { ...t.config } : {};

    for (const k of ["title", "scenario", "objectives", "resources", "premiumResources", "ranks", "subject", "worldview"]) {
      if (cfg[k] === undefined && t[k] !== undefined) {
        cfg[k] = t[k];
        delete t[k];
      }
    }

    // Infer worldview from subject/title/scenario when unset. The quest renderer
    // uses worldview="faith" to relabel the economy as sharing/stewarding gifts
    // instead of "buying" them — "buying the Holy Spirit / its gifts" reads as
    // simony (Acts 8) on Bible topics.
    if (!cfg.worldview || typeof cfg.worldview !== "string" || !cfg.worldview.trim()) {
      const faithText = `${cfg.subject || t.subject || ""} ${cfg.title || ""} ${cfg.scenario || ""}`;
      if (/\b(bible|religion|faith|theology|scriptures?|pentecost|holy spirit|gospel|disciples?|apostles?|christ|jesus)\b/i.test(faithText)) {
        cfg.worldview = "faith";
        console.log(`[sanitize] QUEST inferred worldview="faith"`);
      }
    }

    // Coerce objectives shape
    if (Array.isArray(cfg.objectives)) {
      cfg.objectives = cfg.objectives
        .map((o, i) => {
          if (!o || typeof o !== "object") return null;
          return {
            id: typeof o.id === "string" && o.id.trim() ? o.id : `obj-${i + 1}`,
            description: typeof o.description === "string" ? o.description.trim() : "",
            requiredResources:
              o.requiredResources && typeof o.requiredResources === "object" && !Array.isArray(o.requiredResources)
                ? o.requiredResources
                : {},
          };
        })
        .filter((o) => o && o.description);
    }

    // Coerce resources shape
    if (Array.isArray(cfg.resources)) {
      cfg.resources = cfg.resources
        .map((r, i) => {
          if (!r || typeof r !== "object") return null;
          const id = typeof r.id === "string" && r.id.trim() ? r.id : `res-${i + 1}`;
          const name = typeof r.name === "string" ? r.name : id;
          const acq = Array.isArray(r.acquisitionOptions)
            ? r.acquisitionOptions.filter((o) => o && typeof o === "object" && o.type)
            : [];
          // Always offer at least a coin acquisition path
          if (acq.length === 0 || !acq.some((o) => o.type === "coins")) {
            acq.push({ type: "coins", amount: Number(r.coinCost) > 0 ? Number(r.coinCost) : 10 });
          }
          return {
            id,
            name,
            acquisitionOptions: acq,
            prerequisites: Array.isArray(r.prerequisites) ? r.prerequisites : [],
          };
        })
        .filter(Boolean);
    }

    t.config = cfg;
  }

  return t;
}

export default sanitizeTaskShapeByType;
