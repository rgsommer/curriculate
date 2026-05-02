"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildResultsPdf, buildStripsPdf, preloadPdfLibs } from "./pdfReports";

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

// NOTE: QR code loader, jsPDF loader, buildResultsPdf, and buildStripsPdf
// have been moved to ./pdfReports.js (shared with page.jsx session reports).

// ---------- PDF.js loader (self-hosted proxy → CDN fallback) ----------
// Uses the legacy UMD build (3.x) which sets window.pdfjsLib via <script>
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
      // Worker URL: prefer proxy, fall back to CDN
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
          // Use matching worker source (proxy vs CDN)
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

// Render a single PDF page to a JPEG data URL
async function renderPageToDataUrl(pdfDoc, pageNum, scale = 1.5, extraRotation = 0) {
  const page = await pdfDoc.getPage(pageNum);
  // Let pdf.js handle /Rotate metadata entirely on its own — do NOT pass rotation.
  // pdf.js defaults to page.rotate internally and handles content stream transforms.
  // Passing it explicitly can cause double-rotation if the PDF tool also adjusted the
  // content stream (some rotation utilities do both /Rotate + cm transform).
  const pageRotate = page.rotate || 0;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;

  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Apply extra rotation (from AI detection) by physically rotating canvas pixels.
  // This is bulletproof — works regardless of how pdf.js handles rotation internally.
  const effectiveExtra = ((extraRotation % 360) + 360) % 360;
  if (effectiveExtra !== 0) {
    console.log(`[renderPage] page ${pageNum}: page.rotate=${pageRotate}, extraRotation=${extraRotation} — applying canvas rotation`);
    const rotCanvas = document.createElement("canvas");
    const rotCtx = rotCanvas.getContext("2d");
    if (effectiveExtra === 180) {
      rotCanvas.width = canvas.width;
      rotCanvas.height = canvas.height;
      rotCtx.translate(canvas.width / 2, canvas.height / 2);
      rotCtx.rotate(Math.PI);
      rotCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    } else if (effectiveExtra === 90) {
      rotCanvas.width = canvas.height;
      rotCanvas.height = canvas.width;
      rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      rotCtx.rotate(Math.PI / 2);
      rotCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    } else if (effectiveExtra === 270) {
      rotCanvas.width = canvas.height;
      rotCanvas.height = canvas.width;
      rotCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      rotCtx.rotate(3 * Math.PI / 2);
      rotCtx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    }
    return rotCanvas.toDataURL("image/jpeg", 0.85);
  }

  if (pageRotate !== 0) {
    console.log(`[renderPage] page ${pageNum}: page.rotate=${pageRotate} (handled by pdf.js viewport)`);
  }

  // Compress to JPEG
  return canvas.toDataURL("image/jpeg", 0.85);
}

// ── Structural fingerprinting for page boundary detection ──
// Renders a page region to a tiny grayscale grid and returns pixel values.
// Used to compare page headers against a reference "page 1" deterministically.
async function getPageFingerprint(pdfDoc, pageNum, region = "top") {
  const page = await pdfDoc.getPage(pageNum);
  const scale = 0.4; // low res but enough for structural comparison
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;

  // Extract the region of interest — top 35% captures school header + name field + title
  const regionH = region === "top" ? Math.round(canvas.height * 0.35) : canvas.height;
  const regionY = 0;

  // Downsample to a grid (32 wide, proportional height)
  const gridW = 32;
  const gridH = Math.max(1, Math.round((regionH / canvas.width) * gridW));
  const tiny = document.createElement("canvas");
  tiny.width = gridW;
  tiny.height = gridH;
  const tctx = tiny.getContext("2d");
  tctx.drawImage(canvas, 0, regionY, canvas.width, regionH, 0, 0, gridW, gridH);

  // Get grayscale pixel values
  const imgData = tctx.getImageData(0, 0, gridW, gridH);
  const gray = [];
  for (let i = 0; i < imgData.data.length; i += 4) {
    gray.push(0.299 * imgData.data[i] + 0.587 * imgData.data[i + 1] + 0.114 * imgData.data[i + 2]);
  }

  // Also compute variance for blank detection
  const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
  const variance = gray.reduce((a, v) => a + (v - mean) ** 2, 0) / gray.length;

  return { pixels: gray, variance, mean };
}

// Compute normalized cross-correlation between two fingerprints (0 = no match, 1 = identical)
function fingerprintSimilarity(fp1, fp2) {
  const a = fp1.pixels || fp1, b = fp2.pixels || fp2;
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  const n = a.length;
  let sum1 = 0, sum2 = 0;
  for (let i = 0; i < n; i++) { sum1 += a[i]; sum2 += b[i]; }
  const mean1 = sum1 / n, mean2 = sum2 / n;
  let num = 0, den1 = 0, den2 = 0;
  for (let i = 0; i < n; i++) {
    const d1 = a[i] - mean1, d2 = b[i] - mean2;
    num += d1 * d2;
    den1 += d1 * d1;
    den2 += d2 * d2;
  }
  const den = Math.sqrt(den1 * den2);
  return den === 0 ? 0 : num / den;
}

// Check if a page is blank by looking at pixel variance
function isBlankFingerprint(fp) {
  const v = fp?.variance ?? 0;
  return v < 10; // very low variance = nearly uniform = blank (lowered from 50)
}

// Detect student boundaries by fingerprinting page headers. Returns array of
// groups (or null if the reference page is blank).
//
// Two passes: first against page 1 of student 1, then a multi-anchor refinement
// where every page that confidently matched the reference becomes an additional
// anchor. A page's final score is the MAX similarity across all anchors. This
// catches printed page-1's that scored low against the single reference because
// of scan offset, smudges, or margin handwriting — they tend to match a
// neighbouring student's page-1 cleanly.
async function detectStudentGroupsByFingerprint(doc, { pageCount, answerKeyPages, logPrefix = "[fp]" }) {
  const firstStudentPage = answerKeyPages + 1;
  console.log(`${logPrefix} fingerprinting ${pageCount} pages (reference: page ${firstStudentPage})`);

  const refFp = await getPageFingerprint(doc, firstStudentPage, "top");
  if (isBlankFingerprint(refFp)) {
    console.log(`${logPrefix} reference page ${firstStudentPage} is blank — cannot fingerprint`);
    return null;
  }

  // Pass 1: fingerprint each page, score against the single reference.
  const entries = [{ page: firstStudentPage, fp: refFp, sim: 1.0, blank: false }];
  for (let p = firstStudentPage + 1; p <= pageCount; p++) {
    const fp = await getPageFingerprint(doc, p, "top");
    const blank = isBlankFingerprint(fp);
    const sim = blank ? 0 : fingerprintSimilarity(refFp, fp);
    entries.push({ page: p, fp, sim, blank });
  }

  // Pass 2: multi-anchor max-similarity refinement.
  const ANCHOR_MIN = 0.85;
  const anchorFps = entries.filter(e => !e.blank && e.sim >= ANCHOR_MIN).map(e => e.fp);
  if (anchorFps.length > 1) {
    let lifted = 0;
    for (const e of entries) {
      if (e.blank || e.sim >= ANCHOR_MIN) continue;
      const before = e.sim;
      let best = before;
      for (const aFp of anchorFps) {
        const s = fingerprintSimilarity(aFp, e.fp);
        if (s > best) best = s;
      }
      if (best > before) {
        e.sim = best;
        if (best >= ANCHOR_MIN) lifted++;
      }
    }
    console.log(`${logPrefix} multi-anchor pass: ${anchorFps.length} anchors, lifted ${lifted} borderline page(s) above ${ANCHOR_MIN}`);
  }

  const simLog = entries.map(e =>
    `p${e.page}:${e.blank ? "BLANK" : e.sim.toFixed(2)}`
  ).join(" ");
  console.log(`${logPrefix} similarities: ${simLog}`);

  // Auto-calibrate threshold from the largest gap above 0.5
  const nonBlankSims = entries.filter(e => !e.blank && e.page !== firstStudentPage).map(e => e.sim);
  nonBlankSims.sort((a, b) => a - b);
  let threshold = 0.75;
  if (nonBlankSims.length > 2) {
    let maxGap = 0, gapIdx = -1;
    for (let i = 0; i < nonBlankSims.length - 1; i++) {
      const gap = nonBlankSims[i + 1] - nonBlankSims[i];
      if (gap > maxGap && nonBlankSims[i + 1] > 0.5) { maxGap = gap; gapIdx = i; }
    }
    if (maxGap > 0.08 && gapIdx >= 0) {
      threshold = (nonBlankSims[gapIdx] + nonBlankSims[gapIdx + 1]) / 2;
      console.log(`${logPrefix} auto-calibrated threshold: ${threshold.toFixed(3)} (gap of ${maxGap.toFixed(3)})`);
    }
  }

  const groups = [];
  let current = null;
  for (let p = 1; p <= pageCount; p++) {
    if (p <= answerKeyPages) continue;
    const entry = entries.find(e => e.page === p);
    const isNewStudent = entry && !entry.blank && entry.sim >= threshold;
    if (isNewStudent) {
      if (current) groups.push(current);
      current = { startPage: p, endPage: p, pages: [p] };
    } else if (current) {
      current.endPage = p;
      current.pages.push(p);
    } else {
      current = { startPage: p, endPage: p, pages: [p] };
    }
  }
  if (current) groups.push(current);

  console.log(`${logPrefix} fingerprint detected ${groups.length} students`);
  return groups;
}

// Retry wrapper for network-flaky environments (classrooms, tablets on wifi)
async function fetchWithRetry(url, options, { retries = 2, baseDelay = 2000 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt); // 2s, 4s
      console.warn(`[batch] fetch attempt ${attempt + 1} failed, retrying in ${delay}ms:`, err.message);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
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

// KITA (Ontario achievement categories) detection and weighting
const KITA_NAMES = ["Knowledge & Understanding", "Thinking", "Communication", "Application"];
const KITA_SHORT = ["K", "T", "C", "A"];

function detectKita(raw) {
  if (!raw || !Array.isArray(raw.sections) || !raw.sections.length) return null;
  const matched = [];
  for (const s of raw.sections) {
    const n = (s?.name || "").trim().toLowerCase();
    const idx = KITA_NAMES.findIndex((k) => n.startsWith(k.toLowerCase().slice(0, 8)));
    if (idx === -1) return null; // non-KITA section — not a KITA response
    matched.push({
      kitaIndex: idx,
      name: KITA_NAMES[idx],
      short: KITA_SHORT[idx],
      score: Number(s.score) || 0,
      outOf: Number(s.out_of) || 5,
      comment: s.teacher_comment || "",
    });
  }
  return matched.length ? matched : null;
}

const KITA_WEIGHTS_ALL = {
  "9-10": [25, 25, 25, 25],
  "11+": [20, 30, 20, 30],
};

function getKitaWeights(band, kita) {
  const allW = KITA_WEIGHTS_ALL[band] || [25, 25, 25, 25];
  return kita.map((cat) => allW[cat.kitaIndex]);
}

function computeKitaWeightedPercent(kita, weights) {
  let totalWeighted = 0;
  let totalWeight = 0;
  for (let i = 0; i < kita.length; i++) {
    const pct = kita[i].outOf > 0 ? (kita[i].score / kita[i].outOf) : 0;
    totalWeighted += pct * weights[i];
    totalWeight += weights[i];
  }
  if (totalWeight > 0 && totalWeight !== 100) {
    return Math.round((totalWeighted / totalWeight) * 100);
  }
  return Math.round(totalWeighted);
}

// Build a rich text payload for the results portal (matches single-grading format)
function buildBatchPayloadText(result, refCode, gradeBandForKita) {
  const a = result.raw || {};
  const lines = [];

  // Grade line
  lines.push(`Grade: ${result.score} / ${result.outOf}${refCode ? `  Ref: ${refCode}` : ""}`);
  lines.push("");

  if (refCode) {
    lines.push(`View feedback online: www.curriculate.net/results (code: ${refCode})`);
    lines.push("");
  }

  // Deductions
  if (Array.isArray(a.deductions) && a.deductions.length) {
    const d0 = a.deductions[0];
    const reason = String(d0?.reason || "").trim();
    if (reason) {
      const pts = d0?.points;
      const ptsStr = typeof pts === "number" ? ` (${pts > 0 ? "+" : ""}${pts})` : "";
      lines.push("Deduction:");
      lines.push(`- ${reason}${ptsStr}`);
      lines.push("");
    }
  }

  // Strengths
  if (Array.isArray(a.strengths) && a.strengths.length) {
    lines.push("Strengths:");
    a.strengths.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  // Next Steps (improvements)
  if (Array.isArray(a.improvements) && a.improvements.length) {
    lines.push("Next Steps:");
    a.improvements.forEach((s) => lines.push(`- ${s}`));
    lines.push("");
  }

  // Soft KITA summary (advisory, non-scoring)
  if (Array.isArray(a.achievement_summary) && a.achievement_summary.length) {
    const knownShort = {
      "Knowledge & Understanding": "K", "Thinking": "T", "Communication": "C", "Application": "A",
      "Knowledge & Recall (AO1)": "AO1", "Analysis & Application (AO2)": "AO2",
      "Evaluation & Context (AO3)": "AO3", "Technical Accuracy (AO4)": "AO4",
    };
    lines.push("Achievement Categories:");
    a.achievement_summary.forEach((k) => {
      const short = knownShort[k.category] || (k.category || "").split(/\s+/).map((w) => w[0]).join("").slice(0, 3).toUpperCase();
      const scoreStr = typeof k.score === "number" && typeof k.out_of === "number" ? ` ${k.score.toFixed(2)}/${k.out_of.toFixed(2)}` : "";
      lines.push(`- ${short} ${k.category}${scoreStr} [${k.level}]: ${k.comment}`);
    });
    lines.push("");
  }

  // Overall comment
  if (String(a.teacher_comment || "").trim()) {
    lines.push("Overall Comment:");
    lines.push(String(a.teacher_comment).trim());
    lines.push("");
  }

  // Sections + incorrect items (with KITA detection)
  const kita = detectKita(a);
  if (kita) {
    const weights = getKitaWeights(gradeBandForKita, kita);
    const weightedPct = computeKitaWeightedPercent(kita, weights);
    lines.push("Achievement Categories (KITA):");
    kita.forEach((cat, i) => {
      lines.push(
        `- ${cat.short} ${cat.name}: ${cat.score}/${cat.outOf} (${weights[i]}%)${
          cat.comment ? ` — ${cat.comment}` : ""
        }`
      );
    });
    lines.push(`Weighted Total: ${weightedPct}%`);
    lines.push("");
  } else if (Array.isArray(a.sections) && a.sections.length) {
    lines.push("Sections:");
    a.sections.forEach((sec) => {
      lines.push(
        `- ${sec.name}: ${sec.score}/${sec.out_of}${
          sec.teacher_comment ? ` — ${String(sec.teacher_comment).trim()}` : ""
        }`
      );
      if (Array.isArray(sec.incorrect_items) && sec.incorrect_items.length) {
        lines.push("  Incorrect:");
        sec.incorrect_items.forEach((it, idx) => {
          const p = String(it?.prompt || `Item ${idx + 1}`).trim();
          const sa = String(it?.student_answer || "—").trim();
          const ca = String(it?.correct_answer || "—").trim();
          lines.push(`  - ${p} (you: ${sa}; correct: ${ca})`);
        });
      }
    });
    lines.push("");
  }

  // Saved captures (image links from S3)
  const imgLinks = Array.isArray(a.assignment_images) ? a.assignment_images : [];
  if (imgLinks.length) {
    lines.push("Saved captures (30-day links):");
    imgLinks.forEach((img) => lines.push(`Photo ${img.index}: ${img.url}`));
    lines.push("");
  }

  return lines.join("\n").trim();
}

export default function BatchGrading({
  gradingUrl,
  resultsUrl,
  gradeBand,
  standards,
  subjectArea,
  feedbackVoice,
  voiceMode,
  perQuestionAudit,
  rubricOverride,
  answerKeyOverride,
  teacherEmail: parentTeacherEmail,
  setTeacherEmail: parentSetTeacherEmail,
  rosterClasses: parentRosterClasses,
  setRosterClasses: parentSetRosterClasses,
  onClose,
}) {
  // Preload jsPDF + qrcode CDN scripts as soon as batch mode opens
  useEffect(() => { preloadPdfLibs(); }, []);

  const [pdfFile, setPdfFile] = useState(null);
  const [pdfName, setPdfName] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pagesPerStudent, setPagesPerStudent] = useState("auto"); // number, "auto", or "tap"
  const [precisionMode, setPrecisionMode] = useState(false); // multi-pass median scoring
  const PRECISION_PASSES = 3; // number of AI passes per student in precision mode
  const [answerKeyPages, setAnswerKeyPages] = useState(0); // leading pages that are the answer key
  const [tapMarkedPages, setTapMarkedPages] = useState(new Set()); // pages marked as "first page" in tap mode
  const [thumbnails, setThumbnails] = useState([]); // [{page, dataUrl}] for tap mode

  const [extractedAnswerKey, setExtractedAnswerKey] = useState(answerKeyOverride || "");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  const [grading, setGrading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [results, setResults] = useState([]); // { index, studentName, score, outOf, pct, letter, strengths, improvements, comment, error }
  const [classSummary, setClassSummary] = useState(null);
  const [teacherAnalysis, setTeacherAnalysis] = useState(""); // AI-generated class analysis

  // Auto-detect page grouping
  const [detectedGroups, setDetectedGroups] = useState(null); // [{ startPage, endPage, pages: [...] }, ...]
  const [detecting, setDetecting] = useState(false);
  const [rotatedPages, setRotatedPages] = useState({}); // { pageNum: true } — pages detected as upside-down
  const [rotationMsg, setRotationMsg] = useState(""); // brief status: "Rotating upside-down pages..."
  const [scanTipVisible, setScanTipVisible] = useState(false); // "scan in any orientation" tip

  const pdfDocRef = useRef(null);
  const abortRef = useRef(false);
  const fileInputRef = useRef(null);

  // ---------- Edsby Class Roster (state declared early — used in grading callback) ----------
  const [editingNameIndex, setEditingNameIndex] = useState(null); // index of result whose name is being edited
  const [denomPrompt, setDenomPrompt] = useState(null); // { denoms: [56, 46], show: true } — mixed denominator prompt
  const [editingDenom, setEditingDenom] = useState(false); // inline denom editor active
  const [denomInput, setDenomInput] = useState(""); // value in the denom editor
  const [detectedBatchClass, setDetectedBatchClass] = useState(null); // class name detected from roster matching
  const classChangeCountRef = useRef(0); // tracks manual class changes to offer bulk update
  const [detectedBatchRosterId, setDetectedBatchRosterId] = useState(null); // roster ID detected from matching
  const [showRoster, setShowRoster] = useState(false);
  const [showManualRoster, setShowManualRoster] = useState(false);
  const [manualRosterText, setManualRosterText] = useState("");
  const [manualClassName, setManualClassName] = useState("");
  const [manualRosterPreview, setManualRosterPreview] = useState(null); // [{firstName, lastName, studentId}]
  const [localRosterClasses, localSetRosterClasses] = useState([]); // fallback if no parent props
  const rosterClasses = parentRosterClasses || localRosterClasses;
  const setRosterClasses = parentSetRosterClasses || localSetRosterClasses;
  const [rosterUploading, setRosterUploading] = useState(false);
  const [rosterLoading, setRosterLoading] = useState(false);
  const rosterFileRef = useRef(null);

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
    setStudentBias({});
    setClassSummary(null);
    setTeacherAnalysis("");
    setDetectedGroups(null);
    setRotatedPages({});

    try {
      const pdfjsLib = await loadPdfJs();
      const arrayBuf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
      pdfDocRef.current = doc;
      setPageCount(doc.numPages);
      setPdfFile(file);

      // ── Deterministic rotation consistency check ──
      // If a rotation utility set /Rotate on SOME pages but not all (buggy utility),
      // the pages without metadata need extra rotation to match.
      // ADF scanners produce ALL pages in the same orientation, so if any page
      // has /Rotate≠0, the pages without it are in the wrong orientation.
      const rotationMap = {};
      let hasRotated = false;
      let hasUnrotated = false;
      for (let p = 1; p <= doc.numPages; p++) {
        const pg = await doc.getPage(p);
        const r = pg.rotate || 0;
        rotationMap[p] = r;
        if (r !== 0) hasRotated = true;
        else hasUnrotated = true;
      }
      if (hasRotated && hasUnrotated) {
        // Mixed rotation — find the majority rotation and flag the outliers
        const counts = {};
        Object.values(rotationMap).forEach(r => { counts[r] = (counts[r] || 0) + 1; });
        const majorityRotation = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
        const needsExtra = {};
        for (const [p, r] of Object.entries(rotationMap)) {
          if (r !== majorityRotation) {
            // This page is missing the rotation that most pages have — needs extra rotation
            needsExtra[Number(p)] = true;
          }
        }
        const fixCount = Object.keys(needsExtra).length;
        console.log(`[batch] rotation consistency: ${fixCount} page(s) missing /Rotate=${majorityRotation} — will auto-rotate`);
        setRotatedPages(needsExtra);
        setRotationMsg(`Fixing orientation on ${fixCount} page${fixCount > 1 ? "s" : ""}...`);
        setTimeout(() => setRotationMsg(""), 3000);
      } else if (hasRotated) {
        console.log(`[batch] all pages have consistent rotation metadata — pdf.js handles natively`);
      } else {
        // No rotation metadata at all (page.rotate=0 on all pages).
        // Content might still be physically upside down from the scanner.
        // Fire a dedicated AI rotation check asynchronously.
        (async () => {
          try {
            if (!gradingUrl) return;
            setRotationMsg("Checking page orientation...");
            // Pick 2 content-rich pages (skip every other for blank backs)
            const checkPages = [];
            for (let p = 1; p <= doc.numPages && checkPages.length < 2; p += 2) {
              checkPages.push(p);
            }
            // Render at higher resolution for reliable detection
            const checkImages = [];
            for (const p of checkPages) {
              const pg = await doc.getPage(p);
              const vp = pg.getViewport({ scale: 1.2 });
              const cvs = document.createElement("canvas");
              cvs.width = vp.width;
              cvs.height = vp.height;
              const cx = cvs.getContext("2d");
              await pg.render({ canvasContext: cx, viewport: vp }).promise;
              checkImages.push(cvs.toDataURL("image/jpeg", 0.9));
            }
            const checkUrl = gradingUrl.replace(/\/grading$/, "/grading/check-rotation");
            const checkRes = await fetch(checkUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ images: checkImages }),
            });
            if (checkRes.ok) {
              const checkData = await checkRes.json();
              if (checkData.rotated) {
                console.log(`[batch] rotation check: pages are upside down — marking ALL ${doc.numPages} pages for rotation`);
                const allRotated = {};
                for (let p = 1; p <= doc.numPages; p++) allRotated[p] = true;
                setRotatedPages(allRotated);
                setRotationMsg(`Rotating ${doc.numPages} upside-down pages...`);
                setTimeout(() => setRotationMsg(""), 3000);
                return;
              }
            }
            setRotationMsg("");
          } catch (err) {
            console.warn("[batch] rotation check failed:", err.message);
            setRotationMsg("");
          }
        })();
      }

      setLoading(false);
    } catch (err) {
      console.error("PDF load error:", err);
      setLoadError("Could not read PDF. Make sure it's a valid PDF file.");
      setLoading(false);
    }
  }, [gradingUrl]);

  // ---------- Student count ----------
  const isAuto = pagesPerStudent === "auto";
  const isTap = pagesPerStudent === "tap";
  const fixedPps = isAuto || isTap ? 1 : Number(pagesPerStudent);
  // Pages available for student work (after answer key pages)
  const studentPages = Math.max(0, pageCount - answerKeyPages);
  const studentCount = detectedGroups
    ? detectedGroups.length
    : isTap
    ? tapMarkedPages.size
    : studentPages > 0
    ? Math.ceil(studentPages / fixedPps)
    : 0;

  // ---------- Tap mode: generate thumbnails ----------
  useEffect(() => {
    if (!isTap || !pdfDocRef.current || pageCount === 0) return;
    let cancelled = false;
    (async () => {
      const doc = pdfDocRef.current;
      const thumbs = [];
      for (let p = 1; p <= pageCount; p++) {
        if (cancelled) return;
        const dataUrl = await renderPageToDataUrl(doc, p, 0.3);
        thumbs.push({ page: p, dataUrl });
      }
      if (!cancelled) setThumbnails(thumbs);
    })();
    return () => { cancelled = true; };
  }, [isTap, pageCount]);

  // Build groups from tap-marked pages
  const tapGroups = useMemo(() => {
    if (!isTap || tapMarkedPages.size === 0) return null;
    const sorted = [...tapMarkedPages]
      .filter(p => p > answerKeyPages)
      .sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const groups = [];
    for (let i = 0; i < sorted.length; i++) {
      const start = sorted[i];
      const end = i + 1 < sorted.length ? sorted[i + 1] - 1 : pageCount;
      const pages = [];
      for (let p = start; p <= end; p++) pages.push(p);
      groups.push({ startPage: start, endPage: end, pages });
    }
    return groups;
  }, [isTap, tapMarkedPages, answerKeyPages, pageCount]);

  // ---------- Auto-detect page boundaries ----------
  const runAutoDetect = useCallback(async () => {
    const doc = pdfDocRef.current;
    if (!doc) return;

    setDetecting(true);
    setDetectedGroups(null);

    try {
      // ── Phase 1: Deterministic structural fingerprinting ──
      // Compare the top 30% of each page (header region) to page 1's header.
      // Pages with high structural similarity = new student (same printed template).
      // This is fast, deterministic, and doesn't require AI.
      const fpGroups = await detectStudentGroupsByFingerprint(doc, {
        pageCount,
        answerKeyPages,
        logPrefix: "[auto-detect]",
      });

      if (fpGroups) {
        // If fingerprinting found reasonable groups (more than 1 student), use them
        if (fpGroups.length > 1) {
          setDetectedGroups(fpGroups);
          setDetecting(false);

          // Try to read student names from the detected page-1 images via AI
          // (non-blocking, runs in background after groups are set)
          if (gradingUrl) {
            try {
              const namePages = fpGroups.map(g => g.startPage);
              const nameImages = [];
              for (const p of namePages) {
                nameImages.push(await renderPageToDataUrl(doc, p, 0.5));
              }
              const nameUrl = gradingUrl.replace(/\/grading$/, "/grading/classify-pages");
              const nameRes = await fetchWithRetry(nameUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageImages: nameImages, answerKeyPages: 0 }),
              });
              if (nameRes.ok) {
                const nameData = await nameRes.json();
                if (Array.isArray(nameData.classifications)) {
                  const updatedGroups = fpGroups.map((g, i) => {
                    const c = nameData.classifications[i];
                    if (c?.name) return { ...g, name: String(c.name).trim() };
                    return g;
                  });
                  setDetectedGroups(updatedGroups);
                  console.log(`[auto-detect] names enriched:`, updatedGroups.map(g => g.name || "?").join(", "));
                }
              }
            } catch (nameErr) {
              console.warn("[auto-detect] name extraction failed (non-critical):", nameErr.message);
            }
          }
          return;
        }
      }

      // ── Phase 2: Fall back to AI classification ──
      // Only if fingerprinting failed (e.g., freeform assignments with no printed template)
      console.log("[auto-detect] fingerprinting found ≤1 group, falling back to AI classification");
      if (!gradingUrl) { setDetecting(false); return; }

      const thumbs = [];
      for (let p = 1; p <= pageCount; p++) {
        thumbs.push(await renderPageToDataUrl(doc, p, 0.8));
      }

      const classifyUrl = gradingUrl.replace(/\/grading$/, "/grading/classify-pages");
      const res = await fetchWithRetry(classifyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageImages: thumbs, answerKeyPages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        console.warn("[batch] classify-pages failed:", err);
        setDetecting(false);
        return;
      }

      const data = await res.json();
      if (Array.isArray(data.groups) && data.groups.length > 0) {
        setDetectedGroups(data.groups);
      }
      // Merge AI-detected rotation with consistency-check rotation
      if (data.rotatedPages && typeof data.rotatedPages === "object") {
        setRotatedPages(prev => {
          const merged = { ...prev, ...data.rotatedPages };
          const rotCount = Object.keys(merged).length;
          if (rotCount > 0) {
            console.log(`[batch] ${rotCount} upside-down page(s) detected — will auto-rotate`);
            setRotationMsg(`Rotating ${rotCount} upside-down page${rotCount > 1 ? "s" : ""}...`);
            setTimeout(() => setRotationMsg(""), 3000);
          }
          return merged;
        });
      }
    } catch (e) {
      console.warn("[batch] auto-detect failed:", e);
    }

    setDetecting(false);
  }, [pageCount, answerKeyPages, gradingUrl]);

  // ---------- Precision mode: merge N results into one via median scoring ----------
  function mergeMultiPassResults(passes) {
    if (!passes || passes.length === 0) return passes[0];
    if (passes.length === 1) return passes[0];

    // Filter out errored passes
    const valid = passes.filter(p => !p.error);
    if (valid.length === 0) return passes[0]; // all errored — return first
    if (valid.length === 1) return valid[0];

    const median = (nums) => {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    // Median overall score
    const scores = valid.map(p => Number(p.score)).filter(Number.isFinite);
    const outOfs = valid.map(p => Number(p.outOf)).filter(Number.isFinite);
    const medianScore = scores.length > 0 ? Math.round(median(scores) * 10) / 10 : valid[0].score;
    const medianOutOf = outOfs.length > 0 ? Math.round(median(outOfs)) : valid[0].outOf;
    const medianPct = Number.isFinite(medianScore) && Number.isFinite(medianOutOf) && medianOutOf > 0
      ? Math.round((medianScore / medianOutOf) * 100) : null;

    // Merge per-section scores via median
    let mergedSections = null;
    const sectionedPasses = valid.filter(p => Array.isArray(p.sections) && p.sections.length > 0);
    if (sectionedPasses.length > 0) {
      // Use first pass's structure as template
      const template = sectionedPasses[0].sections;
      mergedSections = template.map((sec, si) => {
        const sectionScores = sectionedPasses
          .map(p => p.sections[si] ? Number(p.sections[si].score) : NaN)
          .filter(Number.isFinite);
        const sectionOutOfs = sectionedPasses
          .map(p => p.sections[si] ? Number(p.sections[si].out_of) : NaN)
          .filter(Number.isFinite);
        const secMedianScore = sectionScores.length > 0 ? Math.round(median(sectionScores) * 10) / 10 : sec.score;
        const secMedianOutOf = sectionOutOfs.length > 0 ? Math.round(median(sectionOutOfs)) : sec.out_of;

        // Pick feedback from the pass whose section score is closest to the median
        let bestFeedback = sec.feedback || "";
        let bestDist = Infinity;
        for (const p of sectionedPasses) {
          if (p.sections[si]) {
            const dist = Math.abs(Number(p.sections[si].score) - secMedianScore);
            if (dist < bestDist) {
              bestDist = dist;
              bestFeedback = p.sections[si].feedback || bestFeedback;
            }
          }
        }

        return { ...sec, score: secMedianScore, out_of: secMedianOutOf, feedback: bestFeedback };
      });
    }

    // Pick the pass whose overall score is closest to the median for text fields
    let bestPass = valid[0];
    let bestDist = Infinity;
    for (const p of valid) {
      const dist = Math.abs(Number(p.score) - medianScore);
      if (dist < bestDist) {
        bestDist = dist;
        bestPass = p;
      }
    }

    // Compute agreement: how close the passes were (for confidence indicator)
    const scoreRange = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
    const agreement = medianOutOf > 0 ? Math.max(0, 100 - Math.round((scoreRange / medianOutOf) * 100)) : 100;

    return {
      ...bestPass,
      score: Number.isFinite(medianScore) ? medianScore : "?",
      outOf: Number.isFinite(medianOutOf) ? medianOutOf : "?",
      pct: medianPct,
      letter: medianPct != null ? letterGrade(medianPct) : "?",
      sections: mergedSections || bestPass.sections,
      strengths: bestPass.strengths,
      improvements: bestPass.improvements,
      comment: bestPass.comment,
      precisionPasses: passes.length,
      precisionAgreement: agreement,
      precisionScores: scores,  // individual pass scores for display
    };
  }

  // ---------- Run batch grading ----------
  const runBatch = useCallback(async () => {
    const doc = pdfDocRef.current;
    if (!doc || !gradingUrl) return;

    abortRef.current = false;
    setGrading(true);
    setResults([]);
    setStudentBias({});
    setClassSummary(null);

    // --- Use tap-marked groups if in tap mode ---
    if (isTap && tapGroups) {
      setDetectedGroups(tapGroups);
    }

    // --- Auto-detect if needed and not already done ---
    let groups = isTap ? tapGroups : detectedGroups;
    let autoDetectedKeyPages = []; // answer key pages found anywhere in the PDF
    let localRotatedPages = { ...rotatedPages }; // local copy for use in grading loop
    if (isAuto && !groups) {
      setProgress({ done: 0, total: 0, current: `Analyzing ${pageCount} pages — detecting student boundaries...` });

      // Use deterministic fingerprinting first
      try {
        const fpGroups = await detectStudentGroupsByFingerprint(doc, {
          pageCount,
          answerKeyPages,
          logPrefix: "[batch]",
        });
        if (fpGroups && fpGroups.length > 1) {
          groups = fpGroups;
          setDetectedGroups(groups);
        }
      } catch (fpErr) {
        console.warn("[batch] fingerprint detection failed:", fpErr);
      }

      // Fall back to AI classification if fingerprinting didn't work
      if (!groups && gradingUrl) {
        try {
          const thumbs = [];
          for (let p = 1; p <= pageCount; p++) {
            thumbs.push(await renderPageToDataUrl(doc, p, 0.8));
          }
          const classifyUrl = gradingUrl.replace(/\/grading$/, "/grading/classify-pages");
          const classifyRes = await fetchWithRetry(classifyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageImages: thumbs, answerKeyPages }),
          });
          if (classifyRes.ok) {
            const classifyData = await classifyRes.json();
            if (Array.isArray(classifyData.groups) && classifyData.groups.length > 0) {
              groups = classifyData.groups;
              setDetectedGroups(groups);
            }
            if (Array.isArray(classifyData.answerKeyPages) && classifyData.answerKeyPages.length > 0) {
              autoDetectedKeyPages = classifyData.answerKeyPages;
            }
            if (classifyData.rotatedPages && typeof classifyData.rotatedPages === "object") {
              const merged = { ...localRotatedPages, ...classifyData.rotatedPages };
              localRotatedPages = merged;
              setRotatedPages(merged);
            }
          }
        } catch (e) {
          console.warn("[batch] AI classification failed:", e);
        }
      }

      // If all detection failed, fall back to 1 page per student
      if (!groups) {
        groups = [];
        for (let p = answerKeyPages + 1; p <= pageCount; p++) {
          groups.push({ startPage: p, endPage: p, pages: [p] });
        }
      }
    }

    // Build student page groups (fixed or auto-detected)
    const studentGroups = (groups || (() => {
      const g = [];
      const firstStudentPage = answerKeyPages + 1;
      for (let i = 0; i < studentCount; i++) {
        const start = firstStudentPage + i * fixedPps;
        const end = Math.min(start + fixedPps - 1, pageCount);
        g.push({ startPage: start, endPage: end, pages: Array.from({ length: end - start + 1 }, (_, k) => start + k) });
      }
      return g;
    })()).filter(g => {
      // Filter out groups where ALL pages are out of range
      const validPages = g.pages.filter(p => p >= 1 && p <= pageCount);
      if (validPages.length === 0) {
        console.warn(`[batch] dropping group with pages ${g.pages.join(",")} — all out of range (PDF has ${pageCount} pages)`);
        return false;
      }
      return true;
    });

    const total = studentGroups.length;
    setProgress({ done: 0, total, current: "Preparing..." });

    const batchSessionId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const batchResults = [];

    // --- Extract answer key from leading pages OR auto-detected key pages ---
    let effectiveAnswerKey = extractedAnswerKey || "";
    let answerKeyImages = null;

    // Determine which pages to use as answer key
    const keyPageNumbers = answerKeyPages > 0
      ? Array.from({ length: answerKeyPages }, (_, i) => i + 1) // leading pages (manual config)
      : autoDetectedKeyPages; // auto-detected (may be at end of PDF)

    if (keyPageNumbers.length > 0 && !effectiveAnswerKey) {
      setProgress({ done: 0, total, current: "Extracting answer key..." });
      try {
        const akImages = [];
        for (const p of keyPageNumbers) {
          if (p >= 1 && p <= pageCount) {
            const rotation = localRotatedPages[p] ? 180 : 0;
            akImages.push(await renderPageToDataUrl(doc, p, 1.5, rotation));
          }
        }
        answerKeyImages = akImages;

        // Call answer key extraction endpoint
        const extractUrl = gradingUrl.replace(/\/grading$/, "/grading/extract-answer-key");
        const extractRes = await fetch(extractUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answerKeyImages: akImages, standards, gradeBand }),
        });
        if (extractRes.ok) {
          const extractData = await extractRes.json();
          if (extractData.answerKeyText) {
            effectiveAnswerKey = extractData.answerKeyText;
            setExtractedAnswerKey(effectiveAnswerKey);
          }
        }
      } catch (e) {
        console.warn("[batch] answer key extraction failed:", e);
      }
    }

    const effectiveRubric = (rubricOverride || "").trim();

    // Grade a single student — returns a result entry
    const gradeOneStudent = async (i, group) => {
      const startPage = group.startPage;
      const endPage = group.endPage;

      try {
        // Render pages to images (auto-rotate any upside-down pages)
        const images = [];
        for (const p of group.pages) {
          if (p < 1 || p > doc.numPages) continue;
          const rotation = localRotatedPages[p] ? 180 : 0;
          const dataUrl = await renderPageToDataUrl(doc, p, 1.5, rotation);
          images.push(dataUrl);
        }
        if (images.length === 0) {
          return {
            index: i + 1, pages: `${startPage}–${endPage}`,
            studentName: group.name || `Student ${i + 1}`,
            nameConfirmed: false,
            score: "?", outOf: "?", pct: null, letter: "?",
            strengths: [], improvements: [], comment: "",
            sections: null, subject: "", assessmentType: "",
            refCode: null, error: "Invalid page request.", raw: null,
          };
        }

        const payload = {
          images,
          answerKeyImages: (effectiveAnswerKey ? undefined : answerKeyImages) || undefined,
          rubricOverride: effectiveRubric || null,
          answerKeyOverride: effectiveAnswerKey || null,
          gradeBand,
          standards,
          subjectArea: subjectArea || undefined,
          meta: {
            sessionId: batchSessionId,
            source: "batch-grading",
            batchMode: true,
            capturedCount: images.length,
            capturedAt: Date.now(),
            feedbackVoiceMode: voiceMode || "default",
            feedbackVoice: feedbackVoice || "warm",
            perQuestionAudit: perQuestionAudit || undefined,
            inputMode: "batch",
            batchIndex: i,
            subjectHint: batchResults.length > 0 ? (batchResults[0].subject || "") : "",
          },
        };

        const res = await fetchWithRetry(gradingUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const data = await res.json();

        const rawScore = Number(data.overall_score);
        const rawOutOf = Number(data.overall_out_of);
        // Round score to 1 decimal, outOf to nearest whole number (tests are always /N)
        const score = Number.isFinite(rawScore) ? Math.round(rawScore * 10) / 10 : rawScore;
        const outOf = Number.isFinite(rawOutOf) ? Math.round(rawOutOf) : rawOutOf;
        const pct =
          Number.isFinite(score) && Number.isFinite(outOf) && outOf > 0
            ? Math.round((score / outOf) * 100) : null;

        // Determine if the student name is confidently known:
        // Confirmed when both the page classifier (group.name) and the grading AI
        // (data.student_name) independently returned the same name.
        const aiName = (data.student_name || "").trim();
        const classifierName = (group.name || "").trim();
        const nameConfirmed = !!(
          aiName && classifierName &&
          aiName.toLowerCase() === classifierName.toLowerCase()
        );

        const resultEntry = {
          index: i + 1,
          pages: `${startPage}–${endPage}`,
          studentName: data.student_name || group.name || `Student ${i + 1}`,
          nameConfirmed,
          studentId: data.student_id || null,  // AI-detected numeric ID from paper
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
          detectedTitle: data.detected_title || "",
          pageImages: images,
          refCode: null,
          error: data.error ? (data.details ? `${data.error}: ${data.details}` : data.error) : null,
          raw: data,
        };

        // Publish to results portal
        if (resultsUrl && !resultEntry.error) {
          try {
            const pubRes = await fetch(resultsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payload: buildBatchPayloadText(resultEntry, null, gradeBand),
                meta: {
                  source: "batch-grading", batchIndex: i, gradeBand,
                  studentName: resultEntry.studentName || null,
                  studentId: resultEntry.rosterStudentId || resultEntry.rosterEdsbyId || resultEntry.studentId || null,
                  subject: resultEntry.subject || "",
                  assessmentType: resultEntry.assessmentType || "",
                  title: resultEntry.detectedTitle
                    ? (effectiveTitle ? `${effectiveTitle} — ${resultEntry.detectedTitle}` : resultEntry.detectedTitle)
                    : (effectiveTitle || ""),
                  pdfName: pdfName || "",
                  className: resultEntry.rosterClassName || "",
                },
                sessionId: batchSessionId,
              }),
            });
            const pubData = await pubRes.json().catch(() => ({}));
            if (pubData.code) {
              resultEntry.refCode = String(pubData.code).toUpperCase();
              try {
                const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + resultEntry.refCode;
                await fetch(updateUrl, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    payload: buildBatchPayloadText(resultEntry, resultEntry.refCode, gradeBand),
                  }),
                });
              } catch (e2) {
                console.warn(`[batch] payload update for ${resultEntry.refCode} failed:`, e2);
              }
            }
          } catch (e) {
            console.warn(`[batch] publish for student ${i + 1} failed:`, e);
          }
        }

        return resultEntry;
      } catch (err) {
        return {
          index: i + 1, pages: `${startPage}–${endPage}`,
          studentName: group.name || `Student ${i + 1}`,
          nameConfirmed: false, studentId: null,
          score: "?", outOf: "?", pct: null, letter: "?",
          strengths: [], improvements: [], comment: "",
          sections: null, subject: "", assessmentType: "",
          refCode: null, error: err?.message || "Network error", raw: null,
        };
      }
    };

    // --- Precision mode wrapper: run N passes and merge via median ---
    const gradeWithPrecision = async (i, group, progressPrefix) => {
      if (!precisionMode) {
        return gradeOneStudent(i, group);
      }
      const passes = [];
      for (let pass = 0; pass < PRECISION_PASSES; pass++) {
        if (abortRef.current) break;
        setProgress({
          done: Math.max(0, i),
          total,
          current: `${progressPrefix} — pass ${pass + 1}/${PRECISION_PASSES}`,
        });
        const result = await gradeOneStudent(i, group);
        passes.push(result);
      }
      return mergeMultiPassResults(passes);
    };

    // Grade first student solo for fast initial feedback, then batches of 3
    const CONCURRENCY = precisionMode ? 1 : 3; // serialize in precision mode to avoid API overload
    let start = 0;

    // First student — solo so the teacher sees a result quickly
    if (total > 0 && !abortRef.current) {
      setProgress({ done: 0, total, current: `Grading student 1 of ${total}${precisionMode ? " — pass 1/" + PRECISION_PASSES : ""}...` });
      const first = await gradeWithPrecision(0, studentGroups[0], `Grading student 1 of ${total}`);
      batchResults.push(first);
      setResults([...batchResults]);
      start = 1;
    }

    // Remaining students in parallel batches
    for (; start < total; start += CONCURRENCY) {
      if (abortRef.current) break;

      const batchEnd = Math.min(start + CONCURRENCY, total);
      const batchSlice = studentGroups.slice(start, batchEnd);

      setProgress({
        done: start,
        total,
        current: `Grading student${batchSlice.length > 1 ? "s" : ""} ${start + 1}${batchEnd > start + 1 ? "–" + batchEnd : ""} of ${total}...`,
      });

      const promises = batchSlice.map((group, offset) =>
        gradeWithPrecision(
          start + offset,
          group,
          `Grading student ${start + offset + 1} of ${total}`
        )
      );
      const settled = await Promise.all(promises);

      for (const entry of settled) {
        if (abortRef.current) break;
        batchResults.push(entry);
      }

      setResults([...batchResults]);
    }

    // --- Roster matching: two-pass context-aware name matching ---
    // Pass 1: resolve unambiguous names → determine which class this batch is from.
    // Pass 2: use class context to disambiguate names that appear in multiple rosters.
    // Falls back to student ID for anything still unmatched.
    try {
      // Flatten all roster students into one list, tagged with className and rosterId.
      // rosterId uniquely identifies each uploaded CSV — className may be duplicated
      // (e.g. all "Gradebook") but rosterId never is.
      const allRosterStudents = [];
      for (const rc of rosterClasses) {
        for (const s of rc.students || []) {
          allRosterStudents.push({ ...s, className: rc.className, rosterId: rc.id });
        }
      }

      if (allRosterStudents.length > 0) {
        const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "").trim();

        // Levenshtein distance for fuzzy comparison (handles OCR/handwriting errors)
        function levenshtein(a, b) {
          if (a.length === 0) return b.length;
          if (b.length === 0) return a.length;
          const matrix = [];
          for (let i = 0; i <= b.length; i++) matrix[i] = [i];
          for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
          for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
              matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + (b[i - 1] === a[j - 1] ? 0 : 1)
              );
            }
          }
          return matrix[b.length][a.length];
        }

        // Name matcher — returns all roster students whose name matches the AI-read name.
        function findNameMatches(aiName) {
          if (!aiName || aiName.startsWith("student")) return [];
          const matches = allRosterStudents.filter((s) => {
            const first = norm(s.firstName);
            const last = norm(s.lastName);
            const full = first + last;
            const fullReversed = last + first;

            // 1. Exact full name match (either order)
            if (aiName === full || aiName === fullReversed) return true;

            // 2. AI reads "First Last" — check if AI name contains both roster parts
            if (first.length >= 2 && last.length >= 2 &&
                aiName.includes(first) && aiName.includes(last)) return true;

            // 3. Exact first name match (AI read just first name, e.g. "Eli" → "Eli Campbell")
            if (first.length >= 3 && aiName === first) return true;

            // 4. Exact last name match (AI read just last name)
            if (last.length >= 3 && aiName === last) return true;

            // 5. First name + last initial (e.g. "Mya B" → "Mya Bassoo")
            //    or last name + first initial
            if (first.length >= 3 && last.length >= 1) {
              // "myab" contains "mya" and starts with first, last[0] matches
              if (aiName.startsWith(first) && aiName.length <= first.length + 2 &&
                  aiName[first.length] === last[0]) return true;
            }

            // 6. Roster first name contains AI name or AI name is a prefix/suffix
            //    e.g. roster "Waysha Deborah" contains AI-read "Deborah"
            //    e.g. roster "Atinuke" starts with AI-read "Atin" or contains "tina" (close)
            if (aiName.length >= 3 && first.length > aiName.length &&
                (first.includes(aiName) || first.startsWith(aiName) || first.endsWith(aiName))) return true;

            // 7. AI name contains roster first name (AI read more than what's on roster)
            if (first.length >= 3 && aiName.length > first.length && aiName.includes(first)) return true;

            // 8. Prefix match on first name + exact last name
            if (first.length >= 3 && last.length >= 2 && aiName.includes(last)) {
              const prefix = first.slice(0, 3);
              if (aiName.includes(prefix)) return true;
            }

            // 9. Last name match + first initial
            if (last.length >= 3 && aiName.includes(last)) {
              if (first[0] && aiName[0] === first[0]) return true;
            }

            // 10. Fuzzy full name (1-2 char errors)
            if (full.length >= 5) {
              const maxDist = full.length >= 8 ? 2 : 1;
              if (levenshtein(aiName, full) <= maxDist) return true;
              if (levenshtein(aiName, fullReversed) <= maxDist) return true;
            }

            // 11. Fuzzy first name when last name is clear
            if (first.length >= 4 && last.length >= 2 && aiName.includes(last)) {
              const lastIdx = aiName.indexOf(last);
              const aiFront = lastIdx > 0 ? aiName.slice(0, lastIdx) : "";
              if (aiFront.length >= 3 && levenshtein(aiFront, first) <= 2) return true;
            }

            // 12. Fuzzy first name only (AI read just a first name with errors)
            //     e.g. "Rohan" → "Ruhan" (distance 1), "Udaryoj" → "Udayraj" (distance 3)
            if (first.length >= 3 && aiName.length >= 3 && aiName.length <= first.length + 2) {
              const maxDist = first.length >= 7 ? 3 : first.length >= 5 ? 2 : 1;
              if (levenshtein(aiName, first) <= maxDist) return true;
            }

            // 13. Fuzzy last name only
            if (last.length >= 4 && aiName.length >= 3 && aiName.length <= last.length + 2) {
              const maxDist = last.length >= 7 ? 3 : last.length >= 5 ? 2 : 1;
              if (levenshtein(aiName, last) <= maxDist) return true;
            }

            // 14. Fuzzy first name + last initial (e.g. "aarons" → "aaryan" + "s"ran)
            //     Split AI name into potential first + 1-char initial at the end
            if (last.length >= 1 && aiName.length >= 4) {
              const aiInit = aiName[aiName.length - 1];
              const aiFront = aiName.slice(0, -1);
              if (aiInit === last[0] && aiFront.length >= 3 && first.length >= 3) {
                const maxDist = Math.max(1, Math.floor(Math.max(aiFront.length, first.length) * 0.35));
                if (levenshtein(aiFront, first) <= maxDist) return true;
              }
            }

            return false;
          });
          if (matches.length === 0 && aiName.length >= 3) {
            console.log(`[match] NO MATCH for "${aiName}". Closest roster names:`,
              allRosterStudents.slice(0, 30).map((s) => {
                const first = norm(s.firstName);
                const last = norm(s.lastName);
                const full = first + last;
                return `${s.firstName} ${s.lastName} (d=${levenshtein(aiName, full)})`;
              }).join(", ")
            );
          }
          return matches;
        }

        // --- PASS 1: resolve matches, tally roster votes ---
        // Vote by rosterId (unique per uploaded CSV) not className, because
        // className may be identical across files (e.g. all "Gradebook").
        // A student in multiple rosters with the same edsbyId is the same person.
        const rosterVotes = {}; // { rosterId: count }
        const pendingAmbiguous = []; // results that had >1 distinct student

        for (const r of batchResults) {
          if (r.error) continue;
          const aiName = norm(r.studentName || "");
          const nameMatches = findNameMatches(aiName);

          if (nameMatches.length === 0) continue;

          // Check if all matches are the same person (by name).
          // We dedup by normalized name, not by edsbyId/studentId, because
          // the same student can appear in multiple rosters with different IDs.
          // The correct roster/ID gets resolved in Pass 2 once we know the batch class.
          const uniqueStudents = [];
          const seenNames = new Set();
          for (const m of nameMatches) {
            const nameKey = `${norm(m.firstName)}|${norm(m.lastName)}`;
            if (!seenNames.has(nameKey)) {
              seenNames.add(nameKey);
              uniqueStudents.push(m);
            }
          }

          // When multiple candidates matched, try to pick the best one by quality.
          // Exact full name > exact first name > partial/fuzzy match.
          let resolved = uniqueStudents;
          if (uniqueStudents.length > 1) {
            // Score each candidate: lower = better
            function matchQuality(s) {
              const first = norm(s.firstName);
              const last = norm(s.lastName);
              const full = first + last;
              if (aiName === full || aiName === last + first) return 0; // exact full name
              if (aiName === first) return 1; // exact first name
              if (aiName === last) return 2; // exact last name
              if (first.length >= 3 && aiName.startsWith(first) && aiName.length <= first.length + 2) return 3; // first + initial
              if (first.length >= 2 && last.length >= 2 && aiName.includes(first) && aiName.includes(last)) return 3; // contains both
              return 5; // partial/fuzzy/substring
            }
            const scored = uniqueStudents.map((s) => ({ s, q: matchQuality(s) }));
            const bestQ = Math.min(...scored.map((x) => x.q));
            const bestMatches = scored.filter((x) => x.q === bestQ);
            if (bestMatches.length === 1) {
              resolved = [bestMatches[0].s];
            } else {
              // Multiple at same quality — still ambiguous, but narrow the list
              resolved = bestMatches.map((x) => x.s);
            }
          }

          if (resolved.length === 1) {
            // Resolved to one student — assign
            const m = resolved[0];
            Object.assign(r, {
              rosterFirstName: m.firstName,
              rosterLastName: m.lastName,
              rosterEdsbyId: m.edsbyId,
              rosterStudentId: m.studentId,
              rosterClassName: m.className,
              rosterRosterId: m.rosterId,
            });
            r.studentName = `${m.firstName} ${m.lastName}`.trim() || r.studentName;
            // Vote for every roster this student appears in
            for (const match of nameMatches) {
              rosterVotes[match.rosterId] = (rosterVotes[match.rosterId] || 0) + 1;
            }
          } else {
            // Genuinely different students with similar names at same quality
            pendingAmbiguous.push({ result: r, nameMatches });
          }
        }

        // Determine the most likely roster for this batch.
        // Prefer the roster with the most votes; break ties by smaller roster.
        const rosterSizes = {};
        const rosterIdToClassName = {};
        for (const rc of rosterClasses) {
          rosterSizes[rc.id] = (rc.students || []).length;
          rosterIdToClassName[rc.id] = rc.className;
        }
        let batchRosterId = null;
        let batchClass = null;
        let maxVotes = 0;
        let batchRosterSize = Infinity;
        for (const [rid, count] of Object.entries(rosterVotes)) {
          const size = rosterSizes[rid] || Infinity;
          if (count > maxVotes || (count === maxVotes && size < batchRosterSize)) {
            maxVotes = count;
            batchRosterId = rid;
            batchClass = rosterIdToClassName[rid] || null;
            batchRosterSize = size;
          }
        }

        if (batchClass) setDetectedBatchClass(batchClass);
        if (batchRosterId) setDetectedBatchRosterId(batchRosterId);

        // --- PASS 1B: update Pass 1 matches to use the correct roster's IDs ---
        // Pass 1 may have assigned IDs from the first roster found, but now
        // that we know batchRosterId, re-assign from the correct roster.
        if (batchRosterId) {
          for (const r of batchResults) {
            if (r.error || !r.rosterFirstName) continue;
            if (r.rosterRosterId === batchRosterId) continue; // already correct
            const correctEntry = allRosterStudents.find(
              (s) => s.rosterId === batchRosterId &&
                norm(s.firstName) === norm(r.rosterFirstName) &&
                norm(s.lastName) === norm(r.rosterLastName)
            );
            if (correctEntry) {
              r.rosterEdsbyId = correctEntry.edsbyId;
              r.rosterStudentId = correctEntry.studentId;
              r.rosterClassName = correctEntry.className;
              r.rosterRosterId = correctEntry.rosterId;
            }
          }
        }

        // --- PASS 2: disambiguate using roster context ---
        for (const { result: r, nameMatches } of pendingAmbiguous) {
          let match = null;

          // If we know the batch's roster, pick the student from that roster
          if (batchRosterId) {
            const rosterFiltered = nameMatches.filter((s) => s.rosterId === batchRosterId);
            if (rosterFiltered.length === 1) match = rosterFiltered[0];
          }

          // Still ambiguous? Try student ID as tiebreaker
          if (!match && r.studentId) {
            const last4 = r.studentId.replace(/\D/g, "").slice(-4);
            if (last4.length >= 3) {
              const idFiltered = nameMatches.filter((s) => s.last4 === last4);
              if (idFiltered.length === 1) match = idFiltered[0];
            }
          }

          if (match) {
            r.rosterFirstName = match.firstName;
            r.rosterLastName = match.lastName;
            r.rosterEdsbyId = match.edsbyId;
            r.rosterStudentId = match.studentId;
            r.rosterClassName = match.className;
            r.studentName = `${match.firstName} ${match.lastName}`.trim() || r.studentName;
          }
        }

        // --- PASS 3: anyone still unmatched — try student ID alone ---
        for (const r of batchResults) {
          if (r.error || r.rosterEdsbyId) continue; // already matched
          if (!r.studentId) continue;
          const last4 = r.studentId.replace(/\D/g, "").slice(-4);
          if (last4.length < 3) continue;
          let candidates = allRosterStudents.filter((s) => s.last4 === last4);
          if (candidates.length > 1 && batchRosterId) {
            candidates = candidates.filter((s) => s.rosterId === batchRosterId);
          }
          if (candidates.length === 1) {
            const m = candidates[0];
            r.rosterFirstName = m.firstName;
            r.rosterLastName = m.lastName;
            r.rosterEdsbyId = m.edsbyId;
            r.rosterStudentId = m.studentId;
            r.rosterClassName = m.className;
            r.studentName = `${m.firstName} ${m.lastName}`.trim() || r.studentName;
          }
        }

        // --- PASS 4: process-of-elimination for unmatched students ---
        // After passes 1-3, try harder matching against only the remaining
        // unclaimed roster students. Smaller pool = more confident fuzzy matches.
        // NOTE: a student can have multiple assignments in one batch (e.g. mixed
        // stacks with several journals from the same student), so we track how
        // many times each student is matched and only exclude when the count
        // exceeds a reasonable threshold. For safety, allow up to 5 matches
        // per student before excluding — if they appear more than that it's
        // likely a false match.
        const matchedCounts = {}; // { "name:first|last": count }
        for (const r of batchResults) {
          if (!r.rosterFirstName) continue;
          const nameKey = `name:${(r.rosterFirstName||"").toLowerCase()}|${(r.rosterLastName||"").toLowerCase()}`;
          matchedCounts[nameKey] = (matchedCounts[nameKey] || 0) + 1;
          if (r.rosterEdsbyId) matchedCounts[r.rosterEdsbyId] = (matchedCounts[r.rosterEdsbyId] || 0) + 1;
          if (r.rosterStudentId) matchedCounts[r.rosterStudentId] = (matchedCounts[r.rosterStudentId] || 0) + 1;
        }

        const MAX_MATCHES_PER_STUDENT = 5;
        // Build list of roster students not yet over-claimed (from the detected roster)
        const batchClassStudents = allRosterStudents.filter((s) => {
          if (batchRosterId && s.rosterId !== batchRosterId) return false;
          const nameKey = `name:${(s.firstName||"").toLowerCase()}|${(s.lastName||"").toLowerCase()}`;
          if ((matchedCounts[nameKey] || 0) >= MAX_MATCHES_PER_STUDENT) return false;
          if (s.edsbyId && (matchedCounts[s.edsbyId] || 0) >= MAX_MATCHES_PER_STUDENT) return false;
          if (s.studentId && (matchedCounts[s.studentId] || 0) >= MAX_MATCHES_PER_STUDENT) return false;
          return true;
        });

        const matchedIds = new Set();
        // Pre-populate with already-matched students from passes 1-3
        for (const r of batchResults) {
          if (!r.rosterFirstName) continue;
          if (r.rosterEdsbyId) matchedIds.add(r.rosterEdsbyId);
          if (r.rosterStudentId) matchedIds.add(r.rosterStudentId);
          matchedIds.add(`name:${(r.rosterFirstName||"").toLowerCase()}|${(r.rosterLastName||"").toLowerCase()}`);
        }

        function assignRoster(r, m) {
          r.rosterFirstName = m.firstName;
          r.rosterLastName = m.lastName;
          r.rosterEdsbyId = m.edsbyId;
          r.rosterStudentId = m.studentId;
          r.rosterClassName = m.className;
          r.studentName = `${m.firstName} ${m.lastName}`.trim() || r.studentName;
          if (m.edsbyId) matchedIds.add(m.edsbyId);
          if (m.studentId) matchedIds.add(m.studentId);
          matchedIds.add(`name:${(m.firstName||"").toLowerCase()}|${(m.lastName||"").toLowerCase()}`);
        }

        function remaining() {
          return batchClassStudents.filter((s) => {
            if (s.edsbyId && matchedIds.has(s.edsbyId)) return false;
            if (s.studentId && matchedIds.has(s.studentId)) return false;
            if (matchedIds.has(`name:${(s.firstName||"").toLowerCase()}|${(s.lastName||"").toLowerCase()}`)) return false;
            return true;
          });
        }

        function stillUnmatched() {
          return batchResults.filter(
            (r) => !r.error && !r.rosterEdsbyId && !r.rosterStudentId && !r.rosterFirstName
          );
        }

        // 4A: Aggressive fuzzy match against remaining roster students
        // With a smaller pool, we can afford looser matching.
        for (const r of stillUnmatched()) {
          const raw = norm(r.studentName || "");
          if (!raw || raw.startsWith("student")) continue;
          const rem = remaining();
          if (rem.length === 0) break;

          let bestMatch = null;
          let bestScore = Infinity;

          for (const s of rem) {
            const first = norm(s.firstName);
            const last = norm(s.lastName);
            const full = first + last;

            // Exact partial: first name contained in AI name or vice versa
            if (first.length >= 3 && (raw.includes(first) || first.includes(raw))) {
              bestMatch = s; bestScore = 0; break;
            }
            if (last.length >= 3 && (raw.includes(last) || last.includes(raw))) {
              bestMatch = s; bestScore = 0; break;
            }

            // First name + last initial (e.g. "myab" → Mya Bassoo, "aarons" → Aaron S-something)
            if (first.length >= 3 && raw.startsWith(first) && raw.length <= first.length + 2) {
              if (!last.length || raw.length === first.length || raw[first.length] === last[0]) {
                bestMatch = s; bestScore = 0; break;
              }
            }

            // Suffix/prefix match: AI name overlaps with start/end of roster name
            if (raw.length >= 3 && first.length > raw.length) {
              if (first.startsWith(raw) || first.endsWith(raw)) {
                bestMatch = s; bestScore = 0; break;
              }
            }

            // Shared long substring: e.g. "timu" shares significant overlap with "atinuke"
            // Check if most of the AI name's characters appear in sequence in the roster name
            if (raw.length >= 3 && first.length >= 4) {
              // Find longest common substring
              let lcs = 0;
              for (let si = 0; si < first.length; si++) {
                for (let ri = 0; ri < raw.length; ri++) {
                  let len = 0;
                  while (si + len < first.length && ri + len < raw.length && first[si + len] === raw[ri + len]) len++;
                  if (len > lcs) lcs = len;
                }
              }
              // If ≥60% of the shorter name appears as a substring, it's likely a misread
              const shorter = Math.min(raw.length, first.length);
              if (lcs >= Math.ceil(shorter * 0.6) && lcs >= 3) {
                const d = levenshtein(raw, first);
                if (d < bestScore) { bestScore = d; bestMatch = s; }
              }
            }

            // Fuzzy first name with more generous threshold
            if (first.length >= 3 && raw.length >= 3) {
              const d = levenshtein(raw, first);
              const maxLen = Math.max(raw.length, first.length);
              // Allow up to 40% of the name to differ
              const threshold = Math.max(2, Math.floor(maxLen * 0.4));
              if (d <= threshold && d < bestScore) {
                bestScore = d; bestMatch = s;
              }
            }

            // Fuzzy full name
            if (full.length >= 5) {
              const d = levenshtein(raw, full);
              const threshold = Math.max(2, Math.floor(full.length * 0.35));
              if (d <= threshold && d < bestScore) {
                bestScore = d; bestMatch = s;
              }
            }
          }

          if (bestMatch) {
            // Only assign if this is the unique best match
            const tied = rem.filter((s) => {
              const first = norm(s.firstName);
              const last = norm(s.lastName);
              const full = first + last;
              if (bestScore === 0) {
                // For exact partial matches, check if another student also matches
                if (first.length >= 3 && (raw.includes(first) || first.includes(raw))) return true;
                if (last.length >= 3 && (raw.includes(last) || last.includes(raw))) return true;
                if (first.length >= 3 && raw.startsWith(first) && raw.length <= first.length + 2) return true;
                if (raw.length >= 3 && first.length > raw.length && (first.startsWith(raw) || first.endsWith(raw))) return true;
                return false;
              }
              const d1 = levenshtein(raw, first);
              const d2 = levenshtein(raw, full);
              return d1 <= bestScore || d2 <= bestScore;
            });
            if (tied.length === 1) assignRoster(r, bestMatch);
          }
        }

        // 4B: Final sweep — if exactly N unmatched and N unclaimed, assign in order
        // (handles the case where process-of-elimination leaves no ambiguity)
        const finalUnmatched = stillUnmatched();
        const finalRemaining = remaining();
        if (finalUnmatched.length > 0 && finalUnmatched.length === finalRemaining.length && finalRemaining.length <= 3) {
          // With 1-3 remaining, assign greedily by best fuzzy distance
          const used = new Set();
          for (const r of finalUnmatched) {
            const raw = norm(r.studentName || "");
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < finalRemaining.length; i++) {
              if (used.has(i)) continue;
              const s = finalRemaining[i];
              const d = Math.min(
                levenshtein(raw, norm(s.firstName)),
                levenshtein(raw, norm(s.firstName) + norm(s.lastName))
              );
              if (d < bestDist) { bestDist = d; bestIdx = i; }
            }
            if (bestIdx >= 0) {
              assignRoster(r, finalRemaining[bestIdx]);
              used.add(bestIdx);
            }
          }
        } else if (finalUnmatched.length === 1 && finalRemaining.length === 1) {
          assignRoster(finalUnmatched[0], finalRemaining[0]);
        }

        // --- Flag multi-roster matches (same name in multiple classes) ---
        for (const r of batchResults) {
          if (r.error || !r.rosterFirstName) continue;
          const fn = norm(r.rosterFirstName);
          const ln = norm(r.rosterLastName || "");
          const classesWithName = new Set();
          for (const s of allRosterStudents) {
            if (norm(s.firstName) === fn && norm(s.lastName) === ln) {
              classesWithName.add(s.className || s.rosterId);
            }
          }
          r.multiRosterMatch = classesWithName.size > 1;
        }

        setResults([...batchResults]);

        // --- Update published results with roster IDs (matching runs after publish) ---
        // The initial publish happens during grading before matching, so meta.studentId
        // is null. Now that matching is done, update each published result with the
        // correct roster studentId and the student's proper name.
        if (resultsUrl) {
          let updateSuccessCount = 0;
          let updateFailCount = 0;
          for (const r of batchResults) {
            if (r.error || !r.refCode) continue;
            const sid = r.rosterStudentId || r.rosterEdsbyId || r.studentId || null;
            if (!sid && !r.rosterFirstName) continue; // nothing to update
            try {
              const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + r.refCode;
              const updateRes = await fetch(updateUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payload: buildBatchPayloadText(r, r.refCode, gradeBand),
                  meta: {
                    source: "batch-grading",
                    studentName: r.rosterFirstName ? `${r.rosterFirstName} ${r.rosterLastName || ""}`.trim() : (r.studentName || null),
                    studentId: sid,
                    subject: r.subject || "",
                    assessmentType: r.assessmentType || "",
                    title: r.detectedTitle
                      ? (effectiveTitle ? `${effectiveTitle} — ${r.detectedTitle}` : r.detectedTitle)
                      : (effectiveTitle || ""),
                    pdfName: pdfName || "",
                    className: r.rosterClassName || "",
                  },
                }),
              });
              if (updateRes.ok) {
                updateSuccessCount++;
              } else {
                updateFailCount++;
                console.warn(`[batch] post-match update for ${r.refCode} returned ${updateRes.status}: ${await updateRes.text().catch(() => "")}`);
              }
            } catch (e) {
              updateFailCount++;
              console.warn(`[batch] post-match update for ${r.refCode} failed:`, e);
            }
          }
          console.log(`[batch] roster-match updates: ${updateSuccessCount} ok, ${updateFailCount} failed`);
          if (updateFailCount > 0 && updateSuccessCount === 0) {
            console.error("[batch] ALL roster-match updates failed — results won't appear in /progress");
          }
        }

        // Notify teacher about unmatched students + unmatched roster names
        // Only show alert if we actually detected the batch class (batchRosterId is set).
        // If no roster was detected, the unmatched list would be the entire roster — not helpful.
        const unmatched = batchResults.filter((r) => !r.error && !r.rosterEdsbyId && !r.rosterStudentId && !r.rosterFirstName);
        if (unmatched.length > 0 && batchRosterId) {
          const unmatchedResultNames = unmatched.map((r) => r.studentName).join(", ");
          const finalRem = remaining();
          const unmatchedRosterNames = finalRem.map((s) => `${s.firstName} ${s.lastName}`).join(", ");
          setTimeout(() => {
            let msg = `${unmatched.length} student${unmatched.length > 1 ? "s were" : " was"} not matched: ${unmatchedResultNames}`;
            if (unmatchedRosterNames) {
              msg += `\n\nUnassigned roster students: ${unmatchedRosterNames}`;
            }
            msg += `\n\nTap any name in the results to reassign it.`;
            alert(msg);
          }, 300);
        }
      }
    } catch (rosterErr) {
      console.warn("[batch] roster matching failed:", rosterErr);
    }

    // --- Check for mixed denominators ---
    const denomSet = new Set();
    for (const r of batchResults) {
      if (!r.error && r.outOf != null && parseFloat(r.outOf) > 0) {
        denomSet.add(Math.round(parseFloat(r.outOf) * 100) / 100); // avoid floating point noise
      }
    }
    if (denomSet.size > 1) {
      const denoms = [...denomSet].sort((a, b) => b - a);
      setDenomPrompt({ denoms, show: true });
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

    // --- Generate AI teacher analysis (class-level insights) ---
    const validForAnalysis = batchResults.filter((r) => !r.error && r.raw);
    if (validForAnalysis.length >= 2) {
      setProgress({ done: total, total, current: "Generating class analysis..." });
      try {
        const evidence = validForAnalysis.map((r) => {
          const a = r.raw || {};
          const sections = Array.isArray(a.sections) ? a.sections : [];
          return {
            label: r.studentName,
            score_line: `${r.score}/${r.outOf}`,
            strengths: r.strengths.slice(0, 6),
            improvements: r.improvements.slice(0, 6),
            teacher_comment: (r.comment || "").slice(0, 260),
            sections: sections.slice(0, 8).map((sec) => ({
              name: (sec.name || "").slice(0, 80),
              score: sec.score,
              out_of: sec.out_of,
              teacher_comment: (sec.teacher_comment || "").slice(0, 220),
              incorrect_items: (Array.isArray(sec.incorrect_items) ? sec.incorrect_items : [])
                .slice(0, 12)
                .map((x) => ({
                  prompt: (x?.prompt || "").slice(0, 120),
                  student_answer: (x?.student_answer || "").slice(0, 80),
                  correct_answer: (x?.correct_answer || "").slice(0, 80),
                })),
            })),
          };
        });

        const summaryUrl = gradingUrl.replace(/\/grading$/, "/grading/session-summary");
        const summaryRes = await fetch(summaryUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            gradeBand,
            evidence,
            rubricOverride: effectiveRubric || null,
            meta: {
              feedbackVoice: feedbackVoice || "warm",
              feedbackVoiceMode: voiceMode || "default",
              source: "batch-grading",
            },
          }),
        });

        if (summaryRes.ok) {
          // Backend returns plain text (not JSON) for session-summary
          const analysisText = await summaryRes.text();
          if (analysisText && analysisText.trim()) setTeacherAnalysis(analysisText.trim());
        }
      } catch (e) {
        console.warn("[batch] session summary failed:", e);
      }
    }

    setProgress({ done: total, total, current: "Done!" });
    setGrading(false);

    // Track this filename as processed (persisted in localStorage)
    if (pdfName) {
      try {
        const key = "curriculate_processed_pdfs_v1";
        const prev = JSON.parse(localStorage.getItem(key) || "[]");
        if (!prev.includes(pdfName)) {
          prev.push(pdfName);
          // Keep last 100 entries to avoid unbounded growth
          if (prev.length > 100) prev.splice(0, prev.length - 100);
          localStorage.setItem(key, JSON.stringify(prev));
        }
      } catch {}
    }

    // GA: batch grading complete
    try {
      const ok = batchResults.filter(r => !r.error).length;
      if (window.gtag) window.gtag("event", "batch_grading_complete", { students: ok, pages: pageCount });
    } catch {}

    // Show "scan in any orientation" tip after 3rd successful batch
    try {
      const tipKey = "curriculate_batch_scan_tip_v1";
      const tipData = JSON.parse(localStorage.getItem(tipKey) || '{"count":0}');
      tipData.count = (tipData.count || 0) + 1;
      localStorage.setItem(tipKey, JSON.stringify(tipData));
      if (tipData.count === 3 && !tipData.dismissed) {
        setScanTipVisible(true);
      }
    } catch {}
  }, [
    studentCount,
    pageCount,
    fixedPps,
    isAuto,
    isTap,
    tapGroups,
    detectedGroups,
    answerKeyPages,
    extractedAnswerKey,
    rubricOverride,
    gradingUrl,
    resultsUrl,
    gradeBand,
    standards,
    feedbackVoice,
    voiceMode,
    answerKeyOverride,
    rosterClasses,
    rotatedPages,
    perQuestionAudit,
    precisionMode,
    PRECISION_PASSES,
  ]);

  // ---------- Re-grade a single student with adjusted strictness ----------
  async function regradeStudent(resultIndex, biasDelta) {
    const r = results.find((x) => x.index === resultIndex);
    if (!r || regradingIndex) return;

    const doc = pdfDocRef.current;
    if (!doc) return;

    // Compute new bias
    const currentBias = studentBias[resultIndex] || 0;
    const newBias = Math.max(-3, Math.min(3, currentBias + biasDelta));
    setStudentBias((prev) => ({ ...prev, [resultIndex]: newBias }));
    setRegradingIndex(resultIndex);

    try {
      // Find the page group for this student
      const groups = detectedGroups || (() => {
        const g = [];
        const pps = Number(pagesPerStudent) || 1;
        const firstPage = (Number(answerKeyPages) || 0) + 1;
        for (let i = 0; i < results.length; i++) {
          const start = firstPage + i * pps;
          const end = Math.min(start + pps - 1, pageCount);
          g.push({ startPage: start, endPage: end, pages: Array.from({ length: end - start + 1 }, (_, k) => start + k) });
        }
        return g;
      })();
      const groupIdx = resultIndex - 1; // index is 1-based
      const group = groups[groupIdx];
      if (!group) throw new Error("Cannot find page group for this student");

      // Render pages to images (auto-rotate any upside-down pages)
      const images = [];
      for (const p of group.pages) {
        if (p < 1 || p > doc.numPages) continue;
        const rotation = rotatedPages[p] ? 180 : 0;
        images.push(await renderPageToDataUrl(doc, p, 1.5, rotation));
      }
      if (!images.length) throw new Error("No valid pages for this student");

      const effectiveRubric = (rubricOverride || "").trim();
      const effectiveAnswerKey = extractedAnswerKey || "";

      const payload = {
        images,
        rubricOverride: effectiveRubric || null,
        answerKeyOverride: effectiveAnswerKey || null,
        gradeBand,
        standards,
        subjectArea: subjectArea || undefined,
        strictnessBias: newBias || undefined,
        meta: {
          source: "batch-regrade",
          batchMode: true,
          capturedCount: images.length,
          capturedAt: Date.now(),
          feedbackVoiceMode: voiceMode || "default",
          feedbackVoice: feedbackVoice || "warm",
          perQuestionAudit: perQuestionAudit || undefined,
          inputMode: "batch",
          batchIndex: groupIdx,
        },
      };

      const res = await fetchWithRetry(gradingUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      const rawScore2 = Number(data.overall_score);
      const rawOutOf2 = Number(data.overall_out_of);
      let score = Number.isFinite(rawScore2) ? Math.round(rawScore2 * 10) / 10 : rawScore2;
      let outOf = Number.isFinite(rawOutOf2) ? Math.round(rawOutOf2) : rawOutOf2;
      let pct =
        Number.isFinite(score) && Number.isFinite(outOf) && outOf > 0
          ? Math.round((score / outOf) * 100) : null;

      // Guard: lenient should never lower the score, strict should never raise it
      const oldPct = typeof r.pct === "number" ? r.pct : null;
      if (pct != null && oldPct != null) {
        if (biasDelta < 0 && pct < oldPct) {
          // Lenient gave a lower grade — keep the original
          score = r.score;
          outOf = r.outOf;
          pct = oldPct;
          data.strengths = data.strengths || r.strengths;
          data.improvements = data.improvements || r.improvements;
          data.teacher_comment = data.teacher_comment || r.comment;
          data.sections = data.sections || r.sections;
        } else if (biasDelta > 0 && pct > oldPct) {
          // Strict gave a higher grade — keep the original
          score = r.score;
          outOf = r.outOf;
          pct = oldPct;
          data.strengths = data.strengths || r.strengths;
          data.improvements = data.improvements || r.improvements;
          data.teacher_comment = data.teacher_comment || r.comment;
          data.sections = data.sections || r.sections;
        }
      }

      const aiName = (data.student_name || "").trim();
      const classifierName = (group.name || "").trim();
      const nameConfirmed = !!(
        aiName && classifierName &&
        aiName.toLowerCase() === classifierName.toLowerCase()
      );

      const updatedEntry = {
        ...r,
        studentName: data.student_name || r.studentName,
        nameConfirmed,
        studentId: data.student_id || r.studentId || null,
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
        detectedTitle: data.detected_title || r.detectedTitle || "",
        error: data.error || null,
        raw: data,
      };

      // Update ref code via PUT (or create if missing)
      if (resultsUrl) {
        try {
          if (updatedEntry.refCode) {
            const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + updatedEntry.refCode;
            await fetch(updateUrl, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payload: buildBatchPayloadText(updatedEntry, updatedEntry.refCode, gradeBand),
              }),
            });
          } else {
            const pubRes = await fetch(resultsUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                payload: buildBatchPayloadText(updatedEntry, null, gradeBand),
                meta: {
                  source: "batch-regrade", batchIndex: groupIdx, gradeBand,
                  studentName: updatedEntry.studentName || null,
                  studentId: updatedEntry.rosterStudentId || updatedEntry.rosterEdsbyId || updatedEntry.studentId || null,
                  subject: updatedEntry.subject || "",
                  assessmentType: updatedEntry.assessmentType || "",
                  title: updatedEntry.detectedTitle
                    ? (effectiveTitle ? `${effectiveTitle} — ${updatedEntry.detectedTitle}` : updatedEntry.detectedTitle)
                    : (effectiveTitle || ""),
                  pdfName: pdfName || "",
                  className: updatedEntry.rosterClassName || "",
                },
              }),
            });
            const pubData = await pubRes.json().catch(() => ({}));
            if (pubData.code) {
              updatedEntry.refCode = String(pubData.code).toUpperCase();
              const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + updatedEntry.refCode;
              await fetch(updateUrl, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  payload: buildBatchPayloadText(updatedEntry, updatedEntry.refCode, gradeBand),
                }),
              }).catch(() => {});
            }
          }
        } catch (e) {
          console.warn(`[batch] regrade publish for student ${resultIndex} failed:`, e);
        }
      }

      // Replace in results array
      setResults((prev) => prev.map((x) => x.index === resultIndex ? updatedEntry : x));

    } catch (err) {
      console.error(`[batch] regrade student ${resultIndex} failed:`, err);
    } finally {
      setRegradingIndex(null);
    }
  }

  // Recalculate class summary whenever results change (e.g. after per-student re-grade)
  useEffect(() => {
    if (!results.length || grading) return;
    const validResults = results.filter((r) => r.pct != null);
    if (!validResults.length) return;
    const avg = validResults.reduce((s, r) => s + r.pct, 0) / validResults.length;
    const sorted = [...validResults].sort((a, b) => a.pct - b.pct);
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1].pct + sorted[sorted.length / 2].pct) / 2
      : sorted[Math.floor(sorted.length / 2)].pct;
    const high = sorted[sorted.length - 1].pct;
    const low = sorted[0].pct;
    const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    validResults.forEach((r) => { const l = r.letter[0]; if (l in dist) dist[l]++; });
    setClassSummary({ count: validResults.length, avg: Math.round(avg), median: Math.round(median), high, low, dist });
  }, [results, grading]);

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
      "Code",
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
      r.refCode || "",
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
    setCsvExported(true);
  }, [results]);

  // ---------- Build summary text (shared by Copy + Email) ----------
  const buildSummaryText = useCallback(
    ({ includeFooter = false } = {}) => {
      if (!results.length) return "";

      const lines = [
        `Pulse Grading Batch Results — ${pdfName || "uploaded PDF"}`,
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

      if (teacherAnalysis) {
        lines.push("--- Class Analysis ---");
        lines.push(teacherAnalysis);
        lines.push("");
      }

      results.forEach((r) => {
        lines.push(
          `${r.studentName}: ${r.score}/${r.outOf} (${r.pct != null ? r.pct + "%" : "?"}) ${r.letter}${r.refCode ? `  [${r.refCode}]` : ""}`
        );
        if (r.comment) lines.push(`  ${r.comment}`);
        if (r.refCode) lines.push(`  For results & feedback: www.curriculate.net/results/${r.refCode}`);
      });

      if (includeFooter) {
        lines.push("");
        lines.push("—");
        lines.push("Graded with Curriculate Pulse — grading & feedback for teachers");
        lines.push("www.curriculate.net");
      }

      return lines.join("\n");
    },
    [results, classSummary, teacherAnalysis, pdfName]
  );

  // ---------- Derive email subject from results ----------
  const emailSubject = (() => {
    if (!results.length) return "Grading Results";
    // Try to find a subject/type from the first successful result
    const first = results.find((r) => !r.error);
    const parts = ["Grading:"];
    if (first?.subject) parts.push(first.subject);
    // When voice is journal_response, use "Journal" instead of the AI-inferred type (which often says "Other")
    const aType = feedbackVoice === "journal_response" ? "Journal" : first?.assessmentType;
    if (aType) parts.push(aType);
    // If we got nothing useful, fall back to file name
    if (parts.length === 1) {
      const clean = (pdfName || "").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
      if (clean) parts.push(clean);
      else parts.push("Batch Results");
    }
    return parts.join(" ");
  })();

  // ---------- Copy summary ----------
  const copySummary = useCallback(async () => {
    if (!results.length) return;
    try {
      await navigator.clipboard.writeText(buildSummaryText());
      setCopiedSummary(true);
    } catch {}
  }, [results, buildSummaryText]);

  // ---------- Build rich HTML email body ----------
  const buildEmailHtml = useCallback(() => {
    if (!results.length) return "";

    const gradeColor = (letter) => {
      if (letter.startsWith("A")) return "#16a34a";
      if (letter.startsWith("B")) return "#2563eb";
      if (letter.startsWith("C")) return "#ca8a04";
      if (letter.startsWith("D")) return "#ea580c";
      return "#dc2626";
    };

    let html = `<div style="font-family: -apple-system, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 640px; color: #1e293b;">`;

    // Header
    html += `<h2 style="margin: 0 0 4px; font-size: 20px; color: #0f172a;">Pulse Grading Batch Results</h2>`;
    html += `<p style="margin: 0 0 16px; font-size: 14px; color: #64748b;">${effectiveTitle || "Uploaded PDF"} &mdash; ${results.length} student${results.length !== 1 ? "s" : ""} graded</p>`;

    // Rubric note (if teacher typed one in)
    const rubricNote = (rubricOverride || "").trim();
    if (rubricNote) {
      const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html += `<div style="background: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 14px; margin-bottom: 14px;">`;
      html += `<div style="font-weight: 800; font-size: 12px; color: #92400e; margin-bottom: 4px;">Rubric</div>`;
      html += `<div style="font-size: 13px; line-height: 1.5; color: #78350f; white-space: pre-wrap;">${esc(rubricNote)}</div>`;
      html += `</div>`;
    }

    // Class summary
    if (classSummary) {
      html += `<table style="border-collapse: collapse; width: 100%; margin-bottom: 12px; border: 1px solid #e2e8f0; border-radius: 8px;">`;
      html += `<tr style="background: #f8fafc;">`;
      html += `<td style="padding: 10px 14px; text-align: center; border-right: 1px solid #e2e8f0;"><div style="font-size: 20px; font-weight: 800; color: #1e40af;">${classSummary.avg}%</div><div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Average</div></td>`;
      html += `<td style="padding: 10px 14px; text-align: center; border-right: 1px solid #e2e8f0;"><div style="font-size: 20px; font-weight: 800; color: #1e40af;">${classSummary.median}%</div><div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Median</div></td>`;
      html += `<td style="padding: 10px 14px; text-align: center; border-right: 1px solid #e2e8f0;"><div style="font-size: 20px; font-weight: 800; color: #1e40af;">${classSummary.high}%</div><div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">High</div></td>`;
      html += `<td style="padding: 10px 14px; text-align: center;"><div style="font-size: 20px; font-weight: 800; color: #1e40af;">${classSummary.low}%</div><div style="font-size: 10px; font-weight: 700; color: #64748b; text-transform: uppercase;">Low</div></td>`;
      html += `</tr></table>`;

      // Distribution
      html += `<p style="margin: 0 0 14px; font-size: 13px; color: #475569;">`;
      ["A", "B", "C", "D", "F"].forEach((g) => {
        html += `<strong style="color: ${gradeColor(g)};">${g}:</strong>&nbsp;${classSummary.dist[g]}&nbsp;&nbsp;`;
      });
      html += `</p>`;
    }

    // Teacher analysis
    if (teacherAnalysis) {
      html += `<div style="background: #f0f0ff; border: 1px solid #c7d2fe; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">`;
      html += `<div style="font-weight: 800; font-size: 13px; color: #3730a3; margin-bottom: 6px;">Class Analysis</div>`;
      html += `<div style="font-size: 13px; line-height: 1.5; color: #1e293b; white-space: pre-wrap;">${teacherAnalysis.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>`;
      html += `</div>`;
    }

    // Results table
    html += `<table style="border-collapse: collapse; width: 100%; font-size: 13px; margin-bottom: 14px;">`;
    html += `<thead><tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">`;
    html += `<th style="padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">#</th>`;
    html += `<th style="padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">Student</th>`;
    html += `<th style="padding: 8px 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Score</th>`;
    html += `<th style="padding: 8px 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">%</th>`;
    html += `<th style="padding: 8px 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Grade</th>`;
    html += `<th style="padding: 8px 10px; text-align: center; font-size: 11px; text-transform: uppercase; color: #64748b;">Code</th>`;
    html += `<th style="padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; color: #64748b;">Comment</th>`;
    html += `</tr></thead><tbody>`;

    results.forEach((r, i) => {
      const bg = i % 2 === 0 ? "#ffffff" : "#f8fafc";
      const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html += `<tr style="background: ${bg}; border-bottom: 1px solid #e2e8f0;">`;
      html += `<td style="padding: 7px 10px;">${r.index}</td>`;
      html += `<td style="padding: 7px 10px; font-weight: 700;">${esc(r.studentName)}${r.studentId ? ` <span style="font-size:10px;color:#94a3b8;font-weight:400;">#${esc(r.studentId.slice(-4))}</span>` : ""}</td>`;
      html += `<td style="padding: 7px 10px; text-align: center;">${r.score}/${r.outOf}</td>`;
      html += `<td style="padding: 7px 10px; text-align: center;">${r.pct != null ? r.pct + "%" : "—"}</td>`;
      html += `<td style="padding: 7px 10px; text-align: center; font-weight: 800; color: ${r.letter !== "?" ? gradeColor(r.letter) : "#999"};">${r.letter}</td>`;
      html += `<td style="padding: 7px 10px; text-align: center; font-family: monospace; font-weight: 700; font-size: 12px;">`;
      if (r.refCode) {
        html += `<a href="https://www.curriculate.net/results/${r.refCode}" style="color: #2563eb; text-decoration: none;">${r.refCode}</a>`;
      } else {
        html += `—`;
      }
      html += `</td>`;
      html += `<td style="padding: 7px 10px; font-size: 12px; color: #475569;">${esc(r.comment).slice(0, 120)}</td>`;
      html += `</tr>`;

      // Per-student feedback link row
      if (r.refCode) {
        html += `<tr style="background: ${bg};">`;
        html += `<td></td><td colspan="6" style="padding: 0 10px 7px; font-size: 12px;">`;
        html += `<a href="https://www.curriculate.net/results/${r.refCode}" style="color: #2563eb;">Results &amp; feedback: www.curriculate.net/results/${r.refCode}</a>`;
        html += `</td></tr>`;
      }
    });

    html += `</tbody></table>`;

    // Footer
    html += `<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0 12px;" />`;
    html += `<table style="width: 100%;"><tr>`;
    html += `<td style="font-size: 12px; color: #94a3b8; line-height: 1.5;">`;
    const hasRosterIds = results.some((r) => r.rosterStudentId || r.rosterEdsbyId);
    const hasRoster = rosterClasses.length > 0;

    if (hasRosterIds) {
      // Teacher has roster and students are matched — show progress portal link
      html += `<div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">`;
      html += `<strong style="color: #166534;">Student Progress Portal</strong><br/>`;
      html += `<span style="color: #15803d;">View all your students' scores and averages in one place at <a href="https://www.curriculate.net/progress" style="color: #2563eb; font-weight: 700;">curriculate.net/progress</a>. Just enter your email &mdash; no student ID needed &mdash; to see your full class overview. Click any student to see their complete history and progress over time.</span>`;
      html += `</div>`;
    } else if (!hasRoster) {
      // No roster uploaded — guide teacher to set one up
      html += `<div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 12px 14px; margin-bottom: 14px;">`;
      html += `<strong style="color: #1e40af;">Get more from your grading</strong><br/>`;
      html += `<span style="color: #1d4ed8;">Upload a class roster to auto-match students by name, export grades to your gradebook, and give students &amp; parents access to a progress portal.</span><br/><br/>`;
      html += `<strong style="color: #334155;">Edsby schools:</strong> Export your class gradebook (gear icon &#x2699; &rarr; Export) and upload the CSV on the <a href="https://www.curriculate.net/grading" style="color: #2563eb; font-weight: 700;">grading page</a> under Class Roster.<br/>`;
      html += `<strong style="color: #334155;">Other schools:</strong> Click "Create Roster" on the <a href="https://www.curriculate.net/grading" style="color: #2563eb; font-weight: 700;">grading page</a>, type your student names, and auto-generate IDs. Print the list and hand it out &mdash; students use their ID to view feedback at <a href="https://www.curriculate.net/progress" style="color: #2563eb; font-weight: 700;">curriculate.net/progress</a>.`;
      html += `</div>`;
    }

    // Copy-paste message for students
    const hasAnyIds = results.some((r) => r.rosterStudentId || r.rosterEdsbyId || r.studentId);
    const hasEdsby = results.some((r) => r.rosterEdsbyId);
    html += `<div style="background: #fefce8; border: 1px solid #fde68a; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px;">`;
    html += `<div style="font-weight: 800; font-size: 12px; color: #92400e; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Share with your students</div>`;
    html += `<div style="font-size: 12px; color: #78350f; margin-bottom: 8px;">Copy and paste this into your class chat, LMS, or handout:</div>`;
    html += `<div style="background: #ffffff; border: 1px dashed #d4a574; border-radius: 6px; padding: 12px 14px; font-size: 13px; color: #1e293b; line-height: 1.6;">`;
    if (hasAnyIds) {
      html += `I'm sharing this Curriculate Progress viewer to make it easier for all of us&mdash;teachers, parents, students&mdash;to see the feedback and results on your assessments. `;
      if (hasEdsby) html += `Grades still go into Edsby&mdash;nothing changes there. `;
      html += `As new work is graded, it will appear in this portal!<br/><br/>`;
      html += `To see your detailed results and feedback:<br/><br/>`;
      html += `1. Go to <strong>curriculate.net/progress</strong><br/>`;
      html += `2. Enter your student ID and your (or your parent's) email<br/>`;
      html += `3. You'll see your score, feedback, and a link to your full report<br/><br/>`;
      html += `Parents can also add their email to get notified of future grades. Just log in with the same student ID and a different email address.`;
    } else {
      html += `Your work has been graded! Each of you received a unique code to view your detailed feedback.<br/><br/>`;
      html += `Go to <strong>curriculate.net/results/YOUR-CODE</strong> to see your score, comments, and what to work on next.`;
    }
    html += `</div></div>`;

    html += `Graded with <a href="https://www.curriculate.net/pulse" style="color: #2563eb; font-weight: 700; text-decoration: none;">Curriculate Pulse</a> &mdash; grading &amp; feedback for teachers<br/>`;
    html += `Save hours on marking. Try it free at <a href="https://www.curriculate.net" style="color: #2563eb; text-decoration: none;">curriculate.net</a>`;
    html += `</td></tr></table>`;

    html += `</div>`;
    return html;
  }, [results, classSummary, teacherAnalysis, pdfName, rubricOverride, rosterClasses]);

  // ---------- Email summary (rich HTML) ----------
  const [emailTo, setEmailTo] = useState(parentTeacherEmail || "");
  useEffect(() => {
    if (parentTeacherEmail) { setEmailTo(parentTeacherEmail); return; }
    try { const saved = localStorage.getItem("curriculate_report_email"); if (saved) setEmailTo(saved); } catch {}
  }, [parentTeacherEmail]);
  useEffect(() => { if (emailTo) try { localStorage.setItem("curriculate_report_email", emailTo); } catch {} }, [emailTo]);
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  const [emailSending, setEmailSending] = useState(false);
  const [emailTitle, setEmailTitle] = useState("");

  // Derive an assignment title from AI-inferred fields across all results
  const inferredTitle = useMemo(() => {
    if (!results.length) return "";
    const good = results.filter((r) => !r.error);
    if (!good.length) return "";

    // Find the most common subject and assessment type
    const subjectCounts = {};
    const typeCounts = {};
    for (const r of good) {
      if (r.subject) subjectCounts[r.subject] = (subjectCounts[r.subject] || 0) + 1;
      if (r.assessmentType) typeCounts[r.assessmentType] = (typeCounts[r.assessmentType] || 0) + 1;
    }
    const topSubject = Object.entries(subjectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const topType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    // Build title: "Math — Quiz" or just "Math" or just "Quiz"
    const parts = [];
    if (topSubject && topSubject !== "Other") parts.push(topSubject);
    if (topType && topType !== "Other" && topType !== topSubject) parts.push(topType);
    if (parts.length) return parts.join(" — ");
    return "";
  }, [results]);

  // Effective title: teacher-entered > inferred > PDF filename
  const effectiveTitle = useMemo(() => {
    if (emailTitle.trim()) return emailTitle.trim();
    if (inferredTitle) return inferredTitle;
    if (pdfName) return pdfName.replace(/\.pdf$/i, "");
    return "";
  }, [emailTitle, inferredTitle, pdfName]);

  const emailSummary = useCallback(async () => {
    if (!results.length) return;
    setShowEmailPrompt(true);
  }, [results]);

  // ---------- Build Edsby-compatible CSV from results ----------
  // Single CSV formatted for Edsby import. Edsby expects:
  // Student ID, First Name, Last Name, Assessment Name, Grade, Out Of, Comment
  // "Assessment Name" must be the same for every row so Edsby creates one
  // assessment with all student grades, not one assessment per student.
  // All scores normalized to /10 using percentage (so 4/5 → 8/10, not 4/10).
  const buildEdsbyCsv = useCallback(() => {
    if (!results.length) return null;

    const assessmentName = effectiveTitle || "Curriculate Grade";
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const headers = ["Student ID", "First Name", "Last Name", "Assessment Name", "Date", "Grade", "Out Of", "Comment"];
    const escCsv = (v) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // Find the most common denominator so outliers get converted to match
    const denomCounts = {};
    for (const r of results) {
      if (r.error || !r.outOf) continue;
      const d = parseFloat(r.outOf);
      if (d > 0) denomCounts[d] = (denomCounts[d] || 0) + 1;
    }
    let outOfNorm = 10; // default
    let maxCount = 0;
    for (const [d, count] of Object.entries(denomCounts)) {
      if (count > maxCount) { maxCount = count; outOfNorm = parseFloat(d); }
    }

    const rows = [headers.map(escCsv).join(",")];
    for (const r of results) {
      if (r.error) continue;
      const firstName = r.rosterFirstName || r.studentName || "";
      const lastName = r.rosterLastName || "";
      const sid = r.rosterStudentId || r.rosterEdsbyId || r.studentId || "";
      let comment = (r.comment || "").replace(/\s+/g, " ").trim();
      if (r.refCode) {
        comment += (comment ? " " : "") + `For detailed feedback, check www.curriculate.net/results/${r.refCode}`;
        if (r.rosterStudentId || r.rosterEdsbyId) {
          comment += ` For all results, check www.curriculate.net/progress`;
        }
      }
      // If this student's denominator differs, convert using percentage
      let grade = "";
      const origOutOf = parseFloat(r.outOf) || 0;
      if (origOutOf === outOfNorm) {
        grade = String(r.score);
      } else if (r.pct != null) {
        grade = String(Math.round((r.pct / 100) * outOfNorm * 10) / 10);
      } else if (r.score != null && origOutOf > 0) {
        grade = String(Math.round((parseFloat(r.score) / origOutOf) * outOfNorm * 10) / 10);
      }
      rows.push([
        escCsv(sid), escCsv(firstName), escCsv(lastName),
        escCsv(assessmentName), escCsv(today), escCsv(grade),
        escCsv(outOfNorm), escCsv(comment),
      ].join(","));
    }
    return rows.join("\n");
  }, [results, emailTitle]);

  const sendEmail = useCallback(async () => {
    const to = emailTo.trim();
    if (!to || !to.includes("@")) return;

    // Final pass: normalize all matched student names to exact roster spelling
    for (const r of results) {
      if (r.error || !r.rosterFirstName) continue;
      const rosterName = `${r.rosterFirstName} ${r.rosterLastName || ""}`.trim();
      if (r.studentName !== rosterName) r.studentName = rosterName;
    }
    setResults([...results]); // trigger re-render with corrected names

    setEmailSending(true);
    try {
      const html = buildEmailHtml();

      // Generate PDFs and Edsby CSV in parallel (with 15s timeout)
      let pdfBase64 = null;
      let stripsBase64 = null;
      try {
        const pdfOpts = effectiveTitle ? { title: effectiveTitle } : {};
        const pdfTimeout = (p) => Promise.race([
          p,
          new Promise((_, reject) => setTimeout(() => reject(new Error("PDF generation timed out (15s)")), 15000)),
        ]);
        [pdfBase64, stripsBase64] = await Promise.all([
          pdfTimeout(buildResultsPdf(results, pdfOpts)),
          pdfTimeout(buildStripsPdf(results, pdfOpts)),
        ]);
      } catch (pdfErr) {
        console.error("[batch] PDF generation failed:", pdfErr?.message || pdfErr, pdfErr?.stack);
        const sendAnyway = window.confirm(
          `PDF report generation failed: ${pdfErr?.message || "unknown error"}. Send email without PDF attachments?`
        );
        if (!sendAnyway) {
          setEmailSending(false);
          return;
        }
      }

      const sendUrl = gradingUrl.replace(/\/grading$/, "/grading/send-email");
      const rawBase = (pdfName || "batch-results").replace(/\.pdf$/i, "");
      const srcTag = rawBase.replace(/[^a-zA-Z0-9]/g, "").slice(-3) || "000";
      const titleSlug = effectiveTitle
        ? effectiveTitle.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
        : null;
      const baseName = titleSlug ? `${titleSlug}-${srcTag}` : `${rawBase}-${srcTag}`;
      const subject = effectiveTitle ? `Grading: ${effectiveTitle}` : emailSubject;
      const payload = { to, subject, html, pdfAttachments: [], csvAttachments: [] };
      if (pdfBase64) {
        payload.pdfAttachments.push({ data: pdfBase64, filename: `${baseName}-reports.pdf` });
      }
      if (stripsBase64) {
        payload.pdfAttachments.push({ data: stripsBase64, filename: `${baseName}-strips.pdf` });
      }
      // Legacy single-attachment fields for backward compat
      if (pdfBase64) {
        payload.pdfAttachment = pdfBase64;
        payload.pdfFilename = `${baseName}-reports.pdf`;
      }

      // Attach single Edsby CSV
      const csvText = buildEdsbyCsv();
      if (csvText) {
        const csvBase64 = typeof btoa === "function"
          ? btoa(unescape(encodeURIComponent(csvText)))
          : Buffer.from(csvText, "utf-8").toString("base64");
        const csvName = effectiveTitle ? `results-${effectiveTitle}.csv` : "results.csv";
        payload.csvAttachments.push({ data: csvBase64, filename: csvName });
      }

      const emailController = new AbortController();
      const emailTimeout = setTimeout(() => emailController.abort(), 20000); // 20s timeout (Resend is fast; SMTP has its own 15s cap)
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: emailController.signal,
      });
      clearTimeout(emailTimeout);
      if (res.ok) {
        try { if (window.gtag) window.gtag("event", "batch_email_sent", { students: results.filter(r => !r.error).length }); } catch {}
        setEmailCopied(true);
        setShowEmailPrompt(false);

        // Update published results with the effective title (fire-and-forget, don't block UI)
        const finalTitle = effectiveTitle;
        if (finalTitle && resultsUrl) {
          (async () => {
            for (const r of results) {
              if (!r.refCode || r.error) continue;
              try {
                const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + r.refCode;
                fetch(updateUrl, {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    payload: buildBatchPayloadText(r, r.refCode, gradeBand),
                    meta: {
                      source: "batch-grading", gradeBand,
                      studentName: r.studentName || null,
                      studentId: r.rosterStudentId || r.rosterEdsbyId || r.studentId || null,
                      subject: r.subject || "",
                      assessmentType: r.assessmentType || "",
                      title: finalTitle,
                      pdfName: pdfName || "",
                      className: r.rosterClassName || "",
                    },
                  }),
                }).catch(e => console.warn(`[batch] title update for ${r.refCode} failed:`, e));
              } catch (e) {
                console.warn(`[batch] title update for ${r.refCode} failed:`, e);
              }
            }
          })();
        }
      } else {
        const err = await res.json().catch(() => ({}));
        console.warn("[batch] send email failed:", err);
        const errMsg = err.error || `Server returned ${res.status}`;
        // Offer retry without attachments if the email had PDFs
        if (pdfBase64 || stripsBase64) {
          const retry = window.confirm(
            `Email failed: ${errMsg}\n\nWould you like to retry WITHOUT PDF attachments? (You can still use Print Reports / Print Strips for PDFs)`
          );
          if (retry) {
            const retryController = new AbortController();
            const retryTimeout = setTimeout(() => retryController.abort(), 30000);
            try {
              const retryPayload = { to: emailTo.trim(), subject, html, pdfAttachments: [], csvAttachments: payload.csvAttachments || [] };
              const retryRes = await fetch(sendUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(retryPayload),
                signal: retryController.signal,
              });
              clearTimeout(retryTimeout);
              if (retryRes.ok) {
                setEmailCopied(true);
                setShowEmailPrompt(false);
              } else {
                const retryErr = await retryRes.json().catch(() => ({}));
                alert(`Retry also failed: ${retryErr.error || retryRes.status}.\n\nYour results are still saved — open Progress to view them, or use Print Reports / Print Strips / Export CSV to save locally.`);
              }
            } catch (retryE) {
              clearTimeout(retryTimeout);
              const isAbort = retryE.name === "AbortError";
              alert(isAbort
                ? "Retry timed out after 30 seconds — the email server is unreachable.\n\nYour results are still saved — open Progress to view them, or use Print Reports / Print Strips / Export CSV to save locally."
                : `Retry failed: ${retryE.message}.\n\nYour results are still saved — use Print Reports / Print Strips / Export CSV.`
              );
            }
          }
        } else {
          alert(`Email failed: ${errMsg}`);
        }
      }
    } catch (e) {
      console.warn("[batch] send email error:", e);
      const isAbort = e.name === "AbortError";
      alert(isAbort
        ? "Email timed out (20s). The email server may be unreachable. Use Print Reports + Export CSV instead."
        : `Failed to send email: ${e.message}`
      );
    }
    setEmailSending(false);
  }, [emailTo, emailTitle, buildEmailHtml, buildEdsbyCsv, emailSubject, gradingUrl, results, pdfName]);

  // ---------- Copy / email ack ----------
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [csvExported, setCsvExported] = useState(false);
  const [reportsPrinted, setReportsPrinted] = useState(false);
  const [stripsPrinted, setStripsPrinted] = useState(false);

  // ---------- Manual name assignment ----------
  // Returns all roster students from the detected batch class. Students are
  // NOT excluded when already matched — a batch can contain multiple assignments
  // from the same student (e.g. mixed stacks with several journals).
  const availableRosterStudents = useMemo(() => {
    const all = [];
    const seen = new Set();
    for (const rc of rosterClasses) {
      if (detectedBatchRosterId && rc.id !== detectedBatchRosterId) continue;
      for (const s of rc.students || []) {
        const key = `${(s.firstName || "").toLowerCase()}|${(s.lastName || "").toLowerCase()}|${s.studentId || s.edsbyId || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push({ ...s, className: rc.className });
      }
    }
    // Fallback: if filtering by batch roster left nothing, show all
    if (all.length === 0 && detectedBatchRosterId) {
      for (const rc of rosterClasses) {
        for (const s of rc.students || []) {
          const key = `${(s.firstName || "").toLowerCase()}|${(s.lastName || "").toLowerCase()}|${s.studentId || s.edsbyId || ""}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ ...s, className: rc.className });
        }
      }
    }
    // Sort: unmatched (not yet assigned to any result) first, then matched
    const assignedIds = new Set();
    for (const r of results) {
      if (r.rosterStudentId) assignedIds.add(r.rosterStudentId);
      if (r.rosterEdsbyId) assignedIds.add(r.rosterEdsbyId);
    }
    all.sort((a, b) => {
      const aMatched = assignedIds.has(a.studentId) || assignedIds.has(a.edsbyId);
      const bMatched = assignedIds.has(b.studentId) || assignedIds.has(b.edsbyId);
      if (aMatched !== bMatched) return aMatched ? 1 : -1; // unmatched first
      return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
    });
    return all;
  }, [rosterClasses, detectedBatchRosterId, results]);

  const assignStudentName = useCallback((resultIndex, rosterStudent) => {
    setResults((prev) => {
      const updated = [...prev];
      const r = updated.find((x) => x.index === resultIndex);
      if (!r) return prev;
      if (rosterStudent) {
        r.studentName = `${rosterStudent.firstName} ${rosterStudent.lastName}`.trim();
        r.rosterFirstName = rosterStudent.firstName;
        r.rosterLastName = rosterStudent.lastName;
        r.rosterEdsbyId = rosterStudent.edsbyId;
        r.rosterStudentId = rosterStudent.studentId;
        // Keep the batch class if one has already been established
        if (!detectedBatchClass) {
          r.rosterClassName = rosterStudent.className;
        }
      }
      return updated;
    });
    setEditingNameIndex(null);
  }, [detectedBatchClass]);

  // --- Normalize denominators across results ---
  // Rescales all students' scores to a new denominator and re-publishes to results portal
  const normalizeDenoms = useCallback((targetDenom) => {
    setResults((prev) => {
      const updated = prev.map((r) => {
        if (r.error || typeof r.outOf !== "number" || r.outOf <= 0) return r;
        if (r.outOf === targetDenom) return r; // already correct
        const pct = r.pct != null ? r.pct : (r.score / r.outOf) * 100;
        const newScore = Math.round((pct / 100) * targetDenom * 10) / 10;
        const newPct = targetDenom > 0 ? Math.round((newScore / targetDenom) * 100) : null;
        return { ...r, score: newScore, outOf: targetDenom, pct: newPct, letter: newPct != null ? letterGrade(newPct) : r.letter };
      });
      // Re-publish each result that has a refCode (fire-and-forget)
      if (resultsUrl) {
        updated.forEach((r) => {
          if (!r.refCode || r.error) return;
          const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + r.refCode;
          fetch(updateUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payload: buildBatchPayloadText(r, r.refCode, gradeBand),
            }),
          }).catch((e) => console.warn(`[batch] denom update for ${r.refCode} failed:`, e));
        });
      }
      return updated;
    });
    setDenomPrompt(null);
  }, [resultsUrl, gradeBand]);

  const convertToPercent = useCallback(() => {
    setResults((prev) => {
      const updated = prev.map((r) => {
        if (r.error || typeof r.outOf !== "number" || r.outOf <= 0) return r;
        const pct = r.pct != null ? r.pct : Math.round((r.score / r.outOf) * 100);
        return { ...r, score: pct, outOf: 100, pct, letter: letterGrade(pct) };
      });
      if (resultsUrl) {
        updated.forEach((r) => {
          if (!r.refCode || r.error) return;
          const updateUrl = resultsUrl.replace(/\/$/, "") + "/" + r.refCode;
          fetch(updateUrl, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payload: buildBatchPayloadText(r, r.refCode, gradeBand),
            }),
          }).catch((e) => console.warn(`[batch] percent convert for ${r.refCode} failed:`, e));
        });
      }
      return updated;
    });
    setDenomPrompt(null);
  }, [resultsUrl, gradeBand]);

  // Close name dropdown on outside click
  useEffect(() => {
    if (editingNameIndex == null) return;
    const close = () => setEditingNameIndex(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [editingNameIndex]);

  // ---------- Expanded row ----------
  const [expandedIndex, setExpandedIndex] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(null); // index of result whose source images are shown
  const [regradingIndex, setRegradingIndex] = useState(null); // index of student being re-graded
  const [studentBias, setStudentBias] = useState({}); // { [index]: number } per-student strictness bias

  // Load roster on mount (skip if parent already provides rosters)
  useEffect(() => {
    if (parentRosterClasses) return; // parent handles roster loading
    const email = parentTeacherEmail || (() => { try { return localStorage.getItem("curriculate_report_email") || ""; } catch { return ""; } })();
    if (!email || !email.includes("@")) return;
    const rosterBase = gradingUrl.replace(/\/grading$/, "/class-roster");
    setRosterLoading(true);
    fetch(`${rosterBase}/list?teacherEmail=${encodeURIComponent(email)}`)
      .then(r => r.ok ? r.json() : { rosters: [] })
      .then(data => setRosterClasses(data.rosters || []))
      .catch(() => {})
      .finally(() => setRosterLoading(false));
  }, [gradingUrl, parentRosterClasses, parentTeacherEmail]);

  // Re-run roster matching when rosters arrive after grading is done
  // (e.g. teacher enters email in Email Summary prompt on a new device)
  useEffect(() => {
    if (!rosterClasses.length || !results.length || grading) return;
    // Check if results already have roster matches
    const hasMatches = results.some((r) => r.rosterEdsbyId || r.rosterStudentId || r.rosterFirstName);
    if (hasMatches) return;

    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z]/g, "").trim();
    const allRosterStudents = [];
    for (const rc of rosterClasses) {
      for (const s of (rc.students || [])) {
        allRosterStudents.push({ ...s, className: rc.className, rosterId: rc.id });
      }
    }
    if (!allRosterStudents.length) return;

    let changed = false;
    const rosterVotes = {};
    const updated = results.map((r) => {
      if (r.error || !r.studentName) return r;
      const aiName = norm(r.studentName);
      if (!aiName || aiName.startsWith("student")) return r;
      const aiParts = r.studentName.trim().toLowerCase().split(/\s+/);

      for (const s of allRosterStudents) {
        const fn = norm(s.firstName);
        const ln = norm(s.lastName);
        const full = fn + ln;
        const fullReversed = ln + fn;
        let matched = false;
        if (aiName === full || aiName === fullReversed) matched = true;
        else if (aiParts.length >= 2 && norm(aiParts[0]) === fn && norm(aiParts[aiParts.length - 1]) === ln) matched = true;
        else if (aiParts.length >= 2 && norm(aiParts[0]) === ln && norm(aiParts[aiParts.length - 1]) === fn) matched = true;
        else if (aiParts.some((p) => norm(p) === fn) && fn.length >= 3) matched = true;
        if (matched) {
          changed = true;
          rosterVotes[s.rosterId] = (rosterVotes[s.rosterId] || 0) + 1;
          return {
            ...r,
            rosterFirstName: s.firstName,
            rosterLastName: s.lastName,
            rosterEdsbyId: s.edsbyId,
            rosterStudentId: s.studentId,
            rosterClassName: s.className,
            rosterRosterId: s.rosterId,
          };
        }
      }
      return r;
    });

    if (!changed) return;

    // Flag multi-roster matches
    for (let i = 0; i < updated.length; i++) {
      const r = updated[i];
      if (r.error || !r.rosterFirstName) continue;
      const fn = norm(r.rosterFirstName);
      const ln = norm(r.rosterLastName || "");
      const classesWithName = new Set();
      for (const s of allRosterStudents) {
        if (norm(s.firstName) === fn && norm(s.lastName) === ln) {
          classesWithName.add(s.className || s.rosterId);
        }
      }
      if (classesWithName.size > 1) updated[i] = { ...r, multiRosterMatch: true };
    }

    // Determine detected class from votes
    let bestRid = null;
    let bestVotes = 0;
    for (const [rid, count] of Object.entries(rosterVotes)) {
      if (count > bestVotes) { bestVotes = count; bestRid = rid; }
    }
    const detectedRc = rosterClasses.find((rc) => rc.id === bestRid);
    if (detectedRc) {
      setDetectedBatchClass(detectedRc.className);
      setDetectedBatchRosterId(bestRid);
    }

    setResults(updated);

    // Update published results with roster IDs
    if (resultsUrl) {
      for (const r of updated) {
        if (r.error || !r.refCode) continue;
        const sid = r.rosterStudentId || r.rosterEdsbyId || null;
        if (!sid && !r.rosterFirstName) continue;
        fetch(`${resultsUrl.replace(/\/$/, "")}/${r.refCode}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studentId: sid,
            studentName: r.rosterFirstName ? `${r.rosterFirstName} ${r.rosterLastName || ""}`.trim() : (r.studentName || null),
            className: r.rosterClassName || "",
          }),
        }).catch(() => {});
      }
    }
  }, [rosterClasses, results.length, grading]);

  const handleRosterUpload = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    e.target.value = "";

    const email = parentTeacherEmail || (() => { try { return localStorage.getItem("curriculate_report_email") || ""; } catch { return ""; } })();
    if (!email || !email.includes("@")) {
      alert("Please set your email address in the email field above first, then upload your Edsby CSV.");
      return;
    }

    setRosterUploading(true);
    const rosterBase = gradingUrl.replace(/\/grading$/, "/class-roster");
    const errors = [];
    for (const file of files) {
      try {
        const text = await file.text();
        const res = await fetch(`${rosterBase}/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacherEmail: email,
            csvText: text,
            sourceFile: file.name,
          }),
        });
        const data = await res.json();
        if (!res.ok) errors.push(`${file.name}: ${data.error || "failed"}`);
      } catch (err) {
        errors.push(`${file.name}: ${err?.message || "failed"}`);
      }
    }
    // Refresh roster list
    try {
      const listRes = await fetch(`${rosterBase}/list?teacherEmail=${encodeURIComponent(email)}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        setRosterClasses(listData.rosters || []);
      }
    } catch {}
    if (errors.length) alert("Some files failed:\n" + errors.join("\n"));
    else {
      try { if (window.gtag) window.gtag("event", "roster_uploaded", { file_count: files.length }); } catch {}
    }
    setRosterUploading(false);
  }, [gradingUrl]);

  const deleteRoster = useCallback(async (rosterId) => {
    if (!confirm("Delete this class roster?")) return;
    try {
      const rosterBase = gradingUrl.replace(/\/grading$/, "/class-roster");
      await fetch(`${rosterBase}/${rosterId}`, { method: "DELETE" });
      setRosterClasses((prev) => prev.filter((r) => r.id !== rosterId));
    } catch {}
  }, [gradingUrl]);

  // Generate IDs from a list of names
  const generateManualRoster = useCallback(() => {
    const lines = manualRosterText.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const students = lines.map((line, i) => {
      const parts = line.split(/\s+/);
      const firstName = parts[0] || "";
      const lastName = parts.slice(1).join(" ") || "";
      // Generate a 4-digit ID: initials + padded number
      const initials = ((firstName[0] || "X") + (lastName[0] || "X")).toUpperCase();
      const num = String(i + 1).padStart(2, "0");
      const studentId = `${initials}${num}`;
      return { firstName, lastName, studentId };
    });
    setManualRosterPreview(students);
  }, [manualRosterText]);

  // Save manual roster to backend
  const saveManualRoster = useCallback(async () => {
    if (!manualRosterPreview || !manualRosterPreview.length) return;
    const email = parentTeacherEmail || (() => { try { return localStorage.getItem("curriculate_report_email") || ""; } catch { return ""; } })();
    if (!email || !email.includes("@")) {
      alert("Please set your email address in the email field above first.");
      return;
    }
    setRosterUploading(true);
    try {
      // Build a simple CSV from the manual roster
      const header = "First Name,Last Name,Student ID";
      const rows = manualRosterPreview.map((s) => `${s.firstName},${s.lastName},${s.studentId}`);
      const csvText = [header, ...rows].join("\n");
      const className = manualClassName.trim() || "My Class";

      const rosterBase = gradingUrl.replace(/\/grading$/, "/class-roster");
      const res = await fetch(`${rosterBase}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherEmail: email,
          csvText,
          className,
          sourceFile: `manual-${className}.csv`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // Refresh roster list
        const listRes = await fetch(`${rosterBase}/list?teacherEmail=${encodeURIComponent(email)}`);
        if (listRes.ok) {
          const listData = await listRes.json();
          setRosterClasses(listData.rosters || []);
        }
        setShowManualRoster(false);
        setManualRosterText("");
        setManualRosterPreview(null);
        setManualClassName("");
      }
    } catch (e) {
      console.warn("[batch] manual roster save failed:", e);
    }
    setRosterUploading(false);
  }, [manualRosterPreview, manualClassName, gradingUrl]);

  const totalRosterStudents = rosterClasses.reduce((s, r) => s + (r.studentCount || 0), 0);

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

      {/* Edsby Class Roster */}
      <div style={{ margin: "0 0 8px" }}>
        <button
          onClick={() => setShowRoster(!showRoster)}
          type="button"
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 13, color: "#64748b", display: "flex", alignItems: "center", gap: 6,
            padding: "4px 0",
          }}
        >
          <span style={{ fontSize: 11, transform: showRoster ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.15s" }}>▶</span>
          <span>Class Roster</span>
          {totalRosterStudents > 0 && (
            <span style={{ fontSize: 11, background: "#e0f2fe", color: "#0369a1", borderRadius: 8, padding: "1px 7px", fontWeight: 700 }}>
              {totalRosterStudents} student{totalRosterStudents !== 1 ? "s" : ""}
            </span>
          )}
        </button>

        {showRoster && (
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginTop: 6, fontSize: 13 }}>
            <div style={{ marginBottom: 8, color: "#475569", lineHeight: 1.5 }}>
              Upload a class CSV (from Edsby or any spreadsheet with First Name, Last Name, Student ID columns), or click "Create Roster" to type names and auto-generate IDs. Students are auto-matched by name after grading. Note: you'll need to upload rosters on each device until login is available.
            </div>

            <input
              ref={rosterFileRef}
              type="file"
              accept=".csv,.txt"
              multiple
              onChange={handleRosterUpload}
              style={{ display: "none" }}
            />
            <button
              onClick={() => rosterFileRef.current?.click()}
              disabled={rosterUploading}
              type="button"
              style={{
                background: "#2563eb", color: "#fff", border: "none", borderRadius: 6,
                padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                opacity: rosterUploading ? 0.6 : 1, marginBottom: 8,
              }}
            >
              {rosterUploading ? "Uploading..." : "Upload CSVs"}
            </button>
            <button
              onClick={() => setShowManualRoster(!showManualRoster)}
              type="button"
              style={{
                background: "none", color: "#2563eb", border: "1px solid #2563eb", borderRadius: 6,
                padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                marginBottom: 8, marginLeft: 8,
              }}
            >
              {showManualRoster ? "Cancel" : "Create Roster"}
            </button>

            {/* Manual roster entry */}
            {showManualRoster && (
              <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "#475569", marginBottom: 6 }}>
                  Type student names, one per line (First Last). Click "Generate IDs" to auto-assign codes.
                </div>
                <input
                  placeholder="Class name (e.g. Math 7A)"
                  value={manualClassName}
                  onChange={(e) => setManualClassName(e.target.value)}
                  style={{ width: "100%", padding: "6px 10px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, marginBottom: 6, boxSizing: "border-box" }}
                />
                <textarea
                  placeholder={"Arjun Singh\nMaya Patel\nEli Campbell\n..."}
                  value={manualRosterText}
                  onChange={(e) => { setManualRosterText(e.target.value); setManualRosterPreview(null); }}
                  rows={6}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 6, resize: "vertical", fontFamily: "inherit", boxSizing: "border-box" }}
                />
                <button
                  onClick={generateManualRoster}
                  type="button"
                  disabled={!manualRosterText.trim()}
                  style={{
                    background: "#f59e0b", color: "#fff", border: "none", borderRadius: 6,
                    padding: "6px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                    marginTop: 6, opacity: manualRosterText.trim() ? 1 : 0.4,
                  }}
                >
                  Generate IDs
                </button>

                {/* Preview with editable IDs */}
                {manualRosterPreview && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                      Preview — edit any ID if needed, then save:
                    </div>
                    <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                      {manualRosterPreview.map((s, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px", borderBottom: "1px solid #f1f5f9", fontSize: 13 }}>
                          <span style={{ flex: 1 }}>{s.firstName} {s.lastName}</span>
                          <input
                            value={s.studentId}
                            onChange={(e) => {
                              setManualRosterPreview((prev) => {
                                const updated = [...prev];
                                updated[i] = { ...updated[i], studentId: e.target.value };
                                return updated;
                              });
                            }}
                            style={{
                              width: 70, padding: "2px 6px", fontSize: 13, fontWeight: 700,
                              border: "1px solid #e2e8f0", borderRadius: 4, textAlign: "center",
                              fontFamily: "monospace",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={saveManualRoster}
                      type="button"
                      disabled={rosterUploading}
                      style={{
                        background: "#16a34a", color: "#fff", border: "none", borderRadius: 6,
                        padding: "8px 18px", fontSize: 13, fontWeight: 700, cursor: "pointer",
                        marginTop: 8, opacity: rosterUploading ? 0.5 : 1,
                      }}
                    >
                      {rosterUploading ? "Saving..." : `Save Roster (${manualRosterPreview.length} students)`}
                    </button>
                  </div>
                )}
              </div>
            )}

            {rosterLoading && <div style={{ color: "#94a3b8", fontSize: 12 }}>Loading rosters...</div>}

            {rosterClasses.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {rosterClasses.map((rc) => (
                  <div key={rc.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "6px 0", borderBottom: "1px solid #e2e8f0",
                  }}>
                    <div>
                      <span style={{ fontWeight: 700 }}>{rc.className}</span>
                      <span style={{ color: "#94a3b8", marginLeft: 8, fontSize: 12 }}>
                        {rc.studentCount} student{rc.studentCount !== 1 ? "s" : ""}
                      </span>
                      {rc.sourceFile && (
                        <span style={{ color: "#cbd5e1", marginLeft: 6, fontSize: 11 }}>
                          ({rc.sourceFile})
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => deleteRoster(rc.id)}
                      type="button"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "#ef4444", fontSize: 14, padding: "2px 6px",
                      }}
                      title="Delete this roster"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {rosterClasses.length === 0 && !rosterLoading && (
              <div style={{ color: "#94a3b8", fontSize: 12, fontStyle: "italic" }}>
                No class rosters uploaded yet. Export a gradebook CSV from Edsby and upload it here.
              </div>
            )}
          </div>
        )}
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

      {/* Recently processed PDFs */}
      {!pdfFile && (() => {
        try {
          const processed = JSON.parse(localStorage.getItem("curriculate_processed_pdfs_v1") || "[]");
          if (!processed.length) return null;
          return (
            <div style={{ marginTop: 8, padding: "10px 14px", background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#16a34a" }}>Recently processed</span>
                <button
                  type="button"
                  onClick={() => { try { localStorage.removeItem("curriculate_processed_pdfs_v1"); } catch {} window.location.reload(); }}
                  style={{ fontSize: 11, color: "#94a3b8", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
                >Clear list</button>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {processed.slice(-20).reverse().map((name, i) => (
                  <span key={i} style={{ fontSize: 11, color: "#16a34a", background: "rgba(34,197,94,0.1)", padding: "3px 8px", borderRadius: 6 }}>
                    ✓ {name}
                  </span>
                ))}
              </div>
            </div>
          );
        } catch { return null; }
      })()}

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
      {pdfFile && !grading && (
        <div style={batchStyles.configSection}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {pdfName} — {pageCount} page{pageCount !== 1 ? "s" : ""}
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <label style={batchStyles.label}>
              Answer key pages
              <select
                value={answerKeyPages}
                onChange={(e) => setAnswerKeyPages(Number(e.target.value))}
                style={batchStyles.select}
              >
                <option value={0}>None</option>
                {Array.from({ length: Math.min(pageCount, 5) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    First {n} page{n > 1 ? "s" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label style={batchStyles.label}>
              Pages per student
              <select
                value={pagesPerStudent}
                onChange={(e) => {
                  const v = e.target.value;
                  setPagesPerStudent(v === "auto" ? "auto" : v === "tap" ? "tap" : Number(v));
                  if (v !== "auto") setDetectedGroups(null);
                }}
                style={batchStyles.select}
              >
                <option value="auto">Auto-detect</option>
                <option value="tap">Tap to mark</option>
                {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                  <option key={n} value={n}>
                    {n} page{n > 1 ? "s" : ""} each
                  </option>
                ))}
              </select>
            </label>

            <label style={{
              ...batchStyles.label,
              cursor: "pointer",
              paddingTop: 18,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  onClick={() => setPrecisionMode(!precisionMode)}
                  style={{
                    width: 40,
                    height: 22,
                    borderRadius: 11,
                    background: precisionMode ? "#2563eb" : "#d1d5db",
                    position: "relative",
                    transition: "background 0.2s",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <div style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: "#fff",
                    position: "absolute",
                    top: 2,
                    left: precisionMode ? 20 : 2,
                    transition: "left 0.2s",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }} />
                </div>
                <span
                  style={{ fontSize: 13, fontWeight: 600 }}
                  title="Best for tests, exams, and high-stakes assignments. Grades each student multiple times and uses the median score for extra consistency."
                >
                  Precision Mode
                </span>
              </div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 2 }}>
                {precisionMode
                  ? `${PRECISION_PASSES} passes per student — median score (slower, more consistent)`
                  : "Single pass (faster)"}
              </div>
            </label>

            <div style={{ fontSize: 13, opacity: 0.7, paddingTop: 20 }}>
              {answerKeyPages > 0 && (
                <div style={{ color: "#059669", fontWeight: 600, marginBottom: 2 }}>
                  Page{answerKeyPages > 1 ? `s 1–${answerKeyPages}` : " 1"} = answer key
                </div>
              )}
              <div>
                {studentPages > 0 ? (
                  isAuto ? (
                    detectedGroups ? (
                      <>
                        = <strong>{detectedGroups.length}</strong> student{detectedGroups.length !== 1 ? "s" : ""} detected
                        <span style={{ color: "#2563eb", marginLeft: 6 }}>
                          ({detectedGroups.map((g) => g.pages.length).join(", ")} pages)
                        </span>
                      </>
                    ) : (
                      <span style={{ opacity: 0.6 }}>
                        Will auto-detect student boundaries when grading starts
                      </span>
                    )
                  ) : isTap ? (
                    tapMarkedPages.size > 0 ? (
                      <>
                        = <strong>{tapMarkedPages.size}</strong> student{tapMarkedPages.size !== 1 ? "s" : ""} marked
                        {tapGroups && (
                          <span style={{ color: "#2563eb", marginLeft: 6 }}>
                            ({tapGroups.map((g) => g.pages.length).join(", ")} pages)
                          </span>
                        )}
                      </>
                    ) : (
                      <span style={{ opacity: 0.6 }}>
                        Tap the first page of each student&apos;s work below
                      </span>
                    )
                  ) : (
                    <>
                      = <strong>{studentCount}</strong> student{studentCount !== 1 ? "s" : ""}
                      {studentPages % fixedPps !== 0 && (
                        <span style={{ color: "#ca8a04", marginLeft: 6 }}>
                          (last student: {studentPages % fixedPps} page{studentPages % fixedPps !== 1 ? "s" : ""})
                        </span>
                      )}
                    </>
                  )
                ) : (
                  <span style={{ color: "#dc2626" }}>No pages left for students</span>
                )}
              </div>
            </div>
          </div>

          {/* Auto-detect preview */}
          {isAuto && !detectedGroups && studentPages > 0 && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={runAutoDetect}
                disabled={detecting}
                style={{
                  ...batchStyles.ghostBtn,
                  color: "#2563eb",
                  borderColor: "rgba(37,99,235,0.3)",
                }}
                type="button"
              >
                {detecting ? "Detecting..." : "Preview detected splits"}
              </button>
              <span style={{ fontSize: 11, opacity: 0.5, marginLeft: 8 }}>
                Optional — will run automatically when grading starts
              </span>
            </div>
          )}

          {/* Detected groups preview */}
          {isAuto && detectedGroups && (
            <div style={{
              marginTop: 8,
              padding: 10,
              borderRadius: 10,
              background: "rgba(37,99,235,0.04)",
              border: "1px solid rgba(37,99,235,0.15)",
              fontSize: 12,
            }}>
              <div style={{ fontWeight: 800, marginBottom: 6, color: "#1e40af" }}>
                Detected {detectedGroups.length} student{detectedGroups.length !== 1 ? "s" : ""}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {detectedGroups.map((g, i) => (
                  <span
                    key={i}
                    style={{
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: "rgba(37,99,235,0.1)",
                      fontWeight: 700,
                      color: "#1e40af",
                    }}
                  >
                    {g.name || `Student ${i + 1}`}: p{g.pages.length === 1 ? g.pages[0] : `${g.startPage}–${g.endPage}`}
                  </span>
                ))}
              </div>
              <button
                onClick={() => setDetectedGroups(null)}
                style={{ ...batchStyles.ghostBtn, marginTop: 6, fontSize: 11, padding: "4px 10px" }}
                type="button"
              >
                Re-detect
              </button>
            </div>
          )}


          {/* Tap-to-mark thumbnail grid */}
          {isTap && pageCount > 0 && (
            <div style={{
              marginTop: 10,
              padding: 12,
              borderRadius: 10,
              background: "rgba(37,99,235,0.03)",
              border: "1px solid rgba(37,99,235,0.12)",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#1e40af", marginBottom: 8 }}>
                Tap the first page of each new student&apos;s assignment
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                gap: 6,
              }}>
                {(thumbnails.length > 0 ? thumbnails : Array.from({ length: pageCount }, (_, i) => ({ page: i + 1, dataUrl: null }))).map(({ page, dataUrl }) => {
                  const isMarked = tapMarkedPages.has(page);
                  const isKey = page <= answerKeyPages;
                  return (
                    <div
                      key={page}
                      onClick={() => {
                        if (isKey) return;
                        setTapMarkedPages(prev => {
                          const next = new Set(prev);
                          if (next.has(page)) next.delete(page);
                          else next.add(page);
                          return next;
                        });
                      }}
                      style={{
                        position: "relative",
                        cursor: isKey ? "default" : "pointer",
                        borderRadius: 6,
                        border: isMarked ? "3px solid #2563eb" : isKey ? "2px solid #059669" : "2px solid rgba(0,0,0,0.1)",
                        background: isMarked ? "rgba(37,99,235,0.08)" : isKey ? "rgba(5,150,105,0.06)" : "#fff",
                        overflow: "hidden",
                        opacity: isKey ? 0.5 : 1,
                        transition: "border-color 0.15s, background 0.15s",
                      }}
                    >
                      {dataUrl ? (
                        <img src={dataUrl} alt={`Page ${page}`} style={{ width: "100%", display: "block" }} />
                      ) : (
                        <div style={{ width: "100%", paddingTop: "141%", background: "#f3f4f6" }} />
                      )}
                      <div style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        padding: "2px 0",
                        textAlign: "center",
                        fontSize: 10,
                        fontWeight: isMarked ? 800 : 600,
                        color: isMarked ? "#fff" : isKey ? "#059669" : "#64748b",
                        background: isMarked ? "rgba(37,99,235,0.85)" : "rgba(255,255,255,0.85)",
                      }}>
                        {isKey ? "Key" : isMarked ? `#${[...tapMarkedPages].sort((a, b) => a - b).indexOf(page) + 1}` : page}
                      </div>
                    </div>
                  );
                })}
              </div>
              {tapMarkedPages.size > 0 && (
                <button
                  onClick={() => setTapMarkedPages(new Set())}
                  style={{ ...batchStyles.ghostBtn, marginTop: 8, fontSize: 11, padding: "4px 10px" }}
                  type="button"
                >
                  Clear all marks
                </button>
              )}
            </div>
          )}

          {extractedAnswerKey && (
            <div style={{ ...batchStyles.sticky, marginTop: 8 }}>
              Answer key extracted — will apply to all students
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <button
              onClick={runBatch}
              disabled={isTap && tapMarkedPages.size === 0}
              style={{
                ...batchStyles.runBtn,
                ...(isTap && tapMarkedPages.size === 0 ? { opacity: 0.4, cursor: "not-allowed" } : {}),
              }}
              type="button"
            >
              {isTap
                ? tapMarkedPages.size > 0
                  ? `Grade ${tapMarkedPages.size} Student${tapMarkedPages.size !== 1 ? "s" : ""}`
                  : "Mark students first"
                : isAuto && !detectedGroups
                ? `Grade ${studentPages} Page${studentPages !== 1 ? "s" : ""}`
                : `Grade ${studentCount} Student${studentCount !== 1 ? "s" : ""}`}
            </button>

            <button
              onClick={() => {
                setPdfFile(null);
                setPdfName("");
                setPageCount(0);
                setAnswerKeyPages(0);
                setExtractedAnswerKey(answerKeyOverride || "");
                setDetectedGroups(null);
                pdfDocRef.current = null;
                if (fileInputRef.current) fileInputRef.current.value = "";
                // Clear previous results
                setResults([]);
                setClassSummary(null);
                setTeacherAnalysis("");
                setExpandedIndex(null);
                setCopiedSummary(false);
                setEmailCopied(false);
                setCsvExported(false);
                setReportsPrinted(false);
                setStripsPrinted(false);
                classChangeCountRef.current = 0;
              }}
              style={{ ...batchStyles.ghostBtn, marginLeft: 10 }}
              type="button"
            >
              Change PDF
            </button>
          </div>
        </div>
      )}

      {/* Rotation status message (appears briefly when upside-down pages detected) */}
      {rotationMsg && !grading && (
        <div style={{ fontSize: 13, color: "#7c3aed", fontWeight: 600, padding: "6px 0", textAlign: "center" }}>
          {rotationMsg}
        </div>
      )}

      {/* Progress */}
      {grading && (
        <div style={batchStyles.progressSection}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{progress.current}{rotationMsg ? ` — ${rotationMsg}` : ""}</div>
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

      {/* Mixed denominator prompt */}
      {denomPrompt?.show && (
        <div style={{
          background: "#fffbeb", border: "1px solid #f59e0b", borderRadius: 10,
          padding: "14px 18px", marginBottom: 12,
        }}>
          <div style={{ fontWeight: 700, marginBottom: 8, color: "#92400e" }}>
            Mixed totals detected: assignments are scored out of {denomPrompt.denoms.join(" and ")}.
          </div>
          <div style={{ fontSize: 13, color: "#78350f", marginBottom: 10 }}>
            How would you like to report scores?
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={convertToPercent}
              style={{ ...batchStyles.smallBtn, background: "#f59e0b", color: "#fff", border: "none" }}
              type="button"
            >
              Percentage (%)
            </button>
            {denomPrompt.denoms.map((d) => (
              <button
                key={d}
                onClick={() => normalizeDenoms(d)}
                style={batchStyles.smallBtn}
                type="button"
              >
                Out of {d}
              </button>
            ))}
            <button
              onClick={() => setDenomPrompt(null)}
              style={{ ...batchStyles.smallBtn, opacity: 0.6 }}
              type="button"
            >
              Keep as-is
            </button>
          </div>
        </div>
      )}

      {/* Scan orientation tip — shown after 3rd batch */}
      {scanTipVisible && (
        <div style={{
          background: "linear-gradient(135deg, #eff6ff, #f0fdf4)",
          border: "1px solid #93c5fd",
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 12,
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          fontSize: 13,
          color: "#1e3a5f",
          lineHeight: 1.5,
        }}>
          <span style={{ fontSize: 18, flexShrink: 0 }}>💡</span>
          <div style={{ flex: 1 }}>
            <strong>Did you know?</strong> You can scan papers in any orientation — even upside down.
            For example, to avoid staples jamming in the feeder, scan with the stapled edge trailing.
            Pulse will detect the orientation and auto-rotate before grading.
          </div>
          <button
            onClick={() => {
              setScanTipVisible(false);
              try {
                const tipKey = "curriculate_batch_scan_tip_v1";
                const tipData = JSON.parse(localStorage.getItem(tipKey) || "{}");
                tipData.dismissed = true;
                localStorage.setItem(tipKey, JSON.stringify(tipData));
              } catch {}
            }}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#64748b", fontSize: 16, padding: "0 2px", flexShrink: 0,
            }}
            type="button"
            title="Dismiss"
          >✕</button>
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
                {copiedSummary ? "Copied ✓" : "Copy Summary"}
              </button>
              <button onClick={emailSummary} style={batchStyles.smallBtn} type="button">
                {emailCopied ? "Sent ✓" : "Email Summary"}
              </button>
              <button onClick={exportCsv} style={batchStyles.smallBtn} type="button">
                {csvExported ? "Exported ✓" : "Export CSV"}
              </button>
              <button
                onClick={async () => {
                  const good = results.filter((r) => !r.error);
                  if (!good.length) { alert("No successful results to print."); return; }
                  let title = effectiveTitle;
                  if (!title) {
                    const t = window.prompt("Assignment title (appears on footer — leave blank to skip):");
                    if (t === null) return;
                    if (t.trim()) { title = t.trim(); setEmailTitle(title); }
                  }
                  try {
                    const opts = title ? { title } : {};
                    const b64 = await buildResultsPdf(results, opts);
                    if (!b64) { alert("No results available."); return; }
                    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "application/pdf" });
                    window.open(URL.createObjectURL(blob), "_blank");
                    setReportsPrinted(true);
                  } catch (e) {
                    console.error("[batch] PDF report failed:", e?.message || e);
                    alert(`Failed to generate PDF: ${e?.message || "unknown error"}`);
                  }
                }}
                style={batchStyles.smallBtn}
                type="button"
              >
                {reportsPrinted ? "Printed ✓" : "Print Reports"}
              </button>
              <button
                onClick={async () => {
                  const good = results.filter((r) => !r.error);
                  if (!good.length) { alert("No successful results to print."); return; }
                  let title = effectiveTitle;
                  if (!title) {
                    const t = window.prompt("Assignment title (appears on footer — leave blank to skip):");
                    if (t === null) return;
                    if (t.trim()) { title = t.trim(); setEmailTitle(title); }
                  }
                  try {
                    const opts = title ? { title } : {};
                    const b64 = await buildStripsPdf(results, opts);
                    if (!b64) { alert("No results available."); return; }
                    const blob = new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "application/pdf" });
                    window.open(URL.createObjectURL(blob), "_blank");
                    setStripsPrinted(true);
                  } catch (e) {
                    console.error("[batch] PDF strips failed:", e?.message || e);
                    alert(`Failed to generate PDF: ${e?.message || "unknown error"}`);
                  }
                }}
                style={batchStyles.smallBtn}
                type="button"
              >
                {stripsPrinted ? "Printed ✓" : "Print Strips"}
              </button>
              {!grading && (
                <button
                  onClick={() => {
                    setResults([]);
                    setClassSummary(null);
                    setTeacherAnalysis("");
                    setDetectedGroups(null);
                    setExpandedIndex(null);
                    setCopiedSummary(false);
                    setEmailCopied(false);
                    setCsvExported(false);
                    setReportsPrinted(false);
                    setStripsPrinted(false);
                  }}
                  style={batchStyles.smallBtn}
                  type="button"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Email send prompt */}
          {showEmailPrompt && (
            <div style={{
              padding: "12px 14px",
              borderRadius: 10,
              border: "1px solid rgba(37,99,235,0.25)",
              background: "rgba(37,99,235,0.04)",
              marginBottom: 10,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", minWidth: 60 }}>Send to:</span>
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => {
                    setEmailTo(e.target.value);
                    // Sync to parent so rosters auto-load for this email
                    if (parentSetTeacherEmail) parentSetTeacherEmail(e.target.value);
                  }}
                  placeholder="recipient@school.ca"
                  onKeyDown={(e) => { if (e.key === "Enter") sendEmail(); }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 13,
                    outline: "none",
                  }}
                  autoFocus
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", minWidth: 60 }}>Title:</span>
                <input
                  type="text"
                  value={emailTitle}
                  onChange={(e) => setEmailTitle(e.target.value)}
                  placeholder="e.g. Journal #3 — Period 2 (optional)"
                  onKeyDown={(e) => { if (e.key === "Enter") sendEmail(); }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid #d1d5db",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setShowEmailPrompt(false)}
                  style={{ ...batchStyles.smallBtn, padding: "5px 10px" }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  onClick={sendEmail}
                  disabled={emailSending || !emailTo.includes("@")}
                  style={{
                    ...batchStyles.smallBtn,
                    background: "#2563eb",
                    color: "#fff",
                    opacity: emailSending || !emailTo.includes("@") ? 0.5 : 1,
                  }}
                  type="button"
                >
                  {emailSending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          )}

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

          {/* Teacher analysis (AI-generated class insights) */}
          {teacherAnalysis && (
            <div style={batchStyles.analysisCard}>
              <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: "#1e40af" }}>
                Class Analysis
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {teacherAnalysis}
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
                  {rosterClasses.length > 1 && <th style={{ ...batchStyles.th, textAlign: "left" }}>Class</th>}
                  <th style={batchStyles.th}>Pages</th>
                  <th style={batchStyles.th}>
                    {editingDenom ? (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const newDenom = Math.round(Number(denomInput));
                          if (Number.isFinite(newDenom) && newDenom > 0) {
                            normalizeDenoms(newDenom);
                          }
                          setEditingDenom(false);
                          setDenomInput("");
                        }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                      >
                        <span style={{ fontSize: 10, opacity: 0.7 }}>/ </span>
                        <input
                          autoFocus
                          type="number"
                          min="1"
                          value={denomInput}
                          onChange={(e) => setDenomInput(e.target.value)}
                          onBlur={() => { setEditingDenom(false); setDenomInput(""); }}
                          onKeyDown={(e) => { if (e.key === "Escape") { setEditingDenom(false); setDenomInput(""); } }}
                          style={{
                            width: 48, fontSize: 11, fontWeight: 700,
                            border: "1px solid #2563eb", borderRadius: 4,
                            padding: "2px 4px", textAlign: "center",
                            outline: "none",
                          }}
                        />
                      </form>
                    ) : (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          // Pre-fill with the most common denominator
                          const denomCounts = {};
                          results.forEach((r) => {
                            if (!r.error && typeof r.outOf === "number" && r.outOf > 0) {
                              denomCounts[r.outOf] = (denomCounts[r.outOf] || 0) + 1;
                            }
                          });
                          const topDenom = Object.entries(denomCounts).sort((a, b) => b[1] - a[1])[0];
                          setDenomInput(topDenom ? topDenom[0] : "");
                          setEditingDenom(true);
                        }}
                        title="Click to change denominator for all students"
                        style={{ cursor: "pointer", borderBottom: "1px dashed #94a3b8" }}
                      >
                        Score
                      </span>
                    )}
                  </th>
                  <th style={batchStyles.th}>%</th>
                  <th style={batchStyles.th}>Grade</th>
                  <th style={batchStyles.th}>Code</th>
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
                      <td style={{ ...batchStyles.td, fontWeight: 700, textAlign: "left", position: "relative" }}>
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingNameIndex(editingNameIndex === r.index ? null : r.index);
                          }}
                          style={{
                            cursor: "pointer",
                            borderBottom: "1px dashed #94a3b8",
                            color: (!r.rosterEdsbyId && !r.rosterStudentId && !r.rosterFirstName && rosterClasses.length > 0) ? "#dc2626" : r.multiRosterMatch ? "#d97706" : "inherit",
                          }}
                          title={r.multiRosterMatch ? "This name appears in multiple classes — click to verify" : "Click to change student name"}
                        >
                          {r.studentName}
                        </span>
                        {r.studentId && (
                          <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 400, marginLeft: 6 }} title={`ID detected: ${r.studentId}${r.rosterFirstName ? ` → ${r.rosterFirstName} ${r.rosterLastName}` : ""}`}>
                            #{r.studentId.slice(-4)}
                          </span>
                        )}
                        {editingNameIndex === r.index && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: "absolute", top: "100%", left: 0, zIndex: 50,
                              background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8,
                              boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 220,
                              display: "flex", flexDirection: "column",
                            }}
                          >
                            {availableRosterStudents.length > 0 && (
                              <div style={{ maxHeight: 220, overflowY: "auto", padding: "4px 0" }}>
                                <div style={{ padding: "6px 12px", fontSize: 10, color: "#94a3b8", textTransform: "uppercase", fontWeight: 600, position: "sticky", top: 0, background: "#fff" }}>
                                  Roster students
                                </div>
                                {availableRosterStudents.map((s, si) => (
                                  <div
                                    key={si}
                                    onClick={() => assignStudentName(r.index, s)}
                                    style={{
                                      padding: "8px 12px", cursor: "pointer", fontSize: 13,
                                      borderBottom: "1px solid #f1f5f9",
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.background = "#f1f5f9"; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                                  >
                                    {s.firstName} {s.lastName}
                                    <span style={{ fontSize: 10, color: "#94a3b8", marginLeft: 6 }}>{s.className}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            <div style={{ borderTop: availableRosterStudents.length ? "1px solid #e2e8f0" : "none", padding: "4px 0" }}>
                              <div style={{ padding: "6px 12px", fontSize: 10, color: "#94a3b8", textTransform: "uppercase", fontWeight: 600 }}>
                                Type a name
                              </div>
                              <div style={{ padding: "4px 8px 6px" }}>
                                <input
                                  autoFocus
                                  placeholder={r.studentName}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" && e.target.value.trim()) {
                                      const parts = e.target.value.trim().split(/\s+/);
                                      const first = parts[0] || "";
                                      const last = parts.slice(1).join(" ") || "";
                                      setResults((prev) => {
                                        const updated = [...prev];
                                        const item = updated.find((x) => x.index === r.index);
                                        if (item) {
                                          item.studentName = e.target.value.trim();
                                          item.rosterFirstName = first;
                                          item.rosterLastName = last;
                                        }
                                        return updated;
                                      });
                                      setEditingNameIndex(null);
                                    } else if (e.key === "Escape") {
                                      setEditingNameIndex(null);
                                    }
                                  }}
                                  style={{
                                    width: "100%", padding: "6px 8px", fontSize: 13,
                                    border: "1px solid #e2e8f0", borderRadius: 6, outline: "none",
                                  }}
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                      {rosterClasses.length > 1 && (
                        <td style={{ ...batchStyles.td, padding: "2px 4px" }} onClick={(e) => e.stopPropagation()}>
                          {(() => {
                            const isOutlier = detectedBatchClass && r.rosterClassName && r.rosterClassName !== detectedBatchClass;
                            return (
                          <select
                            value={r.rosterClassName || ""}
                            onChange={(e) => {
                              const newClass = e.target.value;
                              classChangeCountRef.current += 1;

                              if (classChangeCountRef.current >= 2) {
                                // After 2 manual changes, offer to change all
                                const changeAll = window.confirm(
                                  `Change all students in this batch to ${newClass}?`
                                );
                                if (changeAll) {
                                  setResults((prev) => prev.map((x) => ({ ...x, rosterClassName: newClass })));
                                  setDetectedBatchClass(newClass);
                                  classChangeCountRef.current = 0;
                                  return;
                                }
                              }

                              setResults((prev) => {
                                const updated = [...prev];
                                const item = updated.find((x) => x.index === r.index);
                                if (item) item.rosterClassName = newClass;
                                return updated;
                              });
                            }}
                            style={{
                              fontSize: 11, padding: "3px 4px",
                              border: isOutlier ? "1px solid rgba(217,119,6,0.5)" : "1px solid #e2e8f0",
                              borderRadius: 5,
                              background: isOutlier ? "rgba(254,243,199,0.8)" : "#fff",
                              color: "#334155",
                              cursor: "pointer", minWidth: 90, width: "auto",
                            }}
                            title={isOutlier ? `Different from batch class (${detectedBatchClass})` : ""}
                          >
                            <option value="">—</option>
                            {[...rosterClasses].sort((a, b) => a.className.localeCompare(b.className)).map((rc) => (
                              <option key={rc.id} value={rc.className}>{rc.className}</option>
                            ))}
                          </select>
                            );
                          })()}
                        </td>
                      )}
                      <td
                        style={{ ...batchStyles.td, cursor: r.pageImages?.length ? "pointer" : "default", color: r.pageImages?.length ? "#2563eb" : undefined, textDecoration: r.pageImages?.length ? "underline" : "none" }}
                        onClick={(e) => { e.stopPropagation(); if (r.pageImages?.length) setPreviewIndex(previewIndex === r.index ? null : r.index); }}
                        title={r.pageImages?.length ? "Tap to preview source" : ""}
                      >{r.pages}</td>
                      <td style={{ ...batchStyles.td, whiteSpace: "nowrap" }}>
                        {regradingIndex === r.index ? (
                          <span style={{ fontSize: 11, color: "#64748b" }}>grading…</span>
                        ) : (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 0 }}>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); regradeStudent(r.index, 1); }}
                              disabled={!!regradingIndex || (studentBias[r.index] || 0) >= 3}
                              title="Re-grade more strictly (lower score)"
                              style={{
                                border: "none", background: "transparent",
                                cursor: (studentBias[r.index] || 0) >= 3 ? "default" : "pointer",
                                padding: "0 2px", fontSize: 15, fontWeight: 700, lineHeight: 1,
                                color: (studentBias[r.index] || 0) >= 3 ? "#cbd5e1" : "#64748b",
                                opacity: (studentBias[r.index] || 0) >= 3 ? 0.4 : 0.7,
                              }}
                            >&#8249;</button>
                            <span>
                              {r.score}/
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDenomInput(String(r.outOf));
                                  setEditingDenom(true);
                                }}
                                title="Click to change denominator for all students"
                                style={{ cursor: "pointer", borderBottom: "1px dashed #94a3b8" }}
                              >{r.outOf}</span>
                            </span>
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); regradeStudent(r.index, -1); }}
                              disabled={!!regradingIndex || (studentBias[r.index] || 0) <= -3}
                              title="Re-grade more leniently (higher score)"
                              style={{
                                border: "none", background: "transparent",
                                cursor: (studentBias[r.index] || 0) <= -3 ? "default" : "pointer",
                                padding: "0 2px", fontSize: 15, fontWeight: 700, lineHeight: 1,
                                color: (studentBias[r.index] || 0) <= -3 ? "#cbd5e1" : "#64748b",
                                opacity: (studentBias[r.index] || 0) <= -3 ? 0.4 : 0.7,
                              }}
                            >&#8250;</button>
                            {(studentBias[r.index] || 0) !== 0 && (
                              <span style={{
                                fontSize: 8, fontWeight: 600, marginLeft: 2,
                                color: (studentBias[r.index] || 0) > 0 ? "#dc2626" : "#2563eb",
                                textTransform: "uppercase",
                              }}>
                                {(studentBias[r.index] || 0) > 0
                                  ? ((studentBias[r.index] || 0) === 1 ? "S" : (studentBias[r.index] || 0) === 2 ? "S+" : "S++")
                                  : ((studentBias[r.index] || 0) === -1 ? "L" : (studentBias[r.index] || 0) === -2 ? "L+" : "L++")}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td style={batchStyles.td}>
                        {r.pct != null ? `${r.pct}%` : "—"}
                        {r.precisionPasses > 1 && (
                          <span
                            title={`Precision: ${r.precisionPasses} passes, ${r.precisionAgreement}% agreement (scores: ${(r.precisionScores || []).join(", ")})`}
                            style={{
                              display: "inline-block",
                              marginLeft: 4,
                              fontSize: 10,
                              fontWeight: 700,
                              padding: "1px 4px",
                              borderRadius: 4,
                              background: r.precisionAgreement >= 90 ? "#dcfce7" : r.precisionAgreement >= 70 ? "#fef9c3" : "#fee2e2",
                              color: r.precisionAgreement >= 90 ? "#166534" : r.precisionAgreement >= 70 ? "#854d0e" : "#991b1b",
                            }}
                          >
                            {r.precisionAgreement >= 90 ? "●" : r.precisionAgreement >= 70 ? "◐" : "○"}
                          </span>
                        )}
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
                          fontFamily: "monospace",
                          fontWeight: 700,
                          fontSize: 12,
                          letterSpacing: 0.5,
                          color: r.refCode ? "#2563eb" : "#999",
                          cursor: r.refCode ? "pointer" : "default",
                          userSelect: "none",
                        }}
                        onClick={(e) => {
                          if (!r.refCode) return;
                          // Delay single-click to let double-click cancel it
                          const td = e.currentTarget;
                          if (td._clickTimer) return;
                          td._clickTimer = setTimeout(() => {
                            td._clickTimer = null;
                            let text = `For detailed feedback, check www.curriculate.net/results/${r.refCode}`;
                            if (r.rosterStudentId || r.rosterEdsbyId) {
                              text += ` For all results, check www.curriculate.net/progress`;
                            }
                            navigator.clipboard?.writeText(text).then(() => {
                              const orig = td.style.background;
                              td.style.background = "rgba(34,197,94,0.25)";
                              setTimeout(() => { td.style.background = orig; }, 600);
                            });
                          }, 250);
                        }}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          if (!r.refCode) return;
                          const td = e.currentTarget;
                          if (td._clickTimer) { clearTimeout(td._clickTimer); td._clickTimer = null; }
                          window.open(`https://www.curriculate.net/results/${r.refCode}`, "_blank");
                        }}
                        title={r.refCode ? "Click to copy · Double-click to open" : ""}
                      >
                        {r.refCode || "—"}
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
                          <>
                            {r.detectedTitle && <span style={{ fontSize: 10, fontWeight: 700, color: "#7c3aed", marginRight: 6 }}>{r.detectedTitle}</span>}
                            {r.comment.slice(0, r.detectedTitle ? 60 : 100)}
                          </>
                        )}
                      </td>
                    </tr>

                    {/* Expanded detail row */}
                    {expandedIndex === r.index && !r.error && (
                      <tr>
                        <td colSpan={rosterClasses.length > 1 ? 9 : 8} style={batchStyles.expandedTd}>
                          <div style={batchStyles.expandedContent}>
                            {/* Source image preview */}
                            {r.pageImages?.length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{
                                  display: "flex", gap: 10, overflowX: "auto",
                                  justifyContent: r.pageImages.length === 1 ? "center" : "flex-start",
                                }}>
                                  {r.pageImages.map((img, pi) => (
                                    <img
                                      key={pi}
                                      src={img}
                                      alt={`Page ${pi + 1}`}
                                      style={{
                                        maxHeight: 320, maxWidth: r.pageImages.length === 1 ? "100%" : "48%",
                                        borderRadius: 8, border: "1px solid #e2e8f0", objectFit: "contain",
                                        cursor: "zoom-in",
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        const overlay = document.createElement("div");
                                        overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
                                        const im = document.createElement("img");
                                        im.src = img;
                                        im.style.cssText = "max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;";
                                        overlay.appendChild(im);
                                        overlay.onclick = () => document.body.removeChild(overlay);
                                        document.body.appendChild(overlay);
                                      }}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
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

                            {/* KITA or generic sections */}
                            {(() => {
                              const kita = detectKita(r.raw);
                              if (kita) {
                                const weights = getKitaWeights(gradeBand, kita);
                                const weightedPct = computeKitaWeightedPercent(kita, weights);
                                return (
                                  <div style={{ marginTop: 8 }}>
                                    <strong>Achievement Categories (KITA)</strong>
                                    <div style={{
                                      border: "1px solid rgba(37,99,235,0.2)",
                                      borderRadius: 10,
                                      overflow: "hidden",
                                      background: "rgba(37,99,235,0.03)",
                                      marginTop: 6,
                                    }}>
                                      {kita.map((cat, ki) => (
                                        <div
                                          key={cat.short}
                                          style={{
                                            padding: "8px 10px",
                                            borderTop: ki === 0 ? "none" : "1px solid rgba(37,99,235,0.12)",
                                          }}
                                        >
                                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                            <div style={{ fontWeight: 800 }}>
                                              <span style={{
                                                display: "inline-block",
                                                width: 20,
                                                height: 20,
                                                borderRadius: 5,
                                                background: "rgba(37,99,235,0.12)",
                                                textAlign: "center",
                                                lineHeight: "20px",
                                                fontSize: 11,
                                                fontWeight: 900,
                                                marginRight: 6,
                                                color: "#2563eb",
                                              }}>{cat.short}</span>
                                              {cat.name}
                                            </div>
                                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                              <span style={{ fontSize: 11, opacity: 0.6 }}>{weights[ki]}%</span>
                                              <span style={{ fontWeight: 900, minWidth: 36, textAlign: "right" }}>{cat.score}/{cat.outOf}</span>
                                            </div>
                                          </div>
                                          {cat.comment ? (
                                            <div style={{ marginTop: 4, opacity: 0.85, lineHeight: 1.35, paddingLeft: 26, fontSize: 12 }}>
                                              {cat.comment}
                                            </div>
                                          ) : null}
                                        </div>
                                      ))}
                                      <div style={{
                                        padding: "7px 10px",
                                        borderTop: "1px solid rgba(37,99,235,0.18)",
                                        background: "rgba(37,99,235,0.06)",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        fontWeight: 900,
                                        fontSize: 13,
                                      }}>
                                        <span>Weighted Total</span>
                                        <span style={{ color: "#2563eb" }}>{weightedPct}%</span>
                                      </div>
                                    </div>
                                  </div>
                                );
                              }

                              // Non-KITA sections — styled card layout matching results portal
                              if (!Array.isArray(r.sections) || !r.sections.length) return null;
                              const totalScore = r.sections.reduce((s, sec) => s + (Number(sec.score) || 0), 0);
                              const totalOutOf = r.sections.reduce((s, sec) => s + (Number(sec.out_of) || 0), 0);
                              const totalPct = totalOutOf > 0 ? Math.round((totalScore / totalOutOf) * 100) : null;
                              const sectionColors = ["#059669", "#2563eb", "#7c3aed", "#d97706", "#dc2626", "#0891b2"];
                              return (
                                <div style={{ marginTop: 8 }}>
                                  <strong>Rubric Breakdown</strong>
                                  <div style={{
                                    display: "grid",
                                    gridTemplateColumns: r.sections.length <= 2 ? "1fr 1fr" : r.sections.length <= 4 ? "1fr 1fr" : "1fr 1fr 1fr",
                                    gap: 8,
                                    marginTop: 6,
                                  }}>
                                    {r.sections.map((sec, si) => {
                                      const secPct = Number(sec.out_of) > 0 ? Math.round((Number(sec.score) / Number(sec.out_of)) * 100) : 0;
                                      const accent = sectionColors[si % sectionColors.length];
                                      const label = secPct >= 80 ? "Strong" : secPct >= 60 ? "Developing" : "Needs Support";
                                      return (
                                        <div key={si} style={{
                                          padding: "10px 12px",
                                          borderRadius: 10,
                                          background: `${accent}10`,
                                          border: `1px solid ${accent}30`,
                                        }}>
                                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{
                                                display: "inline-flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                width: 22,
                                                height: 22,
                                                borderRadius: 6,
                                                background: accent,
                                                color: "#fff",
                                                fontSize: 10,
                                                fontWeight: 900,
                                              }}>{(sec.name || "?").charAt(0).toUpperCase()}</span>
                                              <span style={{ fontWeight: 800, fontSize: 13 }}>{sec.name}</span>
                                            </div>
                                            <span style={{ fontWeight: 900, fontSize: 13 }}>
                                              {Number(sec.score).toFixed(sec.score % 1 ? 1 : 0)}/{Number(sec.out_of).toFixed(sec.out_of % 1 ? 1 : 0)}
                                            </span>
                                          </div>
                                          <div style={{ fontSize: 11, fontWeight: 700, color: accent, marginTop: 2 }}>{label}</div>
                                          {sec.teacher_comment && (
                                            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85, lineHeight: 1.35 }}>
                                              {sec.teacher_comment}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {totalPct != null && (
                                    <div style={{
                                      marginTop: 8,
                                      display: "flex",
                                      justifyContent: "flex-end",
                                      alignItems: "center",
                                      gap: 8,
                                      fontSize: 13,
                                      fontWeight: 900,
                                    }}>
                                      <span>Total</span>
                                      <span style={{ color: "#2563eb" }}>{totalScore}/{totalOutOf}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Achievement Categories (from achievement_summary) */}
                            {Array.isArray(r.raw?.achievement_summary) && r.raw.achievement_summary.length > 0 && (() => {
                              const cats = r.raw.achievement_summary;
                              const levelColors = {
                                strong: { bg: "rgba(5,150,105,0.1)", border: "rgba(5,150,105,0.3)", text: "#059669" },
                                adequate: { bg: "rgba(37,99,235,0.08)", border: "rgba(37,99,235,0.25)", text: "#2563eb" },
                                developing: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", text: "#d97706" },
                                limited: { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.25)", text: "#dc2626" },
                              };
                              const knownShort = {
                                "Knowledge & Understanding": "K", "Thinking": "T", "Communication": "C", "Application": "A",
                                "Understanding": "U", "Problem Solving": "PS", "Effort & Growth": "EG",
                                "Skills & Application": "SA", "Progress & Effort": "PE",
                              };
                              const scored = cats.filter(k => typeof k.score === "number" && typeof k.out_of === "number");
                              const totalScore = scored.reduce((s, k) => s + k.score, 0);
                              const totalOutOf = scored.reduce((s, k) => s + k.out_of, 0);
                              const pct = totalOutOf > 0 ? Math.min(100, Math.max(0, (totalScore / totalOutOf) * 100)) : 0;
                              const avgPct = 70;
                              const qualityLabel = pct >= 90 ? "Exceptional" : pct >= 80 ? "Excellent" : pct >= 70 ? "Proficient" : pct >= 60 ? "Developing" : pct >= 50 ? "Approaching" : "Needs Support";
                              const qualityColor = pct >= 80 ? "#059669" : pct >= 70 ? "#22c55e" : pct >= 60 ? "#eab308" : pct >= 50 ? "#f59e0b" : "#ef4444";

                              return (
                                <div style={{ marginTop: 10 }}>
                                  <strong>Achievement Categories</strong>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                                    {cats.map((k, i) => {
                                      const lvl = String(k.level || "").toLowerCase();
                                      const c = levelColors[lvl] || levelColors.adequate;
                                      const short = knownShort[k.category] || (k.category || "").split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
                                      return (
                                        <div key={i} style={{
                                          flex: "1 1 calc(50% - 8px)", minWidth: 140,
                                          borderRadius: 10, border: `1px solid ${c.border}`,
                                          background: c.bg, padding: "8px 10px",
                                        }}>
                                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                              <span style={{
                                                display: "inline-flex", alignItems: "center", justifyContent: "center",
                                                width: 22, height: 22, borderRadius: 6, background: c.text, color: "white",
                                                fontSize: 11, fontWeight: 900,
                                              }}>{short}</span>
                                              <span style={{ fontSize: 12, fontWeight: 800, color: c.text }}>{k.category}</span>
                                            </div>
                                            {typeof k.score === "number" && typeof k.out_of === "number" ? (
                                              <span style={{ fontSize: 13, fontWeight: 900, color: c.text }}>
                                                {k.score.toFixed(2)}/{k.out_of.toFixed(2)}
                                              </span>
                                            ) : null}
                                          </div>
                                          <div style={{ fontSize: 11, fontWeight: 700, color: c.text, textTransform: "capitalize", marginBottom: 2 }}>{k.level}</div>
                                          {k.comment && <div style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.85 }}>{k.comment}</div>}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  {scored.length > 0 && (
                                    <div style={{ padding: "8px 10px", marginTop: 4 }}>
                                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                                        <div style={{ fontSize: 12, fontWeight: 800, color: qualityColor }}>{qualityLabel}</div>
                                        <div style={{ fontSize: 13, fontWeight: 900 }}>
                                          <span style={{ opacity: 0.6, fontWeight: 600, marginRight: 6 }}>Total</span>
                                          {totalScore.toFixed(2)}/{totalOutOf.toFixed(2)}
                                        </div>
                                      </div>
                                      <div style={{ position: "relative", height: 16, borderRadius: 8, overflow: "visible", background: "#f1f5f9", border: "1px solid #e2e8f0" }}>
                                        <div style={{
                                          position: "absolute", top: 0, left: 0, bottom: 0, width: "100%", borderRadius: 8,
                                          background: "linear-gradient(90deg, #fecaca 0%, #fde68a 30%, #d9f99d 55%, #bbf7d0 75%, #6ee7b7 100%)",
                                        }} />
                                        <div style={{
                                          position: "absolute", top: -4, bottom: -4,
                                          left: `${avgPct}%`, transform: "translateX(-50%)",
                                          width: 2, background: "#94a3b8", borderRadius: 1, zIndex: 2,
                                        }} />
                                        <div style={{
                                          position: "absolute", top: -16,
                                          left: `${avgPct}%`, transform: "translateX(-50%)",
                                          fontSize: 9, fontWeight: 700, color: "#64748b", whiteSpace: "nowrap",
                                        }}>Avg</div>
                                        <div style={{
                                          position: "absolute", top: -5, bottom: -5,
                                          left: `${pct}%`, transform: "translateX(-50%)",
                                          width: 4, borderRadius: 2, zIndex: 3,
                                          background: "#dc2626", boxShadow: "0 0 6px rgba(220,38,38,0.5)",
                                        }} />
                                      </div>
                                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9, fontWeight: 600, color: "#94a3b8" }}>
                                        <span>Needs Support</span>
                                        <span>Developing</span>
                                        <span>Proficient</span>
                                        <span>Excellent</span>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Incorrect items */}
                            {Array.isArray(r.raw?.sections) && r.raw.sections.some((sec) => Array.isArray(sec.incorrect_items) && sec.incorrect_items.length > 0) && (
                              <div style={{ marginTop: 8 }}>
                                <strong>Items to Review:</strong>
                                <ul style={batchStyles.ul}>
                                  {r.raw.sections.flatMap((sec) =>
                                    (Array.isArray(sec.incorrect_items) ? sec.incorrect_items : []).map((it, ii) => (
                                      <li key={`${sec.name}-${ii}`} style={{ marginBottom: 3 }}>
                                        <span style={{ opacity: 0.7 }}>{it.prompt}:</span>{" "}
                                        <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{it.student_answer}</span>
                                        {" → "}
                                        <span style={{ color: "#16a34a", fontWeight: 700 }}>{it.correct_answer}</span>
                                      </li>
                                    ))
                                  )}
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

          {/* Inline source image preview */}
          {previewIndex != null && (() => {
            const pr = results.find((r) => r.index === previewIndex);
            if (!pr?.pageImages?.length) return null;
            return (
              <div style={{
                background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12,
                padding: 14, marginBottom: 12, position: "relative",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#334155" }}>
                    {pr.studentName} — p{pr.pages}{pr.detectedTitle ? ` — ${pr.detectedTitle}` : ""}
                  </span>
                  <button
                    onClick={() => setPreviewIndex(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#94a3b8", lineHeight: 1, padding: "0 4px" }}
                    title="Close preview"
                  >&times;</button>
                </div>
                <div style={{
                  display: "flex", gap: 10, overflowX: "auto",
                  justifyContent: pr.pageImages.length === 1 ? "center" : "flex-start",
                }}>
                  {pr.pageImages.map((img, pi) => (
                    <img
                      key={pi}
                      src={img}
                      alt={`Page ${pi + 1}`}
                      style={{
                        maxHeight: 420, maxWidth: pr.pageImages.length === 1 ? "100%" : "48%",
                        borderRadius: 8, border: "1px solid #e2e8f0", objectFit: "contain",
                        cursor: "zoom-in",
                      }}
                      onClick={() => {
                        // Open in full-screen overlay for zoom
                        const overlay = document.createElement("div");
                        overlay.style.cssText = "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;";
                        const im = document.createElement("img");
                        im.src = img;
                        im.style.cssText = "max-width:95vw;max-height:95vh;object-fit:contain;border-radius:8px;";
                        overlay.appendChild(im);
                        overlay.onclick = () => document.body.removeChild(overlay);
                        document.body.appendChild(overlay);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {!grading && (
            <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
              <button
                onClick={() => {
                  setPdfFile(null);
                  setPdfName("");
                  setPageCount(0);
                  setAnswerKeyPages(0);
                  setExtractedAnswerKey(answerKeyOverride || "");
                  setResults([]);
                  setClassSummary(null);
                  setTeacherAnalysis("");
                  setDetectedGroups(null);
                  setExpandedIndex(null);
                  setPreviewIndex(null);
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
  textarea: {
    width: "100%",
    borderRadius: 10,
    border: "1px solid rgba(15,23,42,0.12)",
    padding: 10,
    fontSize: 13,
    lineHeight: 1.35,
    outline: "none",
    background: "white",
    resize: "vertical",
    fontFamily: "inherit",
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
  analysisCard: {
    padding: 14,
    borderRadius: 14,
    background: "rgba(99,102,241,0.05)",
    border: "1px solid rgba(99,102,241,0.15)",
    marginBottom: 12,
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
