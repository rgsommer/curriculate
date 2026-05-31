// POST → invite the engagement's contact as an audit_client user.
// Creates/updates a users record linked to the engagement, sends an email
// with a one-click sign-in link to /audit/app.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { logAudit } from "../../../../teebeepay/_audit";

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeeBee Audit <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");
const resend = new Resend(process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || "");

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  try {
    const dbi = await db();
    const eng: any = await dbi.collection("audit_engagements").findOne({ _id: new ObjectId(id) });
    if (!eng) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const email = String(eng.contact_email || "").trim().toLowerCase();
    if (!email) return NextResponse.json({ error: "Engagement has no contact email." }, { status: 400 });

    // Create or update the audit_client user. If the email already exists
    // (e.g. they're a TeebeePay client), append this engagement to their
    // audit_engagements array instead of clobbering their existing role.
    const existing: any = await dbi.collection("users").findOne({ email });
    let userId: any;
    if (existing) {
      userId = existing._id;
      const engs = Array.isArray(existing.audit_engagements) ? existing.audit_engagements : [];
      if (!engs.some((x: any) => x.toString() === id)) {
        await dbi.collection("users").updateOne({ _id: userId },
          { $push: { audit_engagements: new ObjectId(id) } as any });
      }
    } else {
      const nameParts = String(eng.contact_name || "").trim().split(/\s+/);
      const r = await dbi.collection("users").insertOne({
        email,
        first_name: nameParts[0] || "",
        last_name: nameParts.slice(1).join(" ") || "",
        role: "audit_client",
        is_active: 1,
        audit_engagements: [new ObjectId(id)],
        created_at: new Date(),
        created_by: u.email,
      });
      userId = r.insertedId;
    }

    // Update engagement to mark the invite + move status to engaged if still inquiry
    await dbi.collection("audit_engagements").updateOne({ _id: eng._id }, {
      $set: {
        client_user_id: userId,
        invited_at: new Date(),
        invited_by: u.email,
        ...(eng.status === "inquiry" ? { status: "engaged" } : {}),
        updated_at: new Date(),
      },
    });

    // Send invite email
    let sent = false;
    if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
      const link = `${PUBLIC_URL}/audit/app`;
      const subject = `TeeBee Audit — your engagement is ready to begin`;
      const html = `
        <div style="font:14px/1.55 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:560px">
          <h2 style="margin:0 0 12px;color:#0f2c52">Welcome to TeeBee Audit</h2>
          <p>Hi ${esc(eng.contact_name || "there")},</p>
          <p>Theresia at TeeBee Accountants has set up your audit engagement on our secure platform:
            <strong>${esc(eng.company_name)}</strong>.</p>
          <p>Sign in below to see a personalised checklist of documents we need, and upload them
            securely. Your accountant reviews everything before any finding is finalised.</p>
          <p style="margin:18px 0">
            <a href="${link}" style="display:inline-block;padding:11px 22px;background:#0f2c52;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Sign in to TeeBee Audit →
            </a>
          </p>
          <p style="color:#475569;font-size:13px">
            Use this email address (<strong>${esc(email)}</strong>) when signing in. We'll send you a
            6-digit code each time — no password to remember.
          </p>
          <p style="color:#94a3b8;font-size:12px;margin-top:24px">
            TeeBee Accountants Ltd · CPA · Registered with the PNG Accountants Registration Board ·
            info@teebeeaccountants.com.pg
          </p>
        </div>
      `;
      try {
        await resend.emails.send({ from: FROM, to: email, subject, html, replyTo: "info@teebeeaccountants.com.pg" } as any);
        sent = true;
      } catch (e) { console.warn("[audit/invite-client] send failed:", e); }
    }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: "audit.invite_client",
      resource_type: "audit_engagement", resource_id: id,
      details: { email, user_id: userId.toString(), email_sent: sent },
    });

    return NextResponse.json({ ok: true, user_id: userId.toString(), email_sent: sent });
  } catch (e: any) {
    console.error("[audit/invite-client] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
