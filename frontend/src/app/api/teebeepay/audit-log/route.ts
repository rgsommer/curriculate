// GET → recent audit-log entries for the caller's clearance scope.
//   bookkeeper+ can see entries (company-scoped if not system_owner).
//   system_owner sees everything.
//
// Query params:
//   ?company=ID    — filter by company
//   ?action=...    — exact match (e.g. "payroll.approve")
//   ?limit=200     — default 200, max 500
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);
  const companyParam = url.searchParams.get("company");
  const actionParam = url.searchParams.get("action");
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");

  const q: any = {};
  if (companyParam) q.company_id = new ObjectId(companyParam);
  if (u.clearance < 3) {
    // bookkeeper/site_payroll can only see their own company
    if (!u.company_id) return NextResponse.json({ entries: [] });
    q.company_id = new ObjectId(u.company_id);
  }
  if (actionParam) q.action = actionParam;
  if (fromParam || toParam) {
    q.ts = {};
    if (fromParam) q.ts.$gte = new Date(fromParam);
    if (toParam)   q.ts.$lte = new Date(toParam);
  }

  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("audit_log")
      .find(q).sort({ ts: -1 }).limit(limit).toArray();
    // Decorate with company name when possible
    const cids = [...new Set(rows.filter(r => r.company_id).map((r) => r.company_id.toString()))];
    const companies = cids.length
      ? await dbi.collection("companies").find({ _id: { $in: cids.map((s: any) => new ObjectId(s)) } }).toArray()
      : [];
    const cMap = Object.fromEntries(companies.map((c: any) => [c._id.toString(), c.name]));

    return NextResponse.json({
      entries: rows.map((r: any) => ({
        id: r._id.toString(),
        ts: r.ts,
        actor_email: r.actor_email,
        actor_kind: r.actor_kind || "user",
        action: r.action,
        resource_type: r.resource_type,
        resource_id: r.resource_id,
        company_id: r.company_id ? r.company_id.toString() : null,
        company_name: r.company_id ? cMap[r.company_id.toString()] : null,
        details: r.details || null,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
