// GET → active tax rules for a company; POST → save as a new version.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  try {
    const dbi = await db();
    const rows: any[] = await dbi.collection("tax_rules").find({ company_id: new ObjectId(id) })
      .sort({ effective_from: -1, _id: -1 }).limit(20).toArray();
    return NextResponse.json({
      versions: rows.map((r: any) => ({
        id: r._id.toString(),
        effective_from: r.effective_from,
        notes: r.notes || null,
        created_at: r.created_at,
      })),
      active: rows[0] ? {
        id: rows[0]._id.toString(),
        effective_from: rows[0].effective_from,
        notes: rows[0].notes || null,
        data: typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data,
      } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) {
    return NextResponse.json({ error: "Only a principal or system owner can edit tax rules." }, { status: 403 });
  }
  const { id } = await params;
  const b = await req.json().catch(() => ({} as any));
  if (!b.data || typeof b.data !== "object") {
    return NextResponse.json({ error: "Body must include a 'data' object with the new rules." }, { status: 400 });
  }
  try {
    const dbi = await db();
    const r = await dbi.collection("tax_rules").insertOne({
      company_id: new ObjectId(id),
      effective_from: b.effective_from || new Date().toISOString().slice(0, 10),
      data: b.data,
      notes: b.notes || `Edited by ${u.email}`,
      created_at: new Date(),
      created_by: u.email,
    });
    return NextResponse.json({ ok: true, id: r.insertedId.toString() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
