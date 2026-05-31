// POST → issue a draft invoice (posts the sale to the GL). Bookkeeper+.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../../../../../_auth";
import { issueInvoice } from "../../../../../../_ar";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string; invId: string }> }) {
  const u = readAuth(req);
  const { id, invId } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const dbi = await db();
    const { entry } = await issueInvoice(dbi, id, invId, u!.uid);
    return NextResponse.json({ ok: true, gl_entry_ref: entry.entry_ref });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 400 });
  }
}
