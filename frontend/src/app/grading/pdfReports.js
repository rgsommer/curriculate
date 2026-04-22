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
  if (!raw || /^student$/i.test(raw) || /^student\s*\d*$/i.test(raw)) return "Name: ________";
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
export async function buildResultsPdf(results, { title } = {}) {
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

    // Quality index bar (after achievement categories)
    if (r.pct != null && y < maxY) {
      y += 4;
      const barX = MARGIN;
      const barW = COL_W;
      const barH = 10;
      const pctClamped = Math.min(100, Math.max(0, r.pct));

      const gradStops = [
        { pos: 0,    r: 254, g: 202, b: 202 },
        { pos: 0.3,  r: 253, g: 230, b: 138 },
        { pos: 0.55, r: 217, g: 249, b: 157 },
        { pos: 0.75, r: 187, g: 247, b: 208 },
        { pos: 1,    r: 110, g: 231, b: 183 },
      ];
      const slices = 60;
      const sliceW = barW / slices;
      for (let si = 0; si < slices; si++) {
        const t = si / slices;
        let lo = gradStops[0], hi = gradStops[1];
        for (let gi = 1; gi < gradStops.length; gi++) {
          if (t >= gradStops[gi - 1].pos && t <= gradStops[gi].pos) {
            lo = gradStops[gi - 1]; hi = gradStops[gi]; break;
          }
        }
        const segT = hi.pos > lo.pos ? (t - lo.pos) / (hi.pos - lo.pos) : 0;
        const cr = Math.round(lo.r + (hi.r - lo.r) * segT);
        const cg = Math.round(lo.g + (hi.g - lo.g) * segT);
        const cb = Math.round(lo.b + (hi.b - lo.b) * segT);
        doc.setFillColor(cr, cg, cb);
        if (si === 0) {
          doc.roundedRect(barX + si * sliceW, y, sliceW + 0.5, barH, 3, 3, "F");
        } else if (si === slices - 1) {
          doc.roundedRect(barX + si * sliceW - 0.5, y, sliceW + 0.5, barH, 3, 3, "F");
        } else {
          doc.rect(barX + si * sliceW, y, sliceW + 0.5, barH, "F");
        }
      }
      doc.setDrawColor(200, 210, 220);
      doc.setLineWidth(0.5);
      doc.roundedRect(barX, y, barW, barH, 3, 3, "S");

      // Average marker (70%)
      const avgX = barX + barW * 0.7;
      doc.setDrawColor(148, 163, 184);
      doc.setLineWidth(1);
      doc.line(avgX, y - 2, avgX, y + barH + 2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(100, 116, 139);
      doc.text("Avg", avgX, y - 3, { align: "center" });

      // Student score needle (red)
      const needleX = barX + barW * (pctClamped / 100);
      doc.setDrawColor(220, 38, 38);
      doc.setLineWidth(2.5);
      doc.line(needleX, y - 3, needleX, y + barH + 3);

      // Zone labels
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(148, 163, 184);
      const zones = ["Needs Support", "Developing", "Proficient", "Excellent"];
      const zoneX = [barX + 2, barX + barW * 0.3, barX + barW * 0.6, barX + barW - 2];
      const zoneAlign = ["left", "left", "left", "right"];
      zones.forEach((z, zi) => {
        doc.text(z, zoneX[zi], y + barH + 10, { align: zoneAlign[zi] });
      });

      doc.setTextColor(0, 0, 0);
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      y += barH + 14;
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

  // Page footer with title on every page
  if (title) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 140);
      doc.text(title, PAGE_W / 2, PAGE_H - 14, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }
  }

  return doc.output("datauristring").split(",")[1];
}

// ---------- Cut-strip PDF (3-column card grid) ----------
export async function buildStripsPdf(results, { title } = {}) {
  const { jsPDF } = await loadJsPdf();
  const doc = new jsPDF({ unit: "pt", format: "letter" });

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 30;
  const COLS = 3;
  const GAP = 10;
  const CARD_W = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const CARD_PAD = 8;
  const LINE_H = 11;
  const QR_SIZE = 36;
  const INNER_W = CARD_W - CARD_PAD * 2;

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

  // Pre-measure each card to determine row heights
  function measureCard(r) {
    let h = CARD_PAD;
    // Name line
    h += 13;
    // Score line
    h += 12;
    // Ref code line
    if (r.refCode) h += 10;
    // If QR present, comment starts below it
    if (r.refCode) {
      const qrBottom = CARD_PAD + QR_SIZE + 4;
      if (h < qrBottom) h = qrBottom;
    }
    // Comment (full width — sits below QR)
    const comment = esc(r.raw?.teacher_comment || r.comment || "");
    if (comment) {
      h += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      h += doc.splitTextToSize(comment, INNER_W).length * (LINE_H - 2);
    }
    h += CARD_PAD;
    return h;
  }

  function drawCard(r, x, y, cardH) {
    // Card outline with rounded corners
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.setFillColor(252, 252, 253);
    doc.roundedRect(x, y, CARD_W, cardH, 4, 4, "FD");

    // Dashed cut lines (scissors hint) at corners
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.3);
    try { doc.setLineDashPattern([2, 2], 0); } catch {}
    // top-left corner guides
    doc.line(x - 4, y, x + 6, y);
    doc.line(x, y - 4, x, y + 6);
    try { doc.setLineDashPattern([], 0); } catch {}

    let cy = y + CARD_PAD;
    const hasQr = !!r.refCode;

    // QR code (top-right of card)
    if (hasQr && qrImages[r.refCode]) {
      try {
        doc.addImage(qrImages[r.refCode], "PNG", x + CARD_W - CARD_PAD - QR_SIZE, cy, QR_SIZE, QR_SIZE);
      } catch { /* skip */ }
    }

    const textW = hasQr ? INNER_W - QR_SIZE - 6 : INNER_W;

    // Name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(clamp(getDisplayName(r), 20), x + CARD_PAD, cy + 9);
    cy += 13;

    // Score
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(60, 60, 60);
    const scoreStr = `${r.score}/${r.outOf}  ${r.pct != null ? r.pct + "%" : ""}  ${r.letter || ""}`;
    doc.text(scoreStr, x + CARD_PAD, cy + 8);
    cy += 12;

    // Ref code
    if (r.refCode) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(130, 130, 130);
      doc.text(`curriculate.net/results/${r.refCode}`, x + CARD_PAD, cy + 7);
      doc.setTextColor(0, 0, 0);
      cy += 10;
    }

    // Comment (full width — flows below QR)
    const comment = esc(r.raw?.teacher_comment || r.comment || "");
    if (comment) {
      // Push below QR if comment starts while QR is still visible
      const qrBottom = y + CARD_PAD + QR_SIZE + 4;
      if (hasQr && cy < qrBottom) cy = qrBottom;
      cy += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(50, 50, 50);
      const wrapped = doc.splitTextToSize(comment, INNER_W);
      for (const line of wrapped) {
        doc.text(line, x + CARD_PAD, cy + 7);
        cy += LINE_H - 2;
      }
    }

    doc.setTextColor(0, 0, 0);
  }

  let pageY = MARGIN;

  for (let i = 0; i < good.length; i += COLS) {
    const row = good.slice(i, i + COLS);

    // Measure row height (tallest card wins)
    const rowH = Math.max(...row.map(measureCard));

    // New page if needed
    if (pageY + rowH > PAGE_H - MARGIN && pageY > MARGIN) {
      doc.addPage();
      pageY = MARGIN;
    }

    // Draw each card in the row
    row.forEach((r, ci) => {
      const x = MARGIN + ci * (CARD_W + GAP);
      drawCard(r, x, pageY, rowH);
    });

    pageY += rowH + GAP;
  }

  // Page footer with title on every page
  if (title) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(140, 140, 140);
      doc.text(title, PAGE_W / 2, PAGE_H - 14, { align: "center" });
      doc.setTextColor(0, 0, 0);
    }
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
