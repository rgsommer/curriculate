/**
 * Field Day — email helper.
 *
 * Adapter over your existing Curriculate email mechanism. Three call sites:
 *   sendPasskeyEmail()      — admin sign-in
 *   sendCodeChangeEmail()   — confirmation code for school-code change
 *   sendInviteEmail()       — admin invites another admin to a school
 *
 * IMPORTANT: wire `transport()` below to your existing sender. Common patterns:
 *   - require('../email/sendEmail')   if you have a one-call helper
 *   - require('../email')             if it exposes { send } or similar
 *   - direct nodemailer / SES         if you don't have a wrapper yet
 *
 * The signature this file expects is:
 *   await transport({ from, fromName, to, subject, text, html })
 */
const FROM_NAME = "Curriculate Field Day";
const FROM_ADDR = process.env.FIELDDAY_FROM_ADDR || "fieldday@curriculate.net";

/* ---- transport adapter ---- */
let _transport = null;
function transport(payload) {
  if (_transport) return _transport(payload);
  // Default: try the common path. Override with setTransport() at app boot.
  try {
    const sender = require("../email"); // eslint-disable-line global-require
    if (sender && typeof sender.send === "function") {
      _transport = (p) => sender.send(p);
      return _transport(payload);
    }
    if (typeof sender === "function") {
      _transport = (p) => sender(p);
      return _transport(payload);
    }
  } catch (e) { /* fall through */ }
  console.warn("[fieldday/email] no transport configured — email not sent:", payload.subject, "→", payload.to);
  return Promise.resolve({ skipped: true });
}
function setTransport(fn) { _transport = fn; }

/* ---- helpers ---- */
function htmlShell(title, body) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1f36;line-height:1.5">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px">🏅 Curriculate Field Day</div>
    <div>${body}</div>
    <div style="color:#8993b0;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">
      If you didn't request this, you can ignore this message.
    </div>
  </div>`;
}

function bigCode(code) {
  return `<div style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;letter-spacing:.2em;font-weight:800;background:#e7eeff;color:#2956ff;padding:18px;border-radius:8px;text-align:center;margin:14px 0">${code}</div>`;
}

/* ---- specific senders ---- */
async function sendPasskeyEmail(toEmail, passkey) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: "Your Curriculate Field Day passkey",
    text: `Your Curriculate Field Day admin passkey is:\n\n   ${passkey}\n\nEnter this code on the sign-in screen to finish setting up your school. Save this email — you'll need this passkey every time you sign in as admin from a new device.\n\nIf you didn't request this, you can ignore this message.\n\n— Curriculate Field Day`,
    html: htmlShell("Passkey", `<p>Your admin passkey is:</p>${bigCode(passkey)}<p style="color:#5b6477;font-size:14px">Enter this code on the sign-in screen to finish setting up your school. Save this email — you'll need this passkey every time you sign in as admin from a new device.</p>`)
  });
}

async function sendCodeChangeEmail(toEmail, code, schoolName) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: `Confirmation code for changing the school code at ${schoolName}`,
    text: `An admin has requested a school-code change for ${schoolName}.\n\nConfirmation code:\n   ${code}\n\nIf you authorized this, share the code with the admin requesting the change. If you did NOT authorize this, ignore this email and the school code will not change.\n\n— Curriculate Field Day`,
    html: htmlShell("Code change", `<p>An admin has requested a school-code change for <strong>${schoolName}</strong>.</p><p>Confirmation code:</p>${bigCode(code)}<p style="color:#5b6477;font-size:14px">If you authorized this, share the code with the admin requesting the change. If you did NOT authorize this, ignore this email and the school code will not change.</p>`)
  });
}

async function sendInviteEmail(toEmail, schoolName, schoolCode, inviterEmail) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: `You've been invited to admin ${schoolName} on Field Day`,
    text: `${inviterEmail} has invited you to admin ${schoolName} on Curriculate Field Day.\n\nSchool code: ${schoolCode}\n\nGo to https://www.curriculate.net/fieldday → Enter as Admin → enter your email + passkey → Join an existing school with a code → enter ${schoolCode}.\n\n— Curriculate Field Day`,
    html: htmlShell("Invite", `<p><strong>${inviterEmail}</strong> has invited you to admin <strong>${schoolName}</strong> on Curriculate Field Day.</p><p>School code:</p>${bigCode(schoolCode)}<p>Go to <a href="https://www.curriculate.net/fieldday">curriculate.net/fieldday</a> → <em>Enter as Admin</em> → enter your email + passkey → <em>Join an existing school with a code</em>.</p>`)
  });
}

// Product blocks shared by both text + HTML email rendering.
const PRODUCT_INFO = {
  curriculate: {
    title: "Curriculate",
    url: "https://www.curriculate.net",
    short: "the platform that powers grading workflows + Field Day for teachers",
    bullets: [
      "AI-assisted feedback on student work",
      "Batch grading with consistent rubrics",
      "Parent-ready reports without the spreadsheet wrangling",
      "Built by and for classroom teachers"
    ],
    cta: "Visit Curriculate"
  },
  grading: {
    title: "Curriculate Grading",
    url: "https://www.curriculate.net/grading",
    short: "AI-assisted grading that gives teachers their evenings back",
    bullets: [
      "Upload student work, get rubric-aligned feedback drafts in seconds",
      "Reviewer remains the teacher — AI is a starting point, not a replacement",
      "Tracks grading usage per session for transparency",
      "Bulk export and parent-ready report generation"
    ],
    cta: "See Grading"
  },
  fieldday: {
    title: "Curriculate Field Day",
    url: "https://www.curriculate.net/meet-fieldday",
    short: "the free school field day app",
    bullets: [
      "Times every race to the hundredth with a multi-runner stopwatch",
      "Scores by placement, by standards, or both at once",
      "Tracks school records & personal bests with a horn fanfare on each new record",
      "Handles houses, divisions, heats, and relay events",
      "Imports your roster from one Excel workbook; prints Avery 1\"x1\" ribbon labels"
    ],
    cta: "Take a look"
  }
};

function pickProducts(products) {
  // Always preserve the order: curriculate, grading, fieldday.
  const order = ["curriculate", "grading", "fieldday"];
  const set = new Set((Array.isArray(products) ? products : []).map(p => String(p).toLowerCase()));
  const list = order.filter(p => set.has(p));
  // Backwards compatibility: if no products were specified, default to fieldday.
  return list.length > 0 ? list : ["fieldday"];
}

function subjectFor(senderName, picked) {
  if (picked.length === 1) {
    return `${senderName} thought you'd like ${PRODUCT_INFO[picked[0]].title}`;
  }
  if (picked.length === 2) {
    return `${senderName} thought you'd like ${PRODUCT_INFO[picked[0]].title} and ${PRODUCT_INFO[picked[1]].title}`;
  }
  return `${senderName} thought you'd like Curriculate (Grading + Field Day)`;
}

async function sendReferEmail({ teacherName, teacherEmail, schoolName, senderName, senderSchool, products }) {
  const picked = pickProducts(products);
  const subject = subjectFor(senderName, picked);

  const intro = `Hi ${teacherName},

${senderName}${senderSchool ? ` from ${senderSchool}` : ""} thought you might find ${picked.length > 1 ? "these" : "this"} useful at ${schoolName || "your school"}.`;

  const textBlocks = picked.map(key => {
    const p = PRODUCT_INFO[key];
    return `\n\n${p.title} — ${p.short}\n${p.url}\n\n${p.bullets.map(b => "  • " + b).join("\n")}`;
  }).join("");

  const text = `${intro}${textBlocks}\n\n— Curriculate`;

  const htmlBlocks = picked.map(key => {
    const p = PRODUCT_INFO[key];
    return `
      <div style="border:1px solid #e6e8ef;border-radius:10px;padding:16px;margin-top:14px">
        <div style="font-size:18px;font-weight:700;color:#2956ff">${p.title}</div>
        <div style="color:#5b6477;font-size:14px;margin-bottom:8px">${p.short}</div>
        <ul style="padding-left:20px;color:#444;margin:8px 0">${p.bullets.map(b => `<li>${b}</li>`).join("")}</ul>
        <a href="${p.url}" style="display:inline-block;background:#2956ff;color:white;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${p.cta} →</a>
      </div>`;
  }).join("");

  const html = htmlShell("You've been recommended Curriculate", `
    <p>Hi ${teacherName},</p>
    <p><strong>${senderName}</strong>${senderSchool ? ` from <strong>${senderSchool}</strong>` : ""} thought you might find ${picked.length > 1 ? "these" : "this"} useful at ${schoolName ? `<strong>${schoolName}</strong>` : "your school"}.</p>
    ${htmlBlocks}
    <p style="color:#5b6477;font-size:13px;margin-top:16px">No mailing list. No follow-ups. Just one email forward from someone you know.</p>
  `);

  return transport({ from: FROM_ADDR, fromName: FROM_NAME, to: teacherEmail, subject, text, html });
}

async function sendReportEmail({ kind, message, fromName, fromEmail, schoolCode, context }) {
  const subject = `[Field Day ${kind === "problem" ? "🐞 Problem" : "💡 Suggestion"}] ${message.slice(0, 60)}${message.length > 60 ? "…" : ""}`;
  const text = `Type: ${kind}
From: ${fromName || "(anonymous)"} ${fromEmail ? `<${fromEmail}>` : ""}
School code: ${schoolCode || "(none)"}

Message:
${message}

—
Context:
${JSON.stringify(context || {}, null, 2)}`;
  const html = htmlShell("Report",
    `<p style="font-size:13px;color:#5b6477">Type: <strong>${kind}</strong> · From: ${fromName || "(anonymous)"}${fromEmail ? ` &lt;${fromEmail}&gt;` : ""} · School: ${schoolCode || "(none)"}</p>
    <div style="background:#f7f8fc;border:1px solid #e6e8ef;padding:12px;border-radius:8px;white-space:pre-wrap">${(message || "").replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</div>
    <details style="margin-top:14px;color:#8993b0;font-size:12px"><summary>Context</summary><pre style="background:#f7f8fc;padding:10px;border-radius:6px;overflow:auto">${JSON.stringify(context || {}, null, 2)}</pre></details>`);
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME,
    to: process.env.FIELDDAY_REPORTS_TO || "admin@curriculate.net",
    replyTo: fromEmail || undefined,
    subject, text, html
  });
}

module.exports = { sendPasskeyEmail, sendCodeChangeEmail, sendInviteEmail, sendReferEmail, sendReportEmail, setTransport };
