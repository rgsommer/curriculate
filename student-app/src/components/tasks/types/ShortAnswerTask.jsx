import React from "react";
import DesignatedWriter from "../DesignatedWriter";

// Confetti particle component
function Confetti() {
  const particles = Array.from({ length: 40 });
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      {particles.map((_, i) => {
        const startX = Math.random() * 100;
        const delay = Math.random() * 0.2;
        const duration = 2.5 + Math.random() * 0.5;
        const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#ffd93d", "#ff9ff3"];
        const color = colors[Math.floor(Math.random() * colors.length)];
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${startX}%`,
              top: "-10px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: color,
              opacity: 0.8,
              animation: `fall-${i} ${duration}s linear ${delay}s forwards`,
              "@keyframes": `fall-${i} { to { transform: translateY(100vh) rotate(360deg); opacity: 0; } }`,
            }}
          />
        );
      })}
      <style>{`
        ${Array.from({ length: 40 })
          .map((_, i) => {
            const startX = Math.random() * 100;
            const xMove = (Math.random() - 0.5) * 200;
            return `@keyframes fall-${i} { to { transform: translateY(100vh) translateX(${xMove}px) rotate(360deg); opacity: 0; } }`;
          })
          .join("\n")}
      `}</style>
    </div>
  );
}

// Sparkle effect component
function Sparkles() {
  const sparkles = Array.from({ length: 20 });
  return (
    <div style={{ position: "absolute", width: "100%", height: "100%" }}>
      {sparkles.map((_, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: `${Math.random() * 100}%`,
            top: `${Math.random() * 100}%`,
            width: "8px",
            height: "8px",
            background: "#ffd93d",
            borderRadius: "50%",
            boxShadow: "0 0 12px #ffd93d",
            animation: `sparkle 1.5s ease-out ${Math.random() * 0.3}s forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes sparkle {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0); }
        }
      `}</style>
    </div>
  );
}

// Score counter with animation
function AnimatedScore({ score, maxScore }) {
  const [displayScore, setDisplayScore] = React.useState(0);

  React.useEffect(() => {
    let frame = 0;
    const target = Math.round(score * 100);
    const interval = setInterval(() => {
      frame += 1;
      const increment = Math.ceil(target / 30);
      setDisplayScore((prev) => Math.min(prev + increment, target));
      if (displayScore >= target) clearInterval(interval);
    }, 20);
    return () => clearInterval(interval);
  }, [score]);

  return (
    <div
      style={{
        fontSize: "1.8rem",
        fontWeight: "900",
        background: "linear-gradient(135deg, #ff6b6b, #ffd93d)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}
    >
      {displayScore}%
    </div>
  );
}

export default function ShortAnswerTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  memberNames = [],
}) {
  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task.items) && task.items.length > 0;

  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiAnswersByDisplayIdx, setMultiAnswersByDisplayIdx] = React.useState([]);
  const [singleAnswer, setSingleAnswer] = React.useState("");

  const [checking, setChecking] = React.useState(false);
  const [review, setReview] = React.useState(null);
  const [attemptCount, setAttemptCount] = React.useState(0);
  const [showConfetti, setShowConfetti] = React.useState(false);
  const [focusedIndex, setFocusedIndex] = React.useState(null);

  // ── Minimum word-count gate ──────────────────────────────
  const wordCount = (s) =>
    typeof s === "string" ? s.trim().split(/\s+/).filter(Boolean).length : 0;

  // Default 7 words; can be overridden by grade-level (e.g. grade 5 → 5 words)
  const gradeRaw = task?.gradeLevel || task?.config?.gradeLevel || "";
  const parsedGrade = typeof gradeRaw === "number"
    ? gradeRaw
    : parseInt(String(gradeRaw).replace(/[^0-9]/g, ""), 10);
  const minWords = (parsedGrade >= 3 && parsedGrade <= 12) ? parsedGrade : 7;

  const singleWC = wordCount(singleAnswer);
  const singleReady =
    typeof singleAnswer === "string" && singleWC >= minWords;

  const multiWordCounts = Array.isArray(multiAnswersByDisplayIdx)
    ? multiAnswersByDisplayIdx.map((a) => wordCount(a))
    : [];
  const multiMinWC = multiWordCounts.length > 0
    ? Math.min(...multiWordCounts)
    : 0;
  const multiReady =
    Array.isArray(multiAnswersByDisplayIdx) &&
    multiAnswersByDisplayIdx.length > 0 &&
    multiAnswersByDisplayIdx.every((a) => wordCount(a) >= minWords);

  React.useEffect(() => {
    if (!task) return;

    setChecking(false);
    setReview(null);
    setAttemptCount(0);

    if (hasItems) {
      let restoredByDisplayIdx = null;
      try {
        if (typeof answerDraft === "string" && answerDraft.trim().startsWith("{")) {
          const parsed = JSON.parse(answerDraft);
          if (
            parsed &&
            parsed.kind === "multi-short-answer-draft" &&
            Array.isArray(parsed.answersByDisplayIdx)
          ) {
            restoredByDisplayIdx = parsed.answersByDisplayIdx;
          }
        }
      } catch {}

      const canonicalItems = Array.isArray(task.items) ? task.items : [];
      const count = canonicalItems.length;
      const order = Array.from({ length: count }, (_, i) => i);
      shuffleArray(order);

      const built = order.map((canonicalIndex) => {
        const item = canonicalItems[canonicalIndex] || {};
        return {
          canonicalIndex,
          prompt: item.prompt || task.prompt || `Question ${canonicalIndex + 1}`,
        };
      });

      setPresentedItems(built);

      if (Array.isArray(restoredByDisplayIdx) && restoredByDisplayIdx.length === built.length) {
        setMultiAnswersByDisplayIdx(restoredByDisplayIdx.map((v) => String(v ?? "")));
      } else {
        setMultiAnswersByDisplayIdx(new Array(built.length).fill(""));
      }

      setSingleAnswer("");
    } else {
      const initial =
        typeof answerDraft === "string" && answerDraft.length ? answerDraft : "";
      setSingleAnswer(initial);
      setPresentedItems([]);
      setMultiAnswersByDisplayIdx([]);
    }
  }, [task, hasItems, answerDraft]);

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  async function evaluateShortAnswer(payload) {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

    const res = await fetch(`${base}/api/evaluate/short-answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error("Failed to evaluate short answer");
    }

    return res.json();
  }

  const handleSubmitClick = async () => {
    if (disabled || checking || !task) return;

    if (hasItems) {
      if (!multiReady) return;
    } else {
      if (!singleReady) return;
    }

    setChecking(true);
    setReview(null);

    try {
      if (hasItems && presentedItems.length > 0) {
        const canonicalCount = task.items.length;
        const canonicalAnswers = new Array(canonicalCount).fill("");

        presentedItems.forEach((pItem, displayIdx) => {
          const val = multiAnswersByDisplayIdx[displayIdx] || "";
          canonicalAnswers[pItem.canonicalIndex] = val;
        });

        const perItemResults = [];

        for (let canonicalIndex = 0; canonicalIndex < canonicalCount; canonicalIndex += 1) {
          const item = task.items[canonicalIndex] || {};
          const studentAnswer = canonicalAnswers[canonicalIndex] || "";

          const result = await evaluateShortAnswer({
            question: item.prompt || task.prompt || `Question ${canonicalIndex + 1}`,
            studentAnswer,
            gradeLevel: task.gradeLevel || task?.config?.gradeLevel || "6-8",
            correctAnswer: item.correctAnswer || "",
            acceptableAnswers: item.acceptableAnswers || [],
          });

          perItemResults.push({
            canonicalIndex,
            prompt: item.prompt || `Question ${canonicalIndex + 1}`,
            studentAnswer,
            correct: result.correct === true,
            accepted: result.correct === true || (result.score ?? 0) >= 0.75,
            feedback: result.feedback || "",
            hint: result.hint || "",
            modelAnswer: result.modelAnswer || "",
            score: result.score ?? 0,
          });
        }

        const allCorrect =
          perItemResults.length > 0 &&
          perItemResults.every((r) => r.correct === true || r.score >= 0.75);

        const reviewPayload = {
          type: "multi-short",
          itemResults: perItemResults,
          allCorrect,
        };

        setReview(reviewPayload);
        setAttemptCount((n) => n + 1);

        if (allCorrect) {
          setShowConfetti(true);
          playSound();
          setTimeout(() => setShowConfetti(false), 3000);

          const payload = {
            kind: "multi-short-answer",
            answers: canonicalAnswers,
            review: reviewPayload,
          };

          const payloadString = JSON.stringify(payload);
          if (onAnswerChange) onAnswerChange(payloadString);
          onSubmit(payloadString);
        }
      } else {
        const result = await evaluateShortAnswer({
          question: task.prompt || task.title || "Short answer",
          studentAnswer: singleAnswer,
          gradeLevel: task.gradeLevel || task?.config?.gradeLevel || "6-8",
          correctAnswer: task.correctAnswer || "",
          acceptableAnswers: task.acceptableAnswers || [],
        });

        const accepted = result.correct === true || result.score >= 0.75;

        const reviewPayload = {
          type: "single-short",
          studentAnswer: singleAnswer,
          correct: result.correct === true,
          accepted,
          score: result.score ?? 0,
          feedback: result.feedback || "",
          hint: result.hint || "",
          modelAnswer: result.modelAnswer || "",
        };

        setReview(reviewPayload);
        setAttemptCount((n) => n + 1);

        if (result.correct === true || result.score >= 0.75) {
          setShowConfetti(true);
          playSound();
          setTimeout(() => setShowConfetti(false), 3000);

          if (onAnswerChange) onAnswerChange(singleAnswer);
          onSubmit(singleAnswer);
        }
      }
    } catch (err) {
      setReview({
        type: hasItems ? "multi-short" : "single-short",
        correct: false,
        feedback: "Could not evaluate your answer. Please try again.",
        hint: "",
        itemResults: hasItems ? [] : undefined,
      });
    } finally {
      setChecking(false);
    }
  };

  const handleSingleChange = (e) => {
    const value = e.target.value;
    setSingleAnswer(value);
    if (review) setReview(null);
    if (onAnswerChange) onAnswerChange(value);
  };

  const handleMultiChange = (displayIdx, e) => {
    const value = e.target.value;

    setMultiAnswersByDisplayIdx((prev) => {
      const next = Array.isArray(prev) ? prev.slice() : [];
      next[displayIdx] = value;
      return next;
    });

    if (review) setReview(null);

    try {
      const nextDraft = Array.isArray(multiAnswersByDisplayIdx)
        ? multiAnswersByDisplayIdx.slice()
        : [];
      nextDraft[displayIdx] = value;
      const draftPayload = JSON.stringify({
        kind: "multi-short-answer-draft",
        answersByDisplayIdx: nextDraft,
      });
      if (onAnswerChange) onAnswerChange(draftPayload);
    } catch {}
  };

  function playSound() {
    try {
      const audio = new Audio("/sounds/yay.mp3");
      audio.play().catch(() => {});
    } catch {}
  }

  const { cardBg, cardHeaderBg, cardHeaderText } = getThemeColors(theme);

  const reviewCardStyle = {
    marginTop: 12,
    background: "rgba(15,23,42,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    boxShadow: "0 14px 32px rgba(0,0,0,0.30)",
    animation: "slideUp 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)",
  };

  const waitingCard = checking ? (
    <div style={reviewCardStyle}>
      <div style={{ fontWeight: 800, textAlign: "center", fontSize: "1.1rem" }}>
        ✨ Checking your answer...
      </div>
      <div
        style={{
          marginTop: 12,
          height: "4px",
          background: "rgba(255,255,255,0.2)",
          borderRadius: 2,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            background: "linear-gradient(90deg, #ff6b6b, #ffd93d, #4ecdc4)",
            animation: "shimmer 1.5s ease-in-out infinite",
            borderRadius: 2,
          }}
        />
      </div>
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  ) : null;

  const singleReviewCard =
    !hasItems && review ? (
      <div style={reviewCardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            fontWeight: 800,
            fontSize: "1.2rem",
          }}
        >
          <div style={{ fontSize: "1.8rem" }}>
            {review.accepted ? "🎉" : "💭"}
          </div>
          <div>
            {review.accepted ? "Excellent!" : "Keep refining"}
          </div>
          {review.accepted && (
            <div style={{ marginLeft: "auto" }}>
              <AnimatedScore score={review.score} maxScore={1} />
            </div>
          )}
        </div>

        <div
          style={{
            padding: 14,
            borderRadius: 12,
            background: review.accepted
              ? "linear-gradient(135deg, rgba(20,83,45,0.5), rgba(78,205,196,0.2))"
              : "linear-gradient(135deg, rgba(127,29,29,0.5), rgba(248,113,113,0.2))",
            border: review.accepted ? "2px solid #4ade80" : "2px solid #f87171",
            color: "#ffffff",
            lineHeight: 1.6,
            fontSize: "0.95rem",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 8, fontSize: "1rem" }}>
            📝 Feedback
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {review.feedback ? (
              <div><strong>✓ What you did:</strong> {review.feedback}</div>
            ) : null}

            {review.hint ? (
              <div><strong>→ Next step:</strong> {review.hint}</div>
            ) : null}

            {review.modelAnswer ? (
              <div><strong>💡 Example answer:</strong> {review.modelAnswer}</div>
            ) : null}
          </div>
        </div>

        {!review.accepted ? (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              style={{
                background: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
                color: "#fff",
                fontWeight: 700,
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: "0.95rem",
                transition: "transform 0.2s",
              }}
              onMouseDown={(e) => (e.target.style.transform = "scale(0.95)")}
              onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
              onClick={() => setReview(null)}
            >
              ⚡ Try again
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  const multiReviewCard =
    hasItems && review ? (
      <div style={reviewCardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 16,
            fontWeight: 800,
            fontSize: "1.2rem",
          }}
        >
          <div style={{ fontSize: "1.8rem" }}>
            {review.allCorrect ? "🏆" : "📊"}
          </div>
          <div>
            {review.allCorrect ? "All correct!" : "Review your answers"}
          </div>
          {review.allCorrect && (
            <div style={{ marginLeft: "auto", fontSize: "1.1rem" }}>
              <div style={{ opacity: 0.9 }}>Perfect!</div>
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {(review.itemResults || []).map((item, i) => {
            const statusColor = item.accepted
              ? { bg: "rgba(20,83,45,0.5)", border: "#4ade80", icon: "✅" }
              : { bg: "rgba(127,29,29,0.5)", border: "#f87171", icon: "⚠️" };

            return (
              <div
                key={i}
                style={{
                  borderRadius: 12,
                  background: statusColor.bg,
                  padding: 14,
                  border: `2px solid ${statusColor.border}`,
                  animation: `slideUp 0.4s ease-out ${i * 0.1}s backwards`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 10,
                    fontWeight: 700,
                    fontSize: "1rem",
                  }}
                >
                  <span style={{ fontSize: "1.3rem" }}>{statusColor.icon}</span>
                  <span style={{ flex: 1 }}>
                    {item.accepted ? "Correct!" : "Needs work"}
                  </span>
                  {item.accepted && (
                    <div style={{ fontSize: "0.9rem", opacity: 0.9 }}>
                      {Math.round(item.score * 100)}%
                    </div>
                  )}
                </div>

                {!item.accepted ? (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 10,
                      background: "rgba(0,0,0,0.2)",
                      border: `1px solid ${statusColor.border}`,
                      color: "#ffffff",
                      lineHeight: 1.6,
                      fontSize: "0.9rem",
                    }}
                  >
                    <div style={{ display: "grid", gap: 8 }}>
                      {item.feedback ? (
                        <div><strong>✓ What you wrote:</strong> {item.feedback}</div>
                      ) : null}

                      {item.hint ? (
                        <div><strong>→ Tip:</strong> {item.hint}</div>
                      ) : null}

                      {item.modelAnswer ? (
                        <div><strong>💡 Example:</strong> {item.modelAnswer}</div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {!review.allCorrect ? (
          <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              style={{
                background: "linear-gradient(135deg, #0ea5e9, #06b6d4)",
                color: "#fff",
                fontWeight: 700,
                padding: "10px 20px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontSize: "0.95rem",
                transition: "transform 0.2s",
              }}
              onMouseDown={(e) => (e.target.style.transform = "scale(0.95)")}
              onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
              onClick={() => setReview(null)}
            >
              ⚡ Revise and retry
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  const instructionBlock = (
    <div
      style={{
        background: "linear-gradient(135deg, rgba(254,243,199,0.85), rgba(255,217,102,0.75))",
        border: "2px solid rgba(245,158,11,0.65)",
        borderRadius: 12,
        padding: "14px 16px",
        marginBottom: 14,
        boxShadow: "0 4px 12px rgba(245,158,11,0.15)",
        animation: "slideDown 0.5s ease-out",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6, fontSize: "0.95rem", display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: "1.2rem" }}>💡</span>
        How to complete this task
      </div>
      <div style={{ fontSize: "0.9rem", lineHeight: 1.5, opacity: 0.95 }}>
        Write a clear answer with <b>at least {minWords} words</b> • Use full sentences • Tap or click <b>Submit</b> when ready
      </div>
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );

  // Progress bar for multi-item tasks
  const progressBar =
    hasItems && presentedItems.length > 0
      ? (() => {
          const filledCount = multiAnswersByDisplayIdx.filter(
            (a) => wordCount(a) >= minWords
          ).length;
          const progressPercent = (filledCount / presentedItems.length) * 100;
          return (
            <div
              style={{
                marginBottom: 14,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    height: "6px",
                    background: "rgba(255,255,255,0.15)",
                    borderRadius: 3,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: "linear-gradient(90deg, #4ecdc4, #45b7d1)",
                      borderRadius: 3,
                      width: `${progressPercent}%`,
                      transition: "width 0.3s ease-out",
                      boxShadow: "0 0 12px rgba(78,205,196,0.6)",
                    }}
                  />
                </div>
              </div>
              <div
                style={{
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  background: "rgba(78,205,196,0.2)",
                  padding: "4px 10px",
                  borderRadius: 6,
                  color: "#4ecdc4",
                }}
              >
                {filledCount}/{presentedItems.length}
              </div>
            </div>
          );
        })()
      : null;

  if (hasItems && presentedItems.length > 0) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "16px",
          gap: "16px",
        }}
      >
        {showConfetti && <Confetti />}

        <div
          style={{
            borderRadius: "16px",
            boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
            background: cardBg,
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            height: "100%",
            overflow: "hidden",
          }}
        >
          <header
            style={{
              background: cardHeaderBg,
              color: cardHeaderText,
              padding: "16px",
              borderRadius: "12px",
              marginBottom: "16px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <div style={{ fontSize: "0.85rem", opacity: 0.85, fontWeight: 600 }}>
              📚 SHORT ANSWER CHALLENGE
            </div>
            <div style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: 4 }}>
              {task.title || "Explain your thinking"}
            </div>
          </header>

          {instructionBlock}
          {progressBar}

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: "14px",
              overflowY: "auto",
              paddingRight: "8px",
              marginBottom: "14px",
            }}
          >
            {presentedItems.map((pItem, displayIdx) => {
              const isFocused = focusedIndex === displayIdx;
              const hasContent = wordCount(multiAnswersByDisplayIdx[displayIdx] || "") >= minWords;

              return (
                <div
                  key={pItem.canonicalIndex}
                  style={{
                    borderRadius: "14px",
                    border: isFocused
                      ? "2px solid #45b7d1"
                      : "2px solid rgba(148,163,184,0.3)",
                    background: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,249,255,0.9))",
                    padding: "16px",
                    transition: "all 0.3s ease-out",
                    boxShadow: isFocused
                      ? "0 8px 24px rgba(69,183,209,0.2)"
                      : "0 2px 8px rgba(0,0,0,0.05)",
                    animation: `slideUp 0.4s ease-out ${displayIdx * 0.1}s backwards`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 12,
                    }}
                  >
                    <div
                      style={{
                        width: "32px",
                        height: "32px",
                        borderRadius: "8px",
                        background: "linear-gradient(135deg, #45b7d1, #4ecdc4)",
                        color: "#fff",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: "1rem",
                      }}
                    >
                      {displayIdx + 1}
                    </div>
                    <div
                      style={{
                        fontSize: "1rem",
                        fontWeight: 600,
                        flex: 1,
                        color: "#1a202c",
                      }}
                    >
                      {pItem.prompt}
                    </div>
                    {hasContent && (
                      <div style={{ fontSize: "1.2rem", animation: "pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                        ✅
                      </div>
                    )}
                  </div>

                  <textarea
                    style={{
                      width: "100%",
                      minHeight: "90px",
                      padding: "12px",
                      borderRadius: "10px",
                      border: isFocused
                        ? "2px solid #45b7d1"
                        : "1px solid rgba(148,163,184,0.5)",
                      fontSize: "0.95rem",
                      fontFamily: "inherit",
                      lineHeight: "1.5",
                      resize: "none",
                      background: "rgba(255,255,255,0.8)",
                      color: "#1a202c",
                      transition: "all 0.2s ease-out",
                      boxShadow: isFocused
                        ? "inset 0 0 8px rgba(69,183,209,0.1)"
                        : "inset 0 0 4px rgba(0,0,0,0.02)",
                    }}
                    value={multiAnswersByDisplayIdx[displayIdx] || ""}
                    onChange={(e) => handleMultiChange(displayIdx, e)}
                    onFocus={() => setFocusedIndex(displayIdx)}
                    onBlur={() => setFocusedIndex(null)}
                    disabled={disabled || checking}
                    placeholder="Share your thoughts... ✨"
                  />

                  <div
                    style={{
                      marginTop: 8,
                      fontSize: "0.8rem",
                      opacity: 0.7,
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span>
                      {wordCount(multiAnswersByDisplayIdx[displayIdx] || "")} words
                    </span>
                    {wordCount(multiAnswersByDisplayIdx[displayIdx] || "") < minWords && (
                      <span style={{ color: "#ff6b6b" }}>
                        Need {minWords - wordCount(multiAnswersByDisplayIdx[displayIdx] || "")} more
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {waitingCard}
          {multiReviewCard}

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={disabled || checking || !multiReady}
            style={{
              marginTop: "12px",
              padding: multiReady ? "14px 28px" : "14px 28px",
              fontSize: "1rem",
              fontWeight: 800,
              borderRadius: "10px",
              border: "none",
              cursor: disabled || checking || !multiReady ? "not-allowed" : "pointer",
              background: disabled
                ? "rgba(156,163,175,0.5)"
                : multiReady
                ? "linear-gradient(135deg, #ff6b6b, #ffd93d)"
                : "rgba(156,163,175,0.6)",
              color: "#fff",
              opacity: disabled || checking || !multiReady ? 0.65 : 1,
              transition: "all 0.3s ease-out",
              boxShadow: multiReady
                ? "0 8px 16px rgba(255,107,107,0.3)"
                : "0 2px 8px rgba(0,0,0,0.1)",
              alignSelf: "flex-end",
            }}
            onMouseDown={(e) =>
              multiReady &&
              !disabled &&
              !checking &&
              (e.target.style.transform = "scale(0.96)")
            }
            onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
          >
            {checking
              ? "⏳ Checking..."
              : multiReady
              ? "🚀 Submit All Answers"
              : multiMinWC === 0
              ? "📝 Answer every question"
              : `✍️ Write more (${minWords}+ words)`}
          </button>

          <style>{`
            @keyframes slideUp {
              from { opacity: 0; transform: translateY(20px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes pop {
              0% { transform: scale(0.5); }
              60% { transform: scale(1.2); }
              100% { transform: scale(1); }
            }
          `}</style>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "16px",
        gap: "16px",
      }}
    >
      {showConfetti && <Confetti />}

      <DesignatedWriter memberNames={memberNames} taskTitle={task?.title} role="answerer" />

      <div
        style={{
          borderRadius: "16px",
          boxShadow: "0 12px 32px rgba(0,0,0,0.15)",
          background: cardBg,
          padding: "20px",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            background: cardHeaderBg,
            color: cardHeaderText,
            padding: "16px",
            borderRadius: "12px",
            marginBottom: "16px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          }}
        >
          <div style={{ fontSize: "0.85rem", opacity: 0.85, fontWeight: 600 }}>
            📚 SHORT ANSWER CHALLENGE
          </div>
          <div style={{ fontSize: "1.35rem", fontWeight: 800, marginTop: 4 }}>
            {task.title || "Explain your thinking"}
          </div>
        </header>

        {instructionBlock}

        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "12px",
            overflowY: "auto",
            marginBottom: "12px",
          }}
        >
          <div
            style={{
              padding: "12px",
              borderRadius: "12px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.15)",
              fontSize: "1.05rem",
              lineHeight: "1.6",
              fontWeight: 500,
              animation: "slideDown 0.5s ease-out 0.1s backwards",
            }}
          >
            {task.prompt}
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <textarea
              style={{
                flex: 1,
                width: "100%",
                minHeight: "140px",
                padding: "16px",
                borderRadius: "12px",
                border: focusedIndex === -1
                  ? "2px solid #45b7d1"
                  : "1px solid rgba(148,163,184,0.5)",
                fontSize: "0.95rem",
                fontFamily: "inherit",
                lineHeight: "1.6",
                resize: "none",
                background: "rgba(255,255,255,0.85)",
                color: "#1a202c",
                transition: "all 0.3s ease-out",
                boxShadow: focusedIndex === -1
                  ? "0 8px 24px rgba(69,183,209,0.2), inset 0 0 8px rgba(69,183,209,0.1)"
                  : "0 2px 8px rgba(0,0,0,0.05), inset 0 0 4px rgba(0,0,0,0.02)",
              }}
              value={singleAnswer}
              onChange={handleSingleChange}
              onFocus={() => setFocusedIndex(-1)}
              onBlur={() => setFocusedIndex(null)}
              disabled={disabled || checking}
              placeholder="Share your thoughts here... ✨ Be thorough and clear!"
            />

            <div
              style={{
                marginTop: 10,
                display: "flex",
                justifyContent: "space-between",
                fontSize: "0.85rem",
                opacity: 0.75,
                padding: "0 4px",
              }}
            >
              <span style={{ fontWeight: 600 }}>
                {singleWC} words written
              </span>
              {singleWC < minWords && (
                <span style={{ color: "#ff6b6b", fontWeight: 700 }}>
                  → {minWords - singleWC} more needed
                </span>
              )}
              {singleWC >= minWords && (
                <span style={{ color: "#4ade80", fontWeight: 700 }}>
                  ✓ Ready to submit!
                </span>
              )}
            </div>
          </div>
        </div>

        {waitingCard}
        {singleReviewCard}

        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={disabled || checking || !singleReady}
          style={{
            marginTop: "12px",
            padding: singleReady ? "14px 28px" : "14px 28px",
            fontSize: "1rem",
            fontWeight: 800,
            borderRadius: "10px",
            border: "none",
            cursor: disabled || checking || !singleReady ? "not-allowed" : "pointer",
            background: disabled
              ? "rgba(156,163,175,0.5)"
              : singleReady
              ? "linear-gradient(135deg, #ff6b6b, #ffd93d)"
              : "rgba(156,163,175,0.6)",
            color: "#fff",
            opacity: disabled || checking || !singleReady ? 0.65 : 1,
            transition: "all 0.3s ease-out",
            boxShadow: singleReady
              ? "0 8px 16px rgba(255,107,107,0.3)"
              : "0 2px 8px rgba(0,0,0,0.1)",
            alignSelf: "flex-end",
          }}
          onMouseDown={(e) =>
            singleReady &&
            !disabled &&
            !checking &&
            (e.target.style.transform = "scale(0.96)")
          }
          onMouseUp={(e) => (e.target.style.transform = "scale(1)")}
        >
          {checking
            ? "⏳ Checking..."
            : singleReady
            ? "🚀 Submit Answer"
            : singleWC === 0
            ? "📝 Start typing..."
            : `✍️ Write more (${singleWC}/${minWords})`}
        </button>

        <style>{`
          @keyframes slideDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    </div>
  );
}

function getThemeColors(theme) {
  switch (theme) {
    case "bold":
      return {
        cardBg: "linear-gradient(135deg, #0f172a, #1d4ed8)",
        cardHeaderBg: "rgba(15,23,42,0.9)",
        cardHeaderText: "#f9fafb",
      };
    case "minimal":
      return {
        cardBg: "#f9fafb",
        cardHeaderBg: "#e5e7eb",
        cardHeaderText: "#111827",
      };
    default:
      return {
        cardBg: "linear-gradient(135deg, #eff6ff, #e0f2fe)",
        cardHeaderBg: "rgba(37,99,235,0.9)",
        cardHeaderText: "#f9fafb",
      };
  }
}