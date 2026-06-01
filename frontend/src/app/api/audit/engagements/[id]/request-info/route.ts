// POST → record what's received vs still outstanding for this engagement, and
// email the client the outstanding list. Lets the Principal chase missing
// documents in one click as part of working a step.
//
// Body: { have: string[], need: string[], note?: string, email?: boolean }
//   email defaults to true; set false to record without sending.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { logAudit } from "../../../../teebeepay/_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeeBee Audit <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");

// Lazy so the route loads (and the record-only path works) even with no key.
function getResend(): Resend | null {
  const key = process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function cleanList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 50);
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;

  const b = await req.json().catch(() => ({} as any));
  const have = cleanList(b.have);
  const need = cleanList(b.need);
  const note = String(b.note || "").trim().slice(0, 2000);
  const sendEmail = b.email !== false;

  try {
    const dbi = await db();
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const outstanding_items = { have, need, note, updated_at: new Date(), updated_by: u.email };
    await dbi.collection("audit_engagements").updateOne({ _id: eng._id },
      { $set: { outstanding_items, updated_at: new Date() } });

    let sent = false;
    const email = String(eng.contact_email || "").trim().toLowerCase();
    const resend = getResend();
    if (sendEmail && need.length && email && resend) {
      const link = `${PUBLIC_URL}/audit/app`;
      const needList = need.map((n) => `<li style="margin:5px 0">${esc(n)}</li>`).join("");
      const haveList = have.length
        ? `<p style="color:#475569;font-size:13px;margin:12px 0 0">Already received, thank you: ${have.map(esc).join(", ")}.</p>` : "";
      const html = `
        <div style="font:14px/1.6 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:560px">
          <h2 style="margin:0 0 12px;color:#0f2c52">A few more documents needed</h2>
          <p>Hi ${esc(eng.contact_name || "there")},</p>
          <p>Thanks for getting your audit underway. To keep things moving on
            <strong>${esc(eng.company_name)}</strong>, could you upload the following when you have a moment:</p>
          <ul style="padding-left:18px;margin:10px 0">${needList}</ul>
          ${note ? `<p style="background:#fafbfc;border:1px solid #eef1f4;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${esc(note)}</p>` : ""}
          <p style="margin:18px 0">
            <a href="${link}" style="display:inline-block;padding:11px 22px;background:#0f2c52;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Upload in TeeBee Audit →
            </a>
          </p>
          ${haveList}
          <p style="color:#94a3b8;font-size:12px;margin-top:24px">
            TeeBee Accountants Ltd · info@teebeeaccountants.com.pg
          </p>
        </div>`;
      try {
        await resend.emails.send({ from: FROM, to: email, subject: `TeeBee Audit — documents still needed for ${eng.company_name}`, html, replyTo: "info@teebeeaccountants.com.pg" } as any);
        sent = true;
      } catch (e) { console.warn("[audit/request-info] send failed:", e); }
    }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "audit.request_info",
      resource_type: "audit_engagement", resource_id: id,
      details: { have_count: have.length, need_count: need.length, email_sent: sent },
    }).catch(() => {});

    return NextResponse.json({ ok: true, email_sent: sent, outstanding_items });
  } catch (e: any) {
    console.error("[audit/request-info] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
