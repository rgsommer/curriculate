// student-app/src/components/tasks/types/VennSortTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * VennSort Task – Supports 2 or 3 overlapping circles
 * Items: 5–10 draggable words/numbers/concepts
 * Categories: 2–3 category names
 * Correct answer: { [itemId]: string[] } where string[] is a subset of categories (0–3)
 * Submission: { placements: { [itemId]: string[] } }
 * Objective scoring = true
 *
 * Zones:
 * - 2 circles: A, B, A∩B, and Pool (none)
 * - 3 circles: A, B, C, AB, AC, BC, ABC, and Pool (none)
 *
 * Notes:
 * - Uses native HTML5 drag & drop.
 * - Responsive: scales using % positioning and clamp() sizes.
 * - Review mode: shows student placements and highlights correctness when task.correctAnswer is provided.
 */

const pick = (obj, keys, fallback = null) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return fallback;
};

const makeStableId = (it, idx) => {
  const explicit = pick(it, ["id", "_id", "key"]);
  if (explicit) return explicit;

  const text = pick(it, ["text", "title", "label", "name", "value"]);
  return text ? `item-${idx}-${text.slice(0, 30)}` : `item-${idx}`;
};

const sortedCatsKey = (cats) =>
  Array.isArray(cats) ? [...cats].sort().join("|") : "";

const arraysEqualAsSets = (a, b) => {
  const ak = sortedCatsKey(a);
  const bk = sortedCatsKey(b);
  return ak === bk;
};

// Soft gradients that still look good on projector/tablets
const PILL_GRADIENTS = [
  "linear-gradient(135deg, rgba(59,130,246,0.95), rgba(147,51,234,0.95))", // blue → purple
  "linear-gradient(135deg, rgba(245,158,11,0.95), rgba(239,68,68,0.95))", // amber → red
  "linear-gradient(135deg, rgba(16,185,129,0.95), rgba(14,165,233,0.95))", // emerald → sky
  "linear-gradient(135deg, rgba(236,72,153,0.95), rgba(168,85,247,0.95))", // pink → violet
];

function Pill({ item, draggable, onDragStart, status = "neutral" }) {
  const idxHash = Math.abs(
    String(item.id || item.text || "")
      .split("")
      .reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 7)
  );
  const gradient = PILL_GRADIENTS[idxHash % PILL_GRADIENTS.length];

  const border =
    status === "correct"
      ? "2px solid rgba(34,197,94,0.9)"
      : status === "wrong"
      ? "2px solid rgba(239,68,68,0.9)"
      : "1px solid rgba(15,23,42,0.12)";

  const boxShadow =
    status === "correct"
      ? "0 8px 20px rgba(34,197,94,0.18)"
      : status === "wrong"
      ? "0 8px 20px rgba(239,68,68,0.18)"
      : "0 8px 18px rgba(2,6,23,0.10)";

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      style={{
        userSelect: "none",
        padding: "10px 14px",
        borderRadius: 999,
        color: "#ffffff",
        background: gradient,
        border,
        boxShadow,
        cursor: draggable ? "grab" : "default",
        fontWeight: 700,
        fontSize: "0.92rem",
        letterSpacing: "0.2px",
        lineHeight: 1.1,
        maxWidth: 260,
        textAlign: "center",
        whiteSpace: "normal",
        wordBreak: "break-word",
      }}
      title={item.text}
    >
      {item.text}
    </div>
  );
}

export default function VennSortTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  mode = "play", // play | review
  review = null,
}) {
  const isReview = mode === "review";
  const effectiveDisabled = !!disabled || isReview;

  // Extract categories (2 or 3)
  const categories = useMemo(() => {
    const raw = task?.config?.categories || task?.categories || [];
    const OVERLAP_WORDS = /^(both|all|overlap|intersection|shared|either|neither|none)$/i;
    const cleaned = Array.isArray(raw)
      ? raw
          .map(String)
          .map((s) => s.trim())
          .filter(Boolean)
          // Strip overlap-label pseudo-categories the AI sometimes adds
          .filter((s) => !OVERLAP_WORDS.test(s))
          .slice(0, 3)
      : [];

    // Never show a dead-end screen if the generator forgets categories.
    if (cleaned.length >= 2) return cleaned;

    // Soft fallback: keep task playable.
    return ["Group A", "Group B"];
  }, [task]);

  const numCircles = categories.length;

  // Extract items (5–10)
  const items = useMemo(() => {
    const raw = task?.config?.items || task?.options || task?.items || [];
    return Array.isArray(raw)
      ? raw
          .filter(Boolean)
          .slice(0, 10)
          .map((it, idx) => {
            if (typeof it === "string") {
              return { id: makeStableId({ text: it }, idx), text: it };
            }
            const id = makeStableId(it, idx);
            const text = pick(
              it,
              ["text", "title", "label", "name", "value"],
              `Item ${idx + 1}`
            );
            const imageUrl = pick(it, ["imageUrl", "image", "img"]);
            return { id, text, imageUrl };
          })
      : [];
  }, [task]);

  // Correct answer map (optional but recommended for objective scoring)
  const correctAnswer = useMemo(() => {
    const raw =
      (task?.correctAnswer &&
        typeof task.correctAnswer === "object" &&
        task.correctAnswer) ||
      (task?.config?.correctAnswer &&
        typeof task.config.correctAnswer === "object" &&
        task.config.correctAnswer) ||
      null;

    if (!raw) return null;

    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!k) continue;
      const arr = Array.isArray(v)
        ? v.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      out[String(k)] = [...new Set(arr)].sort();
    }
    return out;
  }, [task]);

  // Initial placements: prefer answerDraft, then review, else pool
  const initialPlacements = useMemo(() => {
    const src =
      (answerDraft?.placements &&
        typeof answerDraft.placements === "object" &&
        answerDraft.placements) ||
      (review?.placements && typeof review.placements === "object" && review.placements) ||
      (review?.studentAnswer?.placements &&
        typeof review.studentAnswer.placements === "object" &&
        review.studentAnswer.placements) ||
      null;

    const init = {};
    for (const item of items) {
      const val = src?.[item.id];
      const arr = Array.isArray(val)
        ? val.map(String).map((s) => s.trim()).filter(Boolean)
        : [];
      init[item.id] = arr.filter((c) => categories.includes(c)).sort();
    }
    return init;
  }, [answerDraft, review, items, categories]);

  const [placements, setPlacements] = useState(initialPlacements);

  // Reset on new task / items / categories
  useEffect(() => {
    setPlacements(initialPlacements);
    onAnswerChange?.({ placements: initialPlacements });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?._id, items.length, categories.join("|")]);

  // Drag state / hover highlight
  const [hoverZone, setHoverZone] = useState(null);
  const dragItemIdRef = useRef(null);

  const handleDragStart = (e, itemId) => {
    if (effectiveDisabled) return;
    dragItemIdRef.current = itemId;
    e.dataTransfer.setData("text/plain", itemId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const placeItem = (itemId, targetCategories) => {
    const normalized = [...new Set(targetCategories)]
      .map(String)
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((c) => categories.includes(c))
      .sort();

    setPlacements((prev) => {
      const next = { ...prev, [itemId]: normalized };
      onAnswerChange?.({ placements: next });
      return next;
    });
  };

  const handleDrop = (e, targetCategories) => {
    e.preventDefault();
    if (effectiveDisabled) return;

    const itemId =
      e.dataTransfer.getData("text/plain") || dragItemIdRef.current || null;
    if (!itemId) return;

    placeItem(itemId, targetCategories);
    setHoverZone(null);
  };

  const getItemsInZone = (zoneCats) => {
    const key = sortedCatsKey(zoneCats);
    return items.filter((item) => sortedCatsKey(placements[item.id]) === key);
  };

  const itemStatus = (itemId) => {
    if (!isReview || !correctAnswer) return "neutral";
    const expected = correctAnswer[itemId] || [];
    const got = placements[itemId] || [];
    return arraysEqualAsSets(expected, got) ? "correct" : "wrong";
  };

  const handleSubmit = () => {
    if (effectiveDisabled) return;
    onSubmit?.({ placements, completed: true });
  };

  if (numCircles < 2 || numCircles > 3) {
    return (
      <div className="p-6 text-center text-red-600">
        Invalid VennSort: must have 2 or 3 categories.
      </div>
    );
  }

  // Layout numbers tuned for tablets + responsive scaling
  const circleSize = "clamp(220px, 36vw, 320px)";
  const overlapSoft = "rgba(2,6,23,0.08)";

  // Circle positions (percent-based)
  const circlePos =
    numCircles === 2
      ? {
          A: { left: "16%", top: "18%" },
          B: { left: "46%", top: "18%" },
          AB: {
            left: "36%",
            top: "24%",
            w: "clamp(140px, 18vw, 190px)",
            h: "clamp(180px, 22vw, 230px)",
          },
        }
      : {
          A: { left: "12%", top: "16%" },
          B: { left: "52%", top: "16%" },
          C: { left: "32%", top: "46%" },
          AB: {
            left: "36%",
            top: "22%",
            w: "clamp(150px, 18vw, 210px)",
            h: "clamp(190px, 22vw, 250px)",
          },
          AC: {
            left: "24%",
            top: "44%",
            w: "clamp(150px, 18vw, 210px)",
            h: "clamp(150px, 18vw, 210px)",
          },
          BC: {
            left: "56%",
            top: "44%",
            w: "clamp(150px, 18vw, 210px)",
            h: "clamp(150px, 18vw, 210px)",
          },
          ABC: {
            left: "44.5%",
            top: "44%",
            w: "clamp(115px, 12vw, 150px)",
            h: "clamp(115px, 12vw, 150px)",
          },
        };

  const circleStyleBase = {
    position: "absolute",
    width: circleSize,
    height: circleSize,
    borderRadius: "999px",
    border: "3px solid rgba(2,6,23,0.20)",
    backdropFilter: "blur(2px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "12px 10px 10px",
    overflow: "visible",
  };

  const circleHeaderStyle = {
    width: "100%",
    textAlign: "center",
    fontWeight: 900,
    letterSpacing: "0.2px",
    fontSize: "1.05rem",
    paddingBottom: 6,
    textShadow: "0 1px 0 rgba(255,255,255,0.35)",
  };

  const dropHighlight = (zoneId) =>
    hoverZone === zoneId
      ? { outline: "4px solid rgba(14,165,233,0.65)", outlineOffset: 2 }
      : null;

  const renderZoneItems = (zoneCats) => {
    const list = getItemsInZone(zoneCats);
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "center",
          alignItems: "center",
          padding: 10,
          width: "100%",
        }}
      >
        {list.map((item) => (
          <Pill
            key={item.id}
            item={item}
            draggable={!effectiveDisabled}
            onDragStart={(e) => handleDragStart(e, item.id)}
            status={itemStatus(item.id)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="p-3 max-w-5xl mx-auto">
      <div style={{ marginBottom: 10 }}>
        <div
          style={{
            fontWeight: 900,
            fontSize: "1.15rem",
            textAlign: "center",
            marginBottom: 6,
          }}
        >
          {task?.prompt || "Sort the items into the Venn diagram"}
        </div>

        <div
          style={{
            textAlign: "center",
            fontSize: "0.92rem",
            color: "rgba(15,23,42,0.72)",
          }}
        >
          Drag each pill into the best region — overlaps mean it belongs to BOTH / ALL categories.
          <br />
          You may leave items in the pool if they belong nowhere.
          {isReview && (
            <span style={{ marginLeft: 8, fontWeight: 800 }}>(Review mode)</span>
          )}
        </div>
      </div>

      {/* Diagram */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: numCircles === 2 ? "2 / 1" : "1 / 1",
          maxHeight: "60vh",
          margin: "0 auto",
          borderRadius: 18,
          background:
            "linear-gradient(180deg, rgba(248,250,252,1), rgba(241,245,249,1))",
          border: "1px solid rgba(2,6,23,0.10)",
          overflow: "visible",
        }}
      >
        {/* Circle A */}
        <div
          style={{
            ...circleStyleBase,
            left: circlePos.A.left,
            top: circlePos.A.top,
            background:
              "radial-gradient(circle at 30% 30%, rgba(59,130,246,0.38), rgba(59,130,246,0.10) 55%, rgba(255,255,255,0.0) 75%)",
            ...dropHighlight("A"),
          }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, [categories[0]])}
          onDragEnter={() => !effectiveDisabled && setHoverZone("A")}
          onDragLeave={() => setHoverZone(null)}
        >
          <div style={{ ...circleHeaderStyle, color: "rgba(30,58,138,0.95)" }}>
            {categories[0]}
          </div>
          {renderZoneItems([categories[0]])}
        </div>

        {/* Circle B */}
        <div
          style={{
            ...circleStyleBase,
            left: circlePos.B.left,
            top: circlePos.B.top,
            background:
              "radial-gradient(circle at 70% 30%, rgba(245,158,11,0.40), rgba(245,158,11,0.10) 55%, rgba(255,255,255,0.0) 75%)",
            ...dropHighlight("B"),
          }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, [categories[1]])}
          onDragEnter={() => !effectiveDisabled && setHoverZone("B")}
          onDragLeave={() => setHoverZone(null)}
        >
          <div style={{ ...circleHeaderStyle, color: "rgba(124,45,18,0.95)" }}>
            {categories[1]}
          </div>
          {renderZoneItems([categories[1]])}
        </div>

        {/* Circle C (only for 3 circles) */}
        {numCircles === 3 && (
          <div
            style={{
              ...circleStyleBase,
              left: circlePos.C.left,
              top: circlePos.C.top,
              background:
                "radial-gradient(circle at 40% 75%, rgba(239,68,68,0.38), rgba(239,68,68,0.10) 55%, rgba(255,255,255,0.0) 75%)",
              ...dropHighlight("C"),
            }}
            onDragOver={handleDragOver}
            onDrop={(e) => handleDrop(e, [categories[2]])}
            onDragEnter={() => !effectiveDisabled && setHoverZone("C")}
            onDragLeave={() => setHoverZone(null)}
          >
            <div style={{ ...circleHeaderStyle, color: "rgba(127,29,29,0.95)" }}>
              {categories[2]}
            </div>
            {renderZoneItems([categories[2]])}
          </div>
        )}

        {/* Overlap zones as soft drop targets */}
        {/* AB */}
        <div
          style={{
            position: "absolute",
            left: circlePos.AB.left,
            top: circlePos.AB.top,
            width: circlePos.AB.w,
            height: circlePos.AB.h,
            borderRadius: 999,
            background: `rgba(147,51,234,0.12)`,
            border: `2px dashed ${overlapSoft}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...dropHighlight("AB"),
          }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, [categories[0], categories[1]])}
          onDragEnter={() => !effectiveDisabled && setHoverZone("AB")}
          onDragLeave={() => setHoverZone(null)}
        >
          {renderZoneItems([categories[0], categories[1]])}
        </div>

        {/* 3-circle overlaps */}
        {numCircles === 3 && (
          <>
            {/* AC */}
            <div
              style={{
                position: "absolute",
                left: circlePos.AC.left,
                top: circlePos.AC.top,
                width: circlePos.AC.w,
                height: circlePos.AC.h,
                borderRadius: 999,
                background: `rgba(16,185,129,0.12)`,
                border: `2px dashed ${overlapSoft}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...dropHighlight("AC"),
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, [categories[0], categories[2]])}
              onDragEnter={() => !effectiveDisabled && setHoverZone("AC")}
              onDragLeave={() => setHoverZone(null)}
            >
              {renderZoneItems([categories[0], categories[2]])}
            </div>

            {/* BC */}
            <div
              style={{
                position: "absolute",
                left: circlePos.BC.left,
                top: circlePos.BC.top,
                width: circlePos.BC.w,
                height: circlePos.BC.h,
                borderRadius: 999,
                background: `rgba(249,115,22,0.12)`,
                border: `2px dashed ${overlapSoft}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...dropHighlight("BC"),
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, [categories[1], categories[2]])}
              onDragEnter={() => !effectiveDisabled && setHoverZone("BC")}
              onDragLeave={() => setHoverZone(null)}
            >
              {renderZoneItems([categories[1], categories[2]])}
            </div>

            {/* ABC */}
            <div
              style={{
                position: "absolute",
                left: circlePos.ABC.left,
                top: circlePos.ABC.top,
                width: circlePos.ABC.w,
                height: circlePos.ABC.h,
                borderRadius: 999,
                background: "rgba(2,6,23,0.14)",
                border: `2px dashed ${overlapSoft}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                ...dropHighlight("ABC"),
              }}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, [categories[0], categories[1], categories[2]])}
              onDragEnter={() => !effectiveDisabled && setHoverZone("ABC")}
              onDragLeave={() => setHoverZone(null)}
            >
              {renderZoneItems([categories[0], categories[1], categories[2]])}
            </div>
          </>
        )}

      </div>

      {/* Pool (unplaced) — below the diagram */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 16,
          border: "2px dashed rgba(100,116,139,0.60)",
          background: "rgba(241,245,249,0.92)",
          boxShadow: "0 4px 14px rgba(2,6,23,0.07)",
          ...dropHighlight("POOL"),
        }}
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, [])}
        onDragEnter={() => !effectiveDisabled && setHoverZone("POOL")}
        onDragLeave={() => setHoverZone(null)}
      >
        <div
          style={{
            textAlign: "center",
            fontSize: "0.85rem",
            fontWeight: 800,
            color: "rgba(51,65,85,0.95)",
            marginBottom: 10,
          }}
        >
          Pool (belongs nowhere)
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center" }}>
          {getItemsInZone([]).map((item) => (
            <Pill
              key={item.id}
              item={item}
              draggable={!effectiveDisabled}
              onDragStart={(e) => handleDragStart(e, item.id)}
              status={itemStatus(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Submit */}
      <div style={{ marginTop: 14, display: "flex", justifyContent: "center" }}>
        <button
          type="button"
          disabled={effectiveDisabled}
          onClick={handleSubmit}
          style={{
            padding: "10px 18px",
            borderRadius: 999,
            border: "none",
            background: effectiveDisabled ? "rgba(148,163,184,1)" : "rgba(22,163,74,1)",
            color: "#ffffff",
            fontWeight: 900,
            fontSize: "0.95rem",
            letterSpacing: "0.2px",
            cursor: effectiveDisabled ? "not-allowed" : "pointer",
            boxShadow: "0 10px 22px rgba(22,163,74,0.18)",
          }}
        >
          {isReview ? "Reviewed" : "Submit Answer"}
        </button>
      </div>
    </div>
  );
}
