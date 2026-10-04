import { CAMPFIRE_ANDROID_LIVE, CAMPFIRE_ANDROID_URL, CAMPFIRE_IOS_URL } from "./appLinks";

// Rich copy for invites: puts BOTH a plain-text and a formatted (HTML) version on the
// clipboard. Messages / WhatsApp / Edsby paste the plain text; Mail, Gmail, Outlook and
// Docs paste the formatted one — tappable button, linked app names instead of raw URLs.
// Falls back to plain text where the browser can't write HTML.
export async function copyRich(text: string, html: string): Promise<void> {
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (
    nav?.clipboard &&
    typeof nav.clipboard.write === "function" &&
    typeof ClipboardItem !== "undefined"
  ) {
    try {
      await nav.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      /* fall through to plain text */
    }
  }
  await nav!.clipboard.writeText(text);
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Formatted invite. Inline styles only — that's what survives pasting into mail apps.
export function inviteHtml(opts: {
  heading: string;
  subheading?: string | null;
  paragraphs?: (string | null | undefined)[];
  ctaUrl: string;
  ctaLabel: string;
  ctaHint?: string | null;
  footnote?: string | null;
  extraHtml?: string; // trusted, static HTML (e.g. the "Did you know?" teaser)
}): string {
  const p = (t: string, style = "") =>
    `<p style="margin:0 0 10px;color:#334155;${style}">${esc(t)}</p>`;
  const apps = [
    `<a href="${CAMPFIRE_IOS_URL}" style="color:#c2410c;font-weight:600;">iPhone app</a>`,
    ...(CAMPFIRE_ANDROID_LIVE
      ? [`<a href="${CAMPFIRE_ANDROID_URL}" style="color:#c2410c;font-weight:600;">Android app</a>`]
      : []),
  ].join(" · ");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:560px;">
<p style="margin:0 0 4px;font-size:19px;font-weight:700;color:#0f172a;">${esc(opts.heading)}</p>
${opts.subheading ? `<p style="margin:0 0 12px;color:#64748b;">${esc(opts.subheading)}</p>` : ""}
${(opts.paragraphs ?? []).filter((x): x is string => !!x && !!x.trim()).map((t) => p(t)).join("\n")}
<p style="margin:16px 0 6px;"><a href="${opts.ctaUrl}" style="display:inline-block;background-color:#f97316;background-image:linear-gradient(to right,#f97316,#f43f5e);color:#ffffff;font-weight:700;text-decoration:none;padding:12px 24px;border-radius:9999px;">${esc(opts.ctaLabel)}</a></p>
${opts.ctaHint ? `<p style="margin:0 0 12px;font-size:13px;color:#64748b;">${esc(opts.ctaHint)}</p>` : ""}
${opts.footnote ? `<p style="margin:0 0 12px;font-size:13px;color:#64748b;">${esc(opts.footnote)}</p>` : ""}
<p style="margin:14px 0 0;font-size:13px;color:#64748b;">📲 Prefer the app? ${apps} <span style="color:#94a3b8;">(optional — the link works in any browser)</span></p>
${opts.extraHtml ?? ""}
</div>`;
}
