// GET → aggregated reports for one company.
//   ?period=weekly | monthly  (default monthly)
//   ?format=json | xlsx | pdf (default json — XLSX/PDF return downloadable files)
//   ?from=YYYY-MM-DD          (optional lower bound on pay_date — reserved)
//   ?to=YYYY-MM-DD            (optional upper bound on pay_date — reserved)
//
// JSON response also includes:
//   ytd          — current-year totals (gross/tax/nasfund/net/n_emp) summed from the buckets
//   currentYear  — the year used for YTD
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";
import ExcelJS from "exceljs";
import { PDFDocument, rgb, StandardFonts, PageSizes } from "pdf-lib";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "weekly" ? "weekly" : "monthly";
  const format = (url.searchParams.get("format") || "json").toLowerCase();
  const dateFmt = period === "weekly" ? "%G-W%V" : "%Y-%m";

  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const company: any = await dbi.collection("companies").findOne({ _id: cid });

    // Bucketed summary
    const summary = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.company_id": cid } },
      { $addFields: { _pd: { $cond: [
          { $eq: [{ $type: "$p.pay_date" }, "string"] },
          { $dateFromString: { dateString: "$p.pay_date", onError: null, onNull: null } },
          "$p.pay_date",
      ] } } },
      { $group: {
          _id: { $dateToString: { format: dateFmt, date: "$_pd" } },
          gross: { $sum: { $ifNull: ["$gross", 0] } },
          tax: { $sum: { $ifNull: ["$tax", 0] } },
          nasfund: { $sum: { $ifNull: ["$nasfund", 0] } },
          other: { $sum: { $ifNull: ["$other_deductions", 0] } },
          net: { $sum: { $ifNull: ["$net", 0] } },
          employees: { $addToSet: "$employee_id" },
      } },
      { $project: { bucket: "$_id", gross: 1, tax: 1, nasfund: 1, other: 1, net: 1,
                    n_emp: { $size: "$employees" }, _id: 0 } },
      { $sort: { bucket: -1 } }, { $limit: 36 },
    ]).toArray();

    // By department
    const byDept = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: { "p.company_id": cid } },
      { $lookup: { from: "employees", localField: "employee_id", foreignField: "_id", as: "e" } },
      { $unwind: "$e" },
      { $lookup: { from: "departments", localField: "e.department_id", foreignField: "_id", as: "d" } },
      { $unwind: { path: "$d", preserveNullAndEmptyArrays: true } },
      { $group: {
          _id: { $ifNull: ["$d.name", "(no department)"] },
          gross: { $sum: { $ifNull: ["$gross", 0] } },
          net:   { $sum: { $ifNull: ["$net", 0] } },
          n: { $sum: 1 },
      } },
      { $project: { dept: "$_id", gross: 1, net: 1, n: 1, _id: 0 } },
      { $sort: { gross: -1 } },
    ]).toArray();

    // Top 25 employees by total gross
    const byEmployee = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" }, { $match: { "p.company_id": cid } },
      { $lookup: { from: "employees", localField: "employee_id", foreignField: "_id", as: "e" } },
      { $unwind: "$e" },
      { $group: {
          _id: "$employee_id",
          name: { $first: { $concat: ["$e.last_name", ", ", "$e.first_name"] } },
          gross: { $sum: { $ifNull: ["$gross", 0] } },
          net:   { $sum: { $ifNull: ["$net", 0] } },
          n: { $sum: 1 },
      } },
      { $sort: { gross: -1 } }, { $limit: 25 },
      { $project: { id: { $toString: "$_id" }, name: 1, gross: 1, net: 1, n: 1, _id: 0 } },
    ]).toArray();

    // Total gross for share calculations
    const totalAgg = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" }, { $match: { "p.company_id": cid } },
      { $group: { _id: null, total: { $sum: { $ifNull: ["$gross", 0] } } } },
    ]).toArray();
    const totalGross = totalAgg.length ? totalAgg[0].total : 0;

    const shares = await dbi.collection("employees")
      .find({ company_id: cid, payroll_share_pct: { $gt: 0 } })
      .toArray();
    const shareRows = shares.map((s: any) => ({
      name: `${s.last_name}, ${s.first_name}`,
      pct: s.payroll_share_pct,
      lifetime: +(totalGross * s.payroll_share_pct / 100).toFixed(2),
    }));

    // Year-to-date rollup: sum the buckets that fall in the current calendar year
    const currentYear = new Date().getUTCFullYear();
    const yearPrefix = String(currentYear);
    const ytd = (summary as any[])
      .filter((r) => String(r.bucket || "").startsWith(yearPrefix))
      .reduce((acc: any, r: any) => ({
        gross: acc.gross + (r.gross || 0),
        tax: acc.tax + (r.tax || 0),
        nasfund: acc.nasfund + (r.nasfund || 0),
        other: acc.other + (r.other || 0),
        net: acc.net + (r.net || 0),
        periods: acc.periods + 1,
        n_emp_max: Math.max(acc.n_emp_max, r.n_emp || 0),
      }), { gross: 0, tax: 0, nasfund: 0, other: 0, net: 0, periods: 0, n_emp_max: 0 });

    const payload = {
      summary, byDept, byEmployee, shares: shareRows, totalGross,
      ytd, currentYear, period,
    };

    if (format === "xlsx") {
      const buf = await renderReportXlsx(company, payload);
      const filename = `${(company?.abbreviation || company?.name || "company").replace(/\W+/g, "_")}-payroll-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
    if (format === "pdf") {
      const buf = await renderReportPdf(company, payload);
      const filename = `${(company?.abbreviation || company?.name || "company").replace(/\W+/g, "_")}-payroll-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${filename}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      });
    }
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error("[teebeepay/reports] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

/* ──────────────── XLSX renderer ──────────────── */

async function renderReportXlsx(company: any, p: any): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TeebeePay";
  wb.created = new Date();

  const ccy = company?.currency || "PGK";
  const cname = company?.name || "Company";
  const today = new Date().toISOString().slice(0, 10);

  // Sheet 1 — Summary
  const s1 = wb.addWorksheet("Summary");
  s1.columns = [
    { header: "Bucket", key: "bucket", width: 14 },
    { header: "Employees", key: "n_emp", width: 11 },
    { header: `Gross (${ccy})`, key: "gross", width: 14 },
    { header: `Tax (${ccy})`, key: "tax", width: 14 },
    { header: `Nasfund (${ccy})`, key: "nasfund", width: 14 },
    { header: `Other (${ccy})`, key: "other", width: 14 },
    { header: `Net (${ccy})`, key: "net", width: 14 },
  ];
  s1.addRow([]);
  s1.spliceRows(1, 0, [`${cname} — ${p.period === "weekly" ? "Weekly" : "Monthly"} payroll summary`]);
  s1.mergeCells("A1:G1");
  s1.getCell("A1").font = { bold: true, size: 14 };
  s1.spliceRows(2, 0, [`Generated ${today} · YTD ${p.currentYear}: ${ccy} ${fmt(p.ytd.gross)} gross / ${ccy} ${fmt(p.ytd.net)} net across ${p.ytd.periods} ${p.period === "weekly" ? "weeks" : "months"}`]);
  s1.mergeCells("A2:G2");
  s1.getCell("A2").font = { italic: true, color: { argb: "FF6B7280" } };
  // header row is already auto-inserted by columns; bold it
  s1.getRow(3).font = { bold: true };
  for (const r of p.summary) {
    s1.addRow({ bucket: r.bucket, n_emp: r.n_emp, gross: r.gross, tax: r.tax,
                 nasfund: r.nasfund, other: r.other, net: r.net });
  }
  for (let i = 4; i <= s1.rowCount; i++) {
    ["C", "D", "E", "F", "G"].forEach((c) => s1.getCell(`${c}${i}`).numFmt = "#,##0.00");
  }

  // Sheet 2 — By department
  const s2 = wb.addWorksheet("By department");
  s2.columns = [
    { header: "Department", key: "dept", width: 28 },
    { header: "Entries", key: "n", width: 10 },
    { header: `Gross (${ccy})`, key: "gross", width: 14 },
    { header: `Net (${ccy})`, key: "net", width: 14 },
  ];
  s2.getRow(1).font = { bold: true };
  for (const r of p.byDept) {
    s2.addRow({ dept: r.dept, n: r.n, gross: r.gross, net: r.net });
  }
  for (let i = 2; i <= s2.rowCount; i++) {
    ["C", "D"].forEach((c) => s2.getCell(`${c}${i}`).numFmt = "#,##0.00");
  }

  // Sheet 3 — Top employees
  const s3 = wb.addWorksheet("Top employees");
  s3.columns = [
    { header: "Employee", key: "name", width: 30 },
    { header: "Periods", key: "n", width: 10 },
    { header: `Gross (${ccy})`, key: "gross", width: 14 },
    { header: `Net (${ccy})`, key: "net", width: 14 },
  ];
  s3.getRow(1).font = { bold: true };
  for (const r of p.byEmployee) {
    s3.addRow({ name: r.name, n: r.n, gross: r.gross, net: r.net });
  }
  for (let i = 2; i <= s3.rowCount; i++) {
    ["C", "D"].forEach((c) => s3.getCell(`${c}${i}`).numFmt = "#,##0.00");
  }

  // Sheet 4 — Master-user shares
  if (p.shares?.length) {
    const s4 = wb.addWorksheet("Master shares");
    s4.columns = [
      { header: "Recipient", key: "name", width: 30 },
      { header: "%", key: "pct", width: 8 },
      { header: `Cumulative share (${ccy})`, key: "lifetime", width: 20 },
    ];
    s4.getRow(1).font = { bold: true };
    for (const r of p.shares) {
      s4.addRow({ name: r.name, pct: r.pct, lifetime: r.lifetime });
    }
    for (let i = 2; i <= s4.rowCount; i++) {
      s4.getCell(`C${i}`).numFmt = "#,##0.00";
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

/* ──────────────── PDF renderer ──────────────── */

async function renderReportPdf(company: any, p: any): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.058, 0.172, 0.321);
  const INK = rgb(0.039, 0.101, 0.180);
  const SOFT = rgb(0.278, 0.337, 0.412);
  const MUTED = rgb(0.392, 0.455, 0.545);
  const GOLD = rgb(0.788, 0.635, 0.152);

  const ccy = company?.currency || "PGK";
  const cname = company?.name || "Company";
  const today = new Date().toISOString().slice(0, 10);

  let page = pdf.addPage(PageSizes.A4);
  let W = page.getWidth(), H = page.getHeight();
  let y = H - 50;

  function newPage() {
    page = pdf.addPage(PageSizes.A4);
    W = page.getWidth(); H = page.getHeight();
    y = H - 50;
  }
  function ensureSpace(need: number) {
    if (y - need < 50) newPage();
  }
  function text(s: string, x: number, font = reg, size = 10, color = INK) {
    page.drawText(s, { x, y, size, font, color });
  }
  function tableHeader(cols: { label: string; x: number; w: number; align?: "left" | "right" }[]) {
    ensureSpace(22);
    page.drawRectangle({ x: 40, y: y - 4, width: W - 80, height: 18, color: rgb(0.96, 0.96, 0.97) });
    cols.forEach((c) => {
      const tx = c.align === "right"
        ? c.x + c.w - bold.widthOfTextAtSize(c.label, 9) - 6
        : c.x + 6;
      page.drawText(c.label, { x: tx, y: y + 1, size: 9, font: bold, color: SOFT });
    });
    y -= 18;
  }
  function tableRow(cols: { val: string; x: number; w: number; align?: "left" | "right"; bold?: boolean }[]) {
    ensureSpace(16);
    cols.forEach((c) => {
      const f = c.bold ? bold : reg;
      const tx = c.align === "right"
        ? c.x + c.w - f.widthOfTextAtSize(c.val, 9) - 6
        : c.x + 6;
      page.drawText(c.val, { x: tx, y: y, size: 9, font: f, color: INK });
    });
    y -= 14;
    page.drawLine({ start: { x: 40, y }, end: { x: W - 40, y }, thickness: 0.3, color: rgb(0.9, 0.9, 0.9) });
    y -= 2;
  }

  // Title block
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: NAVY });
  page.drawText(cname, { x: 40, y: H - 38, size: 18, font: bold, color: GOLD });
  page.drawText(`Payroll report · ${p.period === "weekly" ? "weekly" : "monthly"} bucketing · generated ${today}`,
    { x: 40, y: H - 58, size: 10, font: reg, color: rgb(0.7, 0.78, 0.86) });
  y = H - 100;

  // YTD tile row
  page.drawRectangle({ x: 40, y: y - 70, width: W - 80, height: 70, color: rgb(0.984, 0.980, 0.965),
    borderColor: rgb(0.93, 0.85, 0.55), borderWidth: 0.8 });
  page.drawText(`Year to date — ${p.currentYear}`,
    { x: 56, y: y - 22, size: 11, font: bold, color: NAVY });
  const tile = [
    ["Gross",  `${ccy} ${fmt(p.ytd.gross)}`],
    ["Tax",    `${ccy} ${fmt(p.ytd.tax)}`],
    ["Nasfund", `${ccy} ${fmt(p.ytd.nasfund)}`],
    ["Net",    `${ccy} ${fmt(p.ytd.net)}`],
    [p.period === "weekly" ? "Weeks" : "Months", String(p.ytd.periods)],
  ];
  const tileW = (W - 80 - 32) / tile.length;
  tile.forEach((t, i) => {
    const tx = 56 + i * tileW;
    page.drawText(t[0], { x: tx, y: y - 42, size: 9, font: reg, color: MUTED });
    page.drawText(t[1], { x: tx, y: y - 58, size: 12, font: bold, color: INK });
  });
  y -= 90;

  // Section 1 — bucketed summary
  ensureSpace(40);
  page.drawText(p.period === "weekly" ? "Weekly summary" : "Monthly summary",
    { x: 40, y: y, size: 13, font: bold, color: INK });
  y -= 18;
  const sCols = [
    { label: "Bucket",  x: 40,  w: 80, align: "left" as const },
    { label: "Emp.",    x: 120, w: 50, align: "right" as const },
    { label: "Gross",   x: 170, w: 80, align: "right" as const },
    { label: "Tax",     x: 250, w: 80, align: "right" as const },
    { label: "Nasfund", x: 330, w: 80, align: "right" as const },
    { label: "Other",   x: 410, w: 70, align: "right" as const },
    { label: "Net",     x: 480, w: 80, align: "right" as const },
  ];
  tableHeader(sCols);
  for (const r of p.summary) {
    tableRow([
      { val: r.bucket || "—", x: 40, w: 80, align: "left" },
      { val: String(r.n_emp), x: 120, w: 50, align: "right" },
      { val: fmt(r.gross), x: 170, w: 80, align: "right" },
      { val: fmt(r.tax), x: 250, w: 80, align: "right" },
      { val: fmt(r.nasfund), x: 330, w: 80, align: "right" },
      { val: fmt(r.other), x: 410, w: 70, align: "right" },
      { val: fmt(r.net), x: 480, w: 80, align: "right", bold: true },
    ]);
  }

  // Section 2 — by department
  y -= 14;
  ensureSpace(40);
  page.drawText("By department (all-time)", { x: 40, y: y, size: 13, font: bold, color: INK });
  y -= 18;
  const dCols = [
    { label: "Department", x: 40,  w: 240, align: "left" as const },
    { label: "Entries",    x: 280, w: 70,  align: "right" as const },
    { label: "Gross",      x: 350, w: 100, align: "right" as const },
    { label: "Net",        x: 450, w: 110, align: "right" as const },
  ];
  tableHeader(dCols);
  for (const r of p.byDept) {
    tableRow([
      { val: r.dept || "—", x: 40, w: 240, align: "left" },
      { val: String(r.n), x: 280, w: 70, align: "right" },
      { val: fmt(r.gross), x: 350, w: 100, align: "right" },
      { val: fmt(r.net), x: 450, w: 110, align: "right", bold: true },
    ]);
  }

  // Section 3 — top employees
  y -= 14;
  ensureSpace(40);
  page.drawText("Top 25 employees by gross", { x: 40, y: y, size: 13, font: bold, color: INK });
  y -= 18;
  const eCols = [
    { label: "Employee", x: 40,  w: 260, align: "left" as const },
    { label: "Periods",  x: 300, w: 70,  align: "right" as const },
    { label: "Gross",    x: 370, w: 90,  align: "right" as const },
    { label: "Net",      x: 460, w: 100, align: "right" as const },
  ];
  tableHeader(eCols);
  for (const r of p.byEmployee) {
    tableRow([
      { val: r.name || "—", x: 40, w: 260, align: "left" },
      { val: String(r.n), x: 300, w: 70, align: "right" },
      { val: fmt(r.gross), x: 370, w: 90, align: "right" },
      { val: fmt(r.net), x: 460, w: 100, align: "right", bold: true },
    ]);
  }

  // Section 4 — master shares (only if any)
  if (p.shares?.length) {
    y -= 14;
    ensureSpace(40);
    page.drawText("Master-user payroll shares", { x: 40, y: y, size: 13, font: bold, color: INK });
    y -= 18;
    const mCols = [
      { label: "Recipient", x: 40, w: 280, align: "left" as const },
      { label: "%",         x: 320, w: 80, align: "right" as const },
      { label: "Lifetime share", x: 400, w: 160, align: "right" as const },
    ];
    tableHeader(mCols);
    for (const r of p.shares) {
      tableRow([
        { val: r.name, x: 40, w: 280, align: "left" },
        { val: `${r.pct}%`, x: 320, w: 80, align: "right" },
        { val: fmt(r.lifetime), x: 400, w: 160, align: "right", bold: true },
      ]);
    }
  }

  // Footer note on the last page
  ensureSpace(40);
  y -= 4;
  page.drawText(`Generated by TeebeePay · ${today} · Lifetime gross: ${ccy} ${fmt(p.totalGross)}`,
    { x: 40, y: 30, size: 9, font: reg, color: MUTED });

  const bytes = await pdf.save();
  return Buffer.from(bytes);
}

function fmt(n: any): string {
  return Number(n || 0).toLocaleString("en-PG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
