"use client";

import React, { useCallback, useRef, useState } from "react";

/**
 * BatchGrading — Teacher uploads a multi-page PDF (from scanner/copier),
 * system splits into per-student page groups, grades each through the
 * existing /grading endpoint, and displays batch results.
 *
 * Props:
 *   gradingUrl      — full URL to POST /grading
 *   gradeBand       — "3-5" | "6-8" | "9-10" | "11+"
 *   standards       — "canada" | "us" | "uk" | "eu"
 *   feedbackVoice   — voice key
 *   voiceMode       — "default" | "override"
 *   rubricOverride  — string (teacher-typed rubric or sticky)
 *   answerKeyOverride — string (answer key text)
 *   onClose         — callback to exit batch mode
 */

// ---------- PDF.js loader (CDN, no npm install) ----------
// Uses the legacy UMD build (3.x) which sets window.pdfjsLib via <script>
const PDFJS_CDN = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174";
let pdfjsPromise = null;

function loadPdfJs() {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
      return resolve(window.pdfjsLib);
    }
    const script = document.createElement("script");
    script.src = `${PDFJS_CDN}/pdf.min.js`;
    script.onload = () => {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.js`;
        resolve(window.pdfjsLib);
      } else {
        reject(new Error("pdfjsLib not found after script load"));
      }
    };
    script.onerror = () => reject(new Error("Failed to load pdf.js from CDN"));
    document.head.appendChild(script);
  });
  return pdfjsPromise;
}

// Render a single PDF page to a JPEG data URL
async function renderPageToDataUrl(pdfDoc, pageNum, scale = 1.5) {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Compress to JPEG
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Letter grade from percentage
function letterGrade(pct) {
  if (pct >= 93) return "A";
  if (pct >= 90) return "A-";
  if (pct >= 87) return "B+";
  if (pct >= 83) return "B";
  if (pct >= 80) return "B-";
  if (pct >= 77) return "C+";
  if (pct >= 73) return "C";
  if (pct >= 70) return "C-";
  if (pct >= 67) return "D+";
  if (pct >= 63) return "D";
  if (pct >= 60) return "D-";
  return "F";
}

function letterGradeColor(letter) {
  if (letter.startsWith("A")) return "#16a34a";
  if (letter.startsWith("B")) return "#2563eb";
  if (letter.startsWith("C")) return "#ca8a04";
  if (letter.startsWith("D")) return "#ea580c";
  return "#dc2626";
}

export default function BatchGrading({
  gradingUrl,
  gradeBand,
  standards,
  feedbackVoice,
  voiceMode,
  rubricOverride,
  answerKeyOverride,
  onClose,
}) {
  const [pdfFile, setPdfFile] = useState(null);
  const [pdfName, setPdfName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pagesPerStudent, setPagesPerStudent] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [grading, setGrading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState([]); // { index, studentName, score, outOf, pct, letter, strengths, improvements, comment, error }
  const [classSummary, setClassSummary] = useState(null);

  const pdfDocRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);

  // ---------- PDF upload ----------
  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "application/pdf") {
      setLoadError("Please select a PDF file.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setLoadError("PDF is too large (max 100 MB).");
      return;
    }

    setLoadError("");
    setLoading(true);
    setPdfName(file.name);
    setResults([]);
    setClassSummary(null);

    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      pdfDocRef.current = doc;
      setPageCount(doc.numPages);
      setPdfFile(file);
      setLoading(false);
    } catch (err) {
      console.error("PDF load error:", err);
      setLoadError("Could not read PDF. Make sure it's a valid PDF file.");
      setLoading(false);
    }
  }, []);

  // ---------- Student count ----------
  const studentCount = pageCount > 0 ? Math.ceil(pageCount / pagesPerStudent) : 0;

  // ---------- Run batch grading ----------
  const runBatch = useCallback(async () => {
    const doc = pdfDocRef.current;
    if (!doc || !gradingUrl) return;

    abortRef.current = false;
    setGrading(true);
    setResults([]);
    setClassSummary(null);

    const total = studentCount;
    setProgress({ done: 0, total, current: "Preparing..." });

    const batchSessionId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const batchResults = [];

    for (let i = 0; i < total; i++) {
      if (abortRef.current) break;

      const startPage = i * pagesPerStudent + 1;
      const endPage = Math.min(startPage + pagesPerStudent - 1, pageCount);

      setProgress({
        done: i,
        total,
        current: `Grading student ${i + 1} of ${total} (pages ${startPage}–${endPage})...`,
      });

      try {
        // Render pages to images
        const images = [];
        for (let p = startPage; p <= endPage; p++) {
          const dataUrl = await renderPageToDataUrl(doc, p);
          images.push(dataUrl);
        }

        // Call existing grading endpoint
        const payload = {
          images,
          rubricOverride: rubricOverride || null,
          answerKeyOverride: answerKeyOverride || null,
          gradeBand,
          standards,
          meta: {
            sessionId: batchSessionId,
            source: "batch-grading",
            capturedCount: images.length,
            capturedAt: Date.now(),
            feedbackVoiceMode: voiceMode || "default",
            feedbackVoice: feedbackVoice || "warm",
            inputMode: "photo",
            batchIndex: i,
          },
        };

        const res = await fetch(gradingUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        const score = Number(data.overall_score);
        const outOf = Number(data.overall_out_of);
        const pct =
          Number.isFinite(score) && Number.isFinite(outOf) && outOf > 0
            ? Math.round((score / outOf) * 100)
            : null;

        batchResults.push({
          index: i + 1,
          pages: `${startPage}–${endPage}`,
          studentName: data.student_name || `Student ${i + 1}`,
          score: Number.isFinite(score) ? score : "?",
          outOf: Number.isFinite(outOf) ? outOf : "?",
          pct,
          letter: pct != null ? letterGrade(pct) : "?",
          strengths: Array.isArray(data.strengths) ? data.strengths : [],
          improvements: Array.isArray(data.improvements) ? data.improvements : [],
          comment: data.teacher_comment || "",
          sections: data.sections || null,
          subject: data.inferred_subject || "",
          assessmentType: data.inferred_assessment_type || "",
          refCode: data.meta?.refCode || null,
          error: data.error || null,
          raw: data,
        });
      } catch (err) {
        batchResults.push({
          index: i + 1,
          pages: `${startPage}–${endPage}`,
          studentName: `Student ${i + 1}`,
          score: "?",
          outOf: "?",
          pct: null,
          letter: "?",
          strengths: [],
          improvements: [],
          comment: "",
          sections: null,
          subject: "",
          assessmentType: "",
          refCode: null,
          error: err?.message || "Network error",
          raw: null,
        });
      }

      // Update results live (one at a time)
      setResults([...batchResults]);
    }

    // Compute class summary
    const validResults = batchResults.filter((r) => r.pct != null);
    if (validResults.length > 0) {
      const avg =
        validResults.reduce((s, r) => s + r.pct, 0) / validResults.length;
      const sorted = [...validResults].sort((a, b) => a.pct - b.pct);
      const median =
        sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1].pct + sorted[sorted.length / 2].pct) / 2
          : sorted[Math.floor(sorted.length / 2)].pct;
      const high = sorted[sorted.length - 1].pct;
      const low = sorted[0].pct;

      // Grade distribution
      const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      validResults.forEach((r) => {
        const l = r.letter[0];
        if (l in dist) dist[l]++;
      });

      setClassSummary({
        count: validResults.length,
        avg: Math.round(avg),
        median: Math.round(median),
        high,
        low,
        dist,
      });
    }

    setProgress({ done: total, total, current: "Done!" });
    setGrading(false);
  }, [
    studentCount,
    pageCount,
    pagesPerStudent,
    gradingUrl,
    gradeBand,
    standards,
    feedbackVoice,
    voiceMode,
    rubricOverride,
    answerKeyOverride,
  ]);

  // ---------- CSV export ----------
  const exportCsv = useCallback(() => {
    if (!results.length) return;

    const escCsv = (v) => {
      const s = String(v ?? "");
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const header = [
      "Student",
      "Pages",
      "Score",
      "Out Of",
      "Percent",
      "Letter",
      "Subject",
      "Type",
      "Strengths",
      "Next Steps",
      "Comment",
    ];
    const rows = results.map((r) => [
      r.studentName,
      r.pages,
      r.score,
      r.outOf,
      r.pct != null ? `${r.pct}%` : "",
      r.letter,
      r.subject,
      r.assessmentType,
      r.strengths.join("; "),
      r.improvements.join("; "),
      r.comment,
    ]);

    const csv = [header, ...rows].map((row) => row.map(escCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `batch-grades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [results]);

  // ---------- Copy summary ----------
  const copySummary = useCallback(async () => {
    if (!results.length) return;

    const lines = [
      `Batch Grading Results — ${pdfName || "uploaded PDF"}`,
      `${results.length} student${results.length !== 1 ? "s" : ""} graded`,
      "",
    ];

    if (classSummary) {
      lines.push(
        `Class average: ${classSummary.avg}%  |  Median: ${classSummary.median}%  |  Range: ${classSummary.low}%–${classSummary.high}%`
      );
      lines.push(
        `Distribution: A: ${classSummary.dist.A}  B: ${classSummary.dist.B}  C: ${classSummary.dist.C}  D: ${classSummary.dist.D}  F: ${classSummary.dist.F}`
      );
      lines.push("");
    }

    results.forEach((r) => {
      lines.push(
        `${r.studentName}: ${r.score}/${r.outOf} (${r.pct != null ? r.pct + "%" : "?"}) ${r.letter}`
      );
      if (r.comment) lines.push(`  ${r.comment}`);
    });

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {}
  }, [results, classSummary, pdfName]);

  // ---------- Expanded row ----------
  const [expandedIndex, setExpandedIndex] = useState(null);

  // ---------- Render ----------
  return (
    <div style={batchStyles.container}>
      {/* Header */}
      <div style={batchStyles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>📄</span>
          <div>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Batch PDF Grading</div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Upload a scanned stack — one grade per student
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={batchStyles.closeBtn}
          title="Exit batch mode"
          type="button"
        >
          ✕
        </button>
      </div>

      {/* Upload area */}
      {!pdfFile && (
        <div
          style={batchStyles.uploadZone}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer?.files?.[0];
            if (file) {
              // Simulate file input
              const dt = new DataTransfer();
              dt.items.add(file);
              if (fileInputRef.current) {
                fileInputRef.current.files = dt.files;
                fileInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
          }}
        >
          <div style={{ fontSize: 36, opacity: 0.4 }}>📁</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>
            Drop a PDF here or tap to upload
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
            Scan your stack with the copier's ADF, save as PDF, upload here
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />

      {loading && (
        <div style={batchStyles.statusBox}>Loading PDF...</div>
      )}

      {loadError && (
        <div style={{ ...batchStyles.statusBox, color: "#dc2626", background: "rgba(220,38,38,0.08)" }}>
          {loadError}
        </div>
      )}

      {/* Config */}
      {pdfFile && !grading && results.length === 0 && (
        <div style={batchStyles.configSection}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {pdfName} — {pageCount} page{pageCount !== 1 ? "s" : ""}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <label style={batchStyles.label}>
              Pages per student
              <select
                value={pagesPerStudent}
                onChange={(e) => setPagesPerStudent(Number(e.target.value))}
                style={batchStyles.select}
              >
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} page{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ fontSize: 13, opacity: 0.7, paddingTop: 20 }}>
              = <strong>{studentCount}</strong> student{studentCount !== 1 ? "s" : ""}
              {pageCount % pagesPerStudent !== 0 && (
                <span style={{ color: "#ca8a04", marginLeft: 6 }}>
                  (last student: {pageCount % pagesPerStudent} page{pageCount % pagesPerStudent !== 1 ? "s" : ""})
                </span>
              )}
            </div>
          </div>

          {rubricOverride && (
            <div style={batchStyles.sticky}>
              Rubric/override active — will apply to all students
            </div>
          )}
          {answerKeyOverride && (
            <div style={batchStyles.sticky}>
              Answer key active — will apply to all students
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              onClick={runBatch}
              style={batchStyles.runBtn}
              type="button"
            >
              Grade {studentCount} Student{studentCount !== 1 ? "s" : ""}
            </button>

            <button
              onClick={() => {
                setPdfFile(null);
                setPdfName("");
                setPageCount(0);
                pdfDocRef.current = null;
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              style={{ ...batchStyles.ghostBtn, marginLeft: 10 }}
              type="button"
            >
              Change PDF
            </button>
          </div>
        </div>
      )}

      {/* Progress */}
      {grading && (
        <div style={batchStyles.progressSection}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{progress.current}</div>
          <div style={batchStyles.progressBar}>
            <div
              style={{
                ...batchStyles.progressFill,
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              }}
            />
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>
            {progress.done} / {progress.total} complete
          </div>
          <button
            onClick={() => { abortRef.current = true; }}
            style={{ ...batchStyles.ghostBtn, marginTop: 8 }}
            type="button"
          >
            Stop
          </button>
        </div>
      )}

      {/* Results table */}
      {results.length > 0 && (
        <div style={batchStyles.resultsSection}>
          <div style={batchStyles.resultsHeader}>
            <div style={{ fontWeight: 800 }}>
              Results ({results.length} student{results.length !== 1 ? "s" : ""})
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={copySummary} style={batchStyles.smallBtn} type="button">
                Copy Summary
              </button>
              <button onClick={exportCsv} style={batchStyles.smallBtn} type="button">
                Export CSV
              </button>
              {!grading && (
                <button
                  onClick={() => {
                    setResults([]);
                    setClassSummary(null);
                    setExpandedIndex(null);
                  }}
                  style={batchStyles.smallBtn}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Class summary card */}
          {classSummary && (
            <div style={batchStyles.summaryCard}>
              <div style={batchStyles.summaryGrid}>
                <div style={batchStyles.summaryItem}>
                  <div style={batchStyles.summaryValue}>{classSummary.avg}%</div>
                  <div style={batchStyles.summaryLabel}>Average</div>
                </div>
                <div style={batchStyles.summaryItem}>
                  <div style={batchStyles.summaryValue}>{classSummary.median}%</div>
                  <div style={batchStyles.summaryLabel}>Median</div>
                </div>
                <div style={batchStyles.summaryItem}>
                  <div style={batchStyles.summaryValue}>{classSummary.high}%</div>
                  <div style={batchStyles.summaryLabel}>High</div>
                </div>
                <div style={batchStyles.summaryItem}>
                  <div style={batchStyles.summaryValue}>{classSummary.low}%</div>
                  <div style={batchStyles.summaryLabel}>Low</div>
                </div>
              </div>
              <div style={batchStyles.distRow}>
                {["A", "B", "C", "D", "F"].map((g) => (
                  <span key={g} style={{ ...batchStyles.distBadge, color: letterGradeColor(g) }}>
                    {g}: {classSummary.dist[g]}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Results rows */}
          <div style={batchStyles.tableWrap}>
            <table style={batchStyles.table}>
              <thead>
                <tr>
                  <th style={batchStyles.th}>#</th>
                  <th style={{ ...batchStyles.th, textAlign: "left" }}>Student</th>
                  <th style={batchStyles.th}>Pages</th>
                  <th style={batchStyles.th}>Score</th>
                  <th style={batchStyles.th}>%</th>
                  <th style={batchStyles.th}>Grade</th>
                  <th style={{ ...batchStyles.th, textAlign: "left" }}>Comment</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <React.Fragment key={r.index}>
                    <tr
                      style={{
                        ...batchStyles.tr,
                        cursor: "pointer",
                        background:
                          expandedIndex === r.index
                            ? "rgba(37,99,235,0.06)"
                            : r.error
                            ? "rgba(220,38,38,0.05)"
                            : "transparent",
                      }}
                      onClick={() =>
                        setExpandedIndex(expandedIndex === r.index ? null : r.index)
                      }
                    >
                      <td style={batchStyles.td}>{r.index}</td>
                      <td style={{ ...batchStyles.td, fontWeight: 700, textAlign: "left" }}>
                        {r.studentName}
                      </td>
                      <td style={batchStyles.td}>{r.pages}</td>
                      <td style={batchStyles.td}>
                        {r.score}/{r.outOf}
                      </td>
                      <td style={batchStyles.td}>
                        {r.pct != null ? `${r.pct}%` : "—"}
                      </td>
                      <td
                        style={{
                          ...batchStyles.td,
                          fontWeight: 800,
                          color: r.letter !== "?" ? letterGradeColor(r.letter) : "#999",
                        }}
                      >
                        {r.letter}
                      </td>
                      <td
                        style={{
                          ...batchStyles.td,
                          textAlign: "left",
                          maxWidth: 280,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.error ? (
                          <span style={{ color: "#dc2626" }}>Error: {r.error}</span>
                        ) : (
                          r.comment.slice(0, 100)
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedIndex === r.index && !r.error && (
                      <tr>
                        <td colSpan={7} style={batchStyles.expandedTd}>
                          <div style={batchStyles.expandedContent}>
                            {r.comment && (
                              <div style={{ marginBottom: 8 }}>
                                <strong>Comment:</strong> {r.comment}
                              </div>
                            )}
                            {r.strengths.length > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <strong>Strengths:</strong>
                                <ul style={batchStyles.ul}>
                                  {r.strengths.map((s, si) => (
                                    <li key={si}>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {r.improvements.length > 0 && (
                              <div style={{ marginBottom: 6 }}>
                                <strong>Next Steps:</strong>
                                <ul style={batchStyles.ul}>
                                  {r.improvements.map((s, si) => (
                                    <li key={si}>{s}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {Array.isArray(r.sections) && r.sections.length > 0 && (
                              <div>
                                <strong>Sections:</strong>
                                <ul style={batchStyles.ul}>
                                  {r.sections.map((sec, si) => (
                                    <li key={si}>
                                      {sec.name}: {sec.score}/{sec.out_of}
                                      {sec.teacher_comment ? ` — ${sec.teacher_comment}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {!grading && (
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setPdfFile(null);
                  setPdfName("");
                  setPageCount(0);
                  setResults([]);
                  setClassSummary(null);
                  setExpandedIndex(null);
                  pdfDocRef.current = null;
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                style={batchStyles.ghostBtn}
                type="button"
              >
                New Batch
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Styles ----------
const batchStyles = {
  container: {
    borderRadius: 16,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 16,
    background: "white",
    boxShadow: "0 8px 20px rgba(2,6,23,0.06)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  closeBtn: {
    border: "none",
    background: "rgba(15,23,42,0.06)",
    borderRadius: 10,
    width: 32,
    height: 32,
    cursor: "pointer",
    fontSize: 16,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  uploadZone: {
    border: "2px dashed rgba(37,99,235,0.3)",
    borderRadius: 14,
    padding: "32px 20px",
    textAlign: "center",
    cursor: "pointer",
    background: "rgba(37,99,235,0.03)",
    transition: "border-color 0.15s",
  },
  statusBox: {
    padding: "10px 14px",
    borderRadius: 12,
    background: "rgba(15,23,42,0.04)",
    fontSize: 13,
    fontWeight: 600,
    marginTop: 10,
  },
  configSection: {
    marginTop: 10,
    padding: 14,
    borderRadius: 14,
    background: "rgba(15,23,42,0.02)",
    border: "1px solid rgba(15,23,42,0.08)",
  },
  label: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    fontSize: 12,
    fontWeight: 800,
  },
  select: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.15)",
    background: "white",
    fontSize: 14,
    fontWeight: 700,
    minWidth: 160,
  },
  sticky: {
    marginTop: 8,
    fontSize: 12,
    color: "#16a34a",
    fontWeight: 600,
  },
  runBtn: {
    background: "#2563eb",
    color: "white",
    border: "none",
    borderRadius: 12,
    padding: "12px 20px",
    fontWeight: 800,
    fontSize: 15,
    cursor: "pointer",
  },
  ghostBtn: {
    background: "transparent",
    color: "#0b1220",
    border: "1px dashed rgba(15,23,42,0.22)",
    borderRadius: 12,
    padding: "10px 14px",
    fontWeight: 700,
    cursor: "pointer",
    fontSize: 13,
  },
  progressSection: {
    marginTop: 12,
    padding: 14,
    borderRadius: 14,
    background: "rgba(37,99,235,0.04)",
    border: "1px solid rgba(37,99,235,0.12)",
  },
  progressBar: {
    height: 8,
    borderRadius: 4,
    background: "rgba(15,23,42,0.08)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 4,
    background: "#2563eb",
    transition: "width 0.3s ease",
  },
  resultsSection: {
    marginTop: 14,
  },
  resultsHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
    flexWrap: "wrap",
  },
  smallBtn: {
    background: "rgba(15,23,42,0.06)",
    border: "1px solid rgba(15,23,42,0.12)",
    borderRadius: 10,
    padding: "6px 12px",
    fontWeight: 700,
    fontSize: 12,
    cursor: "pointer",
  },
  summaryCard: {
    padding: 14,
    borderRadius: 14,
    background: "linear-gradient(135deg, rgba(37,99,235,0.06), rgba(99,102,241,0.06))",
    border: "1px solid rgba(37,99,235,0.15)",
    marginBottom: 12,
  },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: 12,
    textAlign: "center",
  },
  summaryItem: {},
  summaryValue: {
    fontSize: 22,
    fontWeight: 800,
    color: "#1e40af",
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: 700,
    opacity: 0.6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  distRow: {
    display: "flex",
    justifyContent: "center",
    gap: 14,
    marginTop: 10,
  },
  distBadge: {
    fontWeight: 800,
    fontSize: 13,
  },
  tableWrap: {
    overflowX: "auto",
    borderRadius: 12,
    border: "1px solid rgba(15,23,42,0.1)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
  },
  th: {
    padding: "8px 10px",
    fontWeight: 800,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "rgba(15,23,42,0.55)",
    borderBottom: "1px solid rgba(15,23,42,0.1)",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
  tr: {
    borderBottom: "1px solid rgba(15,23,42,0.06)",
  },
  td: {
    padding: "8px 10px",
    textAlign: "center",
    verticalAlign: "top",
  },
  expandedTd: {
    padding: "0 10px 12px",
    background: "rgba(37,99,235,0.03)",
  },
  expandedContent: {
    padding: "10px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    borderRadius: 10,
    background: "white",
    border: "1px solid rgba(15,23,42,0.08)",
  },
  ul: {
    margin: "4px 0 0 16px",
    padding: 0,
    listStyleType: "disc",
  },
};
