/**
 * pdfReports.js — Shared PDF report generation utilities
 *
 * Used by both BatchGrading (batch mode) and page.jsx (single-grade session).
 * Loads jsPDF and qrcode-generator at runtime.
 *
 * Loading strategy: tries our own /api/vendor proxy first (works through
 * school/corporate firewalls that block CDN domains), falls back to
 * cdnjs.cloudflare.com if the proxy is unavailable.
 */

// ---------- Script loader with fallback ----------
function loadScript(urls, globalKey) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("SSR"));
    if (window[globalKey]) return resolve(window[globalKey]);

    const errors = [];
    let idx = 0;
    function tryNext() {
      if (idx >= urls.length) {
        console.error(`[loadScript] All sources failed for ${globalKey}:`, errors);
        reject(new Error(`Failed to load ${globalKey} from all ${urls.length} sources`));
        return;
      }
      const url = urls[idx];
      const script = document.createElement("script");
      script.src = url;
      script.onload = () => {
        if (window[globalKey]) {
          resolve(window[globalKey]);
        } else {
          errors.push(`${url}: loaded but ${globalKey} not found on window`);
          idx++;
          tryNext();
        }
      };
      script.onerror = (e) => {
        errors.push(`${url}: network error`);
        idx++;
        tryNext();
      };
      document.head.appendChild(script);
    }
    tryNext();
  });
}

// ---------- QR code generator loader ----------
const QRCODE_URLS = [
  "/api/vendor?lib=qrcode",
  "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js",
  "https://unpkg.com/qrcode-generator@1.4.4/qrcode.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js",
];
let qrcodePromise = null;

function loadQrCode() {
  if (qrcodePromise) return qrcodePromise;
  qrcodePromise = loadScript(QRCODE_URLS, "qrcode").catch((err) => {
    qrcodePromise = null; // allow retry on next call
    throw err;
  });
  return qrcodePromise;
}

async function makeQrDataUrl(text) {
  const qrFactory = await loadQrCode();
  const qr = qrFactory(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(4);
}

// ---------- jsPDF loader ----------
const JSPDF_URLS = [
  "/api/vendor?lib=jspdf",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
  "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
];
let jspdfPromise = null;

function loadJsPdf() {
  if (jspdfPromise) return jspdfPromise;
  jspdfPromise = loadScript(JSPDF_URLS, "jspdf").catch((err) => {
    jspdfPromise = null; // allow retry on next call
    throw err;
  });
  return jspdfPromise;
}

// ---------- Preload libs (call early so they're ready when needed) ----------
export function preloadPdfLibs() {
  if (typeof window === "undefined") return;
  loadJsPdf().catch(() => {});
  loadQrCode().catch(() => {});
}

// ---------- Helpers ----------
const esc = (s) => String(s || "").replace(/[\r]/g, "");

/** Show first name if we have one, otherwise "Student N" */
function getDisplayName(r) {
  const raw = (r.studentName || "").trim();
  if (!raw) return `Student ${r.index}`;
  const firstName = raw.split(/\s+/)[0];
  return esc(firstName);
}
const clamp = (str, maxChars) => str.length > maxChars ? str.slice(0, maxChars - 1) + "\u2026" : str;

function letterGradeFromPct(pct) {
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

// ---------- Half-page PDF (2 per page, full feedback) ----------
export async function buildResultsPdf(results) {
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const PAGE_W = 612;
  const PAGE_H = 792;
  const HALF_H = PAGE_H / 2;
  const MARGIN = 36;
  const COL_W = PAGE_W - MARGIN * 2;
  const LINE_H = 13;
  const HEADER_H = 16;
  const QR_SIZE = 48;
  const FOOTER_H = QR_SIZE + 8;

  const good = results.filter((r) => !r.error);
  if (!good.length) return null;

  // Pre-generate QR codes
  const qrImages = {};
  for (const r of good) {
    if (r.refCode) {
      try {
        qrImages[r.refCode] = await makeQrDataUrl(`https://www.curriculate.net/results/${r.refCode}`);
      } catch { /* skip */ }
    }
  }

  function drawStudentReport(r, slotIndex) {
    const isTop = slotIndex % 2 === 0;
    const yBase = isTop ? 0 : HALF_H;
    let y = yBase + MARGIN;

    if (!isTop) {
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(MARGIN, HALF_H, PAGE_W - MARGIN, HALF_H);
    }

    // Name + score header
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const nameStr = getDisplayName(r);
    const scoreStr = `${r.score} / ${r.outOf}  (${r.pct != null ? r.pct + "%" : "\u2014"})  ${r.letter || ""}`;
    doc.text(nameStr, MARGIN, y);
    doc.text(scoreStr, PAGE_W - MARGIN, y, { align: "right" });
    y += HEADER_H + 2;

    const hasFooter = !!r.refCode;
    const maxY = yBase + HALF_H - MARGIN - (hasFooter ? FOOTER_H : 4);

    function section(label, items, bulletPrefix) {
      if (!items || !items.length) return;
      if (y >= maxY) return;
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text(label, MARGIN, y);
      y += LINE_H;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      for (const item of items) {
        if (y >= maxY) break;
        const prefix = bulletPrefix ? "\u2022 " : "";
        const wrapped = doc.splitTextToSize(prefix + clamp(esc(item), 300), COL_W);
        for (const line of wrapped) {
          if (y >= maxY) break;
          doc.text(line, MARGIN + 4, y);
          y += LINE_H - 1;
        }
      }
    }

    const raw = r.raw || {};

    // Achievement categories (colored cards)
    const cats = Array.isArray(raw.achievement_summary) ? raw.achievement_summary : [];
    if (cats.length && y < maxY) {
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Achievement Categories:", MARGIN, y);
      y += LINE_H;

      const levelColors = {
        strong:     { r: 5, g: 150, b: 105 },
        adequate:   { r: 37, g: 99, b: 235 },
        developing: { r: 217, g: 119, b: 6 },
        limited:    { r: 220, g: 38, b: 38 },
      };
      const knownShort = {
        "Knowledge & Understanding": "K", "Thinking": "T", "Communication": "C", "Application": "A",
        "Understanding": "U", "Problem Solving": "PS", "Effort & Growth": "EG",
        "Skills & Application": "SA", "Progress & Effort": "PE",
        "Knowledge & Recall (AO1)": "AO1", "Analysis & Application (AO2)": "AO2",
        "Evaluation & Context (AO3)": "AO3", "Technical Accuracy (AO4)": "AO4",
      };

      const cardW = (COL_W - 8) / 2;
      const cardPad = 5;

      for (let ci = 0; ci < cats.length && y < maxY; ci += 2) {
        const rowCats = cats.slice(ci, ci + 2);
        // Measure row height
        let rowH = 0;
        const measured = rowCats.map((k) => {
          const lvl = String(k.level || "").toLowerCase();
          const c = levelColors[lvl] || levelColors.adequate;
          const short = knownShort[k.category] || (k.category || "").split(/\s+/).map(w => w[0]).join("").slice(0, 3).toUpperCase();
          const scoreStr = typeof k.score === "number" && typeof k.out_of === "number"
            ? `  ${k.score.toFixed(1)}/${k.out_of.toFixed(1)}` : "";
          const header = `${short} ${k.category}${scoreStr}`;
          const levelStr = String(k.level || "").charAt(0).toUpperCase() + String(k.level || "").slice(1);
          const commentLines = k.comment ? doc.splitTextToSize(clamp(esc(k.comment), 200), cardW - cardPad * 2 - 4) : [];
          const h = 12 + 10 + commentLines.length * 9 + cardPad * 2;
          if (h > rowH) rowH = h;
          return { k, c, header, levelStr, commentLines };
        });

        if (y + rowH > maxY) break;

        measured.forEach((m, mi) => {
          const x = MARGIN + mi * (cardW + 8);
          // Colored left border + light background
          const bgR = Math.round(255 - (255 - m.c.r) * 0.08);
          const bgG = Math.round(255 - (255 - m.c.g) * 0.08);
          const bgB = Math.round(255 - (255 - m.c.b) * 0.08);
          doc.setFillColor(bgR, bgG, bgB);
          doc.roundedRect(x, y, cardW, rowH, 3, 3, "F");
          doc.setFillColor(m.c.r, m.c.g, m.c.b);
          doc.roundedRect(x, y, 3, rowH, 1.5, 1.5, "F");

          let cy = y + cardPad + 9;
          // Header line
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.setTextColor(m.c.r, m.c.g, m.c.b);
          doc.text(m.header, x + cardPad + 4, cy);
          cy += 10;
          // Level
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.text(m.levelStr, x + cardPad + 4, cy);
          cy += 9;
          // Comment
          doc.setTextColor(60, 60, 60);
          doc.setFontSize(7);
          for (const line of m.commentLines) {
            doc.text(line, x + cardPad + 4, cy);
            cy += 9;
          }
          doc.setTextColor(0, 0, 0);
        });
        y += rowH + 4;
      }
    }

    section("Strengths:", Array.isArray(raw.strengths) ? raw.strengths : r.strengths, true);
    section("Next Steps:", Array.isArray(raw.improvements) ? raw.improvements : r.improvements, true);

    const comment = esc(raw.teacher_comment || r.comment || "");
    if (comment && y < maxY) {
      y += 3;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("Comment:", MARGIN, y);
      y += LINE_H;
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8.5);
      const wrapped = doc.splitTextToSize(clamp(comment, 500), COL_W);
      for (const line of wrapped) {
        if (y >= maxY) break;
        doc.text(line, MARGIN + 4, y);
        y += LINE_H - 1;
      }
    }

    // Footer: QR code + URL
    if (r.refCode) {
      const footerY = yBase + HALF_H - MARGIN - QR_SIZE;
      const resultsUrl = `curriculate.net/results/${r.refCode}`;

      const qrDataUrl = qrImages[r.refCode];
      if (qrDataUrl) {
        try { doc.addImage(qrDataUrl, "PNG", PAGE_W - MARGIN - QR_SIZE, footerY, QR_SIZE, QR_SIZE); } catch { /* skip */ }
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text("Full results & original images:", MARGIN, footerY + 14);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text(resultsUrl, MARGIN, footerY + 26);
      doc.setTextColor(0, 0, 0);
    }
  }

  for (let i = 0; i < good.length; i++) {
    if (i % 2 === 0 && i > 0) doc.addPage();
    drawStudentReport(good[i], i);
  }

  return doc.output("datauristring").split(",")[1];
}

// ---------- Cut-strip PDF (grade + ref code + comment) ----------
export async function buildStripsPdf(results) {
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 36;
  const LINE_H = 13;
  const STRIP_PAD = 10;
  const CUT_GAP = 18;
  const QR_SIZE = 42;
  const QR_GAP = 8;
  const COL_W_FULL = PAGE_W - MARGIN * 2;
  const COL_W_WITH_QR = COL_W_FULL - QR_SIZE - QR_GAP - 4;

  const good = results.filter((r) => !r.error);
  if (!good.length) return null;

  const qrImages = {};
  for (const r of good) {
    if (r.refCode) {
      try {
        qrImages[r.refCode] = await makeQrDataUrl(`https://www.curriculate.net/results/${r.refCode}`);
      } catch { /* skip */ }
    }
  }

  function measureStrip(r) {
    const hasQr = !!r.refCode;
    const textW = hasQr ? COL_W_WITH_QR : COL_W_FULL - 8;
    let h = 14 + 4;
    if (r.refCode) h += 14;
    const comment = esc(r.raw?.teacher_comment || r.comment || "");
    if (comment) {
      h += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      h += doc.splitTextToSize(comment, textW).length * (LINE_H - 1);
    }
    const textH = h + STRIP_PAD * 2;
    return hasQr ? Math.max(textH, QR_SIZE + STRIP_PAD * 2 + 14) : textH;
  }

  let y = MARGIN;

  for (let i = 0; i < good.length; i++) {
    const r = good[i];
    const stripH = measureStrip(r);

    if (y + stripH > PAGE_H - MARGIN && y > MARGIN) {
      doc.addPage();
      y = MARGIN;
    }

    if (y > MARGIN + 4) {
      doc.setDrawColor(180, 180, 180);
      doc.setLineWidth(0.4);
      try { doc.setLineDashPattern([4, 3], 0); } catch { /* compat */ }
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      try { doc.setLineDashPattern([], 0); } catch { /* reset */ }
      y += CUT_GAP / 2;
    }

    const stripStartY = y;
    y += STRIP_PAD;

    const hasQr = !!r.refCode;
    const textW = hasQr ? COL_W_WITH_QR : COL_W_FULL - 8;

    if (hasQr && qrImages[r.refCode]) {
      try {
        doc.addImage(qrImages[r.refCode], "PNG", PAGE_W - MARGIN - QR_SIZE, stripStartY + STRIP_PAD, QR_SIZE, QR_SIZE);
      } catch { /* skip */ }
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const nameStr = getDisplayName(r);
    const scoreStr = `${r.score} / ${r.outOf}  (${r.pct != null ? r.pct + "%" : "\u2014"})  ${r.letter || ""}`;
    doc.text(nameStr, MARGIN + 4, y);
    const scoreX = hasQr ? PAGE_W - MARGIN - QR_SIZE - QR_GAP : PAGE_W - MARGIN - 4;
    doc.text(scoreStr, scoreX, y, { align: "right" });
    y += 14;

    if (r.refCode) {
      y += 2;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text(`Code: ${r.refCode}  \u2022  Full results & images: curriculate.net/results/${r.refCode}`, MARGIN + 4, y);
      doc.setTextColor(0, 0, 0);
      y += 12;
    }

    const comment = esc(r.raw?.teacher_comment || r.comment || "");
    if (comment) {
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const wrapped = doc.splitTextToSize(comment, textW);
      for (const line of wrapped) {
        doc.text(line, MARGIN + 4, y);
        y += LINE_H - 1;
      }
    }

    const minY = stripStartY + stripH - CUT_GAP / 2;
    if (y < minY) y = minY;
    else y += STRIP_PAD;
    y += CUT_GAP / 2;
  }

  if (y < PAGE_H - MARGIN) {
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    try { doc.setLineDashPattern([4, 3], 0); } catch { /* compat */ }
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    try { doc.setLineDashPattern([], 0); } catch { /* reset */ }
  }

  return doc.output("datauristring").split(",")[1];
}

/**
 * Normalize a session item (from single-grade mode) into the result shape
 * expected by buildResultsPdf / buildStripsPdf.
 *
 * @param {object} item - session item { assessment, formattedText, ... }
 * @param {number} index - 1-based index
 * @returns {object} normalized result
 */
export function sessionItemToResult(item, index) {
  const a = item.assessment || {};
  const score = Number(a.overall_score);
  const outOf = Number(a.overall_out_of);
  const pct = Number.isFinite(score) && Number.isFinite(outOf) && outOf > 0
    ? Math.round((score / outOf) * 100) : null;

  // Extract ref code from formattedText (e.g., "Ref: AA123" or "code: AA123")
  const refMatch = (item.formattedText || "").match(/\bRef:\s*([A-Z0-9]{4,8})\b/i)
    || (item.formattedText || "").match(/\bcode:\s*([A-Z0-9]{4,8})\b/i);
  const refCode = refMatch ? refMatch[1].toUpperCase() : null;

  return {
    index,
    studentName: a.student_name || `Student ${index}`,
    nameConfirmed: false, // single-grade mode: only one AI pass, so never "confirmed"
    score: Number.isFinite(score) ? score : "?",
    outOf: Number.isFinite(outOf) ? outOf : "?",
    pct,
    letter: pct != null ? letterGradeFromPct(pct) : "?",
    strengths: Array.isArray(a.strengths) ? a.strengths : [],
    improvements: Array.isArray(a.improvements) ? a.improvements : [],
    comment: a.teacher_comment || "",
    refCode,
    error: null,
    raw: a,
  };
}
