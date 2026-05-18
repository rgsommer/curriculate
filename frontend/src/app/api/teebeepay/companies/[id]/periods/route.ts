// frontend/src/app/api/teebeepay/companies/[id]/periods/route.ts
// GET → recent pay periods for one company.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const cid = new ObjectId(id);
    if (u.clearance < 3 && u.company_id !== id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const dbi = await db();
    const rows = await dbi.collection("pay_periods")
      .find({ company_id: cid })
      .sort({ period_end: -1, period_start: -1 })
      .limit(60)
      .toArray();
    const result = await Promise.all(rows.map(async (p: any) => {
      const nEntries = await dbi.collection("payroll_entries").countDocuments({ pay_period_id: p._id });
      return {
        id: p._id.toString(),
        period_start: p.period_start,
        period_end: p.period_end,
        pay_date: p.pay_date,
        status: p.status || "draft",
        total_net_imported: p.total_net_imported || null,
        total_gross: p.total_gross || null,
        n_entries: nEntries,
        imported_from_history: !!p.imported_from,
      };
    }));
    return NextResponse.json({ periods: result });
  } catch (e: any) {
    console.error("[teebeepay/periods] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
