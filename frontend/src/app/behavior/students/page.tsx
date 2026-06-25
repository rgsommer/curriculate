"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type StudentSummary, type Me } from "../_lib/api";

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [houses, setHouses] = useState<{ _id: string; name: string; color?: string }[]>([]);
  const [housesOn, setHousesOn] = useState(false);

  useEffect(() => {
    if (!getToken()) return;
    api<{ students: StudentSummary[]; triggerCount: number }>("/students")
      .then((d) => {
        setStudents(d.students || []);
        if (d.triggerCount) setTrigger(d.triggerCount);
      })
      .catch((e) => setErr(e.message));
    api<Me>("/me").then((d) => setIsAdmin(d.membership?.role === "originator" || d.membership?.role === "admin")).catch(() => {});
    api<{ enabled: boolean; houses: any[] }>("/houses").then((d) => { setHousesOn(!!d.enabled); setHouses(d.houses || []); }).catch(() => {});
  }, []);

  // Optimistic per-student update (flags, house, room). Reverts on failure.
  async function patchStudent(s: StudentSummary, body: Partial<StudentSummary>) {
    const prev = s;
    setStudents((list) => list.map((x) => (x._id === s._id ? { ...x, ...body } : x)));
    try { await api(`/students/${s._id}`, { method: "PATCH", body }); }
    catch (e: any) { setErr(e.message); setStudents((list) => list.map((x) => (x._id === s._id ? prev : x))); }
  }
  const houseName = (id?: string | null) => houses.find((h) => h._id === String(id))?.name || "";
  const houseColor = (id?: string | null) => houses.find((h) => h._id === String(id))?.color || "#94a3b8";

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
          <li key={s._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 hover:bg-slate-50">
            <Link href={`/behavior/student/${s._id}`} className="flex min-w-0 flex-1 basis-48 items-center justify-between gap-2">
              <span className={`truncate font-medium ${rowNameColor(s.activeCount || 0, trigger)}`}>
                {s.lastName}, {s.firstName}{s.preferredName && s.preferredName !== s.firstName && s.preferredName !== s.lastName ? ` (${s.preferredName})` : ""}
                {s.activeCount ? <span className="ml-2 text-xs font-normal">({s.activeCount})</span> : null}
              </span>
              <span className="shrink-0 text-sm text-slate-400">{s.classGroup}</span>
            </Link>

            {housesOn && (
              isAdmin ? (
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: houseColor(s.houseId) }} />
                  <select value={s.houseId || ""} onChange={(e) => patchStudent(s, { houseId: e.target.value || null })}
                    className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    <option value="">No house</option>
                    {houses.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
                  </select>
                  <select value={s.houseGroup || 0} onChange={(e) => patchStudent(s, { houseGroup: Number(e.target.value) })}
                    title="Booster-event room (#1 / #2)" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                    <option value={0}>Room —</option>
                    <option value={1}>#1</option>
                    <option value={2}>#2</option>
                  </select>
                </span>
              ) : s.houseId ? (
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: houseColor(s.houseId) }} />
                  {houseName(s.houseId)}{s.houseGroup ? ` · #${s.houseGroup}` : ""}
                </span>
              ) : null
            )}

            {isAdmin && (
              <span className="flex shrink-0 items-center gap-3 text-xs text-slate-500">
                <label className="flex items-center gap-1" title="Sports-skilled — spread evenly across houses/rooms">
                  <input type="checkbox" checked={!!s.sportsSkilled} onChange={() => patchStudent(s, { sportsSkilled: !s.sportsSkilled })} /> ⚽ Sport
                </label>
                <label className="flex items-center gap-1" title="Behaviour concern — spread evenly across houses/rooms">
                  <input type="checkbox" checked={!!s.behaviourConcern} onChange={() => patchStudent(s, { behaviourConcern: !s.behaviourConcern })} /> ⚠ Behaviour
                </label>
              </span>
            )}
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
