// Tee Bee Audit — personalised 2-page brief PDF, drawn with pdf-lib.
// Mirrors the structure of /api/teebee/brief but tailored to the audit product.
//
//   GET /api/audit/brief?co=Acme%20Ltd&fy=2026-06-30&service=Statutory
//
// Open the URL → PDF renders inline. Useful for sales conversations.
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
  const co        = safe(u.searchParams.get("co"), "Your Company");
  const fy        = safe(u.searchParams.get("fy"), "");
  const service   = safe(u.searchParams.get("service"), "External statutory audit");

  const pdf = await PDFDocument.create();
  const reg  = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /* ───── PAGE 1 — Who we are + What Tee Bee Audit is ───── */
  const p1 = pdf.addPage(PageSizes.A4);
  const W = p1.getWidth(), H = p1.getHeight();

  // Header band
  p1.drawRectangle({ x: 0, y: H - 100, width: W, height: 100, color: NAVY });
  p1.drawText("Tee Bee Audit", { x: 48, y: H - 60, size: 28, font: bold, color: GOLD });
  p1.drawText("From Tee Bee Accountants Ltd · CPA-certified · Registered with PNG ARB · 10+ years",
    { x: 48, y: H - 84, size: 10.5, font: reg, color: rgb(0.6, 0.7, 0.83) });

  // Personalisation line
  p1.drawText(`Prepared for: ${co}`, { x: 48, y: H - 130, size: 13, font: bold, color: INK });
  const meta = [
    fy ? `Fiscal year end: ${fy}` : null,
    `Audit type: ${service}`,
    new Date().toISOString().slice(0, 10),
  ].filter(Boolean).join("   ·   ");
  p1.drawText(meta, { x: 48, y: H - 148, size: 9.5, font: reg, color: MUTED });

  // Headline
  p1.drawText("A modern audit, signed by a CPA.", {
    x: 48, y: H - 195, size: 22, font: bold, color: INK,
  });
  drawWrapped(p1, reg, 11.5, SOFT,
    "Tee Bee Audit is an AI-assisted audit-readiness platform from Tee Bee Accountants Ltd. " +
    "You upload your trial balance, general ledger, bank statements and supporting files. " +
    "Our software runs reconciliations, anomaly checks, and compliance scans. A registered " +
    "CPA — Theresia Bob — reviews every finding, runs the substantive tests, and personally " +
    "signs the audit opinion. The technology speeds the work; the professional judgement is human.",
    48, H - 215, W - 96, 14);

  // Value points (2x2 grid)
  const valY = H - 320;
  const cellW = (W - 48 * 2 - 16) / 2;
  const values: [string, string, string][] = [
    ["AUTOMATED", "Reconciliations done for you", "TB ↔ GL ↔ bank statements ↔ payroll. Discrepancies surfaced for review, not for chasing."],
    ["INTELLIGENT", "Anomaly detection",          "Round-number transactions, weekend journal entries, duplicate invoices, related-party patterns."],
    ["COMPLIANT",  "PNG-specific checks",         "IRC SWT remittances, NASFund / NCSL contributions, IPA annual returns, late penalties flagged."],
    ["CPA-SIGNED", "Real audit opinion",          "Every audit reviewed and signed by a CPA registered with the PNG Accountants Registration Board."],
  ];
  values.forEach((v, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 48 + col * (cellW + 16);
    const y = valY - row * 92;
    p1.drawRectangle({ x, y: y - 78, width: cellW, height: 78, color: CREAM,
      borderColor: rgb(0.92, 0.92, 0.92), borderWidth: 1 });
    p1.drawText(v[0], { x: x + 14, y: y - 18, size: 9, font: bold, color: GOLD });
    p1.drawText(v[1], { x: x + 14, y: y - 36, size: 12.5, font: bold, color: INK });
    drawWrapped(p1, reg, 9.5, SOFT, v[2], x + 14, y - 50, cellW - 28, 12);
  });

  // "Why TBA" strip
  const stripY = valY - 2 * 92 - 14;
  p1.drawRectangle({ x: 48, y: stripY - 80, width: W - 96, height: 80, color: NAVY });
  p1.drawText("Why Tee Bee Accountants Ltd", { x: 64, y: stripY - 22, size: 11, font: bold, color: GOLD });
  drawWrapped(p1, reg, 10, WHITE,
    "CPA-certified team led by Theresia Bob · Registered with the PNG Accountants Registration Board · " +
    "Registered Tax Agents with IRC · IFRS-compliant reporting · 500+ clients served over 10+ years · " +
    "Deep local expertise across SMEs, landowner companies, project SPVs, and donor-funded NGOs.",
    64, stripY - 40, W - 128, 13);

  // Footer
  centerText(p1, reg, 9, MUTED,
    "Tee Bee Accountants Ltd · Port Moresby, NCD, PNG · info@teebeeaccountants.com.pg · +675 300 0000",
    30, W);

  /* ───── PAGE 2 — How an engagement runs + pricing + next step ───── */
  const p2 = pdf.addPage(PageSizes.A4);
  const W2 = p2.getWidth(), H2 = p2.getHeight();
  p2.drawRectangle({ x: 0, y: H2 - 100, width: W2, height: 100, color: NAVY });
  p2.drawText("Your audit — end to end", {
    x: 48, y: H2 - 60, size: 22, font: bold, color: GOLD,
  });
  p2.drawText(`How a Tee Bee Audit engagement runs for ${co}`,
    { x: 48, y: H2 - 84, size: 10.5, font: reg, color: rgb(0.6, 0.7, 0.83) });

  // Six-step list
  p2.drawText("Six steps, weeks instead of months", {
    x: 48, y: H2 - 130, size: 13, font: bold, color: INK,
  });
  const steps: [string, string, string][] = [
    ["01", "Submit an inquiry",      "5-question form on our website. Software produces an indicative quote within minutes."],
    ["02", "Sign engagement letter", "We respond in 2 business days with scope, fee and timeline. E-sign in-app."],
    ["03", "Upload your files",      "Personalised checklist by audit type: TB, GL, bank statements, payroll register, asset register, etc."],
    ["04", "Software runs analysis", "Reconciliations, anomaly scans, compliance checks, ratio analysis vs prior year. Findings drafted."],
    ["05", "CPA review",             "Theresia reviews every finding, runs substantive testing, drafts management letter, signs opinion."],
    ["06", "Receive deliverables",   "Branded audit report, management letter, invoice. Working papers retained 7 years per ARB rules."],
  ];
  let stY = H2 - 158;
  steps.forEach(([n, t, d]) => {
    p2.drawText(n, { x: 48, y: stY, size: 13, font: bold, color: GOLD });
    p2.drawText(t, { x: 78, y: stY, size: 12, font: bold, color: INK });
    drawWrapped(p2, reg, 10, SOFT, d, 78, stY - 14, W2 - 78 - 48, 12);
    stY -= 36;
  });

  // Pricing band
  const pY = stY - 6;
  p2.drawRectangle({ x: 48, y: pY - 95, width: W2 - 96, height: 95, color: GOLD });
  p2.drawText("Pricing — quoted per audit, never billable hours", { x: 64, y: pY - 22, size: 13, font: bold, color: NAVY });
  drawWrapped(p2, reg, 10, NAVY_DEEP,
    "Small entity (revenue < K 2M): from K 5,000. Mid-size (K 2M–10M): from K 12,000. " +
    "Large / SPV / landowner: custom. Audit-readiness reviews start at 60% of statutory price. " +
    "The intake form produces an indicative quote in 2 business days. Final fee locked in the " +
    "engagement letter — no scope creep, no hourly clock-watching.",
    64, pY - 44, W2 - 128, 12);
  p2.drawText("First conversation is free. So is the indicative quote.",
    { x: 64, y: pY - 82, size: 11, font: bold, color: NAVY });

  // Next step
  const nY = pY - 110;
  p2.drawText("Next step", { x: 48, y: nY, size: 13, font: bold, color: INK });
  drawWrapped(p2, reg, 10.5, SOFT,
    `Visit www.curriculate.net/audit and submit a 5-question inquiry. We'll respond within 2 business ` +
    `days with an indicative quote tailored to ${co}. If you'd prefer a conversation first, email ` +
    `info@teebeeaccountants.com.pg or call +675 300 0000.`,
    48, nY - 18, W2 - 96, 14);

  centerText(p2, reg, 9, MUTED,
    "Tee Bee Accountants Ltd · Tee Bee Audit · www.curriculate.net/audit",
    30, W2);

  const bytes = await pdf.save();
  const filename = `TBA-Audit-brief-${co.replace(/[^A-Za-z0-9_-]+/g, "_") || "client"}.pdf`;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

/* ── pdf-lib text helpers ─────────────────────────────────────────── */
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
function centerText(page: any, font: any, size: number, color: any,
                    text: string, y: number, pageWidth: number) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: (pageWidth - w) / 2, y, size, font, color });
}
