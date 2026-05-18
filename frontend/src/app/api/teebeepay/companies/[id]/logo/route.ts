// POST { image: "data:image/png;base64,..." } — upload company logo
// (embedded into pay-stub emails). PNG or JPEG, max 300 KB.
// DELETE — remove logo.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

const MAX_BYTES = 300 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const b = await req.json().catch(() => ({} as any));
  const m = String(b.image || "").match(/^data:(image\/(png|jpeg|jpg|svg\+xml));base64,(.+)$/);
  if (!m) return NextResponse.json({ error: "Logo must be a PNG, JPEG, or SVG data URL." }, { status: 400 });
  const mime = m[1]; const data = m[3];
  if (Buffer.byteLength(data, "base64") > MAX_BYTES) {
    return NextResponse.json({ error: "Logo must be under 300 KB." }, { status: 413 });
  }

  try {
    const dbi = await db();
    await dbi.collection("companies").updateOne({ _id: new ObjectId(id) }, {
      $set: { logo_image: data, logo_mime: mime, logo_updated_at: new Date() },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    await dbi.collection("companies").updateOne({ _id: new ObjectId(id) }, {
      $unset: { logo_image: "", logo_mime: "", logo_updated_at: "" },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
