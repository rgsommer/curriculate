// backend/controllers/sanitizeTaskShape.js
// Canonical task-shape sanitizer — imported by both mainTasksetController and sharedTasksetController.
// All AI-output cleanup / normalization for specific task types lives here.

import { TASK_TYPES } from "../../shared/taskTypes.js";

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

  // ── MAD_DASH_SEQUENCE: normalize correctOrder to integers ──
  if (type === TASK_TYPES.MAD_DASH_SEQUENCE) {
    const order = t.config?.correctOrder || t.correctOrder;
    if (Array.isArray(order)) {
      const intOrder = order.map((v) => parseInt(v, 10)).filter((v) => Number.isFinite(v));
      if (intOrder.length === order.length) {
        if (t.config && typeof t.config === "object") t.config.correctOrder = intOrder;
        if (Array.isArray(t.correctOrder)) t.correctOrder = intOrder;
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

  return t;
}

export default sanitizeTaskShapeByType;
