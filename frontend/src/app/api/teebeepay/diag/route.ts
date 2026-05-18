// frontend/src/app/api/teebeepay/_diag/route.ts
// Diagnostic — only system_owner can hit it. Reports which cluster +
// database the live serverless function is connecting to, and counts.
import { NextResponse } from "next/server";
import { readAuth, db, mongoPromise } from "../_auth";

export async function GET(req: Request) {
  const u = readAuth(req);
  if (!u || u.clearance < 4) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const counts: Record<string, number> = {};
    for (const c of ["users", "companies", "employees", "pay_periods", "payroll_entries", "leads", "tba_inquiries"]) {
      counts[c] = await dbi.collection(c).countDocuments();
    }
    const client = await mongoPromise()!;
    const info = await client.db().admin().listDatabases();
    return NextResponse.json({
      dbName: dbi.databaseName,
      cluster: (process.env.MONGO_URI || process.env.MONGODB_URI || "")
        .replace(/mongodb\+srv:\/\/[^@]+@/, "mongodb+srv://****@"),
      databases_on_cluster: info.databases.map((d: any) => d.name),
      counts,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Diagnostic failed" }, { status: 500 });
  }
}
