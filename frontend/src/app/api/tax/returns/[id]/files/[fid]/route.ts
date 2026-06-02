// GET → download a tax supporting document; DELETE → remove it (Principal+).
import { NextResponse } from "next/server";
import { GridFSBucket } from "mongodb";
import { readAuth, db, ObjectId } from "../../../../../teebeepay/_auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, fid } = await params;
  try {
    const dbi = await db();
    const f: any = await dbi.collection("tax_files.files").findOne({ _id: new ObjectId(fid) });
    if (!f || f.metadata?.return_id?.toString() !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const bucket = new GridFSBucket(dbi as any, { bucketName: "tax_files" });
    const chunks: Uint8Array[] = [];
    await new Promise<void>((resolve, reject) => {
      const s = bucket.openDownloadStream(new ObjectId(fid));
      s.on("data", (c: Buffer) => chunks.push(c));
      s.on("end", () => resolve());
      s.on("error", reject);
    });
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Uint8Array(total);
    let off = 0; for (const c of chunks) { merged.set(c, off); off += c.length; }
    return new NextResponse(merged, {
      status: 200,
      headers: { "Content-Type": f.metadata?.mime || "application/octet-stream", "Content-Disposition": `attachment; filename="${f.filename}"`, "Cache-Control": "private, max-age=0, must-revalidate" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, fid } = await params;
  try {
    const dbi = await db();
    const f: any = await dbi.collection("tax_files.files").findOne({ _id: new ObjectId(fid) });
    if (!f || f.metadata?.return_id?.toString() !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const bucket = new GridFSBucket(dbi as any, { bucketName: "tax_files" });
    await bucket.delete(new ObjectId(fid));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
