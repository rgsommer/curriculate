// Journal entries for one company.
//   GET  → list recent entries (most recent first, capped).
//   POST → post a balanced manual journal entry (bookkeeper+).
import { NextResponse } from "next/server";
import { readAuth, db, ObjectId } from "../../../../_auth";
import { postJournalEntry } from "../../../../_ledger";

function gate(u: any, id: string) {
  if (!u) return { error: "Unauthorized", status: 401 };
  if (u.clearance < 3 && u.company_id !== id) return { error: "Forbidden", status: 403 };
  if (u.clearance < 2) return { error: "Forbidden", status: 403 };
  return null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });
  try {
    const dbi = await db();
    const cid = new ObjectId(id);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 500);
    const rows = await dbi.collection("journal_entries")
      .find({ company_id: cid })
      .sort({ date: -1, entry_no: -1 })
      .limit(limit)
      .toArray();
    const entries = rows.map((e: any) => ({
      id: e._id.toString(),
      entry_ref: e.entry_ref, entry_no: e.entry_no,
      date: e.date, memo: e.memo, reference: e.reference,
      source: e.source, status: e.status,
      total_debit: e.total_debit, total_credit: e.total_credit,
      reverses: e.reverses ? e.reverses.toString() : null,
      reversed_by: e.reversed_by ? e.reversed_by.toString() : null,
      lines: (e.lines || []).map((l: any) => ({
        account_id: l.account_id ? l.account_id.toString() : null,
        account_code: l.account_code, account_name: l.account_name,
        description: l.description, debit: l.debit, credit: l.credit,
      })),
    }));
    return NextResponse.json({ entries });
  } catch (e: any) {
    console.error("[teebeepay/gl/journal GET] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  const { id } = await params;
  const g = gate(u, id);
  if (g) return NextResponse.json({ error: g.error }, { status: g.status });

  const b = await req.json().catch(() => ({} as any));
  try {
    const dbi = await db();
    const entry = await postJournalEntry(dbi, id, {
      date: b.date,
      memo: b.memo,
      reference: b.reference,
      source: "manual",
      lines: Array.isArray(b.lines) ? b.lines : [],
      created_by: u!.uid,
    });
    return NextResponse.json({ ok: true, id: entry._id.toString(), entry_ref: entry.entry_ref });
  } catch (e: any) {
    const status = e?.validation ? 400 : 500;
    if (!e?.validation) console.error("[teebeepay/gl/journal POST] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status });
  }
}
