"use client";

// Drag-and-drop builder: turn Edsby class "Gradebook" CSV exports into one
// student × subject grid with each reporting period (Sep-Nov / Nov-Feb (=T1) /
// Final). Fully client-side — no Edsby session, no upload to our servers. The
// export's per-period averages are Edsby's official numbers, so this is the
// accurate source for a report-card sheet (the live API only returns Final).

import { useRef, useState } from "react";

// Class-code → subject. Extend as needed; unknown codes fall back to the code.
const SUBJECTS = {
  GEO: "Geography", HIS: "History", HIST: "History", MAT: "Math", MATH: "Math",
  ENG: "English", FRE: "French", FR: "French", SCI: "Science", ART: "Art",
  MUS: "Music", CE: "CE", COMP: "Computers", CMP: "Computers", PE: "PE",
  PHE: "PE", HLTH: "Health", HEALTH: "Health",
};

// Minimal RFC-4180 CSV parser (handles quoted fields with commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", i = 0, inQ = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < s.length) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function classCode(filename) {
  const name = filename.replace(/\s*-\s*Gradebook.*$/i, "").trim();
  const parts = name.split(/\s+/);
  return parts[parts.length - 1] || name;
}
function subjectGrade(code) {
  const m = code.match(/^([A-Za-z]+)(\d{1,2})?/);
  const pre = (m ? m[1] : code).toUpperCase();
  return { subject: SUBJECTS[pre] || pre.replace(/^\w/, (x) => x.toUpperCase()), grade: m && m[2] ? m[2] : "" };
}

// Parse one Edsby gradebook export → { periods:[labels], students:[{eid,first,last,vals:{label:pct}}] }
function parseGradebook(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { periods: [], students: [] };
  const hdr = rows[0];
  const idx = (n) => hdr.indexOf(n);
  const iFirst = idx("First Name"), iLast = idx("Last Name"), iEid = idx("Edsby ID");
  if (iFirst < 0 || iLast < 0 || iEid < 0) return { periods: [], students: [] };
  // ReportingPeriod columns: the "Assessment Type" metadata row marks them.
  const typeRow = rows.find((r) => r[0] === "Assessment Type");
  const pcols = [];
  if (typeRow) {
    typeRow.forEach((v, i2) => { if (v === "ReportingPeriod") pcols.push({ i: i2, label: hdr[i2].replace(/^2526 JH\s*/i, "").trim() }); });
  }
  const students = [];
  for (const r of rows) {
    if (r.length <= iEid) continue;
    const first = (r[iFirst] || "").trim(), last = (r[iLast] || "").trim(), eid = (r[iEid] || "").trim();
    if (!first || !last || !/^\d+$/.test(eid)) continue; // skip metadata rows
    const vals = {};
    for (const p of pcols) vals[p.label] = (r[p.i] || "").trim().replace(/%$/, "");
    students.push({ eid, first, last, vals });
  }
  return { periods: pcols.map((p) => p.label), students };
}

export default function EdsbyGradebookGrid() {
  const [rows, setRows] = useState(null); // merged student rows
  const [cols, setCols] = useState([]); // [{subject, period}]
  const [files, setFiles] = useState([]);
  const [unknown, setUnknown] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  async function ingest(fileList) {
    const arr = Array.from(fileList || []).filter((f) => /\.csv$/i.test(f.name));
    if (!arr.length) return;
    const byEid = new Map();
    const subjectsSeen = [];
    const periodsSeen = [];
    const unknownCodes = [];
    for (const f of arr) {
      const code = classCode(f.name);
      const { subject, grade } = subjectGrade(code);
      if (!SUBJECTS[code.match(/^[A-Za-z]+/)?.[0]?.toUpperCase()] && !unknownCodes.includes(code)) unknownCodes.push(code);
      if (!subjectsSeen.includes(subject)) subjectsSeen.push(subject);
      const text = await f.text();
      const { periods, students } = parseGradebook(text);
      for (const p of periods) if (!periodsSeen.includes(p)) periodsSeen.push(p);
      for (const s of students) {
        const cur = byEid.get(s.eid) || { last: s.last, first: s.first, grade, data: {} };
        if (grade && !cur.grade) cur.grade = grade;
        for (const [period, v] of Object.entries(s.vals)) if (v !== "") cur.data[`${subject}|${period}`] = v;
        byEid.set(s.eid, cur);
      }
    }
    // Column order: each subject × each period seen (Final last within a subject).
    const periodOrder = ["Sep-Nov", "Nov-Feb", "Final"].filter((p) => periodsSeen.includes(p))
      .concat(periodsSeen.filter((p) => !["Sep-Nov", "Nov-Feb", "Final"].includes(p)));
    const colDefs = [];
    subjectsSeen.sort().forEach((subj) => periodOrder.forEach((per) => colDefs.push({ subject: subj, period: per })));
    const merged = [...byEid.values()].sort((a, b) => (a.grade + a.last + a.first).localeCompare(b.grade + b.last + b.first));
    setRows(merged);
    setCols(colDefs);
    setFiles(arr.map((f) => f.name));
    setUnknown(unknownCodes.filter((c) => !/^(GEO|HIS|HIST|MAT|MATH|ENG|FRE|FR|SCI|ART|MUS|CE|COMP|CMP|PE|PHE|HLTH|HEALTH)/i.test(c)));
  }

  function download() {
    if (!rows) return;
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Last Name", "First Name", "Name", "Grade", ...cols.map((c) => `${c.subject} ${c.period === "Nov-Feb" ? "T1 (Nov-Feb)" : c.period}`)];
    const lines = [header.map(esc).join(",")];
    for (const r of rows) {
      lines.push([r.last, r.first, `${r.first} ${r.last}`.trim(), r.grade, ...cols.map((c) => r.data[`${c.subject}|${c.period}`] ?? "")].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "edsby-report-grid.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="mt-10 rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-800">Build a T1 / Final grid from Edsby exports</h2>
      <p className="mt-1 text-sm text-slate-500">
        In Edsby, <strong>Export each class&apos;s Gradebook to CSV</strong>, then drop them all here. This builds one
        student × subject grid with each reporting period (Nov-Feb = Term&nbsp;1, plus Final) — Edsby&apos;s official
        marks. Everything happens in your browser; nothing is uploaded.
      </p>

      <input ref={inputRef} type="file" accept=".csv" multiple className="hidden"
        onChange={(e) => ingest(e.target.files)} />
      <button type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); ingest(e.dataTransfer?.files); }}
        className={`mt-3 w-full rounded-lg border-2 border-dashed px-4 py-8 text-sm transition ${
          dragOver ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600"
        }`}>
        {files.length ? `${files.length} file(s): ${files.join(", ")}` : "Drop your Edsby gradebook CSV exports here (or click) — one per class"}
      </button>

      {unknown.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
          Unrecognized class code(s): {unknown.join(", ")} — these use the raw code as the subject. Tell me the right
          subject for each and I&apos;ll map them.
        </p>
      )}

      {rows && (
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">{rows.length} students · {cols.length} columns</p>
            <button type="button" onClick={download}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
              Download grid (CSV)
            </button>
          </div>
          <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-slate-200">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50">
                <tr className="text-left text-slate-500">
                  <th className="px-2 py-1">Student</th>
                  <th className="px-2 py-1">Gr</th>
                  {cols.map((c, i) => (
                    <th key={i} className="px-2 py-1 whitespace-nowrap">{c.subject} {c.period === "Nov-Feb" ? "T1" : c.period}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="px-2 py-1 whitespace-nowrap font-medium text-slate-700">{r.last}, {r.first}</td>
                    <td className="px-2 py-1 text-slate-500">{r.grade}</td>
                    {cols.map((c, j) => (
                      <td key={j} className="px-2 py-1 text-right tabular-nums">{r.data[`${c.subject}|${c.period}`] ?? ""}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
