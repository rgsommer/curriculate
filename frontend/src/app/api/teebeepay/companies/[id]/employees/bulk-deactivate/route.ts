// POST { employee_ids: [string] } → marks each employee inactive.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const ids = Array.isArray(b.employee_ids) ? b.employee_ids : [];
  if (!ids.length) return NextResponse.json({ error: "No employees selected." }, { status: 400 });

  try {
    const dbi = await db();
    const objIds = ids.map((x: string) => new ObjectId(x));
    const r = await dbi.collection("employees").updateMany(
      {
        _id: { $in: objIds },
        company_id: new ObjectId(id),
        $or: [{ clearance_level: { $lt: u.clearance } }, { clearance_level: { $exists: false } }],
      },
      { $set: { is_active: 0, end_date: new Date().toISOString().slice(0, 10), updated_at: new Date() } }
    );
    return NextResponse.json({ ok: true, modified: r.modifiedCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
