// teacher-app/src/pages/AiTasksetGenerator.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { fetchMyProfile } from "../api/profile";
import { apiFetch, apiFetchJson } from "../api/apiFetch";
import { TASK_TYPES, TASK_TYPE_META } from "../../../shared/taskTypes.js";

// Category → color mapping for task type badges
const CATEGORY_COLORS = {
  "question":      { bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  "ordering":      { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d" },
  "creative":      { bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" },
  "movement":      { bg: "#fce7f3", fg: "#9d174d", border: "#f9a8d4" },
  "competitive":   { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  "deduction":     { bg: "#e0e7ff", fg: "#3730a3", border: "#a5b4fc" },
  "collaboration": { bg: "#d1fae5", fg: "#065f46", border: "#6ee7b7" },
  "feedback/meta": { bg: "#f3f4f6", fg: "#374151", border: "#d1d5db" },
  "synthesis":     { bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  "other":         { bg: "#f5f5f4", fg: "#57534e", border: "#d6d3d1" },
  "recall":        { bg: "#ccfbf1", fg: "#0f766e", border: "#5eead4" },
  "role-play":     { bg: "#fbcfe8", fg: "#86198f", border: "#f0abfc" },
};

const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"];
const LEARNING_GOALS = ["REVIEW", "INTRODUCTION", "ENRICHMENT", "ASSESSMENT"];

/* ------------------------------------------------------------------ */
/*  PARTY MODE                                                         */
/* ------------------------------------------------------------------ */

const PARTY_TASK_TYPES = [
  "flashcards-race",
  "musical-chairs",
  "brain-blitz",
  "speed-draw",
  "treasure-runner",
  "draw-mime",
  "fake-out",
  "hangman-duel",
  "true-false-tictactoe",
  "true-false-connect-four",
  "mad-dash",
  "echo-chain",
  "diff-detective",
  "guess-who",
];

const PARTY_THEMES = [
  { id: "dinosaurs", emoji: "🦕", label: "Dinosaurs", vocab: ["T-Rex", "Triceratops", "Stegosaurus", "fossil", "herbivore", "carnivore", "Jurassic", "extinction", "paleontologist", "velociraptor"] },
  { id: "space", emoji: "🚀", label: "Space", vocab: ["planet", "asteroid", "galaxy", "astronaut", "orbit", "comet", "nebula", "gravity", "solar system", "constellation"] },
  { id: "sports", emoji: "⚽", label: "Sports", vocab: ["championship", "referee", "penalty", "goalkeeper", "marathon", "relay", "sportsmanship", "offense", "defense", "tournament"] },
  { id: "ocean", emoji: "🐙", label: "Under the Sea", vocab: ["coral reef", "dolphin", "whale", "seahorse", "jellyfish", "octopus", "submarine", "tide", "bioluminescence", "plankton"] },
  { id: "superheroes", emoji: "🦸", label: "Superheroes", vocab: ["superpower", "villain", "sidekick", "shield", "cape", "headquarters", "identity", "mission", "nemesis", "rescue"] },
  { id: "animals", emoji: "🐾", label: "Animals", vocab: ["habitat", "camouflage", "migration", "predator", "nocturnal", "endangered", "ecosystem", "hibernate", "mammal", "amphibian"] },
  { id: "magic", emoji: "🧙", label: "Wizards & Magic", vocab: ["spell", "potion", "enchantment", "wand", "crystal", "sorcery", "invisible", "prophecy", "apprentice", "talisman"] },
  { id: "music", emoji: "🎵", label: "Music", vocab: ["rhythm", "melody", "harmony", "tempo", "chorus", "instrument", "conductor", "lyrics", "bass", "treble"] },
  { id: "science", emoji: "🔬", label: "Science", vocab: ["experiment", "hypothesis", "molecule", "chemical reaction", "microscope", "gravity", "electricity", "magnetism", "photosynthesis", "DNA"] },
  { id: "pirates", emoji: "🏴‍☠️", label: "Pirates", vocab: ["treasure", "captain", "compass", "anchor", "plank", "parrot", "cannon", "island", "shipwreck", "sword"] },
  { id: "custom", emoji: "✨", label: "Custom (your own)", vocab: [] },
];

/* ------------------------------------------------------------------ */
/*  EVENT MODE                                                         */
/* ------------------------------------------------------------------ */

const EVENT_TASK_TYPES = [
  "flashcards-race",
  "brain-blitz",
  "speed-draw",
  "fake-out",
  "guess-who",
  "draw-mime",
  "hangman-duel",
  "diff-detective",
  "echo-chain",
  "true-false-tictactoe",
  "true-false-connect-four",
  "debate",
];

const EVENT_INDUSTRY_THEMES = [
  { id: "tech", emoji: "💻", label: "Tech / SaaS", vocab: ["API", "deployment", "sprint", "standup", "pull request", "latency", "microservice", "agile", "refactor", "CI/CD"] },
  { id: "finance", emoji: "📊", label: "Finance", vocab: ["portfolio", "hedge", "dividend", "equity", "liquidity", "amortization", "yield curve", "arbitrage", "compliance", "fiduciary"] },
  { id: "healthcare", emoji: "🏥", label: "Healthcare", vocab: ["triage", "diagnosis", "protocol", "patient outcome", "HIPAA", "clinical trial", "prognosis", "formulary", "EHR", "palliative"] },
  { id: "marketing", emoji: "📣", label: "Marketing", vocab: ["conversion", "funnel", "attribution", "impressions", "engagement rate", "retargeting", "brand equity", "CTA", "A/B test", "churn"] },
  { id: "sales", emoji: "🤝", label: "Sales", vocab: ["pipeline", "discovery call", "quota", "close rate", "objection handling", "upsell", "champion", "BANT", "POC", "renewal"] },
  { id: "hr", emoji: "👥", label: "HR / People", vocab: ["retention", "onboarding", "DEI", "performance review", "engagement survey", "HRIS", "succession planning", "employer brand", "attrition", "PIP"] },
  { id: "legal", emoji: "⚖️", label: "Legal", vocab: ["liability", "indemnity", "compliance", "due diligence", "NDA", "arbitration", "precedent", "statute", "injunction", "jurisdiction"] },
  { id: "product", emoji: "🛠️", label: "Product / Design", vocab: ["user story", "wireframe", "MVP", "iteration", "A/B test", "persona", "roadmap", "OKR", "feature flag", "design system"] },
  { id: "general", emoji: "🏢", label: "General Business", vocab: ["stakeholder", "ROI", "synergy", "bandwidth", "deliverable", "alignment", "KPI", "scalable", "leverage", "pivot"] },
];

const EVENT_TYPE_THEMES = [
  { id: "icebreaker", emoji: "🧊", label: "Icebreaker", vocab: ["two truths and a lie", "fun fact", "bucket list", "hidden talent", "first job", "guilty pleasure", "unpopular opinion", "pet peeve", "dream vacation", "superpower"] },
  { id: "team-building", emoji: "🏗️", label: "Team Building", vocab: ["collaboration", "trust", "communication", "leadership", "problem solving", "brainstorm", "consensus", "delegation", "feedback", "team spirit"] },
  { id: "conference-recap", emoji: "📝", label: "Conference Recap", vocab: ["keynote", "takeaway", "action item", "insight", "trend", "disruption", "innovation", "panel", "Q&A", "breakout session"] },
  { id: "onboarding", emoji: "🚀", label: "New Hire Onboarding", vocab: ["company values", "org chart", "mission statement", "benefits", "code of conduct", "mentor", "probation", "handbook", "culture", "all-hands"] },
  { id: "quarterly", emoji: "📈", label: "Quarterly Kickoff", vocab: ["OKR", "target", "roadmap", "retrospective", "milestone", "forecast", "pipeline review", "win", "challenge", "north star metric"] },
  { id: "holiday", emoji: "🎄", label: "Holiday Party", vocab: ["celebration", "gratitude", "highlights", "year in review", "toast", "award", "recognition", "tradition", "resolution", "team spirit"] },
];

// --- Task-specific generation constraints (additive). These get appended to topicDescription
// so the backend AI prompt is forced to include required fields for certain task types.
const TASK_GEN_CONSTRAINTS = {
  "fake-out": `
FAKE-OUT TASK GENERATION RULES (MUST FOLLOW):
- You MUST include config.rounds as a non-empty array.
- Each round MUST include:
  - prompt: string (the term/concept to be read aloud)
  - options: exactly 3 strings (AI-provided). These are the ONLY AI-provided options.
  - correctIndex: number (0-2) pointing to the correct option inside options[]
  - jokeOption: string (an obviously false / hilarious option)
  - jokeIndex: number (0-3) indicating where jokeOption should appear among the 4 displayed options.
    - IMPORTANT: jokeIndex MUST be random per round; do NOT always use 3.
- The 4th displayed "option" is NOT AI-provided: the reader will invent it during play (leave a blank slot in UI).
- Keep the three AI options verbose and difficult-to-discern; only ONE is correct; the other TWO are clever fakes.
- The jokeOption should be clearly, comically wrong, but still thematically connected.
OUTPUT SHAPE EXAMPLE (per round):
{ prompt, options:[...3], correctIndex:0|1|2, jokeOption, jokeIndex:0|1|2|3 }
`,
  "echo-chain": `
ECHO-CHAIN TASK GENERATION RULES (MUST FOLLOW):
- You MUST include config.startWord (string).
- You MUST include config.minChainLength as a number >= 5.
- Optionally include config.perTurnSeconds (default 10) and config.hasTimer (boolean).
- The task should not end until at least minChainLength words are added to the chain.
`,
  "matching": `
MATCHING TASK GENERATION RULES (MUST FOLLOW):
- You MUST include config.leftItems (5-7 strings) and config.rightItems (same count, strings).
- You MUST include config.correctMatches as an object mapping each left item to its correct right item.
- Ensure all left items are unique; all right items are unique.
 `,
  "mad-dash-sequence": `
MAD-DASH-SEQUENCE TASK GENERATION RULES (MUST FOLLOW):
- You MUST include config.items as an array of 3–5 short strings.
- You MUST include config.correctOrder as an array of indices (same length as items) representing the correct order.
- correctOrder MUST be a valid permutation of [0..items.length-1] with no repeats.
- Do NOT include colors; colors/stations are assigned at runtime.
`,
  "reading-comp": `
READING-COMP TASK GENERATION RULES (MUST FOLLOW):
- You MUST include generatedParagraph as a single string paragraph.
- The paragraph MUST contain exactly X sentences, where X = gradeLevel if gradeLevel is a number (e.g., 7, 8, 10, 12).
- If gradeLevel is NOT a number (e.g., 'conference', 'adult', 'mixed'), then X = 10 sentences.
- You MUST include prompt that instructs the student to write ONE sentence showing comprehension.
- Include isTeamVariation as a boolean. If true, the task is intra-team (hide & pass + team vote).
- Inter-team play must be disabled (interTeamEnabled: false).
- Intra-team play must be enabled (intraTeamEnabled: true) when isTeamVariation is true.
- Keep the paragraph age-appropriate and aligned to the requested topic.
`,
  "open-text": `
OPEN-TEXT (VOCAB WEAVE) TASK GENERATION RULES (USE THIS MODE WHEN APPROPRIATE):
- If you generate an open-text task intended as a vocabulary paragraph challenge, set config.kind = "vocabulary-paragraph".
- You MUST include config.requiredWords as an array of 5–10 strings, drawn from aiWordBank.
- Prompt MUST instruct: write ONE coherent paragraph using every required word at least once (inflections allowed).
- The goal is demonstrating meaning, natural usage, and coherent writing (not a list).
- You MUST set interTeamEnabled: false and intraTeamEnabled: false.
- Include config.minWords (default 45) and config.maxWords (default 140) unless a better range is justified for grade level.
- The answer will be AI-scored for: inclusion, contextual correctness, grammatical coherence, and optional creativity bonus.
`,
};

// Generator-eligible task types (mirror backend intent)
const GENERATOR_ELIGIBLE_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented !== false && meta.generatorEligible !== false)
  .map(([type]) => type);

// Subset that likely benefits from AI-generated content (UI-only hints)
const AI_GENERATED_TYPES = Object.entries(TASK_TYPE_META)
  .filter(([, meta]) => meta.implemented !== false && meta.generatorEligible !== false)
  .filter(([, meta]) => (meta.scoringMode ? String(meta.scoringMode).toLowerCase() : "") !== "none")
  .map(([type]) => type);

function safeArray(x) {
  return Array.isArray(x) ? x : [];
}

function uniqStrings(list) {
  const seen = new Set();
  const out = [];
  for (const v of safeArray(list)) {
    const s = String(v || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function joinLines(list) {
  return uniqStrings(list).join("\n");
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    return true;
  } catch {
    return false;
  }
}

export default function AiTasksetGenerator() {
  const navigate = useNavigate();
  const location = useLocation();

  const prefillWordListFromState =
    location.state && Array.isArray(location.state.prefillWordList)
      ? location.state.prefillWordList
      : null;

  const prefillWordText = prefillWordListFromState
    ? prefillWordListFromState.join("\n")
    : "";

  const [profile, setProfile] = useState(null);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [form, setForm] = useState(() => {
    let savedGrade = "";
    let savedSubject = "";
    try {
      savedGrade = localStorage.getItem("curriculate.gen.gradeLevel") || "";
      savedSubject = localStorage.getItem("curriculate.gen.subject") || "";
    } catch {}
    return {
      name: "",
      roomLocation: "Classroom",
      gradeLevel: savedGrade,
      subject: savedSubject,
      difficulty: "MEDIUM",
      learningGoal: "REVIEW",
      topicDescription: "", // special considerations
      durationMinutes: 45,
      isFixedStation: false,
      isMultiRoomScavenger: false,
    };
  });

  const [displays, setDisplays] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [genProgress, setGenProgress] = useState({ done: 0, total: 0, lastType: "" });
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const [limitTasks, setLimitTasks] = useState(false);
  const [selectedTaskTypes, setSelectedTaskTypes] = useState([]);

  // Guarantee task types (ensures these appear in the generated set)
  const [guaranteeTypes, setGuaranteeTypes] = useState(false);
  const [guaranteedTaskTypes, setGuaranteedTaskTypes] = useState([]);

  // Task-type filters (UI-only)
  const [taskTypeCategory, setTaskTypeCategory] = useState("all");
  const [onlyIntraTeam, setOnlyIntraTeam] = useState(false);
  const [onlyInterTeam, setOnlyInterTeam] = useState(false);

  // Vocabulary / key terms (REQUIRED)
  const [wordListText, setWordListText] = useState(prefillWordText);

  // Multi-room list as text
  const [multiRoomText, setMultiRoomText] = useState("");

  // Party mode
  const [isPartyMode, setIsPartyMode] = useState(
    location.search?.includes("mode=party") || location.state?.partyMode || false
  );
  const [partyTheme, setPartyTheme] = useState("");
  const [partyCustomWords, setPartyCustomWords] = useState("");

  // Event mode
  const [isEventMode, setIsEventMode] = useState(
    location.search?.includes("mode=event") || location.state?.eventMode || false
  );
  const [eventIndustry, setEventIndustry] = useState("");
  const [eventType, setEventType] = useState("");
  const [eventCustomWords, setEventCustomWords] = useState("");

  // UI feedback for copy buttons
  const [copiedTag, setCopiedTag] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadProfile() {
      try {
        const data = await fetchMyProfile();
        if (cancelled) return;
        setProfile(data || null);

        const defaultGrade =
          (data && (data.defaultGradeLevel || data.gradeLevel)) || "";
        const defaultSubject =
          (data && (data.defaultSubject || data.subject)) || "";

        setForm((prev) => ({
          ...prev,
          gradeLevel: prev.gradeLevel || defaultGrade,
          subject: prev.subject || defaultSubject,
          roomLocation:
            prev.roomLocation || data?.defaultRoomLocation || "Classroom",
        }));
      } catch (err) {
        console.error("Failed to load profile for AI generator:", err);
      } finally {
        if (!cancelled) setLoadingProfile(false);
      }
    }

    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist grade + subject so they survive page reloads
  useEffect(() => {
    try {
      if (form.gradeLevel) localStorage.setItem("curriculate.gen.gradeLevel", form.gradeLevel);
      if (form.subject) localStorage.setItem("curriculate.gen.subject", form.subject);
    } catch {}
  }, [form.gradeLevel, form.subject]);

  const handleChange = (field, value) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleTaskType = (type) => {
    setSelectedTaskTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

  const toggleGuaranteedType = (type) => {
    setGuaranteedTaskTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );
  };

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
      copy[index] = { ...(copy[index] || {}), [field]: value };
      return copy;
    });
  };

  const removeDisplay = (index) => {
    setDisplays((prev) => prev.filter((_, i) => i !== index));
  };

  const coverage = useMemo(() => {
    const cov = result?.taskset?.meta?.coverage;
    if (!cov || typeof cov !== "object") return null;
    const requested = uniqStrings(cov.requested);
    const covered = uniqStrings(cov.covered);
    const missing = uniqStrings(cov.missing);

    return {
      requestedCount: Number(cov.requestedCount) || requested.length,
      coveredCount: Number(cov.coveredCount) || covered.length,
      missingCount: Number(cov.missingCount) || missing.length,
      requested,
      covered,
      missing,
      mentionCounts: cov.mentionCounts && typeof cov.mentionCounts === "object" ? cov.mentionCounts : {},
    };
  }, [result]);

  const allocation = useMemo(() => {
    const perTask = result?.taskset?.meta?.conceptAllocation?.perTask;
    if (!Array.isArray(perTask) || !perTask.length) return null;

    // Compact + defensive
    return perTask
      .map((r) => ({
        index: Number.isFinite(Number(r?.index)) ? Number(r.index) : null,
        taskType: String(r?.taskType || "").trim(),
        terms: uniqStrings(r?.terms),
      }))
      .filter((r) => r.index != null && r.taskType);
  }, [result]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (generating) return;

    setError("");
    setResult(null);
    setGenerating(true);
    setCopiedTag("");

    if (!form.name.trim()) {
      setError("Task set title is required.");
      setGenerating(false);
      return;
    }

    // Word bank — in party/event mode, merge theme vocab with custom words
    let aiWordBank;
    if (isPartyMode) {
      const themeObj = PARTY_THEMES.find((t) => t.id === partyTheme);
      const themeVocab = themeObj ? themeObj.vocab : [];
      const customWords = partyCustomWords
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);
      aiWordBank = uniqStrings([...themeVocab, ...customWords]);
    } else if (isEventMode) {
      const indObj = EVENT_INDUSTRY_THEMES.find((t) => t.id === eventIndustry);
      const evtObj = EVENT_TYPE_THEMES.find((t) => t.id === eventType);
      const indVocab = indObj ? indObj.vocab : [];
      const evtVocab = evtObj ? evtObj.vocab : [];
      const customWords = eventCustomWords
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);
      aiWordBank = uniqStrings([...indVocab, ...evtVocab, ...customWords]);
    } else {
      aiWordBank = wordListText
        .split(/[\n,;]+/)
        .map((w) => w.trim())
        .filter(Boolean);
    }

    if (!aiWordBank.length) {
      setError(
        isPartyMode
          ? "Please select a theme or add some custom words for the party games."
          : isEventMode
            ? "Please select an industry or event type, or add custom content for the event games."
            : "Please provide at least one vocabulary term or key word. The AI uses these to stay on topic."
      );
      setGenerating(false);
      return;
    }

    // Multi-room rooms
    let multiRoomRooms = [];
    if (form.isMultiRoomScavenger) {
      multiRoomRooms = multiRoomText
        .split(/[\n,;]+/)
        .map((r) => r.trim())
        .filter(Boolean);

      if (!multiRoomRooms.length) {
        setError(
          "For a multi-room scavenger hunt, please list at least one room/location."
        );
        setGenerating(false);
        return;
      }
    }

    try {
      // Clean displays if using fixed-station mode
      let cleanedDisplays = displays;
      if (!form.isFixedStation) {
        cleanedDisplays = [];
      } else {
        cleanedDisplays = (displays || []).filter(
          (d) => d && (d.name || d.description || d.stationColor)
        );
      }

      const totalDurationMinutes =
        Number.isFinite(form.durationMinutes) && form.durationMinutes > 0
          ? form.durationMinutes
          : 45;

      // Base task count estimate
      let estimatedTaskCount = Math.max(
        4,
        Math.min(20, Math.round(totalDurationMinutes / 5))
      );

      let requiredTaskTypes = [];
      let guaranteedTypes_payload = [];
      let baseSpecialConsiderations = (form.topicDescription || "").trim();

      // Party mode: force party-only task types and add party context
      if (isPartyMode) {
        const themeObj = PARTY_THEMES.find((t) => t.id === partyTheme);
        const themeName = themeObj ? themeObj.label : "General";
        const partyContext = `PARTY MODE — This is for a birthday party, NOT a classroom lesson. Theme: "${themeName}". Keep all content fun, energetic, and age-appropriate for a party setting. Use playful language. The vocabulary words include personal/custom items that should be woven into the games to make them feel personalized for the occasion.`;
        baseSpecialConsiderations = [partyContext, baseSpecialConsiderations].filter(Boolean).join("\n\n");
        requiredTaskTypes = PARTY_TASK_TYPES.filter((t) =>
          GENERATOR_ELIGIBLE_TYPES.includes(t)
        );
      }

      // Event mode: force event-appropriate task types and add corporate context
      if (isEventMode) {
        const indObj = EVENT_INDUSTRY_THEMES.find((t) => t.id === eventIndustry);
        const evtObj = EVENT_TYPE_THEMES.find((t) => t.id === eventType);
        const indName = indObj ? indObj.label : "General";
        const evtName = evtObj ? evtObj.label : "General";
        const eventContext = `EVENT MODE — This is for a corporate/professional event, NOT a classroom lesson. Industry: "${indName}". Event type: "${evtName}". Keep all content professional but engaging and fun. Use industry-appropriate vocabulary and references. The vocabulary words may include company-specific terms, conference content, or team inside references — weave them naturally into the games. Avoid anything childish — these are adults in a professional setting who should feel energized, not patronized.`;
        baseSpecialConsiderations = [eventContext, baseSpecialConsiderations].filter(Boolean).join("\n\n");
        requiredTaskTypes = EVENT_TASK_TYPES.filter((t) =>
          GENERATOR_ELIGIBLE_TYPES.includes(t)
        );
      }

      if (guaranteeTypes && guaranteedTaskTypes.length > 0) {
        guaranteedTypes_payload = Array.from(new Set(guaranteedTaskTypes));
      }

      if (limitTasks) {
        if (selectedTaskTypes.length === 0 && guaranteedTypes_payload.length === 0) {
          setError(
            "Please select at least one task type when limiting task types."
          );
          setGenerating(false);
          return;
        }
        // Auto-merge guaranteed types into the limit pool so there's no contradiction
        const mergedTypes = Array.from(new Set([...selectedTaskTypes, ...guaranteedTypes_payload]));
        // Ensure we have at least as many slots as merged types so none get silently dropped
        estimatedTaskCount = Math.max(estimatedTaskCount, mergedTypes.length);
        requiredTaskTypes = mergedTypes;
      }

      if (guaranteedTypes_payload.length > 0) {
        // Make sure we have enough slots for guaranteed types
        estimatedTaskCount = Math.max(estimatedTaskCount, guaranteedTypes_payload.length);
      }

      // Append task-specific constraints so the backend AI prompt reliably returns the required fields.
      const selectedOrRequiredTypes = Array.from(
        new Set([...(selectedTaskTypes || []), ...(requiredTaskTypes || []), ...guaranteedTypes_payload])
      );

      const constraintsToAppend = selectedOrRequiredTypes
        .map((t) => TASK_GEN_CONSTRAINTS[t])
        .filter(Boolean)
        .join("\n\n");

      const specialConsiderations = [baseSpecialConsiderations, constraintsToAppend]
        .filter((s) => (s || "").trim().length)
        .join("\n\n");

      const curriculumLenses =
        (profile && (profile.curriculumLenses || profile.perspectives)) || [];

      const payload = {
        gradeLevel: form.gradeLevel,
        subject: form.subject,
        difficulty: form.difficulty,
        learningGoal: form.learningGoal,

        uniqueTaskTypes: (isPartyMode || isEventMode) ? true : !!limitTasks,
        allowMovementTasks: true,
        maxMovementRatio: isPartyMode ? 0.30 : isEventMode ? 0.10 : 0.10,

        topicTitle: form.name.trim(),
        topicDescription: specialConsiderations,
        presenterProfile: { curriculumLenses },

        aiWordBank,

        totalDurationMinutes,
        numberOfTasks: limitTasks ? estimatedTaskCount : undefined,
        count: limitTasks ? estimatedTaskCount : undefined,
        taskTypePool: (limitTasks || isPartyMode || isEventMode) ? requiredTaskTypes : undefined,
        requiredTaskTypes: (limitTasks || isPartyMode || isEventMode) ? requiredTaskTypes : undefined,
        guaranteedTaskTypes: guaranteedTypes_payload.length ? guaranteedTypes_payload : undefined,

        tasksetName: form.name || undefined,
        roomLocation: form.roomLocation || "Classroom",
        locationCode: form.roomLocation || "Classroom",

        isFixedStationTaskset: form.isFixedStation || cleanedDisplays.length > 0,
        displays: cleanedDisplays.length ? cleanedDisplays : undefined,

        multiRoomScavenger: form.isMultiRoomScavenger,
        multiRoomRooms,
      };

      // Use streaming fetch so we can show per-task progress
      setGenProgress({ done: 0, total: 0, lastType: "" });

      const res = await apiFetch("/api/ai/tasksets", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
      });

      if (!res.ok) {
        // Non-2xx before stream started — read as JSON for error message
        let errMsg = `Request failed (${res.status})`;
        try {
          const errJson = await res.json();
          errMsg = errJson?.error || errMsg;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      // Parse SSE stream line by line
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalData = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE lines: "data: {...}\n\n"
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? ""; // keep incomplete chunk

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith("data:")) continue;
          try {
            const evt = JSON.parse(line.slice(5).trim());
            if (evt.type === "start") {
              setGenProgress({ done: 0, total: evt.total, lastType: "", phase: "generating", phaseMessage: "Generating tasks with AI…" });
            } else if (evt.type === "phase") {
              setGenProgress((prev) => ({ ...prev, phase: evt.phase, phaseMessage: evt.message || "" }));
            } else if (evt.type === "progress") {
              setGenProgress({ done: evt.done, total: evt.total, lastType: evt.taskType || "", phase: "finalizing", phaseMessage: "" });
            } else if (evt.type === "complete") {
              finalData = evt;
            } else if (evt.type === "error") {
              throw new Error(evt.error || "Generation failed");
            }
          } catch (parseErr) {
            // Only skip genuine JSON parse errors; rethrow actual generation errors
            if (parseErr instanceof SyntaxError) {
              // malformed SSE line — skip it
            } else {
              throw parseErr;
            }
          }
        }
      }

      if (!finalData) throw new Error("No result received from server.");

      setError("");
      setResult(finalData);

      // Store as the active taskset so the Presenter Console shows the correct title
      const ts = finalData?.taskset || finalData;
      const tsId = finalData?.tasksetId || ts?._id;
      if (tsId) {
        const meta = {
          _id: tsId,
          name: ts?.name || ts?.title || form.name || "Task Set",
          numTasks: Array.isArray(ts?.tasks) ? ts.tasks.length : 0,
        };
        localStorage.setItem("curriculateActiveTasksetId", String(tsId));
        localStorage.setItem("curriculateActiveTasksetMeta", JSON.stringify(meta));
      }
    } catch (err) {
      console.error("AI Taskset generation error:", err);
      setError(err?.message || "Something went wrong while generating the task set.");
    } finally {
      setGenerating(false);
      setGenProgress({ done: 0, total: 0, lastType: "" });
    }
  };

  const ALL_CATEGORIES = Array.from(
    new Set(
      Object.values(TASK_TYPE_META)
        .map((m) => String(m?.category || "other").toLowerCase())
        .filter(Boolean)
    )
  ).sort();

  const filteredEligibleTypes = GENERATOR_ELIGIBLE_TYPES.filter((type) => {
    const meta = TASK_TYPE_META[type] || {};
    const cat = String(meta.category || "other").toLowerCase();
    if (taskTypeCategory !== "all" && cat !== taskTypeCategory) return false;
    if (onlyIntraTeam && meta.intraTeamEnabled !== true) return false;
    if (onlyInterTeam && meta.interTeamEnabled !== true) return false;
    return true;
  });

  const toggleAllFiltered = () => {
    setSelectedTaskTypes((prev) => {
      const set = new Set(prev);
      const all = filteredEligibleTypes;
      const everySelected = all.length > 0 && all.every((t) => set.has(t));
      if (everySelected) {
        all.forEach((t) => set.delete(t));
      } else {
        all.forEach((t) => set.add(t));
      }
      return Array.from(set);
    });
  };

  const typeIcon = (type) => {
    const t = String(type || "");
    if (t === (TASK_TYPES.ECHO_CHAIN || "echo-chain")) return "🔁";
    if (t === (TASK_TYPES.NARRATION_SYNTHESIZE || "narration-synthesize")) return "🎙️";
    if (t === (TASK_TYPES.SCRIPT_PLAY || "script-play")) return "🎭";
    if (t === TASK_TYPES.HANGMAN_DUEL) return "🧩";
    if (t === TASK_TYPES.TRUE_FALSE_TICTACTOE) return "❎⭕️";
    if (t === TASK_TYPES.PRONUNCIATION) return "🗣️";
    if (t === TASK_TYPES.SPEECH_RECOGNITION) return "🎤";
    if (t === TASK_TYPES.WORD_WEAVER_DUEL) return "🧶";
    if (t === TASK_TYPES.JEOPARDY) return "⚡";
    if (t === TASK_TYPES.FLASHCARDS) return "🗂️";
    if (t === TASK_TYPES.FLASHCARDS_RACE) return "🏁";
    if (t === TASK_TYPES.HIDENSEEK) return "🕵️";
    if (t === TASK_TYPES.PHOTO) return "📸";
    if (t === TASK_TYPES.PHOTO_JOURNAL) return "🖼️📝";
    if (t === TASK_TYPES.MAKE_AND_SNAP) return "🛠️📸";
    if (t === TASK_TYPES.FAKE_OUT) return "🃏";
    if (t === TASK_TYPES.DIFF_DETECTIVE) return "🔎";
    if (t === TASK_TYPES.VENNSORT) return "⭕️";
    if (t === TASK_TYPES.SPEED_DRAW) return "✏️⚡";
    if (t === TASK_TYPES.DRAW_MIME) return "🎨🤐";
    if (t === TASK_TYPES.MYSTERY_CLUES) return "🧠🃏";
    if (t === TASK_TYPES.PHYSICAL_MYSTERY_CLUES) return "🗺️🕵️";
    return "✨";
  };

  const renderTaskTypeBadge = (type) => {
    const meta = TASK_TYPE_META[type] || {};
    const label = meta.label || type;
    const category = meta.category || "other";
    const selected = selectedTaskTypes.includes(type);
    const desc = String(meta.description || "").trim();
    const shortDesc = desc ? desc.split("\n")[0].replace(/^[-•]\s*/, "").trim() : "";

    return (
      <button
        key={type}
        type="button"
        title={desc || label}
        onClick={() => toggleTaskType(type)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          borderRadius: 14,
          border: selected ? "2px solid #2563eb" : "1px solid #d1d5db",
          background: selected ? "#eff6ff" : "#ffffff",
          cursor: "pointer",
          textAlign: "left",
          minWidth: 260,
        }}
      >
        <span style={{ fontSize: "0.95rem" }}>{typeIcon(type)}</span>

        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontWeight: 700 }}>{label}</span>
          {shortDesc && (
            <span style={{ fontSize: "0.72rem", color: "#6b7280", maxWidth: 340 }}>
              {shortDesc}
            </span>
          )}
        </span>

        <span
          style={{
            fontSize: "0.7rem",
            color: "#6b7280",
            textTransform: "capitalize",
            marginLeft: 2,
            whiteSpace: "nowrap",
          }}
        >
          · {category}
        </span>

        {(meta.scoringMode ? String(meta.scoringMode).toLowerCase() : "") === "none" && (
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 800,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid rgba(234,88,12,0.35)",
              background: "rgba(234,88,12,0.10)",
              color: "#9a3412",
              marginLeft: 2,
              whiteSpace: "nowrap",
            }}
          >
            No-score
          </span>
        )}

        {meta.intraTeamEnabled === true && (
          <span
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid rgba(16,185,129,0.35)",
              background: "rgba(16,185,129,0.10)",
              color: "#065f46",
              marginLeft: 2,
              whiteSpace: "nowrap",
            }}
          >
            Intra-team
          </span>
        )}

        {meta.interTeamEnabled === true && (
          <span
            style={{
              fontSize: "0.68rem",
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              border: "1px solid rgba(59,130,246,0.35)",
              background: "rgba(59,130,246,0.10)",
              color: "#1d4ed8",
              marginLeft: 2,
              whiteSpace: "nowrap",
            }}
          >
            Inter-team
          </span>
        )}
      </button>
    );
  };

  const renderCoveragePanel = () => {
    if (!coverage) return null;

    const isPerfect = coverage.missingCount === 0 && coverage.requestedCount > 0;

    return (
      <div
        style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: isPerfect ? "#ecfdf5" : "#fff7ed",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 2 }}>Coverage Report</div>
            <div style={{ fontSize: "0.85rem", color: "#374151" }}>
              Covered <strong>{coverage.coveredCount}</strong> / {coverage.requestedCount}
              {coverage.requestedCount ? (
                <span style={{ marginLeft: 8, fontWeight: 700 }}>
                  ({Math.round((coverage.coveredCount / coverage.requestedCount) * 100)}%)
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {coverage.missingCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyToClipboard(joinLines(coverage.missing));
                  setCopiedTag(ok ? "missing" : "copyfail");
                  setTimeout(() => setCopiedTag(""), 1400);
                }}
                style={{
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: "0.85rem",
                  border: "1px solid #fb923c",
                  background: "#fff7ed",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {copiedTag === "missing" ? "Copied!" : "Copy missing"}
              </button>
            )}

            {coverage.missingCount >= 10 && (
              <button
                type="button"
                onClick={() => {
                  // Prefill generator with missing terms for a Part 2 set
                  navigate("/teacher/ai-tasksets", { state: { prefillWordList: coverage.missing } });
                }}
                style={{
                  borderRadius: 999,
                  padding: "6px 14px",
                  fontSize: "0.85rem",
                  border: "1px solid #ea580c",
                  background: "#ea580c",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                ➕ Generate Part 2 ({coverage.missingCount} terms)
              </button>
            )}
          </div>
        </div>

        {coverage.missingCount > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 800, marginBottom: 6, color: "#9a3412" }}>
              Missing concepts ({coverage.missingCount})
            </div>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {coverage.missing.slice(0, 40).map((t) => (
                <span
                  key={t}
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(234,88,12,0.35)",
                    background: "rgba(234,88,12,0.08)",
                    color: "#9a3412",
                    fontSize: "0.8rem",
                    fontWeight: 700,
                  }}
                >
                  {t}
                </span>
              ))}
              {coverage.missing.length > 40 && (
                <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  +{coverage.missing.length - 40} more…
                </span>
              )}
            </div>
          </div>
        )}

        {allocation && allocation.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 800, marginBottom: 6 }}>
              Allocation plan (preview)
            </div>
            <div style={{ fontSize: "0.82rem", color: "#374151", marginBottom: 8 }}>
              This shows which terms were assigned to which generated task (if your backend stored it).
            </div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                overflow: "hidden",
                background: "#ffffff",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 220px 1fr",
                  gap: 0,
                  padding: "8px 10px",
                  background: "#f9fafb",
                  fontSize: "0.78rem",
                  fontWeight: 800,
                  color: "#374151",
                }}
              >
                <div>#</div>
                <div>Task type</div>
                <div>Assigned concepts</div>
              </div>

              {allocation.slice(0, 12).map((row) => (
                <div
                  key={`${row.index}-${row.taskType}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 220px 1fr",
                    gap: 0,
                    padding: "8px 10px",
                    borderTop: "1px solid #f3f4f6",
                    fontSize: "0.8rem",
                    color: "#111827",
                  }}
                >
                  <div style={{ color: "#6b7280", fontWeight: 800 }}>{row.index + 1}</div>
                  <div style={{ fontWeight: 800 }}>
                    {(() => {
                      const meta = TASK_TYPE_META[row.taskType];
                      const label = meta?.label || row.taskType;
                      const cat = meta?.category || "other";
                      const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS["other"];
                      return (
                        <span style={{
                          display: "inline-block",
                          padding: "1px 8px",
                          borderRadius: 10,
                          background: colors.bg,
                          color: colors.fg,
                          border: `1px solid ${colors.border}`,
                          fontSize: "0.78rem",
                        }}>
                          {label}
                        </span>
                      );
                    })()}
                  </div>
                  <div style={{ color: "#374151" }}>
                    {row.terms && row.terms.length ? row.terms.join(", ") : <span style={{ color: "#9ca3af" }}>—</span>}
                  </div>
                </div>
              ))}

              {allocation.length > 12 && (
                <div style={{ padding: "8px 10px", borderTop: "1px solid #f3f4f6", fontSize: "0.8rem", color: "#6b7280" }}>
                  Showing first 12 rows.
                </div>
              )}
            </div>
          </div>
        )}

        {coverage.requestedCount === 0 && (
          <div style={{ marginTop: 10, fontSize: "0.85rem", color: "#6b7280" }}>
            (No requested concepts found to check coverage.)
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>AI Task Set Generator</h1>
      <p style={{ marginTop: 0, color: "#4b5563", fontSize: "0.95rem" }}>
        Give the AI your topic, vocabulary list, and any special considerations.
        It will build a station-based task set that stays on that exact content.
      </p>

      {error && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 10px",
            borderRadius: 8,
            background: "#fef2f2",
            color: "#b91c1c",
            fontSize: "0.85rem",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* PARTY MODE TOGGLE */}
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 14,
            border: isPartyMode ? "2px solid #db2777" : "1px solid #e5e7eb",
            background: isPartyMode
              ? "linear-gradient(135deg, #fdf2f8 0%, #faf5ff 100%)"
              : "#f9fafb",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "0.95rem",
            }}
          >
            <input
              type="checkbox"
              checked={isPartyMode}
              onChange={(e) => {
                const on = e.target.checked;
                setIsPartyMode(on);
                if (on) {
                  setIsEventMode(false);
                  handleChange("learningGoal", "ENRICHMENT");
                  handleChange("difficulty", "EASY");
                  handleChange("roomLocation", "Party venue");
                  if (!form.name) handleChange("name", "Birthday Party Games");
                }
              }}
              style={{ width: 18, height: 18 }}
            />
            <span>🎉 Party Mode</span>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "#6b7280",
                marginLeft: 4,
              }}
            >
              — generates fun, competitive games for birthday parties and events
            </span>
          </label>

          {isPartyMode && (
            <div style={{ marginTop: 14 }}>
              {/* Theme selector */}
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  marginBottom: 8,
                  fontWeight: 600,
                }}
              >
                Pick a theme:
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {PARTY_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setPartyTheme(t.id);
                      if (t.id !== "custom" && !form.name.includes("Party")) {
                        handleChange("name", `${t.label} Birthday Party`);
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 999,
                      border:
                        partyTheme === t.id
                          ? "2px solid #db2777"
                          : "1px solid #d1d5db",
                      background:
                        partyTheme === t.id ? "#fdf2f8" : "#ffffff",
                      cursor: "pointer",
                      fontWeight: partyTheme === t.id ? 700 : 500,
                      fontSize: "0.88rem",
                      transition: "all 0.15s",
                    }}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Theme vocab preview */}
              {partyTheme && partyTheme !== "custom" && (
                <div style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      color: "#6b7280",
                      marginBottom: 6,
                    }}
                  >
                    Pre-loaded words for this theme:
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(
                      PARTY_THEMES.find((t) => t.id === partyTheme)?.vocab || []
                    ).map((word) => (
                      <span
                        key={word}
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: 999,
                          border: "1px solid #e5e7eb",
                          background: "#fff",
                          fontSize: "0.8rem",
                          fontWeight: 500,
                          color: "#374151",
                        }}
                      >
                        {word}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom words input */}
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                Add personal/custom words{" "}
                <span style={{ fontWeight: 400, color: "#6b7280" }}>
                  (birthday kid&apos;s name, favorite things, inside jokes...)
                </span>
              </label>
              <textarea
                value={partyCustomWords}
                onChange={(e) => setPartyCustomWords(e.target.value)}
                rows={3}
                placeholder={
                  "e.g.\nEmma\nUnicorn cake\nMr. Whiskers the cat\nCanada trip"
                }
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                  resize: "vertical",
                }}
              />
              <p
                style={{
                  marginTop: 4,
                  fontSize: "0.78rem",
                  color: "#6b7280",
                }}
              >
                These get mixed into the games for a personal touch. One per
                line or separated by commas.
              </p>
            </div>
          )}
        </div>

        {/* EVENT MODE TOGGLE */}
        <div
          style={{
            marginBottom: 16,
            padding: "12px 16px",
            borderRadius: 14,
            border: isEventMode ? "2px solid #4f46e5" : "1px solid #e5e7eb",
            background: isEventMode
              ? "linear-gradient(135deg, #eef2ff 0%, #f0f9ff 100%)"
              : "#f9fafb",
          }}
        >
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: "0.95rem",
            }}
          >
            <input
              type="checkbox"
              checked={isEventMode}
              onChange={(e) => {
                const on = e.target.checked;
                setIsEventMode(on);
                if (on) {
                  setIsPartyMode(false);
                  handleChange("learningGoal", "ENRICHMENT");
                  handleChange("difficulty", "MEDIUM");
                  handleChange("roomLocation", "Event venue");
                  if (!form.name) handleChange("name", "Corporate Event Games");
                }
              }}
              style={{ width: 18, height: 18 }}
            />
            <span>🏢 Event Mode</span>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "#6b7280",
                marginLeft: 4,
              }}
            >
              — for conferences, team building, training, and corporate events
            </span>
          </label>

          {isEventMode && (
            <div style={{ marginTop: 14 }}>
              {/* Industry axis */}
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6 }}>
                Industry:
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {EVENT_INDUSTRY_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setEventIndustry(t.id);
                      if (!form.name.includes("Event") && !form.name.includes("Kickoff")) {
                        handleChange("name", `${t.label} Team Event`);
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: eventIndustry === t.id ? "2px solid #4f46e5" : "1px solid #d1d5db",
                      background: eventIndustry === t.id ? "#eef2ff" : "#fff",
                      cursor: "pointer",
                      fontWeight: eventIndustry === t.id ? 700 : 500,
                      fontSize: "0.84rem",
                      transition: "all 0.15s",
                    }}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Event type axis */}
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 6 }}>
                Event type:
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {EVENT_TYPE_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setEventType(t.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "6px 12px",
                      borderRadius: 999,
                      border: eventType === t.id ? "2px solid #4f46e5" : "1px solid #d1d5db",
                      background: eventType === t.id ? "#eef2ff" : "#fff",
                      cursor: "pointer",
                      fontWeight: eventType === t.id ? 700 : 500,
                      fontSize: "0.84rem",
                      transition: "all 0.15s",
                    }}
                  >
                    <span>{t.emoji}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

              {/* Vocab preview */}
              {(eventIndustry || eventType) && (
                <div style={{ marginBottom: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {eventIndustry && (() => {
                    const ind = EVENT_INDUSTRY_THEMES.find((t) => t.id === eventIndustry);
                    if (!ind) return null;
                    return (
                      <div style={{ flex: "1 1 280px" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>
                          {ind.emoji} {ind.label} vocab:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {ind.vocab.map((w) => (
                            <span key={w} style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", fontSize: "0.76rem", color: "#374151" }}>{w}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {eventType && (() => {
                    const evt = EVENT_TYPE_THEMES.find((t) => t.id === eventType);
                    if (!evt) return null;
                    return (
                      <div style={{ flex: "1 1 280px" }}>
                        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#6b7280", marginBottom: 4 }}>
                          {evt.emoji} {evt.label} vocab:
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {evt.vocab.map((w) => (
                            <span key={w} style={{ padding: "3px 8px", borderRadius: 999, border: "1px solid #e5e7eb", background: "#fff", fontSize: "0.76rem", color: "#374151" }}>{w}</span>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Custom content */}
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4 }}>
                Add custom content{" "}
                <span style={{ fontWeight: 400, color: "#6b7280" }}>
                  (keynote takeaways, company jargon, team inside jokes...)
                </span>
              </label>
              <textarea
                value={eventCustomWords}
                onChange={(e) => setEventCustomWords(e.target.value)}
                rows={3}
                placeholder={"e.g.\nour north star metric\nProject Phoenix\n\"move fast and break things\"\nthe Jenkins incident"}
                style={{
                  width: "100%",
                  borderRadius: 8,
                  border: "1px solid #d1d5db",
                  padding: 8,
                  fontSize: "0.9rem",
                  resize: "vertical",
                }}
              />
              <p style={{ marginTop: 4, fontSize: "0.78rem", color: "#6b7280" }}>
                These get woven into the games alongside industry and event-type vocabulary. One per line or comma-separated.
              </p>
            </div>
          )}
        </div>

        {/* TOP ROW: title + base room */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.5fr)",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Task set title (topic)
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Hist7 Ch3: The Seven Years' War and the Conquest of New France"
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Default room / location
            </label>
            <input
              type="text"
              value={form.roomLocation}
              onChange={(e) => handleChange("roomLocation", e.target.value)}
              placeholder="Classroom, Gym, Hallway..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />

            {/* Multi-room switch */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 6,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={form.isMultiRoomScavenger}
                onChange={(e) => handleChange("isMultiRoomScavenger", e.target.checked)}
              />
              <span>Multi-room scavenger hunt</span>
            </label>
            <p style={{ marginTop: 2, fontSize: "0.75rem", color: "#6b7280" }}>
              Leave unchecked if the whole activity stays in one room. When checked,
              you can specify multiple locations (e.g., Classroom, Hallway, Library)
              for a multi-room scavenger hunt.
            </p>
          </div>
        </div>

        {/* SECOND ROW: grade, subject, difficulty, goal */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Grade level
            </label>
            <input
              type="text"
              value={form.gradeLevel}
              onChange={(e) => handleChange("gradeLevel", e.target.value)}
              placeholder="7, 8, 7/8 split..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Subject
            </label>
            <input
              type="text"
              value={form.subject}
              onChange={(e) => handleChange("subject", e.target.value)}
              placeholder="History, Geography, Bible..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Difficulty
            </label>
            <select
              value={form.difficulty}
              onChange={(e) => handleChange("difficulty", e.target.value)}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d.charAt(0) + d.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Learning goal
            </label>
            <select
              value={form.learningGoal}
              onChange={(e) => handleChange("learningGoal", e.target.value)}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            >
              {LEARNING_GOALS.map((g) => (
                <option key={g} value={g}>
                  {g.charAt(0) + g.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* TIME + CONSIDERATIONS + VOCAB + MULTI-ROOM ROOM LIST */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 1.3fr)",
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Approx lesson duration (minutes)
            </label>
            <input
              type="number"
              min={5}
              max={120}
              value={form.durationMinutes}
              onChange={(e) => handleChange("durationMinutes", Number(e.target.value))}
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
              }}
            />

            <div style={{ height: 8 }} />

            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Special considerations (optional)
            </label>
            <textarea
              value={form.topicDescription}
              onChange={(e) => handleChange("topicDescription", e.target.value)}
              rows={5}
              placeholder="e.g., 'Reviewing for a test', 'Keep it low-noise', 'They just did a quiz—keep it lighter'..."
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
                resize: "vertical",
              }}
            />

            {form.isMultiRoomScavenger && (
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
                  Rooms / locations for this scavenger hunt
                </label>
                <textarea
                  value={multiRoomText}
                  onChange={(e) => setMultiRoomText(e.target.value)}
                  rows={4}
                  placeholder={"One per line or separated by commas, e.g.\nClassroom\nHallway\nLibrary\nGym"}
                  style={{
                    width: "100%",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    padding: 8,
                    fontSize: "0.9rem",
                    resize: "vertical",
                  }}
                />
                <p style={{ marginTop: 4, fontSize: "0.8rem", color: "#6b7280" }}>
                  These rooms are options for where stations might be located.
                </p>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>
              Vocabulary / key terms <span style={{ color: "#b91c1c" }}>*</span>
            </label>
            <textarea
              value={wordListText}
              onChange={(e) => setWordListText(e.target.value)}
              rows={8}
              placeholder={
                "One term per line or separated by commas, e.g.\nLouisbourg\nPlains of Abraham\nTreaty of Paris\nSeven Years' War"
              }
              style={{
                width: "100%",
                borderRadius: 8,
                border: "1px solid #d1d5db",
                padding: 8,
                fontSize: "0.9rem",
                resize: "vertical",
              }}
            />
            <p style={{ marginTop: 4, fontSize: "0.8rem", color: "#6b7280" }}>
              These words define the topic. After generation, you'll see which concepts were covered vs missing.
            </p>
          </div>
        </div>

        {/* LIMIT TASK TYPES */}
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={limitTasks} onChange={(e) => setLimitTasks(e.target.checked)} />
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Limit which task types to include
            </span>
          </label>

          {limitTasks && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: "0.85rem", color: "#374151" }}>Filter:</span>
                  <select
                    value={taskTypeCategory}
                    onChange={(e) => setTaskTypeCategory(e.target.value)}
                    style={{
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      padding: "6px 10px",
                      fontSize: "0.85rem",
                      background: "#ffffff",
                    }}
                  >
                    <option value="all">All categories</option>
                    {ALL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "#374151", cursor: "pointer" }}>
                  <input type="checkbox" checked={onlyIntraTeam} onChange={(e) => setOnlyIntraTeam(e.target.checked)} />
                  Only intra-team
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "#374151", cursor: "pointer" }}>
                  <input type="checkbox" checked={onlyInterTeam} onChange={(e) => setOnlyInterTeam(e.target.checked)} />
                  Only inter-team
                </label>

                <button
                  type="button"
                  onClick={toggleAllFiltered}
                  style={{
                    borderRadius: 999,
                    padding: "6px 12px",
                    fontSize: "0.85rem",
                    border: "1px solid #d1d5db",
                    background: "#ffffff",
                    cursor: "pointer",
                  }}
                >
                  Toggle all shown
                </button>

                <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  Showing {filteredEligibleTypes.length} types
                </span>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {filteredEligibleTypes.map(renderTaskTypeBadge)}
              </div>
            </div>
          )}
        </div>

        {/* GUARANTEE TASK TYPES */}
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: guaranteeTypes ? "1px solid #d1fae5" : "1px solid #e5e7eb",
            background: guaranteeTypes ? "#f0fdf4" : "#f9fafb",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={guaranteeTypes} onChange={(e) => setGuaranteeTypes(e.target.checked)} />
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Guarantee these task types appear
            </span>
          </label>
          <p style={{ fontSize: "0.8rem", color: "#6b7280", marginBottom: 8 }}>
            Selected types will definitely be included. The rest of the set fills with a normal diverse mix.
          </p>

          {guaranteeTypes && (
            <div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <span style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                  {guaranteedTaskTypes.length} type{guaranteedTaskTypes.length !== 1 ? "s" : ""} guaranteed
                </span>
                {guaranteedTaskTypes.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setGuaranteedTaskTypes([])}
                    style={{
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: "0.8rem",
                      border: "1px solid #d1d5db",
                      background: "#ffffff",
                      cursor: "pointer",
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {filteredEligibleTypes.map((type) => {
                  const meta = TASK_TYPE_META[type] || {};
                  const label = meta.label || type;
                  const category = meta.category || "other";
                  const selected = guaranteedTaskTypes.includes(type);
                  const desc = String(meta.description || "").trim();
                  const shortDesc = desc ? desc.split("\n")[0].replace(/^[-•]\s*/, "").trim() : "";

                  return (
                    <button
                      key={type}
                      type="button"
                      title={desc || label}
                      onClick={() => toggleGuaranteedType(type)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: selected ? "2px solid #059669" : "1px solid #d1d5db",
                        background: selected ? "#ecfdf5" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "left",
                        minWidth: 260,
                      }}
                    >
                      <span style={{ fontSize: "0.95rem" }}>{typeIcon(type)}</span>
                      <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
                        <span style={{ fontWeight: 700 }}>{label}</span>
                        {shortDesc && (
                          <span style={{ fontSize: "0.72rem", color: "#6b7280", maxWidth: 340 }}>
                            {shortDesc}
                          </span>
                        )}
                      </span>
                      <span style={{ fontSize: "0.7rem", color: "#6b7280", textTransform: "capitalize", marginLeft: 2, whiteSpace: "nowrap" }}>
                        · {category}
                      </span>
                      {selected && (
                        <span style={{ fontSize: "0.7rem", fontWeight: 800, padding: "2px 8px", borderRadius: 999, border: "1px solid rgba(5,150,105,0.35)", background: "rgba(5,150,105,0.10)", color: "#065f46", marginLeft: "auto", whiteSpace: "nowrap" }}>
                          ✓ Guaranteed
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* FIXED-STATION / DISPLAYS */}
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.isFixedStation}
              onChange={(e) => handleChange("isFixedStation", e.target.checked)}
            />
            <span style={{ fontSize: "0.9rem", fontWeight: 500 }}>
              Attach this task set to specific displays / stations
            </span>
          </label>

          {form.isFixedStation && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={addDisplay}
                style={{
                  borderRadius: 999,
                  padding: "4px 10px",
                  fontSize: "0.8rem",
                  border: "1px solid #d1d5db",
                  background: "#ffffff",
                  cursor: "pointer",
                  marginBottom: 8,
                }}
              >
                + Add display
              </button>

              {displays.map((d, index) => (
                <div
                  key={d.key}
                  style={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    background: "#ffffff",
                    padding: 8,
                    marginBottom: 8,
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
                    <div style={{ fontSize: "0.85rem", fontWeight: 500 }}>
                      Display {index + 1}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDisplay(index)}
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#b91c1c",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                      gap: 6,
                    }}
                  >
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                        Name
                      </label>
                      <input
                        type="text"
                        value={d.name || ""}
                        onChange={(e) => updateDisplay(index, "name", e.target.value)}
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
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                        Station color
                      </label>
                      <input
                        type="text"
                        value={d.stationColor || ""}
                        onChange={(e) => updateDisplay(index, "stationColor", e.target.value)}
                        placeholder="red, blue..."
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
                      <label style={{ display: "block", fontSize: "0.75rem", marginBottom: 2 }}>
                        Notes for you
                      </label>
                      <input
                        type="text"
                        value={d.notesForTeacher || ""}
                        onChange={(e) => updateDisplay(index, "notesForTeacher", e.target.value)}
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
              ))}
            </div>
          )}
        </div>

        {/* ACTION BUTTONS */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => navigate("/tasksets")}
            style={{
              borderRadius: 999,
              padding: "6px 12px",
              fontSize: "0.85rem",
              border: "1px solid #d1d5db",
              background: "#ffffff",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={generating}
            style={{
              borderRadius: 999,
              padding: "6px 16px",
              fontSize: "0.9rem",
              border: "1px solid #2563eb",
              background: generating ? "#93c5fd" : "#2563eb",
              color: "#ffffff",
              cursor: generating ? "wait" : "pointer",
            }}
          >
            {generating ? "Generating…" : "Generate task set"}
          </button>
        </div>

        {/* Generation progress */}
        {generating && genProgress.total > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "#6b7280", marginBottom: 4 }}>
              <span>
                {genProgress.phase === "generating"
                  ? (genProgress.phaseMessage || "Generating tasks with AI…")
                  : genProgress.phase === "coverage"
                  ? (genProgress.phaseMessage || "Checking vocabulary coverage…")
                  : genProgress.done < genProgress.total
                  ? `Validating task ${genProgress.done + 1} of ${genProgress.total}…`
                  : `Finishing up…`}
              </span>
              <span>{genProgress.done} / {genProgress.total}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: "#e5e7eb", overflow: "hidden", position: "relative" }}>
              {genProgress.phase === "generating" || genProgress.phase === "coverage" ? (
                /* Indeterminate animated bar while waiting for AI */
                <div
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #2563eb 0%, #60a5fa 50%, #2563eb 100%)",
                    backgroundSize: "200% 100%",
                    width: "40%",
                    animation: "indeterminate 1.5s ease-in-out infinite",
                  }}
                />
              ) : (
                <div
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "#2563eb",
                    width: `${Math.round((genProgress.done / genProgress.total) * 100)}%`,
                    transition: "width 0.4s ease",
                  }}
                />
              )}
              <style>{`@keyframes indeterminate { 0% { margin-left: 0%; } 50% { margin-left: 60%; } 100% { margin-left: 0%; } }`}</style>
            </div>
            {genProgress.lastType && (
              <div style={{ fontSize: "0.75rem", color: "#9ca3af", marginTop: 3 }}>
                Last: {genProgress.lastType.replace(/-/g, " ")}
              </div>
            )}
          </div>
        )}

        {generating && genProgress.total === 0 && (
          <div style={{ marginTop: 14, fontSize: "0.8rem", color: "#6b7280" }}>
            Sending request to AI…
          </div>
        )}
      </form>

      {/* RESULT SUMMARY */}
      {result && result.taskset && (
        <div
          style={{
            marginTop: 20,
            padding: 12,
            borderRadius: 10,
            border: "1px solid #e5e7eb",
            background: "#ecfdf5",
            fontSize: "0.9rem",
          }}
        >
          <div style={{ marginBottom: 6 }}>
            ✅ Task set <strong>{result.taskset.name}</strong> created.
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => navigate(`/tasksets/${result.tasksetId || result.taskset._id}`)}
              style={{
                borderRadius: 999,
                padding: "6px 12px",
                fontSize: "0.85rem",
                border: "1px solid #16a34a",
                background: "#16a34a",
                color: "#ffffff",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Open task set
            </button>

            {coverage?.missingCount > 0 && (
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyToClipboard(joinLines(coverage.missing));
                  setCopiedTag(ok ? "missing2" : "copyfail2");
                  setTimeout(() => setCopiedTag(""), 1400);
                }}
                style={{
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: "0.85rem",
                  border: "1px solid #fb923c",
                  background: "#fff7ed",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                {copiedTag === "missing2" ? "Copied!" : `Copy ${coverage.missingCount} missing`}
              </button>
            )}
            {coverage?.missingCount >= 10 && (
              <button
                type="button"
                onClick={() => {
                  navigate("/teacher/ai-tasksets", { state: { prefillWordList: coverage.missing } });
                }}
                style={{
                  borderRadius: 999,
                  padding: "6px 14px",
                  fontSize: "0.85rem",
                  border: "1px solid #ea580c",
                  background: "#ea580c",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                ➕ Generate Part 2
              </button>
            )}
          </div>

          {/* NEW: coverage report */}
          {renderCoveragePanel()}
        </div>
      )}
    </div>
  );
}
