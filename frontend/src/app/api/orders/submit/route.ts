// POST { session, teacherName, items:[{id,sku,qty}] }
//   - validates session, recomputes priced lines from the active catalog (non-zero only)
//   - stores the order in bcs_orders
//   - emails the teacher a confirmation + finance the order
import { NextResponse } from "next/server";
import { sessionEmail } from "../_auth";
import { getDb, getConfig } from "../_db";
import { getActiveCatalog } from "../_catalog-store";
import { buildLines, renderOrderHtml, money } from "../_order";
import { buildSupplierWorkbooks } from "../_xlsx";
import { sendEmail, pageShell } from "../_email";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = sessionEmail(body.session);
  if (!email) {
    return NextResponse.json({ error: "Your session expired. Please sign in again." }, { status: 401 });
  }

  const teacherName = String(body.teacherName || "").trim().slice(0, 120);
  if (!teacherName) {
    return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
  }

  const catalog = await getActiveCatalog();
  const { lines, total } = buildLines(body.items, catalog.byId, catalog.bySku);
  if (lines.length === 0) {
    return NextResponse.json({ error: "Your order is empty — add a quantity to at least one item." }, { status: 400 });
  }

  const { financeEmail, financeName, schoolName } = await getConfig();
  const createdAt = new Date();

  // Persist (best-effort: if Mongo isn't configured locally, still send emails).
  let orderId: string | null = null;
  const db = await getDb();
  if (db) {
    const doc = {
      teacherEmail: email,
      teacherName,
      createdAt,
      lines,
      total,
      schoolName,
    };
    const r = await db.collection("bcs_orders").insertOne(doc as any);
    orderId = String(r.insertedId);
    // Order submitted — clear this teacher's saved draft.
    await db.collection("bcs_drafts").deleteOne({ _id: email as any }).catch(() => {});
  }

  const orderTable = renderOrderHtml(lines, total);
  const dateStr = createdAt.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });

  // One .xlsx per supplier (that teacher's order) attached to the finance email.
  const attachments = buildSupplierWorkbooks(lines, { teacherName, schoolName, dateStr });

  // Teacher confirmation
  const teacherHtml = pageShell(
    "Your supply order — confirmation",
    `<p style="margin:0 0 6px">Hi ${escapeName(teacherName)}, thanks — your order has been sent to ${escapeName(schoolName)} finance.</p>
     <p style="margin:0 0 12px;font-size:13px;color:#6b7280">Submitted ${dateStr} · ${lines.length} item${lines.length === 1 ? "" : "s"}</p>
     ${orderTable}`,
    schoolName
  );

  // Finance copy
  const financeHtml = pageShell(
    `Supply order from ${teacherName}`,
    `<p style="margin:0 0 6px"><strong>${escapeName(teacherName)}</strong> (${escapeName(email)}) submitted an order.</p>
     <p style="margin:0 0 12px;font-size:13px;color:#6b7280">${dateStr} · ${lines.length} item${lines.length === 1 ? "" : "s"} · ${money(total)}</p>
     ${orderTable}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280">A combined school-wide total of all teachers' orders is at <a href="https://www.curriculate.net/orders/summary">curriculate.net/orders/summary</a>.</p>`,
    schoolName
  );

  const [teacherSend, financeSend] = await Promise.all([
    sendEmail({ to: email, subject: `Your supply order — ${money(total)} (${lines.length} items)`, html: teacherHtml }),
    sendEmail({
      to: financeName ? `${financeName} <${financeEmail}>` : financeEmail,
      replyTo: email,
      subject: `Supply order: ${teacherName} — ${money(total)} (${lines.length} items)`,
      html: financeHtml,
      attachments,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    orderId,
    total,
    lineCount: lines.length,
    lines,
    emailed: { teacher: teacherSend.ok, finance: financeSend.ok },
  });
}

function escapeName(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
