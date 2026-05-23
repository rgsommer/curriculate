// backend/services/truthOrDare/safetyPatterns.js
//
// Hard-blocked patterns for Truth or Dare challenges. ANY match in the
// prompt text (or teacherHint) means the challenge is rejected, the AI
// retries with a stricter system message, and on second retry we fall
// back to the curated library.
//
// Versioned. When you add patterns, bump SAFETY_VERSION so analytics
// can correlate flag rates with pattern changes.
//
// Categories follow TRUTH_OR_DARE_PLAN.md §4 — keep them in sync.

export const SAFETY_VERSION = "v1";

// Pattern entries: { rx, category, severity }
// severity: "block" (hard reject) | "warn" (allow but record)
export const SAFETY_PATTERNS = [
  // ── Romance / attraction / sexuality ──────────────────────────────
  { rx: /\b(kiss|crush|date|dating|romance|romantic|attract(?:ed|ion))\b/i, category: "romance", severity: "block" },
  { rx: /\b(boyfriend|girlfriend|partner|spouse|hook[\s-]?up)\b/i, category: "romance", severity: "block" },
  { rx: /\b(sexy|sexual|naked|nude|stripped?)\b/i, category: "sexuality", severity: "block" },
  { rx: /\b(do you like\s+(?:him|her|them)|have a crush)\b/i, category: "romance", severity: "block" },

  // ── Personal disclosure (family income / religion / mental health /
  //    sexuality / immigration / addresses / grades) ─────────────────
  { rx: /\b(your\s+)?(family('s)?\s+income|family('s)?\s+money|how\s+much\s+(does|do)\s+your\s+(parents?|family))/i, category: "personal-disclosure", severity: "block" },
  { rx: /\b(home address|phone number|social security|ssn|where do you live)\b/i, category: "personal-disclosure", severity: "block" },
  { rx: /\b(your\s+)?(grades?|gpa|test score)\b\s*(?:in this class|here|are)/i, category: "personal-disclosure", severity: "block" },
  { rx: /\b(depression|anxiety|self[\s-]?harm|suicide|mental illness|therapy|medication)\b/i, category: "self-harm", severity: "block" },
  { rx: /\b(your\s+)?(parents'|parents are|family is|family's)\s+(religion|faith|beliefs|status|wealth|poverty)/i, category: "personal-disclosure", severity: "block" },
  { rx: /\b(immigration|deport|illegal|undocumented)/i, category: "personal-disclosure", severity: "block" },

  // ── Substances ───────────────────────────────────────────────────
  { rx: /\b(alcohol|beer|wine|drunk|drinking|vape|vaping|smok(?:e|ing)|marijuana|weed|drug)\b/i, category: "substances", severity: "block" },

  // ── Violence / weapons / self-harm ───────────────────────────────
  { rx: /\b(kill|murder|stab|shoot|shoot[\s-]?up|gun|knife|weapon|bomb|explod(?:e|ing))\b/i, category: "violence", severity: "block" },
  { rx: /\b(hurt yourself|cut yourself|harm yourself)/i, category: "self-harm", severity: "block" },

  // ── Body image / appearance ──────────────────────────────────────
  { rx: /\b(fat|skinny|ugly|hot|attractive|weigh(?:t)?|chubby|thin)\b/i, category: "body-image", severity: "block" },
  { rx: /\b(your\s+)?(appearance|how you look|what you look like)/i, category: "body-image", severity: "block" },

  // ── Touching / proximity to other students ───────────────────────
  { rx: /\b(touch|hug|hold hands|kiss|lean on|sit on|put your hand on)\s+(?:another|the|a|your\s+(?:friend|classmate))/i, category: "touching", severity: "block" },
  { rx: /\bphysical contact\b/i, category: "touching", severity: "block" },

  // ── Eating / drinking / mouth-contact ─────────────────────────────
  { rx: /\b(eat|drink|swallow|put.*in your mouth|chew|taste)\b/i, category: "food-contact", severity: "block" },

  // ── Movement that requires leaving the classroom or unsafe acts ──
  { rx: /\b(leave the classroom|leave the room|run outside|go outside)\b/i, category: "leave-classroom", severity: "block" },
  { rx: /\b(climb|stand on (?:the )?(?:desk|chair|table|furniture))\b/i, category: "unsafe-movement", severity: "block" },
  { rx: /\b(spin\s+(?:fast|wildly)|run\s+(?:around|across))\b/i, category: "unsafe-movement", severity: "block" },

  // ── Humiliation framing ───────────────────────────────────────────
  { rx: /\b(embarrass|humiliat|shame|disgrace|laugh\s+at\s+(?:them|him|her))/i, category: "humiliation", severity: "block" },
  { rx: /\b(secret|worst|most embarrassing|stupidest|dumbest)\s+(thing|story|memory|moment)\b/i, category: "humiliation", severity: "block" },
  { rx: /\bconfess (?:a |your )?(secret|crime|sin|mistake)\b/i, category: "humiliation", severity: "block" },

  // ── Singling out by name (not the spotlighted student themselves) ─
  // Catches "do an impression of [a real classmate's name]" via a soft
  // marker — the AI is told never to use student names; if it does,
  // we block. This is best-effort; the AI shouldn't have student names
  // anyway.
  { rx: /\bdo an impression of\s+(?:your friend|your classmate|the kid)/i, category: "singling-out", severity: "block" },
  { rx: /\bmake fun of\b/i, category: "mocking", severity: "block" },

  // ── Politics / religion / current-event tragedy ──────────────────
  { rx: /\b(trump|biden|harris|democrat|republican|liberal|conservative)\s+(?:are|is|always|never)/i, category: "politics", severity: "block" },
  { rx: /\b(christian|muslim|jew|hindu|buddhist|atheist|catholic|evangelical)s?\s+(?:are|believe|always|never)/i, category: "religion-stereotype", severity: "block" },
  { rx: /\b(pray|prayer)\s+to\b/i, category: "religion-direct", severity: "warn" }, // warn — allowed in faith-school worldview

  // ── Property required (not all students have phones / cameras /
  //    hats / food / pets) ──────────────────────────────────────────
  { rx: /\b(use your phone|take out your phone|use your camera)/i, category: "property-required", severity: "warn" },
  // Warn rather than block — depends on cameraEnabled flag. Caller
  // checks that.

  // ── Real-people mockery ──────────────────────────────────────────
  { rx: /\b(impersonate|impression of)\s+(?:donald trump|joe biden|kamala harris|elon musk|kanye)/i, category: "real-people-mockery", severity: "block" },
];

// Quick blacklist of forbidden phrase fragments — substring match,
// case-insensitive. Used as a fast first pass before the regex sweep.
export const SAFETY_PHRASE_BLACKLIST = [
  "your worst secret",
  "tell us your secret",
  "most embarrassing moment",
  "most embarrassing story",
  "have you ever kissed",
  "have you ever drunk",
  "do you have a crush",
  "rate your classmates",
  "rate the people in the room",
  "are you religious",
  "what does your family",
  "how much money",
  "stand up on your desk",
  "stand on your chair",
  "take off",
  "smell each other",
  "lick",
  "spit",
  "make fun of",
  "tell us a lie",
  "lie about",
];

// Approved categories. The prompt's `category` field must match.
export const APPROVED_CATEGORIES = [
  "recall",
  "explain",
  "defend",
  "mime",
  "persuade",
  "roleplay",
  "improv",
  "draw",
  "narrate",
  "compose",
  "reflect",
  "predict",
];
