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

module.exports = { sendPasskeyEmail, sendCodeChangeEmail, sendInviteEmail, setTransport };
