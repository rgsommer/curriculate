// Builds the "invite teachers" email finance copies to their clipboard. Returns
// a subject + an HTML body (rich paste into Outlook/Gmail) + a plain-text fallback.

function fmtDue(d) {
  if (!d) return "";
  const [y, m, day] = String(d).split("-").map(Number);
  if (!y || !m || !day) return d;
  return new Date(y, m - 1, day).toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function buildInviteEmail({ schoolName = "our school", financeName = "Finance", url = "https://www.curriculate.net/orders", dueDate = "" } = {}) {
  const due = fmtDue(dueDate);
  const subject = due
    ? `Order your classroom & office supplies online — due ${due}`
    : `Order your classroom & office supplies online`;
  const dueHtml = due ? `<p style="margin:14px 0 0;padding:8px 12px;background:#eef2ff;border-radius:6px;color:#3730a3"><strong>Please submit your order by ${due}.</strong></p>` : "";
  const dueText = due ? `\nPlease submit your order by ${due}.\n` : "";

  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937;font-size:15px;line-height:1.55;max-width:620px">
  <p>Hi team,</p>
  <p>We've moved classroom &amp; office supply ordering online — no more paper forms. You can browse the full Staples Professional and Office Central catalogues and send your order in a couple of minutes.</p>
  <p style="margin:18px 0">
    <a href="${url}" style="background:#4f46e5;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">Open the ordering page</a>
  </p>
  <p style="margin:0 0 6px"><strong>What it's for:</strong> requesting the supplies you need for your classroom — pencils, markers, paper, binders, art materials, and everything else on the approved catalogues.</p>
  <p style="margin:14px 0 6px"><strong>How to use it:</strong></p>
  <ol style="margin:0 0 6px;padding-left:20px">
    <li>Go to <a href="${url}">${url.replace(/^https?:\/\//, "")}</a>. If you're already signed in to Behaviours you'll go straight in; otherwise enter your school email and we'll send you a 6-digit code.</li>
    <li>Search or browse by category and type the quantity you want beside any item. Your running total updates as you go.</li>
    <li>Put your name in, then click <strong>Send order</strong>.</li>
  </ol>
  <p style="margin:14px 0 6px"><strong>What happens next:</strong> you'll get an email confirmation of exactly what you ordered, and ${financeName} receives your order automatically and places it with the suppliers. Order anytime — you can submit more than once.</p>
  ${dueHtml}
  <p style="margin:18px 0 4px">Thanks,<br>${financeName}<br><span style="color:#6b7280">${schoolName}</span></p>
</div>`;

  const text = [
    `Hi team,`,
    ``,
    `We've moved classroom & office supply ordering online — no more paper forms. You can browse the full Staples Professional and Office Central catalogues and send your order in a couple of minutes.`,
    ``,
    `Open the ordering page: ${url}`,
    ``,
    `What it's for: requesting the supplies you need for your classroom — pencils, markers, paper, binders, art materials, and everything else on the approved catalogues.`,
    ``,
    `How to use it:`,
    `  1. Go to ${url}. If you're already signed in to Behaviours you'll go straight in; otherwise enter your school email and we'll send you a 6-digit code.`,
    `  2. Search or browse by category and type the quantity you want beside any item. Your running total updates as you go.`,
    `  3. Put your name in, then click "Send order".`,
    ``,
    `What happens next: you'll get an email confirmation of exactly what you ordered, and ${financeName} receives your order automatically and places it with the suppliers. Order anytime — you can submit more than once.`,
    dueText,
    `Thanks,`,
    `${financeName}`,
    `${schoolName}`,
  ].join("\n");

  return { subject, html, text };
}
