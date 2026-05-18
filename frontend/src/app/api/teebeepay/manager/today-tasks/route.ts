// GET → aggregated "what needs your attention today" data for bookkeepers
// and principals. The frontend renders this as a "Steps for today" checklist
// on the dashboard.
//
// Returns counts of:
//   - companies with supervisor submissions still pending
//   - pay periods awaiting approval
//   - approved periods that haven't had pay-stubs emailed
//   - NASFund returns due in the next 7 days
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();

    // Companies in scope. For bookkeeper-clearance users this is their own
    // company; for principals/owners it's everything.
    const companyFilter: any = u.clearance >= 3
      ? { $or: [{ is_active: 1 }, { is_active: { $exists: false } }] }
      : { _id: new ObjectId(u.company_id || "000000000000000000000000") };
    const companies: any[] = await dbi.collection("companies").find(companyFilter).toArray();
    const companyIds = companies.map((c) => c._id);
    const cMap = Object.fromEntries(companies.map((c: any) => [c._id.toString(), c]));

    // 1. Supervisor submissions still pending — divisions with at least one
    //    employee whose pending_hours_at is not within the last 6 days.
    const divisions: any[] = await dbi.collection("divisions").find({
      company_id: { $in: companyIds }, supervisor_submits_hours: true,
      $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
    }).toArray();
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    let supervisorPendingDivisions = 0;
    const supervisorPendingByCompany: Record<string, number> = {};
    for (const d of divisions) {
      const emps: any[] = await dbi.collection("employees").find({
        company_id: d.company_id, division_id: d._id,
        $or: [{ is_active: 1 }, { is_active: { $exists: false } }],
      }).toArray();
      if (!emps.length) continue;
      const allIn = emps.every((e: any) => e.pending_hours_at && new Date(e.pending_hours_at) >= sixDaysAgo);
      if (!allIn) {
        supervisorPendingDivisions++;
        const ck = d.company_id.toString();
        supervisorPendingByCompany[ck] = (supervisorPendingByCompany[ck] || 0) + 1;
      }
    }

    // 2. Periods awaiting approval
    const pendingApproval: any[] = await dbi.collection("pay_periods").find({
      company_id: { $in: companyIds }, status: "pending_approval",
    }).sort({ created_at: -1 }).limit(20).toArray();

    // 3. Approved periods (status "approved") with no payslip_sent_at flag
    //    Treat any approved period as "needs stubs sent" if the stubs_emailed_at
    //    field is unset; this is best-effort because not every install marks it.
    const approvedNoStubs: any[] = await dbi.collection("pay_periods").find({
      company_id: { $in: companyIds }, status: "approved",
      stubs_emailed_at: { $exists: false },
    }).sort({ updated_at: -1 }).limit(20).toArray();

    // 4. NASFund deadlines this week. NCSL contributions are due by the 21st of
    //    each month for the prior month's payroll.
    const now = new Date();
    const inSeven = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const next21 = (() => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 21));
      if (now.getUTCDate() > 21) d.setUTCMonth(d.getUTCMonth() + 1);
      return d;
    })();
    const nasfundDueSoon = next21 <= inSeven;

    return NextResponse.json({
      supervisor_pending_divisions: supervisorPendingDivisions,
      supervisor_pending_by_company: Object.fromEntries(
        Object.entries(supervisorPendingByCompany).map(([k, v]) => [cMap[k]?.name || k, v])),
      pending_approval: pendingApproval.map((p: any) => ({
        id: p._id.toString(),
        company_id: p.company_id.toString(),
        company_name: cMap[p.company_id.toString()]?.name || "",
        period_start: p.period_start, period_end: p.period_end, pay_date: p.pay_date,
        submitted_at: p.submitted_at || p.created_at,
      })),
      approved_no_stubs: approvedNoStubs.map((p: any) => ({
        id: p._id.toString(),
        company_id: p.company_id.toString(),
        company_name: cMap[p.company_id.toString()]?.name || "",
        period_end: p.period_end, pay_date: p.pay_date,
      })),
      nasfund_deadline: nasfundDueSoon ? next21.toISOString().slice(0, 10) : null,
    });
  } catch (e: any) {
    console.error("[teebeepay/manager/today-tasks] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
