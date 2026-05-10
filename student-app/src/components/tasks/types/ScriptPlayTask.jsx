// student-app/src/components/tasks/types/ScriptPlayTask.jsx
import React, { useMemo, useState } from "react";

/**
 * ScriptPlayTask
 * - Intra-team pass-the-device performance
 * - Shows current line + optional context before/after + tone/direction cues
 * - Graphically rich, consistent "Curriculate card" feel (no external deps)
 */
export default function ScriptPlayTask({ task, onSubmit, disabled = false, memberNames = [] }) {
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
        speakerName: p.speaker,
      }));

      // Use AI-generated setting paragraph if available
      const setting = String(task?.setting || cfg.setting || "").trim();

      // Build role assignment text: "Emma → Narrator, Liam → Ava, ..."
      const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
      const roleLines = speakers.map((role, i) => {
        const name = names[i] || `Team member ${i + 1}`;
        return `${name} → ${role}`;
      });
      const roleAssignment = roleLines.length ? roleLines.join("  •  ") : "";

      const contextBefore = [setting, roleAssignment].filter(Boolean).join("\n\n") ||
        "Pass the device to the next speaker after each line. Read clearly and act it out together.";

      return [
        {
          title: String(task?.title || "Scene 1").slice(0, 80),
          contextBefore,
          contextAfter: "",
          turns,
          speakers,
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
  }, [scenes, task?.lines, task?.title, task?.setting, cfg.setting, memberNames]);

  const totalTurns = useMemo(
    () => normalizedScenes.reduce((sum, s) => sum + (s?.turns?.length || 0), 0),
    [normalizedScenes]
  );

  const [sceneIndex, setSceneIndex] = useState(0);
  const [expressiveRating, setExpressiveRating] = useState(3);

  const scene = normalizedScenes[sceneIndex];
  const turns = scene?.turns || [];

  const playerCount = Math.max(2, Math.min(8, Number(cfg.playerCount) || 4));
  const showExpressive = !!cfg.bonusExpressivePoints;
  const isLastScene = sceneIndex >= normalizedScenes.length - 1;

  const canGoPrev = sceneIndex > 0;

  function goPrev() {
    if (disabled || !canGoPrev) return;
    setSceneIndex((v) => Math.max(0, v - 1));
  }

  function goNext() {
    if (disabled) return;
    if (!isLastScene) {
      setSceneIndex((v) => v + 1);
      return;
    }
    const payload = {
      completed: true,
      expressiveRating: showExpressive ? expressiveRating : undefined,
      totalTurns,
      scenesPerformed: normalizedScenes.length,
    };
    onSubmit?.(payload);
  }

  // Resolve the human + role label for a given turn ("Richard as Ava")
  // — used in the per-line list so the player can immediately see who
  // reads each line.
  const labelForTurn = (t) => {
    const names = Array.isArray(memberNames) ? memberNames.filter(Boolean) : [];
    const speakers = scene?.speakers || [];
    const charName = t?.speakerName || speakers[t?.speakerIndex] || "";
    const playerName = names[t?.speakerIndex] || "";
    if (charName && playerName && charName !== playerName) return `${playerName} as ${charName}`;
    if (playerName) return playerName;
    if (charName) return charName;
    return `Speaker ${(t?.speakerIndex ?? 0) + 1}`;
  };

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

  // Whole-scene mode: progress = scene N of M.
  const pct = normalizedScenes.length
    ? Math.round(((sceneIndex + 1) / normalizedScenes.length) * 100)
    : 0;

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.title}>
          <span style={{ fontSize: 22 }}>🎭</span>
          <span>Script Play</span>
        </div>
        <div style={styles.badge}>
          Scene {sceneIndex + 1}/{normalizedScenes.length} • {turns.length} lines • {playerCount} roles
        </div>
      </div>

      <div style={styles.metaRow}>
        <div style={styles.pill}>Read the whole scene aloud, taking turns</div>
        <div style={styles.pill}>Use the cues for tone + direction</div>
        <div style={styles.pill}>Tap Next Scene when you're done</div>
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

        {/* Whole-scene script: every line laid out at once with the
            speaker name prefixed.  The team passes the device after
            each line themselves; the device only advances when the
            whole scene's been performed. */}
        <div
          style={{
            marginTop: 12,
            borderRadius: 18,
            padding: 16,
            background: "rgba(0,0,0,0.28)",
            border: "1px solid rgba(255,255,255,0.14)",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {turns.map((t, ti) => {
            const speakerLabel = labelForTurn(t);
            return (
              <div
                key={ti}
                style={{
                  borderLeft: "4px solid rgba(168,85,247,0.55)",
                  paddingLeft: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 900,
                    letterSpacing: 0.3,
                    color: "rgba(253,224,71,0.95)",
                    textTransform: "uppercase",
                    marginBottom: 4,
                  }}
                >
                  {speakerLabel}:
                </div>
                {(t.tone || t.direction) && (
                  <div style={styles.cueRow}>
                    {!!t.tone && <span style={styles.cue}>Tone: {t.tone}</span>}
                    {!!t.direction && <span style={styles.cueBlue}>Direction: {t.direction}</span>}
                  </div>
                )}
                <div style={{ fontSize: 19, fontWeight: 700, lineHeight: 1.35, marginTop: t.tone || t.direction ? 6 : 0 }}>
                  {t.line}
                </div>
              </div>
            );
          })}
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
          <button type="button" style={styles.btn} onClick={goPrev} disabled={!canGoPrev || disabled}>
            ◀ Previous Scene
          </button>

          <button type="button" style={styles.btnPrimary} onClick={goNext} disabled={disabled}>
            {isLastScene ? "Finish Performance" : `Next Scene ▶  (${sceneIndex + 2}/${normalizedScenes.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}