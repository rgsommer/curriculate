// student-app/src/components/tasks/types/ScriptPlayTask.jsx
import React, { useMemo, useState } from "react";

/**
 * ScriptPlayTask
 * - Intra-team pass-the-device performance
 * - Shows current line + optional context before/after + tone/direction cues
 * - Graphically rich, consistent "Curriculate card" feel (no external deps)
 */
export default function ScriptPlayTask({ task, onSubmit, disabled = false }) {
  const cfg = task?.config && typeof task.config === "object" ? task.config : {};
  const scenes = Array.isArray(cfg.scenes) ? cfg.scenes : [];

  const normalizedScenes = useMemo(() => {
    const s = scenes
      .filter(Boolean)
      .slice(0, 4)
      .map((scene, si) => {
        const turns = Array.isArray(scene?.turns) ? scene.turns : [];
        return {
          title: String(scene?.title || `Scene ${si + 1}`).slice(0, 80),
          contextBefore: String(scene?.contextBefore || "").slice(0, 240),
          contextAfter: String(scene?.contextAfter || "").slice(0, 240),
          turns: turns
            .filter(Boolean)
            .slice(0, 24)
            .map((t, ti) => ({
              speakerIndex:
                Number.isFinite(Number(t?.speakerIndex)) && Number(t.speakerIndex) >= 0
                  ? Number(t.speakerIndex)
                  : ti % 4,
              line: String(t?.line ?? t?.text ?? "").trim().slice(0, 220),
              tone: String(t?.tone || "").trim().slice(0, 40),
              direction: String(t?.direction || "").trim().slice(0, 70),
              before: String(t?.before || "").trim().slice(0, 120),
              after: String(t?.after || "").trim().slice(0, 120),
            }))
            .filter((t) => t.line),
        };
      })
      .filter((scene) => scene.turns.length);

    if (s.length) return s;

    // Support the simpler generator format: task.lines[] like "Alex: ...".
    const rawLines = Array.isArray(task?.lines) ? task.lines : [];
    if (rawLines.length) {
      const parsed = rawLines
        .filter((x) => typeof x === "string")
        .slice(0, 24)
        .map((line, idx) => {
          const t = String(line).trim();
          const colon = t.indexOf(":");
          const speaker = colon > 0 ? t.slice(0, colon).trim() : `Speaker ${((idx % 4) + 1)}`;
          const text = colon > 0 ? t.slice(colon + 1).trim() : t;
          return { speaker, text };
        })
        .filter((x) => x.text);

      const speakers = Array.from(new Set(parsed.map((p) => p.speaker)));
      const turns = parsed.map((p) => ({
        speakerIndex: Math.max(0, speakers.indexOf(p.speaker)),
        line: p.text.slice(0, 220),
        tone: "",
        direction: "",
        before: "",
        after: "",
      }));

      // Use AI-generated setting paragraph if available, otherwise generic instructions
      const setting = String(task?.setting || cfg.setting || "").trim();
      const contextBefore = setting ||
        "Pass the device to the next speaker after each line. Read clearly and act it out together.";

      return [
        {
          title: String(task?.title || "Scene 1").slice(0, 80),
          contextBefore,
          contextAfter: "",
          turns,
        },
      ];
    }

    // Safe fallback: never show a blank task
    return [
      {
        title: "Scene 1",
        contextBefore:
          "Pass the device to the next speaker after each line. Read expressively, using the tone and direction cues.",
        contextAfter: "",
        turns: [
          { speakerIndex: 0, line: "Alright team — let's start the scene!", tone: "confident", direction: "" },
          { speakerIndex: 1, line: "I'm ready. What's the plan?", tone: "curious", direction: "" },
          { speakerIndex: 0, line: "We'll take turns and make it expressive.", tone: "encouraging", direction: "" },
          { speakerIndex: 1, line: "Deal. Let's make it memorable!", tone: "excited", direction: "" },
        ],
      },
    ];
  }, [scenes, task?.lines, task?.title]);

  const totalTurns = useMemo(
    () => normalizedScenes.reduce((sum, s) => sum + (s?.turns?.length || 0), 0),
    [normalizedScenes]
  );

  const [sceneIndex, setSceneIndex] = useState(0);
  const [turnIndex, setTurnIndex] = useState(0);
  const [expressiveRating, setExpressiveRating] = useState(3);

  const scene = normalizedScenes[sceneIndex];
  const turns = scene?.turns || [];
  const turn = turns[turnIndex];

  const playerCount = Math.max(2, Math.min(8, Number(cfg.playerCount) || 4));
  const showExpressive = !!cfg.bonusExpressivePoints;

  const globalTurnNumber = useMemo(() => {
    let n = 0;
    for (let si = 0; si < normalizedScenes.length; si++) {
      if (si < sceneIndex) n += normalizedScenes[si]?.turns?.length || 0;
    }
    return n + turnIndex + 1;
  }, [normalizedScenes, sceneIndex, turnIndex]);

  const canGoPrev = sceneIndex > 0 || turnIndex > 0;

  function goPrev() {
    if (disabled) return;
    if (!canGoPrev) return;
    if (turnIndex > 0) {
      setTurnIndex((v) => v - 1);
      return;
    }
    const prevSceneIndex = Math.max(0, sceneIndex - 1);
    const prevTurns = normalizedScenes[prevSceneIndex]?.turns || [];
    setSceneIndex(prevSceneIndex);
    setTurnIndex(Math.max(0, prevTurns.length - 1));
  }

  function goNext() {
    if (disabled) return;
    if (turnIndex < turns.length - 1) {
      setTurnIndex((v) => v + 1);
      return;
    }
    if (sceneIndex < normalizedScenes.length - 1) {
      setSceneIndex((v) => v + 1);
      setTurnIndex(0);
      return;
    }
    const payload = {
      completed: true,
      expressiveRating: showExpressive ? expressiveRating : undefined,
      totalTurns,
    };
    onSubmit?.(payload);
  }

  const styles = {
    wrap: {
      borderRadius: 18,
      padding: 16,
      background:
        "radial-gradient(1200px 400px at 20% 0%, rgba(168,85,247,0.20), transparent 60%), radial-gradient(900px 350px at 80% 20%, rgba(59,130,246,0.18), transparent 60%), rgba(17,24,39,0.92)",
      border: "1px solid rgba(255,255,255,0.10)",
      boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
      color: "rgba(255,255,255,0.92)",
      maxWidth: 860,
      margin: "0 auto",
    },
    headerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    title: { display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 800, letterSpacing: 0.2 },
    badge: {
      fontSize: 12,
      fontWeight: 700,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.10)",
      border: "1px solid rgba(255,255,255,0.14)",
      whiteSpace: "nowrap",
    },
    metaRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, opacity: 0.95 },
    pill: {
      fontSize: 12,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(255,255,255,0.07)",
      border: "1px solid rgba(255,255,255,0.12)",
    },
    progressWrap: { marginTop: 12, display: "flex", alignItems: "center", gap: 10 },
    barOuter: {
      flex: 1,
      height: 10,
      borderRadius: 999,
      background: "rgba(255,255,255,0.10)",
      border: "1px solid rgba(255,255,255,0.10)",
      overflow: "hidden",
    },
    barInner: (pct) => ({
      width: `${pct}%`,
      height: "100%",
      borderRadius: 999,
      background: "linear-gradient(90deg, rgba(168,85,247,0.95), rgba(59,130,246,0.95))",
    }),
    sceneCard: {
      marginTop: 14,
      borderRadius: 16,
      padding: 14,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.12)",
    },
    sceneTitle: { fontSize: 14, fontWeight: 800, opacity: 0.95 },
    context: { marginTop: 8, fontSize: 13, opacity: 0.85, lineHeight: 1.35 },
    lineCard: {
      marginTop: 12,
      borderRadius: 18,
      padding: 16,
      background: "rgba(0,0,0,0.28)",
      border: "1px solid rgba(255,255,255,0.14)",
    },
    speakerRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
    speaker: { fontSize: 13, fontWeight: 800, opacity: 0.95 },
    speakerHint: { fontSize: 12, opacity: 0.75 },
    cueRow: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 },
    cue: {
      fontSize: 12,
      fontWeight: 700,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(168,85,247,0.14)",
      border: "1px solid rgba(168,85,247,0.28)",
    },
    cueBlue: {
      fontSize: 12,
      fontWeight: 700,
      padding: "6px 10px",
      borderRadius: 999,
      background: "rgba(59,130,246,0.14)",
      border: "1px solid rgba(59,130,246,0.28)",
    },
    lineText: { marginTop: 12, fontSize: 28, fontWeight: 800, letterSpacing: 0.2, lineHeight: 1.18 },
    smallContext: { marginTop: 10, fontSize: 13, opacity: 0.82, lineHeight: 1.35 },
    controls: { marginTop: 14, display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" },
    btn: {
      flex: "1 1 140px",
      padding: "12px 14px",
      borderRadius: 14,
      fontWeight: 800,
      border: "1px solid rgba(255,255,255,0.16)",
      background: "rgba(255,255,255,0.08)",
      color: "rgba(255,255,255,0.92)",
      cursor: "pointer",
    },
    btnPrimary: {
      flex: "2 1 220px",
      padding: "12px 14px",
      borderRadius: 14,
      fontWeight: 900,
      border: "1px solid rgba(255,255,255,0.16)",
      background: "linear-gradient(90deg, rgba(168,85,247,0.95), rgba(59,130,246,0.95))",
      color: "rgba(255,255,255,0.98)",
      cursor: "pointer",
    },
    ratingRow: { marginTop: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
    star: (active) => ({
      width: 34,
      height: 34,
      borderRadius: 12,
      border: "1px solid rgba(255,255,255,0.14)",
      background: active ? "rgba(253,224,71,0.22)" : "rgba(255,255,255,0.06)",
      cursor: "pointer",
      display: "grid",
      placeItems: "center",
      fontSize: 16,
    }),
  };

  const pct = totalTurns ? Math.round((globalTurnNumber / totalTurns) * 100) : 0;

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.title}>
          <span style={{ fontSize: 22 }}>🎭</span>
          <span>Script Play</span>
        </div>
        <div style={styles.badge}>
          {globalTurnNumber}/{totalTurns} • {playerCount} roles
        </div>
      </div>

      <div style={styles.metaRow}>
        <div style={styles.pill}>Pass the device speaker-to-speaker</div>
        <div style={styles.pill}>Read with expression</div>
        <div style={styles.pill}>Intra-team only</div>
      </div>

      <div
        style={{
          marginTop: 10,
          borderRadius: 16,
          padding: 12,
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
          lineHeight: 1.35,
        }}
      >
        <div style={{ fontWeight: 900, fontSize: 13, marginBottom: 6, opacity: 0.95 }}>
          How to do this task
        </div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, opacity: 0.9 }}>
          <li>Look at the speaker number and pass the device to that person.</li>
          <li>Read your line out loud with the tone and direction cues.</li>
          <li>Tap <strong>Next Line</strong> and pass the device to the next speaker.</li>
          <li>At the end, tap <strong>Finish Performance</strong>.</li>
        </ol>
      </div>

      <div style={styles.progressWrap}>
        <div style={styles.barOuter}>
          <div style={styles.barInner(Math.min(100, Math.max(0, pct)))} />
        </div>
        <div style={{ fontSize: 12, opacity: 0.78, whiteSpace: "nowrap" }}>{pct}%</div>
      </div>

      <div style={styles.sceneCard}>
        <div style={styles.sceneTitle}>{scene.title}</div>
        {!!scene.contextBefore && <div style={styles.context}>{scene.contextBefore}</div>}

        <div style={styles.lineCard}>
          <div style={styles.speakerRow}>
            <div style={styles.speaker}>Speaker {turn.speakerIndex + 1}</div>
            <div style={styles.speakerHint}>
              Pass the device to Speaker {((turn.speakerIndex + 1) % playerCount) + 1} next
            </div>
          </div>

          <div style={styles.cueRow}>
            {!!turn.tone && <span style={styles.cue}>Tone: {turn.tone}</span>}
            {!!turn.direction && <span style={styles.cueBlue}>Direction: {turn.direction}</span>}
          </div>

          {!!turn.before && (
            <div style={styles.smallContext}>
              <b>Just before:</b> {turn.before}
            </div>
          )}

          <div style={styles.lineText}>{turn.line}</div>

          {!!turn.after && (
            <div style={styles.smallContext}>
              <b>Up next:</b> {turn.after}
            </div>
          )}
        </div>

        {!!scene.contextAfter && <div style={styles.context}>{scene.contextAfter}</div>}

        {showExpressive && (
          <div style={styles.ratingRow}>
            <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.92 }}>Expressiveness bonus:</div>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                style={styles.star(n <= expressiveRating)}
                onClick={() => setExpressiveRating(n)}
                aria-label={`Rate ${n} out of 5`}
              >
                {n <= expressiveRating ? "⭐" : "☆"}
              </button>
            ))}
            <div style={{ fontSize: 12, opacity: 0.75 }}>Tap stars at the end of the performance.</div>
          </div>
        )}

        <div style={styles.controls}>
          <button type="button" style={styles.btn} onClick={goPrev} disabled={(sceneIndex === 0 && turnIndex === 0) || disabled}>
            ◀ Back
          </button>

          <button type="button" style={styles.btnPrimary} onClick={goNext} disabled={disabled}>
            {sceneIndex === normalizedScenes.length - 1 && turnIndex === turns.length - 1
              ? "Finish Performance"
              : "Next Line ▶"}
          </button>
        </div>
      </div>
    </div>
  );
}