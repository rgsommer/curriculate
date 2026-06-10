"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type StudentSummary } from "../_lib/api";

function rowNameColor(count: number, trigger: number) {
  if (count >= trigger - 1) return "text-orange-600";
  if (count === trigger - 2) return "text-orange-400";
  return "";
}

export default function StudentsPage() {
  const [students, setStudents] = useState<StudentSummary[]>([]);
  const [trigger, setTrigger] = useState(3);
  const [query, setQuery] = useState("");
  const [cls, setCls] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!getToken()) return;
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        setStudents(d.students || []);
        if (d.triggerCount) setTrigger(d.triggerCount);
      })
      .catch((e) => setErr(e.message));
  }, []);

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if ((s.classGroup || "").trim()) set.add(s.classGroup!.trim());
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [students]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = students;
    if (q) list = list.filter((s) => `${s.firstName} ${s.lastName} ${s.preferredName || ""}`.toLowerCase().includes(q));
    else if (cls) list = list.filter((s) => (s.classGroup || "").trim() === cls);
    return [...list].sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
  }, [students, query, cls]);

  if (!getToken()) return <p>Please <Link className="underline" href={loginHref("/behavior/students")}>sign in</Link>.</p>;
  if (err) return <p className="text-red-600">{err}</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Students</h1>
        <p className="text-sm text-slate-400">Search any student and open their full history, strikes, and notices home.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {classes.map((c) => (
          <button key={c} onClick={() => { setQuery(""); setCls(cls === c ? "" : c); }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${cls === c && !query ? "bg-slate-900 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            {c}
          </button>
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search any student by name…"
        className="w-full rounded-xl border border-slate-300 px-4 py-3"
        inputMode="search"
      />

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.map((s) => (
          <li key={s._id}>
            <Link href={`/behavior/student/${s._id}`} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
              <span className={`font-medium ${rowNameColor(s.activeCount || 0, trigger)}`}>
                {s.lastName}, {s.firstName}{s.preferredName ? ` (${s.preferredName})` : ""}
                {s.activeCount ? <span className="ml-2 text-xs font-normal">({s.activeCount})</span> : null}
              </span>
              <span className="text-sm text-slate-400">{s.classGroup} →</span>
            </Link>
          </li>
        ))}
        {students.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">No students yet — import a roster in Setup.</li>}
        {students.length > 0 && visible.length === 0 && (
          <li className="px-4 py-3 text-sm text-slate-400">{query ? "No matches." : "Pick a class above, or search by name."}</li>
        )}
      </ul>
    </div>
  );
}
