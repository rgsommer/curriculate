// GET → recent-period baseline used by the new-period anomaly banner.
// Returns the median + IQR-style bounds of total gross + headcount across
// the most-recent approved/historical pay periods (up to 6).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    const dbi = await db();
    const cid = new ObjectId(id);

    const periods: any[] = await dbi.collection("pay_periods")
      .find({ company_id: cid })
      .sort({ pay_date: -1, period_end: -1, _id: -1 })
      .limit(12).toArray();

    // Aggregate gross + headcount per period
    const samples = [];
    for (const p of periods.slice(0, 6)) {
      const agg = await dbi.collection("payroll_entries").aggregate([
        { $match: { pay_period_id: p._id } },
        { $group: { _id: null,
            gross: { $sum: { $ifNull: ["$gross", 0] } },
            net:   { $sum: { $ifNull: ["$net", 0] } },
            n: { $sum: 1 },
            employees: { $addToSet: "$employee_id" },
        } },
      ]).toArray();
      const a = agg[0] || { gross: 0, net: 0, n: 0, employees: [] };
      samples.push({
        period_id: p._id.toString(),
        pay_date: p.pay_date,
        gross: Number(a.gross) || 0,
        net: Number(a.net) || 0,
        headcount: a.employees ? a.employees.length : a.n,
      });
    }

    const grossVals = samples.map((s) => s.gross).filter((v) => v > 0);
    const headVals  = samples.map((s) => s.headcount).filter((v) => v > 0);
    const netVals   = samples.map((s) => s.net).filter((v) => v > 0);

    return NextResponse.json({
      samples,
      baseline: {
        n_samples: samples.length,
        gross_median: median(grossVals),
        net_median: median(netVals),
        headcount_median: median(headVals),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
