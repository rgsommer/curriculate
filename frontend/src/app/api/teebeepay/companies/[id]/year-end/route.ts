// GET → Year-end employer summary pack for a calendar year.
//   ?year=YYYY (default = current year)
//   ?format=xlsx | pdf (default xlsx)
//
// Aggregates payroll_entries by employee for the year and returns either:
//   - XLSX: one master sheet with every employee + their annual totals
//   - PDF:  one page per employee (payment-summary style) plus a totals page
//
// Note: this is TeebeePay's internal year-end summary using the same data
// IRC Form S requires. When the official Form S template is finalised, the
// layout swaps in without changing the underlying numbers.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getUTCFullYear();
  const format = (url.searchParams.get("format") || "xlsx").toLowerCase();
  const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;

  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const company: any = await dbi.collection("companies").findOne({ _id: cid });

    // Aggregate per-employee annual totals from payroll_entries joined to pay_periods.
    // Filter by pay_date in the target year.
    const rows = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.company_id": cid, "p.pay_date": { $gte: yearStart, $lte: yearEnd } } },
      { $lookup: { from: "employees", localField: "employee_id", foreignField: "_id", as: "e" } },
      { $unwind: "$e" },
      { $lookup: { from: "departments", localField: "e.department_id", foreignField: "_id", as: "d" } },
      { $unwind: { path: "$d", preserveNullAndEmptyArrays: true } },
      { $group: {
          _id: "$employee_id",
          first_name: { $first: "$e.first_name" },
          last_name: { $first: "$e.last_name" },
          email: { $first: "$e.email" },
          dob: { $first: "$e.dob" },
          dependents: { $first: { $ifNull: ["$e.dependents", 0] } },
          residency_status: { $first: "$e.residency_status" },
          declaration_lodged: { $first: "$e.declaration_lodged" },
          pay_type: { $first: "$e.pay_type" },
          department: { $first: "$d.name" },
          periods_worked: { $sum: 1 },
          gross: { $sum: { $ifNull: ["$gross", 0] } },
          tax: { $sum: { $ifNull: ["$tax", 0] } },
          nasfund_emp: { $sum: { $ifNull: ["$nasfund", 0] } },
          other_deductions: { $sum: { $ifNull: ["$other_deductions", 0] } },
          net: { $sum: { $ifNull: ["$net", 0] } },
          nasfund_employer_est: { $sum: { $ifNull: ["$calc_breakdown.nasfund_employer", { $multiply: [{ $ifNull: ["$gross", 0] }, 0.084] }] } },
          allowances: { $sum: { $add: [
              { $ifNull: ["$calc_breakdown.housing_allowance", 0] },
              { $ifNull: ["$calc_breakdown.meals_allowance", 0] },
              { $ifNull: ["$calc_breakdown.school_fees_allowance", 0] },
              { $ifNull: ["$calc_breakdown.vehicle_allowance", 0] },
              { $ifNull: ["$calc_breakdown.fuel_allowance", 0] },
          ] } },
      } },
      { $sort: { last_name: 1, first_name: 1 } },
    ]).toArray();

    if (format === "pdf") {
      const buf = await renderYearEndPdf(company, year, rows);
      const fn = `${(company?.abbreviation || company?.name || "company").replace(/\W+/g, "_")}-year-end-${year}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${fn}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
    // Default: XLSX
    const buf = await renderYearEndXlsx(company, year, rows);
    const fn = `${(company?.abbreviation || company?.name || "company").replace(/\W+/g, "_")}-year-end-${year}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fn}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    console.error("[teebeepay/year-end] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

async function renderYearEndXlsx(company: any, year: number, rows: any[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TeebeePay";
  wb.created = new Date();
  const ccy = company?.currency || "PGK";
  const ws = wb.addWorksheet(`${year} Year-end`);
  ws.spliceRows(1, 0, [`${company?.name || "Company"} — Year-end employer summary ${year}`]);
  ws.mergeCells("A1:M1");
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.spliceRows(2, 0, [`Generated ${new Date().toISOString().slice(0, 10)} — TeebeePay internal summary (basis for IRC Form S)`]);
  ws.mergeCells("A2:M2");
  ws.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };

  ws.columns = [
    { header: "Last name", key: "last_name", width: 16 },
    { header: "First name", key: "first_name", width: 14 },
    { header: "Email", key: "email", width: 28 },
    { header: "DOB", key: "dob", width: 12 },
    { header: "Department", key: "department", width: 16 },
    { header: "Residency", key: "residency", width: 12 },
    { header: "Declaration", key: "declaration", width: 12 },
    { header: "Dependants", key: "dependents", width: 11 },
    { header: "Periods", key: "periods", width: 9 },
    { header: `Gross (${ccy})`, key: "gross", width: 14 },
    { header: `Allowances (${ccy})`, key: "allowances", width: 14 },
    { header: `SWT (${ccy})`, key: "tax", width: 14 },
    { header: `Nasfund employee (${ccy})`, key: "nasfund_emp", width: 18 },
    { header: `Nasfund employer (${ccy})`, key: "nasfund_employer_est", width: 18 },
    { header: `Other deductions (${ccy})`, key: "other_deductions", width: 18 },
    { header: `Net (${ccy})`, key: "net", width: 14 },
  ];
  ws.getRow(3).font = { bold: true };
  let totals = { gross: 0, allowances: 0, tax: 0, nasfund_emp: 0, nasfund_employer_est: 0, other_deductions: 0, net: 0 };
  for (const r of rows) {
    ws.addRow({
      last_name: r.last_name || "",
      first_name: r.first_name || "",
      email: r.email || "",
      dob: r.dob || "",
      department: r.department || "(no department)",
      residency: r.residency_status || "resident",
      declaration: r.declaration_lodged === false ? "No (Table B)" : "Yes (Table A)",
      dependents: r.dependents || 0,
      periods: r.periods_worked,
      gross: r.gross,
      allowances: r.allowances,
      tax: r.tax,
      nasfund_emp: r.nasfund_emp,
      nasfund_employer_est: r.nasfund_employer_est,
      other_deductions: r.other_deductions,
      net: r.net,
    });
    totals.gross += r.gross; totals.allowances += r.allowances; totals.tax += r.tax;
    totals.nasfund_emp += r.nasfund_emp; totals.nasfund_employer_est += r.nasfund_employer_est;
    totals.other_deductions += r.other_deductions; totals.net += r.net;
  }
  // Totals row
  const tRow = ws.addRow({
    last_name: "TOTAL", first_name: "", email: "", dob: "", department: `${rows.length} employees`,
    residency: "", declaration: "", dependents: "", periods: "",
    gross: totals.gross, allowances: totals.allowances, tax: totals.tax,
    nasfund_emp: totals.nasfund_emp, nasfund_employer_est: totals.nasfund_employer_est,
    other_deductions: totals.other_deductions, net: totals.net,
  });
  tRow.font = { bold: true };
  tRow.eachCell((cell, col) => {
    if (col >= 10) cell.numFmt = "#,##0.00";
    cell.border = { top: { style: "thin" } };
  });
  // Currency formatting
  for (let i = 4; i <= ws.rowCount - 1; i++) {
    for (let col = 10; col <= 16; col++) ws.getCell(i, col).numFmt = "#,##0.00";
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

async function renderYearEndPdf(company: any, year: number, rows: any[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.058, 0.172, 0.321);
  const INK = rgb(0.039, 0.101, 0.180);
  const SOFT = rgb(0.278, 0.337, 0.412);
  const MUTED = rgb(0.392, 0.455, 0.545);
  const GOLD = rgb(0.788, 0.635, 0.152);
  const ccy = company?.currency || "PGK";

  function fmt(n: any): string {
    return Number(n || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function addPaymentSummary(emp: any) {
    const page = pdf.addPage(PageSizes.A4);
    const W = page.getWidth(), H = page.getHeight();
    // Header band
    page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: NAVY });
    page.drawText(`${company?.name || "Company"}`, { x: 40, y: H - 36, size: 18, font: bold, color: GOLD });
    page.drawText(`Year-end payment summary · ${year}`,
      { x: 40, y: H - 60, size: 10.5, font: reg, color: rgb(0.7, 0.78, 0.86) });

    // Employee header
    const fullName = `${emp.first_name || ""} ${emp.last_name || ""}`.trim();
    page.drawText(fullName || "—", { x: 40, y: H - 120, size: 22, font: bold, color: INK });
    const subY = H - 144;
    const subBits = [
      emp.email ? `Email ${emp.email}` : null,
      emp.dob ? `DOB ${emp.dob}` : null,
      emp.department ? `Dept ${emp.department}` : null,
      `Residency ${emp.residency_status || "resident"}`,
      `Declaration ${emp.declaration_lodged === false ? "no (Table B)" : "yes (Table A)"}`,
      `Dependants ${emp.dependents || 0}`,
      `Periods worked ${emp.periods_worked}`,
    ].filter(Boolean);
    page.drawText(subBits.join(" · "), { x: 40, y: subY, size: 9, font: reg, color: MUTED, maxWidth: W - 80, lineHeight: 12 });

    // Totals box
    const rows: [string, string, boolean?][] = [
      ["Gross pay",               `${ccy} ${fmt(emp.gross)}`],
      ["of which allowances",     `${ccy} ${fmt(emp.allowances)}`],
      ["",                        ""],
      ["Salary or Wages Tax (SWT)", `- ${ccy} ${fmt(emp.tax)}`],
      ["Nasfund employee (6%)",   `- ${ccy} ${fmt(emp.nasfund_emp)}`],
      ["Other deductions",        `- ${ccy} ${fmt(emp.other_deductions)}`],
      ["NET PAID",                `${ccy} ${fmt(emp.net)}`, true],
      ["",                        ""],
      ["Nasfund employer (8.4%, employer-paid)", `${ccy} ${fmt(emp.nasfund_employer_est)}`],
    ];
    const tX = 40, tW = W - 80;
    let tY = H - 200;
    page.drawRectangle({ x: tX, y: tY - rows.length * 22 - 20, width: tW, height: rows.length * 22 + 20,
      color: rgb(1, 1, 1), borderColor: rgb(0.92, 0.92, 0.92), borderWidth: 1 });
    let ry = tY;
    for (const [label, val, total] of rows) {
      if (!label && !val) { ry -= 12; continue; }
      const f = total ? bold : reg;
      const c = total ? INK : SOFT;
      const size = total ? 12 : 10.5;
      page.drawText(label, { x: tX + 16, y: ry, size, font: f, color: c });
      const valW = f.widthOfTextAtSize(val, size);
      page.drawText(val, { x: tX + tW - 16 - valW, y: ry, size, font: f, color: c });
      ry -= 22;
      if (total) {
        page.drawLine({ start: { x: tX + 16, y: ry + 10 }, end: { x: tX + tW - 16, y: ry + 10 },
          thickness: 0.5, color: rgb(0.85, 0.85, 0.85) });
      }
    }

    // Footer
    page.drawText(`Generated by TeebeePay · ${new Date().toISOString().slice(0, 10)} · Internal summary supporting IRC Form S`,
      { x: 40, y: 30, size: 8.5, font: reg, color: MUTED });
  }

  // One page per employee
  for (const r of rows) addPaymentSummary(r);

  // Totals page at the end
  if (rows.length) {
    const tot = rows.reduce((a: any, r: any) => ({
      gross: a.gross + r.gross, allowances: a.allowances + r.allowances,
      tax: a.tax + r.tax, nasfund_emp: a.nasfund_emp + r.nasfund_emp,
      nasfund_employer_est: a.nasfund_employer_est + r.nasfund_employer_est,
      other: a.other + r.other_deductions, net: a.net + r.net,
    }), { gross: 0, allowances: 0, tax: 0, nasfund_emp: 0, nasfund_employer_est: 0, other: 0, net: 0 });
    const page = pdf.addPage(PageSizes.A4);
    const W = page.getWidth(), H = page.getHeight();
    page.drawRectangle({ x: 0, y: H - 80, width: W, height: 80, color: NAVY });
    page.drawText(`${company?.name || "Company"}`, { x: 40, y: H - 36, size: 18, font: bold, color: GOLD });
    page.drawText(`Year-end employer totals · ${year}`,
      { x: 40, y: H - 60, size: 10.5, font: reg, color: rgb(0.7, 0.78, 0.86) });
    page.drawText(`${rows.length} employees paid during ${year}`,
      { x: 40, y: H - 110, size: 12, font: bold, color: INK });
    let y = H - 150;
    const lines: [string, number, boolean?][] = [
      ["Gross pay (all employees)", tot.gross],
      ["of which allowances",       tot.allowances],
      ["Salary or Wages Tax (SWT) withheld", tot.tax],
      ["Nasfund employee (6%) deducted", tot.nasfund_emp],
      ["Nasfund employer (8.4%) paid",   tot.nasfund_employer_est],
      ["Other deductions",          tot.other],
      ["Total net paid",            tot.net, true],
    ];
    for (const [label, val, total] of lines) {
      const f = total ? bold : reg;
      const c = total ? INK : SOFT;
      const sz = total ? 13 : 11;
      page.drawText(label, { x: 60, y, size: sz, font: f, color: c });
      const s = `${ccy} ${fmt(val)}`;
      const w = f.widthOfTextAtSize(s, sz);
      page.drawText(s, { x: W - 60 - w, y, size: sz, font: f, color: c });
      y -= 22;
    }
    page.drawText("This is TeebeePay's internal employer summary. The figures match what's required by IRC Form S; layout will be reformatted to the official template when finalised.",
      { x: 40, y: 60, size: 9, font: reg, color: MUTED, maxWidth: W - 80, lineHeight: 12 });
    page.drawText(`Generated by TeebeePay · ${new Date().toISOString().slice(0, 10)}`,
      { x: 40, y: 30, size: 8.5, font: reg, color: MUTED });
  }

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}
