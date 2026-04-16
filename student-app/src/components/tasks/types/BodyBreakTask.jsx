// student-app/src/components/tasks/types/BodyBreakTask.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";

function parseStepsFromPrompt(promptText) {
  const t = String(promptText || "").trim();
  if (!t) return [];

  const hasNumbered = /(^|\s)\d+[\)\.]\s/.test(t);
  if (hasNumbered) {
    // If the prompt has a label before the list (e.g., "BODY BREAK (45s): 1) ..."),
    // strip everything before the first numbered item so we don't treat the label as a "step".
    const firstIdx = t.search(/\d+[\)\.]\s/);
    const numberedPart = firstIdx >= 0 ? t.slice(firstIdx) : t;

    const normalized = numberedPart.replace(/(\d+)[\)\.]\s*/g, "\n$1) ");
    return normalized
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.replace(/^\d+[\)\.]\s*/, "").trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }

  const lines = t
    .split(/\n|;/g)
    .map((s) => s.trim())
    .filter(Boolean);

  if (lines.length <= 1) return t ? [{ text: t }] : [];
  return lines.map((text) => ({ text: text }));
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export default function BodyBreakTask({ task, onSubmit, disabled, stagingPhase, canStartTask }) {
  const promptText = String(task?.prompt || "");
  const SHOW_TOP_MOVES_LIST = false;

  // Hide Start until the TaskRunner staging/intro animation is fully gone.
  // TaskRunner passes canStartTask=true when stagingPhase === 'gone'.
  const canStart = Boolean(canStartTask) || stagingPhase === "gone" || stagingPhase == null;

  const steps = useMemo(() => {
    const cfgSteps = task?.config?.steps;
    if (Array.isArray(cfgSteps) && cfgSteps.length) {
      const mapped = cfgSteps
        .map((s) => ({
          icon: s.icon || s.emoji || null,
          text: String(s.text || s.instruction || "").trim(),
          seconds: Number.isFinite(s.seconds)
            ? s.seconds
            : Number.isFinite(s.holdSeconds)
            ? s.holdSeconds
            : null,
        }))
        .filter((s) => s.text);

      // If config.steps exists but is malformed/empty, fall back to parsing the prompt.
      if (mapped.length) return mapped;
    }
    return parseStepsFromPrompt(promptText);
  }, [task?.config?.steps, promptText]);

  const totalSecondsRaw =
    task?.config?.totalSeconds ??
    task?.timeLimitSeconds ??
    task?.config?.timeLimitSeconds ??
    null;

  const promptSeconds = (() => {
    const s = String(task?.prompt || task?.config?.prompt || "");
    const m = s.match(/\((\d+)\s*s\)/i) || s.match(/\b(\d+)\s*s\b/i);
    const n = m ? Number(m[1]) : null;
    return Number.isFinite(n) ? n : null;
  })();

  let totalSeconds = null;

// IMPORTANT: Number(null) === 0, which broke timers when totalSecondsRaw was missing.
// Only coerce totalSecondsRaw if it's truly present.
if (totalSecondsRaw !== null && totalSecondsRaw !== undefined && String(totalSecondsRaw).trim() !== "") {
  const n = Number(totalSecondsRaw);
  if (Number.isFinite(n) && n > 0) totalSeconds = n;
}

if (!Number.isFinite(totalSeconds) && Number.isFinite(promptSeconds) && promptSeconds > 0) {
  totalSeconds = promptSeconds;
}

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);

  // Only hard-reset the timer when the *task instance* changes.
  // (Some screens re-render/refresh task objects during staging transitions; we don't want that to cancel the timer.)
  const instanceKey = useMemo(() => {
    const idPart = task?._id || task?.id || task?.taskId || task?.key || "";
    const promptPart = typeof task?.prompt === "string" ? task.prompt : "";
    return String(idPart) + "|" + promptPart;
  }, [task?._id, task?.id, task?.taskId, task?.key, task?.prompt]);

  const prevInstanceKeyRef = useRef(instanceKey);
  const prevTotalSecondsRef = useRef(totalSeconds);

  useEffect(() => {
    const prevKey = prevInstanceKeyRef.current;
    const prevTotal = prevTotalSecondsRef.current;

    // New task instance → reset everything.
    if (prevKey !== instanceKey) {
      prevInstanceKeyRef.current = instanceKey;
      prevTotalSecondsRef.current = totalSeconds;
      setRunning(false);
      setTimeLeft(totalSeconds);
      return;
    }

    // Same task instance, but duration changed (late-arriving config/prompt).
    // Keep UI consistent, but don't interrupt an in-progress timer.
    if (!running && prevTotal !== totalSeconds) {
      prevTotalSecondsRef.current = totalSeconds;
      setTimeLeft(totalSeconds);
    }
  }, [instanceKey, totalSeconds, running]);

  useEffect(() => {
    if (!running) return;
    if (!Number.isFinite(timeLeft)) return;
    if (timeLeft <= 0) return;
    const t = window.setTimeout(() => setTimeLeft((x) => (x == null ? x : x - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [running, timeLeft]);


  const startPause = () => {
    if (disabled) return;

    // When starting, ensure the countdown has a valid positive timeLeft.
    if (!running) {
      if (Number.isFinite(totalSeconds)) {
        setTimeLeft((tl) => {
          const n = Number(tl);
          if (Number.isFinite(n) && n > 0) return n;
          return totalSeconds;
        });
      }
      setRunning(true);
      return;
    }

    // Pause
    setRunning(false);
  };

  const movesLines = useMemo(() => {
    if (!steps || steps.length === 0) return "";
    return steps.map((s, i) => `${i + 1}) ${String(s?.text || "").trim()}`).filter(Boolean).join("\n");
  }, [steps]);
  const finishText =
    String(task?.config?.finishText || "").trim() || "Nice work — tap DONE when your group is finished.";

  const percent =
    Number.isFinite(totalSeconds) && Number.isFinite(timeLeft) && totalSeconds > 0
      ? clamp(Math.round((timeLeft / totalSeconds) * 100), 0, 100)
      : null;

  const isMovement =
    /jump|stretch|stand|move|bend|twist|run/i.test(promptText) ||
    !!task?.movement ||
    !!task?.config?.movement ||
    task?.isPhysical ||
    task?.config?.isPhysical;

  const styles = {
    shell: { height: "100%", padding: 16 },
    hero: {
      borderRadius: 24,
      padding: 22,
      border: "1px solid rgba(15,23,42,0.10)",
      background:
        "radial-gradient(1200px 500px at 10% 0%, rgba(56,189,248,0.30), rgba(255,255,255,0.0)), linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,255,255,0.72))",
      boxShadow: "0 18px 60px rgba(15,23,42,0.10)",
      overflow: "hidden",
      position: "relative",
    },
    sparkle: {
      position: "absolute",
      inset: -60,
      background:
        "radial-gradient(circle at 25% 25%, rgba(34,197,94,0.14), transparent 55%), radial-gradient(circle at 75% 35%, rgba(99,102,241,0.14), transparent 55%), radial-gradient(circle at 55% 75%, rgba(250,204,21,0.14), transparent 55%)",
      filter: "blur(0px)",
      pointerEvents: "none",
    },
    topRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
    badge: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      padding: "8px 12px",
      borderRadius: 999,
      border: "1px solid rgba(15,23,42,0.10)",
      background: "rgba(255,255,255,0.75)",
      fontWeight: 900,
      fontSize: 13,
    },
    title: { fontSize: 22, fontWeight: 1000, margin: 0, letterSpacing: 0.3 },
    sub: { marginTop: 5, fontSize: 14, opacity: 0.7, fontWeight: 700 },
    stepsWrap: { marginTop: 20, display: "grid", gap: 14 },
    stepCard: {
      borderRadius: 22,
      border: "1px solid rgba(15,23,42,0.08)",
      background: "rgba(255,255,255,0.88)",
      boxShadow: "0 12px 36px rgba(15,23,42,0.07)",
      padding: "20px 18px",
      display: "flex",
      gap: 16,
      alignItems: "flex-start",
    },
    num: {
      width: 44,
      height: 44,
      borderRadius: 14,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 1000,
      fontSize: 20,
      background: "linear-gradient(135deg, rgba(14,165,233,0.22), rgba(99,102,241,0.20))",
      border: "1px solid rgba(15,23,42,0.08)",
      flex: "0 0 auto",
    },
    stepText: { fontSize: 20, fontWeight: 850, lineHeight: 1.4, letterSpacing: 0.1 },
    stepMeta: { marginTop: 8, fontSize: 14, opacity: 0.7, fontWeight: 800 },
    controls: { marginTop: 20, display: "grid", gap: 12 },
    btn: {
      width: "100%",
      borderRadius: 18,
      padding: "14px 16px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "rgba(255,255,255,0.82)",
      cursor: "pointer",
      fontSize: 17,
    },
    btnDone: {
      width: "100%",
      borderRadius: 18,
      padding: "14px 16px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.90), rgba(14,165,233,0.65))",
      color: "#07121f",
      cursor: "pointer",
      fontSize: 17,
    },
    progressOuter: {
      height: 10,
      borderRadius: 999,
      background: "rgba(15,23,42,0.08)",
      overflow: "hidden",
      border: "1px solid rgba(15,23,42,0.08)",
      marginTop: 10,
    },
    progressInner: {
      height: "100%",
      width: `${percent ?? 0}%`,
      background: "linear-gradient(90deg, rgba(14,165,233,0.85), rgba(34,197,94,0.85))",
      transition: "width 250ms linear",
    },
    footer: { marginTop: 10, textAlign: "center", fontSize: 12, opacity: 0.8, fontWeight: 800 },
  };

  return (
    <div style={styles.shell}>
      <style>{`
        @keyframes bbFloat {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
        @keyframes bbPulse {
          0%,100% { transform: scale(1); opacity: 0.95; }
          50% { transform: scale(1.04); opacity: 1; }
        }
        .bb-orb { animation: bbFloat 2.6s ease-in-out infinite; }
        .bb-go  { animation: bbPulse 1.2s ease-in-out infinite; }
      `}</style>

      <div style={styles.hero}>
        <div style={styles.sparkle} />

        <div style={styles.topRow}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div
              className="bb-orb"
              style={{
                width: 52,
                height: 52,
                borderRadius: 18,
                display: "grid",
                placeItems: "center",
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.30), rgba(56,189,248,0.22))",
                border: "1px solid rgba(15,23,42,0.10)",
                boxShadow: "0 16px 40px rgba(15,23,42,0.08)",
                fontSize: 26,
              }}
              aria-hidden="true"
            >
              {isMovement ? "🤸" : "🧘"}
            </div>

            <div style={{ minWidth: 0 }}>
              <h3 style={styles.title}>
                {task?.config?.label || "Quick reset"}
              </h3>
              <div style={styles.sub}>
                Do this together
                {Number.isFinite(totalSeconds) ? ` • ${totalSeconds}s` : ""}
              </div>
            </div>
          </div>

          {Number.isFinite(totalSeconds) ? (
            <div style={styles.badge}>
              ⏱ <span style={{ fontVariantNumeric: "tabular-nums" }}>{timeLeft ?? totalSeconds}s</span>
            </div>
          ) : (
            <div style={styles.badge}>✨ Refresh</div>
          )}
        </div>

        {percent != null && (
          <div style={styles.progressOuter} aria-label="Timer progress">
            <div style={styles.progressInner} />
          </div>
        )}

        {SHOW_TOP_MOVES_LIST && movesLines ? (
          <div
            style={{
              marginTop: 14,
              borderRadius: 18,
              border: "1px solid rgba(15,23,42,0.10)",
              background: "rgba(255,255,255,0.78)",
              padding: 12,
              fontWeight: 850,
              fontSize: 14,
              lineHeight: 1.35,
              whiteSpace: "pre-line",
            }}
            aria-label="Activities (one per line)"
          >
            {movesLines}
          </div>
        ) : null}

        <div style={styles.stepsWrap}>
          {steps.length ? (
            steps.map((s, idx) => (
              <div key={idx} style={styles.stepCard}>
                <div style={styles.num}>{idx + 1}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={styles.stepText}>
                    {s.icon ? <span style={{ marginRight: 8 }}>{s.icon}</span> : null}
                    {s.text}
                  </div>
                  {s.seconds ? <div style={styles.stepMeta}>Hold for {s.seconds}s</div> : null}
                </div>
              </div>
            ))
          ) : (
            <div style={styles.stepCard}>
              <div style={styles.num}>!</div>
              <div style={styles.stepText}>{promptText || "Stand up, stretch, and reset."}</div>
            </div>
          )}
        </div>

        <div style={styles.controls}>
          {Number.isFinite(totalSeconds) && canStart ? (
            <button
              type="button"
              style={{ ...styles.btn, opacity: disabled ? 0.6 : 1 }}
              onClick={(e) => {
                e?.preventDefault?.();
                e?.stopPropagation?.();
                startPause();
              }}
              disabled={disabled}
              className={!running ? "bb-go" : undefined}
            >
              {running ? "Pause ⏸" : "Start ▶️ (begin timer)"}
            </button>
          ) : Number.isFinite(totalSeconds) ? (
            <div style={{ fontSize: 12, opacity: 0.75, padding: "6px 2px" }}>
              Intro playing… Start will appear in a moment.
            </div>
          ) : null}

          <button
            type="button"
            style={{ ...styles.btnDone, opacity: disabled ? 0.6 : 1 }}
            onClick={(e) => {
              e?.preventDefault?.();
              e?.stopPropagation?.();
              onSubmit?.({ done: true });
            }}
            disabled={disabled}
          >
            DONE ✅
          </button>

          <div style={styles.footer}>{finishText}</div>
        </div>
      </div>
    </div>
  );
}
