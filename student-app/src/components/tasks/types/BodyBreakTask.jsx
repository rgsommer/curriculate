// student-app/src/components/tasks/types/BodyBreakTask.jsx
import React, { useEffect, useMemo, useState } from "react";

function parseStepsFromPrompt(promptText) {
  const t = String(promptText || "").trim();
  if (!t) return [];

  const hasNumbered = /(^|\s)\d+[\)\.]\s/.test(t);
  if (hasNumbered) {
    const normalized = t.replace(/(\d+)[\)\.]\s*/g, "\n$1) ");
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

export default function BodyBreakTask({ task, onSubmit, disabled }) {
  const promptText = String(task?.prompt || "");
  const steps = useMemo(() => {
    const cfgSteps = task?.config?.steps;
    if (Array.isArray(cfgSteps) && cfgSteps.length) {
      return cfgSteps
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
    }
    return parseStepsFromPrompt(promptText);
  }, [task?.config?.steps, promptText]);

  const totalSeconds =
    Number.isFinite(task?.config?.totalSeconds)
      ? task.config.totalSeconds
      : Number.isFinite(task?.timeLimitSeconds)
      ? task.timeLimitSeconds
      : null;

  const [running, setRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(totalSeconds);

  useEffect(() => {
    setRunning(false);
    setTimeLeft(totalSeconds);
  }, [totalSeconds, task?._id, task?.id, task?.prompt]);

  useEffect(() => {
    if (!running) return;
    if (!Number.isFinite(timeLeft)) return;
    if (timeLeft <= 0) return;
    const t = window.setTimeout(() => setTimeLeft((x) => (x == null ? x : x - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [running, timeLeft]);

  const finishText =
    String(task?.config?.finishText || "").trim() || "Sit back down—ready to continue!";

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
      borderRadius: 22,
      padding: 18,
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
    title: { fontSize: 18, fontWeight: 1000, margin: 0, letterSpacing: 0.2 },
    sub: { marginTop: 4, fontSize: 13, opacity: 0.75, fontWeight: 700 },
    stepsWrap: { marginTop: 14, display: "grid", gap: 10 },
    stepCard: {
      borderRadius: 18,
      border: "1px solid rgba(15,23,42,0.10)",
      background: "rgba(255,255,255,0.82)",
      boxShadow: "0 10px 30px rgba(15,23,42,0.06)",
      padding: 14,
      display: "flex",
      gap: 12,
      alignItems: "flex-start",
    },
    num: {
      width: 34,
      height: 34,
      borderRadius: 12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontWeight: 1000,
      background: "linear-gradient(135deg, rgba(14,165,233,0.20), rgba(99,102,241,0.18))",
      border: "1px solid rgba(15,23,42,0.10)",
      flex: "0 0 auto",
    },
    stepText: { fontSize: 15, fontWeight: 800, lineHeight: 1.25 },
    stepMeta: { marginTop: 6, fontSize: 12, opacity: 0.75, fontWeight: 800 },
    controls: { marginTop: 14, display: "grid", gap: 10 },
    btn: {
      width: "100%",
      borderRadius: 18,
      padding: "12px 14px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "rgba(255,255,255,0.82)",
      cursor: "pointer",
      fontSize: 15,
    },
    btnDone: {
      width: "100%",
      borderRadius: 18,
      padding: "12px 14px",
      fontWeight: 1000,
      border: "1px solid rgba(15,23,42,0.14)",
      background: "linear-gradient(135deg, rgba(34,197,94,0.90), rgba(14,165,233,0.65))",
      color: "#07121f",
      cursor: "pointer",
      fontSize: 15,
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
              <h3 style={styles.title}>{task?.config?.label || "Quick reset"}</h3>
              <div style={styles.sub}>
                {steps.length ? `${steps.length} steps` : "Follow along"}
                {Number.isFinite(totalSeconds) ? ` • ~${totalSeconds}s` : ""}
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
          {Number.isFinite(totalSeconds) && (
            <button
              type="button"
              style={{ ...styles.btn, opacity: disabled ? 0.6 : 1 }}
              onClick={() => setRunning((v) => !v)}
              disabled={disabled}
              className={!running ? "bb-go" : undefined}
            >
              {running ? "Pause ⏸" : "Start ▶️"}
            </button>
          )}

          <button
            type="button"
            style={{ ...styles.btnDone, opacity: disabled ? 0.6 : 1 }}
            onClick={() => onSubmit?.({ done: true })}
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
