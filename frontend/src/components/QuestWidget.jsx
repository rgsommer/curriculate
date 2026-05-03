"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  QUEST CONFIG                                                       */
/* ------------------------------------------------------------------ */

/**
 * Each quest:
 *   id          — unique key, used in localStorage
 *   title       — display label
 *   description — one-liner description
 *   credits     — free grading credits awarded
 *   max         — how many times it can be completed (default 1)
 *   icon        — emoji
 */

export const HOMEPAGE_QUESTS = [
  {
    id: "visit_pulse_grading",
    title: "Try Pulse Grading",
    description: "Visit the AI grading tool and grade your first work",
    credits: 5,
    icon: "📸",
  },
  {
    id: "explore_task_types",
    title: "Explore task types",
    description: "Check out the 65+ interactive task types available",
    credits: 3,
    icon: "🧩",
  },
  {
    id: "visit_how_it_works",
    title: "See how it works",
    description: "Learn the full scavenger-hunt workflow",
    credits: 3,
    icon: "🔍",
  },
  {
    id: "explore_pricing",
    title: "View pricing plans",
    description: "Check out the pricing and plan options",
    credits: 3,
    icon: "💰",
  },
  {
    id: "visit_sample_reports",
    title: "View sample reports",
    description: "See what AI-generated student reports look like",
    credits: 3,
    icon: "📊",
  },
];

export const GRADING_QUESTS = [
  {
    id: "grade_first_photo",
    title: "Grade your first photo",
    description: "Take or upload a photo and get AI feedback",
    credits: 3,
    icon: "📸",
  },
  {
    id: "try_batch_grading",
    title: "Try batch grading",
    description: "Upload a PDF or images to grade a full class at once",
    credits: 5,
    icon: "📄",
  },
  {
    id: "use_rubric_override",
    title: "Use a custom rubric",
    description: "Paste, upload, or photograph your own rubric",
    credits: 3,
    icon: "📋",
  },
  {
    id: "try_video_grading",
    title: "Try video grading",
    description: "Grade a student performance via video upload",
    credits: 3,
    icon: "🎥",
  },
  {
    id: "try_audio_grading",
    title: "Try audio grading",
    description: "Grade a music or speech performance via audio",
    credits: 3,
    icon: "🎵",
  },
  {
    id: "email_session_results",
    title: "Email results to students",
    description: "Send a batch session summary email",
    credits: 5,
    icon: "📧",
  },
  {
    id: "setup_class_roster",
    title: "Set up a class roster",
    description: "Upload a CSV roster for student name matching",
    credits: 3,
    icon: "📝",
  },
];

/* ------------------------------------------------------------------ */
/*  PERSISTENCE                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "curriculate_quests_v1";
const CREDITS_KEY = "curriculate_quest_credits_v1";

function loadCompleted() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCompleted(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

function loadCredits() {
  try {
    return Number(localStorage.getItem(CREDITS_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveCredits(n) {
  try {
    localStorage.setItem(CREDITS_KEY, String(n));
  } catch {}
}

/* ------------------------------------------------------------------ */
/*  PUBLIC API: completeQuest()                                        */
/* ------------------------------------------------------------------ */

/**
 * Call this from anywhere:
 *   import { completeQuest } from "@/components/QuestWidget";
 *   completeQuest("grade_first_photo");
 *
 * The widget listens via a custom event and updates in real time.
 */
export function completeQuest(questId) {
  const completed = loadCompleted();
  if (completed[questId]) return; // already done
  completed[questId] = Date.now();
  saveCompleted(completed);

  // Find quest to award credits
  const allQuests = [...HOMEPAGE_QUESTS, ...GRADING_QUESTS];
  const quest = allQuests.find((q) => q.id === questId);
  if (quest) {
    const cur = loadCredits();
    saveCredits(cur + quest.credits);
  }

  // Broadcast so any mounted QuestWidget re-renders
  window.dispatchEvent(new CustomEvent("quest-completed", { detail: { questId } }));
}

/* ------------------------------------------------------------------ */
/*  WIDGET COMPONENT                                                   */
/* ------------------------------------------------------------------ */

export default function QuestWidget({ quests, label = "Quests" }) {
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState({});
  const [credits, setCredits] = useState(0);
  const [justCompleted, setJustCompleted] = useState(null);
  const [pulse, setPulse] = useState(false);
  const panelRef = useRef(null);

  // Load state
  useEffect(() => {
    setCompleted(loadCompleted());
    setCredits(loadCredits());
  }, []);

  // Listen for quest completions
  useEffect(() => {
    function handleComplete(e) {
      setCompleted(loadCompleted());
      setCredits(loadCredits());
      setJustCompleted(e.detail.questId);
      setPulse(true);
      setTimeout(() => setPulse(false), 1200);
      setTimeout(() => setJustCompleted(null), 2500);
    }
    window.addEventListener("quest-completed", handleComplete);
    return () => window.removeEventListener("quest-completed", handleComplete);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const doneCount = quests.filter((q) => completed[q.id]).length;
  const totalCredits = quests.reduce((s, q) => s + q.credits, 0);
  const earnedCredits = quests
    .filter((q) => completed[q.id])
    .reduce((s, q) => s + q.credits, 0);
  const allDone = doneCount === quests.length;

  return (
    <div ref={panelRef} style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999 }}>
      {/* --- Popup Panel --- */}
      {open && (
        <div
          style={{
            position: "absolute",
            bottom: 64,
            right: 0,
            width: 370,
            maxHeight: "70vh",
            overflowY: "auto",
            background: "#fff",
            borderRadius: 16,
            boxShadow: "0 8px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.08)",
            border: "1px solid #e5e7eb",
            padding: 0,
            animation: "questSlideUp 0.25s ease-out",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "20px 20px 12px",
              borderBottom: "1px solid #f0f0f0",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111" }}>
                Earn free credits
              </div>
              <div style={{ fontSize: 13, color: "#888", marginTop: 2 }}>
                {doneCount}/{quests.length} completed&ensp;·&ensp;{earnedCredits}/{totalCredits} credits earned
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: "none",
                border: "none",
                fontSize: 20,
                cursor: "pointer",
                color: "#999",
                padding: 4,
                lineHeight: 1,
              }}
              aria-label="Close quests"
            >
              ✕
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ padding: "12px 20px 8px" }}>
            <div
              style={{
                height: 6,
                borderRadius: 3,
                background: "#f1f5f9",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(doneCount / quests.length) * 100}%`,
                  background: allDone
                    ? "linear-gradient(90deg, #22c55e, #16a34a)"
                    : "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  borderRadius: 3,
                  transition: "width 0.5s ease",
                }}
              />
            </div>
          </div>

          {/* Quest list */}
          <div style={{ padding: "4px 12px 16px" }}>
            {quests.map((q) => {
              const done = !!completed[q.id];
              const justDone = justCompleted === q.id;
              return (
                <div
                  key={q.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 8px",
                    borderRadius: 12,
                    background: done
                      ? justDone
                        ? "linear-gradient(135deg, #dcfce7, #d1fae5)"
                        : "#f8fdf9"
                      : "#fff",
                    border: done ? "1px solid #bbf7d0" : "1px solid #f0f0f0",
                    marginTop: 6,
                    transition: "all 0.3s ease",
                    animation: justDone ? "questPop 0.4s ease-out" : undefined,
                  }}
                >
                  {/* Icon / check */}
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                      background: done ? "#dcfce7" : "#f8fafc",
                      border: done ? "1.5px solid #86efac" : "1.5px solid #e2e8f0",
                      flexShrink: 0,
                    }}
                  >
                    {done ? "✅" : q.icon}
                  </div>

                  {/* Text */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: done ? "#16a34a" : "#1e293b",
                        textDecoration: done ? "line-through" : undefined,
                        opacity: done ? 0.7 : 1,
                      }}
                    >
                      {q.title}
                    </div>
                    <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>
                      {q.description}
                    </div>
                  </div>

                  {/* Credit badge */}
                  <div
                    style={{
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 800,
                      background: done
                        ? "linear-gradient(135deg, #dcfce7, #bbf7d0)"
                        : "linear-gradient(135deg, #fef3c7, #fde68a)",
                      color: done ? "#15803d" : "#92400e",
                      border: done ? "1px solid #86efac" : "1px solid #fcd34d",
                      whiteSpace: "nowrap",
                      textAlign: "center",
                      lineHeight: 1.1,
                    }}
                  >
                    <div style={{ fontSize: 16, fontWeight: 900 }}>{q.credits}</div>
                    <div style={{ fontSize: 9, fontWeight: 600, opacity: 0.8 }}>credits</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer — total credits */}
          {credits > 0 && (
            <div
              style={{
                padding: "12px 20px 16px",
                borderTop: "1px solid #f0f0f0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ fontSize: 13, color: "#64748b" }}>Your free credits</span>
              <span style={{ fontSize: 18, fontWeight: 900, color: "#16a34a" }}>
                {credits}
              </span>
            </div>
          )}
        </div>
      )}

      {/* --- Floating Button --- */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          border: "none",
          background: allDone
            ? "linear-gradient(135deg, #22c55e, #16a34a)"
            : "linear-gradient(135deg, #3b82f6, #8b5cf6)",
          color: "#fff",
          cursor: "pointer",
          boxShadow: pulse
            ? "0 0 0 8px rgba(59,130,246,0.25), 0 4px 20px rgba(0,0,0,0.15)"
            : "0 4px 20px rgba(0,0,0,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          transition: "box-shadow 0.3s ease, transform 0.2s ease",
          transform: pulse ? "scale(1.1)" : open ? "rotate(45deg)" : "scale(1)",
          position: "relative",
        }}
        aria-label={open ? "Close quests" : "Open quests"}
      >
        {open ? "✕" : "🎯"}

        {/* Badge */}
        {!open && doneCount < quests.length && (
          <div
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#ef4444",
              color: "#fff",
              fontSize: 11,
              fontWeight: 800,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "2px solid #fff",
            }}
          >
            {quests.length - doneCount}
          </div>
        )}
      </button>

      {/* Keyframe animations */}
      <style>{`
        @keyframes questSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes questPop {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.03); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
