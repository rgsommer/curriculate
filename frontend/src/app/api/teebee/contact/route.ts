// frontend/src/app/api/teebee/contact/route.ts
//
// Contact form for TeeBee Accountants Ltd. Writes the submission to MongoDB
// (pngpay.tba_inquiries) and emails info@teebeeaccountants.com.pg.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { MongoClient } from "mongodb";

const NOTIFY_TO = "info@teebeeaccountants.com.pg";
const NOTIFY_BCC = "rgsommer@me.com";  // silent copy — recipient doesn't see Richard on the email
const FROM_ADDRESS =
  process.env.RESEND_PNGPAY_FROM_ADDRESS ||
  process.env.RESEND_FROM_ADDRESS ||
  "TeeBee Accountants <hello@curriculate.net>";

const resend = new Resend(
  process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || ""
);

declare global {
  // eslint-disable-next-line no-var
  var _tbaMongoPromise: Promise<MongoClient> | undefined;
}
function mongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) return null;
  if (!global._tbaMongoPromise) global._tbaMongoPromise = new MongoClient(uri).connect();
  return global._tbaMongoPromise;
}

const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 5;
const rateMap = new Map<string, { count: number; resetAt: number }>();
function getIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}
function rateLimited(ip: string) {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) { rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS }); return false; }
  e.count++; return e.count > RATE_MAX;
}
function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

export async function POST(req: Request) {
  try {
    const ip = getIp(req);
    if (rateLimited(ip)) {
      return NextResponse.json({ ok: false, error: "Too many submissions. Try again later." }, { status: 429 });
    }
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const { name, email, phone, service, message, hp } = body as Record<string, string | undefined>;
    if (hp) return NextResponse.json({ ok: true, ignored: true });
    if (!name || !email || !message) {
      return NextResponse.json({ ok: false, error: "Name, email and message are required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return NextResponse.json({ ok: false, error: "Please provide a valid email." }, { status: 400 });
    }

    const doc = {
      name: String(name).slice(0, 200),
      email: String(email).slice(0, 200).toLowerCase(),
      phone: String(phone || "").slice(0, 50),
      service: String(service || "").slice(0, 100),
      message: String(message).slice(0, 4000),
      ip, userAgent: req.headers.get("user-agent") || null,
      referrer: req.headers.get("referer") || null,
      created_at: new Date(),
      source: "teebee/landing",
      status: "new",
    };

    const client = await mongo();
    if (client) {
      try { await client.db("pngpay").collection("tba_inquiries").insertOne(doc); }
      catch (e) { console.error("[teebee/contact] Mongo write failed:", e); }
    }

    const summary = `
      <h2>New inquiry — TeeBee Accountants</h2>
      <table cellpadding="6" style="border-collapse:collapse;font:14px/1.5 -apple-system,Segoe UI,Arial">
        <tr><td><b>Name</b></td><td>${esc(doc.name)}</td></tr>
        <tr><td><b>Email</b></td><td><a href="mailto:${esc(doc.email)}">${esc(doc.email)}</a></td></tr>
        <tr><td><b>Phone</b></td><td>${esc(doc.phone)}</td></tr>
        <tr><td><b>Service</b></td><td>${esc(doc.service)}</td></tr>
        <tr><td valign="top"><b>Message</b></td><td>${esc(doc.message).replace(/\n/g, "<br>")}</td></tr>
      </table>
      <p style="color:#888;font-size:12px">IP ${esc(doc.ip)}</p>
    `;
    try {
      if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: NOTIFY_TO,
          bcc: NOTIFY_BCC,
          replyTo: doc.email,
          subject: `TBA inquiry: ${doc.service || "General"} — ${doc.name}`,
          html: summary,
        });
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: doc.email,
          subject: "Thank you — TeeBee Accountants Ltd",
          html: `
            <p>Hi ${esc(doc.name.split(" ")[0])},</p>
            <p>Thank you for reaching out to TeeBee Accountants Ltd. We'll respond within one business day.</p>
            <p>If your matter is urgent, please call us on <a href="tel:+6753000000">+675 300 0000</a>.</p>
            <p>Regards,<br>TeeBee Accountants Ltd</p>
            <p style="color:#888;font-size:12px;border-top:1px solid #eee;padding-top:8px;margin-top:16px">
              Port Moresby, National Capital District, Papua New Guinea<br>
              info@teebeeaccountants.com.pg
            </p>
          `,
        });
      }
    } catch (e) { console.error("[teebee/contact] Resend send failed:", e); }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[teebee/contact] handler error:", e);
    return NextResponse.json({ ok: false, error: "Unexpected error. Please email info@teebeeaccountants.com.pg." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true });
}
