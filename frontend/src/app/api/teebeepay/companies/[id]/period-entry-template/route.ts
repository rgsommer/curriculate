// GET → an XLSX template for entering a pay period's hours, pre-filled with the
// company's active employees (last_name, first_name) + their default hours, plus
// blank cash_advance and note columns. Fill it in, then paste/upload it back into
// the New pay period screen.
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
    const emps: any[] = await dbi.collection("employees")
      .find({ company_id: cid, is_active: { $ne: 0 } })
      .sort({ last_name: 1, first_name: 1 }).toArray();

    // Optional ?period_end=YYYY-MM-DD prepends a period_end column pre-filled with
    // that date, so the same file can hold many periods (one block of rows per date).
    const periodEnd = new URL(req.url).searchParams.get("period_end") || "";

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Hours");
    ws.columns = [
      ...(periodEnd ? [{ header: "period_end", key: "period_end", width: 14 }] : []),
      { header: "last_name", key: "last_name", width: 22 },
      { header: "first_name", key: "first_name", width: 18 },
      { header: "hours", key: "hours", width: 10 },
      { header: "cash_advance", key: "cash_advance", width: 14 },
      { header: "note", key: "note", width: 40 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    const defHours = company?.default_hours ?? 80;
    for (const e of emps) {
      ws.addRow({
        ...(periodEnd ? { period_end: periodEnd } : {}),
        last_name: e.last_name || "", first_name: e.first_name || "",
        hours: e.default_hours ?? defHours, cash_advance: 0, note: "",
      });
    }
    if (!emps.length) ws.addRow({ last_name: "(no active employees)", first_name: "", hours: "", cash_advance: "", note: "" });

    const notes = wb.addWorksheet("Notes");
    notes.getColumn(1).width = 100;
    [
      `Pay-period hours — ${company?.name || "company"}`,
      "",
      "last_name + first_name identify the employee — keep them exactly as listed (they're matched by name).",
      "hours: worked hours for this period (default is pre-filled — adjust the exceptions).",
      "cash_advance: any advance to deduct this period (leave 0 if none).",
      "note: optional, appears on the employee's pay stub.",
      "When done: in the New pay period screen, use 'Fill from spreadsheet' — paste the cells (copy from Excel) or upload this saved as CSV.",
      "",
      "One file, many periods: keep a 'period_end' column (YYYY-MM-DD) and add a fresh block of rows each fortnight in the SAME file. On import only the rows matching the period you're creating are used — so you reuse one master file all year.",
    ].forEach((line) => notes.addRow([line]));

    const buf = await wb.xlsx.writeBuffer();
    const safe = String(company?.name || "company").replace(/[^A-Za-z0-9_-]+/g, "_");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Period-hours-${safe}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
