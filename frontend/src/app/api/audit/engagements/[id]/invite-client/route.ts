// POST → invite the engagement's contact as an audit_client user.
// Creates/updates a users record linked to the engagement, sends an email
// with a one-click sign-in link to /audit/app.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId } from "../../../../teebeepay/_auth";
import { logAudit } from "../../../../teebeepay/_audit";
import { checklistForAuditType } from "../../../_checklist";

// Lowercase, mid-sentence labels for the engagement type ("…your audit-readiness review…").
const AUDIT_TYPE_LABELS: Record<string, string> = {
  statutory:  "external statutory audit",
  readiness:  "audit-readiness review",
  tax:        "tax / IRC due-diligence audit",
  compliance: "compliance audit",
  donor_fund: "donor-funded audit",
  landowner:  "landowner company audit",
  other:      "audit",
};

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
      const typeLabel = AUDIT_TYPE_LABELS[eng.audit_type] || "audit";

      // Build the document list from the same source of truth as the portal,
      // so the email always matches the checklist the client will see.
      const items = checklistForAuditType(String(eng.audit_type || "other"));
      const requiredItems = items.filter((i) => i.required);
      const optionalItems = items.filter((i) => !i.required);
      const reqList = requiredItems
        .map((i) => `<li style="margin:5px 0"><strong>${esc(i.label)}</strong></li>`)
        .join("");
      const optLabels = optionalItems.slice(0, 4).map((i) => esc(i.label)).join(", ");

      const subject = `TeeBee Audit — getting started with your ${typeLabel}`;
      const html = `
        <div style="font:14px/1.6 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:580px">
          <h2 style="margin:0 0 12px;color:#0f2c52">Welcome to TeeBee Audit</h2>
          <p>Hi ${esc(eng.contact_name || "there")},</p>
          <p>Theresia at TeeBee Accountants has set up your ${esc(typeLabel)} for
            <strong>${esc(eng.company_name)}</strong> on our secure platform. Here's all you need to do:</p>
          <ol style="padding-left:18px;margin:14px 0">
            <li style="margin:8px 0"><strong>Open the portal</strong> using the button below (or go to curriculate.net/audit/app).</li>
            <li style="margin:8px 0"><strong>Sign in — no password.</strong> Enter this email address
              (<strong>${esc(email)}</strong>); we'll send you a 6-digit code, type it in. That's it.</li>
            <li style="margin:8px 0">A quick <strong>walkthrough</strong> pops up the first time — you can replay it
              any time from the <strong>Tips</strong> button, top-right.</li>
            <li style="margin:8px 0"><strong>Upload your documents.</strong> You'll see a short checklist.${
              reqList ? ` The items we need to start:` : ""}
              ${reqList ? `<ul style="padding-left:18px;margin:6px 0">${reqList}</ul>` : ""}
              ${optLabels ? `<div style="color:#475569;font-size:13px">Optional extras that help us move faster: ${optLabels}.</div>` : ""}
            </li>
            <li style="margin:8px 0">On each item click <strong>"Add file"</strong> and upload — Excel, CSV, PDF or Word,
              up to 200 MB each. You can add several files per item; a <strong>green tick</strong> shows once an item has a file.</li>
            <li style="margin:8px 0"><strong>That's all — nothing to "submit".</strong> Once your files are in, your CPA
              reviews everything and runs the checks. Any findings or questions appear on that page, and we'll email you.</li>
          </ol>
          <p style="margin:18px 0">
            <a href="${link}" style="display:inline-block;padding:11px 22px;background:#0f2c52;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
              Sign in to TeeBee Audit →
            </a>
          </p>
          <p style="color:#475569;font-size:13px">
            <strong>Tip:</strong> wherever you can, export straight from your accounting software
            (MYOB, Xero, QuickBooks, or a spreadsheet) rather than scanning — it's faster for everyone.
            If all you have is PDFs, send those to start. Any trouble signing in, just reply to this email.
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
