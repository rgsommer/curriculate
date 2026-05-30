// GET → list findings for an engagement.
// PATCH /[fid] → update a single finding's severity/title/detail/status (admin only).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";

async function canRead(dbi: any, u: any, engagementId: string): Promise<boolean> {
  if (u.clearance >= 3) return true;
  const userRow: any = await dbi.collection("users").findOne({ email: u.email });
  return !!userRow?.audit_engagements?.some((e: any) => e.toString() === engagementId);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const dbi = await db();
    if (!(await canRead(dbi, u, id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // audit_clients only see findings the CPA has marked client_visible
    const filter: any = { engagement_id: new ObjectId(id) };
    if (u.clearance < 3) filter.client_visible = true;
    const rows: any[] = await dbi.collection("audit_findings").find(filter)
      .sort({ severity: 1, created_at: -1 }).toArray();
    return NextResponse.json({
      findings: rows.map((r: any) => ({
        id: r._id.toString(),
        code: r.code, severity: r.severity, title: r.title, detail: r.detail,
        source_file: r.source_file || null, evidence: r.evidence ?? null,
        auto: !!r.auto, status: r.status || "open",
        client_visible: !!r.client_visible,
        created_at: r.created_at,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
