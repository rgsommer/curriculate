/**
 * Field Day — email helper (ESM).
 *
 * Adapter over the existing Curriculate email mechanism.
 */
const FROM_NAME = "Curriculate Field Day";
const FROM_ADDR = process.env.FIELDDAY_FROM_ADDR || "fieldday@curriculate.net";

let _transport = null;
async function transport(payload) {
  if (_transport) return _transport(payload);
  try {
    const mod = await import("../email/shareInviteEmailer.js");
    if (mod.sendSystemEmail) {
      _transport = (p) => mod.sendSystemEmail({
        from: `${p.fromName || FROM_NAME} <${p.from || FROM_ADDR}>`,
        to: p.to,
        subject: p.subject,
        text: p.text,
        html: p.html,
        replyTo: p.replyTo,
        attachments: p.attachments,
      });
      return _transport(payload);
    }
  } catch (e) { /* fall through */ }
  console.warn("[fieldday/email] no transport configured — email not sent:", payload.subject, "→", payload.to);
  return { skipped: true };
}
export function setTransport(fn) { _transport = fn; }

function htmlShell(title, body) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1f36;line-height:1.5">
    <div style="font-size:18px;font-weight:700;margin-bottom:12px">🏅 Curriculate Field Day</div>
    <div>${body}</div>
    <div style="color:#8993b0;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">If you didn't request this, you can ignore this message.</div>
  </div>`;
}
function bigCode(code) {
  return `<div style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;letter-spacing:.2em;font-weight:800;background:#e7eeff;color:#2956ff;padding:18px;border-radius:8px;text-align:center;margin:14px 0">${code}</div>`;
}

export async function sendPasskeyEmail(toEmail, passkey) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: "Your Curriculate Field Day passkey",
    text: `Your Curriculate Field Day admin passkey is:\n\n   ${passkey}\n\nEnter this code on the sign-in screen to finish setting up your school.\n\n— Curriculate Field Day`,
    html: htmlShell("Passkey", `<p>Your admin passkey is:</p>${bigCode(passkey)}<p style="color:#5b6477;font-size:14px">Enter this code on the sign-in screen to finish setting up your school. Save this email — you'll need this passkey every time you sign in as admin from a new device.</p>`)
  });
}

export async function sendCodeChangeEmail(toEmail, code, schoolName) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: `Confirmation code for changing the school code at ${schoolName}`,
    text: `An admin has requested a school-code change for ${schoolName}.\n\nConfirmation code:\n   ${code}\n\nIf you authorized this, share the code with the admin requesting the change.\n\n— Curriculate Field Day`,
    html: htmlShell("Code change", `<p>An admin has requested a school-code change for <strong>${schoolName}</strong>.</p><p>Confirmation code:</p>${bigCode(code)}`)
  });
}

export async function sendInviteEmail(toEmail, schoolName, schoolCode, inviterEmail) {
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME, to: toEmail,
    subject: `You've been invited to admin ${schoolName} on Field Day`,
    text: `${inviterEmail} has invited you to admin ${schoolName} on Curriculate Field Day.\n\nSchool code: ${schoolCode}\n\nGo to https://www.curriculate.net/fieldday\n\n— Curriculate Field Day`,
    html: htmlShell("Invite", `<p><strong>${inviterEmail}</strong> has invited you to admin <strong>${schoolName}</strong>.</p><p>School code:</p>${bigCode(schoolCode)}<p>Go to <a href="https://www.curriculate.net/fieldday">curriculate.net/fieldday</a>.</p>`)
  });
}

const PRODUCT_INFO = {
  curriculate: { title: "Curriculate", url: "https://www.curriculate.net", short: "the platform that powers grading workflows + Field Day", bullets: ["AI-assisted feedback","Batch grading","Parent-ready reports","Built by teachers"], cta: "Visit Curriculate" },
  grading:     { title: "Curriculate Grading", url: "https://www.curriculate.net/grading", short: "AI-assisted grading", bullets: ["Rubric-aligned feedback drafts","Teacher remains the reviewer","Bulk export"], cta: "See Grading" },
  fieldday:    { title: "Curriculate Field Day", url: "https://www.curriculate.net/meet-fieldday", short: "the free school field day app", bullets: ["Hundredths-precision multi-runner stopwatch","Placement and standards-based scoring","Records & PBs with horn fanfare","Houses, divisions, heats, relays","Excel workbook import","Printable 1\"x1\" Avery ribbon labels"], cta: "Take a look" }
};

function pickProducts(products) {
  const order = ["curriculate", "grading", "fieldday"];
  const set = new Set((Array.isArray(products) ? products : []).map(p => String(p).toLowerCase()));
  const list = order.filter(p => set.has(p));
  return list.length > 0 ? list : ["fieldday"];
}

export async function sendReferEmail({ teacherName, teacherEmail, schoolName, senderName, senderSchool, products }) {
  const picked = pickProducts(products);
  const subject = picked.length === 1
    ? `${senderName} thought you'd like ${PRODUCT_INFO[picked[0]].title}`
    : `${senderName} thought you'd like Curriculate`;
  const text = `Hi ${teacherName},\n\n${senderName}${senderSchool ? ` from ${senderSchool}` : ""} thought you might find ${picked.length > 1 ? "these" : "this"} useful.\n` +
    picked.map(k => { const p = PRODUCT_INFO[k]; return `\n\n${p.title} — ${p.short}\n${p.url}`; }).join("") +
    "\n\n— Curriculate";
  const blocks = picked.map(k => { const p = PRODUCT_INFO[k]; return `
    <div style="border:1px solid #e6e8ef;border-radius:10px;padding:16px;margin-top:14px">
      <div style="font-size:18px;font-weight:700;color:#2956ff">${p.title}</div>
      <div style="color:#5b6477;font-size:14px;margin-bottom:8px">${p.short}</div>
      <a href="${p.url}" style="display:inline-block;background:#2956ff;color:white;padding:8px 14px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px">${p.cta} →</a>
    </div>`; }).join("");
  const html = htmlShell("Recommend", `<p>Hi ${teacherName},</p><p><strong>${senderName}</strong>${senderSchool ? ` from <strong>${senderSchool}</strong>` : ""} thought you might find ${picked.length > 1 ? "these" : "this"} useful${schoolName ? ` at <strong>${schoolName}</strong>` : ""}.</p>${blocks}`);
  return transport({ from: FROM_ADDR, fromName: FROM_NAME, to: teacherEmail, subject, text, html });
}

export async function sendReportEmail({ kind, message, fromName, fromEmail, schoolCode, context }) {
  const subject = `[Field Day ${kind === "problem" ? "🐞 Problem" : "💡 Suggestion"}] ${(message || "").slice(0, 60)}${(message || "").length > 60 ? "…" : ""}`;
  const text = `Type: ${kind}\nFrom: ${fromName || "(anonymous)"} ${fromEmail ? `<${fromEmail}>` : ""}\nSchool code: ${schoolCode || "(none)"}\n\nMessage:\n${message}\n\nContext:\n${JSON.stringify(context || {}, null, 2)}`;
  const safe = (s) => (s || "").replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]));
  const html = htmlShell("Report",
    `<p style="font-size:13px;color:#5b6477">Type: <strong>${kind}</strong> · From: ${fromName || "(anonymous)"}${fromEmail ? ` &lt;${fromEmail}&gt;` : ""} · School: ${schoolCode || "(none)"}</p>
    <div style="background:#f7f8fc;border:1px solid #e6e8ef;padding:12px;border-radius:8px;white-space:pre-wrap">${safe(message)}</div>
    <details style="margin-top:14px;color:#8993b0;font-size:12px"><summary>Context</summary><pre style="background:#f7f8fc;padding:10px;border-radius:6px;overflow:auto">${safe(JSON.stringify(context || {}, null, 2))}</pre></details>`);
  return transport({
    from: FROM_ADDR, fromName: FROM_NAME,
    to: process.env.FIELDDAY_REPORTS_TO || "admin@curriculate.net",
    replyTo: fromEmail || undefined,
    subject, text, html
  });
}
