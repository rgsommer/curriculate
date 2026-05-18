// frontend/src/app/api/teebeepay/companies/route.ts
// GET → list of companies the authed user can see.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const dbi = await db();
    // clearance >= 3 (principal/system_owner) sees all companies
    // others see only their assigned company
    const query = u.clearance >= 3 ? {} : (u.company_id ? { _id: new ObjectId(u.company_id) } : { _id: null });
    const rows = await dbi.collection("companies").find(query).sort({ name: 1 }).toArray();

    // Per company, decorate with quick stats for the dashboard.
    const out = await Promise.all(rows.map(async (c: any) => {
      const [periods, employees] = await Promise.all([
        dbi.collection("pay_periods").countDocuments({ company_id: c._id }),
        dbi.collection("employees").countDocuments({ company_id: c._id, is_active: { $ne: 0 } }),
      ]);
      return {
        id: c._id.toString(),
        name: c.name,
        abbreviation: c.abbreviation || "",
        pay_interval: c.pay_interval || "fortnightly",
        is_active: c.is_active !== 0,
        periods, employees,
      };
    }));
    return NextResponse.json({ companies: out });
  } catch (e: any) {
    console.error("[teebeepay/companies] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
