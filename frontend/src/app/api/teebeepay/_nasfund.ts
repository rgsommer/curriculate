// frontend/src/app/api/teebeepay/_nasfund.ts
//
// NASFund monthly contribution return as XLSX, with optional AP signature
// image embedded in the bottom-right corner. Built with exceljs (supports
// native image insertion, unlike SheetJS).
import ExcelJS from "exceljs";

export async function buildNasfundXlsx(company: any, periodLabel: string, rows: any[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "TeebeePay";
  wb.created = new Date();
  const ws = wb.addWorksheet("NASFund Contribution");

  // Column widths
  ws.columns = [
    { header: "", width: 4 },
    { header: "Member Number", width: 16 },
    { header: "Payroll #", width: 10 },
    { header: "Surname", width: 18 },
    { header: "Given Name(s)", width: 18 },
    { header: "Date of Birth", width: 12 },
    { header: "Gross Pay", width: 12 },
    { header: "Employee 6%", width: 12 },
    { header: "Employer 8.4%", width: 13 },
    { header: "Total", width: 12 },
    { header: "Education", width: 11 },
    { header: "General Savings", width: 14 },
    { header: "Christmas", width: 11 },
    { header: "Loan", width: 10 },
    { header: "Status", width: 12 },
  ];

  // Header band rows (matching the legacy format observed in the archive)
  ws.addRow(["00", "Employer Name", "Employer Number", "Date of Reg", "Bank Statement Reference"]);
  ws.addRow(["01",
    company.name || "",
    company.ncsl_employer_no || "",
    company.ncsl_date_of_reg || "",
    `${company.bank_account_no || ""}/${periodLabel}`,
  ]);
  ws.addRow([]);
  const colHeader = ws.addRow([
    "02", "Client Number", "Payroll #", "Surname", "Given Name(s)", "Date of birth",
    "Gross Pay", "Employee 6%", "Employer 8.4%", "Total",
    "Education", "General Savings", "Christmas", "Loan", "Status",
  ]);
  colHeader.eachCell((cell: any) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFAFBFC" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE5E7EB" } } };
  });

  // Data rows
  const totals = { gross: 0, emp: 0, empr: 0, tot: 0 };
  rows.forEach((r, i) => {
    const emp = r.employee || {};
    const gross = Number(r.gross || 0);
    const emp6  = Number(r.nasfund || gross * 0.06);
    const emp84 = Number(r.nasfund_employer || gross * 0.084);
    const total = emp6 + emp84;
    totals.gross += gross; totals.emp += emp6; totals.empr += emp84; totals.tot += total;
    ws.addRow([
      "03",
      emp.nasfund_member_no || emp.ncsl_member_no || "",
      String(i + 1),
      emp.last_name || "",
      emp.first_name || "",
      emp.dob || "",
      gross.toFixed(2),
      emp6.toFixed(2),
      emp84.toFixed(2),
      total.toFixed(2),
      Number(emp.education_deduction || 0).toFixed(2),
      Number(emp.savings_deduction || 0).toFixed(2),
      Number(emp.christmas_bonus || 0).toFixed(2),
      Number(emp.loan_repayment || 0).toFixed(2),
      emp.is_active === 0 ? "TERMINATED" : "ACTIVE",
    ]);
  });

  ws.addRow([]);
  const totalRow = ws.addRow([
    "99", "", "", "TOTALS", "", "",
    totals.gross.toFixed(2), totals.emp.toFixed(2), totals.empr.toFixed(2), totals.tot.toFixed(2),
    "", "", "", "", "",
  ]);
  totalRow.eachCell((cell: any) => { cell.font = { bold: true }; });

  // AP signature section
  ws.addRow([]);
  ws.addRow([]);
  const apRow = ws.addRow(["", "", "", "Authorised by:"]);
  apRow.getCell(4).font = { bold: true };
  if (company.ap_signature_name) {
    ws.addRow(["", "", "", company.ap_signature_name]);
  }
  if (company.ap_signature_title) {
    const titleRow = ws.addRow(["", "", "", company.ap_signature_title]);
    titleRow.getCell(4).font = { italic: true, color: { argb: "FF666666" } };
  }

  // Embed signature image if present
  if (company.ap_signature_image && company.ap_signature_mime) {
    try {
      const ext = (company.ap_signature_mime.includes("png") ? "png" : "jpeg") as "png" | "jpeg";
      const imageId = wb.addImage({
        buffer: Buffer.from(company.ap_signature_image, "base64") as any,
        extension: ext,
      });
      const targetRow = apRow.number;
      // exceljs's Anchor type expects extra nativeCol/nativeRow fields it never
      // actually uses; cast through `any` so this compiles in strict TS.
      ws.addImage(imageId, {
        tl: { col: 6, row: targetRow - 1 } as any,
        br: { col: 9, row: targetRow + 4 } as any,
      });
    } catch (e) {
      console.warn("[nasfund] signature embed failed:", e);
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
