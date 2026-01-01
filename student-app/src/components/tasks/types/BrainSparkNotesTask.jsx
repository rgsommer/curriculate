// student-app/src/components/tasks/types/BrainSparkNotesTask.jsx
import React, { useEffect, useMemo } from "react";
import { TaskCardFrame, Pill, PrimaryButton } from "../taskStyles";

/**
 * Brain Spark Notes
 * - Presents a model set of notes for students to copy
 * - If bullets are missing, we attempt to recover from other fields (notes/text/prompt)
 * - Clear instructions + grade-aware note about teacher checking (Grades <= 10)
 */
export default function BrainSparkNotesTask({ task, onSubmit, disabled }) {
  const title = String(task?.title || "Brain Spark Notes");
  const subtitle = String(task?.subtitle || "Understanding Key Concepts");
  const pointsText = String(task?.pointsText || "+10 points for everyone!");

  const gradeNum = Number.isFinite(Number(task?.gradeLevel)) ? Number(task.gradeLevel) : null;
  const addTeacherCheckLine = gradeNum != null && gradeNum <= 10;

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

  const stickerRow =
    task?.config?.stickers && Array.isArray(task.config.stickers)
      ? task.config.stickers
      : ["✨", "🧠", "📒", "⭐", "✅"];

  const noteFontFamily =
    task?.fontFamily ||
    "ui-rounded, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";

  const bullets = useMemo(() => {
    // Primary: bullets array (preferred)
    let b = Array.isArray(task?.bullets) ? task.bullets : [];

    // If empty, try other common fields from taskGen
    if (!b.length) {
      const raw =
        task?.notes ||
        task?.modelNotes ||
        task?.text ||
        task?.content ||
        task?.prompt ||
        task?.description ||
        task?.config?.notes ||
        task?.config?.text ||
        "";

      if (typeof raw === "string" && raw.trim()) {
        // Split on newlines and common bullet markers
        b = raw
          .split(/\r?\n|•\s+|\*\s+|\-\s+|\d+\)\s+/g)
          .map((s) => String(s).trim())
          .filter(Boolean);
      }
    }

    // Normalize shapes (strings or objects)
    b = (Array.isArray(b) ? b : [])
      .map((it, idx) => {
        if (typeof it === "string") return it.trim();
        if (it && typeof it === "object") {
          const text = it.text || it.note || it.value || it.label || `Note ${idx + 1}`;
          return String(text).trim();
        }
        return String(it || `Note ${idx + 1}`).trim();
      })
      .filter(Boolean);

    // De-dupe (case-insensitive), preserve order
    const seen = new Set();
    b = b.filter((s) => {
      const k = s.toLowerCase();
      if (!k) return false;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Last resort fallback (never show empty board)
    if (!b.length) {
      const topic = String(task?.topic || task?.title || "today’s topic").trim();
      b = [
        `Define the key idea in 1 clear sentence (${topic}).`,
        `List 2–3 important details that support the main idea.`,
        `Write 1 example that shows the idea in real life.`,
        `Add 1 “why it matters” sentence (cause/effect or importance).`,
      ];
    }

    // Reasonable cap so it stays readable
    return b.slice(0, 12);
  }, [task]);

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

  const right = <Pill theme="light">📅 {date}</Pill>;

  return (
    <TaskCardFrame
      theme="light"
      badge="🧠 Brain Spark Notes"
      title={title}
      subtitle={subtitle}
      right={right}
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

        <div
          style={{
            padding: 14,
            borderRadius: 18,
            background: "rgba(255,255,255,0.75)",
            border: "1px solid rgba(15,23,42,0.12)",
          }}
        >
          <div style={{ fontWeight: 950, marginBottom: 8 }}>Instructions</div>
          <div style={{ lineHeight: 1.35, fontWeight: 850 }}>
            Copy these <b>exact notes</b> into your notebook.
            {addTeacherCheckLine && (
              <>
                {" "}
                <span style={{ opacity: 0.85 }}>
                  Your teacher may check and give you a grade for having this complete!
                </span>
              </>
            )}
          </div>
        </div>

        {/* Notes */}
        <div
          style={{
            padding: 18,
            borderRadius: 22,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(15,23,42,0.12)",
            boxShadow: "0 18px 40px rgba(15,23,42,0.08)",
            fontFamily: noteFontFamily,
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
            {stickerRow.slice(0, 6).map((s, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex",
                  width: 34,
                  height: 34,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.22)",
                  animation: "bsFloat 3.2s ease-in-out infinite",
                  animationDelay: `${i * 120}ms`,
                }}
              >
                {s}
              </span>
            ))}
          </div>

          <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 10 }}>
            {bullets.map((b, idx) => (
              <li key={idx} style={{ fontSize: 16, fontWeight: 850, lineHeight: 1.35 }}>
                {b}
              </li>
            ))}
          </ol>
        </div>

        {/* Done button */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <PrimaryButton
            disabled={disabled}
            onClick={() => {
              // Keep simple completion semantics (matches other tasks)
              onSubmit?.({ done: true });
            }}
          >
            DONE ✅
          </PrimaryButton>
        </div>
      </div>
    </TaskCardFrame>
  );
}
