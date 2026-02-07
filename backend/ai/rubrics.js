// backend/rubrics.js
// Central place for reusable AI grading rubrics.

export const RUBRICS = {
  // 1) Audio: "Join, or Die" explanation
  "join-or-die-explanation": {
    maxPoints: 12,
    criteria: [
      {
        id: "describe_image",
        label: "Describes what the cartoon shows",
        description:
          "Student correctly describes key elements of the 'Join, or Die' cartoon, such as the segmented snake, the colonies it represents, and the idea of the pieces needing to be together.",
        maxPoints: 4,
      },
      {
        id: "explain_message",
        label: "Explains the message to the colonies",
        description:
          "Student explains that the cartoon is sending a warning or encouragement that the colonies must unite or they will be weaker or destroyed.",
        maxPoints: 4,
      },
      {
        id: "historical_context",
        label: "Mentions historical context",
        description:
          "Student connects the cartoon to its historical context (e.g., French and Indian War, Benjamin Franklin, colonies facing danger).",
        maxPoints: 2,
      },
      {
        id: "clarity",
        label: "Clarity and coherence",
        description:
          "Student speaks clearly enough to understand, stays on topic, and gives a roughly 30–60 second explanation.",
        maxPoints: 2,
      },
    ],
    gradingNotes:
      "Give partial credit when a criterion is partially met. Do not penalize accents, minor grammar issues, or filler words if the content is correct.",
  },

  // 2) Make-and-snap: wampum-inspired pattern
  "wampum-pattern-make-and-snap": {
    maxPoints: 14,
    criteria: [
      {
        id: "visible_pattern",
        label: "Visible pattern or structured design",
        description:
          "The image shows a clear pattern or structured arrangement (repeated shapes, colours, or symbols) rather than random placement.",
        maxPoints: 6,
      },
      {
        id: "meaning_caption",
        label: "Caption explains meaning (peace/alliance)",
        description:
          "The caption explains what the pattern is meant to represent, with some reference to peace, alliance, agreement, unity, or similar ideas.",
        maxPoints: 4,
      },
      {
        id: "wampum_connection",
        label: "Connects to wampum idea",
        description:
          "The caption or design shows some understanding that wampum belts were used to remember or symbolize agreements, promises, or relationships.",
        maxPoints: 2,
      },
      {
        id: "image_clarity",
        label: "Image clarity and effort",
        description:
          "The belt or pattern is reasonably visible in the photo; there is evidence of effort in the arrangement or colouring.",
        maxPoints: 2,
      },
    ],
    gradingNotes:
      "If the image is extremely blurry or almost nothing is visible, award low points for pattern and clarity. Do not judge artistic quality; focus on pattern, meaning, and effort.",
  },

  // 3) Draw: Fortress Louisbourg
  "louisbourg-drawing": {
    maxPoints: 14,
    criteria: [
      {
        id: "fortress_layout",
        label: "Basic fortress layout",
        description:
          "Drawing includes a recognizable top-view or side-view of a fortress or stronghold (walls, outline, buildings, or harbour).",
        maxPoints: 4,
      },
      {
        id: "three_features",
        label: "Labels at least three features",
        description:
          "At least three features are labelled (e.g., harbour, walls, cannons, gate, barracks). The labels can be handwritten if still readable.",
        maxPoints: 4,
      },
      {
        id: "explain_importance",
        label: "Explains why features mattered",
        description:
          "The notes or captions explain why each feature made the fortress important or strong in the war (e.g., protected harbour, strong walls, cannon positions).",
        maxPoints: 4,
      },
      {
        id: "effort_and_clarity",
        label: "Effort and clarity",
        description:
          "Drawing is reasonably clear and not just a quick scribble; features can be identified and labels are mostly legible.",
        maxPoints: 2,
      },
    ],
    gradingNotes:
      "Do not grade artistic skill. Reward clear features, labels, and historical thinking about why those features mattered.",
  },

  // 4) Open-text: Quebec Act perspectives
  "quebec-act-perspectives": {
    maxPoints: 14,
    criteria: [
      {
        id: "french_positive",
        label: "French Canadian positive view",
        description:
          "Explains at least one reason the Quebec Act could look positive to many French Canadians (e.g., allowed Catholicism, French civil law, language, land/territory protections).",
        maxPoints: 5,
      },
      {
        id: "british_negative",
        label: "British colonist negative view",
        description:
          "Explains at least one reason the Quebec Act could look negative to many British colonists (e.g., fear of Catholic influence, less control, expanded Quebec territory into areas they wanted, seen as favouring French).",
        maxPoints: 5,
      },
      {
        id: "compare_perspectives",
        label: "Understands both perspectives",
        description:
          "Shows understanding that different groups could react differently to the same law; contrasts or compares their experiences or interests.",
        maxPoints: 2,
      },
      {
        id: "structure_and_clarity",
        label: "Structure and clarity (1–2 paragraphs)",
        description:
          "Response is written in 1–2 short paragraphs, mostly clear and on topic, with few major errors that block understanding.",
        maxPoints: 2,
      },
    ],
    gradingNotes:
      "Focus on historical understanding more than perfect writing. Minor grammar or spelling issues should not significantly lower the score.",
  },
};

export function getRubricById(id) {
  if (!id) return null;
  return RUBRICS[id] || null;
}
