import { NextResponse } from "next/server";
import { Resend } from "resend";
import { MongoClient } from "mongodb";

const resend = new Resend(process.env.RESEND_API_KEY);

// ---- Mongo (cached) ----
declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoClientPromise() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri, {
      // keep defaults; Mongo driver handles pooling
    });
    global._mongoClientPromise = client.connect();
  }
  return global._mongoClientPromise;
}

// ---- Rate limiting (in-memory baseline) ----
// NOTE: This works well for single-instance or low-traffic.
// In serverless/multi-instance, consider Upstash/Redis later.
const RATE_WINDOW_MS = Number(process.env.CONTACT_RATE_WINDOW_MS || 10 * 60 * 1000); // 10 min
const RATE_MAX = Number(process.env.CONTACT_RATE_MAX || 4); // 4 requests / window / IP
const rateMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0].trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function checkRateLimit(ip: string) {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true, remaining: RATE_MAX - 1 };
  }

  if (entry.count >= RATE_MAX) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return { ok: false, retryAfterSec, remaining: 0 };
  }

  entry.count += 1;
  rateMap.set(ip, entry);
  return { ok: true, remaining: RATE_MAX - entry.count };
}

function escapeHtml(str: string) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function normalizeToEmails(): string[] {
  // Prefer env list; fallback to a single default
  const raw =
    process.env.CONTACT_TO_EMAILS ||
    process.env.CONTACT_TO ||
    "rgssommer@gmail.com";

  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function POST(req: Request) {
  try {
    // 1) Rate limit
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rl.retryAfterSec),
          },
        }
      );
    }

    // 2) Parse + validate
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const message = typeof body?.message === "string" ? body.message.trim() : "";

    // optional honeypot field (if you add it later)
    const hp = typeof body?.company === "string" ? body.company.trim() : "";
    if (hp) {
      // likely bot; pretend success to avoid escalation
      return NextResponse.json({ ok: true });
    }

    if (!name || !email || !message) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    // lightweight email sanity
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const toEmails = normalizeToEmails();

    // 3) Save to MongoDB (if configured)
    const mongoPromise = getMongoClientPromise();
    if (mongoPromise) {
      try {
        const client = await mongoPromise;
        const dbName = process.env.MONGODB_DB || "curriculate";
        const colName = process.env.CONTACT_COLLECTION || "contactMessages";
        const col = client.db(dbName).collection(colName);

        await col.insertOne({
          name,
          email,
          message,
          ip,
          userAgent: req.headers.get("user-agent") || "",
          createdAt: new Date(),
          source: "contact-form",
        });
      } catch (mongoErr) {
        // Don’t fail the request if logging fails
        console.error("Mongo insert error:", mongoErr);
      }
    }

    // 4) Send internal notification (to support/sales/etc.)
    const internalSubject = `Curriculate Contact: ${name}`;
    const internalText = `
New contact message from curriculate.net

Name: ${name}
Email: ${email}
IP: ${ip}

Message:
${message}
    `.trim();

    const internalHtml = `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6;">
  <h2 style="margin:0 0 12px 0;">New contact message</h2>
  <p style="margin:0 0 6px 0;"><strong>Name:</strong> ${escapeHtml(name)}</p>
  <p style="margin:0 0 6px 0;"><strong>Email:</strong> ${escapeHtml(email)}</p>
  <p style="margin:0 0 12px 0;"><strong>IP:</strong> ${escapeHtml(ip)}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />
  <p style="white-space: pre-wrap; margin:0;">${escapeHtml(message)}</p>
</div>
    `.trim();

    const from = process.env.CONTACT_FROM || "Curriculate <noreply@curriculate.net>";
    const supportReplyTo =
      process.env.CONTACT_REPLYTO || "support@curriculate.net";

    const internalSend = await resend.emails.send({
      from,
      to: toEmails,
      replyTo: email, // reply goes to the sender (nice workflow)
      subject: internalSubject,
      text: internalText,
      html: internalHtml,
      headers: {
        // helps avoid threading with the auto-reply
        "X-Entity-Ref-ID": `contact-${Date.now()}`,
      },
    });

    if (internalSend.error) {
      console.error("Resend internal error:", internalSend.error);
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }

    // 5) Auto-reply to sender
    const autoSubject =
      process.env.CONTACT_AUTOREPLY_SUBJECT ||
      "Thanks for contacting Curriculate";
    const autoText =
      process.env.CONTACT_AUTOREPLY_TEXT ||
      `Hi ${name},

Thanks for contacting Curriculate — we’ll respond shortly.

— Curriculate Team`;

    const autoHtml =
      process.env.CONTACT_AUTOREPLY_HTML ||
      `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6;">
  <p>Hi ${escapeHtml(name)},</p>
  <p><strong>Thanks for contacting Curriculate — we’ll respond shortly.</strong></p>
  <p style="color:#6b7280;">— Curriculate Team</p>
</div>
      `.trim();

    const autoSend = await resend.emails.send({
      from,
      to: [email],
      replyTo: supportReplyTo, // sender can reply, it goes to support
      subject: autoSubject,
      text: autoText,
      html: autoHtml,
      headers: {
        // reduces chance of weird threading behavior
        "Auto-Submitted": "auto-replied",
        "X-Auto-Response-Suppress": "All",
      },
    });

    if (autoSend.error) {
      // Auto-reply failure should not fail the whole contact flow
      console.error("Resend auto-reply error:", autoSend.error);
    }

    return NextResponse.json({ ok: true, remaining: rl.remaining });
  } catch (err) {
    console.error("Contact route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
