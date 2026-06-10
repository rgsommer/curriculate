// Resend email helpers for /orders. Lazy-inits Resend inside send() so a missing
// RESEND_API_KEY never breaks `next build` and local runs degrade gracefully.

import { Resend } from "resend";

const FROM =
  process.env.RESEND_ORDERS_FROM_ADDRESS ||
  process.env.RESEND_FROM_ADDRESS ||
  "Curriculate Orders <noreply@curriculate.net>";

export type SendResult = { ok: boolean; skipped?: boolean; error?: string };

export async function sendEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // No key configured (e.g. local dev) — don't fail the request.
    return { ok: false, skipped: true, error: "RESEND_API_KEY not set" };
  }
  try {
    const resend = new Resend(key);
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      ...(opts.attachments && opts.attachments.length ? { attachments: opts.attachments } : {}),
    });
    if (error) return { ok: false, error: String((error as any)?.message || error) };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export function pageShell(title: string, bodyHtml: string, schoolName: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f7f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2937">
    <div style="max-width:680px;margin:0 auto;padding:24px">
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
        <div style="font-size:13px;color:#6b7280;margin-bottom:4px">${schoolName} · Supply Ordering</div>
        <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
        ${bodyHtml}
      </div>
      <p style="font-size:12px;color:#9ca3af;text-align:center;margin:16px 0 0">Sent by curriculate.net/orders</p>
    </div>
  </body></html>`;
}
