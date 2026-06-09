"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Behavior, type StudentSummary } from "../_lib/api";

type NoticeResult = { _id: string; status: string; cancelUntil?: string; ccVp?: boolean } | null;

function gradeLabel(g?: string) {
  const v = (g || "").trim();
  return v ? `Grade ${v}` : "Other";
}

export default function LogIncidentPage() {
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [query, setQuery] = useState("");
  const [openGrades, setOpenGrades] = useState<Set<string>>(new Set());

  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [behaviorId, setBehaviorId] = useState("");
  const [note, setNote] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeResult>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the whole roster + behaviour list once.
  useEffect(() => {
    if (!getToken()) return;
    api<{ students: StudentSummary[] }>("/students")
      .then((d) => setStudents(d.students || []))
      .catch((e) => setError(e.message));
    api<{ behaviors: Behavior[] }>("/behaviors")
      .then((d) => setBehaviors(d.behaviors || []))
      .catch((e) => setError(e.message));
  }, []);

  // Filter by the quick search, then group by grade (ascending; "Other" last).
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? students.filter((s) =>
          `${s.firstName} ${s.lastName} ${s.preferredName || ""}`.toLowerCase().includes(q)
        )
      : students;
    const byGrade = new Map<string, StudentSummary[]>();
    for (const s of filtered) {
      const key = (s.grade || "").trim() || "~"; // "~" sorts last → "Other"
      if (!byGrade.has(key)) byGrade.set(key, []);
      byGrade.get(key)!.push(s);
    }
    return Array.from(byGrade.entries()).sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }, [students, query]);

  if (!getToken()) {
    return (
      <p>
        Please <Link className="underline" href={loginHref("/behavior/log")}>sign in</Link> to log incidents.
      </p>
    );
  }

  function toggleGrade(g: string) {
    setOpenGrades((prev) => {
      const next = new Set(prev);
      next.has(g) ? next.delete(g) : next.add(g);
      return next;
    });
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!student || !behaviorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ notice: NoticeResult }>("/incidents", {
        body: { studentId: student._id, behaviorIds: [behaviorId], detailText: note.trim() },
      });
      setNotice(res.notice);
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

        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="font-semibold">
              {student.preferredName || student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-slate-400">{[student.classGroup, gradeLabel(student.grade)].filter(Boolean).join(" · ")}</p>
          </div>
          <button type="button" onClick={() => setStudent(null)} className="text-sm text-slate-500 underline">change</button>
        </div>

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

  // ── Step 1: pick a student from collapsible grade groups ─────────────────────
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Log an incident</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Jump to a student by name…"
        className="w-full rounded-xl border border-slate-300 px-4 py-3"
        inputMode="search"
      />

      <div className="space-y-2">
        {groups.map(([key, list]) => {
          const open = query.trim() !== "" || openGrades.has(key);
          return (
            <div key={key} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <button
                onClick={() => toggleGrade(key)}
                className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold"
              >
                <span>{gradeLabel(key === "~" ? "" : key)}</span>
                <span className="text-sm font-normal text-slate-400">
                  {list.length} {open ? "▲" : "▼"}
                </span>
              </button>
              {open && (
                <ul className="divide-y divide-slate-100 border-t border-slate-100">
                  {list.map((s) => (
                    <li key={s._id}>
                      <button
                        onClick={() => setStudent(s)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                      >
                        <span className="font-medium">
                          {s.lastName}, {s.firstName}
                          {s.preferredName ? ` (${s.preferredName})` : ""}
                        </span>
                        <span className="text-sm text-slate-400">{s.classGroup}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {students.length === 0 && <p className="text-sm text-slate-400">No students yet — import a roster in Setup.</p>}
        {students.length > 0 && groups.length === 0 && <p className="text-sm text-slate-400">No matches.</p>}
      </div>
    </div>
  );
}
