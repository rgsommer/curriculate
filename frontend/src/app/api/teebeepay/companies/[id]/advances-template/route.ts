// GET → XLSX template for importing staff-advance balances, pre-filled with the
// company's active employees and any balance/repayment already on file.
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { readAuth, db, ObjectId } from "../../../_auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  let cid: any;
  try { cid = new ObjectId(id); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }

  try {
    const dbi = await db();
    const company: any = await dbi.collection("companies").findOne({ _id: cid });
    const emps: any[] = await dbi.collection("employees").find({ company_id: cid, is_active: { $ne: 0 } })
      .sort({ last_name: 1, first_name: 1 }).toArray();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Advances");
    ws.columns = [
      { header: "last_name", key: "last_name", width: 22 },
      { header: "first_name", key: "first_name", width: 18 },
      { header: "balance", key: "balance", width: 14 },
      { header: "per_period", key: "per_period", width: 14 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const e of emps) {
      ws.addRow({
        last_name: e.last_name || "", first_name: e.first_name || "",
        balance: e.loan_balance != null ? e.loan_balance : "",
        per_period: e.loan_repayment != null ? e.loan_repayment : "",
      });
    }

    const notes = wb.addWorksheet("Notes");
    notes.getColumn(1).width = 100;
    [
      `Staff advances — ${company?.name || "company"}`,
      "",
      "balance: the amount the employee still owes (outstanding advance/loan).",
      "per_period: how much to deduct each pay period (post-tax).",
      "Payroll deducts per_period each fortnight, capped at the balance, and counts the balance down. When it hits 0, deductions stop automatically.",
      "Leave a row blank (or balance 0) for staff with no advance. Employees are matched by last_name + first_name.",
    ].forEach((line) => notes.addRow([line]));

    const buf = await wb.xlsx.writeBuffer();
    const safe = String(company?.name || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Advances-${safe}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
