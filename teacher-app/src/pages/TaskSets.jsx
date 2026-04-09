// teacher-app/src/pages/TaskSets.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetchJson } from "../api/apiFetch";

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

function fmtDate(d) {
  if (!d) return "";
  try {
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return "";
    return dt.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function safeStr(v) {
  return String(v ?? "").trim();
}

function stripTasksetPrefix(s) {
  // Remove legacy "Taskset: " prefix that was hardcoded in older versions
  return s.replace(/^taskset:\s*/i, "").trim();
}

function getTitle(ts) {
  const raw =
    safeStr(ts?.title) ||
    safeStr(ts?.name) ||
    safeStr(ts?.tasksetTitle) ||
    safeStr(ts?.tasksetName) ||
    "Task Set";
  return stripTasksetPrefix(raw);
}

function getSubject(ts) {
  return safeStr(ts?.subject || ts?.subjectArea || ts?.topic || ts?.category || "");
}

function getGrade(ts) {
  return safeStr(ts?.grade || ts?.gradeLevel || ts?.gradeBand || "");
}

function getTasksCount(ts) {
  const n = Number(
    ts?.numTasks ??
      ts?.taskCount ??
      (Array.isArray(ts?.tasks) ? ts.tasks.length : 0)
  );
  return Number.isFinite(n) ? n : 0;
}

function getTimesPlayed(ts) {
  const n = Number(ts?.timesPlayed ?? ts?.totalPlays ?? ts?.playedCount ?? ts?.runs ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getLastPlayed(ts) {
  return ts?.lastPlayedAt || ts?.lastPlayed || ts?.playedAt || null;
}

/**
 * IMPORTANT:
 * Backend GET /api/tasksets/:id returns { ok:true, taskset:{...} } (per your tasksets.js route).
 * So we must unwrap data.taskset where present.
 */
function unwrapTasksetResponse(data) {
  if (!data) return null;
  if (data.taskset && typeof data.taskset === "object") return data.taskset;
  // tolerate legacy shapes
  if (data.set && typeof data.set === "object") return data.set;
  if (data.ok && typeof data === "object") return null;
  // some APIs return the doc directly
  if (typeof data === "object") return data;
  return null;
}

function extractGenerationReport(taskset) {
  if (!taskset || typeof taskset !== "object") return null;
  const candidates = [
    taskset?.generationReport,
    taskset?.meta?.generationReport,
    taskset?.meta?.generation?.report,
    taskset?.meta?.generation?.generationReport,
    taskset?.meta?.report,
    taskset?.report,
  ];
  for (const c of candidates) {
    if (c && typeof c === "object") return c;
  }
  return null;
}

function extractBloomsLabel(report) {
  if (!report || typeof report !== "object") return "";
  const direct =
    safeStr(report?.bloomsIndicator) ||
    safeStr(report?.blooms?.indicator) ||
    safeStr(report?.blooms?.dominant) ||
    safeStr(report?.blooms?.overall?.level) ||
    safeStr(report?.blooms?.overall?.label) ||
    safeStr(report?.overallBlooms) ||
    safeStr(report?.bloomsLevel);
  return direct;
}

function extractCognitiveSkills(report) {
  if (!report || typeof report !== "object") return [];
  const arr =
    report?.cognitiveSkills ||
    report?.skills ||
    report?.cognition ||
    report?.cognitive ||
    report?.summary?.cognitiveSkills ||
    null;

  if (Array.isArray(arr)) return arr.map((x) => safeStr(x)).filter(Boolean);
  if (arr && typeof arr === "object") {
    return Object.keys(arr)
      .map((k) => safeStr(k))
      .filter(Boolean);
  }
  return [];
}

function extractConceptCoverageRows(report) {
  if (!report || typeof report !== "object") return [];

  const list =
    report?.coverage?.actual?.matrix ||
    report?.coverage?.concepts ||
    report?.conceptCoverage ||
    report?.concepts ||
    report?.coverageRows ||
    null;

  if (Array.isArray(list)) {
    return list
      .map((row) => {
        const concept =
          safeStr(row?.concept) ||
          safeStr(row?.term) ||
          safeStr(row?.key) ||
          safeStr(row?.label);

        const objective =
          Number(
            row?.objective ??
              row?.objectiveCount ??
              row?.objectiveHits ??
              row?.objectiveUses ??
              0
          ) || 0;

        const analytical =
          Number(
            row?.analytical ??
              row?.analyticalCount ??
              row?.analysisHits ??
              row?.analyticalUses ??
              0
          ) || 0;

        if (!concept) return null;
        return { concept, objective, analytical };
      })
      .filter(Boolean);
  }

  const matrix = report?.coverageMatrix || report?.coverage?.matrix || report?.coverage?.actual?.matrix || null;
  if (matrix && typeof matrix === "object") {
    return Object.entries(matrix)
      .map(([concept, v]) => {
        const obj = Number(v?.objective ?? v?.obj ?? 0) || 0;
        const ana = Number(v?.analytical ?? v?.analysis ?? v?.ana ?? 0) || 0;
        const c = safeStr(concept);
        if (!c) return null;
        return { concept: c, objective: obj, analytical: ana };
      })
      .filter(Boolean);
  }

  return [];
}

function extractNotCovered(report) {
  if (!report || typeof report !== "object") return [];
  const arr =
    report?.coverage?.actual?.notCovered ||
    report?.notCovered ||
    report?.coverage?.notCovered ||
    report?.coverage?.missingConcepts ||
    report?.missingConcepts ||
    report?.uncoveredConcepts ||
    null;

  if (!Array.isArray(arr)) return [];
  return arr.map((x) => safeStr(x)).filter(Boolean);
}

function extractObjectiveOnly(report) {
  if (!report || typeof report !== "object") return null;
  const v =
    report?.objectiveCoverageOnly ??
    report?.summary?.objectiveCoverageOnly ??
    report?.coverage?.objectiveOnly ??
    null;
  return typeof v === "number" ? v : null;
}

function extractReinforcement(report) {
  if (!report || typeof report !== "object") return null;
  const v =
    report?.analyticalReinforcement ??
    report?.summary?.analyticalReinforcement ??
    report?.coverage?.reinforcement ??
    null;
  return typeof v === "number" ? v : null;
}

export default function TaskSets() {
  const navigate = useNavigate();

  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const allIds = useMemo(
    () =>
      Array.isArray(sets)
        ? sets.map((s) => String(s?._id || s?.id || "")).filter(Boolean)
        : [],
    [sets]
  );

  const [sortFields, setSortFields] = useState([
    "subject",
    "createdAt",
    "name",
    "timesPlayed",
  ]);
  const dragFieldRef = useRef(null);

  const [toast, setToast] = useState("");
  const toastTimerRef = useRef(null);
  const showToast = useCallback((msg) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), 2500);
  }, []);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportTasksetMeta, setReportTasksetMeta] = useState(null);
  const [reportData, setReportData] = useState(null);
  const reportCacheRef = useRef(new Map());

  // Share modal state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetchJson("/api/tasksets");
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.tasksets)
          ? data.tasksets
          : Array.isArray(data?.sets)
            ? data.sets
            : [];
      setSets(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error("[TaskSets] load failed:", e);
      setError(e?.message || "Could not load task sets");
      setSets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSets();
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [loadSets]);

  const sortedSets = useMemo(() => {
    const out = Array.isArray(sets) ? [...sets] : [];

    const keyVal = (ts, key) => {
      switch (key) {
        case "subject":
          return getSubject(ts).toLowerCase();
        case "createdAt":
          return ts?.createdAt ? new Date(ts.createdAt).getTime() : 0;
        case "name":
          return getTitle(ts).toLowerCase();
        case "timesPlayed":
          return getTimesPlayed(ts);
        default:
          return "";
      }
    };

    out.sort((a, b) => {
      for (const f of sortFields) {
        const av = keyVal(a, f);
        const bv = keyVal(b, f);
        if (av === bv) continue;

        const desc = f === "timesPlayed" || f === "createdAt";

        if (typeof av === "number" && typeof bv === "number") {
          return desc ? bv - av : av - bv;
        }
        const cmp = String(av).localeCompare(String(bv));
        return desc ? -cmp : cmp;
      }
      return 0;
    });

    return out;
  }, [sets, sortFields]);

  const toggleSelected = (id) => {
    const sid = String(id || "");
    if (!sid) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

  const setAllSelected = (on) => {
    setSelectedIds(() => (on ? new Set(allIds) : new Set()));
  };

  const deleteOne = async (id) => {
    const sid = String(id || "");
    if (!sid) return;
    if (!window.confirm("Delete this task set permanently? This cannot be undone."))
      return;
    try {
      await apiFetchJson(`/api/tasksets/${encodeURIComponent(sid)}`, {
        method: "DELETE",
      });
      await loadSets();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(sid);
        return next;
      });
    } catch (e) {
      setError(e?.message || "Delete failed");
    }
  };

  const deleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} task set(s) permanently? This cannot be undone.`
      )
    )
      return;

    let failed = 0;
    for (const sid of ids) {
      try {
        await apiFetchJson(`/api/tasksets/${encodeURIComponent(sid)}`, {
          method: "DELETE",
        });
      } catch {
        failed += 1;
      }
    }
    await loadSets();
    setSelectedIds(new Set());
    if (failed) setError(`${failed} deletion(s) failed (see server logs).`);
  };

  const setActive = (taskset) => {
    const id = taskset?._id || taskset?.id;
    if (!id) return;
    const meta = {
      _id: id,
      name: getTitle(taskset),
      numTasks: getTasksCount(taskset),
    };
    localStorage.setItem("curriculateActiveTasksetId", String(id));
    localStorage.setItem("curriculateActiveTasksetMeta", JSON.stringify(meta));
  };

  const launchNow = (taskset) => {
    setActive(taskset);
    localStorage.setItem("curriculateLaunchImmediately", "true");
    navigate("/live");
  };

  const copyShareLink = async (taskset) => {
    const id = taskset?._id || taskset?.id;
    if (!id) return;
    try {
      const data = await apiFetchJson("/api/shared/create-link", {
        method: "POST",
        body: { tasksetId: id },
      });
      if (!data?.ok || !data?.link) {
        throw new Error(data?.error || "Share failed");
      }
      setShareLink(String(data.link));
      setShareExpiresAt(data.expiresAt || "");
      setInviteEmail("");
      setInviteMessage("");
      setInviteSent(false);
      setShareModalOpen(true);
    } catch (e) {
      setError(e?.message || "Share failed");
    }
  };

  const handleCopyShareLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink).then(() => showToast("Link copied!")).catch(() => {});
    }
  };

  const handleSendInvite = async () => {
    if (!inviteEmail.trim()) return;
    const token = shareLink.split("/share/")[1];
    if (!token) { showToast("Invalid share link"); return; }
    setInviteSending(true);
    setInviteSent(false);
    try {
      const data = await apiFetchJson(`/api/shared/${token}/send-invite`, {
        method: "POST",
        body: { toEmail: inviteEmail.trim(), message: inviteMessage.trim() || undefined },
      });
      if (!data?.ok) throw new Error(data?.error || "Failed to send invite");
      setInviteSent(true);
      setInviteEmail("");
      setInviteMessage("");
      showToast("Invite sent!");
    } catch (e) {
      showToast(e?.message || "Failed to send invite");
    } finally {
      setInviteSending(false);
    }
  };

  const openReport = async (taskset) => {
    const id = String(taskset?._id || taskset?.id || "");
    if (!id) return;

    setReportOpen(true);
    setReportError("");
    setReportTasksetMeta({
      id,
      title: getTitle(taskset),
      subject: getSubject(taskset),
      grade: getGrade(taskset),
      difficulty: (taskset?.difficulty || "").toUpperCase(),
      learningGoal: (taskset?.learningGoal || "").trim(),
      durationMinutes: Number(taskset?.durationMinutes) || null,
      tasks: taskset?.tasks || [],
    });

    const cached = reportCacheRef.current.get(id);
    if (cached) {
      setReportData(cached);
      return;
    }

    function buildNormalized(source) {
      const report = extractGenerationReport(source);
      // Vocabulary: try meta.conceptAllocation.requestedConcepts, then coverage.requested
      const concepts =
        source?.meta?.conceptAllocation?.requestedConcepts ||
        source?.meta?.coverage?.requested ||
        [];

      // Not-covered: try generation report first, fall back to meta.coverage.missing
      const notCoveredFromReport = report ? extractNotCovered(report) : [];
      const notCovered = notCoveredFromReport.length
        ? notCoveredFromReport
        : (source?.meta?.coverage?.missing || []).map((x) => String(x || "").trim()).filter(Boolean);

      // Coverage rows: try generation report first, fall back to meta.coverage
      const rowsFromReport = report ? extractConceptCoverageRows(report) : [];

      return {
        raw: report || null,
        blooms: report ? extractBloomsLabel(report) : "",
        cognitiveSkills: report ? extractCognitiveSkills(report) : [],
        rows: rowsFromReport,
        notCovered,
        objectiveOnly: report ? extractObjectiveOnly(report) : [],
        reinforcement: report ? extractReinforcement(report) : [],
        concepts,
      };
    }

    const immediateNorm = buildNormalized(taskset);
    if (immediateNorm.raw || immediateNorm.concepts.length) {
      reportCacheRef.current.set(id, immediateNorm);
      setReportData(immediateNorm);
      return;
    }

    setReportLoading(true);
    setReportData(null);
    try {
      const data = await apiFetchJson(`/api/tasksets/${encodeURIComponent(id)}`);
      const fullSet = unwrapTasksetResponse(data);
      if (!fullSet) {
        throw new Error("Failed to load taskset.");
      }

      // Update meta with full data from API
      setReportTasksetMeta((prev) => ({
        ...prev,
        subject: getSubject(fullSet) || prev?.subject,
        grade: getGrade(fullSet) || prev?.grade,
        difficulty: (fullSet?.difficulty || prev?.difficulty || "").toUpperCase(),
        learningGoal: (fullSet?.learningGoal || prev?.learningGoal || "").trim(),
        durationMinutes: Number(fullSet?.durationMinutes) || prev?.durationMinutes || null,
        tasks: fullSet?.tasks || prev?.tasks || [],
      }));

      const normalized = buildNormalized(fullSet);
      reportCacheRef.current.set(id, normalized);
      setReportData(normalized);
    } catch (e) {
      setReportError(e?.message || "Failed to load report data");
    } finally {
      setReportLoading(false);
    }
  };

  const closeReport = () => {
    setReportOpen(false);
    setReportLoading(false);
    setReportError("");
    setReportTasksetMeta(null);
    setReportData(null);
  };

  const onDragStart = (field) => {
    dragFieldRef.current = field;
  };
  const onDropField = (targetField) => {
    const from = dragFieldRef.current;
    dragFieldRef.current = null;
    if (!from || from === targetField) return;
    setSortFields((prev) => {
      const next = [...prev];
      const fromIdx = next.indexOf(from);
      const toIdx = next.indexOf(targetField);
      if (fromIdx === -1 || toIdx === -1) return prev;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, from);
      return next;
    });
  };

  const page = {
    padding: 24,
    maxWidth: 1180,
    margin: "0 auto",
    fontFamily:
      'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    color: "#111827",
  };

  const card = {
    borderRadius: 16,
    border: "1px solid #e5e7eb",
    background: "#ffffff",
    padding: 14,
    boxShadow: "0 1px 2px rgba(15,23,42,0.05)",
  };

  const btn = (variant = "secondary") => {
    const base = {
      borderRadius: 999,
      padding: "7px 12px",
      fontSize: "0.85rem",
      fontWeight: 800,
      cursor: "pointer",
      border: "1px solid transparent",
    };
    if (variant === "primary")
      return {
        ...base,
        background: "#2563eb",
        color: "#fff",
        borderColor: "#2563eb",
      };
    if (variant === "danger")
      return {
        ...base,
        background: "#fff",
        color: "#b91c1c",
        borderColor: "#fecaca",
      };
    if (variant === "ghost")
      return {
        ...base,
        background: "transparent",
        color: "#111827",
        borderColor: "rgba(17,24,39,0.18)",
      };
    return {
      ...base,
      background: "#fff",
      color: "#111827",
      borderColor: "#d1d5db",
    };
  };

  const chip = (isDragging) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderRadius: 999,
    border: "1px solid rgba(15,23,42,0.12)",
    background: isDragging ? "rgba(37,99,235,0.12)" : "rgba(15,23,42,0.04)",
    cursor: "grab",
    fontSize: 12,
    fontWeight: 900,
    userSelect: "none",
  });

  const modalOverlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalCard = {
    width: "min(920px, 100%)",
    maxHeight: "min(84vh, 820px)",
    overflow: "auto",
    background: "#fff",
    borderRadius: 18,
    border: "1px solid rgba(15,23,42,0.12)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
    padding: 16,
  };

  const table = {
    width: "100%",
    borderCollapse: "separate",
    borderSpacing: 0,
    border: "1px solid #e5e7eb",
    borderRadius: 14,
    overflow: "hidden",
  };

  const th = {
    textAlign: "left",
    fontSize: 12,
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    color: "#6b7280",
    padding: "10px 12px",
    borderBottom: "1px solid #e5e7eb",
    background: "#f9fafb",
  };

  const td = {
    padding: "10px 12px",
    borderBottom: "1px solid #f1f5f9",
    fontWeight: 700,
    color: "#111827",
    verticalAlign: "top",
  };

  return (
    <div style={page}>
      {toast && (
        <div
          style={{
            position: "fixed",
            right: 18,
            bottom: 18,
            background: "#111827",
            color: "#fff",
            padding: "10px 12px",
            borderRadius: 12,
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
            fontWeight: 800,
            zIndex: 9999,
          }}
        >
          {toast}
        </div>
      )}

      {reportOpen && (
        <div
          style={modalOverlay}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeReport();
          }}
          role="dialog"
          aria-modal="true"
        >
          <div style={modalCard}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 1000, fontSize: "1.1rem" }}>
                  Generation Report
                </div>
                <div
                  style={{
                    marginTop: 4,
                    color: "#6b7280",
                    fontWeight: 800,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={reportTasksetMeta?.title || ""}
                >
                  {reportTasksetMeta?.title || "Task Set"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {reportTasksetMeta?.id && (
                  <button
                    type="button"
                    style={btn("secondary")}
                    onClick={() =>
                      navigate(`/tasksets/${encodeURIComponent(reportTasksetMeta.id)}`)
                    }
                  >
                    Open set
                  </button>
                )}
                <button type="button" style={btn("ghost")} onClick={closeReport}>
                  Close
                </button>
              </div>
            </div>

            {reportError && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  borderRadius: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  fontWeight: 800,
                }}
              >
                {reportError}
              </div>
            )}

            {/* ── Generation summary chips ── */}
            {reportTasksetMeta && (() => {
              const m = reportTasksetMeta;
              const diffLabel = m.difficulty === "EASY" ? "Easy"
                : m.difficulty === "MEDIUM" ? "Medium"
                : m.difficulty === "HARD" ? "Hard" : "";
              const diffColor = m.difficulty === "EASY" ? "#16a34a"
                : m.difficulty === "MEDIUM" ? "#ca8a04"
                : m.difficulty === "HARD" ? "#dc2626" : "#6b7280";
              const goalLabel = m.learningGoal
                ? m.learningGoal.charAt(0).toUpperCase() + m.learningGoal.slice(1).toLowerCase()
                : "";

              // Task type breakdown
              const typeCounts = {};
              (m.tasks || []).forEach((t) => {
                const raw = t?.taskType || t?.type || "unknown";
                const label = raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                typeCounts[label] = (typeCounts[label] || 0) + 1;
              });
              const typeEntries = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);

              const chipStyle = {
                display: "inline-block",
                padding: "5px 10px",
                borderRadius: 999,
                border: "1px solid rgba(15,23,42,0.12)",
                background: "rgba(15,23,42,0.04)",
                fontWeight: 900,
                fontSize: 12,
              };

              return (
                <div style={{ marginTop: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {m.subject && <span style={chipStyle}>{m.subject}</span>}
                  {m.grade && <span style={chipStyle}>Grade {m.grade}</span>}
                  {diffLabel && (
                    <span style={{ ...chipStyle, color: diffColor, borderColor: diffColor + "40" }}>
                      {diffLabel}
                    </span>
                  )}
                  {goalLabel && (
                    <span style={{ ...chipStyle, color: "#7c3aed", borderColor: "rgba(124,58,237,0.25)" }}>
                      {goalLabel}
                    </span>
                  )}
                  {m.durationMinutes && <span style={chipStyle}>~{m.durationMinutes} min</span>}
                  {typeEntries.length > 0 && (
                    <span
                      style={{ ...chipStyle, cursor: "default" }}
                      title={typeEntries.map(([l, n]) => `${l}${n > 1 ? ` \u00D7${n}` : ""}`).join("\n")}
                    >
                      {typeEntries.length} task type{typeEntries.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              );
            })()}

            {reportLoading ? (
              <div style={{ marginTop: 12, color: "#6b7280", fontWeight: 800 }}>
                Loading report…
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                {/* ── Vocabulary / Word Bank ── */}
                {Array.isArray(reportData?.concepts) && reportData.concepts.length > 0 && (
                  <div style={{ marginTop: 4, marginBottom: 14 }}>
                    <div style={{ fontWeight: 1000, marginBottom: 8 }}>
                      Word bank ({reportData.concepts.length})
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {reportData.concepts.map((word) => {
                        // Check if this word appears in coverage rows (used in the set)
                        const row = (reportData?.rows || []).find(
                          (r) => r.concept?.toLowerCase() === word?.toLowerCase()
                        );
                        const isUsed = row && (Number(row.objective) > 0 || Number(row.analytical) > 0);
                        const isMissing = reportData?.notCovered?.some(
                          (nc) => nc?.toLowerCase() === word?.toLowerCase()
                        );
                        const tipParts = [];
                        if (row) {
                          if (Number(row.objective)) tipParts.push(`Objective: ${row.objective}`);
                          if (Number(row.analytical)) tipParts.push(`Analytical: ${row.analytical}`);
                        }
                        if (isMissing) tipParts.push("Not covered in any task");
                        const tip = tipParts.length ? tipParts.join(" \u00B7 ") : "Included in word bank";
                        return (
                          <span
                            key={word}
                            title={tip}
                            style={{
                              display: "inline-block",
                              padding: "4px 10px",
                              borderRadius: 999,
                              fontSize: 12,
                              fontWeight: 800,
                              cursor: "default",
                              border: isMissing
                                ? "1px solid rgba(220,38,38,0.3)"
                                : "1px solid rgba(15,23,42,0.12)",
                              background: isMissing
                                ? "rgba(220,38,38,0.06)"
                                : isUsed
                                  ? "rgba(22,163,74,0.08)"
                                  : "rgba(15,23,42,0.04)",
                              color: isMissing ? "#dc2626" : isUsed ? "#15803d" : "#374151",
                            }}
                          >
                            {word}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Bloom's & Cognitive Skills ── */}
                {reportData?.raw && (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: 999,
                        border: "1px solid rgba(15,23,42,0.12)",
                        background: "rgba(15,23,42,0.04)",
                        fontWeight: 900,
                        fontSize: 12,
                      }}
                    >
                      Total tasks:{" "}
                      <span style={{ color: "#111827" }}>
                        {Number(reportData?.raw?.totalTasks ?? reportData?.raw?.taskCount ?? 0)}
                      </span>
                    </span>

                    {reportData?.blooms ? (
                      <span
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(37,99,235,0.25)",
                          background: "rgba(37,99,235,0.08)",
                          fontWeight: 1000,
                          fontSize: 12,
                          color: "#1d4ed8",
                        }}
                      >
                        Bloom's: {reportData.blooms}
                      </span>
                    ) : null}

                    {Array.isArray(reportData?.cognitiveSkills) && reportData.cognitiveSkills.length ? (
                      <span
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(15,23,42,0.12)",
                          background: "rgba(15,23,42,0.04)",
                          fontWeight: 900,
                          fontSize: 12,
                        }}
                      >
                        Cognitive skills: {reportData.cognitiveSkills.join(", ")}
                      </span>
                    ) : null}
                  </div>
                )}

                {/* ── Concept coverage table ── */}
                {Array.isArray(reportData?.rows) && reportData.rows.length > 0 && (
                  <>
                    <div style={{ marginTop: 14, fontWeight: 1000 }}>
                      Concept coverage (actual)
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <table style={table}>
                        <thead>
                          <tr>
                            <th style={th}>Concept</th>
                            <th style={{ ...th, width: 130, textAlign: "right" }}>Objective</th>
                            <th style={{ ...th, width: 130, textAlign: "right" }}>Analytical</th>
                          </tr>
                        </thead>
                        <tbody>
                          {reportData.rows
                            .slice()
                            .sort((a, b) => a.concept.localeCompare(b.concept))
                            .map((r) => (
                              <tr key={r.concept}>
                                <td style={td}>{r.concept}</td>
                                <td style={{ ...td, textAlign: "right" }}>{Number(r.objective) || 0}</td>
                                <td style={{ ...td, textAlign: "right" }}>{Number(r.analytical) || 0}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* ── Not covered ── */}
                {Array.isArray(reportData?.notCovered) && reportData.notCovered.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 1000, color: "#b91c1c" }}>
                      Not covered ({reportData.notCovered.length})
                    </div>
                    <div style={{ marginTop: 6, color: "#111827", fontWeight: 800 }}>
                      {reportData.notCovered.join(", ")}
                    </div>
                    {reportData.notCovered.length >= 10 && (
                      <button
                        type="button"
                        onClick={() => {
                          closeReport();
                          navigate("/teacher/ai-tasksets", {
                            state: { prefillWordList: reportData.notCovered },
                          });
                        }}
                        style={{
                          marginTop: 10,
                          borderRadius: 999,
                          padding: "8px 16px",
                          fontSize: "0.85rem",
                          border: "1px solid #ea580c",
                          background: "#ea580c",
                          color: "#ffffff",
                          cursor: "pointer",
                          fontWeight: 800,
                        }}
                      >
                        Generate Part 2 ({reportData.notCovered.length} unused words)
                      </button>
                    )}
                  </div>
                )}

                {/* ── Fallback when truly nothing is available ── */}
                {!reportData?.raw && !(reportData?.concepts?.length) && !reportError && (
                  <div
                    style={{
                      padding: 12,
                      borderRadius: 14,
                      border: "1px solid #e5e7eb",
                      background: "#f9fafb",
                      color: "#6b7280",
                      fontWeight: 800,
                    }}
                  >
                    No generation report available for this task set. Reports are generated automatically for new task sets.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Task Sets</h1>
          <div style={{ marginTop: 4, color: "#6b7280", fontSize: "0.95rem" }}>
            Your saved task sets.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" onClick={loadSets} style={btn("secondary")}>
            Refresh
          </button>
          <button type="button" onClick={() => navigate("/teacher/ai-tasksets")} style={btn("primary")}>
            Create AI task set
          </button>
        </div>
      </div>

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            borderRadius: 12,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontWeight: 700,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 800 }}>
          Sort priority (drag):
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {sortFields.map((f) => (
            <div
              key={f}
              draggable
              onDragStart={() => onDragStart(f)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDropField(f)}
              title="Drag to reorder"
              style={chip(false)}
            >
              {f === "subject"
                ? "Subject"
                : f === "createdAt"
                  ? "Created"
                  : f === "timesPlayed"
                    ? "Times played"
                    : "Name"}
              <span style={{ opacity: 0.55, fontWeight: 900 }}>⋮⋮</span>
            </div>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        <button type="button" onClick={() => setAllSelected(true)} style={btn("secondary")} disabled={allIds.length === 0}>
          Select all
        </button>
        <button type="button" onClick={() => setAllSelected(false)} style={btn("secondary")} disabled={selectedIds.size === 0}>
          Clear
        </button>
        <button type="button" onClick={deleteSelected} style={btn("danger")} disabled={selectedIds.size === 0}>
          Delete selected ({selectedIds.size})
        </button>
      </div>

      {loading ? (
        <div style={{ marginTop: 16, color: "#6b7280" }}>Loading…</div>
      ) : sortedSets.length === 0 ? (
        <div style={{ marginTop: 16, ...card }}>
          <div style={{ fontWeight: 900, marginBottom: 6 }}>No task sets found.</div>
          <div style={{ color: "#6b7280" }}>Click "Create AI task set" to make one.</div>
        </div>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 12 }}>
          {sortedSets.map((ts) => {
            const id = String(ts?._id || ts?.id || "");
            const isSelected = selectedIds.has(id);
            const title = getTitle(ts);
            const subject = getSubject(ts);
            const grade = getGrade(ts);
            const count = getTasksCount(ts);
            const times = getTimesPlayed(ts);
            const last = fmtDate(getLastPlayed(ts));

            const listReport = extractGenerationReport(ts);
            const blooms = listReport ? extractBloomsLabel(listReport) : "";

            // Build tooltip listing task types with counts
            const taskTypeCounts = {};
            (ts?.tasks || []).forEach((t) => {
              const raw = t?.taskType || t?.type || "unknown";
              // "multiple-choice" → "Multiple Choice"
              const label = raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              taskTypeCounts[label] = (taskTypeCounts[label] || 0) + 1;
            });
            const taskTypeTooltip = Object.entries(taskTypeCounts)
              .map(([label, n]) => `${label}${n > 1 ? ` ×${n}` : ""}`)
              .join("\n");

            const dur = Number(ts?.durationMinutes);
            const durLabel = Number.isFinite(dur) && dur > 0 ? `~${dur} min` : "";

            // Difficulty flag
            const rawDiff = (ts?.difficulty || "").toUpperCase();
            const diffFlag = rawDiff === "EASY" ? "\u{1F7E2}"     // green circle
              : rawDiff === "MEDIUM" ? "\u{1F7E1}"                 // yellow circle
              : rawDiff === "HARD" ? "\u{1F534}"                   // red circle
              : "";
            const diffTip = rawDiff === "EASY" ? "Difficulty: Easy"
              : rawDiff === "MEDIUM" ? "Difficulty: Medium"
              : rawDiff === "HARD" ? "Difficulty: Hard"
              : "";

            // Learning goal
            const rawGoal = (ts?.learningGoal || "").trim();
            const goalLabel = rawGoal
              ? rawGoal.charAt(0).toUpperCase() + rawGoal.slice(1).toLowerCase()
              : "";

            const secondLineParts = [
              subject && subject.toLowerCase() !== title.toLowerCase() && subject,
              grade && `Grade ${grade}`,
              `${count} task${count === 1 ? "" : "s"}`,
              durLabel,
              goalLabel,
              blooms ? `Bloom's ${blooms}` : "",
              `Plays ${times}`,
              last ? `Last played ${last}` : "Never played",
            ].filter(Boolean);

            return (
              <div key={id} title={taskTypeTooltip} style={{ ...card, display: "flex", gap: 12 }}>
                <div style={{ paddingTop: 2 }}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelected(id)}
                    aria-label="Select taskset"
                    style={{ width: 18, height: 18, cursor: "pointer" }}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div
                      style={{
                        fontWeight: 900,
                        fontSize: "1.02rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {diffFlag && (
                        <span title={diffTip} style={{ cursor: "default", marginRight: 6 }}>
                          {diffFlag}
                        </span>
                      )}
                      {title}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button type="button" onClick={() => openReport(ts)} style={btn("secondary")}>
                        Report
                      </button>
                      <button type="button" onClick={() => copyShareLink(ts)} style={btn("secondary")}>
                        Share
                      </button>
                      <button type="button" onClick={() => launchNow(ts)} style={btn("primary")}>
                        Launch
                      </button>
                    </div>
                  </div>

                  <div style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
                    {secondLineParts.join(" \u00B7 ")}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => navigate(`/tasksets/${encodeURIComponent(id)}`)} style={btn("secondary")}>
                      Edit
                    </button>
                    <button type="button" onClick={() => deleteOne(id)} style={btn("danger")}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Share Modal with Send Invite */}
      {shareModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 9999,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24,
            maxWidth: 500, width: "90%", boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 12 }}>Share Task Set</h2>
            <p style={{ color: "#6b7280", marginBottom: 16 }}>
              Share this link with a substitute teacher. It expires in 7 days.
            </p>
            <div style={{
              background: "#f3f4f6", padding: 12, borderRadius: 8,
              marginBottom: 12, fontFamily: "monospace",
              wordBreak: "break-all", fontSize: "0.9rem",
            }}>
              {shareLink}
            </div>
            <div style={{ fontSize: "0.85rem", color: "#6b7280", marginBottom: 16 }}>
              Expires: {shareExpiresAt ? new Date(shareExpiresAt).toLocaleDateString() : ""}
            </div>

            {/* Send Invite */}
            <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 16, marginBottom: 16 }}>
              <label style={{ fontWeight: 600, fontSize: "0.9rem", display: "block", marginBottom: 6 }}>
                Send Invite by Email
              </label>
              <input
                type="email"
                placeholder="substitute@school.edu"
                value={inviteEmail}
                onChange={(e) => { setInviteEmail(e.target.value); setInviteSent(false); }}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #d1d5db", marginBottom: 8,
                  boxSizing: "border-box", fontSize: "0.9rem",
                }}
              />
              <textarea
                placeholder="Add a personal message (optional)"
                value={inviteMessage}
                onChange={(e) => setInviteMessage(e.target.value)}
                rows={2}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: 8,
                  border: "1px solid #d1d5db", marginBottom: 8,
                  boxSizing: "border-box", fontSize: "0.9rem", resize: "vertical",
                }}
              />
              <button
                onClick={handleSendInvite}
                disabled={inviteSending || !inviteEmail.trim()}
                style={{ width: "100%", background: inviteSent ? "#10b981" : undefined }}
              >
                {inviteSending ? "Sending…" : inviteSent ? "Sent!" : "Send Invite"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setShareModalOpen(false); setInviteEmail(""); setInviteMessage(""); setInviteSent(false); }}
                style={{ background: "#e5e7eb", color: "#000" }}
              >
                Close
              </button>
              <button onClick={handleCopyShareLink}>
                Copy Link
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
