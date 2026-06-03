// GET → a blank "PNGPay Bulk Employees" XLSX template with all the headers the
// importer recognises, a sample row, and a notes sheet. Any signed-in user.
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readAuth } from "../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Order mirrors the import help text. allowance_* is a wildcard — two examples
// are shown so the pattern is clear.
const HEADERS = [
  "fname", "lname", "account_name", "bank_code", "branch_code", "bank_account",
  "position", "department", "dob", "datestarted", "annual_price", "hour_price",
  "hours", "fte", "email", "phone", "dependents", "nas", "meals", "school_fees",
  "leave_fares", "allowance_housing", "allowance_transport", "vol_salary",
  "vol_ncsl", "residency_status", "declaration", "status", "notes",
];
const REQUIRED = new Set(["fname", "lname"]);

const SAMPLE: Record<string, string> = {
  fname: "Mary", lname: "Kila", account_name: "Mary Kila", bank_code: "BSP",
  branch_code: "018", bank_account: "1000123456", position: "Administrator",
  department: "Admin", dob: "1992-04-15", datestarted: "2023-01-10",
  annual_price: "32000", hour_price: "", hours: "", fte: "1",
  email: "mary.kila@example.com", phone: "+675 7000 0000", dependents: "2",
  nas: "Y", meals: "0", school_fees: "0", leave_fares: "0",
  allowance_housing: "200", allowance_transport: "50", vol_salary: "0",
  vol_ncsl: "0", residency_status: "resident", declaration: "Y",
  status: "active", notes: "",
};

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Employees");
  ws.columns = HEADERS.map((h) => ({ header: h, key: h, width: Math.max(12, h.length + 2) }));

  const header = ws.getRow(1);
  header.font = { bold: true };
  HEADERS.forEach((h, i) => {
    if (REQUIRED.has(h)) header.getCell(i + 1).font = { bold: true, color: { argb: "FFB91C1C" } };
  });
  header.commit();
  ws.addRow(SAMPLE);
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const notes = wb.addWorksheet("Notes");
  notes.getColumn(1).width = 100;
  [
    "PNGPay — Bulk Employees import template",
    "",
    "Required columns: fname, lname (shown in red). Everything else is optional.",
    "Row 2 is a sample — replace it with your employees, or delete it.",
    "Dates use YYYY-MM-DD (e.g. 2023-01-10).",
    "annual_price = annual salary; hour_price + hours for hourly staff; fte = full-time equivalent (1 = full time).",
    "allowance_* — add as many columns as you need, each starting with 'allowance_' (e.g. allowance_housing, allowance_transport).",
    "nas / declaration: Y or N. residency_status: resident / non_resident. status: active / inactive.",
    "Duplicates (matching first + last name) are skipped on import.",
    "Save as CSV or XLSX, then paste the contents or upload the file in the import dialog.",
  ].forEach((line) => notes.addRow([line]));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="PNGPay-Bulk-Employees-template.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
