// POST a base64-encoded image to set the AP (Authorised Person) signature
// for a company. Stored on company doc; embedded into NASFund returns.
//
// Body: { name: "Theresia Bob", title: "Principal", image: "data:image/png;base64,..." }
//
// We store the image inline (base64) on the company doc. PNG/JPEG only,
// max ~500 KB after decode.
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../_auth";

const MAX_BYTES = 500 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const b = await req.json().catch(() => ({} as any));
  const m = String(b.image || "").match(/^data:(image\/(png|jpeg|jpg));base64,(.+)$/);
  if (!m) return NextResponse.json({ error: "Image must be a PNG or JPEG data URL." }, { status: 400 });
  const mime = m[1];
  const data = m[3];
  const bytes = Buffer.byteLength(data, "base64");
  if (bytes > MAX_BYTES) {
    return NextResponse.json({ error: `Image is too large (${Math.round(bytes/1024)} KB; max 500 KB).` }, { status: 413 });
  }

  try {
    const dbi = await db();
    await dbi.collection("companies").updateOne({ _id: new ObjectId(id) }, {
      $set: {
        ap_signature_image: data,
        ap_signature_mime: mime,
        ap_signature_name: String(b.name || "").trim() || null,
        ap_signature_title: String(b.title || "").trim() || null,
        ap_signature_updated_at: new Date(),
      },
    });
    return NextResponse.json({ ok: true, bytes });
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
      $unset: {
        ap_signature_image: "", ap_signature_mime: "",
        ap_signature_name: "", ap_signature_title: "",
        ap_signature_updated_at: "",
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
