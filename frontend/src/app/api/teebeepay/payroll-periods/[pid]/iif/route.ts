// GET → QuickBooks IIF download for a pay period.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";
import { buildIif } from "../../../_iif";

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
    const iif = buildIif(co, p, entries);
    const abbr = (co.abbreviation || co.name || "company").replace(/\W+/g, "_");
    const filename = `Payroll-${abbr}-${(p.pay_date || p.period_end || "").replace(/-/g, "")}_QB_IIF.iif`;
    return new NextResponse(iif, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    console.error("[teebeepay/iif] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
