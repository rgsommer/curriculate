// ====================================================================
//  transcriptEmailer.js
//  Curriculate - Session Report Emailer
//
//  Sends a teacher-facing report email and attaches a PDF report.
//  Report content mirrors the PDF typography for visual consistency.
//
//  NOTE: This module intentionally does NOT mutate Session records.
//  It renders from an immutable "snapshot" payload you pass in.
// ====================================================================

import PDFDocument from "pdfkit";
import { mailer } from "./mailer.js";

// --------------------------------------------------------------------
// Branding
// --------------------------------------------------------------------
const BRAND_NAME = "Curriculate";
const BRAND_TAGLINE = "Active learning, live classrooms.";

function resolveFromAddress() {
  // Option A: send from an alias (noreply@curriculate.net) while authenticating with EMAIL_USER.
  // Your SMTP provider must allow the "From" override for that mailbox/alias.
  const fromName = process.env.EMAIL_FROM_NAME || "Curriculate Reports";
  const fromAddr =
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.EMAIL_FROM ||
    "noreply@curriculate.net";

  return `"${fromName}" <${fromAddr}>`;
}

function resolveReplyTo() {
  // If you truly don't want replies hitting your inbox, set EMAIL_REPLY_TO to a sink/support inbox
  // or leave it blank to omit Reply-To entirely.
  const replyTo = process.env.EMAIL_REPLY_TO;
  if (replyTo == null) return undefined; // omit
  const trimmed = String(replyTo).trim();
  return trimmed.length ? trimmed : undefined;
}

// --------------------------------------------------------------------
// Utilities
// --------------------------------------------------------------------
function clamp(n, lo, hi) {
  const x = typeof n === "number" && Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, x));
}

function pct(num, den) {
  const n = typeof num === "number" ? num : 0;
  const d = typeof den === "number" ? den : 0;
  if (d <= 0) return 0;
  return Math.round((n / d) * 100);
}

function escHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asList(arr) {
  return Array.isArray(arr) ? arr : [];
}

function formatDateTime(isoOrMs) {
  try {
    const d = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(String(isoOrMs));
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("en-CA", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function planTier(planName = "FREE") {
  const p = String(planName || "FREE").toUpperCase();
  if (p.includes("PRO")) return "PRO";
  if (p.includes("PLUS")) return "PLUS";
  return "FREE";
}

function buildSoftUpgradeLine(planName = "FREE") {
  const tier = planTier(planName);
  if (tier === "FREE") {
    return "Tip: PLUS and PRO plans unlock deeper team analytics, richer engagement insights, and optional individual student one-page printouts.";
  }
  if (tier === "PLUS") {
    return "Tip: PRO unlocks advanced reporting, more AI-powered insights, and optional individual student one-page printouts.";
  }
  return ""; // PRO: no upsell
}

// --------------------------------------------------------------------
// Data shaping (tolerant to missing fields)
// --------------------------------------------------------------------
function extractOverview({ transcript, aiSummary }) {
  const roomCode = transcript?.roomCode || transcript?.code || "";
  const tasksetName = transcript?.tasksetName || transcript?.name || "Curriculate Activity";
  const startedAt = transcript?.startedAt || transcript?.createdAt || null;
  const endedAt = transcript?.endedAt || transcript?.completedAt || transcript?.endedAt || null;

  const concepts = asList(aiSummary?.keyConcepts).filter(Boolean).slice(0, 10);

  const activities = asList(aiSummary?.activities || aiSummary?.activityHighlights || transcript?.tasks)
    .map((t) => {
      if (typeof t === "string") return t;
      const title = t?.title || t?.name || t?.taskType || "Activity";
      const points = typeof t?.points === "number" ? `${t.points} pts` : null;
      return points ? `${title} (${points})` : title;
    })
    .filter(Boolean)
    .slice(0, 12);

  const engagementLabel =
    aiSummary?.engagementLabel ||
    aiSummary?.engagementLevel ||
    (typeof aiSummary?.engagementPercent === "number"
      ? `${clamp(aiSummary.engagementPercent, 0, 100)}%`
      : "");

  const proficiencyLabel =
    aiSummary?.proficiencyLabel ||
    aiSummary?.overallProficiency ||
    (typeof aiSummary?.overallPercent === "number"
      ? `${clamp(aiSummary.overallPercent, 0, 100)}%`
      : "");

  const brief = aiSummary?.groupSummary || aiSummary?.summary || "";

  return {
    roomCode,
    tasksetName,
    startedAt,
    endedAt,
    concepts,
    activities,
    engagementLabel,
    proficiencyLabel,
    brief,
  };
}

function extractTeams(transcript, aiSummary) {
  const detailed = asList(transcript?.teamsDetailed);
  if (detailed.length) return detailed;

  const teamsFromSummary = asList(aiSummary?.teams || aiSummary?.teamSummaries);
  if (teamsFromSummary.length) return teamsFromSummary;

  const scores = transcript?.scores && typeof transcript.scores === "object" ? transcript.scores : {};
  const totalPossible = typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null;

  return Object.entries(scores).map(([teamName, pts]) => ({
    teamName,
    members: [],
    moodsIn: [],
    tasksCompleted: typeof transcript?.tasks?.length === "number" ? transcript.tasks.length : null,
    engagementLabel: "",
    score: pts,
    totalPossible,
    exitFeedback: "",
    submissions: [],
  }));
}

function extractMediaSubmissions(transcript, aiSummary) {
  const items = asList(transcript?.submissions).concat(asList(aiSummary?.submissions));
  return items
    .map((s) => {
      const kind = s?.kind || s?.type || s?.taskType || "";
      const url = s?.url || s?.downloadUrl || s?.fileUrl || "";
      const filename = s?.filename || s?.name || "";
      const teamName = s?.teamName || s?.team || "";
      const taskTitle = s?.taskTitle || s?.taskName || s?.task || "";
      const createdAt = s?.createdAt || s?.timestamp || null;

      const k = String(kind).toLowerCase();
      const isMedia =
        k.includes("photo") || k.includes("image") || k.includes("record") || k.includes("audio") || k.includes("video");

      if (!isMedia && !url && !filename) return null;

      return { kind, teamName, taskTitle, filename, url, createdAt };
    })
    .filter(Boolean);
}

function shouldIncludeIndividualReports(planName, includeIndividualReports) {
  if (!includeIndividualReports) return false;
  return planTier(planName) === "PRO";
}

// --------------------------------------------------------------------
// HTML Email Builder
// --------------------------------------------------------------------
function buildEmailHtml({
  transcript,
  aiSummary,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
  includeIndividualReports,
}) {
  const tier = planTier(planName);
  const overview = extractOverview({ transcript, aiSummary });
  const teams = extractTeams(transcript, aiSummary);
  const media = extractMediaSubmissions(transcript, aiSummary);
  const upgradeLine = buildSoftUpgradeLine(planName);

  const perspectiveText = asList(perspectives).filter(Boolean).join(", ");
  const whenText = [formatDateTime(overview.startedAt), formatDateTime(overview.endedAt)].filter(Boolean).join(" — ");

  const conceptsHtml = overview.concepts.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">${overview.concepts.map((c) => `<li>${escHtml(c)}</li>`).join("")}</ul>`
    : `<div style="opacity:.8;">(No concepts detected.)</div>`;

  const activitiesHtml = overview.activities.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">${overview.activities.map((a) => `<li>${escHtml(a)}</li>`).join("")}</ul>`
    : `<div style="opacity:.8;">(No activities detected.)</div>`;

  const noteToParents = (() => {
    const cls = className ? escHtml(className) : "class";
    const grade = gradeLevel != null && String(gradeLevel).trim() ? ` (Grade ${escHtml(gradeLevel)})` : "";
    const conceptLine = overview.concepts.length ? escHtml(overview.concepts.slice(0, 3).join(", ")) : "key concepts";
    const actLine = overview.activities.length ? escHtml(overview.activities.slice(0, 3).join(", ")) : "interactive activities";
    const eng = overview.engagementLabel ? escHtml(overview.engagementLabel) : "strong";
    const prof = overview.proficiencyLabel ? escHtml(overview.proficiencyLabel) : "a developing level of proficiency";

    return `Today in ${cls}${grade}, we completed a Curriculate activity wherein students were actively involved in exploring/reviewing ${conceptLine}. ` +
      `They completed activities such as ${actLine}. The level of engagement was ${eng}. Overall, students achieved ${prof}.`;
  })();

  const teamRows = teams
    .map((t) => {
      const members = asList(t.members).filter(Boolean).join(", ");
      const moods = asList(t.moodsIn || t.moods || t.moodIn).filter(Boolean).join(", ");
      const tasksCompleted = t.tasksCompleted != null ? String(t.tasksCompleted) : (t.tasksDone != null ? String(t.tasksDone) : "—");

      const engagement =
        t.engagementLabel || t.engagement || (typeof t.engagementPercent === "number" ? `${t.engagementPercent}%` : "—");

      const score = t.teamScore != null ? t.teamScore : (t.score != null ? t.score : "—");
      const outOf =
        t.totalPossible != null ? t.totalPossible : (typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null);
      const percent = outOf != null && typeof score === "number" ? `${pct(score, outOf)}%` : "—";
      const exit = t.exitFeedback || t.exit || "";

      return `
        <tr>
          <td style="padding:8px; border-top:1px solid #e5e7eb;"><strong>${escHtml(t.teamName || "Team")}</strong></td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(members || "—")}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(moods || "—")}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(tasksCompleted)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(engagement)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(String(score))}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb; text-align:right;">${escHtml(percent)}</td>
          <td style="padding:8px; border-top:1px solid #e5e7eb;">${escHtml(exit || "—")}</td>
        </tr>
      `;
    })
    .join("");

  const mediaHtml = media.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">
        ${media
          .slice(0, 30)
          .map((m) => {
            const labelParts = [
              m.taskTitle ? `Activity: ${m.taskTitle}` : null,
              m.teamName ? `Team: ${m.teamName}` : null,
              m.filename ? `File: ${m.filename}` : null,
              m.url ? `Link: ${m.url}` : null,
            ].filter(Boolean);
            return `<li>${escHtml(labelParts.join(" • "))}</li>`;
          })
          .join("")}
      </ul>`
    : `<div style="opacity:.8;">(No photo/recording submissions were attached to this session.)</div>`;

  const categoriesHtml = (() => {
    const cats = asList(assessmentCategories).filter(Boolean);
    if (!cats.length) return "";
    return `<div style="margin-top:8px; padding:10px 12px; border:1px solid #e5e7eb; border-radius:12px; background:#f9fafb;">
      <div style="font-weight:800; margin-bottom:6px;">Assessment Categories</div>
      <div style="font-size:13px; opacity:.9;">
        ${cats
          .map((c) => `<span style="display:inline-block; margin:0 8px 6px 0; padding:4px 10px; border-radius:999px; border:1px solid #e5e7eb; background:#fff;">${escHtml(c.label || c.name || String(c))}</span>`)
          .join("")}
      </div>
    </div>`;
  })();

  const indivNote = shouldIncludeIndividualReports(planName, includeIndividualReports)
    ? `<div style="margin-top:10px; font-size:13px; opacity:.9;">Individual one-page student reports are included in the PDF attachment (print-ready).</div>`
    : (tier !== "PRO" && includeIndividualReports
        ? `<div style="margin-top:10px; font-size:13px; opacity:.9;">Individual student printouts are available on the PRO plan.</div>`
        : "");

  return `
  <div style="font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size:14px; color:#0f172a;">
    <div style="border:1px solid #e5e7eb; border-radius:16px; overflow:hidden;">
      <div style="background:#0f172a; color:#fff; padding:14px 16px;">
        <div style="font-size:16px; font-weight:900; letter-spacing:0.2px;">${BRAND_NAME} Report Ready</div>
        <div style="font-size:12px; opacity:.85;">${escHtml(BRAND_TAGLINE)}</div>
      </div>

      <div style="padding:16px;">
        ${schoolName ? `<div style="font-weight:800; font-size:13px; margin-bottom:4px;">${escHtml(schoolName)}</div>` : ""}
        <div style="font-size:12px; color:#475569;">
          <strong>Task Set:</strong> ${escHtml(overview.tasksetName)} &nbsp;•&nbsp;
          <strong>Room:</strong> ${escHtml(overview.roomCode)}
          ${whenText ? ` &nbsp;•&nbsp; <strong>When:</strong> ${escHtml(whenText)}` : ""}
        </div>
        ${perspectiveText ? `<div style="font-size:12px; color:#64748b; margin-top:4px;"><strong>Perspective:</strong> ${escHtml(perspectiveText)}</div>` : ""}

        <div style="margin-top:14px; padding:12px 14px; border-radius:14px; background:#f8fafc; border:1px solid #e5e7eb;">
          <div style="font-weight:900; margin-bottom:6px;">Brief Overview</div>
          ${overview.brief ? `<div style="line-height:1.45;">${escHtml(overview.brief)}</div>` : `<div style="opacity:.8;">(No AI summary text provided.)</div>`}
          <div style="margin-top:8px; font-size:13px; color:#334155;">
            <strong>Engagement:</strong> ${escHtml(overview.engagementLabel || "—")} &nbsp;•&nbsp;
            <strong>Overall proficiency:</strong> ${escHtml(overview.proficiencyLabel || "—")}
          </div>
        </div>

        <div style="margin-top:14px;">
          <div style="font-weight:900;">Concepts Covered</div>
          ${conceptsHtml}
        </div>

        <div style="margin-top:14px;">
          <div style="font-weight:900;">Activities Completed</div>
          ${activitiesHtml}
        </div>

        ${categoriesHtml}

        <div style="margin-top:16px; padding:12px 14px; border-radius:14px; background:#fff7ed; border:1px solid #fed7aa;">
          <div style="font-weight:900; margin-bottom:6px;">Note to Parents</div>
          <div style="line-height:1.45;">${noteToParents}</div>
        </div>

        <div style="margin-top:18px;">
          <div style="font-weight:900; margin-bottom:6px;">Teams</div>
          <div style="overflow:auto; border:1px solid #e5e7eb; border-radius:14px;">
            <table cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; min-width:860px; font-size:13px;">
              <thead style="background:#f1f5f9; color:#0f172a;">
                <tr>
                  <th style="text-align:left; padding:10px;">Team</th>
                  <th style="text-align:left; padding:10px;">Members</th>
                  <th style="text-align:left; padding:10px;">Mood (entry)</th>
                  <th style="text-align:right; padding:10px;">Tasks</th>
                  <th style="text-align:left; padding:10px;">Engagement</th>
                  <th style="text-align:right; padding:10px;">Score</th>
                  <th style="text-align:right; padding:10px;">%</th>
                  <th style="text-align:left; padding:10px;">Exit feedback</th>
                </tr>
              </thead>
              <tbody>
                ${teamRows || `<tr><td colspan="8" style="padding:10px;">No team data recorded.</td></tr>`}
              </tbody>
            </table>
          </div>
          ${indivNote}
        </div>

        <div style="margin-top:18px;">
          <div style="font-weight:900;">Photo / Recording Submissions</div>
          ${mediaHtml}
        </div>

        ${upgradeLine ? `<div style="margin-top:16px; font-size:12px; color:#64748b;">${escHtml(upgradeLine)}</div>` : ""}

        <div style="margin-top:18px; font-size:12px; color:#64748b;">
          The full printable report is attached as a PDF and is also available in your Curriculate <strong>Reports</strong> sidebar.
        </div>

        <div style="margin-top:16px; font-size:11px; color:#94a3b8;">
          Automated message from ${BRAND_NAME}. Replies may not be monitored.
        </div>
      </div>
    </div>
  </div>`;
}

// --------------------------------------------------------------------
// PDF Builder (typography aligned with email)
// --------------------------------------------------------------------
async function buildReportPdfBuffer({
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
}) {
  const overview = extractOverview({ transcript, aiSummary });
  const teams = extractTeams(transcript, aiSummary);
  const media = extractMediaSubmissions(transcript, aiSummary);
  const perspectiveText = asList(perspectives).filter(Boolean).join(", ");
  const whenText = [formatDateTime(overview.startedAt), formatDateTime(overview.endedAt)].filter(Boolean).join(" — ");
  const wantIndividualPages = shouldIncludeIndividualReports(planName, includeIndividualReports);

  const doc = new PDFDocument({ size: "LETTER", margin: 44, compress: true });
  const chunks = [];

  function header() {
    const top = doc.y;
    doc.save();
    doc
      .rect(doc.page.margins.left, top, doc.page.width - doc.page.margins.left - doc.page.margins.right, 40)
      .fill("#0f172a");
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(14).text(`${BRAND_NAME} Report`, doc.page.margins.left + 12, top + 10);
    doc.fillColor("#cbd5e1").font("Helvetica").fontSize(9).text(BRAND_TAGLINE, doc.page.margins.left + 12, top + 26);
    doc.restore();
    doc.moveDown(3);
  }

  function footer() {
    const text = `${BRAND_NAME} • Room ${overview.roomCode || "—"} • ${overview.tasksetName || "—"}`;
    doc.save();
    doc.font("Helvetica").fontSize(9).fillColor("#94a3b8");
    doc.text(text, doc.page.margins.left, doc.page.height - doc.page.margins.bottom + 8, {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      align: "center",
    });
    doc.restore();
  }

  function sectionTitle(t) {
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(t);
    doc.moveDown(0.25);
  }

  function pill(text) {
    const padX = 10;
    const x = doc.x;
    const y = doc.y;
    const w = doc.widthOfString(text) + padX * 2;
    const h = 22;
    doc.save();
    doc.roundedRect(x, y, w, h, 11).fill("#f1f5f9");
    doc.fillColor("#0f172a").font("Helvetica").fontSize(9).text(text, x + padX, y + 6);
    doc.restore();
    doc.moveDown(1.1);
  }

  function pageStart() {
    header();
    if (schoolName) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#0f172a").text(schoolName);
      doc.moveDown(0.2);
    }
    doc.font("Helvetica").fontSize(9).fillColor("#475569").text(
      `Task Set: ${overview.tasksetName}  •  Room: ${overview.roomCode}${whenText ? `  •  When: ${whenText}` : ""}`
    );
    if (perspectiveText) doc.text(`Perspective: ${perspectiveText}`);
    doc.fillColor("#0f172a");
    doc.moveDown(0.6);
  }

  function drawNoteBox(title, body, bg = "#fff7ed", border = "#fed7aa") {
    const x = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startY = doc.y;

    const titleH = doc.heightOfString(title, { width: width - 24 });
    const bodyH = doc.heightOfString(body, { width: width - 24 });
    const boxH = 14 + titleH + 8 + bodyH + 14;

    doc.save();
    doc.roundedRect(x, startY, width, boxH, 12).fill(bg).stroke(border);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(10).text(title, x + 12, startY + 12, { width: width - 24 });
    doc.fillColor("#0f172a").font("Helvetica").fontSize(10).text(body, x + 12, startY + 12 + titleH + 8, { width: width - 24, lineGap: 2 });
    doc.restore();
    doc.y = startY + boxH + 8;
  }

  function ensureSpace(minHeight) {
    const bottomY = doc.page.height - doc.page.margins.bottom - 30;
    if (doc.y + minHeight > bottomY) {
      footer();
      doc.addPage();
      pageStart();
    }
  }

  return await new Promise((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Page 1
    pageStart();

    sectionTitle("Brief Overview");
    const brief = aiSummary?.groupSummary || aiSummary?.summary || "";
    const eng = overview.engagementLabel || "—";
    const prof = overview.proficiencyLabel || "—";
    doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(brief || "(No AI summary text provided.)", { lineGap: 2 });
    doc.moveDown(0.4);
    pill(`Engagement: ${eng}   •   Overall proficiency: ${prof}`);

    sectionTitle("Concepts Covered");
    if (overview.concepts.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      overview.concepts.forEach((c) => doc.text(`• ${c}`, { lineGap: 1 }));
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("(No concepts detected.)");
    }
    doc.moveDown(0.4);

    sectionTitle("Activities Completed");
    if (overview.activities.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      overview.activities.forEach((a) => doc.text(`• ${a}`, { lineGap: 1 }));
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("(No activities detected.)");
    }
    doc.moveDown(0.4);

    const cats = asList(assessmentCategories).filter(Boolean);
    if (cats.length) {
      sectionTitle("Assessment Categories");
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      cats.forEach((c) => doc.text(`• ${c.label || c.name || String(c)}`));
      doc.moveDown(0.4);
    }

    const cls = className || "class";
    const grade = gradeLevel != null && String(gradeLevel).trim() ? ` (Grade ${gradeLevel})` : "";
    const conceptLine = overview.concepts.length ? overview.concepts.slice(0, 3).join(", ") : "key concepts";
    const actLine = overview.activities.length ? overview.activities.slice(0, 3).join(", ") : "interactive activities";
    const noteToParents =
      `Today in ${cls}${grade}, we completed a Curriculate activity wherein students were actively involved in exploring/reviewing ${conceptLine}. ` +
      `They completed activities such as ${actLine}. The level of engagement was ${eng}. Overall, students achieved ${prof}.`;

    ensureSpace(120);
    drawNoteBox("Note to Parents", noteToParents);

    ensureSpace(220);
    sectionTitle("Teams");

    const tableX = doc.page.margins.left;
    const tableW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cols = [
      { label: "Team", w: 0.14 },
      { label: "Members", w: 0.20 },
      { label: "Mood", w: 0.12 },
      { label: "Tasks", w: 0.07 },
      { label: "Engagement", w: 0.12 },
      { label: "Score", w: 0.10 },
      { label: "%", w: 0.06 },
      { label: "Exit feedback", w: 0.19 },
    ];
    const colXs = [];
    let xCursor = tableX;
    cols.forEach((c) => {
      colXs.push(xCursor);
      xCursor += tableW * c.w;
    });

    // Header row
    doc.save();
    doc.rect(tableX, doc.y, tableW, 22).fill("#f1f5f9");
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(9);
    cols.forEach((c, i) => {
      doc.text(c.label, colXs[i] + 4, doc.y + 6, { width: tableW * c.w - 8 });
    });
    doc.restore();
    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(9).fillColor("#0f172a");

    function rowHeightFor(values) {
      const lineH = 11.5;
      let maxLines = 1;
      values.forEach((v, i) => {
        const w = tableW * cols[i].w - 8;
        const h = doc.heightOfString(v, { width: w });
        maxLines = Math.max(maxLines, Math.ceil(h / lineH));
      });
      return maxLines * lineH + 10;
    }

    for (const t of teams) {
      const members = asList(t.members).filter(Boolean).join(", ") || "—";
      const moods = asList(t.moodsIn || t.moods || t.moodIn).filter(Boolean).join(", ") || "—";
      const tasksCompleted = t.tasksCompleted != null ? String(t.tasksCompleted) : (t.tasksDone != null ? String(t.tasksDone) : "—");
      const engagement =
        t.engagementLabel || t.engagement || (typeof t.engagementPercent === "number" ? `${t.engagementPercent}%` : "—");
      const scoreVal = t.teamScore != null ? t.teamScore : (t.score != null ? t.score : "—");
      const outOf =
        t.totalPossible != null ? t.totalPossible : (typeof transcript?.totalPossible === "number" ? transcript.totalPossible : null);
      const percent = outOf != null && typeof scoreVal === "number" ? `${pct(scoreVal, outOf)}%` : "—";
      const exit = t.exitFeedback || t.exit || "—";

      const vals = [
        String(t.teamName || "Team"),
        members,
        moods,
        tasksCompleted,
        engagement,
        String(scoreVal),
        percent,
        exit,
      ];

      const rh = rowHeightFor(vals);
      ensureSpace(rh + 20);

      doc.save();
      doc.rect(tableX, doc.y - 2, tableW, rh).stroke("#e5e7eb");
      doc.restore();

      cols.forEach((c, i) => {
        const w = tableW * c.w - 8;
        doc.text(vals[i], colXs[i] + 4, doc.y + 6, { width: w });
      });

      doc.y = doc.y + rh;
    }

    doc.moveDown(0.6);

    ensureSpace(140);
    sectionTitle("Photo / Recording Submissions");
    if (media.length) {
      doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
      media.slice(0, 60).forEach((m) => {
        const parts = [
          m.taskTitle ? `Activity: ${m.taskTitle}` : null,
          m.teamName ? `Team: ${m.teamName}` : null,
          m.filename ? `File: ${m.filename}` : null,
          m.url ? `Link: ${m.url}` : null,
        ].filter(Boolean);
        doc.text(`• ${parts.join(" • ")}`, { lineGap: 1 });
      });
    } else {
      doc.font("Helvetica").fontSize(10).fillColor("#475569").text("(No photo/recording submissions were attached to this session.)");
    }

    const upgradeLine = buildSoftUpgradeLine(planName);
    if (upgradeLine) {
      doc.moveDown(0.8);
      doc.font("Helvetica").fontSize(9).fillColor("#64748b").text(upgradeLine, { align: "center" });
      doc.fillColor("#0f172a");
    }

    footer();

    // Optional individual pages
    const perParticipant = asList(aiSummary?.perParticipant).filter(Boolean);
    if (wantIndividualPages && perParticipant.length) {
      for (const p of perParticipant) {
        doc.addPage();
        pageStart();
        sectionTitle("Student Session Report");

        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(p.studentName || "Student");
        doc.font("Helvetica").fontSize(10).fillColor("#475569").text(`Team: ${p.teamName || "—"}`);
        doc.moveDown(0.6);

        const engP = typeof p.engagementPercent === "number" ? `${clamp(p.engagementPercent, 0, 100)}%` : "—";
        const finalP = typeof p.finalPercent === "number" ? `${clamp(p.finalPercent, 0, 100)}%` : "—";
        pill(`Engagement: ${engP}   •   Overall mark: ${finalP}`);

        const catsP = asList(p.categories);
        if (catsP.length) {
          sectionTitle("Category Breakdown");
          doc.font("Helvetica").fontSize(10).fillColor("#0f172a");
          catsP.forEach((c) => {
            const pText = typeof c.percent === "number" ? `${clamp(c.percent, 0, 100)}%` : "—";
            const label = c.label || c.name || "Category";
            const comment = c.comment ? ` — ${c.comment}` : "";
            doc.text(`• ${label}: ${pText}${comment}`, { lineGap: 1 });
          });
          doc.moveDown(0.4);
        }

        sectionTitle("Teacher Comment");
        doc.font("Helvetica").fontSize(10).fillColor("#0f172a").text(p.summary || "—", { lineGap: 2 });

        footer();
      }
    }

    doc.end();
  });
}

// --------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------
export async function sendTranscriptEmail({
  to,
  transcript,
  aiSummary,
  includeIndividualReports,
  schoolName,
  perspectives,
  planName = "FREE",
  className,
  gradeLevel,
  assessmentCategories,
}) {
  if (!to) throw new Error("Missing destination email.");
  if (!transcript) throw new Error("Missing transcript payload.");

  const html = buildEmailHtml({
    transcript,
    aiSummary,
    schoolName,
    perspectives,
    planName,
    className,
    gradeLevel,
    assessmentCategories,
    includeIndividualReports,
  });

  const pdfBuffer = await buildReportPdfBuffer({
    transcript,
    aiSummary,
    includeIndividualReports,
    schoolName,
    perspectives,
    planName,
    className,
    gradeLevel,
    assessmentCategories,
  });

  const roomCode = transcript?.roomCode || transcript?.code || "";
  const tasksetName = transcript?.tasksetName || transcript?.name || "Curriculate Activity";

  const subject = process.env.EMAIL_SUBJECT_PREFIX
    ? `${process.env.EMAIL_SUBJECT_PREFIX} ${tasksetName} (Room ${roomCode})`
    : `Curriculate Report Ready — ${tasksetName} (Room ${roomCode})`;

    const replyTo = resolveReplyTo();

    await mailer.sendMail({
      from: resolveFromAddress(),
      ...(replyTo ? { replyTo } : {}),
      to,
      subject,
      html,
      attachments: [
        {
          filename: `Curriculate-Report-${roomCode || "session"}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf",
        },
      ],
    });

}
