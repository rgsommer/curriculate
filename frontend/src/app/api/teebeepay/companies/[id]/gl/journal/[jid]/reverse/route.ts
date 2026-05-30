// Reverse a posted journal entry — posts an offsetting mirror entry.
import { NextResponse } from "next/server";
import { readAuth, db } from "../../../../../../_auth";
import { reverseJournalEntry } from "../../../../../../_ledger";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; jid: string }> }) {
  const u = readAuth(req);
  const { id, jid } = await params;
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3 && u.company_id !== id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (u.clearance < 2) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  try {
    const dbi = await db();
    const rev = await reverseJournalEntry(dbi, id, jid, { date: b.date, created_by: u.uid });
    return NextResponse.json({ ok: true, id: rev._id.toString(), entry_ref: rev.entry_ref });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 400 });
  }
}
