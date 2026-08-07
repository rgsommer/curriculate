/** Report-ready notification. Uses Resend, which is already a dependency of this app. */
export async function sendReportReady(to: string, cityLabel: string, url: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.OPP_EMAIL_FROM || 'Curriculate <reports@curriculate.net>';
  if (!key || !to) return;
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to,
        subject: `Your opportunity gap report — ${cityLabel}`,
        html: `
          <div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;max-width:560px;line-height:1.5">
            <h2 style="color:#1e3a5f;margin:0 0 12px">Your report for ${cityLabel} is ready</h2>
            <p>It covers the top opportunities, what is underserved rather than merely missing,
               expansions for existing businesses, and the ideas we investigated and rejected.</p>
            <p style="margin:24px 0"><a href="${url}"
               style="background:#1e3a5f;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600">
               Open your report</a></p>
            <p style="color:#64748b;font-size:13px">Keep this link — it is how you get back in.
               Figures in the report are estimates and it is research, not investment advice.</p>
          </div>`,
      }),
    });
  } catch { /* notification failure must never break generation */ }
}
