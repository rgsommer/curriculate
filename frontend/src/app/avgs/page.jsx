"use client";

/**
 * /avgs — Weighted report-card averages.
 *
 * Upload a blob of report cards (PDF, CSV/TXT, or page images) for any number
 * of students. The page splits the upload into chunks, sends each chunk to
 * POST /avgs/extract on the backend (AI pulls out each student's FINAL grade
 * per course and assigns a weight from the editable rules below), then merges
 * everything and shows students grouped by grade level, ranked by weighted
 * average. Weighted average = Σ(grade × weight) ÷ Σ(weight) — computed here,
 * not by the AI, so the arithmetic is exact.
 */

import { useRef, useState } from "react";
import EdsbyHonours from "./EdsbyHonours";
import EdsbyGradebookGrid from "./EdsbyGradebookGrid";
import OneClickFinalGrades from "./OneClickFinalGrades";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "https://api.curriculate.net";

const DEFAULT_WEIGHT_RULES = `Weight = (days per week the class meets) ÷ 5.
- Math: 4×/week → weight 0.8
- English / Language Arts: 4×/week → weight 0.8
- Science: 4×/week → weight 0.8
- Social Studies / Socials: 4×/week → weight 0.8
- French / second language: 4×/week → weight 0.8
- Art: 2×/week → weight 0.4
- Music / Band / Drama: 2×/week → weight 0.4
- PE (Physical Education): 1×/week → weight 0.2
- CE (Career Education): meets every day, but counts at half value → weight 0.5
- Anything else: estimate from a typical school timetable; if unsure, 2×/week → weight 0.4
- If the report card itself states how often a course meets, use that instead.`;

// Chunking limits per backend request (text chars / scanned-page images)
const CHUNK_TEXT_CHARS = 15000;
const CHUNK_MAX_IMAGES = 6;
// A PDF page whose extracted text is shorter than this is treated as a scan
// and rendered to an image instead.
const MIN_TEXT_PAGE_CHARS = 40;

// ---------- PDF.js loader (self-hosted proxy → CDN fallback, same as BatchGrading) ----------
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
const PDFJS_JSR = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build";
const PDFJS_URLS = [
  "/api/vendor?lib=pdfjs",
  `${PDFJS_JSR}/pdf.min.js`,
  `${PDFJS_CDN}/pdf.min.js`,
];
const PDFJS_WORKER_URLS = [
  "/api/vendor?lib=pdfjs-worker",
  `${PDFJS_JSR}/pdf.worker.min.js`,
  `${PDFJS_CDN}/pdf.worker.min.js`,
];
let pdfjsPromise = null;

function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URLS[0];
      return resolve(window.pdfjsLib);
    }
    let idx = 0;
    function tryNext() {
      if (idx >= PDFJS_URLS.length) {
        pdfjsPromise = null;
        reject(new Error("Failed to load pdf.js from all sources"));
        return;
      }
      const script = document.createElement("script");
      script.src = PDFJS_URLS[idx];
      script.onload = () => {
        if (window.pdfjsLib) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URLS[idx] || PDFJS_WORKER_URLS[0];
          resolve(window.pdfjsLib);
        } else {
          idx++;
          tryNext();
        }
      };
      script.onerror = () => { idx++; tryNext(); };
      document.head.appendChild(script);
    }
    tryNext();
  });
  return pdfjsPromise;
}

async function renderPageToDataUrl(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.8);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsText(file);
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error(`Could not read ${file.name}`));
    r.readAsDataURL(file);
  });
}

// Turn uploaded files into ordered "parts": { text } or { image }.
async function filesToParts(files, onProgress) {
  const parts = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const pdfjs = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdfDoc = await pdfjs.getDocument({ data: buf }).promise;
      for (let p = 1; p <= pdfDoc.numPages; p++) {
        onProgress(`Reading ${file.name} — page ${p}/${pdfDoc.numPages}…`);
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        const text = tc.items.map((it) => it.str).join(" ").trim();
        if (text.replace(/\s+/g, "").length >= MIN_TEXT_PAGE_CHARS) {
          parts.push({ text: `\n--- PAGE ${p} (${file.name}) ---\n${text}` });
        } else {
          // Scanned / image-only page — send it as an image
          parts.push({ image: await renderPageToDataUrl(pdfDoc, p) });
        }
      }
    } else if (file.type.startsWith("image/")) {
      onProgress(`Reading ${file.name}…`);
      parts.push({ image: await readFileAsDataUrl(file) });
    } else {
      // CSV / TXT / anything text-like
      onProgress(`Reading ${file.name}…`);
      const text = await readFileAsText(file);
      if (text.trim()) parts.push({ text: `\n--- FILE ${file.name} ---\n${text}` });
    }
  }
  return parts;
}

// Group ordered parts into request-sized chunks of { text, images }.
function partsToChunks(parts) {
  const chunks = [];
  let cur = { text: "", images: [] };
  const flush = () => {
    if (cur.text.trim() || cur.images.length) chunks.push(cur);
    cur = { text: "", images: [] };
  };
  for (const part of parts) {
    if (part.text) {
      if (cur.text.length + part.text.length > CHUNK_TEXT_CHARS && cur.text) flush();
      cur.text += part.text;
    } else if (part.image) {
      if (cur.images.length >= CHUNK_MAX_IMAGES) flush();
      cur.images.push(part.image);
    }
  }
  flush();
  return chunks;
}

const nameKey = (name) => String(name || "").toLowerCase().replace(/[^a-z]/g, "");

// Merge students returned across chunks (a student's report card can span a
// chunk boundary). Courses dedupe by name; first extraction wins.
function mergeStudents(chunkResults) {
  const byName = new Map();
  for (const students of chunkResults) {
    for (const s of students || []) {
      const key = nameKey(s.name);
      if (!key) continue;
      if (!byName.has(key)) {
        byName.set(key, { name: s.name, gradeLevel: s.gradeLevel || "", courses: [] });
      }
      const merged = byName.get(key);
      if (!merged.gradeLevel && s.gradeLevel) merged.gradeLevel = s.gradeLevel;
      for (const c of s.courses || []) {
        const ck = String(c.course || "").toLowerCase().trim();
        if (!ck || merged.courses.some((mc) => String(mc.course).toLowerCase().trim() === ck)) continue;
        merged.courses.push(c);
      }
    }
  }
  const out = [];
  for (const s of byName.values()) {
    let num = 0, den = 0;
    for (const c of s.courses) {
      const pct = typeof c.finalGradePercent === "number" ? c.finalGradePercent : null;
      const w = typeof c.weight === "number" ? c.weight : 0;
      if (pct === null || w <= 0) continue;
      num += pct * w;
      den += w;
    }
    out.push({ ...s, weightedAvg: den > 0 ? num / den : null });
  }
  return out;
}

// Sort grade-level labels: K first, then numeric, then everything else.
function gradeLevelSortKey(label) {
  const l = String(label).trim().toLowerCase();
  if (!l) return [3, 0, ""];
  if (l === "k" || l.includes("kinder")) return [0, 0, l];
  const m = l.match(/\d+/);
  if (m) return [1, parseInt(m[0], 10), l];
  return [2, 0, l];
}

function groupByGrade(students) {
  const groups = new Map();
  for (const s of students) {
    const label = String(s.gradeLevel || "").trim() || "Grade not shown";
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(s);
  }
  const ordered = [...groups.entries()].sort((a, b) => {
    const ka = gradeLevelSortKey(a[0]), kb = gradeLevelSortKey(b[0]);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  for (const [, list] of ordered) {
    list.sort((a, b) => (b.weightedAvg ?? -1) - (a.weightedAvg ?? -1));
  }
  return ordered;
}

function resultsToCsv(groups) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Grade Level", "Rank", "Student", "Weighted Average", "Course", "Final Grade", "Days/Week", "Weight"]];
  for (const [label, students] of groups) {
    students.forEach((s, i) => {
      const avg = s.weightedAvg === null ? "" : s.weightedAvg.toFixed(1);
      if (!s.courses.length) rows.push([label, i + 1, s.name, avg, "", "", "", ""]);
      for (const c of s.courses) {
        rows.push([label, i + 1, s.name, avg, c.course, c.finalGradeRaw, c.daysPerWeek, c.weight]);
      }
    });
  }
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

export default function AvgsPage() {
  const [files, setFiles] = useState([]);
  const [weightRules, setWeightRules] = useState(DEFAULT_WEIGHT_RULES);
  const [showRules, setShowRules] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [groups, setGroups] = useState(null); // [[gradeLabel, students[]], ...]
  const [expanded, setExpanded] = useState({});
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    if (dropped.length) setFiles(dropped);
  }

  async function analyze() {
    if (!files.length || busy) return;
    setBusy(true);
    setError("");
    setGroups(null);
    setExpanded({});
    try {
      const parts = await filesToParts(files, setStatus);
      const chunks = partsToChunks(parts);
      if (!chunks.length) throw new Error("No readable content found in the upload.");

      const chunkResults = [];
      for (let i = 0; i < chunks.length; i++) {
        setStatus(`Analyzing with AI — section ${i + 1} of ${chunks.length}…`);
        const res = await fetch(`${API}/avgs/extract`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunks[i].text, images: chunks[i].images, weightRules }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Analysis failed (HTTP ${res.status}).`);
        chunkResults.push(data.students);
      }

      const students = mergeStudents(chunkResults);
      if (!students.length) throw new Error("No students with final grades were found in the upload.");
      setGroups(groupByGrade(students));
      setStatus("");
    } catch (err) {
      setError(err.message || "Something went wrong.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!groups) return;
    const blob = new Blob([resultsToCsv(groups)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "weighted-averages.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const totalStudents = groups ? groups.reduce((n, [, list]) => n + list.length, 0) : 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-slate-800">Weighted Averages</h1>
        <span className="flex gap-2">
          <a href="/avgs/features"
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Features
          </a>
          <a href="/avgs/features#guide"
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Guide
          </a>
        </span>
      </div>
      <p className="mt-2 text-slate-600">
        Build a grade grid three ways: drop a whole report-card <strong>PDF</strong> (AI extracts grades), pull
        <strong> live from Edsby</strong>, or — for T1/Final per subject — drop your <strong>Edsby class gradebook
        CSV exports</strong> in the “Build a T1 / Final grid” section below. The first two are collapsed; expand if you need them.
      </p>

      {/* Primary, one-click action: pull all Final grades → CSV */}
      <OneClickFinalGrades />

      {/* Upload report cards (PDF/photos → AI) — collapsed by default */}
      <details className="mt-8 rounded-xl border border-slate-200 bg-white shadow-sm">
        <summary className="cursor-pointer select-none p-6 text-lg font-semibold text-slate-800">
          Upload report cards (PDF or photos → AI)
          <span className="ml-2 text-sm font-normal text-slate-400">— optional; not for Edsby class CSVs</span>
        </summary>
        <div className="px-6 pb-6">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.csv,.txt,.png,.jpg,.jpeg,.webp,application/pdf,text/csv,text/plain,image/*"
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`mt-3 w-full rounded-lg border-2 border-dashed px-4 py-8 transition ${
            dragOver
              ? "border-blue-500 bg-blue-50 text-blue-700"
              : "border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-600"
          }`}
        >
          {dragOver
            ? "Drop it here"
            : files.length
              ? files.map((f) => f.name).join(", ")
              : "Drop your whole report-card PDF here — every student, every class, any size — or click to choose files"}
        </button>

        <button
          type="button"
          onClick={() => setShowRules((v) => !v)}
          className="mt-4 text-sm font-medium text-blue-600 hover:underline"
        >
          {showRules ? "▾ Hide weighting rules" : "▸ Edit weighting rules (Art 2×/week = 0.4, Math 4× = 0.8, CE = 0.5, PE 1× = 0.2…)"}
        </button>
        {showRules && (
          <textarea
            value={weightRules}
            onChange={(e) => setWeightRules(e.target.value)}
            rows={13}
            className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-700"
          />
        )}

        <button
          type="button"
          onClick={analyze}
          disabled={!files.length || busy}
          className="mt-5 rounded-lg bg-blue-600 px-6 py-2.5 font-semibold text-white shadow transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Working…" : "Analyze & rank"}
        </button>

        {status && <p className="mt-3 animate-pulse text-sm text-slate-500">{status}</p>}
        {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        </div>
      </details>

      {/* Results */}
      {groups && (
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-800">
              2. Rankings <span className="font-normal text-slate-500">— {totalStudents} students</span>
            </h2>
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Download CSV
            </button>
          </div>

          {groups.map(([label, students]) => (
            <div key={label} className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 font-semibold text-slate-700">
                {/^\d+$/.test(label.trim()) ? `Grade ${label.trim()}` : label}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2 w-12">#</th>
                    <th className="px-2 py-2">Student</th>
                    <th className="px-2 py-2 text-right">Weighted avg</th>
                    <th className="px-5 py-2 w-24 text-right">Courses</th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s, i) => {
                    const rowKey = `${label}:${nameKey(s.name)}`;
                    const open = !!expanded[rowKey];
                    return [
                      <tr
                        key={rowKey}
                        onClick={() => setExpanded((e) => ({ ...e, [rowKey]: !open }))}
                        className="cursor-pointer border-t border-slate-100 hover:bg-blue-50/40"
                      >
                        <td className="px-5 py-2.5 text-slate-400">{i + 1}</td>
                        <td className="px-2 py-2.5 font-medium text-slate-800">{s.name}</td>
                        <td className="px-2 py-2.5 text-right font-semibold text-slate-800">
                          {s.weightedAvg === null ? "—" : `${s.weightedAvg.toFixed(1)}%`}
                        </td>
                        <td className="px-5 py-2.5 text-right text-slate-500">
                          {s.courses.length} {open ? "▾" : "▸"}
                        </td>
                      </tr>,
                      open && (
                        <tr key={`${rowKey}-detail`} className="border-t border-slate-100 bg-slate-50/60">
                          <td />
                          <td colSpan={3} className="px-2 py-3">
                            <table className="w-full text-xs text-slate-600">
                              <thead>
                                <tr className="text-left uppercase tracking-wide text-slate-400">
                                  <th className="py-1 pr-2">Course</th>
                                  <th className="py-1 pr-2">Final grade</th>
                                  <th className="py-1 pr-2 text-right">Days/wk</th>
                                  <th className="py-1 pr-4 text-right">Weight</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.courses.map((c, j) => (
                                  <tr key={j} className="border-t border-slate-200/60">
                                    <td className="py-1 pr-2">{c.course}</td>
                                    <td className="py-1 pr-2">
                                      {c.finalGradeRaw}
                                      {typeof c.finalGradePercent === "number" && !String(c.finalGradeRaw).includes("%")
                                        ? ` (${c.finalGradePercent}%)`
                                        : ""}
                                    </td>
                                    <td className="py-1 pr-2 text-right">{c.daysPerWeek}</td>
                                    <td className="py-1 pr-4 text-right">{c.weight}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}

      <details className="mt-10">
        <summary className="cursor-pointer select-none text-lg font-semibold text-slate-800">
          Honour roll — live from Edsby
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">beta</span>
          <span className="ml-2 text-sm font-normal text-slate-400">— current/Final only; click to expand</span>
        </summary>
        <EdsbyHonours />
      </details>
      <EdsbyGradebookGrid />
    </main>
  );
}
