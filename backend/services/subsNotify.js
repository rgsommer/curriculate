// backend/services/subsNotify.js
//
// Notification layer for the /subs app, abstracted behind a small
// interface so the escalation engine never talks to a provider directly.
//
//   notifier.sendOffer({ offer, request, teacher, school, gradeLevel })
//   notifier.notifyFilled({ request, teacher, school, gradeLevel, adminEmails })
//   notifier.notifyExhausted({ request, school, gradeLevel, adminEmails })
//
// Two channel adapters sit underneath:
//   • email — Resend if RESEND_API_KEY is set, else a console mock.
//   • sms   — console mock today.  TODO: plug in Twilio (see sendSms).
//
// Because both adapters fall back to console logging, the whole app runs
// end-to-end locally with no external accounts — exactly what the
// happy-path demo needs. Swap the adapters for real providers in prod.

const APP_BASE_URL = process.env.SUBS_BASE_URL || "https://curriculate.net/subs";
const EMAIL_FROM = process.env.SUBS_FROM || "Curriculate Subs <noreply@curriculate.net>";

// ── Channel adapters ──────────────────────────────────────────────────

// EMAIL. Real send via Resend when configured; otherwise log to console
// so local dev needs no API key.
async function sendEmail({ to, cc, subject, text, html }) {
  const ccList = (Array.isArray(cc) ? cc : cc ? [cc] : []).filter(Boolean);
  if (!process.env.RESEND_API_KEY) {
    console.log(`\n[subs:email:MOCK] → ${to}${ccList.length ? ` (cc: ${ccList.join(", ")})` : ""}\n  subject: ${subject}\n  ${text.replace(/\n/g, "\n  ")}\n`);
    return { ok: true, mock: true };
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], ...(ccList.length ? { cc: ccList } : {}), subject, text, html }),
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Resend ${r.status}: ${body.slice(0, 200)}`);
  }
  return { ok: true };
}

// Normalise a phone number to E.164 (required by AWS SNS). Defaults bare
// 10-digit numbers to North American (+1).
function toE164(num) {
  const s = String(num || "").trim();
  if (s.startsWith("+")) return s.replace(/[^\d+]/g, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits ? `+${digits}` : "";
}

// AWS SNS — cheaper than Twilio and reuses the AWS credentials/region the
// S3 client already uses (env vars or the host's IAM role). Lazy-imported
// so the dependency is only touched when SNS is actually enabled.
async function sendViaSns(to, text) {
  // SMS settings (sandbox, origination numbers, delivery logging) are
  // per-region — they MUST be configured in the same region we publish
  // from. SUBS_SNS_REGION lets SMS use a different region than S3.
  const region = process.env.SUBS_SNS_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
  const { SNSClient, PublishCommand } = await import("@aws-sdk/client-sns");
  const sns = new SNSClient({ region });
  const MessageAttributes = {
    // Transactional → higher delivery priority (e.g. urgent same-day offers).
    "AWS.SNS.SMS.SMSType": { DataType: "String", StringValue: "Transactional" },
  };
  if (process.env.SUBS_SNS_SENDER_ID) {
    MessageAttributes["AWS.SNS.SMS.SenderID"] = { DataType: "String", StringValue: process.env.SUBS_SNS_SENDER_ID };
  }
  const out = await sns.send(new PublishCommand({ PhoneNumber: toE164(to), Message: text, MessageAttributes }));
  // MessageId confirms SNS accepted it; actual carrier delivery depends on
  // sandbox status / a registered origination number (trace via CloudWatch).
  return { ok: true, messageId: out?.MessageId || null, region, provider: "sns" };
}

// Text Request (Esendex) — v3 REST API. Auth via x-api-key; a dashboard_id
// identifies the sending number. Needs TEXTREQUEST_API_KEY +
// TEXTREQUEST_DASHBOARD_ID (admin → API Access).
async function sendViaTextRequest(to, text) {
  const r = await fetch("https://api.textrequest.com/api/v3/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.TEXTREQUEST_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ dashboard_id: process.env.TEXTREQUEST_DASHBOARD_ID, phone_number: toE164(to), message_body: text }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`TextRequest ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json().catch(() => ({}));
  return { ok: true, messageId: data?.message_id || null, provider: "textrequest" };
}

// SMS. Picks a configured provider, else logs to the console so local dev
// needs no account. Order: Twilio → Text Request → AWS SNS → mock.
async function sendSms({ to, text }) {
  if (!to) return { ok: false, reason: "no_phone" };

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (sid && token && from) {
    // Twilio Messages API — form-encoded, HTTP basic auth (SID:token).
    const body = new URLSearchParams({ To: to, From: from, Body: text });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Twilio ${r.status}: ${t.slice(0, 200)}`);
    }
    return { ok: true, provider: "twilio" };
  }

  // Text Request (free during the 14-day trial; admin API key + dashboard).
  if (process.env.TEXTREQUEST_API_KEY && process.env.TEXTREQUEST_DASHBOARD_ID) {
    return sendViaTextRequest(to, text);
  }

  // AWS SNS — opt in explicitly so we never run up SMS charges by accident.
  if (process.env.SUBS_SNS_SMS === "1" || process.env.SUBS_SMS_PROVIDER === "sns") {
    return sendViaSns(to, text);
  }

  console.log(`\n[subs:sms:MOCK] → ${to}\n  ${text}\n`);
  return { ok: true, mock: true, provider: "mock" };
}

// ── Message builders ──────────────────────────────────────────────────

function offerLinks(offer) {
  // Token links let a teacher respond straight from the email/SMS.
  const base = `${APP_BASE_URL}/respond?token=${encodeURIComponent(offer.token)}`;
  return { accept: `${base}&action=accept`, decline: `${base}&action=decline`, page: base };
}

// Human label for the coverage window (whole/half/custom).
export function dayPartLabel(request) {
  switch (request?.dayPart) {
    case "am":
      return "half day (AM)";
    case "pm":
      return "half day (PM)";
    case "custom":
      return request.startTime && request.endTime ? `${request.startTime}–${request.endTime}` : "specific times";
    default:
      return "full day";
  }
}

// "Grade 5 (Mrs. Lackey)" — identify the class by grade + the absent
// teacher's name (no need to model 5A/5B sections).
function classLabel(request, gradeLevel) {
  const grade = gradeLevel?.name || "a class";
  const who = request.absentTeacher?.name ? ` (${request.absentTeacher.name})` : "";
  return `${grade}${who}`;
}

function describe(request, school, gradeLevel) {
  const when =
    request.urgency === "urgent" ? "TODAY (urgent)" : `on ${request.date}`;
  return `${classLabel(request, gradeLevel)} at ${school?.name || "a school"} ${when} (${dayPartLabel(request)})`;
}

// Short SMS-style line a multi-school sub can read at a glance, prefixed
// with the school abbreviation: "BCS: teach Gr5 (Mrs. Lackey) on 2026-06-05".
function shortLine(request, school, gradeLevel) {
  const tag = school?.abbrev || school?.name || "School";
  const role = request.requiredRole && request.requiredRole !== "teacher" ? request.requiredRole : "teach";
  return `${tag}: ${role} ${classLabel(request, gradeLevel)} on ${request.date} (${dayPartLabel(request)})`;
}

// Google Maps navigation link to the school (item: nav link for the sub).
function mapsLink(school) {
  const dest = [school?.name, school?.address].filter(Boolean).join(", ");
  return dest ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}` : "";
}

// ── Public interface ──────────────────────────────────────────────────

export function createNotifier() {
  return {
    async sendOffer({ offer, request, teacher, school, gradeLevel }) {
      const { accept, decline, page } = offerLinks(offer);
      const what = describe(request, school, gradeLevel);
      const tag = school?.abbrev || school?.name || "our school";
      const subject = `Invitation to sub at ${tag}: ${classLabel(request, gradeLevel)} on ${request.date}`;
      const text =
        `Hi ${teacher.name || "there"},\n\n` +
        `You're being offered a substitute teaching assignment for ${what}.\n` +
        (request.notes ? `Notes: ${request.notes}\n` : "") +
        `\nACCEPT: ${accept}\nDECLINE: ${decline}\n\n` +
        `If you don't respond, the assignment will be offered to the next teacher.`;
      const html =
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;max-width:520px;margin:24px auto;padding:24px;">` +
        `<h2 style="margin:0 0 12px;font-size:18px;">Substitute teaching offer</h2>` +
        `<p style="color:#475569;margin:0 0 8px;">Hi ${teacher.name || "there"}, you're being offered an assignment for <strong>${what}</strong>.</p>` +
        (request.notes ? `<p style="color:#475569;margin:0 0 8px;">Notes: ${request.notes}</p>` : "") +
        `<p style="margin:18px 0;"><a href="${accept}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;margin-right:8px;">Accept</a>` +
        `<a href="${decline}" style="background:#e2e8f0;color:#0f172a;padding:10px 18px;border-radius:8px;text-decoration:none;">Decline</a></p>` +
        `<p style="color:#94a3b8;font-size:.85rem;">If you don't respond, the assignment will be offered to the next teacher.</p></div>`;

      const channels = [];
      const prefs = teacher.contactPrefs || { email: true, sms: false };
      try {
        if (prefs.email !== false && teacher.email) {
          await sendEmail({ to: teacher.email, subject, text, html });
          channels.push("email");
        }
        if (prefs.sms && teacher.phone) {
          // Invitation framing + a single link to the page (which has both
          // Accept and Decline) — not an interactive 1/2 reply.
          await sendSms({ to: teacher.phone, text: `Invitation to sub at ${tag}: ${shortLine(request, school, gradeLevel)}. Accept or decline: ${page}` });
          channels.push("sms");
        }
      } catch (err) {
        console.error("[subs:sendOffer] dispatch error:", err?.message || err);
      }
      // Fall back to email if prefs left nothing dispatchable.
      if (channels.length === 0 && teacher.email) {
        try {
          await sendEmail({ to: teacher.email, subject, text, html });
          channels.push("email");
        } catch (err) {
          console.error("[subs:sendOffer] fallback email error:", err?.message || err);
        }
      }
      return channels;
    },

    // Invite a substitute to register with a school (multi-school flow).
    async notifyInvite({ email, phone, school, inviteLink }) {
      const name = school?.name || "A school";
      const text =
        `${name} has added you to their substitute teacher list on Curriculate Subs.\n\n` +
        `Sign in to set your contact preferences and see all the schools you're registered with:\n${inviteLink}`;
      const html =
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.55;color:#0f172a;max-width:520px;margin:24px auto;padding:24px;">` +
        `<h2 style="margin:0 0 12px;font-size:18px;">You're on ${name}'s substitute list</h2>` +
        `<p style="color:#475569;">Sign in to set your contact preferences (email / SMS) and see every school you're registered with.</p>` +
        `<p style="margin:18px 0;"><a href="${inviteLink}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;">Set up my profile</a></p></div>`;
      await sendEmail({ to: email, subject: `${name} added you as a substitute teacher`, text, html });
      if (phone) {
        await sendSms({ to: phone, text: `${school?.abbrev || name} added you to their sub list. Set up: ${inviteLink}` }).catch(() => {});
      }
    },

    async notifyFilled({ request, teacher, school, gradeLevel, adminEmails = [], vpEmail, financeEmail, absentTeacher }) {
      const what = describe(request, school, gradeLevel);
      const subName = teacher?.name || teacher?.email || "A substitute";

      // 1) Confirm to the substitute who accepted — include a Google Maps
      //    navigation link to the school for the day.
      if (teacher?.email) {
        const maps = mapsLink(school);
        const addr = school?.address ? `\nAddress: ${school.address}` : "";
        await sendEmail({
          to: teacher.email,
          subject: `Confirmed: ${what}`,
          text: `Thanks ${teacher.name || ""}! You're confirmed to substitute for ${what}.${addr}${maps ? `\nDirections: ${maps}` : ""}`,
          html:
            `<p>Thanks ${teacher.name || ""}! You're confirmed to substitute for <strong>${what}</strong>.</p>` +
            (school?.address ? `<p>${school.address}</p>` : "") +
            (maps ? `<p><a href="${maps}" style="background:#16a34a;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;">📍 Navigate (Google Maps)</a></p>` : ""),
        }).catch((e) => console.error("[subs:notifyFilled:teacher]", e?.message || e));
      }

      // 2) The VP handles lesson plans (the principal is done).
      if (vpEmail) {
        await sendEmail({
          to: vpEmail,
          subject: `Sub confirmed — lesson plans needed: ${what}`,
          text: `${subName} will cover ${what}. Please coordinate lesson plans${absentTeacher?.email ? ` with ${absentTeacher.name || absentTeacher.email}` : ""}.`,
          html: `<p><strong>${subName}</strong> will cover <strong>${what}</strong>. Please coordinate lesson plans${absentTeacher?.email ? ` with ${absentTeacher.name || absentTeacher.email}` : ""}.</p>`,
        }).catch((e) => console.error("[subs:notifyFilled:vp]", e?.message || e));
      }

      // 3) Finance is notified (budget / payroll).
      if (financeEmail) {
        await sendEmail({
          to: financeEmail,
          subject: `Sub booked: ${what}`,
          text: `${subName} is booked for ${what}${request.estimatedCost ? ` at an estimated $${request.estimatedCost}` : ""}.`,
          html: `<p><strong>${subName}</strong> is booked for <strong>${what}</strong>${request.estimatedCost ? ` at an estimated $${request.estimatedCost}` : ""}.</p>`,
        }).catch((e) => console.error("[subs:notifyFilled:finance]", e?.message || e));
      }

      // 4) The absent teacher: "X is covering for you — reply-all (VP cc'd)
      //    with your lesson plans." Cc the sub + VP so reply-all reaches both.
      if (absentTeacher?.email) {
        const cc = [teacher?.email, vpEmail].filter(Boolean);
        await sendEmail({
          to: absentTeacher.email,
          cc,
          subject: `Your ${gradeLevel?.name || "class"} is covered on ${request.date} — please send lesson plans`,
          text:
            `Hi ${absentTeacher.name || ""},\n\n${subName} will cover your ${gradeLevel?.name || "class"} on ${request.date}.\n\n` +
            `Please REPLY-ALL to this email with your lesson plans and any notes — your sub and VP are included.`,
          html:
            `<p>Hi ${absentTeacher.name || ""}, <strong>${subName}</strong> will cover your ${gradeLevel?.name || "class"} on ${request.date}.</p>` +
            `<p>Please <strong>reply-all</strong> with your lesson plans and any notes — your sub and VP are included.</p>`,
        }).catch((e) => console.error("[subs:notifyFilled:absent]", e?.message || e));
      }

      // 5b) Optional SMS to the principal/office mobile.
      if (school?.adminPhone) {
        await sendSms({ to: school.adminPhone, text: `${shortLine(request, school, gradeLevel)} — covered by ${subName}.` }).catch((e) =>
          console.error("[subs:notifyFilled:adminSms]", e?.message || e)
        );
      }

      // 5) Confirm to the admins (no action needed).
      for (const to of adminEmails) {
        await sendEmail({
          to,
          subject: `Sub filled: ${what}`,
          text: `${subName} accepted the assignment for ${what}. VP and finance have been notified.`,
          html: `<p><strong>${subName}</strong> accepted the assignment for ${what}. VP and finance have been notified.</p>`,
        }).catch((e) => console.error("[subs:notifyFilled:admin]", e?.message || e));
      }
    },

    // A sub cancelled after accepting — coverage fell through; we've resumed
    // contacting other subs, but the school should know.
    async notifyCancelled({ request, school, gradeLevel, adminEmails = [], vpEmail, financeEmail, teacher }) {
      const what = describe(request, school, gradeLevel);
      const subName = teacher?.name || teacher?.email || "The substitute";
      const recipients = [...new Set([...adminEmails, vpEmail].filter(Boolean))];
      for (const to of recipients) {
        await sendEmail({
          to,
          subject: `Heads up — sub cancelled: ${what}`,
          text: `${subName} cancelled their acceptance of ${what}. We're now contacting the next available subs. You'll be notified when it's covered again.`,
          html: `<p><strong>${subName}</strong> cancelled their acceptance of <strong>${what}</strong>. We're now contacting the next available subs — you'll be notified when it's covered again.</p>`,
        }).catch((e) => console.error("[subs:notifyCancelled]", e?.message || e));
      }
      // Finance: flag the cancellation so the sub isn't paid for this day.
      if (financeEmail) {
        await sendEmail({
          to: financeEmail,
          subject: `Do not pay — sub cancelled: ${what}`,
          text: `${subName} was booked for ${what} but cancelled, so the day did NOT go ahead with them. Please do not process payment for this assignment.`,
          html: `<p><strong>${subName}</strong> was booked for <strong>${what}</strong> but <strong>cancelled</strong>. Please do not process payment for this assignment.</p>`,
        }).catch((e) => console.error("[subs:notifyCancelled:finance]", e?.message || e));
      }
      if (school?.adminPhone) {
        await sendSms({ to: school.adminPhone, text: `${shortLine(request, school, gradeLevel)} — ${subName} CANCELLED; re-contacting others.` }).catch(() => {});
      }
    },

    // A staff teacher submitted an absence request — the principal needs to
    // approve before fulfillment starts.
    async notifyApprovalNeeded({ request, school, gradeLevel, absentTeacher, adminEmails = [], vpEmail, vpPhone, vpCanApprove }) {
      const what = describe(request, school, gradeLevel);
      const who = absentTeacher?.name || absentTeacher?.email || "A teacher";
      const reason = request.reason || "no reason given";

      // Principals/admins: it's theirs to action.
      for (const to of adminEmails) {
        await sendEmail({
          to,
          subject: `ACTION NEEDED — approve sub request: ${what}`,
          text: `${who} reported an absence (${reason}) and needs a sub for ${what}.\n\nACTION NEEDED: approve or deny in the dashboard.`,
          html: `<p><strong>${who}</strong> reported an absence (${reason}) and needs a sub for <strong>${what}</strong>.</p><p><strong>Action needed:</strong> approve or deny in the dashboard.</p>`,
        }).catch((e) => console.error("[subs:notifyApprovalNeeded:admin]", e?.message || e));
      }

      // VP: make crystal-clear whether it's theirs to action or just FYI.
      if (vpEmail && !adminEmails.includes(vpEmail)) {
        if (vpCanApprove) {
          await sendEmail({
            to: vpEmail,
            subject: `ACTION NEEDED — approve sub request: ${what}`,
            text: `${who} reported an absence (${reason}) for ${what}.\n\nThis one is yours to approve — please approve or deny in the app.`,
            html: `<p><strong>${who}</strong> reported an absence (${reason}) for <strong>${what}</strong>.</p><p><strong>Action needed — yours to approve:</strong> approve or deny in the app.</p>`,
          }).catch((e) => console.error("[subs:notifyApprovalNeeded:vp]", e?.message || e));
        } else {
          await sendEmail({
            to: vpEmail,
            subject: `FYI — sub request: ${what}`,
            text: `${who} reported an absence (${reason}) for ${what}.\n\nFYI only — the principal will approve this. No action needed from you.`,
            html: `<p><strong>${who}</strong> reported an absence (${reason}) for <strong>${what}</strong>.</p><p><em>FYI only — the principal will approve. No action needed from you.</em></p>`,
          }).catch((e) => console.error("[subs:notifyApprovalNeeded:vpfyi]", e?.message || e));
        }
      }

      // Text the VP only when it's THEIR decision to approve.
      if (vpCanApprove && vpPhone) {
        await sendSms({ to: vpPhone, text: `ACTION NEEDED — approve: ${who}, ${shortLine(request, school, gradeLevel)}. Approve/deny in the app.` }).catch(() => {});
      }
    },

    // On-demand absence report email to the principal (plain-text body
    // assembled by the route).
    async sendAbsenceReport({ to, schoolName, text }) {
      await sendEmail({
        to,
        subject: `Absence report — ${schoolName}`,
        text,
        html: `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;white-space:pre-wrap;">${text.replace(/</g, "&lt;")}</pre>`,
      });
    },

    // Tell the requesting teacher their absence request was approved/denied.
    async notifyRequestDecision({ request, school, gradeLevel, absentTeacher, approved, denyReason }) {
      if (!absentTeacher?.email) return;
      const what = describe(request, school, gradeLevel);
      const subject = approved ? `Approved: sub request for ${what}` : `Not approved: sub request for ${what}`;
      const body = approved
        ? `Your absence request for ${what} was approved — we're now contacting substitutes.`
        : `Your absence request for ${what} was not approved${denyReason ? `: ${denyReason}` : ""}. Please speak with your principal.`;
      await sendEmail({ to: absentTeacher.email, subject, text: body, html: `<p>${body}</p>` }).catch((e) =>
        console.error("[subs:notifyRequestDecision]", e?.message || e)
      );
    },

    async notifyExhausted({ request, school, gradeLevel, adminEmails = [], reason }) {
      const what = describe(request, school, gradeLevel);
      const lead =
        reason === "no_eligible"
          ? `No substitutes qualified for ${what} (check the required role/qualifications, or widen them).`
          : `We contacted every qualified substitute for ${what} and none accepted.`;
      const tail = "Consider internal coverage from the dashboard.";
      for (const to of adminEmails) {
        await sendEmail({
          to,
          subject: `Sub request needs attention: ${what}`,
          text: `${lead} ${tail}`,
          html: `<p>${lead}</p><p>${tail}</p>`,
        }).catch((e) => console.error("[subs:notifyExhausted]", e?.message || e));
      }
    },
  };
}

// Send a one-off test SMS so a user can confirm delivery from their
// profile. Returns sendSms's result ({ ok, mock? }) or throws on provider
// failure so the caller can surface the reason.
export async function sendTestSms(to) {
  return sendSms({
    to,
    text: "Curriculate Subs: this is a test message. If you got this, SMS is working — you'll receive sub offers here.",
  });
}

// Shared singleton for the running server.
export const notifier = createNotifier();
