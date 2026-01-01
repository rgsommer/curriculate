// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useMemo } from "react";
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";

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

  const right = <Pill theme="light">📅 {date}</Pill>;

  return (
    <TaskCardFrame
      theme="light"
      badge="🧠 Notes"
      title={title}
      subtitle={subtitle}
      right={right}
      style={{
        background:
          "radial-gradient(1200px 500px at 20% 0%, rgba(250,204,21,0.16), transparent 60%), linear-gradient(135deg, rgba(255,251,235,1), rgba(255,255,255,1))",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Pill theme="light" subtle>WRITE THIS IN YOUR NOTEBOOK!</Pill>
          <Pill theme="light">{pointsText}</Pill>
        </div>

        <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
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

              <div style={{ fontSize: 20, fontWeight: 900, color: "#0f172a", lineHeight: 1.25 }}>
                {String(b)}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 12, display: "flex", justifyContent: "center" }}>
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
