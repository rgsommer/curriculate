import { NextResponse } from "next/server";
import { Resend } from "resend";
import { MongoClient } from "mongodb";

/* ------------------------------------------------------------------ */
/*  POST /api/beta — beta sign-up.                                     */
/*  Mirrors the contact-form pattern: rate-limit by IP, persist to     */
/*  Mongo, send an internal notification, send an auto-reply with the  */
/*  beta welcome + setup links.                                        */
/* ------------------------------------------------------------------ */

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY || "re_dev_placeholder");
  return _resend;
}

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getMongoClientPromise() {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;
  if (!global._mongoClientPromise) {
    const client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  return global._mongoClientPromise;
}

const RATE_WINDOW_MS = Number(process.env.BETA_RATE_WINDOW_MS || 10 * 60 * 1000);
const RATE_MAX = Number(process.env.BETA_RATE_MAX || 4);
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
  const raw =
    process.env.BETA_TO_EMAILS ||
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
    const ip = getClientIp(req);
    const rl = checkRateLimit(ip);
    if (!rl.ok) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
      );
    }

    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const school = typeof body?.school === "string" ? body.school.trim() : "";
    const gradeBand =
      typeof body?.gradeBand === "string" ? body.gradeBand.trim() : "";
    const subject =
      typeof body?.subject === "string" ? body.subject.trim() : "";
    const intent = typeof body?.intent === "string" ? body.intent.trim() : "";
    const hp = typeof body?.company === "string" ? body.company.trim() : "";

    // Brand detection. qrewzi-web's proxy sets source:"qrewzi" in the body
    // and x-forwarded-source:"qrewzi-web" in the headers. Either matches.
    const forwardedSource = req.headers.get("x-forwarded-source") || "";
    const bodySource = typeof body?.source === "string" ? body.source.toLowerCase() : "";
    const isQrewzi = bodySource === "qrewzi" || forwardedSource === "qrewzi-web";
    if (hp) {
      // honeypot — silently accept
      return NextResponse.json({ ok: true });
    }

    if (!name || !email || !gradeBand || !subject) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const toEmails = normalizeToEmails();
    const utm = {
      source: req.headers.get("referer") || "",
    };

    // Persist to Mongo.
    const mongoPromise = getMongoClientPromise();
    if (mongoPromise) {
      try {
        const client = await mongoPromise;
        const dbName = process.env.MONGODB_DB || "curriculate";
        const colName = process.env.BETA_COLLECTION || "betaSignups";
        const col = client.db(dbName).collection(colName);
        await col.insertOne({
          name,
          email,
          school,
          gradeBand,
          subject,
          intent,
          ip,
          referer: utm.source,
          userAgent: req.headers.get("user-agent") || "",
          createdAt: new Date(),
          source: isQrewzi ? "qrewzi-beta" : "beta-form",
          brand: isQrewzi ? "qrewzi" : "curriculate",
        });
      } catch (mongoErr) {
        console.error("Mongo insert error:", mongoErr);
      }
    }

    // Brand-specific sender identity. Falls back to the Curriculate address
    // when BETA_FROM_QREWZI is unset — this happens BEFORE qrewzi.com is
    // verified in Resend. Once verified, set BETA_FROM_QREWZI in Vercel env
    // (e.g. "Qrewzi <noreply@qrewzi.com>") to fully seal the leak.
    const from = isQrewzi
      ? (process.env.BETA_FROM_QREWZI ||
         process.env.BETA_FROM ||
         "Curriculate <noreply@curriculate.net>")
      : (process.env.BETA_FROM ||
         process.env.CONTACT_FROM ||
         "Curriculate <noreply@curriculate.net>");
    const supportReplyTo = isQrewzi
      ? (process.env.BETA_REPLYTO_QREWZI ||
         process.env.BETA_REPLYTO ||
         "support@curriculate.net")
      : (process.env.BETA_REPLYTO ||
         process.env.CONTACT_REPLYTO ||
         "support@curriculate.net");

    // Internal notification.
    const internalSubject = isQrewzi
      ? `[Qrewzi] Beta sign-up: ${name} (${gradeBand} ${subject})`
      : `Beta sign-up: ${name} (${gradeBand} ${subject})`;
    const internalText = `
New beta sign-up from curriculate.net/beta

Name: ${name}
Email: ${email}
School: ${school || "(not provided)"}
Grade band: ${gradeBand}
Subject: ${subject}

What they'd try first:
${intent || "(not provided)"}

IP: ${ip}
Referer: ${utm.source}
    `.trim();

    const internalHtml = `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.6;">
  <h2 style="margin:0 0 12px 0;">New beta sign-up</h2>
  <p style="margin:0 0 6px 0;"><strong>Name:</strong> ${escapeHtml(name)}</p>
  <p style="margin:0 0 6px 0;"><strong>Email:</strong> ${escapeHtml(email)}</p>
  <p style="margin:0 0 6px 0;"><strong>School:</strong> ${escapeHtml(school || "—")}</p>
  <p style="margin:0 0 6px 0;"><strong>Grade band:</strong> ${escapeHtml(gradeBand)}</p>
  <p style="margin:0 0 6px 0;"><strong>Subject:</strong> ${escapeHtml(subject)}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;" />
  <p style="margin:0 0 6px 0;"><strong>What they'd try first:</strong></p>
  <p style="white-space: pre-wrap; margin:0;">${escapeHtml(intent || "—")}</p>
</div>
    `.trim();

    const internalSend = await getResend().emails.send({
      from,
      to: toEmails,
      replyTo: email,
      subject: internalSubject,
      text: internalText,
      html: internalHtml,
      headers: { "X-Entity-Ref-ID": `beta-${Date.now()}` },
    });

    if (internalSend.error) {
      console.error("Resend internal error:", internalSend.error);
      return NextResponse.json({ error: "Failed to send" }, { status: 500 });
    }

    // Welcome auto-reply — brand-branched.
    const firstName = name.split(/\s+/)[0] || name;

    const autoSubject = isQrewzi
      ? "You're in the Qrew — welcome to the Qrewzi beta"
      : "Welcome to Curriculate Beta";

    const autoText = isQrewzi
      ? `Hi ${firstName},

You're in the Qrewzi beta — welcome to the Qrew. 🦊

Qrewzi turns any lesson into a live team scavenger hunt: 30+ interactive
task types, GameMaster projector dashboard, hidden team superpowers.
Beta teachers get everything free through the end of the school year.

Two doors:

1. See how it works — https://qrewzi.com/how-it-works
   Five-minute teacher walkthrough.

2. Browse features — https://qrewzi.com/features
   Every task type, device mode, and superpower.

If you'd like a short walkthrough call, reply to this email and I'll
send a calendar link. Otherwise, dive in.

I read every reply.

— Richard
Qrewzi`
      : `Hi ${firstName},

You're in the Curriculate beta — thank you.

Two doors:

1. Pulse Grading — https://curriculate.net/grading
   Snap a paper, get a graded result in seconds.

2. Live Sessions — https://curriculate.net/sessions
   Pick a Quick Start preset and run it with your class.

If you'd like a 10-minute walkthrough, reply to this email and I'll
send a calendar link. Otherwise, dive in.

I read every reply.

— Richard
Curriculate`;

    const autoHtml = isQrewzi
      ? `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.65; color:#0B1F3A; max-width: 560px;">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p><strong>You're in the Qrewzi beta — welcome to the Qrew. 🦊</strong></p>
  <p>Qrewzi turns any lesson into a live team scavenger hunt: 30+ interactive task types, GameMaster projector dashboard, hidden team superpowers. Beta teachers get everything free through the end of the school year.</p>
  <p>Two doors:</p>
  <div style="margin: 16px 0; padding: 14px 18px; border-radius: 12px; background: #FEF9F0; border: 2px solid #FF4D5B;">
    <div style="font-weight: 800; color:#0B1F3A;">1. See how it works</div>
    <div style="font-size: 14px; margin: 4px 0 8px; color:#4A5B7A;">Five-minute teacher walkthrough.</div>
    <a href="https://qrewzi.com/how-it-works" style="color:#FF4D5B; font-weight:700;">Open the walkthrough →</a>
  </div>
  <div style="margin: 16px 0; padding: 14px 18px; border-radius: 12px; background: #FEF9F0; border: 2px solid #0B1F3A;">
    <div style="font-weight: 800; color:#0B1F3A;">2. Browse features</div>
    <div style="font-size: 14px; margin: 4px 0 8px; color:#4A5B7A;">Every task type, device mode, and superpower.</div>
    <a href="https://qrewzi.com/features" style="color:#0B1F3A; font-weight:700;">See features →</a>
  </div>
  <p>If you'd like a short walkthrough call, reply to this email and I'll send a calendar link. Otherwise, dive in.</p>
  <p style="color:#4A5B7A;">I read every reply.</p>
  <p style="margin-top: 18px;">— Richard<br/>Qrewzi</p>
</div>
      `.trim()
      : `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; line-height: 1.65; color:#111827; max-width: 560px;">
  <p>Hi ${escapeHtml(firstName)},</p>
  <p><strong>You're in the Curriculate beta — thank you.</strong></p>
  <p>Two doors:</p>
  <div style="margin: 16px 0; padding: 14px 18px; border-radius: 12px; background: #eef2ff; border: 1px solid #c7d2fe;">
    <div style="font-weight: 800; color:#3730a3;">1. Pulse Grading</div>
    <div style="font-size: 14px; margin: 4px 0 8px;">Snap a paper, get a graded result in seconds.</div>
    <a href="https://curriculate.net/grading" style="color:#4338ca; font-weight:700;">Open Pulse Grading →</a>
  </div>
  <div style="margin: 16px 0; padding: 14px 18px; border-radius: 12px; background: #f5f3ff; border: 1px solid #ddd6fe;">
    <div style="font-weight: 800; color:#5b21b6;">2. Live Sessions</div>
    <div style="font-size: 14px; margin: 4px 0 8px;">Pick a Quick Start preset and run it with your class.</div>
    <a href="https://curriculate.net/sessions" style="color:#6d28d9; font-weight:700;">Open Live Sessions →</a>
  </div>
  <p>If you'd like a 10-minute walkthrough, reply to this email and I'll send a calendar link. Otherwise, dive in.</p>
  <p style="color:#6b7280;">I read every reply.</p>
  <p style="margin-top: 18px;">— Richard<br/>Curriculate</p>
</div>
      `.trim();

    const autoSend = await getResend().emails.send({
      from,
      to: [email],
      replyTo: supportReplyTo,
      subject: autoSubject,
      text: autoText,
      html: autoHtml,
      headers: {
        "Auto-Submitted": "auto-replied",
        "X-Auto-Response-Suppress": "All",
      },
    });

    if (autoSend.error) {
      console.error("Resend auto-reply error:", autoSend.error);
    }

    return NextResponse.json({ ok: true, remaining: rl.remaining });
  } catch (err) {
    console.error("Beta route error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
