// student-app/src/components/tasks/CoachPanel.jsx
// "Coach mode" — gives non-typing team members a role during the task.
// The designated writer answers; the other members are "coaches" who see
// a hidden hint they must communicate verbally to the writer.
//
// On a shared device, the hint is blurred behind a tap-to-peek button
// so the writer can look away while coaches peek.

import React, { useState, useEffect, useRef, useMemo } from "react";
import { getDesignatedName } from "./DesignatedWriter.jsx";

/**
 * Extract a useful coach hint from a task object.
 * Returns a string or null.
 */
function deriveCoachHint(task) {
  if (!task) return null;
  const cfg = task.config && typeof task.config === "object" ? task.config : {};
  const type = (task.taskType || task.type || "").toLowerCase();

  // 1. Explicit coachHint field (from template generation)
  if (task.coachHint) return String(task.coachHint);
  if (cfg.coachHint) return String(cfg.coachHint);

  // 2. Relevant concepts — great for open-ended tasks
  const concepts = task.relevantConcepts || cfg.relevantConcepts;
  if (Array.isArray(concepts) && concepts.length > 0) {
    return `Key concepts to mention: ${concepts.slice(0, 4).join(", ")}`;
  }

  // 3. Multiple choice — give a topical hint without revealing the answer
  if (type === "multiple-choice" || type === "physical-multiple-choice") {
    const options = task.options || cfg.options || task.choices || cfg.choices || [];
    // If there's a topic/prompt, hint at the category
    if (task.prompt && options.length > 0) {
      // Count option texts to find the odd one out pattern
      return `Read the question carefully — one answer fits much better than the others. Talk through each option with your team.`;
    }
  }

  // 4. True/false — encourage discussion
  if (type === "true-false" || type === "true-false-connect-four" || type === "true-false-tictactoe") {
    return `Before answering, explain WHY you think it's true or false. Convince your team!`;
  }

  // 5. Matching — hint about categories
  if (type === "matching") {
    const pairs = cfg.pairs || [];
    if (pairs.length > 0) {
      return `Look for patterns — some items are easier to match first. Start with what you're most sure about.`;
    }
  }

  // 6. Case study / letter — character context
  const charDesc = cfg.characterDescription || cfg.expertDescription || cfg.scenario;
  if (charDesc && typeof charDesc === "string" && charDesc.length > 10) {
    const trimmed = charDesc.length > 120 ? charDesc.slice(0, 117) + "…" : charDesc;
    return `Context for coaches: ${trimmed}`;
  }

  // 7. Mind mapper — hint about the central topic
  if (type === "mind-mapper") {
    const center = task.structure?.center || cfg.centralTopic;
    if (center) {
      return `Think about how different ideas connect back to "${center}". Help your writer organize the branches.`;
    }
  }

  // 8. Short answer / open text — encourage elaboration
  if (type === "short-answer" || type === "open-text") {
    return `Help your writer give a complete answer — ask them "why?" and "can you add an example?"`;
  }

  // 9. Sort / sequence / timeline — strategy hint
  if (type === "sort" || type === "sequence" || type === "timeline" || type === "mad-dash-sequence") {
    return `Work together to figure out the order first BEFORE moving anything. Discuss, then drag.`;
  }

  // 10. VennSort — categorization help
  if (type === "vennsort") {
    return `For each item, ask: "Does this belong to one group, the other, or both?" Decide together before placing.`;
  }

  // 11. Flashcards — quiz each other
  if (type === "flashcards" || type === "flashcards-race") {
    return `Quiz each other! One person reads the front, the others guess the back before flipping.`;
  }

  // 12. Generic fallback for tasks without specific hints
  return `Talk through the answer as a team before submitting. Coaches: challenge the writer's first instinct!`;
}

const PEEK_DURATION_MS = 6000;

export default function CoachPanel({ task, memberNames = [], taskIndex }) {
  const names = useMemo(
    () => (Array.isArray(memberNames) ? memberNames.filter(Boolean) : []),
    [memberNames]
  );

  // No coach mode for solo players
  if (names.length < 2) return null;

  const writerName = getDesignatedName(names, taskIndex);
  const coaches = useMemo(
    () => names.filter((n) => n !== writerName),
    [names, writerName]
  );

  const hint = useMemo(() => deriveCoachHint(task), [task]);

  const [peeking, setPeeking] = useState(false);
  const [peekSecondsLeft, setPeekSecondsLeft] = useState(0);
  const peekTimerRef = useRef(null);

  // Reset peek state when task changes
  useEffect(() => {
    setPeeking(false);
    setPeekSecondsLeft(0);
    if (peekTimerRef.current) clearInterval(peekTimerRef.current);
  }, [task?.title, task?.taskType, taskIndex]);

  function handlePeek() {
    if (peeking) return;
    setPeeking(true);
    const seconds = Math.ceil(PEEK_DURATION_MS / 1000);
    setPeekSecondsLeft(seconds);

    let remaining = seconds;
    peekTimerRef.current = setInterval(() => {
      remaining--;
      setPeekSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(peekTimerRef.current);
        setPeeking(false);
        setPeekSecondsLeft(0);
      }
    }, 1000);
  }

  if (!hint) return null;

  const coachLabel = coaches.length === 1 ? coaches[0] : coaches.join(" & ");

  return (
    <div
      style={{
        margin: "0 0 10px 0",
        padding: "10px 14px",
        borderRadius: 12,
        background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(168,85,247,0.10) 100%)",
        border: "1px solid rgba(99,102,241,0.25)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#7c3aed" }}>
          🧠 Coach Corner — {coachLabel}
        </div>
        <div style={{ fontSize: "0.68rem", color: "#8b5cf6", opacity: 0.8 }}>
          {writerName}: look away!
        </div>
      </div>

      {/* Hint area */}
      {peeking ? (
        <div
          style={{
            fontSize: "0.82rem",
            color: "#4c1d95",
            fontWeight: 500,
            lineHeight: 1.5,
            padding: "6px 0",
          }}
        >
          {hint}
          <div
            style={{
              marginTop: 4,
              fontSize: "0.65rem",
              color: "#8b5cf6",
              fontWeight: 600,
            }}
          >
            Hiding in {peekSecondsLeft}s…
          </div>
        </div>
      ) : (
        <button
          onClick={handlePeek}
          style={{
            display: "block",
            width: "100%",
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px dashed rgba(124,58,237,0.4)",
            background: "rgba(124,58,237,0.06)",
            color: "#7c3aed",
            fontWeight: 700,
            fontSize: "0.78rem",
            cursor: "pointer",
            textAlign: "center",
          }}
        >
          👀 Coaches: tap to peek at your hint
        </button>
      )}
    </div>
  );
}
