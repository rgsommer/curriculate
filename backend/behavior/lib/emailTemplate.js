// backend/behavior/lib/emailTemplate.js
//
// Shared, email-client-safe HTML for every Behaviours email (parent notices,
// invites, admin summaries, reports, reminders). Inline styles only — Gmail/
// Outlook strip <style> blocks — and a simple centered card so it looks tidy
// everywhere. Keep it dependency-free and deterministic.

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Wrap content in the branded shell.
 * @param {object} o
 *   title       big heading in the coloured header
 *   schoolName  small eyebrow above the title (and in the footer)
 *   contentHtml the inner HTML (already safe/escaped)
 *   preheader   hidden inbox-preview text
 *   accent      header colour (e.g. green for good news)
 *   footnote    small grey line above the standard footer
 */
export function emailShell({ title = "", schoolName = "", contentHtml = "", preheader = "", accent = "#0f172a", footnote = "" } = {}) {
  return (
    `<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px 12px;` +
    `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0f172a">` +
    (preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>` : "") +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden">` +
    `<div style="background:${accent};padding:18px 24px;color:#ffffff">` +
    `<div style="font-size:12px;letter-spacing:.05em;text-transform:uppercase;opacity:.82">${escapeHtml(schoolName || "Behaviours")}</div>` +
    (title ? `<div style="font-size:19px;font-weight:700;margin-top:3px">${escapeHtml(title)}</div>` : "") +
    `</div>` +
    `<div style="padding:24px">${contentHtml}</div>` +
    `<div style="padding:14px 24px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;line-height:1.5">` +
    (footnote ? `${escapeHtml(footnote)}<br>` : "") +
    `Sent by ${escapeHtml(schoolName || "the Behaviours app")}.` +
    `</div></div></body></html>`
  );
}

/**
 * Convert a plain composed note (paragraphs separated by blank lines, bullet
 * lines starting with • or -) into clean HTML paragraphs + lists.
 */
export function noteToHtml(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  let html = "";
  let para = [];
  let list = [];
  const flushPara = () => {
    if (para.length) {
      html += `<p style="margin:0 0 12px;line-height:1.6;color:#334155">${para.map(escapeHtml).join("<br>")}</p>`;
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      html +=
        `<ul style="margin:8px 0 14px;padding-left:20px;color:#334155">` +
        list.map((li) => `<li style="margin:4px 0;line-height:1.5">${escapeHtml(li)}</li>`).join("") +
        `</ul>`;
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(/^\s*[•\-]\s+(.*)$/);
    if (bullet) {
      flushPara();
      list.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return html;
}

/** Convert light markdown (**bold**, # headings, - bullets) to email HTML. */
export function mdToHtml(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const inline = (s) => escapeHtml(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  let html = "";
  let list = [];
  const flush = () => {
    if (list.length) {
      html += `<ul style="margin:8px 0 12px;padding-left:20px;color:#334155">${list.map((li) => `<li style="margin:3px 0;line-height:1.5">${inline(li)}</li>`).join("")}</ul>`;
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const b = line.match(/^\s*[-*]\s+(.*)$/);
    if (b) { list.push(b[1]); continue; }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const whole = line.trim().match(/^\*\*([^*]+)\*\*$/);
    if (h) html += `<h3 style="margin:14px 0 6px;font-size:15px;color:#0f172a">${inline(h[2])}</h3>`;
    else if (whole) html += `<p style="margin:12px 0 4px;font-weight:700;color:#0f172a">${escapeHtml(whole[1])}</p>`;
    else html += `<p style="margin:0 0 10px;line-height:1.6;color:#334155">${inline(line)}</p>`;
  }
  flush();
  return html;
}

/**
 * A monthly timeline bar chart for an email: red = negative events, green =
 * positive, stacked per month. `byMonth` is { "YYYY-MM": { neg, pos } }.
 */
export function monthlyKindChartHtml(byMonth) {
  const keys = Object.keys(byMonth || {}).sort();
  if (!keys.length) return `<p style="color:#94a3b8;margin:4px 0">No events in this window.</p>`;
  const max = Math.max(1, ...keys.map((k) => (byMonth[k].neg || 0) + (byMonth[k].pos || 0)));
  const rows = keys
    .map((k) => {
      const neg = byMonth[k].neg || 0;
      const pos = byMonth[k].pos || 0;
      const negW = Math.round((neg / max) * 100);
      const posW = Math.round((pos / max) * 100);
      const label = [neg ? `${neg}✕` : "", pos ? `${pos}✓` : ""].filter(Boolean).join(" ");
      return (
        `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">` +
        `<span style="width:62px;color:#64748b;font-size:12px">${escapeHtml(k)}</span>` +
        `<span style="flex:1;display:flex;background:#f1f5f9;border-radius:3px;overflow:hidden;height:14px">` +
        `<span style="background:#dc2626;width:${negW}%;display:inline-block">&nbsp;</span>` +
        `<span style="background:#16a34a;width:${posW}%;display:inline-block">&nbsp;</span>` +
        `</span>` +
        `<span style="width:54px;font-size:12px;color:#475569">${label}</span>` +
        `</div>`
      );
    })
    .join("");
  return (
    `<div>${rows}` +
    `<div style="margin-top:6px;font-size:11px;color:#94a3b8"><span style="color:#dc2626">■</span> negative &nbsp; <span style="color:#16a34a">■</span> positive</div></div>`
  );
}

/** A simple call-to-action button (table-based for Outlook). */
export function emailButton(label, href, color = "#0f172a") {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0"><tr><td bgcolor="${color}" style="border-radius:8px">` +
    `<a href="${escapeHtml(href)}" style="display:inline-block;padding:11px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}
