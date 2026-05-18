// PATCH / DELETE a single division.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; did: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, did } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };
  if ("name" in b) {
    const v = String(b.name || "").trim().slice(0, 80);
    if (!v) return NextResponse.json({ error: "Division name cannot be blank." }, { status: 400 });
    $set.name = v;
  }
  if ("supervisor_employee_id" in b) {
    $set.supervisor_employee_id = b.supervisor_employee_id ? new ObjectId(String(b.supervisor_employee_id)) : null;
  }
  if ("supervisor_submits_hours" in b) {
    $set.supervisor_submits_hours = !!b.supervisor_submits_hours;
  }
  if ("default_hours" in b) {
    $set.default_hours = b.default_hours != null && b.default_hours !== "" ? Number(b.default_hours) : null;
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  try {
    const dbi = await db();
    await dbi.collection("divisions").updateOne(
      { _id: new ObjectId(did), company_id: new ObjectId(id) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; did: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, did } = await params;
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const cid = new ObjectId(id), dId = new ObjectId(did);
    // Refuse if any employee still belongs to it.
    const n = await dbi.collection("employees").countDocuments({ company_id: cid, division_id: dId });
    if (n > 0) {
      return NextResponse.json({
        error: `${n} employee(s) still in this division. Move or unassign them first.`,
      }, { status: 409 });
    }
    await dbi.collection("divisions").deleteOne({ _id: dId, company_id: cid });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
