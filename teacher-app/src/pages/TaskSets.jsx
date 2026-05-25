// teacher-app/src/pages/TaskSets.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetchJson } from "../api/apiFetch";
import { fetchMyProfile } from "../api/profile";
import { API_BASE_URL, STUDENT_APP_URL } from "../config";
import { TASK_TYPE_META } from "../../../shared/taskTypes.js";

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
  };

  const runFix = async () => {
    if (!fixDialogId || fixRunning) return;
    setFixRunning(true);
    setFixResult(null);
    try {
      const data = await apiFetchJson(`/api/tasksets/${encodeURIComponent(fixDialogId)}/sanitize`, {
        method: "POST",
        body: { note: fixNote },
      });
      setFixResult(data);
      await loadSets();
    } catch (e) {
      setFixResult({ ok: false, message: e?.message || "Fix failed" });
    } finally {
      setFixRunning(false);
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
            const isExpanded = expandedIds.has(id);

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

            const secondLineParts = [
              subject && subject.toLowerCase() !== title.toLowerCase() && subject,
              grade && `Grade ${grade}`,
              `${count} task${count === 1 ? "" : "s"}`,
              durLabel,
              avgCompLabel,
              goalLabel,
              blooms ? `Bloom's ${blooms}` : "",
              `Plays ${times}`,
              last ? `Last played ${last}` : "Never played",
            ].filter(Boolean);

            const subjectColor = getSubjectColor(subject);

            return (
              <div key={id} title={taskTypeTooltip} style={{
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
                        <span style={{ marginRight: 6, fontSize: "0.8rem", color: "#9ca3af" }}>
                          {isExpanded ? "\u25BC" : "\u25B6"}
                        </span>
                        {title}
                      </div>
                      {/* Quick-action buttons always visible */}
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
                      >
                        <button
                          type="button"
                          onClick={() => testRun(ts)}
                          style={btn("secondary")}
                          title="Step through the tasks as a student would — no QR scans"
                        >
                          🧪 Test run
                        </button>
                        <button type="button" onClick={() => launchNow(ts)} style={btn("primary")}>
                          Launch
                        </button>
                      </div>
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
                        <button type="button" onClick={() => openReport(ts)} style={btn("secondary")}>
                          Report
                        </button>
                        <button type="button" onClick={() => copyShareLink(ts)} style={btn("secondary")}>
                          Share
                        </button>
                        <button type="button" onClick={() => navigate(`/tasksets/${encodeURIComponent(id)}`)} style={btn("secondary")}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => openFixDialog(id)}
                          title="Diagnose and fix AI-generated task issues"
                          style={btn("secondary")}
                        >
                          🔧 Fix
                        </button>
                        <button type="button" onClick={() => deleteOne(id)} style={btn("danger")}>
                          Delete
                        </button>
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

      {/* Fix / Diagnose Dialog */}
      {fixDialogId && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex",
          alignItems: "center", justifyContent: "center", zIndex: 9999,
          padding: 16,
        }}>
          <div style={{
            background: "#fff", borderRadius: 16, padding: 24,
            maxWidth: 560, width: "100%", boxShadow: "0 16px 50px rgba(0,0,0,0.2)",
            maxHeight: "85vh", overflowY: "auto",
          }}>
            <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>🔧 Diagnose & Fix</h2>
            <p style={{ color: "#6b7280", marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
              This will validate every task, auto-fix structural issues, and use AI to regenerate any tasks that can't be fixed mechanically. Everything gets logged for developer review.
            </p>

            {!fixResult && (
              <>
                <label style={{ fontWeight: 600, fontSize: 13, display: "block", marginBottom: 6 }}>
                  What's wrong? (optional — helps track the issue)
                </label>
                <textarea
                  value={fixNote}
                  onChange={(e) => setFixNote(e.target.value)}
                  placeholder='e.g. "Brain Spark Notes shows [object Object]" or "Sort task has only 2 items"'
                  maxLength={1000}
                  rows={3}
                  style={{
                    width: "100%", padding: 10, borderRadius: 10,
                    border: "1.5px solid #d1d5db", fontSize: 13,
                    fontFamily: "inherit", resize: "vertical",
                  }}
                />
                <div style={{ display: "flex", gap: 10, marginTop: 14, justifyContent: "flex-end" }}>
                  <button onClick={closeFixDialog} style={{
                    padding: "8px 18px", borderRadius: 10, border: "1px solid #d1d5db",
                    background: "#fff", fontWeight: 600, fontSize: 13, cursor: "pointer",
                  }}>
                    Cancel
                  </button>
                  <button onClick={runFix} disabled={fixRunning} style={{
                    padding: "8px 18px", borderRadius: 10, border: "none",
                    background: fixRunning ? "#94a3b8" : "#2563eb", color: "#fff",
                    fontWeight: 700, fontSize: 13, cursor: fixRunning ? "wait" : "pointer",
                  }}>
                    {fixRunning ? "Fixing…" : "🔧 Diagnose & Fix"}
                  </button>
                </div>
              </>
            )}

            {fixResult && (
              <div>
                {/* Summary */}
                <div style={{
                  background: fixResult.issuesFound === 0 ? "#f0fdf4" : "#fef2f2",
                  border: `1.5px solid ${fixResult.issuesFound === 0 ? "#86efac" : "#fca5a5"}`,
                  borderRadius: 12, padding: 14, marginBottom: 14,
                }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                    {fixResult.issuesFound === 0 ? "✅ All Clear" : `⚠️ ${fixResult.issuesFound} issue(s) found`}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.5 }}>
                    {fixResult.message}
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

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  {fixResult.diagnostics?.length > 0 && (
                    <button onClick={copyDiagnosticReport} style={{
                      padding: "8px 18px", borderRadius: 10, border: "1.5px solid #2563eb",
                      background: "#eff6ff", color: "#2563eb",
                      fontWeight: 700, fontSize: 13, cursor: "pointer",
                    }}>
                      📋 Copy Report
                    </button>
                  )}
                  <button onClick={closeFixDialog} style={{
                    padding: "8px 18px", borderRadius: 10, border: "none",
                    background: "#2563eb", color: "#fff",
                    fontWeight: 700, fontSize: 13, cursor: "pointer",
                  }}>
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
