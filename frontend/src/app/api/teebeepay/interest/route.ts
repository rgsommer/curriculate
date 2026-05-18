// frontend/src/app/api/teebeepay/interest/route.ts
//
// Inbound interest form for TeebeePay. Writes the submission to the pngpay
// MongoDB database (collection: leads), emails rgsommer@me.com, and sends
// a confirmation email back to the prospect. Rate-limited per IP.
import { NextResponse } from "next/server";
import { Resend } from "resend";
import { MongoClient } from "mongodb";

// TeebeePay leads go to Theresia at Tee Bee Accountants;
// Richard is BCC'd (silent copy — recipient doesn't see him on the email).
const NOTIFY_TO = "info@teebeeaccountants.com.pg";
const NOTIFY_BCC = "rgsommer@me.com";
const FROM_ADDRESS =
  process.env.RESEND_PNGPAY_FROM_ADDRESS ||
  process.env.RESEND_FROM_ADDRESS ||
  "TeebeePay <hello@curriculate.net>";

const resend = new Resend(
  process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY || ""
);

// ── Mongo (cached on the global so Vercel hot-reloads don't reconnect) ─
declare global {
  // eslint-disable-next-line no-var
  var _teebeepayMongoPromise: Promise<MongoClient> | undefined;
}
function mongo() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) return null;
  if (!global._teebeepayMongoPromise) {
    global._teebeepayMongoPromise = new MongoClient(uri).connect();
  }
  return global._teebeepayMongoPromise;
}

// ── Light rate limit ──────────────────────────────────────────────────
const RATE_WINDOW_MS = 10 * 60 * 1000; // 10 min
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
  e.count++;
  return e.count > RATE_MAX;
}

function esc(s: unknown) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c] as string));
}

export async function POST(req: Request) {
  try {
    const ip = getIp(req);
    if (rateLimited(ip)) {
      return NextResponse.json({ ok: false, error: "Too many submissions. Try again later." }, { status: 429 });
    }
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const {
      name, email, company, role,
      employees, country, payInterval,
      currentTool, painPoint, timing,
      hp,       // honeypot (must be empty)
    } = body as Record<string, string | undefined>;

    // Honeypot trap (bots typically fill every visible field)
    if (hp) return NextResponse.json({ ok: true, ignored: true });

    if (!name || !email || !company) {
      return NextResponse.json({ ok: false, error: "Name, email and company are required." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return NextResponse.json({ ok: false, error: "Please provide a valid email." }, { status: 400 });
    }

    const doc = {
      name: String(name).slice(0, 200),
      email: String(email).slice(0, 200).toLowerCase(),
      company: String(company).slice(0, 200),
      role: String(role || "").slice(0, 100),
      employees: String(employees || "").slice(0, 50),
      country: String(country || "").slice(0, 100),
      payInterval: String(payInterval || "").slice(0, 50),
      currentTool: String(currentTool || "").slice(0, 200),
      painPoint: String(painPoint || "").slice(0, 2000),
      timing: String(timing || "").slice(0, 100),
      ip,
      userAgent: req.headers.get("user-agent") || null,
      referrer: req.headers.get("referer") || null,
      created_at: new Date(),
      source: "teebeepay/landing",
      status: "new",
    };

    // 1) Persist to MongoDB (the same Atlas cluster Curriculate uses).
    const client = await mongo();
    if (client) {
      try {
        await client.db("pngpay").collection("leads").insertOne(doc);
      } catch (e) {
        console.error("[teebeepay/interest] Mongo write failed:", e);
      }
    }

    // 2) Notify you.
    const summary = `
      <h2>New TeebeePay interest</h2>
      <table cellpadding="6" style="border-collapse:collapse;font:14px/1.5 -apple-system,Segoe UI,Arial">
        <tr><td><b>Name</b></td><td>${esc(doc.name)}</td></tr>
        <tr><td><b>Email</b></td><td><a href="mailto:${esc(doc.email)}">${esc(doc.email)}</a></td></tr>
        <tr><td><b>Company</b></td><td>${esc(doc.company)}</td></tr>
        <tr><td><b>Role</b></td><td>${esc(doc.role)}</td></tr>
        <tr><td><b>Employees</b></td><td>${esc(doc.employees)}</td></tr>
        <tr><td><b>Country</b></td><td>${esc(doc.country)}</td></tr>
        <tr><td><b>Pay interval</b></td><td>${esc(doc.payInterval)}</td></tr>
        <tr><td><b>Current tool</b></td><td>${esc(doc.currentTool)}</td></tr>
        <tr><td><b>Timing</b></td><td>${esc(doc.timing)}</td></tr>
        <tr><td valign="top"><b>Pain point</b></td><td>${esc(doc.painPoint).replace(/\n/g,"<br>")}</td></tr>
      </table>
      <p style="color:#888;font-size:12px">IP ${esc(doc.ip)} · ${esc(doc.userAgent || "")}</p>
    `;
    try {
      if (process.env.RESEND_PNGPAY_API_KEY || process.env.RESEND_API_KEY) {
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: NOTIFY_TO,
          bcc: NOTIFY_BCC,
          replyTo: doc.email,
          subject: `TeebeePay lead: ${doc.company} (${doc.employees || "?"} emp)`,
          html: summary,
        });
        // 3) Auto-reply to the prospect.
        await resend.emails.send({
          from: FROM_ADDRESS,
          to: doc.email,
          subject: "Thanks — we'll be in touch about TeebeePay",
          html: `
            <p>Hi ${esc(doc.name.split(" ")[0])},</p>
            <p>Thanks for getting in touch about TeebeePay. We'll reply within one business day to set up a short call and walk through what fortnightly payroll could look like for ${esc(doc.company)}.</p>
            <p>In the meantime, if you have a CSV of your current employee list, having it ready will let us show you actual stubs and BSP batch output on our first call.</p>
            <p>— The TeebeePay team</p>
          `,
        });
      }
    } catch (e) {
      console.error("[teebeepay/interest] Resend send failed:", e);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[teebeepay/interest] handler error:", e);
    return NextResponse.json({ ok: false, error: "Unexpected error. Please email hello@teebeepay.com." }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST { name, email, company, ... } to submit interest" });
}
