// frontend/src/app/api/teebee/brief/route.ts
//
// Personalised 2-page TBA brief PDF, drawn with pdf-lib (pure JS, no native
// fonts on disk — survives Vercel's serverless bundling without extras).
//
// Usage:
//   GET /api/teebee/brief?co=Acme%20Ltd&employees=22&service=Payroll
//
// Open the URL → PDF renders inline. Useful for meetings: theresia.com→Print.
import { NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAVY      = rgb(0.058, 0.172, 0.321);   // #0f2c52
const NAVY_DEEP = rgb(0.031, 0.113, 0.227);
const GOLD      = rgb(0.788, 0.635, 0.152);   // #c9a227
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
  const employees = safe(u.searchParams.get("employees"), "—");
  const service   = safe(u.searchParams.get("service"), "Payroll & compliance");

  const pdf = await PDFDocument.create();
  const reg  = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  /* ───── PAGE 1 — Who we are ───── */
  const p1 = pdf.addPage(PageSizes.A4);   // 595.28 × 841.89
  const W = p1.getWidth(), H = p1.getHeight();

  // Header band
  p1.drawRectangle({ x: 0, y: H - 100, width: W, height: 100, color: NAVY });
  p1.drawText("Tee Bee Accountants Ltd", {
    x: 48, y: H - 60, size: 26, font: bold, color: GOLD,
  });
  p1.drawText("CPA-certified · Registered Tax Agents · Port Moresby · 10+ years", {
    x: 48, y: H - 84, size: 10.5, font: reg, color: rgb(0.6, 0.7, 0.83),
  });

  // Personalisation line
  p1.drawText(`Prepared for: ${co}`, { x: 48, y: H - 130, size: 13, font: bold, color: INK });
  p1.drawText(
    `Headcount: ${employees}   ·   Primary interest: ${service}   ·   ${new Date().toISOString().slice(0, 10)}`,
    { x: 48, y: H - 148, size: 9.5, font: reg, color: MUTED },
  );

  // Value prop
  p1.drawText("What we do, in 30 seconds.", {
    x: 48, y: H - 195, size: 20, font: bold, color: INK,
  });
  drawWrapped(p1, reg, 11, SOFT,
    "Tee Bee Accountants Ltd (TBA) is a full-service accounting and audit firm in Papua " +
    "New Guinea. We work with SMEs, landowner companies, and project SPVs across audit and " +
    "assurance, taxation, accounting, business advisory, statutory compliance, and financial " +
    "consulting. We are registered with the PNG Accountants Registration Board and the IRC. " +
    "Our work is IFRS-compliant.",
    48, H - 215, W - 96, 14);

  // Services grid (2 cols × 3 rows)
  const services = [
    ["01", "Audit & Assurance",     "IFRS-compliant audits via Tee Bee Audit — AI-assisted, CPA-signed."],
    ["02", "Taxation Services",     "Strategic tax planning and full IRC compliance."],
    ["03", "Accounting Services",   "Bookkeeping, financial reporting, payroll via TeebeePay."],
    ["04", "Business Advisory",     "Growth, financial planning, risk and efficiency."],
    ["05", "Statutory Compliance",  "Company secretarial, IPA annual returns, regulatory upkeep."],
    ["06", "Financial Consulting",  "Feasibility studies, due diligence, investment advisory."],
  ];
  const colWidth = (W - 48 * 2 - 16) / 2;
  const startY = H - 310;
  services.forEach((s, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 48 + col * (colWidth + 16);
    const y = startY - row * 92;
    p1.drawRectangle({ x, y: y - 78, width: colWidth, height: 78, color: CREAM,
      borderColor: rgb(0.92, 0.92, 0.92), borderWidth: 1 });
    p1.drawText(s[0], { x: x + 14, y: y - 18, size: 11, font: bold, color: GOLD });
    p1.drawText(s[1], { x: x + 36, y: y - 18, size: 12, font: bold, color: INK });
    drawWrapped(p1, reg, 9.5, SOFT, s[2], x + 36, y - 36, colWidth - 50, 12);
  });

  // Why us strip
  const stripY = startY - 3 * 92 - 14;
  p1.drawRectangle({ x: 48, y: stripY - 66, width: W - 96, height: 66, color: NAVY });
  p1.drawText("Why TBA", { x: 64, y: stripY - 22, size: 11, font: bold, color: GOLD });
  drawWrapped(p1, reg, 10, WHITE,
    "CPA-certified team · IFRS-compliant reporting · Registered tax agents with the PNG " +
    "IRC · Deep local expertise · 500+ clients served over 10+ years · Dedicated client relationships.",
    64, stripY - 40, W - 128, 13);

  // New in 2026 platforms strip
  const newY = stripY - 78;
  p1.drawRectangle({ x: 48, y: newY - 70, width: W - 96, height: 70, color: GOLD_SOFT,
    borderColor: rgb(0.93, 0.85, 0.55), borderWidth: 0.6 });
  p1.drawText("New in 2026 — our platforms", { x: 64, y: newY - 20, size: 11, font: bold, color: NAVY });
  // Two columns inside the strip
  const halfW = (W - 96 - 32) / 2;
  p1.drawText("Tee Bee Audit", { x: 64, y: newY - 38, size: 10.5, font: bold, color: NAVY_DEEP });
  drawWrapped(p1, reg, 9, INK,
    "AI-assisted audit platform · upload files, software runs reconciliations and anomaly checks, CPA signs the opinion. www.curriculate.net/audit",
    64, newY - 50, halfW, 11);
  p1.drawText("TeebeePay", { x: 64 + halfW + 32, y: newY - 38, size: 10.5, font: bold, color: NAVY_DEEP });
  drawWrapped(p1, reg, 9, INK,
    "Fortnightly payroll · pay stubs, BSP batch, NASFund, IRC SWT. Self-service from K9/employee, managed from K14. www.curriculate.net/teebeepay",
    64 + halfW + 32, newY - 50, halfW, 11);

  // Footer
  centerText(p1, reg, 9, MUTED,
    "Tee Bee Accountants Ltd · Port Moresby, NCD, PNG · info@teebeeaccountants.com.pg · +675 300 0000",
    30, W);

  /* ───── PAGE 2 — TeebeePay output ───── */
  const p2 = pdf.addPage(PageSizes.A4);
  const W2 = p2.getWidth(), H2 = p2.getHeight();
  p2.drawRectangle({ x: 0, y: H2 - 100, width: W2, height: 100, color: NAVY });
  p2.drawText("TeebeePay — your fortnight, end to end", {
    x: 48, y: H2 - 60, size: 22, font: bold, color: GOLD,
  });
  p2.drawText(`What a TeebeePay fortnightly run delivers for ${co}`, {
    x: 48, y: H2 - 84, size: 10.5, font: reg, color: rgb(0.6, 0.7, 0.83),
  });

  // Pay-stub mockup
  p2.drawText("Pay stub (sample, per employee)", {
    x: 48, y: H2 - 130, size: 13, font: bold, color: INK,
  });
  const stubX = 48, stubY = H2 - 330, stubW = W2 - 96, stubH = 190;
  p2.drawRectangle({ x: stubX, y: stubY, width: stubW, height: stubH, color: WHITE,
    borderColor: rgb(0.92, 0.92, 0.92), borderWidth: 1 });
  p2.drawText(co, { x: stubX + 16, y: stubY + stubH - 22, size: 12, font: bold, color: INK });
  // Show a sample period anchored to a recent fortnight (uses today's date so the brief
  // reads as freshly prepared whenever it's generated).
  const today = new Date();
  const dEnd = new Date(today); dEnd.setDate(dEnd.getDate() - (dEnd.getDay() === 0 ? 7 : dEnd.getDay()));
  const dStart = new Date(dEnd); dStart.setDate(dStart.getDate() - 13);
  const dFmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  p2.drawText(`Pay period ${dFmt(dStart)} to ${dFmt(dEnd)} · pay date ${dFmt(dEnd)}`,
    { x: stubX + 16, y: stubY + stubH - 38, size: 9, font: reg, color: MUTED });
  p2.drawText("Employee A · Admin", { x: stubX + 16, y: stubY + stubH - 56, size: 11, font: bold, color: INK });

  const stub = [
    ["Hours worked",      "80.00",        false],
    ["Base salary",       "PGK 1,200.00", false],
    ["Housing allowance", "PGK   200.00", false],
    ["GROSS",             "PGK 1,400.00", true],
    ["Salary & wages tax", "- PGK 189.00", false],
    ["Nasfund (6%)",      "- PGK  84.00", false],
    ["NET PAY",           "PGK 1,127.00", true],
  ];
  let yRow = stubY + stubH - 76;
  stub.forEach(([l, v, isTotal]) => {
    const f = isTotal ? bold : reg;
    const c = isTotal ? INK : SOFT;
    p2.drawText(String(l), { x: stubX + 16, y: yRow, size: 10, font: f, color: c });
    p2.drawText(String(v), { x: stubX + stubW - 16 - reg.widthOfTextAtSize(String(v), 10),
      y: yRow, size: 10, font: f, color: c });
    yRow -= 14;
    if (isTotal) {
      p2.drawLine({
        start: { x: stubX + 16, y: yRow + 6 }, end: { x: stubX + stubW - 16, y: yRow + 6 },
        thickness: 0.5, color: rgb(0.92, 0.92, 0.92),
      });
      yRow -= 4;
    }
  });

  // "Plus you also receive" list
  p2.drawText("Plus, every fortnight, you also receive:", {
    x: 48, y: stubY - 24, size: 13, font: bold, color: INK,
  });
  const outputs = [
    ["BSP batch CSV",     "Bank-spec 12-column file. Upload directly to BSP Batch Manager."],
    ["NASFund return",    "Monthly NCSL contribution file, AP-signed and ready to file."],
    ["IRC SWT summary",   "Salary or Wages Tax remittance breakdown for the period."],
    ["Approve-via-email", "Magic link so a remote AP can sign off from their phone — no log-in."],
    ["Employee stubs",    "Branded PDF stubs emailed automatically once payroll is approved."],
    ["QuickBooks IIF",    "General journal export for your existing QB books."],
    ["Period archive",    "One ZIP with BSP + NASFund + IIF + every pay-slip PDF. Hand-off ready."],
    ["Audit log",         "Every approval / edit / re-send recorded with actor and timestamp."],
  ];
  const outputsTop = stubY - 46;
  outputs.forEach((o, i) => {
    const y = outputsTop - i * 18;
    p2.drawText("·", { x: 54, y, size: 12, font: bold, color: GOLD });
    p2.drawText(o[0], { x: 66, y, size: 10.5, font: bold, color: INK });
    p2.drawText(o[1], { x: 200, y, size: 10, font: reg, color: SOFT });
  });
  const outputsBottom = outputsTop - (outputs.length - 1) * 18;

  // "What's new" strip — three short callouts so the brief stays fresh meeting after meeting
  const newH = 66;
  const nY = outputsBottom - 22;                 // box top
  p2.drawRectangle({ x: 48, y: nY - newH, width: W2 - 96, height: newH, color: GOLD_SOFT,
    borderColor: rgb(0.86, 0.78, 0.50), borderWidth: 0.6 });
  p2.drawText("New this quarter", { x: 64, y: nY - 18, size: 10.5, font: bold, color: NAVY_DEEP });
  const news = [
    "Divisions with supervisors enter their team's hours",
    "Anomaly alerts catch fortnight-on-fortnight outliers",
    "TOTP two-factor auth + full audit log for compliance",
  ];
  news.forEach((n, i) => {
    p2.drawText("· " + n, { x: 64, y: nY - 36 - i * 13, size: 9, font: reg, color: INK });
  });

  // Pricing band — two tiers + time-savings (single dense paragraph for layout fit)
  const priceH = 104;
  const pY = nY - newH - 20;                      // box top
  p2.drawRectangle({ x: 48, y: pY - priceH, width: W2 - 96, height: priceH, color: GOLD });
  p2.drawText("Pricing — two tiers · save weeks every year", { x: 64, y: pY - 22, size: 13, font: bold, color: NAVY });
  drawWrapped(p2, reg, 9.5, NAVY_DEEP,
    "Self-service from PGK 9 / employee / fortnight — TeebeePay generates everything; you file with BSP and IRC. " +
    "Managed bureau from PGK 14 / employee / fortnight — a CPA reviews and files BSP batches, NASFund returns, " +
    "IRC SWT remittances, and year-end Form S for you. A 30-employee manual payroll runs 8–12 hours per fortnight " +
    "(~250–300 hours/year); Self-service drops that to 1–2 hours, Managed to 15–30 minutes. ~6–7 weeks of FTE time back every year.",
    64, pY - 40, W2 - 128, 11);

  // CTA — below the pricing band
  const nextTop = pY - priceH - 24;
  p2.drawText("Next step", { x: 48, y: nextTop, size: 13, font: bold, color: INK });
  drawWrapped(p2, reg, 10.5, SOFT,
    "Send us a CSV of your current employee list and we'll show you the actual TeebeePay " +
    "output for one fortnight — pay stubs, BSP batch, NASFund return — at no charge. Email " +
    "info@teebeeaccountants.com.pg or call +675 300 0000.",
    48, nextTop - 18, W2 - 96, 14);

  centerText(p2, reg, 9, MUTED,
    "Tee Bee Accountants Ltd · TeebeePay · www.teebeeaccountants.com.pg",
    30, W2);

  const bytes = await pdf.save();
  const filename = `TBA-brief-${co.replace(/[^A-Za-z0-9_-]+/g, "_") || "client"}.pdf`;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}

/* ── small text helpers (pdf-lib has no built-in word wrap) ───────── */

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
