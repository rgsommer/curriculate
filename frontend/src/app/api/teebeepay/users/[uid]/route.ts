// PATCH a user (role / company / is_active). DELETE marks inactive.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId, ROLE_CLEARANCE, clearanceOf } from "../../_auth";

export async function PATCH(req: Request, { params }: { params: Promise<{ uid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { uid } = await params;
  const b = await req.json().catch(() => ({} as any));
  const $set: any = { updated_at: new Date() };

  if ("role" in b) {
    if (!ROLE_CLEARANCE.hasOwnProperty(b.role)) return NextResponse.json({ error: "Unknown role." }, { status: 400 });
    if (clearanceOf(b.role) >= u.clearance && u.clearance < 4) {
      return NextResponse.json({ error: "Can't promote to your own level or above." }, { status: 403 });
    }
    $set.role = b.role;
  }
  if ("is_active" in b) $set.is_active = b.is_active ? 1 : 0;
  if ("company_id" in b) $set.company_id = b.company_id ? new ObjectId(b.company_id) : null;

  try {
    const dbi = await db();
    const target = await dbi.collection("users").findOne({ _id: new ObjectId(uid) });
    if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (clearanceOf(target.role) > u.clearance) {
      return NextResponse.json({ error: "Cannot modify a user above your clearance." }, { status: 403 });
    }
    await dbi.collection("users").updateOne({ _id: new ObjectId(uid) }, { $set });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
