"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Behavior, type StudentSummary } from "../_lib/api";

type NoticeResult = { _id: string; status: string; cancelUntil?: string; ccVp?: boolean } | null;

function gradeLabel(g?: string) {
  const v = (g || "").trim();
  return v ? `Grade ${v}` : "";
}

export default function LogIncidentPage() {
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [query, setQuery] = useState("");
  const [selectedClass, setSelectedClass] = useState<string>("");

  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [behaviorId, setBehaviorId] = useState("");
  const [note, setNote] = useState("");

  const [status, setStatus] = useState<{ activeCount: number; triggerCount: number; incidents: any[] } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeResult>(null);
  const [trigger, setTrigger] = useState<{ date: string; teacher: string; offense: string; comment: string }[]>([]);
  const [triggerCount, setTriggerCount] = useState(3);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api<{ students: StudentSummary[] }>("/students")
      .then((d) => setStudents(d.students || []))
      .catch((e) => setError(e.message));
    api<{ behaviors: Behavior[] }>("/behaviors")
      .then((d) => setBehaviors(d.behaviors || []))
      .catch((e) => setError(e.message));
  }, []);

  // When a student is selected, load their current strikes + recent incidents
  // so the teacher sees the context while choosing the new incident.
  useEffect(() => {
    if (!student) {
      setStatus(null);
      return;
    }
    api<{ activeCount: number; triggerCount: number; incidents: any[] }>(`/students/${student._id}`)
      .then((d) => setStatus({ activeCount: d.activeCount, triggerCount: d.triggerCount, incidents: d.incidents || [] }))
      .catch(() => setStatus(null));
  }, [student]);

  // Distinct class codes (6A, 6B, 7A…), sorted naturally for the button row.
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if ((s.classGroup || "").trim()) set.add(s.classGroup!.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  // What to show: search matches (across all classes) take priority; otherwise
  // the students in the selected class.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) {
      return students.filter((s) =>
        `${s.firstName} ${s.lastName} ${s.preferredName || ""}`.toLowerCase().includes(q)
      );
    }
    if (selectedClass) return students.filter((s) => (s.classGroup || "").trim() === selectedClass);
    return [];
  }, [students, query, selectedClass]);

  if (!getToken()) {
    return (
      <p>
        Please <Link className="underline" href={loginHref("/behavior/log")}>sign in</Link> to log incidents.
      </p>
    );
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!student || !behaviorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ notice: NoticeResult; triggerIncidents: any[]; triggerCount: number }>("/incidents", {
        body: { studentId: student._id, behaviorIds: [behaviorId], detailText: note.trim() },
      });
      setNotice(res.notice);
      setTrigger(res.triggerIncidents || []);
      setTriggerCount(res.triggerCount || 3);
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelNotice() {
    if (!notice) return;
    try {
      await api(`/notices/${notice._id}/cancel`, { body: {} });
      setNotice({ ...notice, status: "cancelled" });
    } catch (e: any) {
      setError(e.message);
    }
  }

  function reset() {
    setStudent(null);
    setBehaviorId("");
    setNote("");
    setNotice(null);
    setTrigger([]);
    setDone(false);
    setQuery("");
  }

  // ── Confirmation ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h1 className="text-lg font-semibold text-green-800">Logged ✓</h1>
          <p className="mt-1 text-sm text-green-700">
            Recorded for {student?.preferredName || student?.firstName} {student?.lastName}.
          </p>
        </div>

        {trigger.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">
                {notice ? "Incidents in this notice" : "Strikes so far (all teachers)"}
              </h2>
              <span className="text-sm text-slate-400">
                {trigger.length}
                {!notice && ` / ${triggerCount}`}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {trigger.map((t, i) => (
                <li key={i} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.offense}</span>
                    <span className="text-slate-400">
                      {new Date(t.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <div className="text-slate-500">
                    {t.teacher || "—"}
                    {t.comment ? ` · ${t.comment}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notice && notice.status !== "cancelled" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">Notice home triggered</h2>
            <p className="mt-1 text-sm text-amber-800">
              A parent notice is queued{notice.ccVp ? " (VP CC’d)" : ""}. You can cancel it during the brief send window.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={cancelNotice} className="rounded-lg bg-amber-600 px-4 py-2 text-white">Cancel send</button>
              {student && (
                <Link href={`/behavior/student/${student._id}`} className="rounded-lg border border-amber-400 px-4 py-2 text-amber-900">
                  View
                </Link>
              )}
            </div>
          </div>
        )}
        {notice && notice.status === "cancelled" && <p className="text-sm text-slate-500">Notice cancelled.</p>}
        <button onClick={reset} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-white">Log another</button>
      </div>
    );
  }

  // ── Step 2: chosen student → pick incident, note, submit ─────────────────────
  if (student) {
    return (
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-xl font-semibold">Log an incident</h1>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        {/* Back navigation */}
        <div className="flex items-center gap-3 text-sm">
          <button type="button" onClick={() => setStudent(null)} className="text-slate-600 hover:text-slate-900">
            ← {selectedClass || "students"}
          </button>
          <span className="text-slate-300">·</span>
          <button
            type="button"
            onClick={() => { setStudent(null); setSelectedClass(""); setQuery(""); }}
            className="text-slate-600 hover:text-slate-900"
          >
            all classes
          </button>
        </div>

        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="font-semibold">
              {student.preferredName || student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-slate-400">{[student.classGroup, gradeLabel(student.grade)].filter(Boolean).join(" · ")}</p>
          </div>
          <Link href={`/behavior/student/${student._id}`} className="text-sm text-slate-500 underline">full history</Link>
        </div>

        {/* Current strikes + recent incidents for context while logging */}
        {status && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Current strikes (all teachers)</h2>
              <span className={`text-sm font-medium ${status.activeCount >= status.triggerCount ? "text-red-600" : "text-slate-500"}`}>
                {status.activeCount} / {status.triggerCount}
              </span>
            </div>
            {status.incidents.length > 0 ? (
              <ul className="mt-2 divide-y divide-slate-100">
                {status.incidents.slice(0, 5).map((i, idx) => (
                  <li key={idx} className="py-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{i.behaviorSnapshot?.name}</span>
                      <span className="text-slate-400">
                        {new Date(i.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <div className="text-slate-500">
                      {i.teacherName || "—"}
                      {i.detailText ? ` · ${i.detailText}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-400">No prior incidents.</p>
            )}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">Incident</span>
          <select
            autoFocus
            value={behaviorId}
            onChange={(e) => setBehaviorId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
          >
            <option value="">Choose an incident…</option>
            {behaviors.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
                {b.triggerMode === "IMMEDIATE" ? " — immediate" : ""}
              </option>
            ))}
          </select>
        </label>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          rows={2}
          className="w-full rounded-xl border border-slate-300 px-4 py-3"
        />

        <button
          type="submit"
          disabled={!behaviorId || submitting}
          className="w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-40"
        >
          {submitting ? "Submitting…" : "Submit"}
        </button>
      </form>
    );
  }

  // ── Step 1: pick a class (button row), then a student ────────────────────────
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Log an incident</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Class buttons */}
      <div className="flex flex-wrap gap-2">
        {classes.map((c) => (
          <button
            key={c}
            onClick={() => {
              setQuery("");
              setSelectedClass(selectedClass === c ? "" : c);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              selectedClass === c && !query ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="…or search any student by name"
        className="w-full rounded-xl border border-slate-300 px-4 py-3"
        inputMode="search"
      />

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.map((s) => (
          <li key={s._id} className="flex items-center">
            <button
              onClick={() => setStudent(s)}
              className="flex flex-1 items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
            >
              <span className="font-medium">
                {s.lastName}, {s.firstName}
                {s.preferredName ? ` (${s.preferredName})` : ""}
              </span>
              <span className="text-sm text-slate-400">{s.classGroup}</span>
            </button>
            <Link
              href={`/behavior/student/${s._id}`}
              className="shrink-0 border-l border-slate-100 px-4 py-3 text-sm text-slate-500 hover:text-slate-900"
              title="View this student's history"
            >
              history →
            </Link>
          </li>
        ))}
        {students.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">No students yet — import a roster in Setup.</li>}
        {students.length > 0 && visible.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-400">
            {query ? "No matches." : "Pick a class above, or search by name."}
          </li>
        )}
      </ul>
    </div>
  );
}
