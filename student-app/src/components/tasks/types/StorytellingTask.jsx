// student-app/src/components/tasks/types/StorytellingTask.jsx
import React, { useState, useEffect, useRef } from "react";
import { API_BASE_URL } from "../../../config.js";

const TRAIT_OPTIONS = [
  "Brave", "Clumsy", "Hilarious", "Shy", "Genius", "Dramatic",
  "Sneaky", "Bossy", "Lazy", "Rebellious", "Kind-hearted", "Mysterious",
  "Overconfident", "Forgetful", "Competitive", "Curious", "Nervous", "Legendary",
];

const ROLE_OPTIONS = [
  // Kids in a family
  "Oldest sibling", "Youngest sibling", "Middle child", "The cousin",
  "The neighbor's kid", "Exchange student",
  // Community roles
  "Village baker", "Street performer", "Traveling merchant",
  "Apprentice blacksmith", "Ship captain", "Market pickpocket",
  "Town crier", "Wandering scholar", "Stable hand", "Herbalist",
  "Court jester", "Royal messenger",
];

const NATIONALITY_OPTIONS = [
  "British", "French", "Spanish", "Italian", "German", "Greek",
  "Egyptian", "Chinese", "Japanese", "Indian", "Russian", "Ottoman",
  "Roman", "Viking", "Aztec", "Indigenous", "American", "Irish",
  "Dutch", "Portuguese", "Korean", "Persian", "Mongol", "African",
];

export default function StorytellingTask({
  task,
  onSubmit,
  disabled,
  answered,
  onAnswerChange,
  answerDraft,
  memberNames = [],
}) {
  const isDisabled = disabled || answered;

  const cfg = task?.config || {};
  const setting = cfg.setting || "a mysterious land";
  const topicContext = cfg.topicContext || "";
  const genre = cfg.genre || "adventure";
  const vocabWords = Array.isArray(cfg.vocabWords) ? cfg.vocabWords : [];
  // Show nationality picker for history/literature subjects
  const showNationality = cfg.showNationality !== false;

  const gradeLevel = parseInt(
    task?.gradeLevel || task?.config?.gradeLevel || task?.settings?.gradeLevel || "7",
    10
  );

  // Phase: "build" → "generating" → "reading"
  const [phase, setPhase] = useState(answerDraft?.story ? "reading" : "build");
  const [generatedStory, setGeneratedStory] = useState(answerDraft?.story || "");
  const [storyTitle, setStoryTitle] = useState(answerDraft?.storyTitle || "");
  const [genError, setGenError] = useState(false);

  // Character building — one per team member (or 1 if solo)
  const playerNames = memberNames.length > 0 ? memberNames : ["Me"];
  const [characters, setCharacters] = useState(() =>
    playerNames.map((name) => ({
      name,
      trait: "",
      role: "",
      customRole: "",
      nationality: "",
      gender: "",
    }))
  );

  // Keep characters in sync if memberNames changes
  useEffect(() => {
    const names = memberNames.length > 0 ? memberNames : ["Me"];
    setCharacters((prev) => {
      if (prev.length === names.length && prev.every((c, i) => c.name === names[i])) {
        return prev;
      }
      return names.map((name, i) => prev[i] && prev[i].name === name ? prev[i] : {
        name,
        trait: "",
        role: "",
        customRole: "",
        nationality: "",
        gender: "",
      });
    });
  }, [memberNames]);

  const updateChar = (idx, field, value) => {
    setCharacters((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const allReady = characters.every(
    (c) => c.trait && (c.role || c.customRole.trim()) && c.gender && (!showNationality || c.nationality)
  );

  // Emit draft to parent
  useEffect(() => {
    if (!onAnswerChange) return;
    onAnswerChange({
      correct: false,
      characters,
      story: generatedStory,
      storyTitle,
    });
  }, [characters, generatedStory, storyTitle]);

  // 30-second auto-assign timer
  const [timeLeft, setTimeLeft] = useState(30);
  const [autoAssigning, setAutoAssigning] = useState(false);
  const timerRef = useRef(null);
  const hasStartedRef = useRef(false);

  // Start timer on first render in build phase
  useEffect(() => {
    if (phase !== "build" || isDisabled || hasStartedRef.current) return;
    hasStartedRef.current = true;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(timerRef.current);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [phase, isDisabled]);

  // When timer hits 0, auto-assign missing attributes with spin animation
  useEffect(() => {
    if (timeLeft > 0 || phase !== "build" || autoAssigning) return;
    setAutoAssigning(true);

    // Fill in any missing attributes with random spin effect
    let spinCount = 0;
    const spinInterval = setInterval(() => {
      setCharacters((prev) =>
        prev.map((c) => ({
          ...c,
          trait: c.trait || TRAIT_OPTIONS[Math.floor(Math.random() * TRAIT_OPTIONS.length)],
          role: (c.role || c.customRole.trim()) ? c.role : ROLE_OPTIONS[Math.floor(Math.random() * ROLE_OPTIONS.length)],
          nationality: (c.nationality || !showNationality) ? c.nationality : NATIONALITY_OPTIONS[Math.floor(Math.random() * NATIONALITY_OPTIONS.length)],
          gender: c.gender || (Math.random() > 0.5 ? "Male" : "Female"),
        }))
      );
      spinCount++;
      if (spinCount >= 8) {
        clearInterval(spinInterval);
        setAutoAssigning(false);
      }
    }, 100);
  }, [timeLeft, phase]);

  const basePoints = task?.points || 10;

  // Generate the story
  const handleGenerate = async () => {
    if (!allReady || isDisabled) return;
    setPhase("generating");
    setGenError(false);

    const charDescriptions = characters.map((c) => ({
      name: c.name,
      trait: c.trait,
      role: c.customRole.trim() || c.role,
      gender: c.gender,
      ...(c.nationality && { nationality: c.nationality }),
    }));

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${API_BASE_URL}/api/evaluate/story-generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          characters: charDescriptions,
          setting,
          topicContext,
          genre,
          gradeLevel,
          vocabWords,
        }),
      });
      clearTimeout(timeout);
      const data = await res.json();
      const story = data.story || "Once upon a time, something amazing happened...";
      const title = data.title || "An Untold Story";
      setGeneratedStory(story);
      setStoryTitle(title);
      setPhase("reading");

      try {
        new Audio("/sounds/yay.mp3").play().catch(() => {});
      } catch {}

      // Auto-submit for scoring
      const payload = {
        type: "storytelling",
        correct: false,
        basePoints,
        characters: charDescriptions,
        story,
        storyTitle: title,
        setting,
        genre,
      };
      onSubmit?.(payload);
    } catch {
      setGenError(true);
      // Fallback story
      const names = charDescriptions.map((c) => c.name).join(", ");
      const fallbackStory =
        `In the heart of ${setting}, our heroes ${names} found themselves on the adventure of a lifetime. ` +
        `${charDescriptions[0]?.name} (the ${charDescriptions[0]?.trait} ${charDescriptions[0]?.role}) ` +
        `was the first to notice something strange. "Does anyone else see that?" they asked, ` +
        `pointing toward the horizon. And so the journey began...\n\n` +
        `(The full AI story couldn't be generated — but your characters are ready for anything!)`;
      setGeneratedStory(fallbackStory);
      setStoryTitle("An Adventure Begins");
      setPhase("reading");

      const payload = {
        type: "storytelling",
        correct: false,
        basePoints,
        characters: charDescriptions,
        story: fallbackStory,
        storyTitle: "An Adventure Begins",
        setting,
        genre,
      };
      onSubmit?.(payload);
    }
  };

  // ── GENERATING VIEW ──
  if (phase === "generating") {
    return (
      <div style={{ padding: 4 }}>
        <div
          style={{
            textAlign: "center",
            padding: "40px 16px",
            background: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)",
            borderRadius: 16,
            border: "1px solid #fde68a",
          }}
        >
          <div
            style={{
              fontSize: 48,
              marginBottom: 12,
              animation: "storySpin 2s ease-in-out infinite",
            }}
          >
            📖
          </div>
          <div style={{ fontWeight: 800, fontSize: 18, color: "#92400e", marginBottom: 6 }}>
            Writing your story...
          </div>
          <div style={{ fontSize: 14, color: "#a16207" }}>
            The author is weaving {characters.map((c) => c.name).join(", ")} into an epic{" "}
            {genre} tale!
          </div>
          <style>{`@keyframes storySpin { 0%,100% { transform: rotate(0deg) scale(1); } 25% { transform: rotate(-5deg) scale(1.1); } 75% { transform: rotate(5deg) scale(1.05); } }`}</style>
        </div>
      </div>
    );
  }

  // ── READING VIEW (story generated) ──
  if (phase === "reading") {
    return (
      <div style={{ padding: 4 }}>
        {/* Story title */}
        <div
          style={{
            textAlign: "center",
            padding: "14px 16px",
            background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
            borderRadius: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#92400e", textTransform: "uppercase", letterSpacing: 1 }}>
            📖 Your Story
          </div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#78350f", marginTop: 4 }}>
            {storyTitle}
          </div>
        </div>

        {/* Cast of characters */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 12,
            justifyContent: "center",
          }}
        >
          {characters.map((c, i) => (
            <div
              key={i}
              style={{
                padding: "5px 10px",
                borderRadius: 20,
                background: [
                  "#dbeafe",
                  "#fce7f3",
                  "#dcfce7",
                  "#fef3c7",
                  "#ede9fe",
                  "#ffedd5",
                ][i % 6],
                fontSize: 12,
                fontWeight: 700,
                color: "#1e293b",
              }}
            >
              {c.name} — {c.trait}{c.nationality ? ` ${c.nationality}` : ""} {c.customRole.trim() || c.role}
            </div>
          ))}
        </div>

        {/* The story */}
        <div
          style={{
            padding: "18px 20px",
            background: "#fffef7",
            borderRadius: 16,
            border: "1px solid #fde68a",
            boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
            fontSize: 15,
            lineHeight: 1.8,
            color: "#1e293b",
            fontFamily: "'Georgia', serif",
            whiteSpace: "pre-wrap",
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          {generatedStory}
        </div>

        {genError && (
          <div
            style={{
              fontSize: 11,
              color: "#94a3b8",
              marginTop: 8,
              fontStyle: "italic",
              textAlign: "center",
            }}
          >
            (Auto-generated story — live AI was unavailable)
          </div>
        )}

        {/* Vocab words found */}
        {vocabWords.length > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 12px",
              background: "#f0fdf4",
              borderRadius: 10,
              fontSize: 12,
              color: "#166534",
              fontWeight: 600,
            }}
          >
            📚 Vocabulary featured:{" "}
            {vocabWords.map((w, i) => (
              <span key={i}>
                {w}
                {i < vocabWords.length - 1 ? ", " : ""}
              </span>
            ))}
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            padding: "10px 14px",
            borderRadius: 12,
            background: "#f1f5f9",
            textAlign: "center",
            fontSize: 14,
            fontWeight: 600,
            color: "#475569",
          }}
        >
          ✅ Story submitted! Read it aloud with your team!
        </div>
      </div>
    );
  }

  // ── CHARACTER BUILD VIEW ──
  return (
    <div style={{ padding: 4 }}>
      {/* Setting card */}
      <div
        style={{
          padding: "14px 16px",
          background: "linear-gradient(135deg, #fefce8 0%, #fef9c3 100%)",
          borderRadius: 14,
          border: "1px solid #fde68a",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "#92400e", marginBottom: 4 }}>
          📖 Build Your Characters
        </div>
        <div style={{ fontSize: 14, color: "#78350f", lineHeight: 1.5 }}>
          {topicContext || `Set in ${setting}. Pick a trait and role for each team member — then watch AI write your story!`}
        </div>
        <div
          style={{
            display: "inline-block",
            marginTop: 6,
            padding: "3px 10px",
            borderRadius: 999,
            background: "#fef3c7",
            border: "1px solid #fde68a",
            color: "#92400e",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Genre: {genre.charAt(0).toUpperCase() + genre.slice(1)}
        </div>
      </div>

      {/* Countdown timer bar */}
      {!isDisabled && !allReady && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: timeLeft <= 10 ? "#dc2626" : timeLeft <= 20 ? "#d97706" : "#475569",
              }}
            >
              {timeLeft > 0
                ? timeLeft <= 10
                  ? `⏱️ ${timeLeft}s — Hurry! Unpicked traits will be randomized!`
                  : `⏱️ ${timeLeft}s — Pick your characters!`
                : "🎲 Time's up!"}
            </span>
          </div>
          {/* Progress bar */}
          <div
            style={{
              width: "100%",
              height: 8,
              background: "#e2e8f0",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${(timeLeft / 30) * 100}%`,
                background:
                  timeLeft <= 10
                    ? "linear-gradient(90deg, #ef4444, #dc2626)"
                    : timeLeft <= 20
                    ? "linear-gradient(90deg, #f59e0b, #d97706)"
                    : "linear-gradient(90deg, #3b82f6, #6366f1)",
                borderRadius: 4,
                transition: "width 1s linear, background 0.3s",
              }}
            />
          </div>
        </div>
      )}
      {autoAssigning && (
        <div
          style={{
            textAlign: "center",
            padding: "10px",
            marginBottom: 10,
            borderRadius: 10,
            background: "#fef3c7",
            border: "1px solid #fbbf24",
            fontSize: 14,
            fontWeight: 700,
            color: "#92400e",
            animation: "pulse 0.5s infinite",
          }}
        >
          🎲 Auto-assigning remaining traits...
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.6; } }`}</style>

      {/* Character cards */}
      {characters.map((char, idx) => (
        <div
          key={idx}
          style={{
            padding: "12px 14px",
            marginBottom: 10,
            borderRadius: 14,
            background: [
              "linear-gradient(135deg, #eff6ff, #dbeafe)",
              "linear-gradient(135deg, #fdf2f8, #fce7f3)",
              "linear-gradient(135deg, #f0fdf4, #dcfce7)",
              "linear-gradient(135deg, #fefce8, #fef9c3)",
              "linear-gradient(135deg, #faf5ff, #ede9fe)",
              "linear-gradient(135deg, #fff7ed, #ffedd5)",
            ][idx % 6],
            border: `1px solid ${
              ["#93c5fd", "#f9a8d4", "#86efac", "#fde68a", "#c4b5fd", "#fdba74"][idx % 6]
            }`,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 800, color: "#1e293b", marginBottom: 8 }}>
            {char.name}
          </div>

          {/* Gender picker */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            Gender:
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {["Male", "Female"].map((g) => (
              <button
                key={g}
                onClick={() => !isDisabled && updateChar(idx, "gender", g)}
                disabled={isDisabled}
                style={{
                  padding: "5px 16px",
                  borderRadius: 20,
                  border: char.gender === g ? "2px solid #6366f1" : "1px solid #cbd5e1",
                  background: char.gender === g ? "#6366f1" : "#fff",
                  color: char.gender === g ? "#fff" : "#475569",
                  fontSize: 13,
                  fontWeight: char.gender === g ? 700 : 500,
                  cursor: isDisabled ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Trait picker */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            Personality trait:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
            {TRAIT_OPTIONS.map((trait) => (
              <button
                key={trait}
                onClick={() => !isDisabled && updateChar(idx, "trait", trait)}
                disabled={isDisabled}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  border: char.trait === trait ? "2px solid #3b82f6" : "1px solid #cbd5e1",
                  background: char.trait === trait ? "#3b82f6" : "#fff",
                  color: char.trait === trait ? "#fff" : "#475569",
                  fontSize: 12,
                  fontWeight: char.trait === trait ? 700 : 500,
                  cursor: isDisabled ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {trait}
              </button>
            ))}
          </div>

          {/* Role picker */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4 }}>
            Role in society:
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
            {ROLE_OPTIONS.map((role) => (
              <button
                key={role}
                onClick={() => {
                  if (isDisabled) return;
                  updateChar(idx, "role", role);
                  updateChar(idx, "customRole", "");
                }}
                disabled={isDisabled}
                style={{
                  padding: "4px 10px",
                  borderRadius: 20,
                  border:
                    char.role === role && !char.customRole.trim()
                      ? "2px solid #8b5cf6"
                      : "1px solid #cbd5e1",
                  background:
                    char.role === role && !char.customRole.trim() ? "#8b5cf6" : "#fff",
                  color:
                    char.role === role && !char.customRole.trim() ? "#fff" : "#475569",
                  fontSize: 12,
                  fontWeight: char.role === role && !char.customRole.trim() ? 700 : 500,
                  cursor: isDisabled ? "default" : "pointer",
                  transition: "all 0.15s",
                }}
              >
                {role}
              </button>
            ))}
          </div>

          {/* Custom role */}
          <input
            type="text"
            value={char.customRole}
            onChange={(e) => {
              updateChar(idx, "customRole", e.target.value);
              if (e.target.value.trim()) updateChar(idx, "role", "");
            }}
            disabled={isDisabled}
            placeholder="...or type your own role"
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #d1d5db",
              fontSize: 13,
              color: "#1e293b",
              background: "#fff",
            }}
          />

          {/* Nationality picker (for history/literature topics) */}
          {showNationality && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 4, marginTop: 10 }}>
                National background:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {NATIONALITY_OPTIONS.map((nat) => (
                  <button
                    key={nat}
                    onClick={() => !isDisabled && updateChar(idx, "nationality", nat)}
                    disabled={isDisabled}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 20,
                      border: char.nationality === nat ? "2px solid #059669" : "1px solid #cbd5e1",
                      background: char.nationality === nat ? "#059669" : "#fff",
                      color: char.nationality === nat ? "#fff" : "#475569",
                      fontSize: 12,
                      fontWeight: char.nationality === nat ? 700 : 500,
                      cursor: isDisabled ? "default" : "pointer",
                      transition: "all 0.15s",
                    }}
                  >
                    {nat}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ))}

      {/* Vocab hint */}
      {vocabWords.length > 0 && (
        <div
          style={{
            fontSize: 12,
            color: "#64748b",
            marginBottom: 10,
            padding: "6px 10px",
            background: "#f0fdf4",
            borderRadius: 8,
            border: "1px solid #bbf7d0",
          }}
        >
          📚 The story will weave in: {vocabWords.join(", ")}
        </div>
      )}

      {/* Generate button */}
      <button
        onClick={handleGenerate}
        disabled={isDisabled || !allReady}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "14px 0",
          borderRadius: 12,
          border: "none",
          background: !allReady ? "#94a3b8" : "#f59e0b",
          color: !allReady ? "#fff" : "#78350f",
          fontSize: 17,
          fontWeight: 800,
          cursor: !allReady || isDisabled ? "default" : "pointer",
          transition: "all 0.2s",
          boxShadow: allReady ? "0 4px 14px rgba(245,158,11,0.3)" : "none",
        }}
      >
        {!allReady
          ? "Pick a trait & role for everyone"
          : "✨ Generate Our Story!"}
      </button>
    </div>
  );
}
