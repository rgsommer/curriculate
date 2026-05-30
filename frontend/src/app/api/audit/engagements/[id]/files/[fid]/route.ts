// GET → download a single audit file (streams from GridFS).
// DELETE → remove a file (Principal+ or the audit_client who uploaded it).
import { NextResponse } from "next/server";
import { GridFSBucket } from "mongodb";
import { readAuth, db, ObjectId } from "../../../../../teebeepay/_auth";

async function canAccess(dbi: any, u: any, engagementId: string): Promise<boolean> {
  if (u.clearance >= 3) return true;
  const userRow: any = await dbi.collection("users").findOne({ email: u.email });
  if (!userRow?.audit_engagements?.length) return false;
  return userRow.audit_engagements.some((e: any) => e.toString() === engagementId);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, fid } = await params;
  try {
    const dbi = await db();
    if (!(await canAccess(dbi, u, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const f: any = await dbi.collection("audit_files.files").findOne({ _id: new ObjectId(fid) });
    if (!f || f.metadata?.engagement_id?.toString() !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const bucket = new GridFSBucket(dbi as any, { bucketName: "audit_files" });
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
      headers: {
        "Content-Type": f.metadata?.mime || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${f.filename}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; fid: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id, fid } = await params;
  try {
    const dbi = await db();
    if (!(await canAccess(dbi, u, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const f: any = await dbi.collection("audit_files.files").findOne({ _id: new ObjectId(fid) });
    if (!f || f.metadata?.engagement_id?.toString() !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (u.clearance < 3 && f.metadata?.uploaded_by !== u.email) {
      return NextResponse.json({ error: "Only the uploader or your auditor can delete this file." }, { status: 403 });
    }
    const bucket = new GridFSBucket(dbi as any, { bucketName: "audit_files" });
    await bucket.delete(new ObjectId(fid));
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
