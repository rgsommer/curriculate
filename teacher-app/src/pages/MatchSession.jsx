// teacher-app/src/pages/MatchSession.jsx
//
// Mode C — Post-hoc Match a Session.
// Lets a teacher pick one of their recent sessions, pick a class roster,
// reconcile each student name to a roster entry (with a Levenshtein-≤2
// suggestion pre-filled), then export a clean Edsby-format CSV.
//
// Embedded in TeacherProfile.jsx as a collapsible section.

import React, { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../api/apiFetch";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "";

// Levenshtein distance with early exit at `max`.
function lev(a, b, max = 2) {
  a = String(a || "");
  b = String(b || "");
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > max) return max + 1;
  if (!al) return bl;
  if (!bl) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

function norm(s) {
  return String(s || "").toLowerCase().replace(/[^a-z]/g, "");
}

// Same suggestion logic the email's CSV builder uses: exact → both ≤2 → none.
function suggestRosterMatch(studentName, rosterStudents) {
  if (!studentName || !rosterStudents?.length) return null;
  const parts = String(studentName).trim().split(/\s+/);
  const fnIn = norm(parts[0] || "");
  const lnIn = norm(parts.slice(1).join(""));
  const fullIn = fnIn + lnIn;
  if (!fullIn) return null;

  // Exact full-name match
  for (const s of rosterStudents) {
    const fn = norm(s.firstName);
    const ln = norm(s.lastName);
    if (fn + ln === fullIn || ln + fn === fullIn) return s;
  }
  // Both within Levenshtein 2
  let best = null;
  let bestScore = Infinity;
  for (const s of rosterStudents) {
    const fn = norm(s.firstName);
    const ln = norm(s.lastName);
    const dFn = lev(fnIn, fn, 2);
    const dLn = lev(lnIn, ln, 2);
    if (dFn <= 2 && dLn <= 2) {
      const score = dFn + dLn;
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
  }
  return best;
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString();
  } catch {
    return "";
  }
}

export default function MatchSession({ teacherEmail }) {
  const [open, setOpen] = useState(false);
  const [reports, setReports] = useState([]);
  const [rosters, setRosters] = useState([]);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [report, setReport] = useState(null); // full report for selectedReportId
  const [matches, setMatches] = useState({}); // { lowercaseStudentName: edsbyId | "" | "__leave__" }
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Load reports + rosters once when section is opened
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetchJson("/api/reports");
        if (!cancelled) setReports(Array.isArray(data?.reports) ? data.reports : []);
      } catch (e) {
        if (!cancelled) setErrorMsg(e?.message || "Could not load reports.");
      }
      if (teacherEmail) {
        try {
          const res = await fetch(
            `${API_BASE}/class-roster/list?teacherEmail=${encodeURIComponent(teacherEmail)}`
          );
          if (res.ok) {
            const j = await res.json();
            if (!cancelled) setRosters(Array.isArray(j?.rosters) ? j.rosters : []);
          }
        } catch {}
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, teacherEmail]);

  // Fetch full report when selection changes
  useEffect(() => {
    if (!selectedReportId) {
      setReport(null);
      setMatches({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetchJson(`/api/reports/${selectedReportId}`);
        if (cancelled) return;
        const r = data?.report || null;
        setReport(r);
        // Pre-fill matches from existing edsbyIds (already-matched students stay matched)
        const initial = {};
        for (const g of r?.studentGrades || []) {
          const k = String(g.studentName || "").toLowerCase();
          if (g.edsbyId) initial[k] = g.edsbyId;
        }
        setMatches(initial);
        // Try to infer the class from the report's className field.
        if (r?.className && rosters.length) {
          const lc = String(r.className).toLowerCase();
          const inferred = rosters.find(
            (x) => String(x.className || "").toLowerCase() === lc
          );
          if (inferred && !selectedRosterId) setSelectedRosterId(inferred.id);
        }
      } catch (e) {
        if (!cancelled) setErrorMsg(e?.message || "Could not load report.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedReportId, rosters.length]);

  const selectedRoster = useMemo(
    () => rosters.find((r) => r.id === selectedRosterId) || null,
    [rosters, selectedRosterId]
  );
  const rosterStudents = selectedRoster?.students || [];

  // Per-row suggestion (computed on the fly — fast at this scale)
  const suggestionFor = (studentName) =>
    suggestRosterMatch(studentName, rosterStudents);

  // Build a quick lookup of which edsbyIds are already used by other rows
  const usedIds = useMemo(() => {
    const used = new Set();
    Object.entries(matches).forEach(([_k, v]) => {
      if (v && v !== "__leave__") used.add(v);
    });
    return used;
  }, [matches]);

  const completedRows = (report?.studentGrades || []).filter(
    (g) => Number(g?.pointsPossible) > 0
  );

  function setMatchFor(studentName, value) {
    const k = String(studentName || "").toLowerCase();
    setMatches((m) => ({ ...m, [k]: value }));
  }

  async function handleExport() {
    if (!report) return;
    setBusy(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      // Translate "__leave__" sentinel to "" for the API
      const payload = {};
      Object.entries(matches).forEach(([k, v]) => {
        payload[k] = v === "__leave__" ? "" : v;
      });
      const data = await apiFetchJson(
        `/api/reports/${report._id}/edsby-csv`,
        {
          method: "POST",
          body: {
            classRosterId: selectedRosterId || null,
            manualMatches: payload,
          },
        }
      );
      if (!data?.ok || !data.csv) {
        throw new Error(data?.error || "Export failed.");
      }
      const safeName = String(data.tasksetName || "Curriculate")
        .replace(/[^A-Za-z0-9_\- ]+/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60) || "Curriculate";
      const filename = data.hasAnyId
        ? `${safeName}-edsby-import.csv`
        : `${safeName}-grades.csv`;
      downloadCsv(data.csv, filename);
      setStatusMsg(
        `Exported ${data.completedCount} student${data.completedCount === 1 ? "" : "s"} → ${filename}`
      );
    } catch (e) {
      setErrorMsg(e?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginBottom: 24 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          color: "#0f172a",
          border: "1px solid #e5e7eb",
          padding: "10px 14px",
          borderRadius: 10,
          fontWeight: 800,
          cursor: "pointer",
          width: "100%",
          textAlign: "left",
        }}
      >
        📋 Match a Session — post-hoc Edsby CSV from any past run {open ? "▾" : "▸"}
      </button>

      {open && (
        <div
          style={{
            marginTop: 10,
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: 16,
            background: "#fafafa",
          }}
        >
          <p style={{ margin: 0, marginBottom: 12, fontSize: "0.9rem", color: "#475569" }}>
            Pick a past session that ran without class binding (or where the sub did not pick a class),
            choose the matching class roster, confirm or fix each row, then export a clean Edsby CSV.
          </p>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
            <label style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 4 }}>Session</div>
              <select
                value={selectedReportId}
                onChange={(e) => setSelectedReportId(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8 }}
              >
                <option value="">— Pick a session —</option>
                {reports.slice(0, 30).map((r) => {
                  const date = fmtDate(r.startedAt || r.createdAt);
                  const label = `${r.taskSetName || "Session"} · ${r.className || "—"} · Room ${r.roomCode || "?"} · ${date}`;
                  return (
                    <option key={r._id} value={r._id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </label>

            <label style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: 4 }}>Class roster</div>
              <select
                value={selectedRosterId}
                onChange={(e) => setSelectedRosterId(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8 }}
              >
                <option value="">— Pick a class —</option>
                {rosters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.className || "Unnamed class"} ({r.studentCount || 0} students)
                  </option>
                ))}
              </select>
            </label>
          </div>

          {report && completedRows.length === 0 && (
            <div style={{ padding: 12, color: "#6b7280", fontSize: "0.9rem" }}>
              This session has no completed students.
            </div>
          )}

          {report && completedRows.length > 0 && (
            <div
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                overflow: "auto",
                maxHeight: 480,
              }}
            >
              <table cellPadding="0" cellSpacing="0" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                <thead style={{ background: "#f1f5f9", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Name on session</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Match to roster</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {completedRows.map((g, i) => {
                    const k = String(g.studentName || "").toLowerCase();
                    const current = matches[k] ?? "";
                    const suggestion =
                      !current && rosterStudents.length
                        ? suggestionFor(g.studentName)
                        : null;
                    const effectiveValue = current || (suggestion?.edsbyId || "");
                    const isSuggested = !current && !!suggestion;

                    return (
                      <tr key={i} style={{ borderTop: "1px solid #e5e7eb" }}>
                        <td style={{ padding: 10 }}>
                          <div style={{ fontWeight: 700 }}>{g.studentName || "—"}</div>
                          {g.teamName && (
                            <div style={{ fontSize: "0.78rem", color: "#6b7280" }}>{g.teamName}</div>
                          )}
                        </td>
                        <td style={{ padding: 10 }}>
                          <select
                            value={current === "" && isSuggested ? "" : (current || "")}
                            onChange={(e) => setMatchFor(g.studentName, e.target.value)}
                            style={{
                              width: "100%",
                              padding: "6px 8px",
                              borderRadius: 6,
                              background: isSuggested ? "#fef3c7" : "#fff",
                              border: isSuggested ? "1px solid #fcd34d" : "1px solid #d1d5db",
                            }}
                          >
                            <option value="">{isSuggested ? `Suggested: ${suggestion.firstName} ${suggestion.lastName}` : "— Pick a student —"}</option>
                            <option value="__leave__">Not in this class (leave blank)</option>
                            <optgroup label="Roster">
                              {rosterStudents
                                .slice()
                                .sort((a, b) =>
                                  `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
                                )
                                .map((s) => {
                                  const eid = s.edsbyId || s.studentId || "";
                                  const inUse = eid && eid !== effectiveValue && usedIds.has(eid);
                                  return (
                                    <option key={eid || `${s.firstName}|${s.lastName}`} value={eid} disabled={inUse}>
                                      {s.firstName} {s.lastName}{inUse ? " (used)" : ""}
                                    </option>
                                  );
                                })}
                            </optgroup>
                          </select>
                          {isSuggested && (
                            <div style={{ marginTop: 4, fontSize: "0.78rem", color: "#92400e" }}>
                              Suggestion based on name similarity. Confirm or change.
                            </div>
                          )}
                        </td>
                        <td style={{ padding: 10, textAlign: "right", whiteSpace: "nowrap" }}>
                          {g.pointsEarned ?? 0}/{g.pointsPossible ?? 0} <span style={{ color: "#6b7280" }}>({g.percent ?? 0}%)</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {report && completedRows.length > 0 && (
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
              <button
                type="button"
                onClick={handleExport}
                disabled={busy || !selectedRosterId}
                style={{
                  background: selectedRosterId ? "#0f172a" : "#9ca3af",
                  color: "#fff",
                  padding: "10px 16px",
                  borderRadius: 8,
                  fontWeight: 800,
                  cursor: busy || !selectedRosterId ? "not-allowed" : "pointer",
                  border: "none",
                }}
              >
                {busy ? "Building CSV…" : "Export Edsby CSV"}
              </button>
              {!selectedRosterId && (
                <span style={{ fontSize: "0.85rem", color: "#6b7280" }}>
                  Pick a class roster to enable export.
                </span>
              )}
              {statusMsg && (
                <span style={{ fontSize: "0.85rem", color: "#15803d" }}>{statusMsg}</span>
              )}
              {errorMsg && (
                <span style={{ fontSize: "0.85rem", color: "#b91c1c" }}>{errorMsg}</span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
