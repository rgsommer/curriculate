// GET (with Authorization: Bearer <session>) -> combined school-wide order.
// Admin-only: the session email must equal the configured finance email.
//
// Returns:
//   combined: per-catalog-item totals (qty summed across all teachers) with line totals
//   orders:   per-teacher order summaries (name, email, date, total, lineCount)
//   totals:   { grand, orderCount, bySupplier:[{supplier,po,subtotal}] }
import { NextResponse } from "next/server";
import { sessionEmail, normalizeEmail } from "../_auth";
import { getDb, getConfig } from "../_db";
import { OrderLine, groupBySupplier } from "../_order";

export const runtime = "nodejs";

function tokenFrom(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1];
  const url = new URL(req.url);
  return url.searchParams.get("session");
}

export async function GET(req: Request) {
  const email = sessionEmail(tokenFrom(req));
  if (!email) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const cfg = await getConfig();
  if (normalizeEmail(email) !== normalizeEmail(cfg.financeEmail)) {
    return NextResponse.json(
      { error: `Only the finance account (${cfg.financeEmail}) can view the summary.` },
      { status: 403 }
    );
  }

  const db = await getDb();
  if (!db) {
    return NextResponse.json({ combined: [], orders: [], totals: { grand: 0, orderCount: 0, bySupplier: [] } });
  }

  const docs = await db.collection("bcs_orders").find({}).sort({ createdAt: -1 }).toArray();

  // Aggregate across all orders from the stored line snapshots — these were priced
  // by the server at submit time, so they're authoritative and immune to later
  // catalog re-uploads. Key on supplier+sku+price so a re-priced item stays distinct.
  const agg = new Map<string, OrderLine>();
  const orders = docs.map((d: any) => {
    for (const l of (d.lines || []) as OrderLine[]) {
      const qty = Number(l.qty || 0);
      if (qty <= 0) continue;
      const key = `${l.supplier}|${l.sku}|${l.price}`;
      const ex = agg.get(key);
      if (ex) {
        ex.qty += qty;
        ex.lineTotal = Math.round(ex.price * ex.qty * 100) / 100;
      } else {
        agg.set(key, { ...l, qty, lineTotal: Math.round(Number(l.price) * qty * 100) / 100 });
      }
    }
    return {
      id: String(d._id),
      teacherName: d.teacherName || "",
      teacherEmail: d.teacherEmail || "",
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : null,
      total: Number(d.total || 0),
      lineCount: Array.isArray(d.lines) ? d.lines.length : 0,
    };
  });

  const combined: OrderLine[] = Array.from(agg.values());
  const grand = Math.round(combined.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  const bySupplier = groupBySupplier(combined).map((g) => ({
    supplier: g.supplier, po: g.po, subtotal: g.subtotal, lineCount: g.lines.length,
  }));

  return NextResponse.json({
    combined,
    orders,
    totals: { grand, orderCount: orders.length, bySupplier },
    schoolName: cfg.schoolName,
  });
}
