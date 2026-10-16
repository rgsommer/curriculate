"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getToken, loginHref, type Me } from "../_lib/api";
import { cardCls, Button } from "../_components/ui";
import TallyEditor from "./TallyEditor";

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
  const [hs, setHs] = useState("100,60,30,10");
  const [result, setResult] = useState<any>(null);

  const [copied, setCopied] = useState(false);

  useEffect(() => { if (getToken()) api<Me>("/me").then(setMe).catch(() => {}); }, []);
  if (!getToken()) return <p className="text-slate-500">Please <Link href={loginHref("/behavior/food-drive")} className="underline">sign in</Link>.</p>;

  const INSTRUCTIONS = [
    "TALLY IMPORT — how to run a counted event in Compass (food drive, cleanup, read-a-thon, etc.)",
    "",
    "1. In Compass → Tally import, click “Print class sheets” and give each homeroom its sheet (typed names, blank count column).",
    "2. During the event window, the class rep writes the COUNT beside each student's name (items brought, bags collected, books read, laps run, …).",
    "3. Collect the sheets at the end of the window.",
    "4. Photograph or scan each sheet (or save them as one PDF).",
    "5. In Compass → Tally import, type what it's for, upload the sheets, and click “Read sheets.”",
    "6. Check the read-back: fix any unmatched name (dropdown) or wrong count, set the points, then “Award points.”",
    "   • Top contributors overall get bonus points (default 30 / 20 / 10).",
    "   • The houses with the highest total place 1st/2nd/3rd/4th (default 100 / 60 / 30 / 10).",
    "7. Late items? In Compass → Tally import → “Correct a past event”, add them to the student's count and save — placements and points are recalculated.",
    "",
    "Tip: decide the scale and keep a consistent event name for a clean record.",
  ].join("\n");

  // Step 1 sheets: one page per homeroom, typed names (so the read-back matches
  // reliably) with a blank count column. Staff-only printout.
  const [printBusy, setPrintBusy] = useState(false);
  async function printSheets() {
    setPrintBusy(true); setErr("");
    try {
      const d = await api<{ students: Array<{ firstName: string; lastName: string; preferredName?: string; classGroup?: string }> }>("/students");
      const byRoom: Record<string, string[]> = {};
      for (const st of d.students || []) {
        const room = (st.classGroup || "").trim() || "No homeroom";
        (byRoom[room] ||= []).push(`${st.lastName}, ${st.preferredName || st.firstName}`);
      }
      const rooms = Object.keys(byRoom).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      if (!rooms.length) { setErr("No students on the roster yet."); return; }
      const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
      const title = esc(label.trim() || "Tally");
      const pages = rooms.map((room) => {
        const names = byRoom[room].sort((a, b) => a.localeCompare(b));
        const rows = names.map((n) => `<tr><td>${esc(n)}</td><td class="c"></td></tr>`).join("");
        return `<section><h1>${title} — ${esc(room)}</h1><p>Write the count beside each name. Leave blank if none.</p>` +
          `<table><thead><tr><th>Student</th><th class="c">Count</th></tr></thead><tbody>${rows}</tbody></table></section>`;
      }).join("");
      const w = window.open("", "_blank");
      if (!w) { setErr("Your browser blocked the print window — allow pop-ups for this site and try again."); return; }
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${title} — class sheets</title><style>
        body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px}
        section{page-break-after:always}section:last-child{page-break-after:auto}
        h1{font-size:20px;margin:0 0 4px}p{font-size:12px;color:#475569;margin:0 0 12px}
        table{width:100%;border-collapse:collapse;font-size:15px}
        th,td{border:1px solid #94a3b8;padding:8px 10px;text-align:left}
        th{background:#f1f5f9}.c{width:28%;text-align:center}
      </style></head><body>${pages}<script>window.onload=function(){window.print()}<\/script></body></html>`);
      w.document.close();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setPrintBusy(false);
    }
  }

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
          <Button onClick={copyInstructions} variant="secondary" size="xs">
            {copied ? "✓ Copied" : "📋 Copy instructions (for reps / future years)"}
          </Button>
        </div>
        <p className="text-sm text-slate-500">For any counted event — food drive, garbage cleanup, read-a-thon, laps, etc. Upload the class sheets (typed names, a handwritten count beside each — photos, scans, or a PDF); Compass reads the counts, matches each name to a student &amp; house, then awards the top contributors and the top houses.</p>
      </div>

      <section className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2.5">
          <p className="text-sm text-slate-700"><span className="font-semibold">Step 1:</span> print a class sheet for each homeroom (typed names + a blank count column).</p>
          <Button onClick={printSheets} disabled={printBusy} variant="secondary" size="sm">{printBusy ? "Preparing…" : "🖨 Print class sheets"}</Button>
        </div>
        <label className="mt-3 block text-sm">
          <span className="font-medium text-slate-700">What is this for?</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Food Drive, Garbage Cleanup, Read-a-thon"
            className="mt-1 w-full max-w-md rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </label>
        <input type="file" accept="image/*,application/pdf" multiple
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
          className="mt-3 block w-full text-sm" />
        {files.length > 0 && <p className="mt-1 text-xs text-slate-500">{files.length} file(s) selected</p>}
        <Button onClick={parse} disabled={busy || !files.length} className="mt-3">
          {busy && !result ? "Reading…" : "Read sheets"}
        </Button>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        {msg && <p className="mt-2 text-sm text-green-700">{msg}</p>}
      </section>

      {rows && !result && (
        <section className={cardCls}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 className="font-semibold">Review &amp; award <span className="text-xs font-normal text-slate-500">({matched} matched · {withItems} with a count)</span></h2>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">Fix any unmatched names (pick the student) or correct a count. Rows with no student or a blank/zero count are skipped.</p>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-slate-500">
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
          <p className="mt-1 text-xs text-slate-500">Awarding for: <span className="font-medium">{label || "—"}</span> (change &ldquo;What is this for?&rdquo; above).</p>
          <Button variant="success" onClick={apply} disabled={busy || !withItems} className="mt-3">
            {busy ? "Awarding…" : "Award points"}
          </Button>
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

      <TallyEditor />
    </div>
  );
}
