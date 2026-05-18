// GET → aggregated reports for one company.
//   ?period=weekly | monthly  (default monthly)
//   ?from=YYYY-MM-DD          (optional lower bound on pay_date)
//   ?to=YYYY-MM-DD            (optional upper bound on pay_date)
//
// Returns:
//   summary       — { bucket, gross, tax, nasfund, other, net, n_emp } per bucket
//   byDepartment  — { dept, gross, net, n_entries } per department
//   byEmployee    — top 25 by total gross
//   shares        — payroll_share_pct earners and their estimated cumulative share
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const period = url.searchParams.get("period") === "weekly" ? "weekly" : "monthly";
  const dateFmt = period === "weekly" ? "%G-W%V" : "%Y-%m";

  try {
    const dbi = await db();
    const cid = new ObjectId(id);

    // Bucketed summary
    const match: any = { "p.company_id": cid };
    const summary = await dbi.collection("payroll_entries").aggregate([
      { $lookup: { from: "pay_periods", localField: "pay_period_id", foreignField: "_id", as: "p" } },
      { $unwind: "$p" },
      { $match: match },
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

    return NextResponse.json({ summary, byDept, byEmployee, shares: shareRows, totalGross });
  } catch (e: any) {
    console.error("[teebeepay/reports] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
