// frontend/src/app/api/teebee/brief/route.ts
//
// Generates a personalised 2-page Tee Bee Accountants + TeebeePay brief
// as a PDF, with the prospect's company name and headcount pre-filled.
//
// Usage:
//   GET /api/teebee/brief?co=Acme%20Ltd&employees=22&service=Payroll
//   → application/pdf attachment
//
// Each meeting Theresia walks into, she opens this URL, hits download,
// and brings a printed copy. Or attaches the link to a cold email.
import { NextResponse } from "next/server";
import PDFDocument from "pdfkit";

export const dynamic = "force-dynamic";

const NAVY      = "#0f2c52";
const NAVY_DEEP = "#081d3a";
const GOLD      = "#c9a227";
const INK       = "#0a1a2e";
const SOFT      = "#475569";
const MUTED     = "#64748b";
const CREAM     = "#fbfaf6";

function safe(s: string | null | undefined, fallback = ""): string {
  return (s == null ? fallback : String(s)).slice(0, 120);
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const co        = safe(u.searchParams.get("co"), "Your Company");
  const employees = safe(u.searchParams.get("employees"), "—");
  const service   = safe(u.searchParams.get("service"), "Payroll & compliance");

  const buffers: Buffer[] = [];
  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  doc.on("data", (b: Buffer) => buffers.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end",   () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
  });

  /* ============ Page 1 — Who we are ============ */
  // Header band
  doc.rect(0, 0, doc.page.width, 100).fill(NAVY);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(26)
     .text("Tee Bee Accountants Ltd", 48, 36, { width: doc.page.width - 96 });
  doc.fillColor("#9bb1d4").fontSize(11).font("Helvetica")
     .text("CPA-certified · Registered Tax Agents · Port Moresby · 10+ years", 48, 70);

  // Personalised line
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(14)
     .text(`Prepared for: ${co}`, 48, 120);
  doc.fillColor(MUTED).font("Helvetica").fontSize(10)
     .text(`Headcount: ${employees}   ·   Primary interest: ${service}   ·   ${new Date().toISOString().slice(0, 10)}`,
           48, 140);

  // Big value proposition
  doc.moveDown(2);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20)
     .text("What we do, in 30 seconds.", 48, 180, { width: doc.page.width - 96 });
  doc.font("Helvetica").fontSize(11.5).fillColor(SOFT)
     .text("Tee Bee Accountants Ltd (TBA) is a full-service accounting and audit firm in Papua New Guinea. We work with SMEs, landowner companies, and project SPVs across audit and assurance, taxation, accounting, business advisory, statutory compliance, and financial consulting. We are registered with the PNG Accountants Registration Board and the IRC. Our work is IFRS-compliant.",
           { width: doc.page.width - 96, align: "left", lineGap: 2 });

  // Services panel
  const services = [
    ["01", "Audit & Assurance",     "Independent audits for companies of all sizes — IFRS compliant."],
    ["02", "Taxation Services",     "Strategic tax planning and full IRC compliance."],
    ["03", "Accounting Services",   "Bookkeeping, financial reporting, payroll (via TeebeePay)."],
    ["04", "Business Advisory",     "Growth, financial planning, risk and efficiency."],
    ["05", "Statutory Compliance",  "Company secretarial, IPA annual returns, regulatory upkeep."],
    ["06", "Financial Consulting",  "Feasibility studies, due diligence, investment advisory."],
  ];

  const colWidth = (doc.page.width - 48 * 2 - 16) / 2;
  let y = 290;
  services.forEach((s, i) => {
    const col  = i % 2;
    const row  = Math.floor(i / 2);
    const x    = 48 + col * (colWidth + 16);
    const ry   = y + row * 92;
    doc.roundedRect(x, ry, colWidth, 78, 8).fillAndStroke(CREAM, "#eaeaea");
    doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11).text(s[0], x + 14, ry + 12);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(s[1], x + 36, ry + 11, { width: colWidth - 50 });
    doc.fillColor(SOFT).font("Helvetica").fontSize(9.5).text(s[2], x + 36, ry + 30, { width: colWidth - 50, lineGap: 1.5 });
  });

  // Why us strip
  const stripY = y + 3 * 92 + 8;
  doc.roundedRect(48, stripY, doc.page.width - 96, 78, 10).fillAndStroke(NAVY, NAVY);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11).text("Why TBA", 64, stripY + 12);
  doc.fillColor("#fff").font("Helvetica").fontSize(10).text(
    "CPA-certified team · IFRS-compliant reporting · Registered tax agents with the PNG IRC · Deep local expertise · 500+ clients served over 10+ years · Dedicated client relationships.",
    64, stripY + 30, { width: doc.page.width - 128, lineGap: 1.8 });

  // Page 1 footer
  doc.fillColor(MUTED).font("Helvetica").fontSize(9)
     .text("Tee Bee Accountants Ltd · Port Moresby, NCD, Papua New Guinea · info@teebeeaccountants.com.pg · +675 300 0000",
           48, doc.page.height - 60, { width: doc.page.width - 96, align: "center" });

  /* ============ Page 2 — TeebeePay sample output ============ */
  doc.addPage();

  doc.rect(0, 0, doc.page.width, 100).fill(NAVY);
  doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(26)
     .text("TeebeePay — your fortnight, end to end", 48, 36, { width: doc.page.width - 96 });
  doc.fillColor("#9bb1d4").font("Helvetica").fontSize(11)
     .text(`What a TeebeePay fortnightly run delivers for ${co}`, 48, 70);

  // Mini pay-stub mockup
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13)
     .text("Pay stub (sample, per employee)", 48, 124);
  doc.roundedRect(48, 144, doc.page.width - 96, 200, 10).fillAndStroke("#fff", "#eaeaea");

  doc.fillColor(INK).font("Helvetica-Bold").fontSize(12).text(co, 64, 160);
  doc.fillColor(MUTED).font("Helvetica").fontSize(9).text("Pay period 5 May 2026 to 18 May 2026 · pay date 18 May 2026", 64, 178);
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text("Employee A · Admin", 64, 198);

  const stubRows = [
    ["Hours worked",     "80.00"],
    ["Base salary",      "PGK 1,200.00"],
    ["Housing allowance","PGK   200.00"],
    ["GROSS",            "PGK 1,400.00"],
    ["Salary & wages tax","-PGK  189.00"],
    ["Nasfund (6%)",     "-PGK   84.00"],
    ["NET PAY",          "PGK 1,127.00"],
  ];
  let sy = 222;
  stubRows.forEach(([l, v]) => {
    const isTotal = l === "GROSS" || l === "NET PAY";
    doc.font(isTotal ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(isTotal ? INK : SOFT);
    doc.text(l, 64, sy, { width: 240 });
    doc.text(v, 300, sy, { width: 220, align: "right" });
    sy += 14;
    if (isTotal) {
      doc.strokeColor("#eaeaea").lineWidth(0.5).moveTo(64, sy).lineTo(doc.page.width - 64, sy).stroke();
      sy += 4;
    }
  });

  // BSP batch + NASFund + IRC strip
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("Plus, every fortnight, you also receive:", 48, 370);
  const outputs = [
    ["BSP batch CSV",   "Bank-spec 12-column file. Upload directly to BSP Batch Manager."],
    ["NASFund return",  "Monthly NCSL contribution file, AP-signed and ready to file."],
    ["IRC SWT summary", "Salary or Wages Tax remittance breakdown for the period."],
    ["Approver email",  "Pre-approval summary to your office for sign-off before stubs go out."],
    ["Employee stubs",  "Branded PDF stubs emailed automatically once payroll is approved."],
    ["QuickBooks IIF",  "General journal export for your existing QB books."],
  ];
  outputs.forEach((o, i) => {
    const yy = 398 + i * 26;
    doc.fillColor(GOLD).font("Helvetica-Bold").fontSize(11).text("·", 56, yy);
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(10.5).text(o[0], 68, yy, { width: 130 });
    doc.fillColor(SOFT).font("Helvetica").fontSize(10).text(o[1], 200, yy, { width: doc.page.width - 250 });
  });

  // Pricing band
  const pBand = 560;
  doc.roundedRect(48, pBand, doc.page.width - 96, 60, 10).fillAndStroke(GOLD, GOLD);
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(14).text("Pricing", 64, pBand + 14);
  doc.font("Helvetica").fontSize(10.5).fillColor(NAVY_DEEP).text(
    "From PGK 9 per employee per fortnight (Standard tier). All-inclusive: pay stubs, BSP batch, NASFund/NCSL, IRC SWT, audit log. First fortnight is free so you can see actual output before deciding.",
    64, pBand + 34, { width: doc.page.width - 128, lineGap: 1.5 });

  // CTA
  const ctaY = pBand + 80;
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(13).text("Next step", 48, ctaY);
  doc.fillColor(SOFT).font("Helvetica").fontSize(10.5).text(
    "Send us a CSV of your current employee list and we'll show you the actual TeebeePay output for one fortnight — pay stubs, BSP batch, NASFund return — at no charge. Email info@teebeeaccountants.com.pg or call +675 300 0000.",
    48, ctaY + 18, { width: doc.page.width - 96, lineGap: 1.8 });

  // Footer
  doc.fillColor(MUTED).font("Helvetica").fontSize(9)
     .text("Tee Bee Accountants Ltd · TeebeePay · www.teebeeaccountants.com.pg",
           48, doc.page.height - 50, { width: doc.page.width - 96, align: "center" });

  doc.end();
  const pdf = await done;
  const filename = `TBA-brief-${co.replace(/[^A-Za-z0-9_-]+/g, "_") || "client"}.pdf`;
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "private, max-age=0, must-revalidate",
    },
  });
}
