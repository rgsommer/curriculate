// student-app/src/components/tasks/types/InterviewTask.jsx
import React, { useState, useRef, useCallback, useEffect } from "react";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";
import { API_BASE_URL } from "../../../config.js";

/* ------------------------------------------------------------------ */
/*  CSS animations                                                     */
/* ------------------------------------------------------------------ */
const STYLE_ID = "interview-anims";
function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = `
    @keyframes iv-fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes iv-typing {
      0%, 80% { opacity: 1; }
      40%     { opacity: 0.3; }
    }
    @keyframes iv-pulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.05); }
    }
    @keyframes iv-shimmer {
      0%   { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
  `;
  document.head.appendChild(el);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const MAX_INPUT = 500;

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "8px 0" }}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#6366f1",
            animation: `iv-typing 1.2s ease-in-out ${i * 0.2}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ScoreBadge({ score }) {
  const color = score >= 4 ? "#16a34a" : score >= 2 ? "#f59e0b" : "#ef4444";
  return (
    <span style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 6,
      fontSize: 11, fontWeight: 800, background: `${color}22`, color,
      marginLeft: 8,
    }}>
      {score}/5
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Candidate Selection Card                                           */
/* ------------------------------------------------------------------ */
function CandidateCard({ candidate, selected, onSelect }) {
  const isSelected = selected;
  return (
    <button
      onClick={onSelect}
      style={{
        flex: "1 1 0", minWidth: 140, maxWidth: 260,
        padding: 16, borderRadius: 14,
        border: isSelected ? "2px solid #6366f1" : "2px solid #e2e8f0",
        background: isSelected
          ? "linear-gradient(135deg, #eef2ff, #e0e7ff)"
          : "#fff",
        cursor: "pointer", textAlign: "left",
        transition: "all 0.2s",
        boxShadow: isSelected ? "0 4px 16px rgba(99,102,241,0.2)" : "0 1px 4px rgba(0,0,0,0.06)",
        animation: "iv-fadeIn 0.4s ease-out",
      }}
    >
      <div style={{ fontSize: 13, color: "#6366f1", fontWeight: 700, marginBottom: 4 }}>
        {candidate.era || ""}
      </div>
      <div style={{ fontSize: 16, fontWeight: 900, color: "#1e293b", marginBottom: 6 }}>
        {candidate.name}
      </div>
      <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.4 }}>
        {candidate.description}
      </div>
      {isSelected && (
        <div style={{
          marginTop: 10, fontSize: 11, fontWeight: 800,
          color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          Selected
        </div>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat Bubble                                                        */
/* ------------------------------------------------------------------ */
function ChatBubble({ message, isStudent, characterName, score }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: isStudent ? "flex-end" : "flex-start",
      marginBottom: 12, animation: "iv-fadeIn 0.3s ease-out",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, marginBottom: 3,
        color: isStudent ? "#6366f1" : "#b45309",
      }}>
        {isStudent ? "You" : characterName}
        {typeof score === "number" && <ScoreBadge score={score} />}
      </div>
      <div style={{
        maxWidth: "85%", padding: "10px 14px", borderRadius: 14,
        fontSize: 14, lineHeight: 1.5,
        background: isStudent
          ? "linear-gradient(135deg, #6366f1, #818cf8)"
          : "#f1f5f9",
        color: isStudent ? "#fff" : "#334155",
        borderBottomRightRadius: isStudent ? 4 : 14,
        borderBottomLeftRadius: isStudent ? 14 : 4,
      }}>
        {message}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */
export default function InterviewTask({ task, onSubmit, disabled }) {
  useEffect(() => { injectStyles(); }, []);

  const cfg = task?.config || {};
  const candidates = task?.candidates || cfg?.candidates || [];
  const minTurns = cfg.minTurns || 3;
  const maxTurns = cfg.maxTurns || 8;

  // Phases: "select" → "chat" → "done"
  const [phase, setPhase] = useState("select");
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [messages, setMessages] = useState([]); // { role, text, score? }
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [inputMode, setInputMode] = useState("type"); // "type" | "voice" | "photo"
  const [listening, setListening] = useState(false);
  const [turnCount, setTurnCount] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [photoPreview, setPhotoPreview] = useState(null);
  const chatEndRef = useRef(null);
  const recognitionRef = useRef(null);
  const fileRef = useRef(null);

  const character = selectedIdx !== null ? candidates[selectedIdx] : null;

  // Scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Start interview with character greeting
  const startInterview = useCallback(() => {
    if (!character) return;
    setPhase("chat");
    setMessages([{ role: "character", text: character.greeting }]);
  }, [character]);

  // Send question to backend
  const sendQuestion = useCallback(async (questionText) => {
    if (!questionText?.trim() || loading || !character) return;
    const trimmed = questionText.trim().slice(0, MAX_INPUT);

    // Add student message
    setMessages((prev) => [...prev, { role: "student", text: trimmed }]);
    setInput("");
    setPhotoPreview(null);
    setLoading(true);

    try {
      const resp = await fetch(`${API_BASE_URL}/api/evaluate/interview-reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: character.name,
          systemPrompt: character.systemPrompt,
          history: [...messages, { role: "student", text: trimmed }]
            .map((m) => ({ role: m.role === "student" ? "user" : "assistant", content: m.text })),
          studentQuestion: trimmed,
          turnNumber: turnCount + 1,
          maxTurns,
        }),
      });

      const data = await resp.json();
      const reply = data.reply || "I'm not sure how to answer that.";
      const score = typeof data.relevanceScore === "number" ? data.relevanceScore : 3;

      setMessages((prev) => {
        // Tag the student's last message with its score
        const updated = [...prev];
        const lastStudentIdx = updated.length - 1;
        if (updated[lastStudentIdx]?.role === "student") {
          updated[lastStudentIdx] = { ...updated[lastStudentIdx], score };
        }
        return [...updated, { role: "character", text: reply }];
      });

      setTurnCount((c) => c + 1);
      setTotalScore((s) => s + score);

      // Check if we've reached max turns
      if (turnCount + 1 >= maxTurns) {
        setPhase("done");
      }
    } catch (err) {
      console.error("[Interview] AI reply failed:", err);
      setMessages((prev) => [
        ...prev,
        { role: "character", text: "Hmm, I seem to have lost my train of thought. Could you ask again?" },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, character, messages, turnCount, maxTurns]);

  // Voice dictation
  const toggleVoice = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      alert("Voice dictation is not supported in this browser.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript || "";
      setInput((prev) => (prev + " " + transcript).trim());
      setListening(false);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  // Photo upload
  const handlePhotoCapture = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPhotoPreview(reader.result);
      // OCR would happen on submit — for now extract via backend
      setInput("[Photo question — see image]");
    };
    reader.readAsDataURL(file);
  }, []);

  // Submit (end interview)
  const handleFinish = useCallback(() => {
    const studentQuestions = messages.filter((m) => m.role === "student");
    onSubmit({
      candidate: character?.name,
      turns: turnCount,
      totalScore,
      avgScore: turnCount > 0 ? Math.round((totalScore / turnCount) * 10) / 10 : 0,
      transcript: messages.map((m) => `${m.role === "student" ? "Student" : character?.name}: ${m.text}`).join("\n"),
    });
  }, [messages, character, turnCount, totalScore, onSubmit]);

  // ── SELECT PHASE ──
  if (phase === "select") {
    return (
      <TaskCardFrame>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#1e293b", marginBottom: 6 }}>
            {task?.title || "Interview"}
          </div>
          <div style={{ fontSize: 14, color: "#64748b", lineHeight: 1.5 }}>
            {task?.prompt || "Choose someone to interview. Ask thoughtful, open-ended questions to learn about them and earn points!"}
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6, lineHeight: 1.4 }}>
            💡 <strong>Tips:</strong> Ask about their experiences, opinions, and motivations. "Why" and "How" questions score higher than yes/no questions.
          </div>
        </div>

        <div style={{ fontSize: 13, fontWeight: 800, color: "#6366f1", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Choose your interviewee
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          {candidates.map((c, i) => (
            <CandidateCard
              key={i}
              candidate={c}
              selected={selectedIdx === i}
              onSelect={() => setSelectedIdx(i)}
            />
          ))}
        </div>

        <PrimaryButton
          onClick={startInterview}
          disabled={selectedIdx === null || disabled}
          style={{ width: "100%", opacity: selectedIdx === null ? 0.4 : 1 }}
        >
          Start Interview
        </PrimaryButton>
      </TaskCardFrame>
    );
  }

  // ── DONE PHASE ──
  if (phase === "done") {
    const avgScore = turnCount > 0 ? (totalScore / turnCount).toFixed(1) : "0";
    return (
      <TaskCardFrame>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎤</div>
          <div style={{ fontSize: 20, fontWeight: 900, color: "#1e293b", marginBottom: 8 }}>
            Interview Complete!
          </div>
          <div style={{ fontSize: 14, color: "#64748b", marginBottom: 16 }}>
            You interviewed <strong>{character?.name}</strong> with {turnCount} question{turnCount !== 1 ? "s" : ""}.
          </div>

          <div style={{
            display: "inline-flex", gap: 24, background: "#f8fafc",
            padding: "14px 28px", borderRadius: 14, border: "1px solid #e2e8f0",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#6366f1" }}>{totalScore}</div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Total Score</div>
            </div>
            <div style={{ width: 1, background: "#e2e8f0" }} />
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#f59e0b" }}>{avgScore}</div>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700 }}>Avg / Question</div>
            </div>
          </div>

          <div style={{ marginTop: 20 }}>
            <PrimaryButton onClick={handleFinish} disabled={disabled}>
              Submit Interview
            </PrimaryButton>
          </div>
        </div>

        {/* Transcript */}
        <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 12, padding: 12, background: "#f8fafc", borderRadius: 10, fontSize: 13 }}>
          {messages.map((m, i) => (
            <ChatBubble key={i} message={m.text} isStudent={m.role === "student"} characterName={character?.name} score={m.score} />
          ))}
        </div>
      </TaskCardFrame>
    );
  }

  // ── CHAT PHASE ──
  const canFinish = turnCount >= minTurns;
  const turnsLeft = maxTurns - turnCount;

  return (
    <TaskCardFrame>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 900, color: "#1e293b" }}>
            Interviewing: {character?.name}
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{character?.era}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <Pill style={{ background: "#6366f122", color: "#6366f1" }}>
            {turnCount}/{maxTurns} questions
          </Pill>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            Score: {totalScore}
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div style={{
        maxHeight: 320, overflowY: "auto", padding: 12,
        background: "#fafbfc", borderRadius: 12,
        border: "1px solid #e2e8f0", marginBottom: 12,
      }}>
        {messages.map((m, i) => (
          <ChatBubble key={i} message={m.text} isStudent={m.role === "student"} characterName={character?.name} score={m.score} />
        ))}
        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#b45309", fontWeight: 700 }}>{character?.name}</span>
            <TypingIndicator />
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input mode tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {[
          { key: "type", label: "Type", icon: "⌨️" },
          { key: "voice", label: "Voice", icon: "🎤" },
          { key: "photo", label: "Photo", icon: "📷" },
        ].map((m) => (
          <button
            key={m.key}
            onClick={() => setInputMode(m.key)}
            style={{
              padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: inputMode === m.key ? "2px solid #6366f1" : "1px solid #e2e8f0",
              background: inputMode === m.key ? "#eef2ff" : "#fff",
              color: inputMode === m.key ? "#6366f1" : "#64748b",
              cursor: "pointer",
            }}
          >
            {m.icon} {m.label}
          </button>
        ))}
      </div>

      {/* Input area */}
      {turnsLeft > 0 && !loading && (
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          {inputMode === "type" && (
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT))}
              placeholder="Ask a question... (e.g. What was your biggest challenge? Why did you choose that path?)"
              rows={2}
              style={{ flex: 1, fontSize: 14, resize: "none" }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuestion(input); } }}
            />
          )}

          {inputMode === "voice" && (
            <div style={{ flex: 1 }}>
              <button
                onClick={toggleVoice}
                style={{
                  width: "100%", padding: 14, borderRadius: 12,
                  border: listening ? "2px solid #ef4444" : "2px solid #6366f1",
                  background: listening ? "#fef2f2" : "#eef2ff",
                  color: listening ? "#ef4444" : "#6366f1",
                  fontWeight: 800, fontSize: 14, cursor: "pointer",
                  animation: listening ? "iv-pulse 1s infinite" : "none",
                }}
              >
                {listening ? "🔴 Listening... tap to stop" : "🎤 Tap to speak your question"}
              </button>
              {input && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#334155", padding: "6px 10px", background: "#f1f5f9", borderRadius: 8 }}>
                  "{input}"
                </div>
              )}
            </div>
          )}

          {inputMode === "photo" && (
            <div style={{ flex: 1 }}>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handlePhotoCapture}
                style={{ display: "none" }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: "100%", padding: 14, borderRadius: 12,
                  border: "2px dashed #6366f1", background: "#eef2ff",
                  color: "#6366f1", fontWeight: 800, fontSize: 14, cursor: "pointer",
                }}
              >
                📷 Snap or upload your written question
              </button>
              {photoPreview && (
                <img src={photoPreview} alt="question" style={{ marginTop: 8, maxHeight: 120, borderRadius: 8, border: "1px solid #e2e8f0" }} />
              )}
            </div>
          )}

          <PrimaryButton
            onClick={() => sendQuestion(input)}
            disabled={!input?.trim() || loading || disabled}
            style={{ padding: "10px 18px", whiteSpace: "nowrap" }}
          >
            Ask →
          </PrimaryButton>
        </div>
      )}

      {/* Info / finish */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}>
        <div style={{ fontSize: 12, color: "#64748b" }}>
          {turnsLeft > 0
            ? `${turnsLeft} question${turnsLeft !== 1 ? "s" : ""} remaining`
            : "Maximum questions reached"}
        </div>
        {canFinish && turnsLeft > 0 && (
          <GhostButton onClick={() => setPhase("done")} style={{ fontSize: 12 }}>
            End Interview Early
          </GhostButton>
        )}
      </div>
    </TaskCardFrame>
  );
}
