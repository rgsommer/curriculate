// student-app/src/components/tasks/types/CollaborationTask.jsx
//
// Team Collab — single-device, multiple-player attribution.
// Each player on the team has a name bubble at the top.  As the team
// writes their response (one bullet per row), they tap or drag the
// player's bubble onto the bullet to attribute it.  Engagement score
// rises with the breadth of attribution (more unique contributors).
//
// Reply phase (partnerAnswer) keeps the original single-textarea UI.

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { getPlayerName } from "../../../utils/playerName";
import { TaskCardFrame, Pill, PrimaryButton, GhostButton, TextArea } from "../taskStyles";

let __pid = 0;
const nextPointId = () => `pt_${Date.now()}_${++__pid}`;

// Stable hue per name so each bubble has its own colour.
function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

function bubbleStyle(name, { selected = false, small = false } = {}) {
  const hue = hashHue(name || "?");
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: small ? "4px 10px" : "8px 14px",
    borderRadius: 999,
    background: `hsl(${hue}, 75%, 92%)`,
    border: `2px solid ${selected ? `hsl(${hue}, 65%, 50%)` : `hsl(${hue}, 65%, 70%)`}`,
    color: `hsl(${hue}, 60%, 28%)`,
    fontSize: small ? 12 : 14,
    fontWeight: 900,
    boxShadow: selected ? `0 0 0 3px hsl(${hue}, 65%, 75%)` : "0 2px 4px rgba(0,0,0,0.06)",
    cursor: "grab",
    userSelect: "none",
    transform: selected ? "scale(1.08)" : "scale(1)",
    transition: "transform 0.12s ease, box-shadow 0.12s ease",
  };
}

export default function CollaborationTask({
  task,
  onSubmit,
  disabled,
  onAnswerChange,
  answerDraft,
  partnerAnswer,
  showPartnerReply,
  onPartnerReply,
  memberNames = [],
  practiceMode = false,
}) {
  // In practice mode, manufacture three "bot teammates" so the
  // simulator actually demonstrates the multi-player attribution
  // experience (otherwise there's only one bubble to drag, which
  // testers found pointless).  Real classroom / conference sessions
  // fall through to the actual roster.
  const PRACTICE_BOTS = ["Paul (bot)", "Bernadette (bot)"];
  const safeMembers = useMemo(() => {
    const real = (Array.isArray(memberNames) ? memberNames : [])
      .map((n) => String(n || "").trim())
      .filter(Boolean);
    if (practiceMode) {
      const me = real[0] || getPlayerName();
      return [me, ...PRACTICE_BOTS];
    }
    return real;
  }, [memberNames, practiceMode]);
  const hasMembers = safeMembers.length > 0;

  // Structured points the team is composing.  Each point has its
  // own text + a list of attributed contributors.  Hydrated from
  // answerDraft on first mount so refresh / re-mount keeps work.
  const [points, setPoints] = useState(() => {
    if (Array.isArray(answerDraft?.points) && answerDraft.points.length > 0) {
      return answerDraft.points;
    }
    return [{ id: nextPointId(), text: "", contributors: [] }];
  });
  const [reply, setReply] = useState(answerDraft?.reply || "");

  // Selected bubble (tap-to-pick): tap a bubble, then tap a point
  // to attribute. Same effect as drag-and-drop, friendlier on touch.
  const [selectedName, setSelectedName] = useState(null);

  useEffect(() => {
    setReply(answerDraft?.reply || "");
  }, [task?.id, answerDraft?.reply]);

  // Keep parent answerDraft in sync.
  useEffect(() => {
    if (!onAnswerChange) return;
    const main = points.map((p) => p.text.trim()).filter(Boolean).join("\n");
    onAnswerChange({ main, points, reply });
  }, [points, reply]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------------------------------------------------------------ */
  /*  Point editing                                                     */
  /* ------------------------------------------------------------------ */
  const updatePointText = useCallback((id, text) => {
    setPoints((prev) => prev.map((p) => (p.id === id ? { ...p, text } : p)));
  }, []);

  const removePoint = useCallback((id) => {
    setPoints((prev) =>
      prev.length === 1
        ? [{ id: nextPointId(), text: "", contributors: [] }] // keep one row visible
        : prev.filter((p) => p.id !== id)
    );
  }, []);

  const addPoint = useCallback(() => {
    setPoints((prev) => [
      ...prev,
      { id: nextPointId(), text: "", contributors: [] },
    ]);
  }, []);

  const toggleContributor = useCallback((pointId, name) => {
    if (!name) return;
    setPoints((prev) =>
      prev.map((p) => {
        if (p.id !== pointId) return p;
        const has = p.contributors.includes(name);
        return {
          ...p,
          contributors: has
            ? p.contributors.filter((n) => n !== name)
            : [...p.contributors, name],
        };
      })
    );
  }, []);

  /* ------------------------------------------------------------------ */
  /*  Drag-and-drop (HTML5)                                             */
  /* ------------------------------------------------------------------ */
  const onBubbleDragStart = (e, name) => {
    try {
      e.dataTransfer.setData("text/plain", name);
      e.dataTransfer.effectAllowed = "copy";
    } catch {}
  };
  const onPointDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onPointDrop = (e, pointId) => {
    e.preventDefault();
    let name = "";
    try { name = e.dataTransfer.getData("text/plain") || ""; } catch {}
    if (!name) name = selectedName || "";
    if (!name) return;
    setPoints((prev) =>
      prev.map((p) => {
        if (p.id !== pointId) return p;
        if (p.contributors.includes(name)) return p; // already attributed
        return { ...p, contributors: [...p.contributors, name] };
      })
    );
  };

  /* ------------------------------------------------------------------ */
  /*  Tap-to-attribute (mobile-friendly alternative to drag)            */
  /* ------------------------------------------------------------------ */
  const handleBubbleTap = (name) => {
    if (disabled) return;
    setSelectedName((cur) => (cur === name ? null : name));
  };
  const handlePointTap = (pointId) => {
    if (!selectedName) return;
    toggleContributor(pointId, selectedName);
    setSelectedName(null);
  };

  /* ------------------------------------------------------------------ */
  /*  Submit                                                            */
  /* ------------------------------------------------------------------ */
  const writtenPoints = points.filter((p) => p.text.trim().length > 0);
  const canSubmitMain = writtenPoints.length > 0;

  // Engagement score: % of written points that have at least one
  // contributor attributed to them, plus a bonus for the breadth of
  // unique contributors used.
  const attributedPoints = writtenPoints.filter((p) => p.contributors.length > 0).length;
  const uniqueContributors = new Set(
    writtenPoints.flatMap((p) => p.contributors)
  ).size;
  const engagementPct = (() => {
    if (writtenPoints.length === 0) return 0;
    const attrShare = attributedPoints / writtenPoints.length;
    const breadth = hasMembers
      ? Math.min(1, uniqueContributors / Math.max(1, safeMembers.length))
      : 0;
    return Math.round(100 * (0.7 * attrShare + 0.3 * breadth));
  })();

  // Per-player contribution count.  Tester wanted to see "Richard 1,
  // Paul 0, Bernadette 0" instead of a single 1/1 fraction.
  const perMemberCount = useMemo(() => {
    const map = Object.fromEntries(safeMembers.map((n) => [n, 0]));
    writtenPoints.forEach((p) =>
      p.contributors.forEach((n) => {
        if (n in map) map[n] += 1;
        else map[n] = (map[n] || 0) + 1; // mark non-roster names too
      })
    );
    return map;
  }, [safeMembers, writtenPoints]);

  const handleMainSubmit = () => {
    if (disabled || !canSubmitMain) return;
    const main = writtenPoints.map((p) => p.text.trim()).join("\n");
    onSubmit({
      main,
      points: writtenPoints.map(({ id, text, contributors }) => ({
        id,
        text: text.trim(),
        contributors: [...contributors],
      })),
      attributions: writtenPoints.map((p) => ({
        text: p.text.trim(),
        contributors: [...p.contributors],
      })),
      uniqueContributors,
      engagementPct,
      perMemberCount,
    });
  };

  const handleReplySubmit = () => {
    if (disabled || !reply.trim()) return;
    onPartnerReply(reply.trim());
  };

  const prompt = task?.prompt || "Work together on this prompt.";
  const right = showPartnerReply ? (
    <Pill>✨ Bonus reply stage</Pill>
  ) : (
    <Pill>📝 Build the answer together</Pill>
  );

  return (
    <TaskCardFrame
      badge="🤝 Collaboration"
      title="Each Idea, Each Voice"
      subtitle={
        showPartnerReply
          ? "② Read the other team's answer and reply."
          : "① Add bullets, then drag (or tap) names to mark who contributed each point."
      }
      right={right}
    >
      <div style={{ fontSize: 18, fontWeight: 950, color: "rgba(15,23,42,0.90)" }}>
        {prompt}
      </div>

      {!showPartnerReply ? (
        <>
          {/* How-to box */}
          <div
            style={{
              marginTop: 12,
              borderRadius: 16,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "rgba(255,255,255,0.70)",
              padding: 12,
              fontWeight: 850,
              color: "rgba(15,23,42,0.86)",
              lineHeight: 1.4,
              fontSize: 13,
            }}
          >
            <div style={{ fontWeight: 950, marginBottom: 6 }}>How this works</div>
            <div>① Type each idea on its own line (use <b>+ Add point</b>).</div>
            <div>② Whoever said it: drag your name bubble onto that line — or tap your bubble, then tap the line.</div>
            <div>③ The more voices contribute, the higher the team's engagement score.</div>
          </div>

          {/* Player bubbles */}
          {hasMembers ? (
            <div
              style={{
                marginTop: 14,
                padding: 10,
                borderRadius: 14,
                background: "rgba(99,102,241,0.06)",
                border: "1px dashed rgba(99,102,241,0.30)",
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(15,23,42,0.6)", marginBottom: 8 }}>
                YOUR TEAM — drag (or tap) a name onto each point
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {safeMembers.map((name) => (
                  <span
                    key={name}
                    draggable={!disabled}
                    onDragStart={(e) => onBubbleDragStart(e, name)}
                    onClick={() => handleBubbleTap(name)}
                    style={bubbleStyle(name, { selected: selectedName === name })}
                    title={`Drag ${name} onto a point — or tap, then tap a point`}
                  >
                    👤 {name}
                  </span>
                ))}
              </div>
              {selectedName ? (
                <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginTop: 8 }}>
                  Tap a point below to attribute it to <b>{selectedName}</b>.
                </div>
              ) : null}
            </div>
          ) : (
            <div
              style={{
                marginTop: 12, fontSize: 12, fontWeight: 700,
                color: "rgba(15,23,42,0.55)",
              }}
            >
              No team-member names available — just write your bullets and submit.
            </div>
          )}

          {/* Points list */}
          <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            {points.map((p, idx) => {
              const isAttributed = p.contributors.length > 0;
              return (
                <div
                  key={p.id}
                  onDragOver={onPointDragOver}
                  onDrop={(e) => onPointDrop(e, p.id)}
                  onClick={() => selectedName && handlePointTap(p.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 10,
                    borderRadius: 14,
                    background: selectedName
                      ? "rgba(124,58,237,0.06)"
                      : "rgba(255,255,255,0.85)",
                    border: `1px ${selectedName ? "dashed" : "solid"} ${
                      selectedName
                        ? "rgba(124,58,237,0.5)"
                        : isAttributed
                        ? "rgba(34,197,94,0.45)"
                        : "rgba(15,23,42,0.12)"
                    }`,
                    transition: "background 0.15s, border-color 0.15s",
                    cursor: selectedName ? "copy" : "default",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 12, fontWeight: 900, color: "rgba(15,23,42,0.5)",
                        minWidth: 22, textAlign: "right",
                      }}
                    >
                      {idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={p.text}
                      onChange={(e) => updatePointText(p.id, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      disabled={disabled}
                      placeholder="Type an idea, fact, or example…"
                      style={{
                        flex: 1, padding: "8px 10px",
                        border: "1px solid rgba(15,23,42,0.12)",
                        borderRadius: 10, fontSize: 14, fontFamily: "inherit",
                        background: "#fff", color: "#0f172a",
                      }}
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removePoint(p.id); }}
                      disabled={disabled}
                      title="Remove this point"
                      style={{
                        width: 30, height: 30, borderRadius: 8,
                        border: "1px solid rgba(15,23,42,0.12)",
                        background: "rgba(255,255,255,0.9)",
                        cursor: "pointer", color: "#94a3b8",
                        fontSize: 14, fontWeight: 900,
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {/* Attribution row */}
                  <div
                    style={{
                      display: "flex", flexWrap: "wrap", gap: 6,
                      paddingLeft: 30, minHeight: 28, alignItems: "center",
                    }}
                  >
                    {p.contributors.length === 0 ? (
                      <span
                        style={{
                          fontSize: 11, fontWeight: 700,
                          color: "rgba(15,23,42,0.4)", fontStyle: "italic",
                        }}
                      >
                        {hasMembers
                          ? "Drop a name bubble here to attribute this point"
                          : ""}
                      </span>
                    ) : (
                      p.contributors.map((name) => (
                        <span
                          key={name}
                          onClick={(e) => { e.stopPropagation(); toggleContributor(p.id, name); }}
                          style={{
                            ...bubbleStyle(name, { small: true }),
                            cursor: "pointer",
                          }}
                          title={`Remove ${name}'s attribution`}
                        >
                          👤 {name} ✕
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <GhostButton
              onClick={addPoint}
              disabled={disabled}
              style={{ fontSize: 13 }}
            >
              + Add point
            </GhostButton>
            <Pill style={{ fontSize: 11, fontWeight: 800, color: "#7c3aed" }}>
              Engagement {engagementPct}%
            </Pill>
          </div>

          {/* Per-player engagement breakdown (e.g. "Richard 1 · Paul 0 ·
              Bernadette 0").  Tester wanted to see contribution counts
              named individually rather than just 1/1. */}
          {hasMembers && (
            <div
              style={{
                marginTop: 8,
                padding: "8px 12px",
                borderRadius: 12,
                background: "rgba(124,58,237,0.06)",
                border: "1px solid rgba(124,58,237,0.18)",
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
                fontSize: 12,
                fontWeight: 800,
                color: "rgba(15,23,42,0.85)",
              }}
            >
              <span style={{ color: "#7c3aed" }}>Per-player:</span>
              {safeMembers.map((n) => {
                const c = perMemberCount[n] || 0;
                return (
                  <span
                    key={n}
                    style={{
                      color: c > 0 ? "#16a34a" : "rgba(15,23,42,0.5)",
                    }}
                  >
                    {n} {c}
                  </span>
                );
              })}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
            <PrimaryButton
              onClick={handleMainSubmit}
              disabled={disabled || !canSubmitMain}
            >
              Submit Team Answer
            </PrimaryButton>
          </div>
        </>
      ) : (
        <>
          {/* Reply phase — kept identical to the prior implementation. */}
          <div
            style={{
              marginTop: 14,
              borderRadius: 22,
              border: "1px solid rgba(168,85,247,0.28)",
              background:
                "radial-gradient(700px 260px at 20% 0%, rgba(168,85,247,0.16), transparent 60%), rgba(255,255,255,0.78)",
              boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
              padding: 14,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Pill>💬 Partner response</Pill>
              <Pill subtle>Read carefully, then reply for bonus points.</Pill>
            </div>
            <div style={{ marginTop: 10, fontStyle: "italic", fontWeight: 900, color: "rgba(15,23,42,0.86)" }}>
              {partnerAnswer || "(No partner answer received.)"}
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <TextArea
              value={reply}
              onChange={(e) => {
                setReply(e.target.value);
                onAnswerChange?.({ points, reply: e.target.value });
              }}
              disabled={disabled}
              rows={6}
              placeholder="Write a thoughtful reply… (earn up to +5 bonus points!)"
            />
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 10,
            }}
          >
            <Pill>⭐ +5 bonus points possible</Pill>
            <PrimaryButton
              onClick={handleReplySubmit}
              disabled={disabled || !reply.trim()}
              style={{
                background:
                  "linear-gradient(135deg, rgba(168,85,247,0.96), rgba(56,189,248,0.76))",
              }}
            >
              Send Reply &amp; Claim Bonus
            </PrimaryButton>
          </div>
        </>
      )}
    </TaskCardFrame>
  );
}
