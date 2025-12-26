import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * PhysicalMultipleChoiceTask
 *
 * Behaves like a standard MultipleChoiceTask visually, but submission requires scanning
 * one of 8 permanent colored QR stations. Each question randomizes (deterministically)
 * which 4 colors map to A/B/C/D.
 *
 * Compatibility:
 * - Single-question (legacy): task.prompt + task.options
 *   -> onSubmit(optionString)
 * - Multi-question: task.items[] of { prompt, options, correctAnswer? }
 *   -> onSubmit(JSON.stringify({ kind:"physical-multi-mc", answers:[...], ... }))
 *
 * Scan input:
 * - Listens for window event: "curriculate:stationScan" with detail { color: "Purple" }
 * - You can also emit socket events in TaskRunner and forward them via window event,
 *   or pass a scan via props (see `externalScanColor`).
 */
export default function PhysicalMultipleChoiceTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,

  // optional: if TaskRunner wants to pass a scan directly
  externalScanColor = null,

  // NEW
  mode = "play", // "play" | "review"
  review = null,
}) {
  const isReview = mode === "review";

  const stationPalette = useMemo(() => {
    const fromTask = Array.isArray(task?.stationColors) ? task.stationColors : null;
    return (fromTask && fromTask.length >= 8
      ? fromTask
      : ["Red", "Orange", "Yellow", "Green", "Blue", "Teal", "Purple", "Pink"]
    ).slice(0, 8);
  }, [task?.stationColors]);

  const items = useMemo(() => {
    if (Array.isArray(task?.items) && task.items.length > 0) return task.items;
    // Normalize single-question into 1-item list for rendering (submission stays legacy-compatible)
    const prompt = task?.prompt ?? "";
    const options = Array.isArray(task?.options) ? task.options : [];
    return [{ prompt, options, __single: true }];
  }, [task]);

  const isSingle = items.length === 1 && items[0]?.__single;

  // ---------- seeded helpers (copied spirit from MultipleChoiceTask.jsx) ----------
  function getTeamSalt() {
    try {
      return (
        localStorage.getItem("teamId") ||
        localStorage.getItem("curriculateTeamId") ||
        localStorage.getItem("activeclass_teamId") ||
        ""
      );
    } catch {
      return "";
    }
  }

  function hashStringToSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function seededPickUnique(arr, k, seed) {
    const rng = mulberry32(seed);
    const pool = [...arr];
    // Fisher-Yates partial
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, Math.max(0, Math.min(k, pool.length)));
  }

  const [qIndex, setQIndex] = useState(0);
  const [selectedLetterByQ, setSelectedLetterByQ] = useState(() => ({})); // { [idx]: "A"|"B"|"C"|"D" }
  const [submittedByQ, setSubmittedByQ] = useState(() => ({})); // { [idx]: true }
  const lastScanRef = useRef(null);

  // Deterministic color mapping per question
  const colorMapByQ = useMemo(() => {
    const baseSeed = hashStringToSeed(
      `${task?._id || task?.id || task?.title || "task"}|${getTeamSalt()}|physical-mc|`
    );
    const maps = [];
    for (let i = 0; i < items.length; i++) {
      const picked = seededPickUnique(stationPalette, 4, (baseSeed + i * 1013) >>> 0);
      maps.push({
        A: picked[0] || stationPalette[0],
        B: picked[1] || stationPalette[1],
        C: picked[2] || stationPalette[2],
        D: picked[3] || stationPalette[3],
      });
    }
    return maps;
  }, [items.length, stationPalette, task?._id, task?.id, task?.title]);

  // Helper to get current item/options
  const current = items[qIndex] || {};
  const prompt = String(current?.prompt ?? "");
  const options = Array.isArray(current?.options) ? current.options : Array.isArray(task?.options) ? task.options : [];

  const letters = ["A", "B", "C", "D"];
  const currentMap = colorMapByQ[qIndex] || { A: stationPalette[0], B: stationPalette[1], C: stationPalette[2], D: stationPalette[3] };

  // Review correctness helpers (best-effort)
  const correctIndex = (() => {
    const ca = current?.correctAnswer;
    if (typeof ca === "number" && ca >= 0 && ca <= 3) return ca;
    if (typeof ca === "string") {
      const s = ca.trim().toLowerCase();
      if (s === "a") return 0;
      if (s === "b") return 1;
      if (s === "c") return 2;
      if (s === "d") return 3;
    }
    // if review object carries canonical answer per item
    const r = review?.answers?.[qIndex];
    if (typeof r?.correctIndex === "number") return r.correctIndex;
    return null;
  })();

  function selectedIdxForQ(i) {
    const L = selectedLetterByQ[i];
    const di = letters.indexOf(L);
    return di >= 0 ? di : null;
  }

  function recordDraft() {
    // Keep TaskRunner "answerDraft" updated for session persistence
    try {
      const payload = {
        kind: "physical-mc-draft",
        qIndex,
        selectedLetterByQ,
        submittedByQ,
      };
      const s = JSON.stringify(payload);
      if (onAnswerChange) onAnswerChange(s);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    recordDraft();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, selectedLetterByQ, submittedByQ]);

  // Restore from answerDraft if present
  useEffect(() => {
    if (!answerDraft) return;
    try {
      const parsed = JSON.parse(answerDraft);
      if (parsed?.kind !== "physical-mc-draft") return;
      if (typeof parsed.qIndex === "number") setQIndex(Math.max(0, Math.min(items.length - 1, parsed.qIndex)));
      if (parsed.selectedLetterByQ && typeof parsed.selectedLetterByQ === "object") setSelectedLetterByQ(parsed.selectedLetterByQ);
      if (parsed.submittedByQ && typeof parsed.submittedByQ === "object") setSubmittedByQ(parsed.submittedByQ);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function normalizeColor(c) {
    return String(c || "").trim().toLowerCase();
  }

  function colorToCssName(c) {
    const s = normalizeColor(c);
    // pragmatic mapping; if your design system has exact hexes, swap here.
    if (s === "red") return "#ef4444";
    if (s === "orange") return "#f97316";
    if (s === "yellow") return "#eab308";
    if (s === "green") return "#22c55e";
    if (s === "blue") return "#3b82f6";
    if (s === "teal") return "#14b8a6";
    if (s === "purple") return "#a855f7";
    if (s === "pink") return "#ec4899";
    // fallback
    return "#94a3b8"; // slate-400
  }

  function handleSelectLetter(letter) {
    if (disabled || isReview) return;
    setSelectedLetterByQ((prev) => ({ ...prev, [qIndex]: letter }));
  }

  function advanceOrFinish(finalSelectedLetterByQ) {
    const done = Object.keys(finalSelectedLetterByQ || selectedLetterByQ).length >= items.length &&
      letters.every((L) => true); // no-op; answers validation is below

    if (qIndex < items.length - 1) {
      setQIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }

    // Submit final payload
    if (!onSubmit) return;

    if (isSingle) {
      const letter = (finalSelectedLetterByQ || selectedLetterByQ)[0];
      const idx = letters.indexOf(letter);
      const value = idx >= 0 && options[idx] != null ? String(options[idx]) : "";
      if (onAnswerChange) onAnswerChange(value);
      onSubmit(value);
      return;
    }

    const answers = [];
    for (let i = 0; i < items.length; i++) {
      const letter = (finalSelectedLetterByQ || selectedLetterByQ)[i];
      const idx = letters.indexOf(letter);
      const opt = Array.isArray(items[i]?.options) ? items[i].options : [];
      answers.push({
        itemIndex: i,
        letter: letter || null,
        selectedIndex: idx >= 0 ? idx : null,
        selectedText: idx >= 0 && opt[idx] != null ? String(opt[idx]) : "",
        stationColor: letter ? (colorMapByQ[i]?.[letter] || null) : null,
      });
    }

    const payload = {
      kind: "physical-multi-mc",
      taskType: task?.taskType || "physical-multiple-choice",
      answers,
      colorMapByQuestion: colorMapByQ,
      stationColors: stationPalette,
    };

    const payloadString = JSON.stringify(payload);
    if (onAnswerChange) onAnswerChange(payloadString);
    onSubmit(payloadString);
  }

  function attemptScanSubmit(colorRaw) {
    if (disabled || isReview) return;
    const color = normalizeColor(colorRaw);
    if (!color) return;

    const key = `${qIndex}:${color}`;
    if (lastScanRef.current === key) return;
    lastScanRef.current = key;

    // Determine which letter this color corresponds to in this question
    const foundLetter =
      letters.find((L) => normalizeColor(currentMap[L]) === color) || null;

    if (!foundLetter) return;

    // If student already selected a letter, require that the scanned station matches it.
    const selected = selectedLetterByQ[qIndex] || null;
    const letterToSubmit = selected || foundLetter;

    // If they selected something else, ignore scan (forces intentional movement)
    if (selected && selected !== foundLetter) return;

    // Mark submitted and advance
    const nextSelected = { ...selectedLetterByQ, [qIndex]: letterToSubmit };
    setSelectedLetterByQ(nextSelected);
    setSubmittedByQ((prev) => ({ ...prev, [qIndex]: true }));

    // Small delay so UI can flash "submitted"
    setTimeout(() => {
      advanceOrFinish(nextSelected);
    }, 150);
  }

  // Listen for browser event scans
  useEffect(() => {
    function onScan(ev) {
      const color = ev?.detail?.color;
      attemptScanSubmit(color);
    }
    window.addEventListener("curriculate:stationScan", onScan);
    return () => window.removeEventListener("curriculate:stationScan", onScan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qIndex, disabled, isReview, selectedLetterByQ, currentMap]);

  // React to externalScanColor prop
  useEffect(() => {
    if (!externalScanColor) return;
    attemptScanSubmit(externalScanColor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalScanColor]);

  // ---------- UI styling (kept consistent with modern Curriculate card vibe) ----------
  const card = {
    background: "linear-gradient(180deg, rgba(17,24,39,0.96), rgba(17,24,39,0.92))",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 18,
    padding: 18,
    color: "#e5e7eb",
    boxShadow: "0 16px 40px rgba(0,0,0,0.28)",
  };

  const pill = (bg) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    background: bg,
    border: "1px solid rgba(255,255,255,0.10)",
    fontSize: 12,
    color: "#e5e7eb",
  });

  const optionStyle = (selected, isCorrectPaint, isWrongPaint) => {
    if (isReview && isCorrectPaint) {
      return {
        background: "#dcfce7",
        color: "#064e3b",
        borderColor: "#22c55e",
      };
    }
    if (isReview && isWrongPaint) {
      return {
        background: "#fee2e2",
        color: "#7f1d1d",
        borderColor: "#dc2626",
      };
    }
    return {
      background: selected ? "rgba(99,102,241,0.95)" : "rgba(255,255,255,0.06)",
      color: selected ? "#ffffff" : "#e5e7eb",
      borderColor: selected ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.12)",
    };
  };

  const selectedLetter = selectedLetterByQ[qIndex] || null;
  const submitted = !!submittedByQ[qIndex];

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={pill("rgba(99,102,241,0.18)")}>
            🏃 Physical Multiple Choice
          </span>
          {!isSingle && (
            <span style={pill("rgba(255,255,255,0.06)")}>
              Question {qIndex + 1} / {items.length}
            </span>
          )}
        </div>

        {!isReview && (
          <span style={pill(submitted ? "rgba(34,197,94,0.20)" : "rgba(251,191,36,0.18)")}>
            {submitted ? "Submitted ✓" : "Scan station to submit"}
          </span>
        )}
      </div>

      <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.25, marginBottom: 14, color: "#ffffff" }}>
        {task?.title ? <span style={{ opacity: 0.75, marginRight: 10 }}>{task.title}</span> : null}
      </div>

      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.35, marginBottom: 14 }}>
        {prompt || "—"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
        {letters.map((L, idx) => {
          const text = options[idx] != null ? String(options[idx]) : "";
          const chosen = selectedLetter === L;

          const isCorrectPaint = isReview && correctIndex != null && idx === correctIndex;
          const isWrongPaint =
            isReview &&
            correctIndex != null &&
            selectedIdxForQ(qIndex) != null &&
            idx === selectedIdxForQ(qIndex) &&
            idx !== correctIndex;

          const sty = optionStyle(chosen, isCorrectPaint, isWrongPaint);

          const cName = currentMap[L];
          const dot = colorToCssName(cName);

          return (
            <button
              key={L}
              type="button"
              onClick={() => handleSelectLetter(L)}
              disabled={disabled || isReview}
              style={{
                width: "100%",
                textAlign: "left",
                cursor: disabled || isReview ? "default" : "pointer",
                borderRadius: 16,
                border: `1px solid ${sty.borderColor}`,
                padding: "14px 14px",
                transition: "transform 120ms ease, box-shadow 120ms ease",
                boxShadow: chosen ? "0 10px 26px rgba(99,102,241,0.35)" : "0 8px 18px rgba(0,0,0,0.18)",
                transform: chosen ? "translateY(-1px)" : "translateY(0px)",
                background: sty.background,
                color: sty.color,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 12,
                    background: "rgba(0,0,0,0.20)",
                    border: "1px solid rgba(255,255,255,0.14)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                  }}
                >
                  {L}
                </div>

                <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25 }}>
                  {text || <span style={{ opacity: 0.6 }}>(missing option)</span>}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                <div
                  title={`${L} → ${cName}`}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    background: dot,
                    boxShadow: "0 0 0 3px rgba(255,255,255,0.12)",
                  }}
                />
                <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.9 }}>
                  {cName}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {!isReview && (
        <div style={{ marginTop: 14, fontSize: 13, opacity: 0.85, lineHeight: 1.35 }}>
          <b>How to submit:</b> choose A–D, then walk to the station color shown beside that option and scan its QR code.
          {selectedLetter ? (
            <span>
              {" "}You’ve selected <b>{selectedLetter}</b> — scan <b>{currentMap[selectedLetter]}</b>.
            </span>
          ) : (
            <span> You can also scan first — scanning a mapped color will select & submit automatically.</span>
          )}
        </div>
      )}
    </div>
  );
}
