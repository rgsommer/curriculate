// TeeBee Audit — single-page A4 handout, drawn with pdf-lib.
// Designed for in-person meetings: Theresia hands it across a coffee table.
// Bigger type than the brief, more breathable layout.
//
//   GET /api/audit/handout                  → generic version
//   GET /api/audit/handout?co=Acme%20Ltd    → personalised version
import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAVY      = rgb(0.058, 0.172, 0.321);
const NAVY_DEEP = rgb(0.031, 0.113, 0.227);
const GOLD      = rgb(0.788, 0.635, 0.152);
const INK       = rgb(0.039, 0.101, 0.180);
const SOFT      = rgb(0.278, 0.337, 0.412);
const MUTED     = rgb(0.392, 0.455, 0.545);
const CREAM     = rgb(0.984, 0.980, 0.965);
const WHITE     = rgb(1, 1, 1);
const GOLD_SOFT = rgb(0.996, 0.965, 0.863);

function safe(s: string | null | undefined, fallback = ""): string {
  return (s == null ? fallback : String(s)).slice(0, 120);
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const co = safe(u.searchParams.get("co"), "");

  const pdf = await PDFDocument.create();
  const reg  = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage(PageSizes.A4);
  const W = page.getWidth(), H = page.getHeight();

  // ── Header band ──
  page.drawRectangle({ x: 0, y: H - 120, width: W, height: 120, color: NAVY });
  page.drawText("TeeBee Audit", {
    x: 50, y: H - 72, size: 38, font: bold, color: GOLD,
  });
  page.drawText("CPA-led, AI-assisted audit · Papua New Guinea",
    { x: 50, y: H - 100, size: 12, font: reg, color: rgb(0.6, 0.7, 0.83) });

  // ── Personalisation line / generic strap ──
  let curY = H - 150;
  if (co) {
    page.drawText(`Prepared for: ${co}`,
      { x: 50, y: curY, size: 13, font: bold, color: INK });
    curY -= 22;
  }

  // ── Big headline ──
  page.drawText("Faster, cheaper, cleaner audits for PNG businesses.",
    { x: 50, y: curY - 8, size: 22, font: bold, color: INK });
  curY -= 36;
  drawWrapped(page, reg, 12, SOFT,
    "Upload your trial balance, general ledger, bank statements and supporting documents through a " +
    "secure portal. Our software runs reconciliations, anomaly checks and compliance scans. Theresia " +
    "Bob, CPA, reviews every finding and signs the audit opinion personally. Same audit standard. " +
    "A fraction of the time.",
    50, curY, W - 100, 16);
  curY -= 86;

  // ── Four value boxes (2 x 2 grid) ──
  const boxW = (W - 100 - 16) / 2;
  const boxH = 88;
  const boxes: [string, string, string][] = [
    ["AUTOMATED",   "Reconciliation done for you",
      "TB ↔ GL ↔ bank statements ↔ payroll. Discrepancies surfaced for the CPA to review, not for you to chase."],
    ["INTELLIGENT", "Anomaly detection",
      "Round-number transactions, weekend journal entries, duplicate invoices, related-party patterns."],
    ["COMPLIANT",   "PNG-specific checks",
      "IRC SWT, NASFund / NCSL, IPA returns. Late penalties and gaps flagged before they hit you."],
    ["CPA-SIGNED",  "Real audit opinion",
      "Every audit personally reviewed and signed by a CPA registered with the PNG Accountants Registration Board."],
  ];
  boxes.forEach((b, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 50 + col * (boxW + 16);
    const y = curY - row * (boxH + 12);
    page.drawRectangle({ x, y: y - boxH, width: boxW, height: boxH, color: CREAM,
      borderColor: rgb(0.92, 0.92, 0.92), borderWidth: 1 });
    page.drawText(b[0], { x: x + 16, y: y - 20, size: 10, font: bold, color: GOLD });
    page.drawText(b[1], { x: x + 16, y: y - 38, size: 13, font: bold, color: INK });
    drawWrapped(page, reg, 10, SOFT, b[2], x + 16, y - 54, boxW - 32, 12);
  });
  curY -= 2 * (boxH + 12) + 6;

  // ── Audit types served ──
  page.drawText("Audit types we serve",
    { x: 50, y: curY, size: 13, font: bold, color: INK });
  curY -= 18;
  const types = [
    "External statutory audits (IFRS / IFRS-SME)",
    "Audit-readiness reviews before next year's statutory audit",
    "Tax / IRC due diligence audits",
    "NASFund / NCSL / IPA compliance audits",
    "Donor-funded programme and project SPV audits",
    "Landowner-company audits",
  ];
  types.forEach((t, i) => {
    const col = i % 2;
    const x = 50 + col * (W / 2 - 40);
    const y = curY - Math.floor(i / 2) * 16;
    page.drawText("·", { x, y, size: 13, font: bold, color: GOLD });
    page.drawText(t, { x: x + 12, y, size: 10.5, font: reg, color: INK });
  });
  curY -= 3 * 16 + 8;

  // ── Pricing snapshot ──
  page.drawRectangle({ x: 50, y: curY - 64, width: W - 100, height: 64, color: GOLD });
  page.drawText("Pricing — quoted per audit", { x: 66, y: curY - 22, size: 12, font: bold, color: NAVY });
  drawWrapped(page, reg, 10, NAVY_DEEP,
    "Small entity (< K 2M revenue): from K 5,000. Mid-size (K 2M–10M): from K 12,000. " +
    "Large / SPV / landowner: custom. First conversation is free. Indicative quote within 2 business days.",
    66, curY - 42, W - 132, 12);
  curY -= 74;

  // ── CTA ──
  page.drawText("Get an indicative quote in 2 business days",
    { x: 50, y: curY, size: 13, font: bold, color: INK });
  curY -= 18;
  page.drawText("Submit a 5-question inquiry at www.curriculate.net/audit — or speak with us directly.",
    { x: 50, y: curY, size: 11, font: reg, color: SOFT });

  // ── Contact block (bottom) ──
  const footerY = 70;
  page.drawLine({ start: { x: 50, y: footerY + 30 }, end: { x: W - 50, y: footerY + 30 },
    thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
  page.drawText("TeeBee Accountants Ltd", { x: 50, y: footerY + 12, size: 10.5, font: bold, color: INK });
  page.drawText("Theresia Bob, CPA · Principal · Registered Tax Agent, IRC · Registered with PNG ARB",
    { x: 50, y: footerY - 2, size: 9, font: reg, color: SOFT });
  page.drawText("info@teebeeaccountants.com.pg · +675 300 0000 · Port Moresby, NCD",
    { x: 50, y: footerY - 16, size: 9, font: reg, color: SOFT });
  // Brand mark on the right
  page.drawText("www.curriculate.net/audit",
    { x: W - 50 - bold.widthOfTextAtSize("www.curriculate.net/audit", 11), y: footerY + 12,
      size: 11, font: bold, color: GOLD });

  const bytes = await pdf.save();
  const filename = co
    ? `Tee-Bee-Audit-handout-${co.replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`
    : "Tee-Bee-Audit-handout.pdf";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

/* ── pdf-lib text helper ──────────────────────────────────────────── */
function drawWrapped(page: any, font: any, size: number, color: any,
                     text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/);
  let line = "";
  let cursorY = y;
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    const width = font.widthOfTextAtSize(trial, size);
    if (width > maxWidth && line) {
      page.drawText(line, { x, y: cursorY, size, font, color });
      cursorY -= lineHeight;
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) page.drawText(line, { x, y: cursorY, size, font, color });
}
