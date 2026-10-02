"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";

type Row = { name: string; items: number | null; studentId: string | null; studentLabel: string | null; house: string | null; houseColor: string | null };
type RosterOpt = { id: string; label: string; house: string };

export default function FoodDrivePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [roster, setRoster] = useState<RosterOpt[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [label, setLabel] = useState("Food Drive");
  const [ind, setInd] = useState("30,20,10");
  const [hs, setHs] = useState("100,60,30");
  const [result, setResult] = useState<any>(null);

  const [copied, setCopied] = useState(false);

  useEffect(() => { if (getToken()) api<Me>("/me").then(setMe).catch(() => {}); }, []);
  if (!getToken()) return <p className="text-slate-500">Please <Link href={loginHref("/behavior/food-drive")} className="underline">sign in</Link>.</p>;

  const INSTRUCTIONS = [
    "TALLY IMPORT — how to run a counted event in Compass (food drive, cleanup, read-a-thon, etc.)",
    "",
    "1. Give each homeroom the printed class list (names only).",
    "2. During the event window, the class rep writes the COUNT beside each student's name (items brought, bags collected, books read, laps run, …).",
    "3. Collect the sheets at the end of the window.",
    "4. Photograph or scan each sheet (or save them as one PDF).",
    "5. In Compass → Tally import, type what it's for, upload the sheets, and click “Read sheets.”",
    "6. Check the read-back: fix any unmatched name (dropdown) or wrong count, set the points, then “Award points.”",
    "   • Top contributors overall get bonus points (default 30 / 20 / 10).",
    "   • The houses with the highest total place 1st/2nd/3rd (default 100 / 60 / 30).",
    "7. Anything handed in after the counting window can still be accepted but isn't counted (it can't be recorded on the sheets).",
    "",
    "Tip: decide the scale and keep a consistent event name for a clean record.",
  ].join("\n");

  async function copyInstructions() {
    try { await navigator.clipboard.writeText(INSTRUCTIONS); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setErr("Couldn't copy — select and copy manually."); }
  }

  async function parse() {
    if (!files.length) { setErr("Choose the sheet photos/scans or a PDF first."); return; }
    setBusy(true); setErr(""); setMsg(""); setResult(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f);
      const r = await api<{ rows: Row[]; roster: RosterOpt[]; images: number; unmatched: number }>("/house/food-drive/parse", { body: fd });
      setRows(r.rows); setRoster(r.roster);
      setMsg(`Read ${r.images} image(s) · ${r.rows.length} rows · ${r.unmatched} not matched — fix any below, then award.`);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  function setRow(i: number, patch: Partial<Row>) { setRows((p) => p && p.map((x, j) => (j === i ? { ...x, ...patch } : x))); }

  async function apply() {
    const payload = (rows || []).filter((r) => r.studentId && Number(r.items) > 0).map((r) => ({ studentId: r.studentId, items: Number(r.items) }));
    if (!payload.length) { setErr("No matched rows with a positive count to award."); return; }
    if (!window.confirm(`Award points from ${payload.length} student(s)? Top donors get ${ind} and the top houses get ${hs}.`)) return;
    setBusy(true); setErr("");
    try {
      const individual = ind.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
      const house = hs.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
      const r = await api<any>("/house/food-drive/apply", { body: { rows: payload, individual, house, label } });
      setResult(r);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  const matched = (rows || []).filter((r) => r.studentId).length;
  const withItems = (rows || []).filter((r) => r.studentId && Number(r.items) > 0).length;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/behavior" className="text-sm text-slate-500 underline">← dashboard</Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">Tally import</h1>
          <button onClick={copyInstructions} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            {copied ? "✓ Copied" : "📋 Copy instructions (for reps / future years)"}
          </button>
        </div>
        <p className="text-sm text-slate-400">For any counted event — food drive, garbage cleanup, read-a-thon, laps, etc. Upload the class sheets (typed names, a handwritten count beside each — photos, scans, or a PDF); Compass reads the counts, matches each name to a student &amp; house, then awards the top contributors and the top houses.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <label className="block text-sm">
          <span className="font-medium text-slate-700">What is this for?</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Food Drive, Garbage Cleanup, Read-a-thon"
            className="mt-1 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <input type="file" accept="image/*,application/pdf" multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          className="mt-3 block w-full text-sm" />
        {files.length > 0 && <p className="mt-1 text-xs text-slate-400">{files.length} file(s) selected</p>}
        <button onClick={parse} disabled={busy || !files.length}
          className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
          {busy && !result ? "Reading…" : "Read sheets"}
        </button>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      </section>

      {rows && !result && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold">Review &amp; award <span className="text-xs font-normal text-slate-400">({matched} matched · {withItems} with a count)</span></h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-400">Fix any unmatched names (pick the student) or correct a count. Rows with no student or a blank/zero count are skipped.</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-400">
                <th className="py-1 pr-2">From sheet</th><th className="py-1 pr-2">Student</th><th className="py-1 pr-2">House</th><th className="py-1 pr-2 text-right">Count</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className={!r.studentId ? "bg-amber-50" : ""}>
                    <td className="py-1.5 pr-2 text-slate-600">{r.name}</td>
                    <td className="py-1.5 pr-2">
                      <select value={r.studentId || ""} onChange={(e) => {
                        const opt = roster.find((o) => o.id === e.target.value);
                        setRow(i, { studentId: e.target.value || null, studentLabel: opt?.label || null, house: opt?.house || null });
                      }} className={`w-full rounded border px-2 py-1 text-sm ${r.studentId ? "border-slate-300" : "border-amber-400"}`}>
                        <option value="">— pick student —</option>
                        {roster.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-slate-500">{r.house || "—"}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" min={0} value={r.items ?? ""} onChange={(e) => setRow(i, { items: e.target.value === "" ? null : Number(e.target.value) })}
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
            <label className="text-sm">Top contributors get (comma pts)<input value={ind} onChange={(e) => setInd(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
            <label className="text-sm">Top houses get (comma pts)<input value={hs} onChange={(e) => setHs(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" /></label>
          </div>
          <p className="mt-1 text-xs text-slate-400">Awarding for: <span className="font-medium">{label || "—"}</span> (change &ldquo;What is this for?&rdquo; above).</p>
          <button onClick={apply} disabled={busy || !withItems}
            className="mt-3 rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {busy ? "Awarding…" : "Award points"}
          </button>
        </section>
      )}

      {result && (
        <section className="rounded-xl border border-green-300 bg-green-50 p-4">
          <h2 className="font-semibold text-green-800">✓ Done — {label} · {result.totalItems} counted</h2>
          {result.houses?.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-medium">House placements</p>
              <ul className="mt-1 text-sm text-slate-700">
                {result.houses.map((h: any, i: number) => <li key={i}>{["🥇","🥈","🥉"][i] || `${i + 1}.`} {h.house} — <b>+{h.points}</b> ({h.items})</li>)}
              </ul>
            </div>
          )}
          {result.students?.length > 0 && (
            <div className="mt-2">
              <p className="text-sm font-medium">Top contributors</p>
              <ul className="mt-1 text-sm text-slate-700">
                {result.students.map((s: any, i: number) => <li key={i}>{["🥇","🥈","🥉"][i] || `${i + 1}.`} {s.name} — <b>+{s.points}</b> ({s.items})</li>)}
              </ul>
            </div>
          )}
          <Link href="/behavior" className="mt-3 inline-block text-sm underline">Back to dashboard</Link>
        </section>
      )}
    </div>
  );
}
