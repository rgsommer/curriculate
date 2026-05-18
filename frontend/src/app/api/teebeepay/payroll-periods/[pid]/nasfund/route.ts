// GET → NASFund return as XLSX for a pay period.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";
import { buildNasfundXlsx } from "../../../_nasfund";

export async function GET(req: Request, { params }: { params: Promise<{ pid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { pid } = await params;
  try {
    const dbi = await db();
    const p: any = await dbi.collection("pay_periods").findOne({ _id: new ObjectId(pid) });
    if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (u.clearance < 3 && u.company_id !== p.company_id.toString()) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const co: any = await dbi.collection("companies").findOne({ _id: p.company_id });
    const entries: any[] = await dbi.collection("payroll_entries").find({ pay_period_id: p._id }).toArray();
    const emps: any[] = await dbi.collection("employees").find({ _id: { $in: entries.map((e) => e.employee_id) } }).toArray();
    const empMap = Object.fromEntries(emps.map((e) => [e._id.toString(), e]));

    const rows = entries.map((e: any) => ({
      employee: empMap[e.employee_id.toString()] || {},
      gross: e.gross || 0,
      nasfund: e.nasfund || 0,
      nasfund_employer: e.calc_breakdown?.nasfund_employer ?? (e.gross || 0) * 0.084,
    }));
    const periodLabel = `${(p.period_start || "").replaceAll("-", "")}-${(p.period_end || "").replaceAll("-", "")}`;
    const buf = buildNasfundXlsx(co, periodLabel, rows);
    const abbr = (co.abbreviation || co.name || "company").replace(/\W+/g, "_");
    const filename = `NASFund-${abbr}-${(p.period_end || p.pay_date || "").replace(/-/g, "")}.xlsx`;
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    console.error("[teebeepay/nasfund] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
