// POST { session, all? }
//   all=false (default): clear the signed-in teacher's own order + draft (start over).
//   all=true: clear EVERY teacher's orders + drafts (new-year reset) — finance only.
import { NextResponse } from "next/server";
import { sessionEmail } from "../_auth";
import { getDb, getConfig, isFinanceEmail } from "../_db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = sessionEmail(body.session);
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const db = await getDb();

  if (body.all) {
    // School-wide new-year reset — admin only.
    const cfg = await getConfig();
    if (!isFinanceEmail(email, cfg)) {
      return NextResponse.json({ error: "Only a finance account can clear all orders." }, { status: 403 });
    }
    if (!db) return NextResponse.json({ ok: true, scope: "all", removed: 0, persisted: false });
    const r = await db.collection("bcs_orders").deleteMany({});
    await db.collection("bcs_drafts").deleteMany({});
    return NextResponse.json({ ok: true, scope: "all", removed: r.deletedCount ?? 0 });
  }

  // Clear just this teacher's order + draft.
  if (db) {
    await db.collection("bcs_orders").deleteMany({ teacherEmail: email });
    await db.collection("bcs_drafts").deleteOne({ _id: email as any }).catch(() => {});
  }
  return NextResponse.json({ ok: true, scope: "mine" });
}
