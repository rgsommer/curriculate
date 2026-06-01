// POST → record a Principal action against any TeeBee process (audit / tax /
// loans / payroll), in one shared place so the console can drive every product
// the same way:
//   kind "progress"      → a free-text progress update (+ optional stage label)
//   kind "request_info"  → received/outstanding lists; emails the client the
//                          outstanding items when an address is on file
//
// Stored in `process_activity` keyed by { app, entity_id }; the activity rollup
// reads the latest of each per entity.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { readAuth, db, ObjectId } from "../../teebeepay/_auth";
import { logAudit } from "../../teebeepay/_audit";

const COLL: Record<string, string> = {
  audit: "audit_engagements", tax: "tax_returns", loans: "loan_applications", payroll: "companies",
};
const NAME_FIELD: Record<string, string> = {
  audit: "company_name", tax: "taxpayer_name", loans: "business_name", payroll: "name",
};

const FROM = process.env.RESEND_PNGPAY_FROM_ADDRESS || process.env.RESEND_FROM_ADDRESS || "TeeBee Accountants <noreply@curriculate.net>";
const PUBLIC_URL = (process.env.PUBLIC_URL || "https://www.curriculate.net").replace(/\/+$/, "");
function getResend(): Resend | null {
  const key = process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}
const APP_LINK: Record<string, string> = { audit: "/audit/app", tax: "/teebee-tax/app", loans: "/teebee-loans/app" };

function esc(s: any): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
function cleanList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 50);
}
function emailOf(row: any): string {
  return String(row?.contact_email || row?.client_email || row?.email || "").trim().toLowerCase();
}

export async function POST(req: Request) {
  const u = readAuth(req);
  if (!u) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (u.clearance < 3) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const b = await req.json().catch(() => ({} as any));
  const app = String(b.app || "");
  if (!COLL[app]) return NextResponse.json({ error: "Unknown app" }, { status: 400 });
  let oid: any;
  try { oid = new ObjectId(String(b.id)); } catch { return NextResponse.json({ error: "Bad id" }, { status: 400 }); }
  const kind = b.kind === "request_info" ? "request_info" : "progress";
  const note = String(b.note || "").trim().slice(0, 2000);
  const stage = String(b.stage || "").trim().slice(0, 60) || null;
  const have = cleanList(b.have);
  const need = cleanList(b.need);
  const sendEmail = b.email !== false;

  try {
    const dbi = await db();
    const row: any = await dbi.collection(COLL[app]).findOne({ _id: oid });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const name = row[NAME_FIELD[app]] || "your engagement";

    let sent = false;
    if (kind === "request_info" && sendEmail && need.length) {
      const email = emailOf(row);
      const resend = getResend();
      const link = `${PUBLIC_URL}${APP_LINK[app] || "/"}`;
      if (email && resend) {
        const needList = need.map((n) => `<li style="margin:5px 0">${esc(n)}</li>`).join("");
        const haveLine = have.length ? `<p style="color:#475569;font-size:13px;margin:12px 0 0">Already received, thank you: ${have.map(esc).join(", ")}.</p>` : "";
        const html = `
          <div style="font:14px/1.6 -apple-system,Segoe UI,Arial;color:#0f172a;max-width:560px">
            <h2 style="margin:0 0 12px;color:#0f2c52">A few more documents needed</h2>
            <p>Hi ${esc(row.contact_name || "there")},</p>
            <p>To keep things moving on <strong>${esc(name)}</strong>, could you send the following when you have a moment:</p>
            <ul style="padding-left:18px;margin:10px 0">${needList}</ul>
            ${note ? `<p style="background:#fafbfc;border:1px solid #eef1f4;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${esc(note)}</p>` : ""}
            ${APP_LINK[app] ? `<p style="margin:18px 0"><a href="${link}" style="display:inline-block;padding:11px 22px;background:#0f2c52;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Open in TeeBee →</a></p>` : ""}
            ${haveLine}
            <p style="color:#94a3b8;font-size:12px;margin-top:24px">TeeBee Accountants Ltd · info@teebeeaccountants.com.pg</p>
          </div>`;
        try {
          await resend.emails.send({ from: FROM, to: email, subject: `TeeBee — documents still needed for ${name}`, html, replyTo: "info@teebeeaccountants.com.pg" } as any);
          sent = true;
        } catch (e) { console.warn("[process-update] send failed:", e); }
      }
    }

    const doc = {
      app, entity_id: String(b.id), kind, note, stage, have, need,
      actor_email: u.email, email_sent: sent, created_at: new Date(),
    };
    await dbi.collection("process_activity").insertOne(doc);

    // Keep the audit engagement's own field in sync for its other views.
    if (app === "audit" && kind === "request_info") {
      await dbi.collection("audit_engagements").updateOne({ _id: oid },
        { $set: { outstanding_items: { have, need, note, updated_at: new Date(), updated_by: u.email }, updated_at: new Date() } });
    }

    await logAudit({
      actor_email: u.email, actor_kind: "user",
      action: `process.${kind}`, resource_type: app, resource_id: String(b.id),
      details: { kind, have_count: have.length, need_count: need.length, email_sent: sent, stage },
    }).catch(() => {});

    return NextResponse.json({ ok: true, email_sent: sent });
  } catch (e: any) {
    console.error("[process-update] error:", e);
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}
