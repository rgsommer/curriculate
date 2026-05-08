// teacher-app/src/pages/ClassRostersAdmin.jsx
//
// Teacher-side class roster admin (PLUS+ feature).
// - Lists each uploaded class roster
// - For the selected class, shows every student with editable
//   Student Email and Parent Email fields
// - Single "Save changes" button persists everything in one round-trip
//
// Embedded as a collapsible section on TeacherProfile. Reads from
// /class-roster/:id/contacts and writes via the bulk-set endpoint.

import React, { useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../config";

const API_BASE = API_BASE_URL || "";
const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ClassRostersAdmin({ teacherEmail }) {
  const [open, setOpen] = useState(false);
  const [rosters, setRosters] = useState([]);
  const [selectedRosterId, setSelectedRosterId] = useState("");
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [students, setStudents] = useState([]); // current edit buffer
  const [serverStudents, setServerStudents] = useState([]); // last-saved snapshot
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Load rosters list when section is opened
  useEffect(() => {
    if (!open || !teacherEmail) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/class-roster/list?teacherEmail=${encodeURIComponent(teacherEmail)}`
        );
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setRosters(Array.isArray(j?.rosters) ? j.rosters : []);
      } catch (e) {
        if (!cancelled) setErrorMsg(e?.message || "Could not load class lists.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, teacherEmail]);

  // Load roster + contacts when a class is selected
  useEffect(() => {
    if (!selectedRosterId || !teacherEmail) {
      setStudents([]);
      setServerStudents([]);
      return;
    }
    let cancelled = false;
    setLoadingRoster(true);
    setErrorMsg("");
    setStatusMsg("");
    (async () => {
      try {
        const res = await fetch(
          `${API_BASE}/class-roster/${encodeURIComponent(selectedRosterId)}/contacts?teacherEmail=${encodeURIComponent(teacherEmail)}`
        );
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j?.ok) {
          throw new Error(j?.error || "Could not load class.");
        }
        const sorted = (j.students || []).slice().sort((a, b) =>
          `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
        );
        setStudents(sorted);
        setServerStudents(sorted);
      } catch (e) {
        if (!cancelled) setErrorMsg(e?.message || "Could not load class.");
      } finally {
        if (!cancelled) setLoadingRoster(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRosterId, teacherEmail]);

  function setField(idx, field, value) {
    setStudents((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  // Compute which rows actually changed since last server snapshot, and
  // which changes are valid (or blank — blanks are allowed = no change).
  const dirty = useMemo(() => {
    const out = [];
    for (let i = 0; i < students.length; i++) {
      const cur = students[i];
      const orig = serverStudents[i] || {};
      const emailChanged = (cur.email || "") !== (orig.email || "");
      const parentChanged = (cur.parentEmail || "") !== (orig.parentEmail || "");
      if (!emailChanged && !parentChanged) continue;
      out.push({
        edsbyId: cur.edsbyId,
        firstName: cur.firstName,
        lastName: cur.lastName,
        email: emailChanged ? (cur.email || "").trim().toLowerCase() : undefined,
        parentEmail: parentChanged ? (cur.parentEmail || "").trim().toLowerCase() : undefined,
      });
    }
    return out;
  }, [students, serverStudents]);

  const allValid = dirty.every(
    (d) =>
      (d.email === undefined || d.email === "" || VALID_EMAIL.test(d.email)) &&
      (d.parentEmail === undefined || d.parentEmail === "" || VALID_EMAIL.test(d.parentEmail))
  );

  async function handleSave() {
    if (!dirty.length || !allValid) return;
    setBusy(true);
    setStatusMsg("");
    setErrorMsg("");
    try {
      const updates = dirty
        .filter((d) => d.email !== "" || d.parentEmail !== "") // blanks ignored
        .map((d) => {
          const u = { edsbyId: d.edsbyId };
          if (d.email !== undefined) u.email = d.email;
          if (d.parentEmail !== undefined) u.parentEmail = d.parentEmail;
          return u;
        });
      const res = await fetch(
        `${API_BASE}/class-roster/${encodeURIComponent(selectedRosterId)}/contacts/bulk-set`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teacherEmail, updates }),
        }
      );
      const j = await res.json();
      if (!res.ok || !j?.ok) throw new Error(j?.error || "Save failed.");
      setStatusMsg(`Saved ${j.saved} student${j.saved === 1 ? "" : "s"}${j.errors?.length ? ` · ${j.errors.length} skipped` : ""}.`);
      setServerStudents(students); // mark current state as the new baseline
    } catch (e) {
      setErrorMsg(e?.message || "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  const dirtyCount = dirty.filter((d) => allValid).length;

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
        🧑‍🏫 Class Rosters — student + parent emails {open ? "▾" : "▸"}
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
            Pick a class to review. Fill in any student or parent email
            address that's still blank — these power per-student session
            reports for both Curriculate scavenger hunts and Pulse Grading.
          </p>

          {rosters.length === 0 && (
            <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
              You haven't uploaded any class rosters yet. Use Pulse Grading's
              "Upload class CSV" or your Edsby export to add one.
            </div>
          )}

          {rosters.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 700, marginBottom: 4 }}>
                Class
              </label>
              <select
                value={selectedRosterId}
                onChange={(e) => setSelectedRosterId(e.target.value)}
                style={{ width: "100%", maxWidth: 360, padding: "8px 10px", borderRadius: 8 }}
              >
                <option value="">— Pick a class —</option>
                {rosters.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.className || "Unnamed class"} ({r.studentCount || 0} students)
                  </option>
                ))}
              </select>
            </div>
          )}

          {loadingRoster && (
            <div style={{ color: "#6b7280", fontSize: "0.9rem", marginTop: 12 }}>
              Loading class…
            </div>
          )}

          {!loadingRoster && students.length > 0 && (
            <>
              <div
                style={{
                  background: "#fff",
                  border: "1px solid #e5e7eb",
                  borderRadius: 10,
                  overflow: "auto",
                  maxHeight: 520,
                }}
              >
                <table cellPadding="0" cellSpacing="0" style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
                  <thead style={{ background: "#f1f5f9", position: "sticky", top: 0 }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: 10 }}>Student</th>
                      <th style={{ textAlign: "left", padding: 10 }}>Student email</th>
                      <th style={{ textAlign: "left", padding: 10 }}>Parent email</th>
                    </tr>
                  </thead>
                  <tbody>
                    {students.map((s, i) => {
                      const emailInvalid = s.email && !VALID_EMAIL.test(s.email.trim());
                      const parentInvalid = s.parentEmail && !VALID_EMAIL.test(s.parentEmail.trim());
                      const original = serverStudents[i] || {};
                      const emailChanged = (s.email || "") !== (original.email || "");
                      const parentChanged = (s.parentEmail || "") !== (original.parentEmail || "");
                      return (
                        <tr key={s.edsbyId || i} style={{ borderTop: "1px solid #e5e7eb" }}>
                          <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                            <div style={{ fontWeight: 700 }}>
                              {s.firstName} {s.lastName}
                            </div>
                            {s.studentId && (
                              <div style={{ fontSize: "0.72rem", color: "#9ca3af" }}>
                                ID {s.studentId}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: 8 }}>
                            <input
                              type="email"
                              value={s.email || ""}
                              onChange={(e) => setField(i, "email", e.target.value)}
                              placeholder="student@example.com"
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 6,
                                border: emailInvalid ? "1px solid #ef4444" : "1px solid #d1d5db",
                                background: emailChanged ? "#fef9c3" : "#fff",
                                fontSize: "0.85rem",
                                boxSizing: "border-box",
                              }}
                            />
                          </td>
                          <td style={{ padding: 8 }}>
                            <input
                              type="email"
                              value={s.parentEmail || ""}
                              onChange={(e) => setField(i, "parentEmail", e.target.value)}
                              placeholder="parent@example.com"
                              style={{
                                width: "100%",
                                padding: "6px 8px",
                                borderRadius: 6,
                                border: parentInvalid ? "1px solid #ef4444" : "1px solid #d1d5db",
                                background: parentChanged ? "#fef9c3" : "#fff",
                                fontSize: "0.85rem",
                                boxSizing: "border-box",
                              }}
                            />
                            {original.parentEmailDeclined && !s.parentEmail && (
                              <div style={{ marginTop: 4, fontSize: "0.7rem", color: "#9ca3af" }}>
                                Student declined the prompt.
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 14 }}>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={busy || dirtyCount === 0 || !allValid}
                  style={{
                    background: dirtyCount > 0 && allValid ? "#0f172a" : "#9ca3af",
                    color: "#fff",
                    padding: "10px 16px",
                    borderRadius: 8,
                    fontWeight: 800,
                    cursor: busy || dirtyCount === 0 || !allValid ? "not-allowed" : "pointer",
                    border: "none",
                  }}
                >
                  {busy ? "Saving…" : `Save ${dirtyCount || ""} change${dirtyCount === 1 ? "" : "s"}`.trim()}
                </button>
                {!allValid && (
                  <span style={{ fontSize: "0.85rem", color: "#b91c1c" }}>
                    Fix invalid emails before saving.
                  </span>
                )}
                {statusMsg && (
                  <span style={{ fontSize: "0.85rem", color: "#15803d" }}>{statusMsg}</span>
                )}
                {errorMsg && (
                  <span style={{ fontSize: "0.85rem", color: "#b91c1c" }}>{errorMsg}</span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
