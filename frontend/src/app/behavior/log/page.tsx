"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Behavior, type StudentSummary, type GuddStatus } from "../_lib/api";
import SendNoticeModal from "../_components/SendNoticeModal";
import GuddChip from "../_components/GuddChip";

type NoticeResult = { _id: string; status: string; cancelUntil?: string; ccVp?: boolean; renderedText?: string; reason?: string; autoDispatch?: boolean } | null;

// A behaviour's kind, with a legacy fallback to its points sign.
function kindOf(b: any): "negative" | "positive" {
  if (b?.kind === "positive" || b?.kind === "negative") return b.kind;
  return (b?.points || 0) > 0 ? "positive" : "negative";
}

function gradeLabel(g?: string) {
  const v = (g || "").trim();
  return v ? `Grade ${v}` : "";
}

// Current local time formatted for a <input type="datetime-local"> value.
function nowLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "Jun 7, 11:47 am" style date+time.
function fmtDateTime(d: string | number | Date) {
  return new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Count colour: red at/over trigger, orange when the next incident will trigger.
function countColor(count: number, trigger: number) {
  if (count >= trigger) return "text-red-600";
  if (count === trigger - 1) return "text-orange-500";
  return "text-slate-500";
}
// Student-list name colour: orange at threshold, lighter one fewer.
function rowNameColor(count: number, trigger: number) {
  if (count >= trigger - 1) return "text-orange-600";
  if (count === trigger - 2) return "text-orange-400";
  return "";
}

// ── Recently-used behaviours (per device) ────────────────────────────────────
// Ordering the picker by what this teacher actually reaches for makes entry
// faster. Stored locally (no backend needed); most-recent id first, capped.
const RECENT_BEHAVIORS_KEY = "behavior_recent_behaviors_v1";
function loadRecentBehaviors(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_BEHAVIORS_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function recordRecentBehaviors(ids: string[]): string[] {
  const clean = ids.filter(Boolean);
  const next = [...clean, ...loadRecentBehaviors().filter((x) => !clean.includes(x))].slice(0, 50);
  try {
    localStorage.setItem(RECENT_BEHAVIORS_KEY, JSON.stringify(next));
  } catch {
    /* private mode / storage off — ordering just falls back to alphabetical */
  }
  return next;
}
function useRecentBehaviors() {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => { setRecent(loadRecentBehaviors()); }, []);
  const record = (ids: string[]) => setRecent(recordRecentBehaviors(ids));
  // behaviorId -> rank (0 = most recent).
  const rank = useMemo(() => {
    const m = new Map<string, number>();
    recent.forEach((id, i) => { if (!m.has(id)) m.set(id, i); });
    return m;
  }, [recent]);
  return { rank, record };
}

export default function LogIncidentPage() {
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [mode, setMode] = useState<"single" | "batch">("single");
  const [query, setQuery] = useState("");
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [rosterTrigger, setRosterTrigger] = useState(3);

  const { rank: recentRank, record: recordRecent } = useRecentBehaviors();
  const [student, setStudent] = useState<StudentSummary | null>(null);
  const [behaviorId, setBehaviorId] = useState("");
  const [kindFilter, setKindFilter] = useState<"negative" | "positive">("negative");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [occurredAt, setOccurredAt] = useState("");
  const [note, setNote] = useState("");
  const [sendImmediately, setSendImmediately] = useState(false);
  const [requestMeeting, setRequestMeeting] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [includeEvidence, setIncludeEvidence] = useState(false);

  const [status, setStatus] = useState<{ activeCount: number; triggerCount: number; incidents: any[]; gudd?: GuddStatus | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<NoticeResult>(null);
  const [showSendModal, setShowSendModal] = useState(false);
  const [sending, setSending] = useState(false);
  const [positiveNotice, setPositiveNotice] = useState<{ _id: string; status: string } | null>(null);
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [undone, setUndone] = useState(false);
  const [trigger, setTrigger] = useState<{ date: string; teacher: string; offense: string; comment: string }[]>([]);
  const [triggerCount, setTriggerCount] = useState(3);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tapping "Log" in the nav while already here returns to the student picker.
  useEffect(() => {
    const onReset = () => reset();
    window.addEventListener("behavior:log-reset", onReset);
    return () => window.removeEventListener("behavior:log-reset", onReset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        setStudents(d.students || []);
        if (d.triggerCount) setRosterTrigger(d.triggerCount);
      })
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
    setOccurredAt(nowLocal()); // default the event time to now; teacher can adjust
    api<{ activeCount: number; triggerCount: number; incidents: any[]; gudd?: GuddStatus | null }>(`/students/${student._id}`)
      .then((d) => setStatus({ activeCount: d.activeCount, triggerCount: d.triggerCount, incidents: d.incidents || [], gudd: d.gudd || null }))
      .catch(() => setStatus(null));
  }, [student]);

  // Behaviours of the chosen kind (positive vs negative). Legacy rows without an
  // explicit kind fall back to their points sign.
  const inKind = useMemo(
    () => behaviors.filter((b) => (kindOf(b)) === kindFilter),
    [behaviors, kindFilter]
  );
  // Distinct keywords (offense categories) for the chip row + the filtered,
  // Interaction-first sorted offense options.
  // Keyword chips: those used most recently on this device first (ranked by the
  // most-recent behaviour carrying that keyword), then the rest alphabetically.
  const keywords = useMemo(() => {
    const kws = Array.from(new Set(inKind.map((b) => b.keyword).filter((k): k is string => !!k)));
    const kwRank = new Map<string, number>();
    for (const b of inKind) {
      if (!b.keyword) continue;
      const r = recentRank.get(b._id);
      if (r === undefined) continue;
      const prev = kwRank.get(b.keyword);
      if (prev === undefined || r < prev) kwRank.set(b.keyword, r);
    }
    return kws.sort((a, b) => {
      const ra = kwRank.get(a), rb = kwRank.get(b);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.localeCompare(b);
    });
  }, [inKind, recentRank]);
  // Dropdown options: recently-used first, otherwise interactions then alpha.
  const offenseOptions = useMemo(
    () =>
      [...inKind]
        .filter((b) => !keywordFilter || b.keyword === keywordFilter)
        .sort((a, b) => {
          const ra = recentRank.get(a._id), rb = recentRank.get(b._id);
          if (ra !== undefined && rb !== undefined) return ra - rb;
          if (ra !== undefined) return -1;
          if (rb !== undefined) return 1;
          const ai = a.triggerMode === "INTERACTION" ? 0 : 1;
          const bi = b.triggerMode === "INTERACTION" ? 0 : 1;
          if (ai !== bi) return ai - bi;
          return String(a.keyword || a.name).toLowerCase().localeCompare(String(b.keyword || b.name).toLowerCase());
        }),
    [inKind, keywordFilter, recentRank]
  );

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

  // Reverse flow: one behaviour → several students at once.
  if (mode === "batch") {
    return <BatchLog students={students} behaviors={behaviors} rosterTrigger={rosterTrigger} onExit={() => setMode("single")} />;
  }

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!student || !behaviorId) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<{ notice: NoticeResult; positiveNotice: { _id: string; status: string } | null; incidents?: { _id: string }[]; triggerIncidents: any[]; triggerCount: number }>("/incidents", {
        body: {
          studentId: student._id,
          behaviorIds: [behaviorId],
          detailText: note.trim(),
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          sendImmediately,
        },
      });
      recordRecent([behaviorId]); // bubble this behaviour to the top of the picker
      setNotice(res.notice);
      setPositiveNotice(res.positiveNotice || null);
      setCreatedIds((res.incidents || []).map((i) => i._id));
      setTrigger(res.triggerIncidents || []);
      setTriggerCount(res.triggerCount || 3);

      // Upload any photo/video evidence to the incident just created.
      const incId = res.incidents?.[0]?._id;
      if (incId && mediaFiles.length) {
        setUploadingMedia(true);
        try {
          const fd = new FormData();
          for (const f of mediaFiles) fd.append("files", f);
          await api(`/incidents/${incId}/attachments`, { body: fd });
        } catch (e: any) {
          setError(`Incident logged, but evidence upload failed: ${e.message}`);
        } finally {
          setUploadingMedia(false);
        }
      }
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  function onPickMedia(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    if (picked.length) setMediaFiles((prev) => [...prev, ...picked].slice(0, 5));
    e.target.value = ""; // let the same file be re-picked
  }
  function removeMedia(idx: number) {
    setMediaFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function undo() {
    try {
      // Cancel any queued notice first, then delete the incident(s).
      if (notice?._id && notice.status === "queued") await api(`/notices/${notice._id}/cancel`, { body: {} }).catch(() => {});
      if (positiveNotice?._id) await api(`/notices/${positiveNotice._id}/cancel`, { body: {} }).catch(() => {});
      for (const id of createdIds) await api(`/incidents/${id}`, { method: "DELETE" });
      setUndone(true);
    } catch (e: any) {
      setError(e.message);
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

  async function sendNow() {
    if (!notice) return;
    setSending(true);
    try {
      await api(`/notices/${notice._id}/send`, { body: { requestMeeting, includeEvidence } });
      setNotice({ ...notice, status: "sent" });
      setShowSendModal(false);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function reset() {
    setStudent(null);
    setBehaviorId("");
    setKeywordFilter("");
    setOccurredAt("");
    setNote("");
    setSendImmediately(false);
    setRequestMeeting(false);
    setMediaFiles([]);
    setKindFilter("negative");
    setNotice(null);
    setPositiveNotice(null);
    setTrigger([]);
    setCreatedIds([]);
    setUndone(false);
    setDone(false);
    setQuery("");
    setSelectedClass("");
    setMode("single");
  }

  // ── Confirmation ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="space-y-4">
        <div className={`rounded-xl border p-5 ${undone ? "border-slate-200 bg-slate-50" : "border-green-200 bg-green-50"}`}>
          <div className="flex items-center justify-between gap-2">
            <h1 className={`text-lg font-semibold ${undone ? "text-slate-700" : "text-green-800"}`}>{undone ? "Undone" : "Logged ✓"}</h1>
            {!undone && createdIds.length > 0 && (
              <button onClick={undo} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">Undo</button>
            )}
          </div>
          <p className={`mt-1 text-sm ${undone ? "text-slate-500" : "text-green-700"}`}>
            {undone
              ? "The incident was removed (and any queued notice cancelled)."
              : <>Recorded for {student?.preferredName || student?.firstName} {student?.lastName}.</>}
          </p>
        </div>

        {trigger.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-semibold">
                {notice ? "Incidents in this notice" : "Strikes so far (all teachers)"}
              </h2>
              <span className={`text-sm font-medium ${notice ? "text-slate-400" : countColor(trigger.length, triggerCount)}`}>
                {trigger.length}
                {!notice && ` / ${triggerCount}`}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-slate-100">
              {trigger.map((t, i) => (
                <li key={i} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{t.offense}</span>
                    <span className="text-slate-400">{fmtDateTime(t.date)}</span>
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
        {positiveNotice && (
          <div className="rounded-xl border border-green-300 bg-green-50 p-5">
            <h2 className="font-semibold text-green-900">Good-news note home queued 🎉</h2>
            <p className="mt-1 text-sm text-green-800">
              {student?.preferredName || student?.firstName} reached enough positive recognitions — a celebratory note to
              their parents is queued (no concerns, no points mentioned). It sends automatically after a short window.
            </p>
            {student && (
              <Link href={`/behavior/student/${student._id}`} className="mt-3 inline-block rounded-lg border border-green-400 px-4 py-2 text-green-900">
                Review / edit
              </Link>
            )}
          </div>
        )}
        {notice && (
          <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">
              {notice.status === "sent" ? "Notice home sent ✓"
                : notice.status === "cancelled" ? "Not sent — strikes kept"
                : `${student?.preferredName || student?.firstName} reached ${trigger.length} strike${trigger.length === 1 ? "" : "s"} — send a notice home?`}
            </h2>
            {notice.status === "queued" && (
              <>
                <p className="mt-1 text-sm text-amber-800">
                  Nothing has been sent. This goes to the parent{notice.ccVp ? " (VP CC’d)" : ""} <span className="font-semibold">only if you choose “Send to parent”</span>.
                  Choose <span className="font-semibold">Not this time</span> and nothing is sent — the strikes stay, so it&apos;ll come up again on the next incident (unless one fades past the window).
                </p>
                {notice.renderedText && (
                  <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-amber-200 bg-white p-3 font-sans text-sm text-slate-700">{notice.renderedText}</pre>
                )}
                <label className="mt-3 flex items-center gap-2 text-sm text-amber-900">
                  <input type="checkbox" checked={requestMeeting} onChange={(e) => setRequestMeeting(e.target.checked)} />
                  Also request a meeting with the parents
                </label>
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {notice.status === "queued" && (
                <>
                  <button onClick={() => setShowSendModal(true)} className="rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white">Send to parent</button>
                  <button onClick={cancelNotice} className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-amber-900">Not this time</button>
                  {student && (
                    <Link href={`/behavior/student/${student._id}`} className="rounded-lg border border-amber-400 bg-white px-4 py-2 text-amber-900">Review / edit first</Link>
                  )}
                </>
              )}
              {notice.status !== "queued" && student && (
                <Link href={`/behavior/student/${student._id}`} className="rounded-lg border border-amber-400 px-4 py-2 text-amber-900">View student</Link>
              )}
            </div>
          </div>
        )}
        <button onClick={reset} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-white">Log another</button>

        <SendNoticeModal
          open={showSendModal}
          studentName={student?.preferredName || student?.firstName}
          channelLabel="Edsby"
          noteText={notice?.renderedText || ""}
          requestMeeting={requestMeeting}
          onToggleMeeting={setRequestMeeting}
          evidenceCount={mediaFiles.length}
          includeEvidence={includeEvidence}
          onToggleEvidence={setIncludeEvidence}
          busy={sending}
          onConfirm={sendNow}
          onClose={() => setShowSendModal(false)}
        />
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

        {/* Recent events (all kinds) + strike count for context while logging */}
        {status && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-amber-900">Recent events (all teachers)</h2>
              <span className={`text-sm font-semibold ${countColor(status.activeCount, status.triggerCount)}`}>
                {status.activeCount} / {status.triggerCount} strikes
              </span>
            </div>
            {status.gudd?.enabled && (status.gudd.count > 0 || status.gudd.lost) && (
              <div className="mt-2">
                <GuddChip name={status.gudd.name} count={status.gudd.count} threshold={status.gudd.threshold} consequence={status.gudd.consequence} />
              </div>
            )}
            {status.incidents.length > 0 ? (
              <ul className="mt-2 divide-y divide-amber-100">
                {status.incidents.slice(0, 5).map((i, idx) => (
                  <li key={idx} className="py-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900">{i.behaviorSnapshot?.name}</span>
                      <span className="text-slate-500">{fmtDateTime(i.timestamp)}</span>
                    </div>
                    <div className="text-slate-700">
                      {i.teacherName || "—"}
                      {i.detailText ? ` · ${i.detailText}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-slate-500">No recent events.</p>
            )}
          </div>
        )}

        {/* Positive or negative first — then the list filters to that kind. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setKindFilter("negative"); setBehaviorId(""); setKeywordFilter(""); }}
            className={`rounded-xl border px-4 py-3 text-base font-semibold ${kindFilter === "negative" ? "border-red-600 bg-red-600 text-white" : "border-red-200 bg-white text-red-600"}`}
          >
            ✕ Negative
          </button>
          <button
            type="button"
            onClick={() => { setKindFilter("positive"); setBehaviorId(""); setKeywordFilter(""); }}
            className={`rounded-xl border px-4 py-3 text-base font-semibold ${kindFilter === "positive" ? "border-green-600 bg-green-600 text-white" : "border-green-200 bg-white text-green-600"}`}
          >
            ✓ Positive
          </button>
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-slate-600">{kindFilter === "positive" ? "Positive behaviour" : "Behaviour"}</span>
          {/* Keyword chips to narrow the list quickly (like the class chips). */}
          {keywords.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setKeywordFilter("")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${keywordFilter === "" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
                All
              </button>
              {keywords.map((k) => (
                <button key={k} type="button" onClick={() => { setKeywordFilter(k); setBehaviorId(""); }}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${keywordFilter === k ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>
                  {k}
                </button>
              ))}
            </div>
          )}
          <select
            autoFocus
            value={behaviorId}
            onChange={(e) => setBehaviorId(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg"
          >
            <option value="">{kindFilter === "positive" ? "Choose a positive behaviour…" : "Choose a behaviour…"}</option>
            {offenseOptions.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
                {kindFilter === "negative" && (b.triggerMode === "IMMEDIATE" ? " — immediate" : b.triggerMode === "INTERACTION" ? " — interaction (no note)" : "")}
              </option>
            ))}
          </select>
          {offenseOptions.length === 0 && (
            <p className="mt-1 text-xs text-slate-400">
              No {kindFilter} behaviours yet — <Link href="/behavior/behaviours" className="underline">add one</Link>.
            </p>
          )}
        </div>
        <Link href="/behavior/behaviours" className="text-xs text-slate-400 underline">manage behaviours</Link>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-600">Date &amp; time of incident</span>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-4 py-3"
          />
        </label>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional note…"
          rows={2}
          className="w-full rounded-xl border border-slate-300 px-4 py-3"
        />

        {/* Photo / video evidence (camera or library) */}
        <div>
          <span className="mb-1 block text-sm font-medium text-slate-600">Photo / video evidence (optional)</span>
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700">
              📷 Take photo / video
              <input type="file" accept="image/*,video/*" capture="environment" className="hidden" onChange={onPickMedia} />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-700">
              🖼 From library
              <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={onPickMedia} />
            </label>
          </div>
          {mediaFiles.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {mediaFiles.map((f, idx) => {
                const url = URL.createObjectURL(f);
                const isVideo = f.type.startsWith("video/");
                return (
                  <div key={idx} className="relative h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                    {isVideo ? (
                      <video src={url} className="h-full w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    )}
                    <button type="button" onClick={() => removeMedia(idx)}
                      className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center bg-black/60 text-xs text-white">✕</button>
                    {isVideo && <span className="absolute bottom-0 left-0 bg-black/60 px-1 text-[10px] text-white">video</span>}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-1 text-xs text-slate-400">Stored privately for the student record — never sent to parents. Up to 5 files, 30 MB each.</p>
        </div>

        {kindFilter === "negative" && (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={sendImmediately} onChange={(e) => setSendImmediately(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Prepare a notice now — don&apos;t wait for the strike count</span> — bundles this offence with
              any strikes already in the queue and drafts the note now, instead of waiting for the threshold. You still review and press Send,
              and it goes out only through your normal delivery settings — never automatically to a parent.
            </span>
          </label>
        )}
        {kindFilter === "positive" && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            Positive behaviours earn house points and are documented — they never count as a strike. Enough of them sends a good-news note home.
          </p>
        )}

        <button
          type="submit"
          disabled={!behaviorId || submitting}
          className={`w-full rounded-xl px-4 py-4 text-lg font-semibold text-white disabled:opacity-40 ${kindFilter === "positive" ? "bg-green-700" : "bg-slate-900"}`}
        >
          {uploadingMedia ? "Uploading evidence…" : submitting ? "Submitting…" : kindFilter === "positive" ? "Log positive" : "Submit"}
        </button>
      </form>
    );
  }

  // ── Step 1: pick a class (button row), then a student ────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Log an incident</h1>
        <button
          onClick={() => setMode("batch")}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600"
        >
          Several students →
        </button>
      </div>
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
              <span className={`font-medium ${rowNameColor(s.activeCount || 0, rosterTrigger)}`}>
                {s.lastName}, {s.firstName}
                {s.preferredName ? ` (${s.preferredName})` : ""}
                {s.activeCount ? <span className="ml-2 text-xs font-normal">({s.activeCount})</span> : null}
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

// Reverse flow: choose ONE behaviour, then tap several students (e.g. "not
// ready for class — these 5"). Each gets its own incident + trigger evaluation.
function BatchLog({
  students,
  behaviors,
  rosterTrigger,
  onExit,
}: {
  students: StudentSummary[];
  behaviors: Behavior[];
  rosterTrigger: number;
  onExit: () => void;
}) {
  const [behaviorId, setBehaviorId] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [selectedClass, setSelectedClass] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [occurredAt, setOccurredAt] = useState(nowLocal());
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ logged: number; behaviorName: string; results: any[] } | null>(null);
  const { rank: recentRank, record: recordRecent } = useRecentBehaviors();

  const keywords = useMemo(() => {
    const kws = Array.from(new Set(behaviors.map((b) => b.keyword).filter((k): k is string => !!k)));
    const kwRank = new Map<string, number>();
    for (const b of behaviors) {
      if (!b.keyword) continue;
      const r = recentRank.get(b._id);
      if (r === undefined) continue;
      const prev = kwRank.get(b.keyword);
      if (prev === undefined || r < prev) kwRank.set(b.keyword, r);
    }
    return kws.sort((a, b) => {
      const ra = kwRank.get(a), rb = kwRank.get(b);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.localeCompare(b);
    });
  }, [behaviors, recentRank]);
  const offenseOptions = useMemo(
    () =>
      [...behaviors]
        .filter((b) => !keywordFilter || b.keyword === keywordFilter)
        .sort((a, b) => {
          const ra = recentRank.get(a._id), rb = recentRank.get(b._id);
          if (ra !== undefined && rb !== undefined) return ra - rb;
          if (ra !== undefined) return -1;
          if (rb !== undefined) return 1;
          const ai = a.triggerMode === "INTERACTION" ? 0 : 1;
          const bi = b.triggerMode === "INTERACTION" ? 0 : 1;
          if (ai !== bi) return ai - bi;
          return String(a.keyword || a.name).toLowerCase().localeCompare(String(b.keyword || b.name).toLowerCase());
        }),
    [behaviors, keywordFilter, recentRank]
  );
  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if ((s.classGroup || "").trim()) set.add(s.classGroup!.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return students.filter((s) => `${s.firstName} ${s.lastName} ${s.preferredName || ""}`.toLowerCase().includes(q));
    if (selectedClass) return students.filter((s) => (s.classGroup || "").trim() === selectedClass);
    return [];
  }, [students, query, selectedClass]);

  const pickedIds = Object.keys(picked).filter((id) => picked[id]);
  const pickedStudents = students.filter((s) => picked[s._id]);
  const behavior = behaviors.find((b) => b._id === behaviorId);

  function toggle(id: string) {
    setPicked((p) => ({ ...p, [id]: !p[id] }));
  }

  async function submit() {
    if (!behaviorId || pickedIds.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api<{ logged: number; behaviorName: string; results: any[] }>("/incidents/batch", {
        body: {
          behaviorId,
          studentIds: pickedIds,
          detailText: note.trim(),
          occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        },
      });
      recordRecent([behaviorId]); // bubble this behaviour to the top of the picker
      setResult(r);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Confirmation ─────────────────────────────────────────────────────────
  if (result) {
    const notified = result.results.filter((r) => r.notice);
    const celebrated = result.results.filter((r) => r.positiveNotice);
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-5">
          <h1 className="text-lg font-semibold text-green-800">Logged for {result.logged} {result.logged === 1 ? "student" : "students"} ✓</h1>
          <p className="mt-1 text-sm text-green-700">{result.behaviorName}</p>
        </div>
        {celebrated.length > 0 && (
          <div className="rounded-xl border border-green-300 bg-green-50 p-5">
            <h2 className="font-semibold text-green-900">{celebrated.length} earned a good-news note home 🎉</h2>
            <p className="mt-1 text-sm text-green-800">Enough positives accumulated — a celebratory note is queued for each.</p>
            <ul className="mt-2 space-y-1">
              {celebrated.map((r) => (
                <li key={r.studentId} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-green-900">{r.name}</span>
                  <Link href={`/behavior/student/${r.studentId}`} className="rounded-lg border border-green-400 px-3 py-1 text-green-900">Review / send</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {notified.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-5">
            <h2 className="font-semibold text-amber-900">{notified.length} reached the threshold</h2>
            <p className="mt-1 text-sm text-amber-800">Nothing has been sent — a notice is ready for each. Open each student to send it, or leave it and their strikes stay.</p>
            <ul className="mt-2 space-y-1">
              {notified.map((r) => (
                <li key={r.studentId} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-amber-900">{r.name}{r.notice.ccVp ? " (VP CC’d)" : ""}</span>
                  <Link href={`/behavior/student/${r.studentId}`} className="rounded-lg border border-amber-400 px-3 py-1 text-amber-900">Review / send</Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button onClick={onExit} className="w-full rounded-xl bg-slate-900 px-4 py-3 text-white">Done</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Log for several students</h1>
        <button onClick={onExit} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600">← single</button>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {/* Step 1: the behaviour */}
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-600">1. Choose the behaviour</span>
        {keywords.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setKeywordFilter("")}
              className={`rounded-full px-3 py-1 text-xs font-medium ${keywordFilter === "" ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>All</button>
            {keywords.map((k) => (
              <button key={k} type="button" onClick={() => { setKeywordFilter(k); setBehaviorId(""); }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${keywordFilter === k ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-600"}`}>{k}</button>
            ))}
          </div>
        )}
        <select value={behaviorId} onChange={(e) => setBehaviorId(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3 text-lg">
          <option value="">Choose an incident…</option>
          {offenseOptions.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
              {b.triggerMode === "IMMEDIATE" ? " — immediate" : b.triggerMode === "INTERACTION" ? " — interaction (no note)" : ""}
            </option>
          ))}
        </select>
        {behavior?.triggerMode === "IMMEDIATE" && (
          <p className="mt-1 text-xs text-amber-600">Heads up: this behaviour notifies home immediately — a notice will be queued for every student you select.</p>
        )}
      </div>

      {/* Step 2: the students */}
      <div>
        <span className="mb-1 block text-sm font-medium text-slate-600">
          2. Tap the students {pickedIds.length > 0 && <span className="text-slate-400">· {pickedIds.length} selected</span>}
        </span>
        <div className="mb-2 flex flex-wrap gap-2">
          {classes.map((c) => (
            <button key={c} onClick={() => { setQuery(""); setSelectedClass(selectedClass === c ? "" : c); }}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${selectedClass === c && !query ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{c}</button>
          ))}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="…or search any student by name"
          className="w-full rounded-xl border border-slate-300 px-4 py-3" inputMode="search" />

        {pickedStudents.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {pickedStudents.map((s) => (
              <button key={s._id} onClick={() => toggle(s._id)}
                className="rounded-full bg-slate-900 px-3 py-1 text-xs font-medium text-white">
                {s.firstName} {s.lastName} ✕
              </button>
            ))}
          </div>
        )}

        <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {visible.map((s) => (
            <li key={s._id}>
              <button onClick={() => toggle(s._id)} className={`flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50 ${picked[s._id] ? "bg-slate-50" : ""}`}>
                <span className={`flex items-center gap-2 font-medium ${rowNameColor(s.activeCount || 0, rosterTrigger)}`}>
                  <span className={`flex h-5 w-5 items-center justify-center rounded border text-xs ${picked[s._id] ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>{picked[s._id] ? "✓" : ""}</span>
                  {s.lastName}, {s.firstName}{s.preferredName ? ` (${s.preferredName})` : ""}
                  {s.activeCount ? <span className="text-xs font-normal">({s.activeCount})</span> : null}
                </span>
                <span className="text-sm text-slate-400">{s.classGroup}</span>
              </button>
            </li>
          ))}
          {visible.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">Pick a class above, or search by name.</li>}
        </ul>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-600">Date &amp; time</span>
        <input type="datetime-local" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="w-full rounded-xl border border-slate-300 px-4 py-3" />
      </label>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note (applied to all)…" rows={2} className="w-full rounded-xl border border-slate-300 px-4 py-3" />

      <button onClick={submit} disabled={!behaviorId || pickedIds.length === 0 || submitting}
        className="w-full rounded-xl bg-slate-900 px-4 py-4 text-lg font-semibold text-white disabled:opacity-40">
        {submitting ? "Logging…" : `Log for ${pickedIds.length || ""} ${pickedIds.length === 1 ? "student" : "students"}`.trim()}
      </button>
    </div>
  );
}
