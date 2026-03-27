import React from "react";

export default function ShortAnswerTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
}) {
  const theme = task?.uiTheme || "modern";
  const hasItems = Array.isArray(task.items) && task.items.length > 0;

  const [presentedItems, setPresentedItems] = React.useState([]);
  const [multiAnswersByDisplayIdx, setMultiAnswersByDisplayIdx] = React.useState([]);
  const [singleAnswer, setSingleAnswer] = React.useState("");

  const [checking, setChecking] = React.useState(false);
  const [review, setReview] = React.useState(null);
  const [attemptCount, setAttemptCount] = React.useState(0);

  const singleReady =
    typeof singleAnswer === "string" && singleAnswer.trim().length >= 3;

  const multiReady =
    Array.isArray(multiAnswersByDisplayIdx) &&
    multiAnswersByDisplayIdx.length > 0 &&
    multiAnswersByDisplayIdx.every((a) => typeof a === "string" && a.trim().length > 0);

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

  const { cardBg, cardHeaderBg, cardHeaderText } = getThemeColors(theme);

  const reviewCardStyle = {
    marginTop: 12,
    background: "rgba(15,23,42,0.92)",
    border: "1px solid rgba(255,255,255,0.18)",
    borderRadius: 14,
    padding: 16,
    color: "#fff",
    boxShadow: "0 14px 32px rgba(0,0,0,0.30)",
  };

  const waitingCard = checking ? (
    <div style={reviewCardStyle}>
      <div style={{ fontWeight: 800, textAlign: "center" }}>Checking your answer...</div>
    </div>
  ) : null;

  const singleReviewCard =
    !hasItems && review ? (
      <div style={reviewCardStyle}>
        <div style={{ fontWeight: 800, marginBottom: 8 }}>
          {review.accepted ? "✅ Correct" : "❌ Not correct yet"}
        </div>

        <div
          style={{
            padding: 10,
            borderRadius: 10,
            background: review.accepted ? "#14532d" : "#7f1d1d",
            border: review.accepted ? "2px solid #4ade80" : "2px solid #f87171",
            color: "#ffffff",
            lineHeight: 1.4,
            fontSize: "0.95rem",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            Feedback
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {review.feedback ? (
              <div><strong>What you did:</strong> {review.feedback}</div>
            ) : null}

            {review.hint ? (
              <div><strong>Next step:</strong> {review.hint}</div>
            ) : null}

            {review.modelAnswer ? (
              <div><strong>Example answer:</strong> {review.modelAnswer}</div>
            ) : null}
          </div>
        </div>

        {!review.accepted ? (
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="border rounded-full px-4 py-2"
              style={{
                background: "#0ea5e9",
                color: "#fff",
                fontWeight: 700,
              }}
              onClick={() => setReview(null)}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  const multiReviewCard =
    hasItems && review ? (
      <div style={reviewCardStyle}>
        <div style={{ fontWeight: 800, marginBottom: 10 }}>
          {review.allCorrect ? "✅ Nice work" : "Review your answers"}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {(review.itemResults || []).map((item, i) => (
            <div
              key={i}
              style={{
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                padding: 12,
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ marginBottom: 6 }}>
                {item.accepted ? "✅ Correct" : "❌ Not correct yet"}
              </div>
              {!item.accepted ? (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: "#7f1d1d",
                    border: "2px solid #f87171",
                    color: "#ffffff",
                    lineHeight: 1.4,
                    fontSize: "0.95rem"
                  }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    {item.feedback ? (
                      <div><strong>What you did:</strong> {item.feedback}</div>
                    ) : null}

                    {item.hint ? (
                      <div><strong>Next step:</strong> {item.hint}</div>
                    ) : null}

                    {item.modelAnswer ? (
                      <div><strong>Example:</strong> {item.modelAnswer}</div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {!review.allCorrect ? (
          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="border rounded-full px-4 py-2"
              style={{
                background: "#0ea5e9",
                color: "#fff",
                fontWeight: 700,
              }}
              onClick={() => setReview(null)}
            >
              Revise and try again
            </button>
          </div>
        ) : null}
      </div>
    ) : null;

  const instructionBlock = (
    <div
      style={{
        background: "rgba(254,243,199,0.75)",
        border: "2px solid rgba(245,158,11,0.55)",
        borderRadius: 14,
        padding: "10px 12px",
        marginBottom: 10,
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 4 }}>How to do this task</div>
      <div style={{ fontSize: "0.95rem", lineHeight: 1.35, opacity: 0.95 }}>
        Write a clear answer. Use full sentences if you can. When you are done,
        press <b>Submit</b>.
      </div>
    </div>
  );

  if (hasItems && presentedItems.length > 0) {
    return (
      <div className="flex flex-col h-full p-3 gap-3">
        <div
          className="rounded-2xl shadow-md"
          style={{
            background: cardBg,
            padding: 16,
            display: "flex",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <header
            style={{
              background: cardHeaderBg,
              color: cardHeaderText,
              padding: "10px 14px",
              borderRadius: 14,
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>Short Answer</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
              {task.title || "Explain your thinking"}
            </div>
          </header>

          {instructionBlock}

          <div
            className="flex-1 flex flex-col gap-3 overflow-y-auto"
            style={{ paddingRight: 4 }}
          >
            {presentedItems.map((pItem, displayIdx) => (
              <div
                key={pItem.canonicalIndex}
                className="rounded-xl border"
                style={{
                  padding: 10,
                  borderColor: "rgba(15,23,42,0.08)",
                  background: "rgba(255,255,255,0.9)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.95rem",
                    fontWeight: 600,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      minWidth: 20,
                      fontWeight: 700,
                      opacity: 0.7,
                    }}
                  >
                    {displayIdx + 1}.
                  </span>{" "}
                  {pItem.prompt}
                </div>

                <textarea
                  className="border rounded-lg p-2 w-full text-sm resize-none"
                  rows={3}
                  value={multiAnswersByDisplayIdx[displayIdx] || ""}
                  onChange={(e) => handleMultiChange(displayIdx, e)}
                  disabled={disabled || checking}
                  placeholder="Type your answer here…"
                  style={{ borderColor: "rgba(148,163,184,0.8)" }}
                />
              </div>
            ))}
          </div>

          {waitingCard}
          {multiReviewCard}

          <button
            type="button"
            onClick={handleSubmitClick}
            disabled={disabled || checking || !multiReady}
            className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
            style={{
              background: disabled ? "#9ca3af" : "#0ea5e9",
              color: "#fff",
              fontWeight: 600,
              paddingInline: 20,
            }}
          >
            {checking
              ? "Checking..."
              : multiReady
              ? "Submit all answers"
              : "Answer every question"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div
        className="rounded-2xl shadow-md"
        style={{
          background: cardBg,
          padding: 16,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}
      >
        <header
          style={{
            background: cardHeaderBg,
            color: cardHeaderText,
            padding: "10px 14px",
            borderRadius: 14,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: "0.8rem", opacity: 0.9 }}>Short Answer</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 600 }}>
            {task.title || "Explain your thinking"}
          </div>
        </header>

        {instructionBlock}

        <div className="flex-1 flex flex-col gap-3 overflow-y-auto">
          <div className="font-semibold text-base max-h-40 overflow-y-auto">
            {task.prompt}
          </div>

          <textarea
            className="border rounded-lg p-2 flex-1 resize-none text-sm"
            value={singleAnswer}
            onChange={handleSingleChange}
            disabled={disabled || checking}
            placeholder="Type your answer here…"
            style={{ borderColor: "rgba(148,163,184,0.8)" }}
          />
        </div>

        {waitingCard}
        {singleReviewCard}

        <button
          type="button"
          onClick={handleSubmitClick}
          disabled={disabled || checking || !singleReady}
          className="mt-3 border rounded-full px-4 py-2 disabled:opacity-50 self-end"
          style={{
            background: disabled ? "#9ca3af" : "#0ea5e9",
            color: "#fff",
            fontWeight: 600,
            paddingInline: 20,
          }}
        >
          {checking ? "Checking..." : singleReady ? "Submit" : "Type your answer"}
        </button>
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