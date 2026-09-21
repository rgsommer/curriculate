"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, issueWhiteSlip, getMyTemplates, generateParentMessage, bulkParentMessage, type StudentSummary, type Me, type ParentTemplate } from "../_lib/api";

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
  const [templates, setTemplates] = useState<ParentTemplate[]>([]);
  const [tpl, setTpl] = useState("");
  const [pmMsg, setPmMsg] = useState("");
  const [lastMsg, setLastMsg] = useState<{ text: string; label: string } | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

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
    getMyTemplates().then((d) => {
      setTemplates(d.templates || []);
      const names = (d.templates || []).map((t) => t.name);
      let saved = ""; try { saved = localStorage.getItem("pm_template") || ""; } catch { /* ignore */ }
      setTpl(names.includes(saved) ? saved : (names[0] || ""));
    }).catch(() => {});
  }, []);

  // Generate a parent message for one student from the chosen template: copy it
  // to the clipboard and log it. The selected template persists across students.
  async function sendParentMessage(s: StudentSummary) {
    if (!tpl) { setPmMsg("Pick a message template first."); return; }
    try {
      const r = await generateParentMessage(s._id, tpl);
      setLastMsg({ text: r.message, label: `${r.template} → ${s.firstName} ${s.lastName}` });
      try { await navigator.clipboard.writeText(r.message); setPmMsg(`✓ Copied & logged “${r.template}” for ${s.firstName} — paste it into your email.`); }
      catch { setPmMsg(`Logged “${r.template}” for ${s.firstName} — copy the text below to send.`); }
    } catch (e: any) { setPmMsg(`✗ ${e.message}`); }
  }

  const selectedIds = Object.keys(selected).filter((id) => selected[id]);
  // Bulk: email the teacher one personalised message per selected student + log each.
  async function sendBulk() {
    if (!tpl || !selectedIds.length) return;
    setBulkBusy(true); setPmMsg("");
    try {
      const r = await bulkParentMessage(tpl, selectedIds);
      setPmMsg(`✓ Emailed ${r.sent} message(s) to ${r.to} (“${r.template}”) and logged ${r.logged}. Forward each to the parent.`);
      setSelected({});
      setLastMsg(null);
    } catch (e: any) { setPmMsg(`✗ ${e.message}`); }
    finally { setBulkBusy(false); }
  }

  // Optimistic per-student update (flags, house, room). Reverts on failure.
  async function patchStudent(s: StudentSummary, body: Partial<StudentSummary>) {
    const prev = s;
    setStudents((list) => list.map((x) => (x._id === s._id ? { ...x, ...body } : x)));
    try { await api(`/students/${s._id}`, { method: "PATCH", body }); }
    catch (e: any) { setErr(e.message); setStudents((list) => list.map((x) => (x._id === s._id ? prev : x))); }
  }
  // Any teacher can confirm a recommended white slip was issued. Optimistic; the
  // first confirmation registers it server-side regardless of who clicks.
  async function issueSlip(s: StudentSummary) {
    const id = s.pendingWhiteSlipId;
    if (!id) return;
    setStudents((list) => list.map((x) => (x._id === s._id ? { ...x, pendingWhiteSlipId: null } : x)));
    try { await issueWhiteSlip(id); }
    catch (e: any) { setErr(e.message); setStudents((list) => list.map((x) => (x._id === s._id ? { ...x, pendingWhiteSlipId: id } : x))); }
  }
  const houseName = (id?: string | null) => houses.find((h) => h._id === String(id))?.name || "";
  const houseColor = (id?: string | null) => houses.find((h) => h._id === String(id))?.color || "#94a3b8";

  // Pull the latest Edsby overall averages and tick "Academic" for strong students.
  const [acadBusy, setAcadBusy] = useState(false);
  const [acadMsg, setAcadMsg] = useState("");
  async function flagAcademics() {
    const t = window.prompt("Flag students as Academic when their Edsby overall average is at least… (%)", "80");
    if (t === null) return;
    const threshold = Number(t) || 80;
    setAcadBusy(true); setAcadMsg("");
    try {
      const r = await api<{ ok: boolean; flagged?: number; matched?: number; error?: string }>("/students/flag-academics", { body: { threshold } });
      if (!r.ok) { setAcadMsg(`✗ ${r.error || "Could not flag."}`); return; }
      setAcadMsg(`✓ Flagged ${r.flagged} academic (matched ${r.matched} to Edsby). Uncheck any individually as needed.`);
      const d = await api<{ students: StudentSummary[] }>("/students");
      setStudents(d.students || []);
    } catch (e: any) { setAcadMsg(`✗ ${e.message}`); } finally { setAcadBusy(false); }
  }

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
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Students</h1>
          <p className="text-sm text-slate-400">Search any student and open their full history, strikes, and notices home.</p>
        </div>
        {isAdmin && (
          <div className="text-right">
            <button onClick={flagAcademics} disabled={acadBusy} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm disabled:opacity-40">
              {acadBusy ? "Pulling…" : "🎓 Flag academics from Edsby"}
            </button>
            <p className="mt-1 max-w-xs text-xs text-slate-400">Uses the latest Edsby overall averages (refresh them in the Averages/Honour-roll panel first).</p>
          </div>
        )}
      </div>
      {acadMsg && <p className={`text-sm ${acadMsg.startsWith("✗") ? "text-red-600" : "text-green-700"}`}>{acadMsg}</p>}

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

      {templates.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">✉ Parent message:</span>
            <select value={tpl} onChange={(e) => { setTpl(e.target.value); try { localStorage.setItem("pm_template", e.target.value); } catch { /* ignore */ } }}
              className="rounded-lg border border-slate-300 px-2 py-1">
              {templates.some((t) => (t.kind || "encouraging") === "encouraging") && (
                <optgroup label="Encouraging">
                  {templates.filter((t) => (t.kind || "encouraging") === "encouraging").map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </optgroup>
              )}
              {templates.some((t) => t.kind === "corrective") && (
                <optgroup label="Corrective">
                  {templates.filter((t) => t.kind === "corrective").map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
                </optgroup>
              )}
            </select>
            <span className="text-xs text-slate-500">then tap ✉ by a student to copy their message &amp; log it.</span>
            <Link href="/behavior/setup#templates" className="text-xs text-slate-500 underline">edit templates</Link>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            Several students: tick the boxes, then
            <button type="button" onClick={sendBulk} disabled={bulkBusy || !tpl || selectedIds.length === 0}
              className="rounded-lg bg-slate-900 px-2.5 py-1 font-semibold text-white disabled:opacity-40">
              {bulkBusy ? "Sending…" : `✉ Email me each & log (${selectedIds.length})`}
            </button>
            <span>— one personalised email per student, ready to forward.</span>
            {selectedIds.length > 0 && <button type="button" onClick={() => setSelected({})} className="underline">clear</button>}
          </div>
          {pmMsg && <p className="mt-1 text-xs text-slate-700">{pmMsg}</p>}
          {lastMsg && (
            <div className="mt-2">
              <div className="text-xs text-slate-500">{lastMsg.label}</div>
              <textarea readOnly value={lastMsg.text} onFocus={(e) => e.currentTarget.select()}
                className="mt-1 h-28 w-full rounded-lg border border-slate-300 p-2 font-mono text-xs" />
            </div>
          )}
        </div>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.map((s) => (
          <li key={s._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 hover:bg-slate-50">
            {templates.length > 0 && (
              <input type="checkbox" checked={!!selected[s._id]} onChange={(e) => setSelected((m) => ({ ...m, [s._id]: e.target.checked }))}
                title="Select for a bulk parent message" className="shrink-0" />
            )}
            <Link href={`/behavior/student/${s._id}`} className="flex min-w-0 flex-1 basis-48 items-center justify-between gap-2">
              <span className={`truncate font-medium ${rowNameColor(s.activeCount || 0, trigger)}`}>
                {s.lastName}, {s.firstName}{s.preferredName && s.preferredName !== s.firstName && s.preferredName !== s.lastName ? ` (${s.preferredName})` : ""}
                {s.activeCount ? <span className="ml-2 text-xs font-normal">({s.activeCount})</span> : null}
              </span>
              <span className="shrink-0 text-sm text-slate-400">{s.classGroup}</span>
            </Link>

            {templates.length > 0 && (
              <button type="button" onClick={() => sendParentMessage(s)} disabled={!tpl}
                title={tpl ? `Copy the “${tpl}” parent message for this student and log it` : "Pick a template above first"}
                className="shrink-0 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-40">✉</button>
            )}

            {s.pendingWhiteSlipId && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800 ring-1 ring-amber-200" title="A white slip was recommended and the VP was emailed. Confirm once it's actually been issued.">
                White slip — issued?
                <button type="button" onClick={() => issueSlip(s)}
                  className="rounded-md bg-amber-600 px-2 py-0.5 font-semibold text-white hover:bg-amber-700">Yes</button>
              </span>
            )}

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
                <label className="flex items-center gap-1" title="Academically strong — spread evenly across houses/rooms (can be set from Edsby averages)">
                  <input type="checkbox" checked={!!s.academic} onChange={() => patchStudent(s, { academic: !s.academic })} /> 🎓 Academic
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
