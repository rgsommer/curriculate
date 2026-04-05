// teacher-app/src/pages/TaskSetEditor.jsx
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiFetchJson } from "../api/apiFetch";

/* -------------------- helpers -------------------- */

function getStoredAuthToken() {
  const candidates = [
    "curriculateToken",
    "curriculate_token",
    "token",
    "authToken",
    "accessToken",
    "jwt",
  ];
  for (const k of candidates) {
    try {
      const v = localStorage.getItem(k) || sessionStorage.getItem(k);
      if (typeof v === "string" && v.trim().length > 40) return v.trim();
    } catch {}
  }
  return "";
}

function safeParseTasks(json) {
  const parsed = JSON.parse(json || "[]");
  if (!Array.isArray(parsed)) throw new Error("Tasks must be a JSON array.");
  return parsed;
}

function isVocabularyTask(t) {
  return (
    t &&
    t.taskType === "open-text" &&
    t.config &&
    t.config.kind === "vocabulary-paragraph"
  );
}

/* -------------------- component -------------------- */

export default function TaskSetEditor() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [description, setDescription] = useState("");
  const [tasksJson, setTasksJson] = useState("[]");

  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");

  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 2500);
  }, []);

  useEffect(() => {
    return () => toastTimerRef.current && clearTimeout(toastTimerRef.current);
  }, []);

  /* -------------------- load -------------------- */

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await apiFetchJson(`/api/tasksets/${encodeURIComponent(id)}`);
      const ts = data?.taskset || data;

      setTitle(String(ts?.title || ts?.name || ""));
      setSubject(String(ts?.subject || ""));
      setGrade(String(ts?.grade || ""));
      setDescription(String(ts?.description || ""));
      setTasksJson(JSON.stringify(ts?.tasks || [], null, 2));
    } catch (e) {
      setError(e?.message || "Could not load task set");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  /* -------------------- save -------------------- */

  const save = async () => {
    setError("");
    let tasks;
    try {
      tasks = safeParseTasks(tasksJson);
    } catch (e) {
      setError(e.message);
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        name: title.trim(),
        subject: subject.trim(),
        grade: grade.trim(),
        description: description.trim(),
        tasks,
      };

      const data = id
        ? await apiFetchJson(`/api/tasksets/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await apiFetchJson(`/api/tasksets`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

      const newId = data?.taskset?._id || data?._id || id;
      showToast("Saved");
      if (!id && newId) navigate(`/tasksets/${newId}`);
    } catch (e) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleShareClick = async () => {
    if (!id) {
      showToast("Save the task set first");
      return;
    }

    setShareLoading(true);
    setError("");
    try {
      const data = await apiFetchJson("/api/shared/create-link", {
        method: "POST",
        body: { tasksetId: id },
      });

      if (!data?.ok) throw new Error(data?.error || "Failed to create share link");

      setShareLink(data.link);
      setShareExpiresAt(data.expiresAt);
      setShareModalOpen(true);
    } catch (e) {
      setError(e?.message || "Failed to create share link");
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink).then(() => {
        showToast("Link copied!");
      });
    }
  };

  /* -------------------- vocabulary editor helpers -------------------- */

  const updateTaskAtIndex = (idx, updater) => {
    const tasks = safeParseTasks(tasksJson);
    tasks[idx] = updater({ ...tasks[idx] });
    setTasksJson(JSON.stringify(tasks, null, 2));
  };

  /* -------------------- styles -------------------- */

  const card = {
    borderRadius: 16,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: 16,
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
    marginTop: 16,
  };

  const chip = {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #d1d5db",
    background: "#f9fafb",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  };

  /* -------------------- render -------------------- */

  let parsedTasks = [];
  try {
    parsedTasks = safeParseTasks(tasksJson);
  } catch {}

  return (
    <div style={{ padding: 24, maxWidth: 1050, margin: "0 auto" }}>
      {toast && (
        <div style={{ position: "fixed", right: 18, bottom: 18, background: "#111827", color: "#fff", padding: "10px 14px", borderRadius: 12, fontWeight: 900 }}>
          {toast}
        </div>
      )}

      <h1>{id ? "Edit Task Set" : "New Task Set"}</h1>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", padding: 10, borderRadius: 12, color: "#b91c1c", fontWeight: 800 }}>
          {error}
        </div>
      )}

      {/* Vocabulary Task Panels */}
      {parsedTasks.map((t, i) =>
        isVocabularyTask(t) ? (
          <div key={i} style={card}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>
              Vocabulary Paragraph (Vocab Weave)
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(t.config.requiredWords || []).map((w, wi) => (
                <span key={wi} style={chip}>
                  {w}
                  <button
                    onClick={() =>
                      updateTaskAtIndex(i, (task) => {
                        task.config.requiredWords.splice(wi, 1);
                        return task;
                      })
                    }
                    style={{ border: "none", background: "transparent", cursor: "pointer" }}
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            <div style={{ marginTop: 8 }}>
              <input
                placeholder="Add vocabulary word"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target.value.trim()) {
                    const word = e.target.value.trim();
                    updateTaskAtIndex(i, (task) => {
                      task.config.requiredWords = [
                        ...(task.config.requiredWords || []),
                        word,
                      ];
                      return task;
                    });
                    e.target.value = "";
                  }
                }}
                style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #d1d5db" }}
              />
            </div>
          </div>
        ) : null
      )}

      {/* Raw JSON editor (unchanged) */}
      <div style={card}>
        <div style={{ fontWeight: 900, marginBottom: 6 }}>Tasks (JSON)</div>
        <textarea
          value={tasksJson}
          onChange={(e) => setTasksJson(e.target.value)}
          spellCheck={false}
          style={{
            width: "100%",
            minHeight: 320,
            fontFamily: "ui-monospace, monospace",
            padding: 12,
            borderRadius: 12,
            border: "1px solid #d1d5db",
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={() => navigate("/tasksets")}>Back</button>
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
        {id && (
          <button onClick={handleShareClick} disabled={shareLoading} style={{ marginLeft: "auto" }}>
            {shareLoading ? "Creating link…" : "Share with Substitute"}
          </button>
        )}
      </div>

      {/* Share Link Modal */}
      {shareModalOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.5)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: "#fff",
            borderRadius: 16,
            padding: 24,
            maxWidth: 500,
            boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>Share Task Set</h2>
            <p style={{ color: "#6b7280", marginBottom: 16 }}>
              Share this link with a substitute teacher. It expires in 7 days.
            </p>
            <div style={{
              background: "#f3f4f6",
              padding: 12,
              borderRadius: 8,
              marginBottom: 12,
              fontFamily: "monospace",
              wordBreak: "break-all",
              fontSize: "0.9rem",
            }}>
              {shareLink}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 16 }}>
              Expires: {shareExpiresAt ? new Date(shareExpiresAt).toLocaleDateString() : ""}
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => setShareModalOpen(false)}
                style={{ background: "#e5e7eb", color: "#000" }}
              >
                Close
              </button>
              <button onClick={handleCopyLink}>
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
