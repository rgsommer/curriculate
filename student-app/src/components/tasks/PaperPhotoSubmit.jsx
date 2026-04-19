// student-app/src/components/tasks/PaperPhotoSubmit.jsx
// Per-player photo capture for paper-mode tasks.
// Each team member snaps their own paper in turn, then the group submits.
// For group tasks (groupMode=true), only one photo is needed.
import React, { useRef, useState } from "react";
import StepCircle from "./StepCircle";

export default function PaperPhotoSubmit({
  memberNames = [],
  groupMode = false,
  onSubmit,
  disabled = false,
  taskTitle = "",
  prompts = [],       // optional: questions/focus hints to display
  promptsLabel = "",   // e.g. "Questions to answer:" or "Focus areas:"
}) {
  const names = Array.isArray(memberNames) && memberNames.length > 0
    ? memberNames.filter(Boolean)
    : ["You"];
  const totalSlots = groupMode ? 1 : names.length;

  // Each slot: { name, photoDataUrl, status: "waiting"|"done" }
  const [photos, setPhotos] = useState(() =>
    Array.from({ length: totalSlots }, (_, i) => ({
      name: groupMode ? "Group" : (names[i] || `Player ${i + 1}`),
      photoDataUrl: null,
      status: "waiting",
    }))
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef(null);

  const completedCount = photos.filter(p => p.status === "done").length;
  const allDone = completedCount >= totalSlots;

  const handlePickPhoto = (idx) => {
    if (disabled || submitted) return;
    setActiveIdx(idx);
    fileRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhotos(prev => prev.map((p, i) =>
        i === activeIdx ? { ...p, photoDataUrl: reader.result, status: "done" } : p
      ));
      // Auto-advance to next unfinished player
      if (!groupMode) {
        const nextEmpty = photos.findIndex((p, i) => i > activeIdx && p.status === "waiting");
        if (nextEmpty >= 0) setActiveIdx(nextEmpty);
      }
    };
    reader.readAsDataURL(file);
    // Reset the input so the same file can be re-selected
    e.target.value = "";
  };

  const handleRetake = (idx) => {
    if (disabled || submitted) return;
    setPhotos(prev => prev.map((p, i) =>
      i === idx ? { ...p, photoDataUrl: null, status: "waiting" } : p
    ));
  };

  const handleSubmit = () => {
    if (disabled || submitted) return;
    setSubmitted(true);
    onSubmit?.({
      paperMode: true,
      playerPhotos: photos.map(p => ({
        name: p.name,
        photoDataUrl: p.photoDataUrl,
      })),
      photoCount: completedCount,
      totalPlayers: totalSlots,
      groupMode,
    });
  };

  const uiDisabled = disabled || submitted;

  return (
    <div style={{ marginTop: 4 }}>
      {/* Hidden file input */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Prompts / questions (if any) */}
      {prompts.length > 0 && (
        <div style={{
          background: "#f8fafc",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}>
          {promptsLabel && (
            <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#334155", marginBottom: 10 }}>
              {promptsLabel}
            </div>
          )}
          {prompts.map((text, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 6 }}>
              <StepCircle n={i + 1} size={24} />
              <span style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.4 }}>{text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Write-on-paper instruction */}
      <div style={{
        background: "linear-gradient(135deg, #fef3c7, #fde68a)",
        border: "1px solid #f59e0b",
        borderRadius: 16,
        padding: "16px 20px",
        marginBottom: 16,
        textAlign: "center",
      }}>
        <div style={{ fontSize: "1.8rem", marginBottom: 4 }}>✍️</div>
        <div style={{ fontSize: "1rem", fontWeight: 900, color: "#92400e", marginBottom: 2 }}>
          {groupMode
            ? "Write your answer on paper together"
            : `Each player writes on their own paper`}
        </div>
        <div style={{ fontSize: "0.8rem", color: "#a16207" }}>
          {groupMode
            ? "Then snap a photo of your group's work below."
            : `Write your name at the top, then your answer below.`}
        </div>
        <div style={{ fontSize: "0.75rem", color: "#a16207", marginTop: 4, fontWeight: 700 }}>
          📸 Your photo will be submitted for grading.
        </div>
      </div>

      {/* Player photo slots */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {photos.map((player, idx) => (
          <div
            key={idx}
            style={{
              borderRadius: 14,
              border: player.status === "done"
                ? "2px solid #22c55e"
                : idx === activeIdx && !submitted
                ? "2px solid #6366f1"
                : "1px solid #e2e8f0",
              background: player.status === "done" ? "#f0fdf4" : "#fff",
              padding: 14,
              transition: "border-color 0.2s, background 0.2s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: player.photoDataUrl ? 10 : 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <StepCircle n={idx + 1} size={28} />
                <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#1e293b" }}>
                  {player.name}
                </span>
                {player.status === "done" && (
                  <span style={{ color: "#22c55e", fontWeight: 700, fontSize: "0.8rem" }}>✓ Photo taken</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {player.status === "done" && !uiDisabled && (
                  <button
                    onClick={() => handleRetake(idx)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#6b7280",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Retake
                  </button>
                )}
                {player.status === "waiting" && !uiDisabled && (
                  <button
                    onClick={() => handlePickPhoto(idx)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: 10,
                      border: "none",
                      background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                      color: "#fff",
                      fontSize: "0.85rem",
                      fontWeight: 800,
                      cursor: "pointer",
                      boxShadow: "0 2px 8px rgba(99,102,241,0.3)",
                    }}
                  >
                    📸 Snap paper
                  </button>
                )}
              </div>
            </div>

            {/* Photo preview */}
            {player.photoDataUrl && (
              <div style={{
                borderRadius: 10,
                overflow: "hidden",
                border: "1px solid #e2e8f0",
              }}>
                <img
                  src={player.photoDataUrl}
                  alt={`${player.name}'s work`}
                  style={{
                    display: "block",
                    width: "100%",
                    maxHeight: 200,
                    objectFit: "cover",
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Progress indicator */}
      <div style={{
        fontSize: "0.85rem",
        color: "#6b7280",
        textAlign: "center",
        marginBottom: 10,
        fontWeight: 700,
      }}>
        {completedCount}/{totalSlots} photo{totalSlots !== 1 ? "s" : ""} captured
      </div>

      {/* Submit button */}
      <button
        onClick={handleSubmit}
        disabled={uiDisabled || completedCount === 0}
        style={{
          width: "100%",
          padding: "16px 24px",
          borderRadius: 14,
          border: "none",
          background: allDone
            ? "linear-gradient(135deg, #22c55e, #16a34a)"
            : completedCount > 0
            ? "linear-gradient(135deg, #3b82f6, #2563eb)"
            : "#e5e7eb",
          color: completedCount > 0 ? "#fff" : "#9ca3af",
          fontSize: "1.1rem",
          fontWeight: 900,
          cursor: completedCount > 0 && !uiDisabled ? "pointer" : "default",
          transition: "background 0.2s",
        }}
      >
        {submitted
          ? "Submitted! ✅"
          : allDone
          ? "Submit all photos"
          : completedCount > 0
          ? `Submit (${totalSlots - completedCount} still missing)`
          : "Take at least one photo to submit"}
      </button>

      {/* Skip to screen option */}
      {!submitted && completedCount === 0 && (
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <span style={{ fontSize: "0.8rem", color: "#9ca3af" }}>
            No camera? Use the "Type on screen" option above.
          </span>
        </div>
      )}
    </div>
  );
}
