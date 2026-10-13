"use client";

// Correct a past tally event: late items, a misread count, a missed student.
// Saving re-awards the event's points from the corrected counts (same award
// date) and shows what changed.
import { useEffect, useState } from "react";
import { api } from "../_lib/api";
import { cardCls, Button, inputCls } from "../_components/ui";
import { toast } from "../_components/toast";

type EventSummary = { id: string; label: string; at: string; students: number; totalItems: number };
type Row = { studentId: string; items: number; name: string; classGroup?: string; house?: string };
type Results = { houses: { house: string; place: number; points: number; items: number }[]; students: { name: string; place: number; points: number; items: number }[]; allHouseTotals?: { house: string; items: number }[]; totalItems: number } | null;
type RosterStudent = { _id: string; firstName: string; lastName: string; preferredName?: string; classGroup?: string };

const fmt = (d: string) => new Date(d).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
const MEDAL = ["🥇", "🥈", "🥉"];

export default function TallyEditor() {
  const [events, setEvents] = useState<EventSummary[] | null>(null);
  const [openId, setOpenId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [label, setLabel] = useState("");
  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [addId, setAddId] = useState("");
  const [addItems, setAddItems] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [diff, setDiff] = useState<{ before: Results; after: Results } | null>(null);

  useEffect(() => {
    api<{ events: EventSummary[] }>("/house/tally-events").then((d) => setEvents(d.events || [])).catch(() => setEvents([]));
  }, []);

  async function open(id: string) {
    setErr(""); setDiff(null); setNote("");
    if (openId === id) { setOpenId(""); return; }
    setOpenId(id); setRows([]);
    try {
      const d = await api<{ event: { label: string }; rows: Row[] }>(`/house/tally-events/${id}`);
      setRows(d.rows || []); setLabel(d.event.label);
      if (!roster.length) {
        const r = await api<{ students: RosterStudent[] }>("/students");
        setRoster((r.students || []).slice().sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`)));
      }
    } catch (e: any) { setErr(e.message); }
  }

  function addStudent() {
    const st = roster.find((s) => s._id === addId);
    const n = Math.round(Number(addItems));
    if (!st || !n || n < 0) { setErr("Pick a student and enter how many items."); return; }
    setErr("");
    setRows((p) => {
      const ex = p.find((r) => r.studentId === st._id);
      if (ex) return p.map((r) => (r.studentId === st._id ? { ...r, items: r.items + n } : r)); // late items add on
      return [...p, { studentId: st._id, items: n, name: `${st.lastName}, ${st.preferredName || st.firstName}`, classGroup: st.classGroup }];
    });
    setAddId(""); setAddItems("");
  }

  async function save() {
    setBusy(true); setErr("");
    try {
      const d = await api<{ before: Results; after: Results }>(`/house/tally-events/${openId}`, { method: "PUT", body: { rows: rows.map((r) => ({ studentId: r.studentId, items: r.items })), note } });
      setDiff(d);
      toast("Saved — points recalculated ✓");
      const l = await api<{ events: EventSummary[] }>("/house/tally-events");
      setEvents(l.events || []);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  if (events === null) return null;

  return (
    <section className={cardCls}>
      <h2 className="font-semibold">Correct a past event</h2>
      <p className="mt-0.5 text-xs text-slate-500">Late items, a misread count, or a missed student? Change the counts and save — the placements and points are recalculated, keeping the original award date.</p>
      {events.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No events yet. Events you award from now on appear here.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {events.map((ev) => (
            <li key={ev.id} className="py-2">
              <button type="button" onClick={() => open(ev.id)} className="flex w-full items-center justify-between gap-2 text-left text-sm">
                <span><span className="font-medium">{ev.label}</span> <span className="text-slate-500">· {fmt(ev.at)} · {ev.totalItems} items · {ev.students} students</span></span>
                <span className="shrink-0 text-xs text-slate-600 underline">{openId === ev.id ? "close" : "edit counts"}</span>
              </button>

              {openId === ev.id && (
                <div className="mt-3 space-y-3">
                  <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50"><tr className="text-left text-xs uppercase text-slate-500">
                        <th className="px-2 py-1.5">Student</th><th className="px-2 py-1.5">House</th><th className="px-2 py-1.5 text-right">Count</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r) => (
                          <tr key={r.studentId}>
                            <td className="px-2 py-1">{r.name} <span className="text-xs text-slate-500">{r.classGroup}</span></td>
                            <td className="px-2 py-1 text-xs text-slate-500">{r.house || "—"}</td>
                            <td className="px-2 py-1 text-right">
                              <input type="number" min={0} value={r.items} aria-label={`Count for ${r.name}`}
                                onChange={(e) => { const v = Math.max(0, Math.round(Number(e.target.value) || 0)); setRows((p) => p.map((x) => (x.studentId === r.studentId ? { ...x, items: v } : x))); }}
                                className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2.5">
                    <label className="min-w-[12rem] flex-1 text-xs text-slate-600">Add items for a student (late items add to their count)
                      <select value={addId} onChange={(e) => setAddId(e.target.value)} className={`${inputCls} mt-1`}>
                        <option value="">Choose a student…</option>
                        {roster.map((s) => <option key={s._id} value={s._id}>{s.lastName}, {s.preferredName || s.firstName}{s.classGroup ? ` (${s.classGroup})` : ""}</option>)}
                      </select>
                    </label>
                    <label className="text-xs text-slate-600">Items
                      <input type="number" min={1} value={addItems} onChange={(e) => setAddItems(e.target.value)} className="mt-1 block w-20 rounded border border-slate-300 px-2 py-2 text-sm" />
                    </label>
                    <Button size="sm" variant="secondary" onClick={addStudent}>Add</Button>
                  </div>

                  <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. Micah Porter brought 3 items late" className={inputCls} />
                  <div className="flex items-center gap-3">
                    <Button onClick={save} disabled={busy}>{busy ? "Recalculating…" : "Save & recalculate"}</Button>
                    <span className="text-xs text-slate-500">{rows.reduce((a, r) => a + r.items, 0)} items total for “{label}”</span>
                  </div>
                  {err && <p className="text-sm text-red-600">{err}</p>}

                  {diff && (
                    <div className="grid gap-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm sm:grid-cols-2">
                      {(["before", "after"] as const).map((k) => (
                        <div key={k}>
                          <p className="text-xs font-semibold uppercase tracking-wide text-green-800">{k === "before" ? "Before" : "After"}</p>
                          {diff[k] ? (
                            <ul className="mt-1 space-y-0.5 text-slate-700">
                              {diff[k]!.houses.map((h) => <li key={h.house}>{MEDAL[h.place - 1] || `${h.place}.`} {h.house} — {h.items} items · +{h.points}</li>)}
                              {diff[k]!.students.map((s) => <li key={s.name} className="text-xs text-slate-600">Top donor {s.place}: {s.name} — {s.items} items · +{s.points}</li>)}
                            </ul>
                          ) : <p className="mt-1 text-xs text-slate-500">—</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
