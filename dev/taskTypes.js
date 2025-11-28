// shared/taskTypes.js

// Core task type constants
export const TASK_TYPES = {
  MULTIPLE_CHOICE: "multiple-choice",
  TRUE_FALSE: "true-false",
  SHORT_ANSWER: "short-answer",   // simple text answer
  OPEN_TEXT: "open-text",         // longer reflection / journal
  SORT: "sort",
  SEQUENCE: "sequence",
  PHOTO: "photo",
  MAKE_AND_SNAP: "make-and-snap",
  BODY_BREAK: "body-break",
  RECORD_AUDIO: "record-audio",

  // Planned / future types
  DRAW: "draw",
  MIME: "mime",
  SCAVENGER: "scavenger",
  HIDE_AND_DRAW: "hide-and-draw", // “hide word then draw it / dictionary”
  QR_SCAN_ONLY: "qr-scan-only",   // pure “go scan this thing” task
};

// Meta info per task type
//  - label: human-friendly name
//  - implemented: whether there is a working student component
//  - category: primary category for grouping / filters
//
// Categories: 'analytical' | 'creative' | 'physical' | 'input' | 'other'
export const TASK_TYPE_META = {
  [TASK_TYPES.MULTIPLE_CHOICE]: {
    label: "Multiple Choice",
    implemented: true,
    category: "analytical",
  },
  [TASK_TYPES.TRUE_FALSE]: {
    label: "True / False",
    implemented: true,
    category: "analytical",
  },
  [TASK_TYPES.SHORT_ANSWER]: {
    label: "Short Answer",
    implemented: true,
    category: "input",
  },
  [TASK_TYPES.OPEN_TEXT]: {
    label: "Open Text / Reflection",
    implemented: true, // you have OpenTextTask
    category: "creative",
  },
  [TASK_TYPES.SORT]: {
    label: "Sort",
    implemented: true,
    category: "analytical",
  },
  [TASK_TYPES.SEQUENCE]: {
    label: "Sequence / Order",
    implemented: true,
    category: "analytical",
  },
  [TASK_TYPES.PHOTO]: {
    label: "Photo",
    implemented: true,
    category: "input",
  },
  [TASK_TYPES.MAKE_AND_SNAP]: {
    label: "Make & Snap",
    implemented: true,
    category: "creative",
  },
  [TASK_TYPES.BODY_BREAK]: {
    label: "Body Break / Movement",
    implemented: true,
    category: "physical",
  },
  [TASK_TYPES.RECORD_AUDIO]: {
    label: "Record Audio",
    implemented: true,
    category: "input",
  },
  [TASK_TYPES.JEOPARDY]: {
    label: "Jeopardy",
    implemented: true,
    category: "input",
  },

  // Planned
  [TASK_TYPES.DRAW]: {
    label: "Draw",
    implemented: false,
    category: "creative",
  },
  [TASK_TYPES.MIME]: {
    label: "Mime / Act It Out",
    implemented: false,
    category: "physical",
  },
  [TASK_TYPES.SCAVENGER]: {
    label: "Scavenger Hunt",
    implemented: false,
    category: "physical",
  },
  [TASK_TYPES.HIDE_AND_DRAW]: {
    label: "Hide & Draw",
    implemented: false,
    category: "creative",
  },
  [TASK_TYPES.QR_SCAN_ONLY]: {
    label: "QR Scan Only",
    implemented: false,
    category: "input",
  },
};

// Labels map (value → label)
export const TASK_TYPE_LABELS = Object.fromEntries(
  Object.entries(TASK_TYPE_META).map(([value, meta]) => [
    value,
    meta.label || value,
  ])
);

// Implemented vs planned lists
export const IMPLEMENTED_TASK_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented)
  .map(([value]) => value);

export const PLANNED_TASK_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => !meta.implemented)
  .map(([value]) => value);

// Grouping by category
const GROUP_KEYS = ["analytical", "creative", "physical", "input", "other"];

export const TASK_TYPE_GROUPS = GROUP_KEYS.reduce((acc, key) => {
  acc[key.toUpperCase()] = [];
  return acc;
}, {});

Object.entries(TASK_TYPE_META).forEach(([value, meta]) => {
  const cat = (meta.category || "other").toUpperCase();
  if (!TASK_TYPE_GROUPS[cat]) {
    TASK_TYPE_GROUPS[cat] = [];
  }
  TASK_TYPE_GROUPS[cat].push(value);
});

// Convenience arrays for dropdowns, etc.
export const IMPLEMENTED_TASK_TYPE_OPTIONS = IMPLEMENTED_TASK_TYPES.map(
  (value) => ({
    value,
    label: TASK_TYPE_LABELS[value] || value,
  })
);

export const ALL_TASK_TYPE_OPTIONS = Object.entries(TASK_TYPE_LABELS).map(
  ([value, label]) => ({ value, label })
);
