// POST { session, teacherName, items:[{id,sku,qty}] }
//   - validates session, recomputes priced lines from the active catalog (non-zero only)
//   - stores the order in bcs_orders
//   - emails the teacher a confirmation + finance the order
import { NextResponse } from "next/server";
import { sessionEmail } from "../_auth";
import { getDb, getConfig, financeRecipients } from "../_db";
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

  const cfg = await getConfig();
  const { schoolName } = cfg;
  const now = new Date();

  // One order per teacher: a resubmit REPLACES the previous one (amend = add/change).
  // delete+insert also collapses any legacy duplicate docs into a single current order.
  let orderId: string | null = null;
  let isUpdate = false;
  let revision = 1;
  let createdAt = now;
  const db = await getDb();
  if (db) {
    const prior = await db.collection("bcs_orders").find({ teacherEmail: email }).toArray();
    isUpdate = prior.length > 0;
    if (isUpdate) {
      createdAt = prior.reduce((min: Date, d: any) => (d.createdAt && (!min || d.createdAt < min) ? d.createdAt : min), null as any) || now;
      revision = prior.reduce((mx: number, d: any) => Math.max(mx, Number(d.revision) || 1), 0) + 1;
      await db.collection("bcs_orders").deleteMany({ teacherEmail: email });
    }
    const r = await db.collection("bcs_orders").insertOne({
      teacherEmail: email, teacherName, createdAt, updatedAt: now, revision, lines, total, schoolName,
    } as any);
    orderId = String(r.insertedId);
    // Order submitted — clear this teacher's in-progress draft.
    await db.collection("bcs_drafts").deleteOne({ _id: email as any }).catch(() => {});
  }

  const orderTable = renderOrderHtml(lines, total);
  const dateStr = now.toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" });
  const verb = isUpdate ? "updated" : "submitted";

  // One .xlsx per supplier (that teacher's order) attached to the finance email.
  const attachments = buildSupplierWorkbooks(lines, { teacherName, schoolName, dateStr });

  // Teacher confirmation
  const teacherHtml = pageShell(
    isUpdate ? "Your supply order — updated" : "Your supply order — confirmation",
    `<p style="margin:0 0 6px">Hi ${escapeName(teacherName)}, thanks — your order has been ${verb} and sent to ${escapeName(schoolName)} finance. It replaces any earlier version.</p>
     <p style="margin:0 0 12px;font-size:13px;color:#6b7280">${isUpdate ? "Updated" : "Submitted"} ${dateStr} · ${lines.length} item${lines.length === 1 ? "" : "s"}</p>
     ${orderTable}`,
    schoolName
  );

  // Finance copy
  const financeHtml = pageShell(
    `Supply order ${isUpdate ? "UPDATED" : "from"} ${isUpdate ? "" : ""}${teacherName}`,
    `<p style="margin:0 0 6px"><strong>${escapeName(teacherName)}</strong> (${escapeName(email)}) ${verb} ${isUpdate ? `their order (revision ${revision} — this replaces their previous order)` : "an order"}.</p>
     <p style="margin:0 0 12px;font-size:13px;color:#6b7280">${dateStr} · ${lines.length} item${lines.length === 1 ? "" : "s"} · ${money(total)}</p>
     ${orderTable}
     <p style="margin:16px 0 0;font-size:13px;color:#6b7280">The combined school-wide total (current order per teacher) is at <a href="https://www.curriculate.net/orders/summary">curriculate.net/orders/summary</a>.</p>`,
    schoolName
  );

  const financeTo = financeRecipients(cfg); // honours each person's "receive emails" box
  const subjPrefix = isUpdate ? "Supply order UPDATED" : "Supply order";
  const [teacherSend, financeSend] = await Promise.all([
    sendEmail({ to: email, subject: `Your supply order ${isUpdate ? "updated" : "received"} — ${money(total)} (${lines.length} items)`, html: teacherHtml }),
    financeTo.length
      ? sendEmail({
          to: financeTo,
          replyTo: email,
          subject: `${subjPrefix}: ${teacherName} — ${money(total)} (${lines.length} items)`,
          html: financeHtml,
          attachments,
        })
      : Promise.resolve({ ok: false, skipped: true }),
  ]);

  return NextResponse.json({
    ok: true,
    orderId,
    updated: isUpdate,
    revision,
    total,
    lineCount: lines.length,
    lines,
    emailed: { teacher: teacherSend.ok, finance: financeSend.ok },
  });
}

function escapeName(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
