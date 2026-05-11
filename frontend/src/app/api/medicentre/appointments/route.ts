/**
 * POST /api/medicentre/appointments
 *
 * Verifies the PIN sent to the patient/booker email, then sends:
 *   1. an office notification with all intake details
 *   2. a confirmation receipt back to the patient/booker
 *
 * Required env vars:
 *   RESEND_API_KEY              — Resend API key
 *   MEDICENTRE_SECRET           — HMAC secret (must match request-pin)
 *   MEDICENTRE_FROM             — From: line for outbound mail
 *   MEDICENTRE_OFFICE_EMAIL     — Reception address that receives new requests
 *
 * (Optional) MEDICENTRE_OUTLOOK_TENANT / MEDICENTRE_OUTLOOK_CLIENT_ID / ...
 *           — when Microsoft Graph is wired in, this is where it plugs.
 */

import { NextResponse } from "next/server";
import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

// ---------- per-IP rate limit (6 submissions / 10 min) ----------
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 6;
const rateMap = new Map<string, { count: number; resetAt: number }>();

function getClientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function rateOk(ip: string) {
  const now = Date.now();
  const e = rateMap.get(ip);
  if (!e || now > e.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (e.count >= RATE_MAX) return false;
  e.count++;
  return true;
}

// ---------- token verification (same scheme as request-pin) ----------
function fromB64url(s: string) {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4), "base64");
}

function verifyToken(token: string): { email: string; ph: string; exp: number } | null {
  const secret = process.env.MEDICENTRE_SECRET;
  if (!secret || !token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", secret).update(body).digest();
  let provided: Buffer;
  try {
    provided = fromB64url(sig);
  } catch {
    return null;
  }
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) return null;
  try {
    const payload = JSON.parse(fromB64url(body).toString("utf8"));
    if (typeof payload.email !== "string" || typeof payload.ph !== "string" || typeof payload.exp !== "number") return null;
    if (Math.floor(Date.now() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function pinHash(pin: string, email: string) {
  const secret = process.env.MEDICENTRE_SECRET || "";
  return crypto.createHash("sha256").update(pin + "|" + email.toLowerCase() + "|" + secret).digest("hex");
}

// ---------- small helpers ----------
function esc(s: unknown) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pickStr(v: unknown, max = 4000) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function pickStrArr(v: unknown, max = 20) {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max) : [];
}

// ---------- handler ----------
export async function POST(req: Request) {
  try {
    if (
      !process.env.RESEND_API_KEY ||
      !process.env.MEDICENTRE_SECRET ||
      !process.env.MEDICENTRE_OFFICE_EMAIL
    ) {
      return NextResponse.json({ error: "Service not configured" }, { status: 500 });
    }

    const ip = getClientIp(req);
    if (!rateOk(ip)) {
      return NextResponse.json(
        { error: "Too many submissions. Please call (289) 895-7862 instead." },
        { status: 429 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

    // honeypot field — pretend success if filled (bots)
    if (typeof body.company === "string" && body.company.trim()) {
      return NextResponse.json({ ok: true, id: "APT-" + Math.random().toString(36).slice(2, 8).toUpperCase() });
    }

    const token = pickStr(body.token, 4000);
    const pin = pickStr(body.pin, 5);

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: "Your verification expired. Please request a new code." },
        { status: 400 }
      );
    }
    if (!/^\d{5}$/.test(pin) || pinHash(pin, payload.email) !== payload.ph) {
      return NextResponse.json({ error: "That verification code doesn't match." }, { status: 400 });
    }

    // ----- pull intake -----
    const d = {
      bookingFor: pickStr(body.bookingFor, 16) || "Self",
      bookerName: pickStr(body.bookerName, 120),
      bookerRelation: pickStr(body.bookerRelation, 60),
      bookerEmail: pickStr(body.bookerEmail, 200),
      bookerPhone: pickStr(body.bookerPhone, 60),

      firstName: pickStr(body.firstName, 80),
      lastName: pickStr(body.lastName, 80),
      email: pickStr(body.email, 200),
      phone: pickStr(body.phone, 60),
      address: pickStr(body.address, 200),
      dob: pickStr(body.dob, 20),
      ohip: pickStr(body.ohip, 40),

      preferredDoctor: pickStr(body.preferredDoctor, 80),
      flexibleOnDoctor: !!body.flexibleOnDoctor,
      visitCategory: pickStr(body.visitCategory, 30),
      urgency: pickStr(body.urgency, 60),
      previousDoctor: pickStr(body.previousDoctor, 200),
      previousDoctorLastVisit: pickStr(body.previousDoctorLastVisit, 80),
      recordsTransfer: pickStr(body.recordsTransfer, 20),
      medicalConditions: pickStr(body.medicalConditions, 2000),
      medications: pickStr(body.medications, 2000),
      allergies: pickStr(body.allergies, 500),
      surgeries: pickStr(body.surgeries, 2000),
      familyHistory: pickStr(body.familyHistory, 2000),
      followupContext: pickStr(body.followupContext, 500),
      symptoms: pickStr(body.symptoms, 4000),
      timing: pickStrArr(body.timing, 20).map((s) => String(s).slice(0, 60)),
      visitType: pickStr(body.visitType, 30),
      notes: pickStr(body.notes, 2000),
    };

    // The PIN was sent to either the booker's email (when booking for someone else) or the patient's email.
    const verifyEmail = d.bookingFor === "Other" ? d.bookerEmail : d.email;
    if (verifyEmail.toLowerCase() !== payload.email) {
      return NextResponse.json(
        { error: "The email used to verify doesn't match the booking email." },
        { status: 400 }
      );
    }

    if (!d.firstName || !d.lastName || !d.dob || !d.symptoms) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const id = "APT-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    const submittedAt = new Date();

    const from = process.env.MEDICENTRE_FROM ||
      "St. George Medical Centre <noreply@curriculate.net>";
    const officeTo = process.env.MEDICENTRE_OFFICE_EMAIL!;

    // ----- office email -----
    const tag = d.visitCategory ? `[${d.visitCategory.toUpperCase()}] ` : "";
    const officeSubject = `${tag}Appointment request — ${d.firstName} ${d.lastName} (${id})`;

    const bookerBlock = d.bookingFor === "Other"
      ? `\nBOOKED BY (NOT THE PATIENT)
  Name:     ${d.bookerName || "(not provided)"}
  Relation: ${d.bookerRelation || "(not provided)"}
  Email:    ${d.bookerEmail || "(not provided)"}
  Phone:    ${d.bookerPhone || "(not provided)"}\n`
      : "";

    const newPatientBlock = d.visitCategory === "New patient"
      ? `
  Previous doctor:  ${d.previousDoctor || "(not specified)"}${d.previousDoctorLastVisit ? " (last seen " + d.previousDoctorLastVisit + ")" : ""}
  Records transfer: ${d.recordsTransfer || "(not specified)"}
  Conditions:       ${d.medicalConditions || "(none listed)"}
  Medications:      ${d.medications || "(none listed)"}
  Allergies:        ${d.allergies || "(none listed)"}
  Surgeries/hosp.:  ${d.surgeries || "(none listed)"}
  Family history:   ${d.familyHistory || "(none listed)"}`
      : "";

    const officeText =
`A new appointment request was submitted via the website.

Reference:    ${id}
Submitted:    ${submittedAt.toLocaleString()}
Visit type:   ${d.visitCategory || "(not specified)"}${d.visitCategory === "Urgent" && d.urgency ? "  [" + d.urgency + "]" : ""}
${bookerBlock}
PATIENT
  Name:    ${d.firstName} ${d.lastName}
  Email:   ${d.email || "(not provided)"}
  Phone:   ${d.phone || "(not provided)"}
  Address: ${d.address || "(not provided)"}
  DOB:     ${d.dob || "(not provided)"}
  OHIP:    ${d.ohip || "(not provided)"}

REQUEST
  Preferred doctor: ${d.preferredDoctor || "Any available"}${d.preferredDoctor && d.preferredDoctor !== "Any available" && d.preferredDoctor !== "Walk-in / Urgent" ? (d.flexibleOnDoctor ? "  (or any if unavailable)" : "  (this doctor only — patient prefers to wait)") : ""}
  Category:         ${d.visitCategory || "(not specified)"}${newPatientBlock}
  ${d.visitCategory === "Follow-up" ? "Following up on:  " + (d.followupContext || "(not specified)") : ""}
  Visit format:     ${d.visitType || "(not specified)"}
  Timing prefs:     ${d.timing.length ? d.timing.join(", ") : "(none)"}

REASON FOR VISIT
${d.symptoms || ""}

ADDITIONAL NOTES
${d.notes || "(none)"}

—
✓ Email verified via 5-digit PIN.
Please review and confirm via the Admin dashboard.
St. George Medical Centre Waterdown`;

    const officeSend = await resend.emails.send({
      from,
      to: officeTo,
      replyTo: verifyEmail,
      subject: officeSubject,
      text: officeText,
      headers: { "X-Entity-Ref-ID": `medicentre-apt-${id}` },
    });

    if (officeSend.error) {
      console.error("Resend office error:", officeSend.error);
      return NextResponse.json({ error: "Could not deliver to the clinic." }, { status: 502 });
    }

    // ----- patient confirmation -----
    const patientName = d.firstName || (d.bookingFor === "Other" ? d.bookerName.split(" ")[0] : "there");
    const patientSubject = `We received your appointment request — St. George Medical Centre Waterdown (${id})`;
    const patientText =
`Hi ${patientName},

Thank you for submitting an appointment request with St. George Medical Centre Waterdown. Our reception team will review your preferences and confirm your appointment shortly.

YOUR REQUEST
  Reference:        ${id}
  Preferred doctor: ${d.preferredDoctor || "Any available"}${d.preferredDoctor && d.preferredDoctor !== "Any available" && d.preferredDoctor !== "Walk-in / Urgent" ? (d.flexibleOnDoctor ? "  (or any if unavailable)" : "  (this doctor only)") : ""}
  Visit type:       ${d.visitCategory || "(not specified)"}${d.urgency ? "  [" + d.urgency + "]" : ""}
  Visit format:     ${d.visitType || "(not specified)"}
  Timing prefs:     ${d.timing.length ? d.timing.join(", ") : "(none)"}

Reason for visit:
${d.symptoms || ""}

If anything changes, please call (289) 895-7862.

— St. George Medical Centre Waterdown
250 Dundas St E, Unit 3, Waterdown, ON L8B 0E7`;

    const patientHtml = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#1F2A35;max-width:560px;">
<h2 style="color:#074463;font-family:Georgia,serif;margin:0 0 .75rem;">We've received your request</h2>
<p>Hi ${esc(patientName)},</p>
<p>Thank you for booking with St. George Medical Centre Waterdown. Our reception team will review your preferences and confirm your appointment shortly.</p>
<table style="border-collapse:collapse;font-size:.95rem;margin:1rem 0;">
  <tr><td style="padding:.3rem 1rem .3rem 0;color:#5A6B78;">Reference</td><td><code>${esc(id)}</code></td></tr>
  <tr><td style="padding:.3rem 1rem .3rem 0;color:#5A6B78;">Preferred doctor</td><td>${esc(d.preferredDoctor || "Any available")}${d.preferredDoctor && d.preferredDoctor !== "Any available" && d.preferredDoctor !== "Walk-in / Urgent" ? ` <span style="font-size:.82rem;color:#357A5E;">${d.flexibleOnDoctor ? "(or any if unavailable)" : "(this doctor only)"}</span>` : ""}</td></tr>
  <tr><td style="padding:.3rem 1rem .3rem 0;color:#5A6B78;">Visit type</td><td>${esc(d.visitCategory || "—")}${d.urgency ? " <span style=\"color:#5A6B78;\">[" + esc(d.urgency) + "]</span>" : ""}</td></tr>
  <tr><td style="padding:.3rem 1rem .3rem 0;color:#5A6B78;vertical-align:top;">Timing prefs</td><td>${d.timing.length ? esc(d.timing.join(", ")) : "—"}</td></tr>
</table>
<p style="color:#5A6B78;font-size:.92rem;">If anything changes, please call <a href="tel:+12898957862" style="color:#0E5C7E;">(289) 895-7862</a>.</p>
<hr style="border:0;border-top:1px solid #E1E8EC;margin:1.5rem 0;" />
<p style="color:#5A6B78;font-size:.85rem;">
  St. George Medical Centre Waterdown<br>
  250 Dundas St E, Unit 3 · Waterdown, ON L8B 0E7
</p>
</div>`;

    const patientSend = await resend.emails.send({
      from,
      to: verifyEmail,
      subject: patientSubject,
      text: patientText,
      html: patientHtml,
      headers: { "X-Entity-Ref-ID": `medicentre-receipt-${id}` },
    });

    if (patientSend.error) {
      // Don't fail the request — the clinic still got the notification.
      console.error("Resend patient confirm error:", patientSend.error);
    }

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("appointments error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
