"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Behavior, type StudentSummary } from "../_lib/api";

type NoticeResult = { _id: string; status: string; cancelUntil?: string; ccVp?: boolean } | null;

export default function LogIncidentPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StudentSummary[]>([]);
  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeResult>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the behaviour list once (standard + this teacher's custom ones).
  useEffect(() => {
    if (!getToken()) return;
    api<{ behaviors: Behavior[] }>("/behaviors")
      .then((d) => setBehaviors(d.behaviors || []))
      .catch((e) => setError(e.message));
  }, []);

  // Debounced student search.
  useEffect(() => {
    if (!getToken()) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!query.trim()) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(() => {
      api<{ students: StudentSummary[] }>(`/students?query=${encodeURIComponent(query.trim())}`)
        .then((d) => setResults(d.students || []))
        .catch((e) => setError(e.message));
    }, 250);
  }, [query]);

  if (!getToken()) {
    return (
      <p>
        Please <Link className="underline" href={loginHref("/behavior/log")}>sign in</Link> to log incidents.
      </p>
    );
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function submit() {
    if (!student || selected.size === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ notice: NoticeResult }>("/incidents", {
        body: { studentId: student._id, behaviorIds: Array.from(selected), detailText: detail.trim() },
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
    setSelected(new Set());
    setDetail("");
    setNotice(null);
    setDone(false);
    setQuery("");
    setResults([]);
  }

  // ── Confirmation screen ────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h1 className="text-lg font-semibold text-green-800">Logged ✓</h1>
          <p className="mt-1 text-sm text-green-700">
            {selected.size} incident{selected.size > 1 ? "s" : ""} recorded for{" "}
            {student?.preferredName || student?.firstName} {student?.lastName}.
          </p>
        </div>

        {notice && notice.status !== "cancelled" && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">Notice home triggered</h2>
            <p className="mt-1 text-sm text-amber-800">
              A parent notice was composed and is queued to send
              {notice.ccVp ? " (VP CC&apos;d)" : ""}. You can cancel it during the brief send window.
            </p>
            <div className="mt-3 flex gap-2">
              <button onClick={cancelNotice} className="rounded-lg bg-amber-600 px-4 py-2 text-white">
                Cancel send
              </button>
              {student && (
                <Link
                  href={`/behavior/student/${student._id}`}
                  className="rounded-lg border border-amber-400 px-4 py-2 text-amber-900"
                >
                  View notice
                </Link>
              )}
            </div>
          </div>
        )}

        {notice && notice.status === "cancelled" && (
          <p className="text-sm text-slate-500">Notice cancelled — it will not be sent.</p>
        )}

        <button onClick={reset} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-white">
          Log another
        </button>
      </div>
    );
  }

  // ── Logging flow ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Log an incident</h1>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Step 1: pick a student (any student in the school). */}
      {!student ? (
        <div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any student by name…"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
            inputMode="search"
          />
          <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
            {results.map((s) => (
              <li key={s._id}>
                <button
                  onClick={() => setStudent(s)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="font-medium">
                    {s.lastName}, {s.firstName}
                    {s.preferredName ? ` (${s.preferredName})` : ""}
                  </span>
                  <span className="text-sm text-slate-400">
                    {[s.classGroup, s.grade].filter(Boolean).join(" · ")}
                  </span>
                </button>
              </li>
            ))}
            {query && results.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-400">No matches</li>
            )}
          </ul>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <p className="font-semibold">
              {student.preferredName || student.firstName} {student.lastName}
            </p>
            <p className="text-sm text-slate-400">
              {[student.classGroup, student.grade].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button onClick={() => setStudent(null)} className="text-sm text-slate-500 underline">
            change
          </button>
        </div>
      )}

      {/* Step 2: pick behaviour(s). */}
      {student && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {behaviors.map((b) => {
              const on = selected.has(b._id);
              return (
                <button
                  key={b._id}
                  onClick={() => toggle(b._id)}
                  className={`rounded-xl border px-4 py-3 text-left transition ${
                    on ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white"
                  }`}
                >
                  <span className="font-medium">{b.name}</span>
                  {b.triggerMode === "IMMEDIATE" && (
                    <span className={`ml-2 text-xs ${on ? "text-amber-300" : "text-amber-600"}`}>
                      immediate
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <textarea
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Optional detail…"
            rows={2}
            className="w-full rounded-xl border border-slate-300 px-4 py-3"
          />

          <button
            onClick={submit}
            disabled={selected.size === 0 || submitting}
            className="w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-40"
          >
            {submitting ? "Submitting…" : `Submit ${selected.size || ""} incident${selected.size === 1 ? "" : "s"}`}
          </button>
        </>
      )}
    </div>
  );
}
