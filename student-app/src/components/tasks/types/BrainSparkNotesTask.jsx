// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect, useMemo } from "react";
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";

/**
 * Uses TaskCardFrame (shared UI) while preserving ALL prior behavior:
 * - bullets/title/subtitle/pointsText
 * - stickers (task.config.stickers fallback)
 * - gradeLevel sizing
 * - optional fontFamily
 * - completion sound when task.completed flips true
 */
export default function BrainSparkNotesTask({ task, onSubmit, disabled }) {
  const bullets = Array.isArray(task?.bullets) ? task.bullets : [];
  const title = String(task?.title || "Brain Spark Notes");
  const subtitle = String(task?.subtitle || "Understanding Key Concepts");
  const pointsText = String(task?.pointsText || "+10 points for everyone!");

  const date = useMemo(() => {
    try {
      return new Date().toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "";
    }
  }, []);

  useEffect(() => {
    if (task?.completed) {
      try {
        const a = new Audio("/sounds/victory.mp3");
        a.volume = 0.35;
        a.play().catch(() => {});
      } catch {
        // ignore
      }
    }
  }, [task?.completed]);

  const stickerRow =
    task?.config?.stickers && Array.isArray(task.config.stickers)
      ? task.config.stickers
      : ["✨", "🧠", "📒", "⭐", "✅"];

  const isPrimary = task?.gradeLevel && parseInt(task.gradeLevel, 10) <= 4;

  const noteFontFamily =
    task?.fontFamily ||
    "ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

  const right = <Pill theme="light">📅 {date}</Pill>;

  return (
    <TaskCardFrame
      theme="light"
      badge="🧠 Brain Spark Notes"
      title={title}
      subtitle={subtitle}
      right={right}
      // warm notebook vibe inside the shared frame
      style={{
        background:
          "radial-gradient(1200px 500px at 20% 0%, rgba(250,204,21,0.16), transparent 60%), linear-gradient(135deg, rgba(255,251,235,1), rgba(255,255,255,1))",
      }}
    >
      <style>{`
        @keyframes bsFloat {
          0%,100% { transform: translateY(0); }
          50% { transform: translateY(-6px); }
        }
      `}</style>

      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill theme="light" subtle>WRITE THIS IN YOUR NOTEBOOK!</Pill>
          <Pill theme="light">{pointsText}</Pill>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {stickerRow.map((s, i) => (
            <div
              key={i}
              aria-hidden="true"
              style={{
                padding: "10px 12px",
                borderRadius: 18,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "rgba(255,255,255,0.86)",
                boxShadow: "0 14px 40px rgba(15,23,42,0.08)",
                fontSize: 20,
                animation: "bsFloat 1.8s ease-in-out infinite",
                animationDelay: `${i * 0.08}s`,
              }}
            >
              {s}
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {(bullets.length ? bullets : ["(No notes were provided for this task.)"]).map((b, i) => (
            <div
              key={i}
              style={{
                borderRadius: 22,
                border: "1px solid rgba(15,23,42,0.10)",
                background: "rgba(255,255,255,0.86)",
                boxShadow: "0 14px 40px rgba(15,23,42,0.08)",
                padding: 14,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 16,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid rgba(15,23,42,0.10)",
                  background: "rgba(250,204,21,0.22)",
                  color: "rgba(15,23,42,0.92)",
                  fontWeight: 1100,
                  flex: "0 0 auto",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1}
              </div>

              <div
                style={{
                  fontSize: isPrimary ? 22 : 20,
                  fontWeight: 900,
                  color: "#0f172a",
                  lineHeight: 1.25,
                  fontFamily: noteFontFamily,
                }}
              >
                {String(b)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 10, display: "flex", justifyContent: "center" }}>
          <PrimaryButton
            disabled={disabled}
            onClick={() => onSubmit?.({ completed: true })}
            style={{ fontSize: 18, padding: "14px 18px" }}
          >
            I Wrote It Down! ✍️
          </PrimaryButton>
        </div>
      </div>
    </TaskCardFrame>
  );
}
