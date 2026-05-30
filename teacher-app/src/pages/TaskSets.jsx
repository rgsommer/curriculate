// teacher-app/src/pages/TaskSets.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, apiFetchJson } from "../api/apiFetch";
import { fetchMyProfile } from "../api/profile";
import { API_BASE_URL, STUDENT_APP_URL } from "../config";
import { TASK_TYPE_META } from "../../../shared/taskTypes.js";
import { Modal, Button, Field, TextInput, TextArea, Select, Checkbox, ToggleGroup, PageHeader, PageShell } from "../components/ui";

const _API_BASE = API_BASE_URL || "";

// Category → color mapping for task type badges
const CATEGORY_COLORS = {
  "question":      { bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
  "ordering":      { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d" },
  "creative":      { bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" },
  "movement":      { bg: "#fce7f3", fg: "#9d174d", border: "#f9a8d4" },
  "competitive":   { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
  "deduction":     { bg: "#e0e7ff", fg: "#3730a3", border: "#a5b4fc" },
  "collaboration": { bg: "#d1fae5", fg: "#065f46", border: "#6ee7b7" },
  "feedback/meta": { bg: "#f3f4f6", fg: "#374151", border: "#d1d5db" },
  "synthesis":     { bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
  "other":         { bg: "#f5f5f4", fg: "#57534e", border: "#d6d3d1" },
  "recall":        { bg: "#ccfbf1", fg: "#0f766e", border: "#5eead4" },
  "role-play":     { bg: "#fbcfe8", fg: "#86198f", border: "#f0abfc" },
};

// Subject → card background tint for the task set card
const SUBJECT_COLORS_MAP = {
  "math":        { bg: "#eff6ff", border: "#bfdbfe" },
  "mathematics": { bg: "#eff6ff", border: "#bfdbfe" },
  "science":     { bg: "#ecfdf5", border: "#a7f3d0" },
  "english":     { bg: "#fefce8", border: "#fde68a" },
  "language":    { bg: "#fefce8", border: "#fde68a" },
  "language arts": { bg: "#fefce8", border: "#fde68a" },
  "ela":         { bg: "#fefce8", border: "#fde68a" },
  "french":      { bg: "#fdf4ff", border: "#f0abfc" },
  "spanish":     { bg: "#fff7ed", border: "#fdba74" },
  "history":     { bg: "#fef2f2", border: "#fecaca" },
  "social studies": { bg: "#fef2f2", border: "#fecaca" },
  "geography":   { bg: "#f0fdf4", border: "#86efac" },
  "bible":       { bg: "#f5f3ff", border: "#c4b5fd" },
  "religion":    { bg: "#f5f3ff", border: "#c4b5fd" },
  "music":       { bg: "#fdf2f8", border: "#f9a8d4" },
  "art":         { bg: "#faf5ff", border: "#d8b4fe" },
  "pe":          { bg: "#fff1f2", border: "#fda4af" },
  "health":      { bg: "#f0fdfa", border: "#99f6e4" },
  "technology":  { bg: "#f0f9ff", border: "#7dd3fc" },
  "computer science": { bg: "#f0f9ff", border: "#7dd3fc" },
};

// Stable hash-based fallback palette for subjects not in the map
const SUBJECT_FALLBACK_PALETTE = [
  { bg: "#fef3c7", border: "#fcd34d" },
  { bg: "#dbeafe", border: "#93c5fd" },
  { bg: "#ede9fe", border: "#c4b5fd" },
  { bg: "#d1fae5", border: "#6ee7b7" },
  { bg: "#fce7f3", border: "#f9a8d4" },
  { bg: "#e0e7ff", border: "#a5b4fc" },
  { bg: "#ccfbf1", border: "#5eead4" },
  { bg: "#fee2e2", border: "#fca5a5" },
];

function getSubjectColor(subject) {
  const key = (subject || "").trim().toLowerCase();
  if (!key) return null;
  if (SUBJECT_COLORS_MAP[key]) return SUBJECT_COLORS_MAP[key];
  // Stable hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return SUBJECT_FALLBACK_PALETTE[Math.abs(hash) % SUBJECT_FALLBACK_PALETTE.length];
}

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

// Verification status from the auto playability test (set at generation and on
// "Fix"). "verified" = tested with zero outstanding issues → safe to run with a
// class. "issues" = tested but some tasks still need attention. null = never
// tested (older set generated before the playability test existed).
function getVerification(ts) {
  const pa = ts?.meta?.playability;
  if (!pa || !pa.checkedAt) return null;
  const issues = Array.isArray(pa.issues) ? pa.issues : [];
  return issues.length === 0
    ? { state: "verified", count: 0 }
    : { state: "issues", count: issues.length };
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
  const [expandedIds, setExpandedIds] = useState(() => new Set());
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
  const showToast = useCallback((msg, ms = 2500) => {
    setToast(msg);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(""), ms);
  }, []);
  const [regeneratingId, setRegeneratingId] = useState(null);
  // Live progress for the Regenerate button so the teacher can see it's alive.
  // { done, total, phase } — updated from the generation SSE stream.
  const [regenProgress, setRegenProgress] = useState(null);

  // Regenerate confirm modal — shows the reconstructed constraints (editable)
  // plus a "new copy" vs "replace original" choice before generating.
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenPreparing, setRegenPreparing] = useState(false);
  const [regenSource, setRegenSource] = useState(null); // full taskset
  const [regenMode, setRegenMode] = useState("new"); // "new" | "replace"
  const [regenForm, setRegenForm] = useState(null); // editable constraint fields

  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportTasksetMeta, setReportTasksetMeta] = useState(null);
  const [reportData, setReportData] = useState(null);
  const reportCacheRef = useRef(new Map());

  // Plan tier — gates class linking (PLUS+).
  const [planTier, setPlanTier] = useState("FREE");
  const isAtLeastPlus = planTier === "PLUS" || planTier === "PRO";

  // Share modal state
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareLink, setShareLink] = useState("");
  const [shareExpiresAt, setShareExpiresAt] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);

  // Mode B (sub): class-binding the share link.
  // Sending teacher picks a class; the binding rides on the link so the
  // sub teacher's session is class-bound automatically.
  const [shareClassRosters, setShareClassRosters] = useState([]); // [{id, className, studentCount}]
  const [shareClassRosterId, setShareClassRosterId] = useState("");
  const [shareTaskset, setShareTaskset] = useState(null); // remember which taskset to regenerate against
  const [shareRegenerating, setShareRegenerating] = useState(false);

  const loadSets = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await apiFetchJson("/api/tasksets-with-timing");
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
    // Fetch plan tier for UI gating (class-linking requires PLUS).
    (async () => {
      try {
        const profile = await fetchMyProfile();
        if (profile?.planTier) setPlanTier(String(profile.planTier).toUpperCase());
      } catch {}
    })();
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

  const toggleExpanded = (id) => {
    const sid = String(id || "");
    if (!sid) return;
    setExpandedIds((prev) => {
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

  // Diagnose + fix taskset dialog
  const [fixDialogId, setFixDialogId] = useState(null);
  const [fixNote, setFixNote] = useState("");
  const [fixRunning, setFixRunning] = useState(false);
  const [fixResult, setFixResult] = useState(null);
  const [fixPhase, setFixPhase] = useState("");

  const openFixDialog = (id) => {
    setFixDialogId(String(id));
    setFixNote("");
    setFixResult(null);
  };

  const closeFixDialog = () => {
    setFixDialogId(null);
    setFixNote("");
    setFixResult(null);
    setFixRunning(false);
    setFixPhase("");
  };

  const runFix = async () => {
    if (!fixDialogId || fixRunning) return;
    setFixRunning(true);
    setFixResult(null);
    setFixPhase("Validating tasks…");
    try {
      // Stream via SSE so the long AI-repair pass keeps the connection alive
      // (a silent POST gets killed by idle-timeout proxies → "Failed to fetch").
      const res = await apiFetch(`/api/tasksets/${encodeURIComponent(fixDialogId)}/sanitize`, {
        method: "POST",
        body: JSON.stringify({ note: fixNote }),
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try { const j = await res.json(); msg = j?.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      // Backward-compat: a backend that doesn't stream returns plain JSON.
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("text/event-stream")) {
        const data = await res.json();
        if (data?.ok === false) throw new Error(data?.error || "Fix failed");
        setFixResult(data);
        await loadSets();
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalData = null;
      let streamErr = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const msg = JSON.parse(dataLine.slice(5).trim());
            if (msg.type === "complete") finalData = msg;
            else if (msg.type === "error") streamErr = msg.error || "Fix failed";
            else if (msg.type === "phase") setFixPhase(msg.message || "");
          } catch { /* partial / heartbeat line */ }
        }
      }
      if (streamErr) throw new Error(streamErr);
      if (!finalData) throw new Error("No result was returned");
      setFixResult(finalData);
      await loadSets();
    } catch (e) {
      setFixResult({ ok: false, failed: true, message: e?.message || "Fix failed" });
    } finally {
      setFixRunning(false);
      setFixPhase("");
    }
  };

  // Copy diagnostic report to clipboard for passing to developer
  const copyDiagnosticReport = () => {
    if (!fixResult) return;
    const tsName = sets.find((s) => String(s._id || s.id) === fixDialogId)?.name || fixDialogId;
    const lines = [
      `DIAGNOSTIC REPORT — ${tsName}`,
      `Date: ${new Date().toISOString()}`,
      fixNote ? `Teacher note: ${fixNote}` : "",
      `Tasks: ${fixResult.taskCount || 0} total, ${fixResult.issuesFound || 0} issues, ${fixResult.issuesFixed || 0} auto-fixed`,
      fixResult.logId ? `Log ID: ${fixResult.logId}` : "",
      "",
      ...(fixResult.diagnostics || []).flatMap((d) => [
        `--- Task ${d.taskIndex} | ${d.taskType} | "${d.title}" | ${d.fixed ? "AUTO-FIXED" : "NEEDS MANUAL FIX"} ---`,
        `Errors: ${(d.errors || []).map((e) => `\n  - ${e}`).join("")}`,
        d.postFixErrors?.length ? `Still broken after fix: ${d.postFixErrors.map((e) => `\n  - ${e}`).join("")}` : "",
        d.rawTask ? `Raw task JSON:\n${JSON.stringify(d.rawTask, null, 2)}` : "",
        "",
      ]),
    ].filter(Boolean).join("\n");
    navigator.clipboard.writeText(lines).then(() => alert("Copied to clipboard!")).catch(() => {});
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

  // "Test run" — open the student app's preview route and step through the
  // taskset's tasks exactly as a student would, with no QR scans / live session.
  const testRun = (taskset) => {
    const id = taskset?._id || taskset?.id;
    if (!id) return;
    const url = `${STUDENT_APP_URL}/preview?id=${encodeURIComponent(id)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  // Open the Regenerate confirm modal. Reconstructs the original taskset's
  // constraints (subject, grade, difficulty, topic, task-type mix, count,
  // quest/duel flags, vocabulary) into an EDITABLE form so the teacher can
  // tweak them and choose "new copy" vs "replace original" before generating.
  const openRegenerateModal = async (taskset) => {
    const id = taskset?._id || taskset?.id;
    if (!id || regeneratingId) return;
    setRegenOpen(true);
    setRegenMode("new");
    setRegenForm(null);
    setRegenSource(null);
    setRegenPreparing(true);
    try {
      // List rows may be trimmed — pull the full taskset (tasks + meta).
      let full = taskset;
      if (!Array.isArray(full.tasks) || full.tasks.length === 0 || !full.meta) {
        const data = await apiFetchJson(`/api/tasksets/${encodeURIComponent(id)}`);
        full = unwrapTasksetResponse(data) || taskset;
      }
      const tasks = Array.isArray(full.tasks) ? full.tasks : [];
      const types = [...new Set(tasks.map((t) => t?.taskType).filter(Boolean))];
      const concepts =
        full?.meta?.conceptAllocation?.requestedConcepts ||
        full?.meta?.coverage?.requested ||
        [];
      setRegenSource(full);
      setRegenForm({
        subject: full?.subject || getSubject(full) || "General",
        gradeLevel: String(full?.gradeLevel || getGrade(full) || 7),
        difficulty: (full?.difficulty || "MEDIUM").toUpperCase(),
        learningGoal: full?.learningGoal || "",
        topicLabel: full?.topicLabel || getTitle(full) || "",
        types,
        reselectTypes: false,
        numberOfTasks: tasks.length || types.length || 1,
        questMode: !!full?.questModeEnabled,
        duelsEnabled: !!full?.duelsEnabled,
        atDeskOnly: !!full?.atDeskOnly,
        aiWordBank: Array.isArray(concepts) ? concepts.join(", ") : "",
      });
    } catch (e) {
      console.error("[TaskSets] prepare regenerate failed:", e);
      showToast(`Couldn't load constraints: ${e?.message || "error"}`, 4000);
      setRegenOpen(false);
    } finally {
      setRegenPreparing(false);
    }
  };

  const closeRegenModal = () => {
    if (regeneratingId) return; // don't close mid-generation
    setRegenOpen(false);
    setRegenForm(null);
    setRegenSource(null);
  };

  // Run the generation using the (possibly edited) form. On "replace original"
  // we generate a fresh taskset, copy its tasks/meta onto the original id, and
  // delete the throwaway copy so there's no duplicate.
  const runRegenerate = async () => {
    if (!regenForm || !regenSource || regeneratingId) return;
    const src = regenSource;
    const form = regenForm;
    const id = src?._id || src?.id;
    if (!id) return;

    const replace = regenMode === "replace";
    // Re-select: let the AI choose a fresh set of task types instead of reusing
    // the original mix. We still pass the count so the set stays the same size.
    const reselect = !!form.reselectTypes;
    setRegeneratingId(id);
    setRegenProgress(null);
    // Close the modal immediately — generation runs in the background and the
    // toast reports progress / completion.
    setRegenOpen(false);
    showToast(
      replace
        ? "♻️ Regenerating in place… (~30s)"
        : "♻️ Regenerating as a new copy… (~30s)",
      60000
    );
    try {
      const types = reselect ? [] : (form.types || []);
      const n = Math.max(1, Number(form.numberOfTasks) || (form.types || []).length || 1);
      const payload = {
        tasksetName: replace ? getTitle(src) : `${getTitle(src)} (regenerated)`,
        subject: form.subject || "General",
        gradeLevel: form.gradeLevel || 7,
        difficulty: (form.difficulty || "MEDIUM").toUpperCase(),
        learningGoal: form.learningGoal || "",
        topicLabel: form.topicLabel || getTitle(src) || "",
        requiredTaskTypes: types,
        guaranteedTaskTypes: types,
        numberOfTasks: n,
        questMode: !!form.questMode,
        duelsEnabled: !!form.duelsEnabled,
        atDeskOnly: !!form.atDeskOnly,
        aiWordBank: (form.aiWordBank || "").trim(),
      };
      // Stream via SSE (same as the generator) so the ~30s generation keeps the
      // connection alive — a silent POST gets killed by idle-timeout proxies.
      const res = await apiFetch("/api/ai/tasksets", {
        method: "POST",
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      });
      if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try { const j = await res.json(); msg = j?.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finalData = null;
      let streamErr = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const dataLine = part.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            const msg = JSON.parse(dataLine.slice(5).trim());
            if (msg.type === "start") {
              setRegenProgress({ done: 0, total: Number(msg.total) || 0, phase: "generating" });
            } else if (msg.type === "progress") {
              setRegenProgress({ done: Number(msg.done) || 0, total: Number(msg.total) || 0, phase: "generating" });
            } else if (msg.type === "phase") {
              setRegenProgress((p) => ({ ...(p || { done: 0, total: 0 }), phase: msg.phase || "" }));
            } else if (msg.type === "complete" && (msg.taskset || msg.ok)) finalData = msg;
            else if (msg.type === "error") streamErr = msg.error || "Generation error";
            else if (msg.taskset && !finalData) finalData = msg; // tolerate non-streaming JSON
          } catch { /* partial / non-JSON line */ }
        }
      }
      if (streamErr) throw new Error(streamErr);
      if (!finalData) throw new Error("No taskset was returned");

      if (replace) {
        // Copy the freshly generated content onto the original taskset, then
        // delete the throwaway copy so the list isn't duplicated.
        const fresh = finalData.taskset || {};
        const newId = fresh?._id || fresh?.id;
        const patch = {
          tasks: Array.isArray(fresh.tasks) ? fresh.tasks : [],
        };
        if (fresh.meta) patch.meta = fresh.meta;
        if (typeof fresh.durationMinutes === "number") patch.durationMinutes = fresh.durationMinutes;
        await apiFetchJson(`/api/tasksets/${encodeURIComponent(id)}`, {
          method: "PUT",
          body: patch,
        });
        if (newId && String(newId) !== String(id)) {
          try {
            await apiFetchJson(`/api/tasksets/${encodeURIComponent(newId)}`, { method: "DELETE" });
          } catch { /* best-effort cleanup */ }
        }
        showToast("✅ Regenerated in place.");
      } else {
        showToast("✅ Regenerated as a new taskset.");
      }
      setRegenForm(null);
      setRegenSource(null);
      await loadSets();
    } catch (e) {
      console.error("[TaskSets] regenerate failed:", e);
      showToast(`Regenerate failed: ${e?.message || "error"}`, 4000);
    } finally {
      setRegeneratingId(null);
      setRegenProgress(null);
    }
  };

  // Helper: hit /api/shared/create-link with optional class binding
  const createShareLink = useCallback(async (tasksetId, classRosterId) => {
    const data = await apiFetchJson("/api/shared/create-link", {
      method: "POST",
      body: {
        tasksetId,
        ...(classRosterId ? { classRosterId } : {}),
      },
    });
    if (!data?.ok || !data?.link) {
      throw new Error(data?.error || "Share failed");
    }
    return data;
  }, []);

  const copyShareLink = async (taskset) => {
    const id = taskset?._id || taskset?.id;
    if (!id) return;
    try {
      // Open the modal and start fetching rosters in parallel.
      setShareTaskset(taskset);
      setShareClassRosterId("");
      setShareClassRosters([]);

      // Kick off roster fetch (non-blocking — link generates without binding by default).
      (async () => {
        try {
          const profile = await fetchMyProfile();
          const teacherEmail = String(profile?.email || "").trim();
          if (!teacherEmail) return;
          const res = await fetch(
            `${_API_BASE}/class-roster/list?teacherEmail=${encodeURIComponent(teacherEmail)}`
          );
          if (!res.ok) return;
          const j = await res.json();
          setShareClassRosters(Array.isArray(j?.rosters) ? j.rosters : []);
        } catch (e) {
          console.warn("[TaskSets] roster fetch failed:", e?.message || e);
        }
      })();

      const data = await createShareLink(id);
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

  // Regenerate the share link with a different class binding (or none).
  const regenerateShareLinkWithClass = async (newClassRosterId) => {
    if (!shareTaskset) return;
    const id = shareTaskset?._id || shareTaskset?.id;
    if (!id) return;
    setShareRegenerating(true);
    try {
      const data = await createShareLink(id, newClassRosterId || undefined);
      setShareLink(String(data.link));
      setShareExpiresAt(data.expiresAt || "");
      setInviteSent(false); // any prior invite was for the old token
    } catch (e) {
      setError(e?.message || "Could not regenerate share link.");
    } finally {
      setShareRegenerating(false);
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

  // `page` style removed — wrapper migrated to <PageShell> (Wave 3).

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

  // modalOverlay, modalCard, regenFieldStyle, regenInputStyle removed —
  // their use sites migrated to <Modal> + <Field>/<TextInput>/<TextArea>
  // in Wave 2. regenLabelStyle kept for the two remaining sites that use it
  // (task-type mix heading + Output section heading).
  const regenLabelStyle = { fontSize: 12, fontWeight: 900, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.02em" };

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
    <PageShell>
      <style>{`@keyframes regenShimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
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

      {/* Generation Report Modal — migrated to shared <Modal> + <Button>
          (Wave 2 step 3). Title moves to Modal's title prop; the taskset
          name is the subtitle. "Close" is replaced by the built-in × ;
          "Open set" stays as an inline action above the content. */}
      <Modal
        open={reportOpen}
        onClose={closeReport}
        title="Generation Report"
        size="lg"
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: 12,
            alignItems: "flex-start",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              minWidth: 0,
              color: "#6b7280",
              fontWeight: 700,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={reportTasksetMeta?.title || ""}
          >
            {reportTasksetMeta?.title || "Task Set"}
          </div>
          {reportTasksetMeta?.id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate(`/tasksets/${encodeURIComponent(reportTasksetMeta.id)}`)
              }
            >
              Open set
            </Button>
          )}
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
      </Modal>

      <PageHeader
        title="Task Sets"
        subtitle="Your saved task sets."
        actions={
          <>
            <Button variant="ghost" onClick={loadSets}>Refresh</Button>
            <Button onClick={() => navigate("/teacher/ai-tasksets")}>Create AI task set</Button>
          </>
        }
      />

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

        <Button variant="ghost" size="sm" onClick={() => setAllSelected(true)} disabled={allIds.length === 0}>
          Select all
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAllSelected(false)} disabled={selectedIds.size === 0}>
          Clear
        </Button>
        <Button variant="danger" size="sm" onClick={deleteSelected} disabled={selectedIds.size === 0}>
          Delete selected ({selectedIds.size})
        </Button>
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
            const isExpanded = expandedIds.has(id);

            const listReport = extractGenerationReport(ts);
            const blooms = listReport ? extractBloomsLabel(listReport) : "";

            // Build colored badge data from raw task types
            const taskTypeBadges = [];
            const badgeCounts = {};
            (ts?.tasks || []).forEach((t) => {
              const raw = t?.taskType || t?.type || "unknown";
              badgeCounts[raw] = (badgeCounts[raw] || 0) + 1;
            });
            Object.entries(badgeCounts).forEach(([raw, n]) => {
              const meta = TASK_TYPE_META[raw];
              const label = meta?.label || raw.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
              const cat = meta?.category || "other";
              const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS["other"];
              taskTypeBadges.push({ label, n, colors });
            });

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

            // Avg actual completion time (from real student data)
            const avgComp = ts?.avgCompletionMinutes;
            const avgCompLabel = typeof avgComp === "number" && avgComp > 0
              ? `Avg ${avgComp} min`
              : "";

            // Created-on date
            const createdDate = ts?.createdAt ? new Date(ts.createdAt) : null;
            const createdLabel = createdDate && !isNaN(createdDate.getTime())
              ? `Created ${createdDate.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
              : "";

            const secondLineParts = [
              subject && subject.toLowerCase() !== title.toLowerCase() && subject,
              grade && `Grade ${grade}`,
              `${count} task${count === 1 ? "" : "s"}`,
              durLabel,
              avgCompLabel,
              goalLabel,
              blooms ? `Bloom's ${blooms}` : "",
              createdLabel,
              `Plays ${times}`,
              last ? `Last played ${last}` : "Never played",
            ].filter(Boolean);

            const subjectColor = getSubjectColor(subject);

            return (
              <div key={id} style={{
                ...card,
                display: "flex",
                gap: 12,
                ...(subjectColor ? { background: subjectColor.bg, borderColor: subjectColor.border } : {}),
              }}>
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
                  {/* Clickable header row — always visible */}
                  <div
                    onClick={() => toggleExpanded(id)}
                    style={{ cursor: "pointer" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div
                        title={title}
                        style={{
                          fontWeight: 900,
                          fontSize: "1.02rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {(diffFlag || ts?.atDeskOnly) && (
                          <span
                            style={{
                              display: "inline-flex",
                              flexDirection: "column",
                              alignItems: "center",
                              verticalAlign: "middle",
                              lineHeight: 1.05,
                              marginRight: 6,
                            }}
                          >
                            {diffFlag && (
                              <span title={diffTip} style={{ cursor: "default" }}>
                                {diffFlag}
                              </span>
                            )}
                            {ts?.atDeskOnly && (
                              <span
                                title={"At-desk only: students stay seated; no QR-code scans"}
                                style={{ cursor: "default", fontSize: "0.8rem" }}
                              >
                                {"\uD83E\uDE91"}
                              </span>
                            )}
                          </span>
                        )}
                        <span style={{ marginRight: 6, fontSize: "0.8rem", color: "#6b7280" }}>
                          {isExpanded ? "\u25BC" : "\u25B6"}
                        </span>
                        {title}
                      </div>

                      {/* Verification badge from the auto playability test */}
                      {(() => {
                        // While THIS set is regenerating, the old "Verified" is
                        // stale (it's being rebuilt) — show a neutral
                        // "Re-checking…" until the fresh playability test runs.
                        if (regeneratingId === id) {
                          return (
                            <span
                              title="Regenerating — will re-run the playability test"
                              style={{
                                flexShrink: 0, alignSelf: "center",
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "2px 9px", borderRadius: 999,
                                fontSize: "0.7rem", fontWeight: 800,
                                background: "#eef2ff", color: "#3730a3", border: "1px solid #a5b4fc",
                              }}
                            >
                              ⏳ Re-checking…
                            </span>
                          );
                        }
                        const v = getVerification(ts);
                        if (!v) return null;
                        if (v.state === "verified") {
                          return (
                            <span
                              title={"Sanitized & playability-tested \u2014 safe to run with a class"}
                              style={{
                                flexShrink: 0, alignSelf: "center",
                                display: "inline-flex", alignItems: "center", gap: 4,
                                padding: "2px 9px", borderRadius: 999,
                                fontSize: "0.7rem", fontWeight: 800,
                                background: "#dcfce7", color: "#166534", border: "1px solid #86efac",
                              }}
                            >
                              ✓ Verified
                            </span>
                          );
                        }
                        return (
                          <span
                            title={`${v.count} task${v.count === 1 ? "" : "s"} still need attention \u2014 run \uD83D\uDD27 Fix or \u267B\uFE0F Regenerate`}
                            style={{
                              flexShrink: 0, alignSelf: "center",
                              display: "inline-flex", alignItems: "center", gap: 4,
                              padding: "2px 9px", borderRadius: 999,
                              fontSize: "0.7rem", fontWeight: 800,
                              background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d",
                            }}
                          >
                            ⚠️ {v.count}
                          </span>
                        );
                      })()}
                    </div>

                    {/* Quick-action buttons — single line: Test run · Regenerate · Launch. */}
                    {/* flexWrap:nowrap + slightly smaller text keeps all three on one row even on narrow cards. */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: "flex", gap: 6, flexWrap: "nowrap", marginTop: 8,
                        alignItems: "center",
                      }}
                    >
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testRun(ts)}
                        title="Step through the tasks as a student would — no QR scans"
                      >
                        🧪 Test run
                      </Button>
                      {(() => {
                        const isRegen = regeneratingId === id;
                        const rp = isRegen ? regenProgress : null;
                        const pct = rp && rp.total ? Math.min(100, Math.round((rp.done / rp.total) * 100)) : null;
                        const style = { ...btn("secondary"), padding: "5px 10px", fontSize: "0.78rem", whiteSpace: "nowrap" };
                        if (isRegen) {
                          style.cursor = "wait";
                          style.borderColor = "#a5b4fc";
                          style.color = "#3730a3";
                          if (pct != null && pct < 100) {
                            // Determinate fill showing real task progress.
                            style.backgroundImage = `linear-gradient(90deg, #c7d2fe 0%, #c7d2fe ${pct}%, #eef2ff ${pct}%, #eef2ff 100%)`;
                          } else {
                            // Indeterminate shimmer (start / post-generation phases) — proves it's alive.
                            style.backgroundImage = "linear-gradient(90deg, #eef2ff 25%, #c7d2fe 50%, #eef2ff 75%)";
                            style.backgroundSize = "200% 100%";
                            style.animation = "regenShimmer 1.1s linear infinite";
                          }
                        }
                        const label = !isRegen
                          ? "♻️ Regenerate"
                          : pct != null
                            ? `♻️ ${rp.done}/${rp.total}`
                            : "♻️ Regenerating…";
                        return (
                          <button
                            type="button"
                            onClick={() => openRegenerateModal(ts)}
                            disabled={isRegen}
                            style={style}
                            title="Regenerate this taskset with the same constraints — review and tweak before generating"
                          >
                            {label}
                          </button>
                        );
                      })()}
                      <Button
                        size="sm"
                        onClick={() => launchNow(ts)}
                      >
                        Launch
                      </Button>
                    </div>

                    <div style={{ marginTop: 6, color: "#6b7280", fontSize: "0.9rem" }}>
                      {secondLineParts.join(" \u00B7 ")}
                    </div>
                  </div>

                  {/* Expandable detail section */}
                  {isExpanded && (
                    <>
                      {taskTypeBadges.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
                          {taskTypeBadges.map(({ label, n, colors }, i) => (
                            <span
                              key={i}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 3,
                                padding: "2px 8px",
                                borderRadius: 12,
                                fontSize: "0.72rem",
                                fontWeight: 700,
                                background: colors.bg,
                                color: colors.fg,
                                border: `1px solid ${colors.border}`,
                                lineHeight: 1.5,
                              }}
                            >
                              {label}{n > 1 ? ` ×${n}` : ""}
                            </span>
                          ))}
                        </div>
                      )}

                      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <Button variant="ghost" size="sm" onClick={() => openReport(ts)}>Report</Button>
                        <Button variant="ghost" size="sm" onClick={() => copyShareLink(ts)}>Share</Button>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`/tasksets/${encodeURIComponent(id)}`)}>Edit</Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openFixDialog(id)}
                          title="Diagnose and fix AI-generated task issues"
                        >
                          🔧 Fix
                        </Button>
                        <Button variant="danger" size="sm" onClick={() => deleteOne(id)}>Delete</Button>
                      </div>
                    </>
                  )}
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

            {/* Mode B (sub): Class binding — picks the class the sub will run for.
                When set, the sub's session inherits the class so students get a
                name dropdown and the report CSV gets Edsby Student IDs filled in.
                Gated to PLUS+ tier. */}
            {isAtLeastPlus && shareClassRosters.length > 0 && (
              <div
                style={{
                  marginBottom: 12,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: shareClassRosterId ? "#ecfdf5" : "#f9fafb",
                  border: shareClassRosterId ? "1px solid #86efac" : "1px solid #e5e7eb",
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: "0.9rem",
                    color: shareClassRosterId ? "#065f46" : "#374151",
                  }}
                >
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>📋 Bind to class:</span>
                  <select
                    value={shareClassRosterId}
                    disabled={shareRegenerating}
                    onChange={(e) => {
                      const v = e.target.value;
                      setShareClassRosterId(v);
                      regenerateShareLinkWithClass(v);
                    }}
                    style={{
                      flex: 1,
                      padding: "6px 8px",
                      borderRadius: 6,
                      border: "1px solid #d1d5db",
                      fontSize: "0.9rem",
                      background: "#fff",
                    }}
                  >
                    <option value="">(none — sub picks no class)</option>
                    {shareClassRosters.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.className || "Unnamed class"} ({r.studentCount || 0} students)
                      </option>
                    ))}
                  </select>
                </label>
                <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#475569" }}>
                  {shareClassRosterId
                    ? "Students will pick their name from your class roster on join. Edsby-ready CSV will be in the report."
                    : "Optional — sub can run without a class. You can still match grades after the fact in your Profile."}
                </div>
                {shareRegenerating && (
                  <div style={{ marginTop: 6, fontSize: "0.78rem", color: "#1e3a8a" }}>
                    Regenerating link…
                  </div>
                )}
              </div>
            )}

            <div style={{
              background: "#f3f4f6", padding: 12, borderRadius: 8,
              marginBottom: 12, fontFamily: "monospace",
              wordBreak: "break-all", fontSize: "0.9rem",
              opacity: shareRegenerating ? 0.55 : 1,
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

      {/* Regenerate Confirm Modal — migrated to shared <Modal> + <Field>/
          <TextInput>/<TextArea>/<Select> + <Button> primitives (Wave 2).
          The Close × is built into <Modal>; Cancel + Generate use
          <Modal.Footer> + <Button>. The task-type-mix section and the
          New-copy/Replace-original toggle stay custom (semantic pill UI). */}
      <Modal
        open={regenOpen}
        onClose={closeRegenModal}
        title="♻️ Regenerate task set"
        size="md"
        closeOnBackdrop={!regeneratingId}
        closeOnEsc={!regeneratingId}
      >
        <div style={{ color: "#6b7280", fontWeight: 700, fontSize: "0.9rem", marginBottom: 4 }}>
          {regenSource ? getTitle(regenSource) : ""}
        </div>
        <p style={{ marginTop: 6, color: "#6b7280", fontSize: 13, lineHeight: 1.5 }}>
          Generates <strong>fresh AI content</strong> (new questions &amp; prompts) using these constraints.
          Tweak anything below before generating.
        </p>

        {regenPreparing || !regenForm ? (
          <div style={{ marginTop: 12, color: "#6b7280", fontWeight: 800 }}>Loading constraints…</div>
        ) : (
          <>
            <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
              {/* Subject + Grade */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Field label="Subject" style={{ flex: 1, minWidth: 160 }}>
                  <TextInput
                    value={regenForm.subject}
                    onChange={(e) => setRegenForm((f) => ({ ...f, subject: e.target.value }))}
                  />
                </Field>
                <Field label="Grade" style={{ flex: 1, minWidth: 100, maxWidth: 130 }}>
                  <TextInput
                    value={regenForm.gradeLevel}
                    onChange={(e) => setRegenForm((f) => ({ ...f, gradeLevel: e.target.value }))}
                  />
                </Field>
              </div>

              {/* Topic */}
              <Field label="Topic">
                <TextInput
                  value={regenForm.topicLabel}
                  onChange={(e) => setRegenForm((f) => ({ ...f, topicLabel: e.target.value }))}
                />
              </Field>

              {/* Difficulty + Count */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Field label="Difficulty" style={{ flex: 1, minWidth: 160 }}>
                  <Select
                    value={regenForm.difficulty}
                    onChange={(e) => setRegenForm((f) => ({ ...f, difficulty: e.target.value }))}
                  >
                    <option value="EASY">Easy</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HARD">Hard</option>
                  </Select>
                </Field>
                <Field label="# of tasks" style={{ flex: 1, minWidth: 100, maxWidth: 130 }}>
                  <TextInput
                    type="number"
                    min={1}
                    max={40}
                    value={regenForm.numberOfTasks}
                    onChange={(e) => setRegenForm((f) => ({ ...f, numberOfTasks: e.target.value }))}
                  />
                </Field>
              </div>

              {/* Task-type mix */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                    <span style={regenLabelStyle}>
                      Task-type mix{regenForm.reselectTypes ? "" : ` (${(regenForm.types || []).length})`}
                    </span>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#374151" }}>
                      <input
                        type="checkbox"
                        checked={!!regenForm.reselectTypes}
                        onChange={(e) => setRegenForm((f) => ({ ...f, reselectTypes: e.target.checked }))}
                      />
                      Let AI pick new task types
                    </label>
                  </div>
                  {regenForm.reselectTypes ? (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280", fontWeight: 700, lineHeight: 1.5 }}>
                      The AI will choose a fresh set of {Math.max(1, Number(regenForm.numberOfTasks) || (regenForm.types || []).length || 1)} task type{Number(regenForm.numberOfTasks) === 1 ? "" : "s"} for this topic instead of reusing the originals.
                    </div>
                  ) : (
                    <div style={{ marginTop: 6, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {(regenForm.types || []).map((t) => {
                        const meta = TASK_TYPE_META[t];
                        const label = meta?.label || t.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                        return (
                          <span key={t} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "3px 8px", borderRadius: 12, fontSize: "0.72rem", fontWeight: 700,
                            background: "rgba(15,23,42,0.05)", border: "1px solid rgba(15,23,42,0.12)",
                          }}>
                            {label}
                            <button
                              type="button"
                              title="Remove this type"
                              onClick={() => setRegenForm((f) => ({ ...f, types: (f.types || []).filter((x) => x !== t) }))}
                              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#6b7280", fontWeight: 900, padding: 0, lineHeight: 1 }}
                            >
                              ×
                            </button>
                          </span>
                        );
                      })}
                      {(regenForm.types || []).length === 0 && (
                        <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 700 }}>
                          Any types (AI picks)
                        </span>
                      )}
                    </div>
                  )}
                </div>

              {/* Vocabulary / word bank */}
              <Field label="Vocabulary / word bank (comma-separated)">
                <TextArea
                  rows={2}
                  value={regenForm.aiWordBank}
                  onChange={(e) => setRegenForm((f) => ({ ...f, aiWordBank: e.target.value }))}
                />
              </Field>

              {/* Flags — migrated to shared <Checkbox> (Wave 4). Quest +
                  At-desk are content-based (they change what's generated),
                  so they belong here. Duels is a runtime/launch flag (not
                  content), so it's not a generation toggle. */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <Checkbox
                  checked={!!regenForm.questMode}
                  onChange={(e) => setRegenForm((f) => ({ ...f, questMode: e.target.checked }))}
                >
                  Quest mode
                </Checkbox>
                <Checkbox
                  checked={!!regenForm.atDeskOnly}
                  onChange={(e) => setRegenForm((f) => ({ ...f, atDeskOnly: e.target.checked }))}
                >
                  At-desk only
                </Checkbox>
              </div>

              {/* New copy vs Replace original — migrated to shared
                  <ToggleGroup> single-select (Wave 5). */}
              <div style={{ marginTop: 4 }}>
                <span style={regenLabelStyle}>Output</span>
                <ToggleGroup
                  value={regenMode}
                  onChange={setRegenMode}
                  disabled={!!regeneratingId}
                  ariaLabel="Output mode"
                  style={{ marginTop: 6 }}
                  options={[
                    { value: "new", label: "📄 New copy", tip: "Keeps the original; saves a fresh “(regenerated)” copy." },
                    { value: "replace", label: "♻️ Replace original", tip: "Overwrites this task set's tasks in place." },
                  ]}
                />
                {regenMode === "replace" && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "#b45309", fontWeight: 700 }}>
                    ⚠️ This overwrites the current tasks. There's no undo.
                  </div>
                )}
              </div>
            </div>

            {/* Actions — shared Modal.Footer + Button primitives */}
            <Modal.Footer>
              <Button variant="ghost" onClick={closeRegenModal} disabled={!!regeneratingId}>
                Cancel
              </Button>
              <Button onClick={runRegenerate} disabled={!!regeneratingId}>
                {regeneratingId ? "♻️ Generating…" : "Generate"}
              </Button>
            </Modal.Footer>
          </>
        )}
      </Modal>

      {/* Fix / Diagnose Dialog */}
      {/* Diagnose & Fix Dialog — migrated to shared <Modal> + <Field> +
          <TextArea> + <Modal.Footer> + <Button> (Wave 2 step 2). */}
      <Modal
        open={!!fixDialogId}
        onClose={closeFixDialog}
        title="🔧 Diagnose & Fix"
        size="md"
        closeOnBackdrop={!fixRunning}
        closeOnEsc={!fixRunning}
      >
        <p style={{ color: "#6b7280", marginTop: 0, marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
          This will validate every task, auto-fix structural issues, and use AI to regenerate any tasks that can't be fixed mechanically. Everything gets logged for developer review.
        </p>

        {!fixResult && (
          <>
            <Field label="What's wrong? (optional — helps track the issue)">
              <TextArea
                value={fixNote}
                onChange={(e) => setFixNote(e.target.value)}
                placeholder='e.g. "Brain Spark Notes shows [object Object]" or "Sort task has only 2 items"'
                maxLength={1000}
                rows={3}
              />
            </Field>
            <Modal.Footer>
              <Button variant="ghost" onClick={closeFixDialog} disabled={fixRunning}>
                Cancel
              </Button>
              <Button onClick={runFix} disabled={fixRunning}>
                {fixRunning ? (fixPhase || "Fixing…") : "🔧 Diagnose & Fix"}
              </Button>
            </Modal.Footer>
          </>
        )}

            {fixResult && (() => {
              const failed = fixResult.failed === true || fixResult.ok === false || typeof fixResult.issuesFound !== "number";
              return (
              <div>
                {/* Summary */}
                <div style={{
                  background: failed ? "#fef2f2" : fixResult.issuesFound === 0 ? "#f0fdf4" : "#fffbeb",
                  border: `1.5px solid ${failed ? "#fca5a5" : fixResult.issuesFound === 0 ? "#86efac" : "#fcd34d"}`,
                  borderRadius: 12, padding: 14, marginBottom: 14,
                }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                    {failed
                      ? "❌ Couldn't run Diagnose & Fix"
                      : fixResult.issuesFound === 0
                        ? "✅ All Clear"
                        : `⚠️ ${fixResult.issuesFound} issue(s) found`}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                    {failed
                      ? `${fixResult.message || "Something went wrong."} — please try again. (If it keeps failing, the AI repair may be taking too long; retry in a moment.)`
                      : fixResult.message}
                  </div>
                </div>

                {/* Per-task details */}
                {(fixResult.diagnostics || []).length > 0 && (
                  <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                    {fixResult.diagnostics.map((d, i) => {
                      const statusIcon = d.aiRepaired ? "🤖" : d.fixed ? "✅" : "⚠️";
                      const statusLabel = d.aiRepaired ? "AI-repaired" : d.fixed ? "Structural fix" : d.aiRepairError ? "AI repair failed" : "Needs attention";
                      const bg = d.fixed || d.aiRepaired ? "#f0fdf4" : "#fffbeb";
                      const border = d.fixed || d.aiRepaired ? "#86efac" : "#fcd34d";
                      return (
                        <div key={i} style={{ background: bg, border: `1px solid ${border}`, borderRadius: 10, padding: 12 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                            {statusIcon} Task {d.taskIndex + 1}: {d.taskType}
                            <span style={{ fontWeight: 500, fontSize: 11, marginLeft: 8, opacity: 0.7 }}>({statusLabel})</span>
                          </div>
                          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, fontStyle: "italic" }}>
                            {d.title}
                          </div>
                          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#374151", lineHeight: 1.6 }}>
                            {d.errors.map((e, j) => <li key={j}>{e}</li>)}
                          </ul>
                          {d.aiRepairError && (
                            <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>AI error: {d.aiRepairError}</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Action buttons — shared Modal.Footer + Button. */}
                <Modal.Footer>
                  {fixResult.diagnostics?.length > 0 && (
                    <Button variant="ghost" onClick={copyDiagnosticReport}>
                      📋 Copy Report
                    </Button>
                  )}
                  <Button onClick={closeFixDialog}>Done</Button>
                </Modal.Footer>
              </div>
              );
            })()}
      </Modal>
    </PageShell>
  );
}
