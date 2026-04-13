// student-app/src/components/FeedbackButton.jsx
import React, { useState } from "react";
import { API_BASE_URL } from "../config.js";

const FEEDBACK_TYPES = [
  { value: "task-problem", label: "Problem with this task" },
  { value: "confusing", label: "Something is confusing" },
  { value: "wrong-answer", label: "I think the answer is wrong" },
  { value: "app-bug", label: "App isn't working right" },
  { value: "other", label: "Other" },
];

export default function FeedbackButton({
  roomCode,
  teamName,
  members,
  tasksetName,
  currentTask,
  currentTaskIndex,
  totalTasks,
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!type) return;
    setSending(true);

    // Gather device info
    const ua = navigator.userAgent || "";
    let browser = "Unknown";
    if (ua.includes("CriOS")) browser = "Chrome (iOS)";
    else if (ua.includes("FxiOS")) browser = "Firefox (iOS)";
    else if (ua.includes("EdgiOS") || ua.includes("Edg/")) browser = "Edge";
    else if (ua.includes("Chrome") && !ua.includes("Edg")) browser = "Chrome";
    else if (ua.includes("Safari") && !ua.includes("Chrome")) browser = "Safari";
    else if (ua.includes("Firefox")) browser = "Firefox";

    let platform = "Unknown";
    if (/iPad/.test(ua)) platform = "iPad";
    else if (/iPhone/.test(ua)) platform = "iPhone";
    else if (/Android/.test(ua)) platform = "Android";
    else if (/Macintosh/.test(ua)) platform = "Mac";
    else if (/Windows/.test(ua)) platform = "Windows";
    else if (/CrOS/.test(ua)) platform = "Chromebook";

    const deviceInfo = {
      platform,
      browser,
      screenSize: `${window.screen.width}x${window.screen.height}`,
      viewportSize: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: ua,
    };

    try {
      await fetch(`${API_BASE_URL}/feedback/student`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: roomCode || "unknown",
          teamName: teamName || "unknown",
          members: members || [],
          tasksetName: tasksetName || "unknown",
          taskTitle: currentTask?.title || "unknown",
          taskType: currentTask?.taskType || "unknown",
          taskIndex: currentTaskIndex != null ? currentTaskIndex + 1 : null,
          totalTasks: totalTasks || null,
          feedbackType: type,
          message: message.trim(),
          deviceInfo,
        }),
      });
      setSent(true);
      setTimeout(() => {
        setOpen(false);
        setSent(false);
        setType("");
        setMessage("");
      }, 1800);
    } catch (err) {
      console.error("Feedback send failed:", err);
    } finally {
      setSending(false);
    }
  };

  // Floating button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Send feedback"
        style={{
          position: "fixed",
          bottom: 56,
          right: 12,
          zIndex: 10000,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "none",
          background: "rgba(30,41,59,0.75)",
          color: "#fff",
          fontSize: 20,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(6px)",
        }}
      >
        💬
      </button>
    );
  }

  // Modal overlay
  return (
    <div
      onClick={() => { if (!sending) setOpen(false); }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 16,
          padding: 20,
          width: "100%",
          maxWidth: 380,
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
          color: "#1e293b",
        }}
      >
        {sent ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Thanks for the feedback!</div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Send Feedback</h3>
              <button
                onClick={() => setOpen(false)}
                style={{
                  border: "none",
                  background: "none",
                  fontSize: 22,
                  cursor: "pointer",
                  color: "#64748b",
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ✕
              </button>
            </div>

            {currentTask && (
              <div style={{
                fontSize: 12,
                color: "#64748b",
                marginBottom: 12,
                padding: "6px 10px",
                background: "#f1f5f9",
                borderRadius: 8,
              }}>
                Currently on: <strong>{currentTask.title || currentTask.taskType}</strong>
                {currentTaskIndex != null && totalTasks && (
                  <span> (Task {currentTaskIndex + 1}/{totalTasks})</span>
                )}
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#334155" }}>
                What are you experiencing?
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {FEEDBACK_TYPES.map((ft) => (
                  <button
                    key={ft.value}
                    onClick={() => setType(ft.value)}
                    style={{
                      textAlign: "left",
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: type === ft.value ? "2px solid #3b82f6" : "1px solid #e2e8f0",
                      background: type === ft.value ? "#eff6ff" : "#fff",
                      fontSize: 14,
                      cursor: "pointer",
                      color: "#1e293b",
                      fontWeight: type === ft.value ? 600 : 400,
                    }}
                  >
                    {ft.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#334155" }}>
                Tell us more (optional)
              </div>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe what happened..."
                maxLength={500}
                rows={3}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 14,
                  fontFamily: "inherit",
                  resize: "vertical",
                  color: "#1e293b",
                }}
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={!type || sending}
              style={{
                width: "100%",
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                background: !type ? "#94a3b8" : "#3b82f6",
                color: "#fff",
                fontSize: 15,
                fontWeight: 600,
                cursor: !type ? "default" : "pointer",
                opacity: sending ? 0.6 : 1,
              }}
            >
              {sending ? "Sending..." : "Send Feedback"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
