"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { api, API_BASE, getToken, loginHref, type Me, type StudentSummary } from "../_lib/api";

const TYPES: { value: "homework" | "work" | "discussion"; label: string }[] = [
  { value: "homework", label: "Homework" },
  { value: "work", label: "Work (class time)" },
  { value: "discussion", label: "Formal Discussion" },
];
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label || t;
const fmtDate = (d: string | Date) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

type Assignment = { _id: string; classGroup: string; subject: string; type: string; description: string; denom: number; date: string };
type GScore = { assignmentId: string; studentId: string; score: number | null; manual?: boolean; messagedAt?: string | null; discussion?: { plus: number; minus: number; absent: boolean } };
type GStudent = { _id: string; name: string; lastName?: string; firstName?: string };

export default function HomeworkPage() {
  const [me, setMe] = useState<Me | null>(null);
  const [classes, setClasses] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api<Me>("/me").then(setMe).catch((e) => setErr(e.message));
    api<{ students: StudentSummary[] }>("/students")
      .then((d) => {
        const set = new Set<string>();
        for (const s of d.students || []) if ((s.classGroup || "").trim()) set.add(s.classGroup!.trim());
        setClasses(Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })));
      })
      .catch((e) => setErr(e.message));
  }, []);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/homework")}>sign in</Link>.</p>;
  if (err) return <p className="text-red-600">{err}</p>;

  const subjects: string[] = me?.config?.homework?.subjects || ["Math", "History", "Geography", "CE"];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Homework</h1>
        <p className="text-sm text-slate-400">Assignments, completion, formal discussions, averages, and outstanding-work reminders — per class.</p>
      </div>
      {classes.length === 0 && <p className="text-sm text-slate-400">No classes yet — import a roster in Setup.</p>}
      {classes.map((c) => (
        <ClassSection key={c} classGroup={c} subjects={subjects} onSubjectsChange={(s) => setMe((m) => (m ? { ...m, config: { ...m.config, homework: { ...m.config?.homework, subjects: s } } } : m))} />
      ))}
    </div>
  );
}

function ClassSection({ classGroup, subjects, onSubjectsChange }: { classGroup: string; subjects: string[]; onSubjectsChange: (s: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ assignments: Assignment[]; students: GStudent[]; scores: GScore[] } | null>(null);
  const [panel, setPanel] = useState<"" | "new" | "averages" | "outstanding">("");
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);
  const [discussion, setDiscussion] = useState<Assignment | null>(null);

  function load() {
    api<{ assignments: Assignment[]; students: GStudent[]; scores: GScore[] }>(`/homework/class/${encodeURIComponent(classGroup)}`)
      .then(setData)
      .catch(() => setData({ assignments: [], students: [], scores: [] }));
  }
  useEffect(() => { if (open && !data) load(); /* eslint-disable-next-line */ }, [open]);

  const scoreFor = (aId: string, sId: string) => data?.scores.find((x) => x.assignmentId === aId && x.studentId === sId);

  if (discussion && data) {
    return (
      <DiscussionTool
        assignment={discussion}
        students={data.students}
        initial={data.scores.filter((s) => s.assignmentId === discussion._id)}
        onClose={() => { setDiscussion(null); load(); }}
      />
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left font-semibold">
          <span className="text-slate-400">{open ? "▾" : "▸"}</span> {classGroup}
        </button>
        {open && (
          <div className="flex flex-wrap gap-1.5 text-xs">
            <button onClick={() => setPanel(panel === "new" ? "" : "new")} className="rounded-lg bg-slate-900 px-2.5 py-1 text-white">+ Assignment</button>
            <button onClick={() => setPanel(panel === "averages" ? "" : "averages")} className="rounded-lg border border-slate-300 px-2.5 py-1">Averages</button>
            <button onClick={() => setPanel(panel === "outstanding" ? "" : "outstanding")} className="rounded-lg border border-slate-300 px-2.5 py-1">Outstanding</button>
          </div>
        )}
      </div>

      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {panel === "new" && (
            <NewAssignment classGroup={classGroup} subjects={subjects} onSubjectsChange={onSubjectsChange}
              onCreated={() => { setPanel(""); load(); }} />
          )}
          {panel === "averages" && <AveragesPanel classGroup={classGroup} />}
          {panel === "outstanding" && <OutstandingPanel classGroup={classGroup} onPosted={load} />}
          {panel === "" && <ExportBar classGroup={classGroup} subjects={subjects} />}

          {!data ? (
            <p className="mt-3 text-sm text-slate-400">Loading…</p>
          ) : data.assignments.length === 0 ? (
            <p className="mt-3 text-sm text-slate-400">No assignments yet. Tap “+ Assignment”.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {data.assignments.map((a) => (
                <li key={a._id} className="py-2">
                  <button onClick={() => (a.type === "discussion" ? setDiscussion(a) : setOpenAssignment(openAssignment === a._id ? null : a._id))}
                    className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="text-sm">
                      <span className="font-medium">{a.subject || "—"}</span>
                      <span className="ml-2 text-slate-500">{a.description || typeLabel(a.type)}</span>
                    </span>
                    <span className="shrink-0 text-xs text-slate-400">
                      {typeLabel(a.type)} · {fmtDate(a.date)} · /{a.denom}{a.type === "discussion" ? " ▸" : openAssignment === a._id ? " ▾" : " ▸"}
                    </span>
                  </button>
                  {openAssignment === a._id && a.type !== "discussion" && (
                    <Grid assignment={a} students={data.students} scoreFor={scoreFor} onChanged={load} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

// Per-assignment student list: single tap = auto-score, double tap = edit.
function Grid({ assignment, students, scoreFor, onChanged }: { assignment: Assignment; students: GStudent[]; scoreFor: (a: string, s: string) => GScore | undefined; onChanged: () => void }) {
  const tapTimers = useRef<Record<string, any>>({});
  const [busy, setBusy] = useState("");

  async function autoScore(studentId: string) {
    setBusy(studentId);
    try { await api("/homework/score", { body: { assignmentId: assignment._id, studentId } }); onChanged(); }
    finally { setBusy(""); }
  }
  async function editScore(studentId: string, current: number | null) {
    const v = window.prompt(`Score out of ${assignment.denom}:`, current != null ? String(current) : "");
    if (v === null) return;
    const trimmed = v.trim();
    setBusy(studentId);
    try {
      if (trimmed === "") await api("/homework/score", { body: { assignmentId: assignment._id, studentId, clear: true } });
      else await api("/homework/score", { body: { assignmentId: assignment._id, studentId, score: Number(trimmed) } });
      onChanged();
    } finally { setBusy(""); }
  }
  function onTap(studentId: string, current: number | null) {
    const t = tapTimers.current;
    if (t[studentId]) { clearTimeout(t[studentId]); delete t[studentId]; editScore(studentId, current); }
    else { t[studentId] = setTimeout(() => { delete t[studentId]; autoScore(studentId); }, 280); }
  }

  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-2">
      <p className="mb-1 px-1 text-[11px] text-slate-400">Tap a student to mark complete (auto-scores by lateness). Double-tap to edit. Amber = messaged about.</p>
      <ul className="divide-y divide-slate-100">
        {students.map((s) => {
          const sc = scoreFor(assignment._id, s._id);
          const score = sc?.score ?? null;
          const messaged = !!sc?.messagedAt && score == null;
          return (
            <li key={s._id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-sm">{s.lastName}, {s.firstName}</span>
              <button
                onClick={() => onTap(s._id, score)}
                disabled={busy === s._id}
                className={`min-w-[3.5rem] rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  score != null ? "bg-green-100 text-green-800"
                  : messaged ? "bg-amber-100 text-amber-800"
                  : "border border-dashed border-slate-300 text-slate-400"}`}
              >
                {busy === s._id ? "…" : score != null ? `${score}/${assignment.denom}` : messaged ? "sent" : "tap"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NewAssignment({ classGroup, subjects, onSubjectsChange, onCreated }: { classGroup: string; subjects: string[]; onSubjectsChange: (s: string[]) => void; onCreated: () => void }) {
  const lastSubject = typeof window !== "undefined" ? localStorage.getItem("hw_subject") || subjects[0] || "" : subjects[0] || "";
  const lastType = (typeof window !== "undefined" ? localStorage.getItem("hw_type") : "") || "homework";
  const [subject, setSubject] = useState(lastSubject);
  const [type, setType] = useState(lastType);
  const [date, setDate] = useState(todayLocal());
  const [description, setDescription] = useState("");
  const [denom, setDenom] = useState(10);
  const [newSubject, setNewSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function addSubject() {
    const s = newSubject.trim();
    if (!s) return;
    try {
      const r = await api<{ subjects: string[] }>("/homework/subjects", { body: { subject: s } });
      onSubjectsChange(r.subjects);
      setSubject(s);
      setNewSubject("");
    } catch (e: any) { setErr(e.message); }
  }
  async function create() {
    setBusy(true); setErr("");
    try {
      await api("/homework/assignments", { body: { classGroup, subject, type, description, denom: Number(denom) || 10, date } });
      if (typeof window !== "undefined") { localStorage.setItem("hw_subject", subject); localStorage.setItem("hw_type", type); }
      onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
      {err && <p className="text-sm text-red-600">{err}</p>}
      <div className="flex flex-wrap gap-2">
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {subjects.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
        <label className="flex items-center gap-1 text-sm text-slate-600">/<input type="number" value={denom} onChange={(e) => setDenom(Number(e.target.value))} className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm" /></label>
      </div>
      <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder={type === "discussion" ? "Discussion topic" : "Description (e.g. p.42 #1–10)"} className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="add a subject…" className="w-40 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
        <button onClick={addSubject} disabled={!newSubject.trim()} className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-40">Add subject</button>
        <button onClick={create} disabled={busy} className="ml-auto rounded-lg bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-40">
          {busy ? "Creating…" : "Create assignment"}
        </button>
      </div>
    </div>
  );
}

function AveragesPanel({ classGroup }: { classGroup: string }) {
  const [rows, setRows] = useState<{ subject: string; type: string; average: number; count: number }[] | null>(null);
  useEffect(() => {
    api<{ averages: any[] }>(`/homework/averages/${encodeURIComponent(classGroup)}`).then((d) => setRows(d.averages || [])).catch(() => setRows([]));
  }, [classGroup]);
  if (!rows) return <p className="text-sm text-slate-400">Loading averages…</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">No scored work yet.</p>;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-1 text-sm font-medium text-slate-700">Class averages (out of 10)</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="py-1">Subject</th><th>Type</th><th className="text-right">Avg</th><th className="text-right">#</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-100">
              <td className="py-1">{r.subject}</td><td>{typeLabel(r.type)}</td>
              <td className="text-right font-semibold tabular-nums">{r.average}</td>
              <td className="text-right text-slate-400">{r.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutstandingPanel({ classGroup, onPosted }: { classGroup: string; onPosted: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  function load() {
    api<{ students: any[] }>(`/homework/outstanding/${encodeURIComponent(classGroup)}`).then((d) => setRows(d.students || [])).catch(() => setRows([]));
  }
  useEffect(load, [classGroup]);

  async function post(whole: boolean) {
    setBusy(true); setMsg("");
    try {
      const studentIds = Object.keys(picked).filter((k) => picked[k]);
      const r = await api<{ sent: any[]; skipped: any[] }>("/homework/outstanding/post", { body: { classGroup, whole, studentIds } });
      setMsg(`Sent ${r.sent.length}${r.skipped.length ? `, skipped ${r.skipped.length}` : ""}.`);
      setPicked({});
      load(); onPosted();
    } catch (e: any) { setMsg(`✗ ${e.message}`); } finally { setBusy(false); }
  }

  if (!rows) return <p className="text-sm text-slate-400">Loading outstanding…</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">Nobody is behind 🎉</p>;
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-slate-700">Outstanding work (current + previous term)</p>
      {msg && <p className={`mt-1 text-sm ${msg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{msg}</p>}
      <ul className="mt-2 divide-y divide-slate-100">
        {rows.map((s) => (
          <li key={s.studentId} className="py-1.5 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={!!picked[s.studentId]} onChange={(e) => setPicked((p) => ({ ...p, [s.studentId]: e.target.checked }))} />
              <span className="font-medium">{s.name}</span>
              <span className="text-xs text-slate-400">{s.items.length} item{s.items.length === 1 ? "" : "s"}{s.lastMessagedAt ? ` · messaged ${fmtDate(s.lastMessagedAt)}` : ""}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2">
        <button onClick={() => post(false)} disabled={busy || !Object.values(picked).some(Boolean)} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-40">Send to checked</button>
        <button onClick={() => post(true)} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-40">Send to whole class</button>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">Whole-class skips anyone messaged recently. Message says they’ve fallen behind and to show work in person; partial credit if shown within 7 days.</p>
    </div>
  );
}

function ExportBar({ classGroup, subjects }: { classGroup: string; subjects: string[] }) {
  const [subject, setSubject] = useState("");
  const [type, setType] = useState("");
  const [term, setTerm] = useState("");
  async function download() {
    const qs = new URLSearchParams({ classGroup });
    if (subject) qs.set("subject", subject);
    if (type) qs.set("type", type);
    if (term) qs.set("term", term);
    const res = await fetch(`${API_BASE}/api/behavior/homework/export?${qs}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `homework-${classGroup}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span>Export CSV:</span>
      <select value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1"><option value="">All subjects</option>{subjects.map((s) => <option key={s} value={s}>{s}</option>)}</select>
      <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1"><option value="">All types</option>{TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
      <select value={term} onChange={(e) => setTerm(e.target.value)} className="rounded border border-slate-300 px-1.5 py-1"><option value="">All terms</option><option value="0">Term 1</option><option value="1">Term 2</option><option value="2">Term 3</option></select>
      <button onClick={download} className="rounded-lg border border-slate-300 px-2.5 py-1">Download</button>
    </div>
  );
}

// ── Formal Discussion live scoring ───────────────────────────────────────────
function DiscussionTool({ assignment, students, initial, onClose }: { assignment: Assignment; students: GStudent[]; initial: GScore[]; onClose: () => void }) {
  type St = { plus: number; minus: number; absent: boolean; turns: number };
  const init: Record<string, St> = {};
  for (const s of students) {
    const got = initial.find((x) => x.studentId === s._id)?.discussion;
    init[s._id] = { plus: got?.plus || 0, minus: got?.minus || 0, absent: got?.absent || false, turns: (got?.plus || 0) + (got?.minus || 0) > 0 ? 1 : 0 };
  }
  const [state, setState] = useState<Record<string, St>>(init);
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const scoreOf = (st: St) => (st.absent ? null : st.plus > 0 ? Math.max(0, Math.min(10, Math.round((4 + st.plus - st.minus) * 10) / 10)) : null);
  const scores = students.map((s) => scoreOf(state[s._id]));
  const top = Math.max(0, ...scores.filter((x): x is number => x != null));

  function tick(studentId: string, delta: 1 | -1) {
    setState((prev) => {
      const st = { ...prev[studentId] };
      if (st.absent) return prev;
      // New turn if a different student now has the floor.
      if (current !== studentId) {
        const nonAbsent = students.filter((s) => !prev[s._id].absent);
        const everyoneSpoke = nonAbsent.every((s) => s._id === studentId || prev[s._id].turns > 0);
        if (st.turns >= 2 && !everyoneSpoke) {
          if (!window.confirm(`${nameOf(studentId)} would be speaking a 3rd time, but not everyone has spoken yet. Continue?`)) return prev;
        }
        st.turns += 1;
      }
      if (delta === 1) st.plus += 1; else st.minus += 1;
      return { ...prev, [studentId]: st };
    });
    setCurrent(studentId);
  }
  function toggleAbsent(studentId: string) {
    setState((prev) => ({ ...prev, [studentId]: { ...prev[studentId], absent: !prev[studentId].absent } }));
  }
  function nameOf(id: string) { const s = students.find((x) => x._id === id); return s ? `${s.firstName}` : "Student"; }

  async function save() {
    setBusy(true);
    try {
      const results = students.map((s) => ({ studentId: s._id, plus: state[s._id].plus, minus: state[s._id].minus, absent: state[s._id].absent }));
      await api(`/homework/discussion/${assignment._id}`, { body: { results } });
      setSaved(true);
      setTimeout(onClose, 600);
    } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border-2 border-indigo-300 bg-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold">Formal Discussion · {assignment.classGroup}</h2>
          <p className="text-xs text-slate-400">{assignment.subject} · {assignment.description || fmtDate(assignment.date)}</p>
        </div>
        <button onClick={onClose} className="text-sm text-slate-500 underline">close</button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Tap + / − as a student speaks (first + starts them at 5). Mark <span className="font-medium">A</span> for absent. The 3rd turn is blocked until everyone has spoken. Green = leading.</p>
      <ul className="mt-3 space-y-1.5">
        {students.map((s) => {
          const st = state[s._id];
          const sc = scoreOf(st);
          const leading = sc != null && sc === top && top > 0;
          return (
            <li key={s._id} className={`flex items-center justify-between gap-2 rounded-lg border p-2 ${leading ? "border-green-400 bg-green-50" : st.absent ? "border-slate-200 bg-slate-50 opacity-60" : current === s._id ? "border-indigo-300 bg-indigo-50" : "border-slate-200"}`}>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.lastName}, {s.firstName}{st.turns ? <span className="ml-1 text-[10px] text-slate-400">· {st.turns} turn{st.turns === 1 ? "" : "s"}</span> : null}</span>
              <span className="w-12 text-center text-sm font-bold tabular-nums">{st.absent ? "A" : sc != null ? sc : "—"}</span>
              <div className="flex shrink-0 gap-1">
                <button onClick={() => tick(s._id, -1)} disabled={st.absent} className="h-8 w-8 rounded-lg bg-red-100 font-bold text-red-700 disabled:opacity-30">−</button>
                <button onClick={() => tick(s._id, 1)} disabled={st.absent} className="h-8 w-8 rounded-lg bg-green-100 font-bold text-green-700 disabled:opacity-30">+</button>
                <button onClick={() => toggleAbsent(s._id)} className={`h-8 w-8 rounded-lg text-xs font-bold ${st.absent ? "bg-slate-700 text-white" : "border border-slate-300 text-slate-500"}`}>A</button>
              </div>
            </li>
          );
        })}
      </ul>
      <button onClick={save} disabled={busy} className="mt-3 w-full rounded-xl bg-indigo-600 px-4 py-2.5 font-semibold text-white disabled:opacity-40">
        {saved ? "Saved ✓" : busy ? "Saving…" : "Save scores"}
      </button>
    </section>
  );
}
